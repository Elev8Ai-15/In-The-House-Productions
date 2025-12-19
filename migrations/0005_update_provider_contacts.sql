-- Update provider contact information with real phone numbers and emails

-- DJ Cease (Mike Cecil) - Real phone number provided
UPDATE provider_contacts 
SET phone = '+1-727-359-4701', email = 'mike@inthehouseproductions.com'
WHERE provider_id = 'dj_cease';

-- DJ Elev8 (Brad Powell) - Need real contact
UPDATE provider_contacts 
SET phone = '+1-816-217-1094', email = 'brad@inthehouseproductions.com'
WHERE provider_id = 'dj_elev8';

-- TKOtheDJ (Joey Tate) - Need real contact  
UPDATE provider_contacts 
SET phone = '+1-816-217-1094', email = 'joey@inthehouseproductions.com'
WHERE provider_id = 'tko_the_dj';

-- Photobooth Unit 1 (Maria Cecil) - Need real contact
UPDATE provider_contacts 
SET phone = '+1-816-217-1094', email = 'maria@inthehouseproductions.com'
WHERE provider_id = 'photobooth_unit1';

-- Photobooth Unit 2 (Cora Scarborough) - Need real contact
UPDATE provider_contacts 
SET phone = '+1-816-217-1094', email = 'cora@inthehouseproductions.com'
WHERE provider_id = 'photobooth_unit2';

-- Note: Using 816-217-1094 as fallback for providers without specified numbers
-- Update these with actual provider phone numbers when available
