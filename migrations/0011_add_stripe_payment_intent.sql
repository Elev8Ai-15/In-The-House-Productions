-- Add stripe_payment_intent_id column for Payment Intents integration
-- Migration: 0011_add_stripe_payment_intent.sql
-- Note: Columns may already exist from previous manual schema updates

-- Create index for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent ON bookings(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session_id ON bookings(stripe_session_id);

-- Mark migration as applied (columns already exist in schema)
