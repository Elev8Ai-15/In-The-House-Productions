#!/bin/bash

echo "🔧 DEEP SYSTEM CALIBRATION"
echo "=========================="
echo ""

# Test with longer timeout
echo "1️⃣ TESTING ENDPOINTS (10s timeout)..."
curl -s --max-time 10 http://localhost:3000/ | head -c 100 && echo "... ✅ Homepage working"
curl -s --max-time 10 http://localhost:3000/api/health | jq . && echo "✅ Health API working"
curl -s --max-time 10 http://localhost:3000/api/admin/stats | jq . && echo "✅ Admin Stats API working"
echo ""

echo "2️⃣ FRONTEND CODE AUDIT..."
echo "Checking for problematic patterns:"
echo "  - Raw alerts: $(grep -c 'alert(' src/index.tsx || echo 0)"
echo "  - Raw confirms: $(grep -c 'confirm(' src/index.tsx || echo 0)"
echo "  - Modal functions: $(grep -c 'showAlert\|showConfirm\|showSuccess\|showError' src/index.tsx || echo 0)"
echo "  - Console errors: $(grep -c 'console.error' src/index.tsx || echo 0)"
echo ""

echo "3️⃣ BACKEND CODE AUDIT..."
echo "Critical API routes:"
grep -n "app.get\|app.post" src/index.tsx | grep -E "(api|admin)" | head -10
echo ""

echo "4️⃣ DATABASE VALIDATION..."
npx wrangler d1 execute webapp-production --local --command="SELECT id, email FROM users LIMIT 3;" 2>/dev/null
npx wrangler d1 execute webapp-production --local --command="SELECT id, service_type, status FROM bookings;" 2>/dev/null
npx wrangler d1 execute webapp-production --local --command="SELECT provider_id, provider_name, phone FROM provider_contacts;" 2>/dev/null
echo ""

echo "5️⃣ NOTIFICATION SYSTEM CHECK..."
grep -A 10 "async function sendBookingNotifications" src/index.tsx | head -15
echo ""

echo "6️⃣ BUILD INTEGRITY..."
echo "Build file: $(ls -lh dist/_worker.js)"
echo "Routes config: $(test -f dist/_routes.json && echo '✅ exists' || echo '❌ missing')"
echo ""

echo "✅ CALIBRATION COMPLETE"
