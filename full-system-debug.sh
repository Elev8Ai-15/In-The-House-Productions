#!/bin/bash

echo "=================================="
echo "FULL SYSTEM DEBUG & CALIBRATION"
echo "=================================="
echo ""

echo "📊 STEP 1: SERVICE STATUS"
echo "------------------------"
pm2 list
echo ""

echo "📦 STEP 2: BUILD STATUS"
echo "------------------------"
ls -lh dist/_worker.js 2>/dev/null || echo "❌ Build missing"
echo ""

echo "🗄️ STEP 3: DATABASE INTEGRITY"
echo "------------------------"
echo "Tables:"
npx wrangler d1 execute webapp-production --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
echo ""
echo "Row counts:"
npx wrangler d1 execute webapp-production --local --command="SELECT 'users' as table_name, COUNT(*) as count FROM users UNION ALL SELECT 'bookings', COUNT(*) FROM bookings UNION ALL SELECT 'provider_contacts', COUNT(*) FROM provider_contacts;"
echo ""

echo "🔍 STEP 4: CODE QUALITY SCAN"
echo "------------------------"
echo "Checking for common issues..."
grep -n "alert(" src/index.tsx | head -5 || echo "✅ No raw alerts found"
grep -n "confirm(" src/index.tsx | head -5 || echo "✅ No raw confirms found"
grep -n "console.error" src/index.tsx | wc -l | xargs -I {} echo "Console errors: {}"
grep -n "TODO\|FIXME\|HACK" src/index.tsx | wc -l | xargs -I {} echo "Code TODOs: {}"
echo ""

echo "🌐 STEP 5: ENDPOINT VALIDATION"
echo "------------------------"
declare -a endpoints=(
  "/"
  "/dj-services"
  "/photobooth"
  "/calendar"
  "/admin"
  "/api/health"
  "/api/admin/stats"
  "/api/admin/bookings"
  "/api/admin/providers"
)

for endpoint in "${endpoints[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${endpoint}")
  if [ "$status" = "200" ]; then
    echo "✅ ${endpoint} - ${status}"
  else
    echo "❌ ${endpoint} - ${status}"
  fi
done
echo ""

echo "🔐 STEP 6: ENVIRONMENT VARIABLES"
echo "------------------------"
grep -E "^[A-Z_]+=" .dev.vars | sed 's/=.*/=***/' | head -10
echo ""

echo "📝 STEP 7: RECENT ERRORS (Last 50 lines)"
echo "------------------------"
pm2 logs webapp --nostream --lines 50 | grep -i "error\|failed\|exception" || echo "✅ No recent errors"
echo ""

echo "🔧 STEP 8: DEPENDENCY CHECK"
echo "------------------------"
node -v
npm -v
npx wrangler --version
echo ""

echo "📂 STEP 9: FILE STRUCTURE"
echo "------------------------"
echo "Source files:"
find src -type f -name "*.tsx" -o -name "*.ts" | wc -l | xargs -I {} echo "TypeScript files: {}"
echo "Public assets:"
ls -1 public/ 2>/dev/null | wc -l | xargs -I {} echo "Static files: {}"
echo "Migrations:"
ls -1 migrations/*.sql 2>/dev/null | wc -l | xargs -I {} echo "Migration files: {}"
echo ""

echo "🎯 STEP 10: CRITICAL FUNCTIONS CHECK"
echo "------------------------"
grep -n "sendBookingNotifications" src/index.tsx | head -2
grep -n "showAlert\|showConfirm\|showSuccess\|showError" src/index.tsx | head -5
echo ""

echo "=================================="
echo "✅ SYSTEM DEBUG COMPLETE"
echo "=================================="
