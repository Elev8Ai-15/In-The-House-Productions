-- Drop old booking_time_slots table and recreate with correct schema
DROP TABLE IF EXISTS booking_time_slots;

CREATE TABLE booking_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  service_provider TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE INDEX idx_booking_time_slots_booking ON booking_time_slots(booking_id);
CREATE INDEX idx_booking_time_slots_provider_date ON booking_time_slots(service_provider, event_date, status);
CREATE INDEX idx_booking_time_slots_date ON booking_time_slots(event_date, status);
