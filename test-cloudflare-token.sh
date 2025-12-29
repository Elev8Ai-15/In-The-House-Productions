#!/bin/bash

echo "🔍 Cloudflare API Token Tester"
echo "================================"
echo ""
echo "Paste your Cloudflare API token and press Enter:"
read -s TOKEN
echo ""
echo "Testing token..."
echo ""

# Test the token
RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# Check if successful
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✅ TOKEN IS VALID!"
  echo ""
  echo "Token Details:"
  echo "$RESPONSE" | python3 -m json.tool
  echo ""
  echo "✅ You can use this token for deployment!"
else
  echo "❌ TOKEN IS INVALID!"
  echo ""
  echo "Error Details:"
  echo "$RESPONSE" | python3 -m json.tool
  echo ""
  echo "Common Issues:"
  echo "1. Token expired"
  echo "2. Wrong permissions"
  echo "3. Token copied incorrectly (extra spaces/characters)"
  echo ""
  echo "Please create a new token using the 'Edit Cloudflare Workers' template."
fi
