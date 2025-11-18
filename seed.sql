-- Seed data for testing In The House Productions

-- Test client users
INSERT OR IGNORE INTO users (id, full_name, email, phone, password_hash, role)
VALUES 
  (2, 'John Johnson', 'john@example.com', '+1-555-123-4567', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'client'),
  (3, 'Sarah Miller', 'sarah@example.com', '+1-555-234-5678', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'client'),
  (4, 'Mike Anderson', 'mike@example.com', '+1-555-345-6789', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'client');

-- Test bookings
INSERT OR IGNORE INTO bookings (id, user_id, service_type, service_provider, event_date, event_start_time, event_end_time, status, user_preferred_dj)
VALUES 
  (1, 2, 'dj', 'dj_cease', '2025-12-15', '18:00:00', '23:00:00', 'confirmed', 'dj_cease'),
  (2, 3, 'photobooth', 'photobooth_1', '2025-12-20', '19:00:00', '23:00:00', 'confirmed', NULL),
  (3, 4, 'dj', 'dj_elev8', '2025-12-25', '17:00:00', '22:00:00', 'pending', 'dj_elev8');

-- Test event details
INSERT OR IGNORE INTO event_details (id, booking_id, event_name, event_type, street_address, city, state, zip_code, number_of_guests, special_requests, music_preferences)
VALUES 
  (1, 1, 'Johnson Wedding', 'Wedding', '123 Main Street', 'Springfield', 'IL', '62701', 150, 'First dance: Endless Love by Diana Ross', '80s classics, Top 40, some country'),
  (2, 2, 'Miller Birthday Bash', 'Birthday Party', '456 Oak Avenue', 'Chicago', 'IL', '60601', 75, 'Fun props for photos', 'Top 40, Pop'),
  (3, 3, 'Anderson Anniversary', 'Anniversary', '789 Pine Road', 'Naperville', 'IL', '60540', 100, 'Special lighting requested', 'Classic rock, oldies');

-- Wedding details for wedding booking
INSERT OR IGNORE INTO wedding_details (id, event_detail_id, bride_name, groom_name)
VALUES 
  (1, 1, 'Sarah Smith', 'John Johnson');

-- Bridal party members
INSERT OR IGNORE INTO bridal_party (wedding_detail_id, name, role)
VALUES 
  (1, 'Emily Johnson', 'Maid of Honor'),
  (1, 'Jessica Brown', 'Bridesmaid'),
  (1, 'David Smith', 'Best Man'),
  (1, 'Michael Wilson', 'Groomsman');

-- VIP family members
INSERT OR IGNORE INTO vip_family (event_detail_id, name, relationship)
VALUES 
  (1, 'Robert Johnson', 'Father of Groom'),
  (1, 'Mary Johnson', 'Mother of Groom'),
  (1, 'James Smith', 'Father of Bride'),
  (1, 'Patricia Smith', 'Mother of Bride');

-- Sample availability blocks (DJ Cease vacation)
INSERT OR IGNORE INTO availability_blocks (service_provider, block_date, reason, created_by)
VALUES 
  ('dj_cease', '2025-12-24', 'Christmas Holiday', 1),
  ('dj_cease', '2025-12-31', 'New Years Eve - Personal', 1),
  ('dj_elev8', '2025-11-28', 'Thanksgiving Holiday', 1);
