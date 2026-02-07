// Booking Cancellation & Refund Flow
// POST /api/bookings/:id/cancel - Cancel a booking
// POST /api/bookings/:id/refund - Process refund (admin)
// GET /api/bookings/my-bookings - Get user's bookings

import { Hono } from 'hono'
import { verifyToken } from '../auth'
import { getJWTSecret } from '../auth-middleware'
import type { Bindings } from '../types'
import Stripe from 'stripe'

const cancellation = new Hono<{ Bindings: Bindings }>()

// Get user's bookings
cancellation.get('/api/bookings/my-bookings', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    const { DB } = c.env

    const bookings = await DB.prepare(`
      SELECT 
        b.id, b.service_type, b.service_provider, b.event_date,
        b.event_start_time, b.event_end_time, b.total_price,
        b.payment_status, b.status, b.created_at,
        e.event_name, e.event_type, e.street_address, e.city, e.state
      FROM bookings b
      LEFT JOIN event_details e ON b.id = e.booking_id
      WHERE b.user_id = ?
      ORDER BY b.event_date DESC
    `).bind(payload.userId).all()

    return c.json({ success: true, bookings: bookings.results })
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch bookings' }, 500)
  }
})

// Cancel a booking (by user or admin)
cancellation.post('/api/bookings/:id/cancel', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    const bookingId = c.req.param('id')
    const { reason } = await c.req.json().catch(() => ({ reason: '' }))
    const { DB } = c.env

    // Get booking
    const booking: any = await DB.prepare(`
      SELECT b.*, u.email as user_email, u.full_name as user_name
      FROM bookings b JOIN users u ON b.user_id = u.id
      WHERE b.id = ?
    `).bind(bookingId).first()

    if (!booking) {
      return c.json({ error: 'Booking not found' }, 404)
    }

    // Check authorization (user can cancel own bookings, admin can cancel any)
    if (payload.role !== 'admin' && booking.user_id !== payload.userId) {
      return c.json({ error: 'Not authorized to cancel this booking' }, 403)
    }

    // Check if already cancelled
    if (booking.status === 'cancelled') {
      return c.json({ error: 'Booking is already cancelled' }, 400)
    }

    // Check cancellation policy: must be at least 48 hours before event
    const eventDate = new Date(booking.event_date + 'T' + (booking.event_start_time || '00:00'))
    const now = new Date()
    const hoursUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60)

    let refundEligible = false
    let refundPercentage = 0

    if (hoursUntilEvent > 168) { // 7+ days: full refund
      refundEligible = true
      refundPercentage = 100
    } else if (hoursUntilEvent > 48) { // 2-7 days: 50% refund
      refundEligible = true
      refundPercentage = 50
    } else if (hoursUntilEvent > 0) { // Less than 48 hours: no refund
      refundEligible = false
      refundPercentage = 0
    }
    // Admin override - always allow full refund
    if (payload.role === 'admin') {
      refundEligible = true
      refundPercentage = 100
    }

    // Cancel the booking
    await DB.prepare(`
      UPDATE bookings SET 
        status = 'cancelled',
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(bookingId).run()

    // Cancel time slots
    await DB.prepare(`
      UPDATE booking_time_slots SET status = 'cancelled' WHERE booking_id = ?
    `).bind(bookingId).run()

    // Update invoice if exists
    await DB.prepare(`
      UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE booking_id = ?
    `).bind(bookingId).run()

    // Send cancellation notification
    const RESEND_API_KEY = c.env.RESEND_API_KEY
    if (RESEND_API_KEY && !RESEND_API_KEY.includes('mock')) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'In The House Productions <noreply@inthehouseproductions.com>',
          to: [booking.user_email, 'mcecil38@yahoo.com'],
          subject: `Booking Cancelled - ${booking.event_date}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
              <h1 style="color: #E31E24; text-align: center;">Booking Cancelled</h1>
              <p style="color: #C0C0C0;">Booking #${bookingId} for ${booking.event_date} has been cancelled.</p>
              ${reason ? `<p style="color: #C0C0C0;"><strong>Reason:</strong> ${reason}</p>` : ''}
              ${refundEligible ? `
                <div style="background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; border-radius: 10px; padding: 15px; margin: 15px 0;">
                  <p style="color: #22c55e; font-weight: bold;">Refund Eligible: ${refundPercentage}%</p>
                  <p style="color: #C0C0C0;">Estimated refund: $${((booking.total_price || 0) * refundPercentage / 100).toFixed(2)}</p>
                </div>
              ` : `
                <div style="background: rgba(227, 30, 36, 0.15); border: 1px solid #E31E24; border-radius: 10px; padding: 15px; margin: 15px 0;">
                  <p style="color: #E31E24;">Cancelled within 48 hours of event. No refund eligible per cancellation policy.</p>
                </div>
              `}
              <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #333;">
                <p style="color: #666; font-size: 12px;">In The House Productions | (816) 217-1094</p>
              </div>
            </div>
          `
        })
      })
    }

    return c.json({
      success: true,
      message: 'Booking cancelled successfully',
      refundEligible,
      refundPercentage,
      estimatedRefund: refundEligible ? (booking.total_price || 0) * refundPercentage / 100 : 0
    })
  } catch (error: any) {
    console.error('Cancellation error:', error)
    return c.json({ error: 'Failed to cancel booking' }, 500)
  }
})

// Process refund (admin only)
cancellation.post('/api/bookings/:id/refund', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))

    if (payload.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403)
    }

    const bookingId = c.req.param('id')
    const { amount, reason } = await c.req.json()
    const { DB, STRIPE_SECRET_KEY } = c.env

    const booking: any = await DB.prepare(
      'SELECT * FROM bookings WHERE id = ?'
    ).bind(bookingId).first()

    if (!booking) {
      return c.json({ error: 'Booking not found' }, 404)
    }

    // If Stripe payment exists, process refund through Stripe
    if (booking.stripe_payment_intent_id && STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.includes('mock')) {
      const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' as any })
      
      const refundAmount = amount ? Math.round(amount * 100) : Math.round((booking.total_price || 0) * 100)
      
      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: refundAmount,
        reason: 'requested_by_customer'
      })

      // Update booking
      await DB.prepare(`
        UPDATE bookings SET 
          payment_status = 'refunded',
          status = 'cancelled',
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(bookingId).run()

      // Update invoice
      await DB.prepare(`
        UPDATE invoices SET status = 'refunded', updated_at = datetime('now') WHERE booking_id = ?
      `).bind(bookingId).run()

      return c.json({
        success: true,
        message: 'Refund processed successfully',
        refundId: refund.id,
        refundAmount: refundAmount / 100
      })
    }

    // Mock refund for development
    await DB.prepare(`
      UPDATE bookings SET payment_status = 'refunded', status = 'cancelled', updated_at = datetime('now') WHERE id = ?
    `).bind(bookingId).run()

    await DB.prepare(`
      UPDATE invoices SET status = 'refunded', updated_at = datetime('now') WHERE booking_id = ?
    `).bind(bookingId).run()

    return c.json({
      success: true,
      message: 'Refund marked (development mode)',
      refundAmount: amount || booking.total_price || 0
    })
  } catch (error: any) {
    console.error('Refund error:', error)
    return c.json({ error: 'Failed to process refund' }, 500)
  }
})

export default cancellation
