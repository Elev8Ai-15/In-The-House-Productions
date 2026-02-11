// Email Verification Flow
// POST /api/auth/verify-email - Verify email with token
// POST /api/auth/resend-verification - Resend verification email

import { Hono } from 'hono'
import { verifyToken } from '../auth'
import { getJWTSecret } from '../auth-middleware'
import type { Bindings } from '../types'

const emailVerification = new Hono<{ Bindings: Bindings }>()

// Generate verification token
function generateVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// Helper: Send verification email
async function sendVerificationEmail(env: any, user: any, baseUrl: string): Promise<boolean> {
  const { DB, RESEND_API_KEY } = env
  const isDev = !RESEND_API_KEY || RESEND_API_KEY.includes('mock')

  const token = generateVerificationToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours

  // Store verification token
  try {
    await DB.prepare(`
      UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ?
    `).bind(token, expiresAt, user.id).run()
  } catch {
    // Add columns if they don't exist
    await DB.prepare('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0').run().catch(() => {})
    await DB.prepare('ALTER TABLE users ADD COLUMN email_verification_token TEXT').run().catch(() => {})
    await DB.prepare('ALTER TABLE users ADD COLUMN email_verification_expires TEXT').run().catch(() => {})
    await DB.prepare(`
      UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ?
    `).bind(token, expiresAt, user.id).run()
  }

  const verifyUrl = `${baseUrl}/verify-email?token=${token}&email=${encodeURIComponent(user.email)}`

  if (isDev) {
    console.log(`[DEV] Email verification for ${user.email}: ${verifyUrl}`)
    return true
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: user.email,
        subject: 'Verify Your Email - In The House Productions',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
            <h1 style="color: #E31E24; text-align: center;">Verify Your Email</h1>
            <p style="color: #C0C0C0;">Hi ${user.full_name},</p>
            <p style="color: #C0C0C0; line-height: 1.8;">
              Welcome to In The House Productions! Please verify your email to complete your registration.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; padding: 15px 40px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 16px;">
                VERIFY EMAIL
              </a>
            </div>
            <p style="color: #888; font-size: 13px;">This link expires in 24 hours.</p>
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
              <p style="color: #666; font-size: 12px;">In The House Productions | (816) 217-1094</p>
            </div>
          </div>
        `
      })
    })
    if (!emailRes.ok) {
      console.error('Verification email failed:', emailRes.status, await emailRes.text().catch(() => ''))
      return false
    }
    return true
  } catch {
    return false
  }
}

// Verify email with token
emailVerification.post('/api/auth/verify-email', async (c) => {
  const { DB } = c.env

  try {
    const { email, token } = await c.req.json()

    if (!email || !token) {
      return c.json({ error: 'Email and verification token are required' }, 400)
    }

    const cleanEmail = email.toLowerCase().trim()

    const user: any = await DB.prepare(`
      SELECT id, email_verification_token, email_verification_expires, email_verified
      FROM users WHERE email = ?
    `).bind(cleanEmail).first()

    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    if (user.email_verified === 1) {
      return c.json({ success: true, message: 'Email already verified' })
    }

    if (user.email_verification_token !== token) {
      return c.json({ error: 'Invalid verification token' }, 400)
    }

    if (user.email_verification_expires && new Date(user.email_verification_expires) < new Date()) {
      return c.json({ error: 'Verification token has expired. Please request a new one.' }, 400)
    }

    // Mark email as verified
    await DB.prepare(`
      UPDATE users SET 
        email_verified = 1, 
        email_verification_token = NULL, 
        email_verification_expires = NULL 
      WHERE id = ?
    `).bind(user.id).run()

    return c.json({ success: true, message: 'Email verified successfully!' })
  } catch (error: any) {
    console.error('Email verification error:', error)
    return c.json({ error: 'Verification failed' }, 500)
  }
})

// Resend verification email
emailVerification.post('/api/auth/resend-verification', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))

    const user: any = await c.env.DB.prepare(
      'SELECT id, full_name, email, email_verified FROM users WHERE id = ?'
    ).bind(payload.userId).first()

    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    if (user.email_verified === 1) {
      return c.json({ success: true, message: 'Email already verified' })
    }

    const baseUrl = new URL(c.req.url).origin
    await sendVerificationEmail(c.env, user, baseUrl)

    return c.json({ success: true, message: 'Verification email resent' })
  } catch (error: any) {
    console.error('Resend verification error:', error)
    return c.json({ error: 'Failed to resend verification email' }, 500)
  }
})

export { sendVerificationEmail }
export default emailVerification
