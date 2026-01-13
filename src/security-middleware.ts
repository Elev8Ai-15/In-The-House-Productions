// Zero-Trust Security Middleware and Headers

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
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://cdn.jsdelivr.net",
    "connect-src 'self' https://api.stripe.com",
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
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')

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

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now && (!entry.lockoutUntil || entry.lockoutUntil < now)) {
      rateLimitStore.delete(key)
    }
  }
}, 5 * 60 * 1000)

/**
 * Rate limiting middleware with progressive penalties
 * @param maxRequests Maximum requests allowed in the time window
 * @param windowMs Time window in milliseconds
 * @param maxFailures Maximum failures before account lockout (for auth endpoints)
 */
export function rateLimit(maxRequests: number = 100, windowMs: number = 60000, maxFailures?: number) {
  return async (c: Context, next: Next) => {
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

/**
 * CSRF token generation and validation
 */
export async function generateCSRFToken(secret: string, sessionId: string): Promise<string> {
  const data = `${sessionId}:${Date.now()}`
  const encoder = new TextEncoder()

  const keyData = encoder.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  )

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${btoa(data)}.${encodedSignature}`
}

/**
 * Validate CSRF token
 */
export async function validateCSRFToken(token: string, secret: string, maxAge: number = 3600000): Promise<boolean> {
  try {
    const [encodedData, encodedSignature] = token.split('.')
    if (!encodedData || !encodedSignature) return false

    const data = atob(encodedData)
    const [sessionId, timestamp] = data.split(':')

    // Check token age
    const tokenAge = Date.now() - parseInt(timestamp)
    if (tokenAge > maxAge) return false

    // Verify signature
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signature = Uint8Array.from(
      atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/') + '=='),
      c => c.charCodeAt(0)
    )

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(data)
    )

    return isValid
  } catch {
    return false
  }
}

/**
 * Input validation and sanitization enhancement
 */
export function validateAndSanitize(input: string, type: 'text' | 'email' | 'phone' | 'url' = 'text'): { valid: boolean; sanitized: string; error?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, sanitized: '', error: 'Input is required' }
  }

  // Trim and limit length
  let sanitized = input.trim().slice(0, 1000)

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '')

  // Type-specific validation
  switch (type) {
    case 'email':
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
      if (!emailRegex.test(sanitized)) {
        return { valid: false, sanitized: '', error: 'Invalid email format' }
      }
      sanitized = sanitized.toLowerCase()
      break

    case 'phone':
      // Remove all non-numeric characters except + at start
      const cleaned = sanitized.replace(/[^\d+]/g, '')
      if (cleaned.length < 10) {
        return { valid: false, sanitized: '', error: 'Invalid phone number' }
      }
      sanitized = cleaned
      break

    case 'url':
      try {
        const url = new URL(sanitized)
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { valid: false, sanitized: '', error: 'Invalid URL protocol' }
        }
      } catch {
        return { valid: false, sanitized: '', error: 'Invalid URL format' }
      }
      break

    case 'text':
    default:
      // XSS prevention
      sanitized = sanitized
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
      break
  }

  return { valid: true, sanitized }
}

/**
 * SQL injection prevention helper (additional layer of defense)
 */
export function detectSQLInjection(input: string): boolean {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/i,
    /(--|;|\/\*|\*\/|xp_|sp_)/i,
    /('|\"|;|--|\/\*|\*\/|@@|@)/
  ]

  return sqlPatterns.some(pattern => pattern.test(input))
}
