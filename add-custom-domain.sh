#!/bin/bash

# Get account ID
ACCOUNT_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" | jq -r '.result[0].id')

echo "Account ID: $ACCOUNT_ID"
echo ""

# Add custom domain
echo "Adding custom domain: www.inthehouseproductions.com"
echo ""

RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/webapp/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "www.inthehouseproductions.com"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'

# Check if successful
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    echo ""
    echo "✅ SUCCESS! Custom domain added!"
    echo ""
    echo "DNS Configuration needed:"
    echo "$RESPONSE" | jq -r '.result.validation_data // empty'
else
    echo ""
    echo "⚠️  Response received - checking details..."
    echo "$RESPONSE" | jq -r '.errors[]? | .message'
fi
