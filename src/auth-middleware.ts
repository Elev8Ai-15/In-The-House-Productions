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
  // Try to get token from Authorization header first
  const authHeader = c.req.header('Authorization')
  let token = null
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
    console.log('[AUTH] Token from Authorization header')
  } else {
    // Fallback to cookie if no Authorization header
    const cookieHeader = c.req.header('Cookie')
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc: any, cookie) => {
        const [key, value] = cookie.trim().split('=')
        acc[key] = value
        return acc
      }, {})
      token = cookies['authToken']
      if (token) {
        console.log('[AUTH] Token from cookie')
      }
    }
  }
  
  if (!token) {
    console.error('[AUTH] No token provided (checked header and cookies)')
    return c.json({ error: 'Authentication required' }, 401)
  }
  
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
