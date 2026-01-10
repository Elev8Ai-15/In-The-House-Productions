#!/bin/bash

PROD_URL="https://5bf39de1.webapp-2mf.pages.dev"
TEST_RESULTS="production-test-results.md"

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                     PRODUCTION TESTING - STEP B                            ║"
echo "║                     URL: $PROD_URL                                         ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Create test results file
cat > "$TEST_RESULTS" << HEADER
# Production Testing Results
**Date**: $(date)  
**Production URL**: $PROD_URL  
**Project**: In The House Productions

---

## 🧪 Test Results

HEADER

echo "🏠 TEST 1: Homepage & Static Assets"
echo "─────────────────────────────────────────────────────────────────────────────"

# Test homepage
echo "Testing homepage..." | tee -a "$TEST_RESULTS"
HOMEPAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/")
echo "Homepage Status: $HOMEPAGE_STATUS" | tee -a "$TEST_RESULTS"

if [ "$HOMEPAGE_STATUS" = "200" ]; then
    echo "✅ Homepage loads successfully" | tee -a "$TEST_RESULTS"
else
    echo "❌ Homepage failed (Status: $HOMEPAGE_STATUS)" | tee -a "$TEST_RESULTS"
fi

# Test static assets
echo "" | tee -a "$TEST_RESULTS"
echo "Testing static assets..." | tee -a "$TEST_RESULTS"

STATIC_ASSETS=(
    "/static/hero-logo-3d-v2.png"
    "/static/dj-services-logo-3d.png"
    "/static/photobooth-logo-3d.png"
    "/static/ultra-3d.css"
    "/static/calendar.css"
)

for asset in "${STATIC_ASSETS[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PROD_URL$asset")
    if [ "$STATUS" = "200" ]; then
        echo "✅ $asset → $STATUS" | tee -a "$TEST_RESULTS"
    else
        echo "❌ $asset → $STATUS" | tee -a "$TEST_RESULTS"
    fi
done

echo "" | tee -a "$TEST_RESULTS"
echo "🎵 TEST 2: DJ Services Page"
echo "─────────────────────────────────────────────────────────────────────────────"

DJ_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/dj-services")
echo "DJ Services Status: $DJ_STATUS" | tee -a "$TEST_RESULTS"

if [ "$DJ_STATUS" = "200" ]; then
    echo "✅ DJ Services page loads" | tee -a "$TEST_RESULTS"
else
    echo "❌ DJ Services failed (Status: $DJ_STATUS)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "📸 TEST 3: Photobooth Page"
echo "─────────────────────────────────────────────────────────────────────────────"

PHOTOBOOTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/photobooth")
echo "Photobooth Status: $PHOTOBOOTH_STATUS" | tee -a "$TEST_RESULTS"

if [ "$PHOTOBOOTH_STATUS" = "200" ]; then
    echo "✅ Photobooth page loads" | tee -a "$TEST_RESULTS"
else
    echo "❌ Photobooth failed (Status: $PHOTOBOOTH_STATUS)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "📅 TEST 4: Calendar Page"
echo "─────────────────────────────────────────────────────────────────────────────"

CALENDAR_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/calendar")
echo "Calendar Status: $CALENDAR_STATUS" | tee -a "$TEST_RESULTS"

if [ "$CALENDAR_STATUS" = "200" ] || [ "$CALENDAR_STATUS" = "302" ]; then
    echo "✅ Calendar page accessible (Status: $CALENDAR_STATUS)" | tee -a "$TEST_RESULTS"
else
    echo "❌ Calendar failed (Status: $CALENDAR_STATUS)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "🔐 TEST 5: Authentication Pages"
echo "─────────────────────────────────────────────────────────────────────────────"

LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/login")
echo "Login Status: $LOGIN_STATUS" | tee -a "$TEST_RESULTS"

if [ "$LOGIN_STATUS" = "200" ]; then
    echo "✅ Login page loads" | tee -a "$TEST_RESULTS"
else
    echo "❌ Login failed (Status: $LOGIN_STATUS)" | tee -a "$TEST_RESULTS"
fi

REGISTER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/register")
echo "Register Status: $REGISTER_STATUS" | tee -a "$TEST_RESULTS"

if [ "$REGISTER_STATUS" = "200" ]; then
    echo "✅ Register page loads" | tee -a "$TEST_RESULTS"
else
    echo "❌ Register failed (Status: $REGISTER_STATUS)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "👨‍💼 TEST 6: Admin Dashboard"
echo "─────────────────────────────────────────────────────────────────────────────"

ADMIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/admin")
echo "Admin Status: $ADMIN_STATUS" | tee -a "$TEST_RESULTS"

if [ "$ADMIN_STATUS" = "200" ] || [ "$ADMIN_STATUS" = "302" ]; then
    echo "✅ Admin page accessible (Status: $ADMIN_STATUS)" | tee -a "$TEST_RESULTS"
else
    echo "❌ Admin failed (Status: $ADMIN_STATUS)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "🔌 TEST 7: API Endpoints"
echo "─────────────────────────────────────────────────────────────────────────────"

API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PROD_URL/api/health")
echo "API Health: $API_HEALTH" | tee -a "$TEST_RESULTS"

if [ "$API_HEALTH" = "200" ]; then
    echo "✅ API Health endpoint working" | tee -a "$TEST_RESULTS"
else
    echo "❌ API Health failed (Status: $API_HEALTH)" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "📊 TEST SUMMARY"
echo "─────────────────────────────────────────────────────────────────────────────"

# Count passed tests
TOTAL_TESTS=8
PASSED=0

[ "$HOMEPAGE_STATUS" = "200" ] && ((PASSED++))
[ "$DJ_STATUS" = "200" ] && ((PASSED++))
[ "$PHOTOBOOTH_STATUS" = "200" ] && ((PASSED++))
[ "$CALENDAR_STATUS" = "200" ] || [ "$CALENDAR_STATUS" = "302" ] && ((PASSED++))
[ "$LOGIN_STATUS" = "200" ] && ((PASSED++))
[ "$REGISTER_STATUS" = "200" ] && ((PASSED++))
[ "$ADMIN_STATUS" = "200" ] || [ "$ADMIN_STATUS" = "302" ] && ((PASSED++))
[ "$API_HEALTH" = "200" ] && ((PASSED++))

SUCCESS_RATE=$((PASSED * 100 / TOTAL_TESTS))

echo "" | tee -a "$TEST_RESULTS"
echo "Tests Passed: $PASSED/$TOTAL_TESTS" | tee -a "$TEST_RESULTS"
echo "Success Rate: $SUCCESS_RATE%" | tee -a "$TEST_RESULTS"

if [ $SUCCESS_RATE -ge 90 ]; then
    echo "Status: 🟢 EXCELLENT" | tee -a "$TEST_RESULTS"
elif [ $SUCCESS_RATE -ge 75 ]; then
    echo "Status: 🟡 GOOD" | tee -a "$TEST_RESULTS"
else
    echo "Status: 🔴 NEEDS ATTENTION" | tee -a "$TEST_RESULTS"
fi

echo "" | tee -a "$TEST_RESULTS"
echo "Report saved to: $TEST_RESULTS"
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                     PRODUCTION TESTING COMPLETE                            ║"
echo "║                     Success Rate: $SUCCESS_RATE%                                      ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"

