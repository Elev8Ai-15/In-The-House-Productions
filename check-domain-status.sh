#!/bin/bash

ACCOUNT_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" | jq -r '.result[0].id')

echo "🔍 Checking custom domain status..."
echo ""

# Get domain details
RESPONSE=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/webapp/domains/www.inthehouseproductions.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

echo "Domain Status:"
echo "$RESPONSE" | jq '.'
echo ""

# Extract key information
STATUS=$(echo "$RESPONSE" | jq -r '.result.status')
VALIDATION_STATUS=$(echo "$RESPONSE" | jq -r '.result.validation_data.status')
VALIDATION_METHOD=$(echo "$RESPONSE" | jq -r '.result.validation_data.method')

echo "📊 Summary:"
echo "  Domain: www.inthehouseproductions.com"
echo "  Status: $STATUS"
echo "  Validation Status: $VALIDATION_STATUS"
echo "  Validation Method: $VALIDATION_METHOD"
echo ""

# Check if we have the zone
echo "🌐 Checking if domain zone exists in Cloudflare..."
ZONES=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=inthehouseproductions.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

ZONE_ID=$(echo "$ZONES" | jq -r '.result[0].id // empty')

if [ -n "$ZONE_ID" ] && [ "$ZONE_ID" != "null" ]; then
    echo "  ✅ Zone found: $ZONE_ID"
    echo "  📝 We can configure DNS automatically!"
else
    echo "  ⚠️  Zone not found in this Cloudflare account"
    echo "  📝 DNS needs to be configured manually"
fi
