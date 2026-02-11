// D1-based Persistent Rate Limiter
// Replaces in-memory rate limiting with D1 SQLite for cross-request persistence
// Falls back to in-memory if DB is unavailable

import { Context, Next } from 'hono'

// In-memory fallback (existing implementation kept as backup)
interface RateLimitEntry {
  count: number
  resetTime: number
  lockoutUntil?: number
}

const memoryStore = new Map<string, RateLimitEntry>()

function cleanupMemoryStore() {
  const now = Date.now()
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetTime < now && (!entry.lockoutUntil || entry.lockoutUntil < now)) {
      memoryStore.delete(key)
    }
  }
}

/**
 * D1-backed rate limiter with progressive lockout.
 * Creates/uses a rate_limits table in D1 for persistent tracking.
 * Falls back to in-memory if D1 is unavailable.
 */
// Module-level flag: table creation only needs to happen once per isolate lifecycle
let tableEnsured = false

export function d1RateLimit(maxRequests: number = 100, windowMs: number = 60000, maxFailures?: number) {
  return async (c: Context, next: Next) => {
    const DB = c.env?.DB

    // Fall back to in-memory if no DB
    if (!DB) {
      return inMemoryRateLimit(c, next, maxRequests, windowMs, maxFailures)
    }

    // Ensure rate_limits table exists (once per isolate lifecycle)
    if (!tableEnsured) {
      try {
        await DB.prepare(`
          CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0,
            reset_time INTEGER NOT NULL,
            lockout_until INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0,
            failure_reset INTEGER DEFAULT 0
          )
        `).run()
        tableEnsured = true
      } catch {
        // Table likely already exists (migration 0013); mark as ensured and continue
        tableEnsured = true
      }
    }

    const clientIp = c.req.header('cf-connecting-ip') ||
                     c.req.header('x-forwarded-for') ||
                     c.req.header('x-real-ip') || 'unknown'
    const path = c.req.path
    const key = `${clientIp}:${path}`
    const now = Date.now()

    try {
      // Get or create entry
      let entry = await DB.prepare(
        'SELECT * FROM rate_limits WHERE key = ?'
      ).bind(key).first() as any

      // Check lockout
      if (entry?.lockout_until && entry.lockout_until > now) {
        const retryAfter = Math.ceil((entry.lockout_until - now) / 1000)
        c.header('Retry-After', retryAfter.toString())
        return c.json({
          error: 'Too many failed attempts. Account temporarily locked.',
          retryAfter
        }, 429)
      }

      // Reset if window expired
      if (!entry || entry.reset_time < now) {
        await DB.prepare(`
          INSERT OR REPLACE INTO rate_limits (key, count, reset_time, lockout_until, failure_count, failure_reset)
          VALUES (?, 1, ?, 0, COALESCE((SELECT failure_count FROM rate_limits WHERE key = ?), 0), COALESCE((SELECT failure_reset FROM rate_limits WHERE key = ?), 0))
        `).bind(key, now + windowMs, key, key).run()
        entry = { count: 1, reset_time: now + windowMs, lockout_until: 0, failure_count: 0, failure_reset: 0 }
      } else {
        // Increment count
        await DB.prepare(
          'UPDATE rate_limits SET count = count + 1 WHERE key = ?'
        ).bind(key).run()
        entry.count++
      }

      // Check rate limit
      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.reset_time - now) / 1000)
        c.header('Retry-After', retryAfter.toString())
        c.header('X-RateLimit-Limit', maxRequests.toString())
        c.header('X-RateLimit-Remaining', '0')
        c.header('X-RateLimit-Reset', entry.reset_time.toString())
        return c.json({ error: 'Too many requests. Please try again later.', retryAfter }, 429)
      }

      // Set rate limit headers
      c.header('X-RateLimit-Limit', maxRequests.toString())
      c.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count).toString())
      c.header('X-RateLimit-Reset', entry.reset_time.toString())

      await next()

      // Handle failed auth with progressive lockout
      if (maxFailures && c.res.status === 401) {
        const failureResetTime = now + (15 * 60 * 1000)
        let failureCount = entry.failure_count || 0
        
        if (entry.failure_reset && entry.failure_reset < now) {
          failureCount = 0 // Reset failure window
        }
        failureCount++

        let lockoutUntil = 0
        if (failureCount >= 15) lockoutUntil = now + (60 * 60 * 1000)
        else if (failureCount >= 10) lockoutUntil = now + (15 * 60 * 1000)
        else if (failureCount >= 5) lockoutUntil = now + (5 * 60 * 1000)

        await DB.prepare(`
          UPDATE rate_limits SET failure_count = ?, failure_reset = ?, lockout_until = ? WHERE key = ?
        `).bind(failureCount, failureResetTime, lockoutUntil, key).run()
      }
    } catch {
      // If D1 fails, pass through (don't block legitimate requests)
      await next()
    }

    // Periodic cleanup (1% chance)
    if (Math.random() < 0.01) {
      try {
        await DB.prepare(
          'DELETE FROM rate_limits WHERE reset_time < ? AND (lockout_until < ? OR lockout_until = 0)'
        ).bind(now, now).run()
      } catch {}
    }
  }
}

// In-memory fallback (same logic as original)
async function inMemoryRateLimit(c: Context, next: Next, maxRequests: number, windowMs: number, maxFailures?: number) {
  if (Math.random() < 0.01) cleanupMemoryStore()

  const clientIp = c.req.header('cf-connecting-ip') ||
                   c.req.header('x-forwarded-for') ||
                   c.req.header('x-real-ip') || 'unknown'
  const path = c.req.path
  const key = `${clientIp}:${path}`
  const now = Date.now()

  let entry = memoryStore.get(key)

  if (entry?.lockoutUntil && entry.lockoutUntil > now) {
    const retryAfter = Math.ceil((entry.lockoutUntil - now) / 1000)
    c.header('Retry-After', retryAfter.toString())
    return c.json({ error: 'Too many failed attempts. Account temporarily locked.', retryAfter }, 429)
  }

  if (!entry || entry.resetTime < now) {
    entry = { count: 0, resetTime: now + windowMs }
    memoryStore.set(key, entry)
  }

  entry.count++

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000)
    c.header('Retry-After', retryAfter.toString())
    return c.json({ error: 'Too many requests. Please try again later.', retryAfter }, 429)
  }

  c.header('X-RateLimit-Limit', maxRequests.toString())
  c.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count).toString())
  c.header('X-RateLimit-Reset', entry.resetTime.toString())

  await next()

  if (maxFailures && c.res.status === 401) {
    const failureKey = `${clientIp}:${path}:failures`
    let failureEntry = memoryStore.get(failureKey)
    if (!failureEntry || failureEntry.resetTime < now) {
      failureEntry = { count: 0, resetTime: now + (15 * 60 * 1000) }
    }
    failureEntry.count++
    if (failureEntry.count >= 15) failureEntry.lockoutUntil = now + (60 * 60 * 1000)
    else if (failureEntry.count >= 10) failureEntry.lockoutUntil = now + (15 * 60 * 1000)
    else if (failureEntry.count >= 5) failureEntry.lockoutUntil = now + (5 * 60 * 1000)
    memoryStore.set(failureKey, failureEntry)
    if (failureEntry.lockoutUntil) entry.lockoutUntil = failureEntry.lockoutUntil
  }
}
