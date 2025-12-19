#!/bin/bash
echo "================================"
echo "SYSTEM DEBUG & HEALTH CHECK"
echo "================================"
echo ""

echo "1. SERVICE STATUS"
echo "----------------"
pm2 list | grep webapp
echo ""

echo "2. BUILD INFO"
echo "-------------"
ls -lh dist/_worker.js 2>/dev/null | awk '{print "Bundle Size:", $5}'
echo ""

echo "3. DATABASE STATUS"
echo "------------------"
npx wrangler d1 execute webapp-production --local --command="
SELECT 'Users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Bookings', COUNT(*) FROM bookings
UNION ALL
SELECT 'Provider Contacts', COUNT(*) FROM provider_contacts
UNION ALL
SELECT 'Booking Time Slots', COUNT(*) FROM booking_time_slots
UNION ALL
SELECT 'Notifications', COUNT(*) FROM notifications;
" 2>&1 | grep -A 20 "results"
echo ""

echo "4. ENDPOINT TESTS"
echo "-----------------"
echo "  Homepage: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"
echo "  DJ Services: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/dj-services)"
echo "  Photobooth: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/photobooth)"
echo "  Calendar: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/calendar)"
echo "  Event Details: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/event-details)"
echo "  Register: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/register)"
echo "  Login: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)"
echo "  Contact: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/contact)"
echo "  About: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/about)"
echo "  API Health: $(curl -s http://localhost:3000/api/health | jq -r .status)"
echo ""

echo "5. PROVIDER PHONE NUMBERS"
echo "-------------------------"
npx wrangler d1 execute webapp-production --local --command="
SELECT provider_id, provider_name, phone FROM provider_contacts;
" 2>&1 | grep -A 15 "results"
echo ""

echo "6. FILE COUNTS"
echo "--------------"
echo "  Total files: $(find . -type f | wc -l)"
echo "  Code files: $(find src -name '*.tsx' -o -name '*.ts' -o -name '*.js' 2>/dev/null | wc -l)"
echo "  Migrations: $(ls migrations/*.sql 2>/dev/null | wc -l)"
echo "  Static assets: $(ls public/static/*.png 2>/dev/null | wc -l)"
echo ""

echo "7. MEMORY & PROCESS"
echo "-------------------"
pm2 show webapp | grep -E "(memory|cpu|uptime|status)"
echo ""

echo "================================"
echo "DEBUG COMPLETE"
echo "================================"
