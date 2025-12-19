-- Update provider phone numbers with real contact information

-- DJ Cease (Mike Cecil) - Real phone: 727-359-4701
UPDATE provider_contacts 
SET phone = '+17273594701', email = 'mike@inthehouseproductions.com'
WHERE provider_id = 'dj_cease';

-- TKOtheDJ (Joey Tate) - Real phone: (352) 801-5099
UPDATE provider_contacts 
SET phone = '+13528015099', email = 'joey@inthehouseproductions.com'
WHERE provider_id = 'tko_the_dj';

-- Keep fallback number for other providers until specified
-- DJ Elev8, Photobooth units still use +1-816-217-1094
