// Authentication Middleware

// Get JWT Secret consistently
export function getJWTSecret(env: any): string {
  const secret = env?.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured')
  }
  return secret
}
