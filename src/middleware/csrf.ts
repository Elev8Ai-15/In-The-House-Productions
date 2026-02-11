// CSRF Protection Middleware
// Uses Origin/Referer header validation (suitable for Cloudflare Workers)
// No cookies or server state needed - relies on browser security model

import { Context, Next } from 'hono'

/**
 * CSRF protection for state-changing requests (POST, PUT, DELETE, PATCH).
 * Validates that Origin or Referer header matches the expected host.
 * GET/HEAD/OPTIONS requests are always allowed through.
 * API calls from external webhooks (Stripe, Refersion) bypass CSRF.
 */
export async function csrfProtection(c: Context, next: Next) {
  const method = c.req.method.toUpperCase()
  
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    await next()
    return
  }

  const path = c.req.path

  // Webhook endpoints bypass CSRF (they use their own auth: signatures, API keys)
  const webhookPaths = [
    '/api/webhook/stripe',
    '/api/refersion/webhook',
  ]
  if (webhookPaths.some(wp => path.startsWith(wp))) {
    await next()
    return
  }

  // Check for CSRF token in header (set by frontend JS)
  const csrfHeader = c.req.header('X-Requested-With')
  if (csrfHeader === 'XMLHttpRequest' || csrfHeader === 'fetch') {
    // Custom header present - this is a CORS-safe request from our frontend
    await next()
    return
  }

  // Validate Origin header
  const origin = c.req.header('Origin')
  const referer = c.req.header('Referer')
  const host = c.req.header('Host')

  if (origin) {
    try {
      const originHost = new URL(origin).host
      if (originHost === host) {
        await next()
        return
      }
    } catch {}
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host
      if (refererHost === host) {
        await next()
        return
      }
    } catch {}
  }

  // For JSON API requests with correct Content-Type, the CORS preflight
  // mechanism provides protection since custom content types require preflight.
  // Combined with our CORS policy (only same-origin allowed), this is secure.
  const contentType = c.req.header('Content-Type')
  if (contentType?.includes('application/json')) {
    await next()
    return
  }

  // Allow form submissions from same origin (already checked Origin/Referer above)
  // Block cross-origin requests that bypassed all checks
  return c.json({ error: 'CSRF validation failed. Please reload the page and try again.' }, 403)
}
