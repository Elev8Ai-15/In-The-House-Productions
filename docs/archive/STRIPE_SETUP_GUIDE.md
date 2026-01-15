# 🔧 STRIPE PAYMENT SETUP GUIDE

## ⚠️ Current Status: MOCK PAYMENT MODE

Your site is currently running in **MOCK PAYMENT MODE** because Stripe is not configured. This is why the payment page "freezes and loads" - it's redirecting to a mock success page instead of real Stripe checkout.

## 🐛 Issue Diagnosed

**Problem**: Payment page freezes/loads indefinitely
**Root Cause**: Stripe API keys not configured in Cloudflare environment
**Current Behavior**: System falls back to mock payment mode
**Solution**: Configure Stripe API keys (see below)

---

## 🔑 STEP 1: Get Your Stripe API Keys

1. **Sign up for Stripe** (if you haven't already):
   - Go to https://stripe.com
   - Create an account
   - Complete business verification

2. **Get Your API Keys**:
   - Go to https://dashboard.stripe.com/apikeys
   - You'll see two keys:
     - **Publishable Key** (starts with `pk_test_...` or `pk_live_...`)
     - **Secret Key** (starts with `sk_test_...` or `sk_live_...`)
   - **⚠️ NEVER share your secret key publicly!**

3. **Test vs Live Mode**:
   - Use **Test Keys** (`pk_test_...` / `sk_test_...`) during development
   - Use **Live Keys** (`pk_live_...` / `sk_live_...`) for production

---

## 🚀 STEP 2: Configure Stripe in Cloudflare

### Option A: Using Wrangler CLI (Recommended)

```bash
# Navigate to your project
cd /home/user/webapp

# Add Stripe secret key to Cloudflare Pages
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp

# When prompted, paste your Stripe secret key (starts with sk_test_ or sk_live_)
# Press Enter

# Add Stripe webhook secret (optional, for production)
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name webapp
```

### Option B: Using Cloudflare Dashboard

1. Go to https://dash.cloudflare.com
2. Select your account
3. Go to **Workers & Pages**
4. Find your project: **webapp**
5. Click **Settings** tab
6. Scroll to **Environment Variables**
7. Click **Add Variable**:
   - **Variable Name**: `STRIPE_SECRET_KEY`
   - **Value**: Your Stripe secret key (e.g., `sk_test_xxxxxxxxxxxxx`)
   - **Type**: Encrypted (for production secrets)
8. Click **Save**
9. Repeat for `STRIPE_WEBHOOK_SECRET` (optional)

---

## 🔄 STEP 3: Redeploy Your Application

After adding the environment variables, you need to redeploy:

```bash
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name webapp
```

**⚠️ IMPORTANT**: Changes to environment variables require a new deployment to take effect!

---

## 🧪 STEP 4: Test Payment Flow

### Test with Stripe Test Mode

Use these test card numbers:

| Card Number         | Scenario              |
|--------------------|-----------------------|
| 4242 4242 4242 4242 | Success              |
| 4000 0000 0000 0002 | Card declined        |
| 4000 0000 0000 9995 | Insufficient funds   |

**Test Details**:
- **Expiry**: Any future date (e.g., 12/34)
- **CVC**: Any 3 digits (e.g., 123)
- **ZIP**: Any 5 digits (e.g., 12345)

### Testing Steps

1. **Register/Login** to your site
2. **Select a DJ or Photobooth** service
3. **Choose a date** from the calendar
4. **Fill out event details** form
5. **Click "CONTINUE TO PAYMENT"**
6. You should be redirected to **Stripe Checkout** (not mock-success page)
7. **Enter test card**: 4242 4242 4242 4242
8. Complete the payment
9. Verify you're redirected to success page

---

## 📊 STEP 5: Set Up Webhooks (Production)

Webhooks allow Stripe to notify your app about payment events.

### Create Webhook Endpoint

1. Go to https://dashboard.stripe.com/webhooks
2. Click **Add endpoint**
3. **Endpoint URL**: `https://www.inthehouseproductions.com/api/webhook/stripe`
4. **Events to send**:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Click **Add endpoint**
6. Copy the **Signing Secret** (starts with `whsec_...`)

### Add Webhook Secret to Cloudflare

```bash
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name webapp
# Paste the webhook signing secret when prompted
```

---

## 🎯 What Will Change After Setup

### Before (Mock Mode):
- ❌ Payment button redirects to fake success page
- ❌ No real payment processing
- ❌ Console shows: "⚠️ DEVELOPMENT MODE: Using mock payment"
- ❌ Customers can't pay

### After (Real Stripe):
- ✅ Payment button redirects to Stripe Checkout
- ✅ Real credit card processing
- ✅ Console shows normal checkout flow
- ✅ Customers can complete payments
- ✅ You receive money in your Stripe account

---

## 🛠️ Troubleshooting

### Payment Still Shows Mock Mode

**Check**:
1. Environment variable is set correctly in Cloudflare
2. You redeployed after adding the key
3. The key starts with `sk_test_` or `sk_live_`
4. No typos in the variable name (must be exactly `STRIPE_SECRET_KEY`)

**Verify**:
```bash
# Check if the key is set
npx wrangler pages secret list --project-name webapp
```

### "Invalid API Key" Error

**Cause**: Wrong key or corrupted during copy/paste
**Fix**: 
1. Delete the secret: `npx wrangler pages secret delete STRIPE_SECRET_KEY --project-name webapp`
2. Add it again carefully
3. Redeploy

### Webhook Not Working

**Check**:
1. Webhook URL is correct: `https://www.inthehouseproductions.com/api/webhook/stripe`
2. `STRIPE_WEBHOOK_SECRET` is set in Cloudflare
3. Webhook is enabled in Stripe Dashboard
4. Events are selected correctly

---

## 📋 Environment Variables Summary

| Variable Name           | Required | Description                          | Example Value           |
|------------------------|----------|--------------------------------------|-------------------------|
| `STRIPE_SECRET_KEY`    | ✅ Yes   | Stripe API secret key                | `sk_test_xxxxxxxxxxxxx` |
| `STRIPE_WEBHOOK_SECRET`| ⚠️ Prod  | Stripe webhook signing secret        | `whsec_xxxxxxxxxxxxxxx` |

---

## 🎓 Additional Resources

- **Stripe Documentation**: https://stripe.com/docs
- **Stripe Testing**: https://stripe.com/docs/testing
- **Stripe Dashboard**: https://dashboard.stripe.com
- **Cloudflare Pages Docs**: https://developers.cloudflare.com/pages/

---

## 🚀 Quick Start Checklist

- [ ] Sign up for Stripe account
- [ ] Get Stripe test API keys from dashboard
- [ ] Add `STRIPE_SECRET_KEY` to Cloudflare Pages
- [ ] Redeploy application
- [ ] Test payment with test card (4242 4242 4242 4242)
- [ ] Set up webhooks (for production)
- [ ] Switch to live keys when ready to accept real payments

---

## 📞 Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify Stripe keys in Cloudflare Dashboard
3. Test with Stripe test cards
4. Check Stripe Dashboard logs: https://dashboard.stripe.com/logs

**Current Status**: Mock mode is working as a fallback, but you need to configure Stripe for real payments.

---

## 🔍 How to Know If Stripe is Working

### Check Console Logs

**Mock Mode (Not Configured)**:
```
⚠️ DEVELOPMENT MODE: Using mock payment
Mock URL: https://yourdomain.com/checkout/mock-success?...
```

**Real Stripe (Configured)**:
```
💳 Creating checkout session...
📥 Checkout response status: 200
🔄 Redirecting to: https://checkout.stripe.com/c/pay/...
```

### Check URL After Click

**Mock Mode**: Redirects to `/checkout/mock-success`
**Real Stripe**: Redirects to `https://checkout.stripe.com/...`

---

**Last Updated**: 2026-01-13
**Status**: DIAGNOSTIC COMPLETE - READY FOR STRIPE CONFIGURATION
