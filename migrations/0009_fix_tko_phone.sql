-- Fix TKOtheDJ phone number
UPDATE provider_contacts 
SET phone = '+13528015099'
WHERE provider_id = 'tko_the_dj';
