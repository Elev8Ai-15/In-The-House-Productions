-- Add payment information to bookings
ALTER TABLE bookings ADD COLUMN total_price DECIMAL(10,2);
ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'paid', 'refunded'));
ALTER TABLE bookings ADD COLUMN stripe_session_id TEXT;
ALTER TABLE bookings ADD COLUMN stripe_payment_intent_id TEXT;

-- Notification tracking table
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  notification_type TEXT NOT NULL CHECK(notification_type IN ('email', 'sms')),
  recipient TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('client', 'provider')),
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
  sent_at DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_booking ON notifications(booking_id);
CREATE INDEX idx_notifications_status ON notifications(status, created_at);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, status);

-- DJ and Photobooth contact information table
CREATE TABLE IF NOT EXISTS provider_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT UNIQUE NOT NULL,
  provider_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  notification_preferences TEXT DEFAULT 'both' CHECK(notification_preferences IN ('email', 'sms', 'both')),
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_provider_contacts_id ON provider_contacts(provider_id);
CREATE INDEX idx_provider_contacts_active ON provider_contacts(active);

-- Insert DJ and Photobooth contact information
INSERT INTO provider_contacts (provider_id, provider_name, email, phone) VALUES
  ('dj_cease', 'DJ Cease (Mike Cecil)', 'mike@inthehouseproductions.com', '+1-727-359-4701'),
  ('dj_elev8', 'DJ Elev8 (Brad Powell)', 'brad@inthehouseproductions.com', '+1-555-123-4568'),
  ('tko_the_dj', 'TKOtheDJ (Joey Tate)', 'joey@inthehouseproductions.com', '+1-555-123-4569'),
  ('photobooth_unit1', 'Photobooth Unit 1 (Maria Cecil)', 'maria@inthehouseproductions.com', '+1-555-123-4570'),
  ('photobooth_unit2', 'Photobooth Unit 2 (Cora Scarborough)', 'cora@inthehouseproductions.com', '+1-555-123-4571');

-- Booking time slots table (for DJ double-booking logic)
CREATE TABLE IF NOT EXISTS booking_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  slot_type TEXT NOT NULL CHECK(slot_type IN ('morning', 'evening', 'full_day')),
  actual_start_time TIME NOT NULL,
  actual_end_time TIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE INDEX idx_booking_time_slots_booking ON booking_time_slots(booking_id);
CREATE INDEX idx_booking_time_slots_type ON booking_time_slots(slot_type);
