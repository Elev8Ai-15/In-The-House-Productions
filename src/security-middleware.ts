// Zero-Trust Security Middleware and Headers
// Only includes functions that are actively used in the application

import { Context, Next } from 'hono'

/**
 * Security headers middleware with zero-trust configuration
 * Implements comprehensive security headers for defense-in-depth
 */
export async function securityHeaders(c: Context, next: Next) {
  await next()

  // Content Security Policy - Zero Trust: Only allow necessary sources
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://js.stripe.com https://cdn.refersion.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "connect-src 'self' https://api.stripe.com https://cdn.refersion.com",
    "frame-src https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join('; ')

  // Set comprehensive security headers
  c.header('Content-Security-Policy', csp)

  // Prevent clickjacking attacks
  c.header('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff')

  // Enable XSS protection (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block')

  // Referrer policy for privacy
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions policy (formerly Feature-Policy)
  const permissions = [
    'geolocation=()',
    'microphone=()',
    'camera=()',
    'payment=(self)',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()'
  ].join(', ')
  c.header('Permissions-Policy', permissions)

  // Strict Transport Security - Force HTTPS for 1 year
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')

  // Cross-Origin policies
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Resource-Policy', 'cross-origin')

  // Remove server identification
  c.header('X-Powered-By', '')

  // Cache control for security-sensitive pages
  const path = c.req.path
  if (path.includes('/admin') || path.includes('/login') || path.includes('/register')) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    c.header('Pragma', 'no-cache')
    c.header('Expires', '0')
  }
}

/**
 * Rate limiting store (in-memory for Cloudflare Workers)
 * In production, consider using Durable Objects or KV for distributed rate limiting
 */
interface RateLimitEntry {
  count: number
  resetTime: number
  lockoutUntil?: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up old entries on-demand (Cloudflare Workers don't support setInterval)
function cleanupRateLimitStore() {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now && (!entry.lockoutUntil || entry.lockoutUntil < now)) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * Rate limiting middleware with progressive penalties
 * @param maxRequests Maximum requests allowed in the time window
 * @param windowMs Time window in milliseconds
 * @param maxFailures Maximum failures before account lockout (for auth endpoints)
 */
export function rateLimit(maxRequests: number = 100, windowMs: number = 60000, maxFailures?: number) {
  return async (c: Context, next: Next) => {
    // Randomly cleanup old entries (1% chance) to avoid memory leaks
    if (Math.random() < 0.01) {
      cleanupRateLimitStore()
    }
    
    const clientIp = c.req.header('cf-connecting-ip') ||
                     c.req.header('x-forwarded-for') ||
                     c.req.header('x-real-ip') ||
                     'unknown'

    const path = c.req.path
    const key = `${clientIp}:${path}`
    const now = Date.now()

    let entry = rateLimitStore.get(key)

    // Check if client is in lockout
    if (entry?.lockoutUntil && entry.lockoutUntil > now) {
      const retryAfter = Math.ceil((entry.lockoutUntil - now) / 1000)
      c.header('Retry-After', retryAfter.toString())
      return c.json({
        error: 'Too many failed attempts. Account temporarily locked.',
        retryAfter: retryAfter
      }, 429)
    }

    // Initialize or reset entry
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs
      }
      rateLimitStore.set(key, entry)
    }

    entry.count++

    // Check rate limit
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000)
      c.header('Retry-After', retryAfter.toString())
      c.header('X-RateLimit-Limit', maxRequests.toString())
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', entry.resetTime.toString())

      return c.json({
        error: 'Too many requests. Please try again later.',
        retryAfter: retryAfter
      }, 429)
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString())
    c.header('X-RateLimit-Remaining', (maxRequests - entry.count).toString())
    c.header('X-RateLimit-Reset', entry.resetTime.toString())

    await next()

    // Handle failed authentication attempts with progressive lockout
    if (maxFailures && c.res.status === 401) {
      const failureKey = `${clientIp}:${path}:failures`
      let failureEntry = rateLimitStore.get(failureKey)

      if (!failureEntry || failureEntry.resetTime < now) {
        failureEntry = {
          count: 0,
          resetTime: now + (15 * 60 * 1000) // 15 minute window for failures
        }
      }

      failureEntry.count++

      // Progressive lockout: 5 mins after 5 failures, 15 mins after 10, 1 hour after 15
      if (failureEntry.count >= 15) {
        failureEntry.lockoutUntil = now + (60 * 60 * 1000) // 1 hour
      } else if (failureEntry.count >= 10) {
        failureEntry.lockoutUntil = now + (15 * 60 * 1000) // 15 minutes
      } else if (failureEntry.count >= 5) {
        failureEntry.lockoutUntil = now + (5 * 60 * 1000) // 5 minutes
      }

      rateLimitStore.set(failureKey, failureEntry)

      // Also update the main entry with lockout
      if (failureEntry.lockoutUntil) {
        entry.lockoutUntil = failureEntry.lockoutUntil
      }
    }
  }
}
