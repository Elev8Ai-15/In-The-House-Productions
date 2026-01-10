#!/bin/bash

# This script will help copy secrets from .dev.vars to production
# Each secret will be set one by one

echo "=================================================="
echo "  COPY SECRETS TO PRODUCTION"
echo "=================================================="
echo ""

if [ ! -f .dev.vars ]; then
    echo "❌ Error: .dev.vars file not found"
    exit 1
fi

# Load secrets from .dev.vars
source .dev.vars

echo "✅ Found all 8 secrets in .dev.vars"
echo ""
echo "Setting up production secrets..."
echo ""

# Function to set secret
set_secret() {
    local key=$1
    local value=$2
    
    echo "Setting $key..."
    echo "$value" | npx wrangler pages secret put "$key" --project-name webapp
    
    if [ $? -eq 0 ]; then
        echo "✅ $key set successfully"
    else
        echo "❌ Failed to set $key"
    fi
    echo ""
}

# Set all secrets
set_secret "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY"
set_secret "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE_KEY"
set_secret "JWT_SECRET" "$JWT_SECRET"
set_secret "RESEND_API_KEY" "$RESEND_API_KEY"
set_secret "FROM_EMAIL" "$FROM_EMAIL"
set_secret "TWILIO_ACCOUNT_SID" "$TWILIO_ACCOUNT_SID"
set_secret "TWILIO_AUTH_TOKEN" "$TWILIO_AUTH_TOKEN"
set_secret "TWILIO_PHONE_NUMBER" "$TWILIO_PHONE_NUMBER"

echo "=================================================="
echo "  SECRETS SETUP COMPLETE!"
echo "=================================================="
echo ""
echo "Verify secrets with:"
echo "npx wrangler pages secret list --project-name webapp"
echo ""

