-- Drop unused tables that were created but never implemented
-- These tables were part of initial schema but not used in the booking system

DROP TABLE IF EXISTS vip_family;
DROP TABLE IF EXISTS bridal_party;
DROP TABLE IF EXISTS wedding_details;
DROP TABLE IF EXISTS service_interest;

-- Note: Keeping these essential tables:
-- - users (authentication)
-- - bookings (core booking data)
-- - event_details (event information)
-- - availability_blocks (manual date blocking)
-- - notifications (email/SMS tracking)
-- - provider_contacts (DJ/Photobooth contact info)
-- - booking_time_slots (DJ double-booking logic)
