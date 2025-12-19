#!/bin/bash
echo "======================================"
echo "TESTING COMPLETE BOOKING FLOW"
echo "======================================"
echo ""

# Step 1: Login to get token
echo "1. Logging in as test user..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@inthehouseproductions.com","password":"Admin123!"}')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Login failed!"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo "   Token: ${TOKEN:0:20}..."
echo ""

# Step 2: Test booking creation
echo "2. Creating test booking..."
BOOKING_RESPONSE=$(curl -s -X POST http://localhost:3000/api/bookings/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "serviceType": "dj_cease",
    "serviceProvider": "dj_cease",
    "eventDate": "2025-12-25",
    "startTime": "18:00",
    "endTime": "23:00",
    "eventDetails": {
      "eventName": "Test Event",
      "eventType": "wedding",
      "venueName": "Test Venue",
      "venueAddress": "123 Main St",
      "venueCity": "Tampa",
      "venueState": "FL",
      "venueZip": "33602",
      "expectedGuests": 100
    }
  }')

echo "Response:"
echo "$BOOKING_RESPONSE" | jq '.' 2>/dev/null || echo "$BOOKING_RESPONSE"
echo ""

# Check if successful
if echo "$BOOKING_RESPONSE" | jq -e '.checkoutUrl' > /dev/null 2>&1; then
  echo "✅ Booking created successfully!"
  CHECKOUT_URL=$(echo "$BOOKING_RESPONSE" | jq -r '.checkoutUrl')
  echo "   Checkout URL: $CHECKOUT_URL"
else
  echo "❌ Booking creation failed!"
fi

echo ""
echo "======================================"
