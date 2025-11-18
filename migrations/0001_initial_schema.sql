-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'client' CHECK(role IN ('client', 'admin')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('dj', 'photobooth')),
  service_provider TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_start_time TIME NOT NULL,
  event_end_time TIME NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  user_preferred_dj TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_bookings_date ON bookings(event_date);
CREATE INDEX idx_bookings_provider ON bookings(service_provider, event_date);
CREATE INDEX idx_bookings_user ON bookings(user_id, status, event_date);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Event Details Table
CREATE TABLE IF NOT EXISTS event_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  street_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  number_of_guests INTEGER,
  special_requests TEXT,
  music_preferences TEXT,
  do_not_play_list TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE INDEX idx_event_details_booking ON event_details(booking_id);
CREATE INDEX idx_event_details_type ON event_details(event_type);

-- Wedding Details Table (for wedding-specific information)
CREATE TABLE IF NOT EXISTS wedding_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_detail_id INTEGER UNIQUE NOT NULL,
  bride_name TEXT,
  groom_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_detail_id) REFERENCES event_details(id) ON DELETE CASCADE
);

CREATE INDEX idx_wedding_details_event ON wedding_details(event_detail_id);

-- Bridal Party Table
CREATE TABLE IF NOT EXISTS bridal_party (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wedding_detail_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  FOREIGN KEY (wedding_detail_id) REFERENCES wedding_details(id) ON DELETE CASCADE
);

CREATE INDEX idx_bridal_party_wedding ON bridal_party(wedding_detail_id);

-- VIP Family Members Table
CREATE TABLE IF NOT EXISTS vip_family (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_detail_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT,
  FOREIGN KEY (event_detail_id) REFERENCES event_details(id) ON DELETE CASCADE
);

CREATE INDEX idx_vip_family_event ON vip_family(event_detail_id);

-- Provider Availability Blocks (for manual date blocking by admin)
CREATE TABLE IF NOT EXISTS availability_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_provider TEXT NOT NULL,
  block_date DATE NOT NULL,
  reason TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_availability_blocks_provider ON availability_blocks(service_provider, block_date);

-- Service Interest Tracking (for "Coming Soon" services)
CREATE TABLE IF NOT EXISTS service_interest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  notified BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_service_interest_service ON service_interest(service_id);
CREATE INDEX idx_service_interest_user ON service_interest(user_id);

-- Insert default admin user (password: Admin123!)
-- Password hash for "Admin123!" using bcrypt with salt rounds = 10
INSERT INTO users (full_name, email, phone, password_hash, role)
VALUES ('Admin User', 'admin@inthehouseproductions.com', '+1-555-000-0000', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'admin');
