#!/bin/bash
echo "🔌 API ENDPOINT VERIFICATION"
echo "=================================="
echo ""

BASE_URL="https://86bf03c0.webapp-2mf.pages.dev"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
total_tests=0
passed_tests=0
failed_tests=0

test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local expected_status=$4
    
    ((total_tests++))
    echo -n "Testing: $description... "
    
    response=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE_URL$endpoint" 2>/dev/null)
    
    if [ "$response" = "$expected_status" ]; then
        echo -e "${GREEN}✅ PASS${NC} (Status: $response)"
        ((passed_tests++))
    else
        echo -e "${RED}❌ FAIL${NC} (Expected: $expected_status, Got: $response)"
        ((failed_tests++))
    fi
}

echo "🏥 Testing Core Endpoints:"
test_endpoint "GET" "/api/health" "Health Check" "200"
echo ""

echo "🔐 Testing Auth Endpoints:"
test_endpoint "GET" "/" "Homepage" "200"
test_endpoint "GET" "/login" "Login Page" "200"
test_endpoint "GET" "/register" "Register Page" "200"
echo ""

echo "🎵 Testing Service Endpoints:"
test_endpoint "GET" "/dj-services" "DJ Services Page" "200"
test_endpoint "GET" "/photobooth" "Photobooth Page" "200"
test_endpoint "GET" "/api/services/dj" "DJ Services API" "200"
test_endpoint "GET" "/api/services/photobooth" "Photobooth API" "200"
echo ""

echo "📅 Testing Calendar Endpoints:"
test_endpoint "GET" "/calendar" "Calendar Page" "200"
test_endpoint "GET" "/api/availability/dj_cease/2026/1" "DJ Availability API" "200"
test_endpoint "GET" "/api/availability/photobooth_unit1/2026/1" "Photobooth Availability API" "200"
echo ""

echo "📝 Testing Booking Endpoints:"
test_endpoint "GET" "/event-details" "Event Details Page" "200"
echo ""

echo "=================================="
echo "📊 TEST SUMMARY"
echo "=================================="
echo "Total Tests:  $total_tests"
echo -e "Passed:       ${GREEN}$passed_tests${NC}"
echo -e "Failed:       ${RED}$failed_tests${NC}"
success_rate=$((passed_tests * 100 / total_tests))
echo "Success Rate: $success_rate%"

if [ $failed_tests -eq 0 ]; then
    echo -e "\n${GREEN}✅ ALL ENDPOINTS OPERATIONAL${NC}"
    exit 0
else
    echo -e "\n${YELLOW}⚠️  SOME ENDPOINTS NEED ATTENTION${NC}"
    exit 1
fi
