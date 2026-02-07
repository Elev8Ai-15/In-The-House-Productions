-- Migration: Security Enhancements
-- Adds password reset tokens, email verification, and rate limiting support

-- Password reset columns
ALTER TABLE users ADD COLUMN reset_token TEXT;
ALTER TABLE users ADD COLUMN reset_token_expires TEXT;

-- Email verification columns
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verification_token TEXT;
ALTER TABLE users ADD COLUMN email_verification_expires TEXT;

-- D1-based rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  reset_time INTEGER NOT NULL,
  lockout_until INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  failure_reset INTEGER DEFAULT 0
);

-- Index for rate limit cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_time);
