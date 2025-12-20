#!/bin/bash

echo "═══════════════════════════════════════════════════════════"
echo "🔍 COMPREHENSIVE DEBUG SCAN - In The House Productions"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "1️⃣ SERVICE STATUS"
echo "─────────────────────────────────────────────────────────"
pm2 list | tail -5
curl -s http://localhost:3000/api/health || echo "❌ Health check failed"
echo ""

echo "2️⃣ ENDPOINT TESTS"
echo "─────────────────────────────────────────────────────────"
for endpoint in "/" "/dj-services" "/photobooth" "/calendar" "/admin" "/contact" "/about" "/register" "/login"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000$endpoint)
  if [ "$status" = "200" ]; then
    echo "✅ $endpoint → $status"
  else
    echo "❌ $endpoint → $status"
  fi
done
echo ""

echo "3️⃣ API ENDPOINTS"
echo "─────────────────────────────────────────────────────────"
for api in "/api/health" "/api/admin/stats" "/api/admin/bookings" "/api/admin/providers"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000$api)
  if [ "$status" = "200" ]; then
    echo "✅ $api → $status"
  else
    echo "❌ $api → $status"
  fi
done
echo ""

echo "4️⃣ DATABASE TABLES"
echo "─────────────────────────────────────────────────────────"
npx wrangler d1 execute webapp-production --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" 2>/dev/null | grep -A 20 '"name"' | grep '"name"' | head -10
echo ""

echo "5️⃣ DATABASE COUNTS"
echo "─────────────────────────────────────────────────────────"
echo "Bookings: $(npx wrangler d1 execute webapp-production --local --command='SELECT COUNT(*) as count FROM bookings' 2>/dev/null | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)"
echo "Users: $(npx wrangler d1 execute webapp-production --local --command='SELECT COUNT(*) as count FROM users' 2>/dev/null | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)"
echo "Providers: $(npx wrangler d1 execute webapp-production --local --command='SELECT COUNT(*) as count FROM provider_contacts' 2>/dev/null | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)"
echo ""

echo "6️⃣ RECENT ERRORS (Last 20 lines)"
echo "─────────────────────────────────────────────────────────"
pm2 logs webapp --nostream --err --lines 20 2>/dev/null | grep -i "error\|fail" | tail -10
echo ""

echo "7️⃣ ENVIRONMENT VARIABLES"
echo "─────────────────────────────────────────────────────────"
echo "JWT_SECRET: $(grep JWT_SECRET .dev.vars | cut -d= -f1)"
echo "STRIPE_SECRET_KEY: $(grep STRIPE_SECRET_KEY .dev.vars | cut -d= -f1)"
echo "RESEND_API_KEY: $(grep RESEND_API_KEY .dev.vars | cut -d= -f1)"
echo "TWILIO_ACCOUNT_SID: $(grep TWILIO_ACCOUNT_SID .dev.vars | cut -d= -f1)"
echo "TWILIO_AUTH_TOKEN: $(grep TWILIO_AUTH_TOKEN .dev.vars | cut -d= -f1)"
echo "TWILIO_PHONE_NUMBER: $(grep TWILIO_PHONE_NUMBER .dev.vars | cut -d= -f1)"
echo ""

echo "8️⃣ BUILD STATUS"
echo "─────────────────────────────────────────────────────────"
ls -lh dist/_worker.js 2>/dev/null || echo "❌ Build not found"
echo ""

echo "9️⃣ GIT STATUS"
echo "─────────────────────────────────────────────────────────"
git log --oneline -3
git status --short
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ DEBUG SCAN COMPLETE"
echo "═══════════════════════════════════════════════════════════"
