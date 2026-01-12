# 🔧 Service Integration Guide

## Overview
This guide explains how to connect all external services (Stripe, Cloudflare, Twilio, Resend) to your In The House Productions booking system.

---

## ✅ Already Connected

### 1. Cloudflare (Production Hosting)
- **Status**: ✅ Connected
- **Production URL**: https://webapp-2mf.pages.dev
- **D1 Database**: webapp-production (974501e5-bc33-4e80-93b3-891df0ac64f9)
- **What it does**: Hosts the website, stores bookings in database

---

## 🔌 Services to Connect

### 2. Stripe (Payment Processing)
**What it does**: Processes credit card payments for DJ/Photobooth bookings

**Setup Steps**:
1. Get your Stripe API keys:
   - Go to: https://dashboard.stripe.com/test/apikeys
   - Copy your **Secret Key** (starts with `sk_test_` for testing)

2. Add to Cloudflare:
   ```bash
   npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
   # Paste your secret key when prompted
   ```

3. For local development:
   ```bash
   # Create .dev.vars file
   echo "STRIPE_SECRET_KEY=sk_test_your_key_here" > .dev.vars
   ```

**Test Mode vs Live Mode**:
- **Test Mode** (`sk_test_...`): Use for testing, no real charges
- **Live Mode** (`sk_live_...`): Real credit card charges
- Start with test mode, switch to live when client is ready

---

### 3. Resend (Email Notifications)
**What it does**: Sends booking confirmations to customers and DJs

**Setup Steps**:
1. Get API key from: https://resend.com/api-keys
2. Add to Cloudflare:
   ```bash
   npx wrangler pages secret put RESEND_API_KEY --project-name webapp
   ```
3. Add to `.dev.vars`:
   ```bash
   echo "RESEND_API_KEY=re_your_key_here" >> .dev.vars
   ```

**Email Configuration**:
- Sends from: `bookings@yourdomain.com` (configure in Resend)
- Sends to: Customer email + DJ/Photobooth provider email
- Includes: Booking details, event info, payment confirmation

---

### 4. Twilio (SMS Notifications) - OPTIONAL
**What it does**: Sends text message confirmations

**Setup Steps**:
1. Get credentials from: https://www.twilio.com/console
2. You need:
   - Account SID
   - Auth Token
   - Phone Number

3. Add to Cloudflare:
   ```bash
   npx wrangler pages secret put TWILIO_ACCOUNT_SID --project-name webapp
   npx wrangler pages secret put TWILIO_AUTH_TOKEN --project-name webapp
   npx wrangler pages secret put TWILIO_PHONE_NUMBER --project-name webapp
   ```

4. Add to `.dev.vars`:
   ```bash
   echo "TWILIO_ACCOUNT_SID=ACxxxx" >> .dev.vars
   echo "TWILIO_AUTH_TOKEN=your_token" >> .dev.vars
   echo "TWILIO_PHONE_NUMBER=+15551234567" >> .dev.vars
   ```

**Note**: Twilio is optional. Email notifications via Resend are sufficient for most use cases.

---

## 🔐 Security - Environment Variables

### Production (Cloudflare Pages)
Secrets are stored securely in Cloudflare and never exposed to the browser.

**Current Secrets** (already set):
- `JWT_SECRET`: For user authentication tokens
- `DB`: Database connection (automatic)

**To Add** (when ready):
- `STRIPE_SECRET_KEY`: Payment processing
- `RESEND_API_KEY`: Email notifications
- `TWILIO_*`: SMS notifications (optional)

### Local Development (.dev.vars)
Create a `.dev.vars` file in your project root:

```bash
# JWT Secret (for local testing)
JWT_SECRET=dev-secret-key-change-in-production-2025

# Stripe (use test mode keys)
STRIPE_SECRET_KEY=sk_test_your_test_key_here

# Resend (use your API key)
RESEND_API_KEY=re_your_key_here

# Twilio (optional)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15551234567
```

**Important**: `.dev.vars` is in `.gitignore` and will NOT be committed to GitHub.

---

## 🔄 Switching to Client's Accounts Later

When you're ready to switch to the client's accounts:

### 1. Get Client's Credentials
- Stripe account (or create one for them)
- Resend account (or create one for them)
- Cloudflare account (optional - can stay on yours)

### 2. Update Cloudflare Secrets
```bash
# Update each secret with client's keys
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
npx wrangler pages secret put RESEND_API_KEY --project-name webapp
```

### 3. Update Email Domain (if using custom domain)
- In Resend, verify client's domain
- Update `from` email in code

### 4. Switch Stripe to Live Mode
```bash
# Replace sk_test_... with sk_live_...
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
```

---

## 📋 Current Integration Status

| Service | Status | Required | Purpose |
|---------|--------|----------|---------|
| **Cloudflare Pages** | ✅ Connected | Yes | Website hosting |
| **Cloudflare D1** | ✅ Connected | Yes | Database storage |
| **JWT Authentication** | ✅ Working | Yes | User login |
| **Stripe** | ⏳ Pending | Yes | Payment processing |
| **Resend** | ⏳ Pending | Yes | Email notifications |
| **Twilio** | ⏳ Pending | No | SMS notifications |

---

## 🚀 Quick Setup Commands

### Option 1: Use Your Accounts Now
```bash
cd /home/user/webapp

# Add Stripe test key
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
# Paste: sk_test_your_stripe_test_key

# Add Resend API key
npx wrangler pages secret put RESEND_API_KEY --project-name webapp
# Paste: re_your_resend_key

# List all secrets to verify
npx wrangler pages secret list --project-name webapp
```

### Option 2: Set Up Local Development First
```bash
cd /home/user/webapp

# Create .dev.vars file
cat > .dev.vars << 'EOF'
JWT_SECRET=dev-secret-key-change-in-production-2025
STRIPE_SECRET_KEY=sk_test_your_test_key_here
RESEND_API_KEY=re_your_key_here
EOF

# Test locally with PM2
npm run build
pm2 restart webapp
```

---

## 🧪 Testing Payment Flow

Once Stripe is connected:

1. **Test with Stripe Test Cards**:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - Any future expiry date
   - Any 3-digit CVC

2. **Test Booking Flow**:
   - Login → Select DJ/Photobooth → Pick Date → Event Details → Payment
   - Should redirect to Stripe Checkout
   - Use test card
   - Should redirect back with success

3. **Check Dashboard**:
   - Stripe Dashboard: See test payment
   - D1 Database: Booking stored with payment status

---

## 📖 What Each Service Does

### Stripe Checkout Flow
```
1. User fills out event details
2. App creates Stripe Checkout Session
3. User redirected to Stripe payment page
4. User enters card info (secure on Stripe's site)
5. Stripe processes payment
6. User redirected back to success page
7. Webhook confirms payment (optional, future enhancement)
```

### Email Notification Flow
```
1. Booking created in database
2. App calls Resend API
3. Resend sends emails:
   - Customer: Booking confirmation with details
   - DJ/Photobooth: New booking notification
4. Both parties receive confirmation
```

### SMS Notification Flow (Optional)
```
1. Booking created
2. App calls Twilio API
3. Twilio sends SMS:
   - Customer: "Booking confirmed for [date]"
   - Provider: "New booking for [date]"
```

---

## ⚠️ Important Notes

1. **Start with Test Mode**: Always use Stripe test keys first
2. **Environment Variables**: Never commit API keys to GitHub
3. **`.dev.vars`**: For local development only, not deployed
4. **Cloudflare Secrets**: For production, secure and encrypted
5. **Switch Later**: Easy to change to client's accounts anytime

---

## 🎯 Recommended Next Steps

**Today** (Development):
1. Add your Stripe test key
2. Add your Resend API key
3. Test full booking flow with payments
4. Verify emails are sent

**Before Launch** (Production):
1. Get client's Stripe account
2. Get client's email domain verified
3. Switch to Stripe live mode
4. Update Cloudflare secrets
5. Test with real credit card (small amount)

---

## 🆘 Getting API Keys

### Stripe
1. Go to: https://dashboard.stripe.com/test/apikeys
2. Copy "Secret key" (starts with `sk_test_`)
3. For live: Switch to "Live mode" toggle, copy live key

### Resend
1. Go to: https://resend.com/api-keys
2. Click "Create API Key"
3. Name it "In The House Productions"
4. Copy the key (starts with `re_`)

### Twilio (Optional)
1. Go to: https://www.twilio.com/console
2. Find "Account SID" and "Auth Token"
3. Buy a phone number from Twilio Console
4. Use that number as `TWILIO_PHONE_NUMBER`

---

## ✅ Summary

**Current State**: Website works, bookings save to database, authentication works

**To Enable Payments**: Add Stripe key → Payments will work

**To Enable Emails**: Add Resend key → Confirmations will send

**To Switch to Client**: Update secrets with their keys anytime

**You're in control**: Start with your accounts, switch later, no code changes needed!

---

*Last Updated: January 10, 2026*
