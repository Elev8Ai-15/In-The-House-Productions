-- Update DJ Elev8 phone number to correct number
UPDATE provider_contacts 
SET phone = '+18162171094', 
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id = 'dj_elev8';
