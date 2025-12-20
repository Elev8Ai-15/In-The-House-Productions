-- Update photobooth operator phone numbers
-- Maria Cecil: 727-359-4808
-- Cora Scarborough: 727-495-1100

UPDATE provider_contacts 
SET phone = '+17273594808'
WHERE provider_id = 'photobooth_unit1';

UPDATE provider_contacts 
SET phone = '+17274951100'
WHERE provider_id = 'photobooth_unit2';
