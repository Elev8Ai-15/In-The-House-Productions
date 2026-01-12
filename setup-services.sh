#!/bin/bash

# 🔧 Service Setup Script for In The House Productions
# This script helps you set up all external service integrations

echo "🎉 In The House Productions - Service Integration Setup"
echo "======================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "wrangler.jsonc" ]; then
  echo "❌ Error: Please run this script from the /home/user/webapp directory"
  exit 1
fi

echo "This script will help you set up:"
echo "  1. Stripe (Payment Processing) - REQUIRED"
echo "  2. Resend (Email Notifications) - REQUIRED"
echo "  3. Twilio (SMS Notifications) - OPTIONAL"
echo ""
echo "You can:"
echo "  - Use your own accounts now and switch to client's later"
echo "  - Set up production secrets (Cloudflare Pages)"
echo "  - Set up local development (.dev.vars file)"
echo ""

# Ask which environment to set up
echo "Which environment do you want to set up?"
echo "  1) Production (Cloudflare Pages secrets)"
echo "  2) Local Development (.dev.vars file)"
echo "  3) Both"
read -p "Enter choice (1-3): " ENV_CHOICE

# Ask which services to set up
echo ""
echo "Which services do you want to set up?"
echo "  1) Stripe only (payment processing)"
echo "  2) Resend only (email notifications)"
echo "  3) Stripe + Resend (recommended)"
echo "  4) All services (Stripe + Resend + Twilio)"
read -p "Enter choice (1-4): " SERVICE_CHOICE

echo ""
echo "======================================================"

# Function to set up Stripe
setup_stripe() {
  local env=$1
  echo ""
  echo "📦 Setting up Stripe..."
  echo ""
  echo "Get your Stripe API key from: https://dashboard.stripe.com/test/apikeys"
  echo "Copy the 'Secret key' (starts with sk_test_ for testing)"
  echo ""
  read -p "Enter your Stripe Secret Key: " STRIPE_KEY
  
  if [ -z "$STRIPE_KEY" ]; then
    echo "❌ Skipping Stripe (no key provided)"
    return
  fi
  
  if [[ "$env" == "production" ]] || [[ "$env" == "both" ]]; then
    echo "Setting Stripe key in Cloudflare..."
    echo "$STRIPE_KEY" | npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
    echo "✅ Stripe configured for production"
  fi
  
  if [[ "$env" == "local" ]] || [[ "$env" == "both" ]]; then
    echo "STRIPE_SECRET_KEY=$STRIPE_KEY" >> .dev.vars
    echo "✅ Stripe configured for local development"
  fi
}

# Function to set up Resend
setup_resend() {
  local env=$1
  echo ""
  echo "📧 Setting up Resend..."
  echo ""
  echo "Get your Resend API key from: https://resend.com/api-keys"
  echo "Create a new key and copy it (starts with re_)"
  echo ""
  read -p "Enter your Resend API Key: " RESEND_KEY
  
  if [ -z "$RESEND_KEY" ]; then
    echo "❌ Skipping Resend (no key provided)"
    return
  fi
  
  if [[ "$env" == "production" ]] || [[ "$env" == "both" ]]; then
    echo "Setting Resend key in Cloudflare..."
    echo "$RESEND_KEY" | npx wrangler pages secret put RESEND_API_KEY --project-name webapp
    echo "✅ Resend configured for production"
  fi
  
  if [[ "$env" == "local" ]] || [[ "$env" == "both" ]]; then
    echo "RESEND_API_KEY=$RESEND_KEY" >> .dev.vars
    echo "✅ Resend configured for local development"
  fi
}

# Function to set up Twilio
setup_twilio() {
  local env=$1
  echo ""
  echo "📱 Setting up Twilio (SMS)..."
  echo ""
  echo "Get your Twilio credentials from: https://www.twilio.com/console"
  echo ""
  read -p "Enter your Twilio Account SID: " TWILIO_SID
  read -p "Enter your Twilio Auth Token: " TWILIO_TOKEN
  read -p "Enter your Twilio Phone Number (+15551234567): " TWILIO_PHONE
  
  if [ -z "$TWILIO_SID" ] || [ -z "$TWILIO_TOKEN" ] || [ -z "$TWILIO_PHONE" ]; then
    echo "❌ Skipping Twilio (missing credentials)"
    return
  fi
  
  if [[ "$env" == "production" ]] || [[ "$env" == "both" ]]; then
    echo "Setting Twilio credentials in Cloudflare..."
    echo "$TWILIO_SID" | npx wrangler pages secret put TWILIO_ACCOUNT_SID --project-name webapp
    echo "$TWILIO_TOKEN" | npx wrangler pages secret put TWILIO_AUTH_TOKEN --project-name webapp
    echo "$TWILIO_PHONE" | npx wrangler pages secret put TWILIO_PHONE_NUMBER --project-name webapp
    echo "✅ Twilio configured for production"
  fi
  
  if [[ "$env" == "local" ]] || [[ "$env" == "both" ]]; then
    echo "TWILIO_ACCOUNT_SID=$TWILIO_SID" >> .dev.vars
    echo "TWILIO_AUTH_TOKEN=$TWILIO_TOKEN" >> .dev.vars
    echo "TWILIO_PHONE_NUMBER=$TWILIO_PHONE" >> .dev.vars
    echo "✅ Twilio configured for local development"
  fi
}

# Determine environment
ENV=""
case $ENV_CHOICE in
  1) ENV="production";;
  2) ENV="local";;
  3) ENV="both";;
  *) echo "Invalid choice"; exit 1;;
esac

# Create .dev.vars if setting up local
if [[ "$ENV" == "local" ]] || [[ "$ENV" == "both" ]]; then
  if [ ! -f ".dev.vars" ]; then
    echo "# Environment variables for local development" > .dev.vars
    echo "JWT_SECRET=dev-secret-key-change-in-production-2025" >> .dev.vars
    echo "✅ Created .dev.vars file"
  else
    echo "ℹ️  .dev.vars file already exists, appending..."
  fi
fi

# Set up services based on choice
case $SERVICE_CHOICE in
  1) setup_stripe "$ENV";;
  2) setup_resend "$ENV";;
  3) setup_stripe "$ENV"; setup_resend "$ENV";;
  4) setup_stripe "$ENV"; setup_resend "$ENV"; setup_twilio "$ENV";;
  *) echo "Invalid choice"; exit 1;;
esac

echo ""
echo "======================================================"
echo "✅ Setup Complete!"
echo ""

if [[ "$ENV" == "production" ]] || [[ "$ENV" == "both" ]]; then
  echo "🚀 Production secrets configured in Cloudflare Pages"
  echo ""
  echo "To verify:"
  echo "  npx wrangler pages secret list --project-name webapp"
fi

if [[ "$ENV" == "local" ]] || [[ "$ENV" == "both" ]]; then
  echo "💻 Local development configured in .dev.vars"
  echo ""
  echo "To test locally:"
  echo "  npm run build"
  echo "  pm2 restart webapp"
fi

echo ""
echo "📖 For more information, see SERVICE_INTEGRATION_GUIDE.md"
echo ""
echo "🎉 Ready to process payments and send notifications!"
echo ""
