// Admin Authentication Middleware
// Protects all /api/admin/* routes with JWT + role=admin verification

import { Context, Next } from 'hono'
import { verifyToken } from '../auth'
import { getJWTSecret } from '../auth-middleware'

/**
 * Middleware that verifies the request has a valid JWT token with admin role.
 * Returns 401 if no token, invalid token, or non-admin role.
 */
export async function requireAdmin(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization')
    const cookieToken = c.req.header('Cookie')?.match(/authToken=([^;]+)/)?.[1]
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken

    if (!token) {
      return c.json({ error: 'Authentication required. Please log in as admin.' }, 401)
    }

    const payload = await verifyToken(token, getJWTSecret(c.env))

    if (payload.role !== 'admin') {
      return c.json({ error: 'Admin access required. Insufficient privileges.' }, 403)
    }

    // Attach admin info to context for downstream handlers
    c.set('adminPayload', payload)
    await next()
  } catch (error: any) {
    return c.json({ error: 'Invalid or expired admin token. Please log in again.' }, 401)
  }
}

/**
 * Middleware that verifies the request has a valid JWT token (any authenticated user).
 */
export async function requireAuth(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization')
    const cookieToken = c.req.header('Cookie')?.match(/authToken=([^;]+)/)?.[1]
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken

    if (!token) {
      return c.json({ error: 'Authentication required. Please log in.' }, 401)
    }

    const payload = await verifyToken(token, getJWTSecret(c.env))
    c.set('userPayload', payload)
    await next()
  } catch (error: any) {
    return c.json({ error: 'Invalid or expired token. Please log in again.' }, 401)
  }
}
