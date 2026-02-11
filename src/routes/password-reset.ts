// Password Reset Flow
// POST /api/auth/forgot-password - Request password reset email
// POST /api/auth/reset-password - Reset password with token

import { Hono } from 'hono'
import { hashPassword, isValidEmail, isValidPassword } from '../auth'
import type { Bindings } from '../types'

const passwordReset = new Hono<{ Bindings: Bindings }>()

// Generate a secure random reset token
function generateResetToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// Request password reset
passwordReset.post('/api/auth/forgot-password', async (c) => {
  const { DB, RESEND_API_KEY } = c.env

  try {
    const { email } = await c.req.json()

    if (!email || !isValidEmail(email)) {
      return c.json({ error: 'Valid email address is required' }, 400)
    }

    const cleanEmail = email.toLowerCase().trim()

    // Always return success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    }

    // Find user
    const user: any = await DB.prepare(
      'SELECT id, full_name, email FROM users WHERE email = ?'
    ).bind(cleanEmail).first()

    if (!user) {
      return c.json(successResponse)
    }

    // Generate reset token with 1-hour expiry
    const resetToken = generateResetToken()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    // Store reset token in users table (add column if needed)
    try {
      await DB.prepare(`
        UPDATE users SET 
          reset_token = ?,
          reset_token_expires = ?
        WHERE id = ?
      `).bind(resetToken, expiresAt, user.id).run()
    } catch {
      // Column might not exist yet - create it
      await DB.prepare('ALTER TABLE users ADD COLUMN reset_token TEXT').run().catch(() => {})
      await DB.prepare('ALTER TABLE users ADD COLUMN reset_token_expires TEXT').run().catch(() => {})
      await DB.prepare(`
        UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?
      `).bind(resetToken, expiresAt, user.id).run()
    }

    // Send reset email
    const isDev = !RESEND_API_KEY || RESEND_API_KEY.includes('mock')
    const baseUrl = new URL(c.req.url).origin
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`

    if (isDev) {
      console.log(`[DEV] Password reset for ${cleanEmail}: ${resetUrl}`)
    } else {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'In The House Productions <noreply@inthehouseproductions.com>',
          to: cleanEmail,
          subject: 'Password Reset Request - In The House Productions',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
              <h1 style="color: #E31E24; text-align: center;">Password Reset</h1>
              <p style="color: #C0C0C0;">Hi ${user.full_name},</p>
              <p style="color: #C0C0C0; line-height: 1.8;">
                We received a request to reset your password. Click the button below to set a new password.
                This link expires in 1 hour.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #E31E24, #FF0040); color: white; padding: 15px 40px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 16px;">
                  RESET PASSWORD
                </a>
              </div>
              <p style="color: #888; font-size: 13px;">
                If you didn't request this, please ignore this email. Your password will remain unchanged.
              </p>
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
                <p style="color: #666; font-size: 12px;">In The House Productions | (816) 217-1094</p>
              </div>
            </div>
          `
        })
      })
      if (!emailRes.ok) {
        console.error('Password reset email failed:', emailRes.status, await emailRes.text().catch(() => ''))
      }
    }

    return c.json(successResponse)
  } catch (error: any) {
    console.error('Password reset request error:', error)
    return c.json({ error: 'Failed to process password reset request' }, 500)
  }
})

// Reset password with token
passwordReset.post('/api/auth/reset-password', async (c) => {
  const { DB } = c.env

  try {
    const { email, token, new_password } = await c.req.json()

    if (!email || !token || !new_password) {
      return c.json({ error: 'Email, token, and new password are required' }, 400)
    }

    const passwordValidation = isValidPassword(new_password)
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.message }, 400)
    }

    const cleanEmail = email.toLowerCase().trim()

    // Find user with matching token
    const user: any = await DB.prepare(`
      SELECT id, reset_token, reset_token_expires FROM users 
      WHERE email = ? AND reset_token = ?
    `).bind(cleanEmail, token).first()

    if (!user) {
      return c.json({ error: 'Invalid or expired reset token' }, 400)
    }

    // Check expiry
    if (user.reset_token_expires && new Date(user.reset_token_expires) < new Date()) {
      return c.json({ error: 'Reset token has expired. Please request a new one.' }, 400)
    }

    // Hash new password and clear token
    const passwordHash = await hashPassword(new_password)
    await DB.prepare(`
      UPDATE users SET 
        password_hash = ?,
        reset_token = NULL,
        reset_token_expires = NULL
      WHERE id = ?
    `).bind(passwordHash, user.id).run()

    return c.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    })
  } catch (error: any) {
    console.error('Password reset error:', error)
    return c.json({ error: 'Failed to reset password' }, 500)
  }
})

export default passwordReset
