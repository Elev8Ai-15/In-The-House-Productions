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
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://js.stripe.com https://cdn.refersion.com https://cdn.jsdelivr.net",
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

// NOTE: In-memory rate limiting has been replaced by D1-backed rate limiting.
// See src/middleware/d1-rate-limit.ts for the persistent implementation.
