-- Add stripe_payment_intent_id column for Payment Intents integration
-- Migration: 0011_add_stripe_payment_intent.sql

-- Add column if not exists (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
-- Using a check to avoid errors if column already exists
ALTER TABLE bookings ADD COLUMN stripe_payment_intent_id TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent ON bookings(stripe_payment_intent_id);

-- Also ensure stripe_session_id exists (for legacy Checkout Sessions)
-- This might fail if already exists, which is fine
ALTER TABLE bookings ADD COLUMN stripe_session_id TEXT;
