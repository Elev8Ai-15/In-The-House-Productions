// Clean Authentication Middleware
import { Context } from 'hono'
import { verifyToken } from './auth'

// Get JWT Secret consistently
export function getJWTSecret(env: any): string {
  const secret = env?.JWT_SECRET || 'dev-secret-key-change-in-production-2025'
  console.log('[AUTH] Using JWT_SECRET:', secret.substring(0, 20) + '...')
  return secret
}

// Authentication middleware - returns authenticated user payload
export async function requireAuth(c: Context): Promise<any> {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[AUTH] No Bearer token provided')
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const token = authHeader.substring(7)
  const secret = getJWTSecret(c.env)
  
  try {
    const payload = await verifyToken(token, secret)
    console.log('[AUTH] Token valid for user:', payload.userId)
    return payload
  } catch (error: any) {
    console.error('[AUTH] Token verification failed:', error.message)
    return c.json({ error: 'Invalid or expired token. Please log in again.' }, 401)
  }
}
