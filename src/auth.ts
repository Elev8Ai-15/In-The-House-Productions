// Authentication utilities using Web Crypto API (native to Cloudflare Workers)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Simple password hashing using Web Crypto API
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordBuffer = encoder.encode(password)
  
  // Import password as key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  )
  
  // Derive hash using PBKDF2 (reduced iterations for better performance)
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 10000, // Reduced from 100000 for better performance
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  )
  
  // Combine salt and hash
  const hashArray = new Uint8Array(hashBuffer)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)
  
  // Convert to base64
  return btoa(String.fromCharCode(...combined))
}

// Verify password against hash
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    // Decode the hash
    const combined = Uint8Array.from(atob(hash), c => c.charCodeAt(0))
    const salt = combined.slice(0, 16)
    const storedHash = combined.slice(16)
    
    const passwordBuffer = encoder.encode(password)
    
    // Import password as key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    )
    
    // Derive hash using same salt (matching reduced iterations)
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000, // Matching the hash function
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    )
    
    const newHash = new Uint8Array(hashBuffer)
    
    // Compare hashes
    if (newHash.length !== storedHash.length) return false
    
    let match = true
    for (let i = 0; i < newHash.length; i++) {
      if (newHash[i] !== storedHash[i]) {
        match = false
      }
    }
    
    return match
  } catch (error) {
    return false
  }
}

// Simple JWT token creation using Web Crypto API
export async function createToken(payload: any, secret: string, expiresIn: number = 86400): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }
  
  const now = Math.floor(Date.now() / 1000)
  const jwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn
  }
  
  // Encode header and payload
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const encodedPayload = btoa(JSON.stringify(jwtPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  
  const data = `${encodedHeader}.${encodedPayload}`
  
  // Create signature
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
  
  return `${data}.${encodedSignature}`
}

// Helper to add proper base64 padding
function addBase64Padding(str: string): string {
  const pad = str.length % 4
  if (pad === 2) return str + '=='
  if (pad === 3) return str + '='
  return str
}

// Verify JWT token
export async function verifyToken(token: string, secret: string): Promise<any> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid token format')
    }
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const data = `${encodedHeader}.${encodedPayload}`
    
    // Verify signature
    const keyData = encoder.encode(secret)
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    
    // Properly decode base64url to base64 and add correct padding
    const base64Signature = addBase64Padding(
      encodedSignature.replace(/-/g, '+').replace(/_/g, '/')
    )
    const signature = Uint8Array.from(
      atob(base64Signature),
      c => c.charCodeAt(0)
    )
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(data)
    )
    
    if (!isValid) {
      throw new Error('Invalid signature')
    }
    
    // Decode payload with proper padding
    const base64Payload = addBase64Padding(
      encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    )
    const payload = JSON.parse(atob(base64Payload))
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      throw new Error('Token expired')
    }
    
    return payload
  } catch (error) {
    throw new Error('Invalid token')
  }
}

// Validate email format
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// Validate phone format (US format)
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^\+?1?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})$/
  return phoneRegex.test(phone)
}

// Validate password strength
export function isValidPassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' }
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' }
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' }
  }
  
  return { valid: true, message: 'Password is valid' }
}

// Sanitize input to prevent XSS
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}
