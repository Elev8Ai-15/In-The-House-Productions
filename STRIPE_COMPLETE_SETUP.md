# 🎯 Complete Stripe Setup Guide - Step by Step

## Part 1: Get Your Stripe Account & API Keys

### **Step 1: Create Stripe Account**

1. Go to: **https://dashboard.stripe.com/register**
2. Sign up with:
   - Email address
   - Password
   - Country (United States)
3. Verify your email address

### **Step 2: Get Your Test API Keys**

1. After logging in, go to: **https://dashboard.stripe.com/test/apikeys**
2. You'll see two keys:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...` - click "Reveal test key")

3. **Copy both keys** - you'll need them next!

---

## Part 2: Add API Keys to Your Project

### **Option A: For Development (Local Testing)**

Open your terminal and edit `.dev.vars`:

```bash
cd /home/user/webapp
nano .dev.vars
```

Replace the placeholder values with your actual keys:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_SECRET_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_PUBLISHABLE_KEY_HERE

# JWT Secret (already configured)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
```

**Save and exit** (Ctrl+X, then Y, then Enter)

### **Option B: For Production (Cloudflare)**

Add secrets using wrangler:

```bash
cd /home/user/webapp

# Add Stripe secret key
npx wrangler secret put STRIPE_SECRET_KEY --project-name webapp

# When prompted, paste: sk_live_YOUR_LIVE_KEY_HERE

# Add Stripe publishable key  
npx wrangler secret put STRIPE_PUBLISHABLE_KEY --project-name webapp

# When prompted, paste: pk_live_YOUR_LIVE_KEY_HERE
```

---

## Part 3: Enable Stripe in Backend Code

The backend code needs a small update to actually use Stripe. Let me show you what to change:

### **Current Code (Mock Mode):**
```typescript
// Temporary response until Stripe is configured
return c.json({
  message: 'Stripe backend ready',
  total,
  items: lineItems,
  note: 'Add STRIPE_SECRET_KEY to .dev.vars to enable checkout'
})
```

### **Updated Code (Real Stripe):**
```typescript
// Import Stripe at the top of the file
import Stripe from 'stripe'

// In the checkout endpoint:
const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY

if (!STRIPE_SECRET_KEY) {
  return c.json({ error: 'Stripe not configured' }, 500)
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16'
})

const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: lineItems,
  mode: 'payment',
  success_url: `${new URL(c.req.url).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${new URL(c.req.url).origin}/checkout/cancel`
})

return c.json({ 
  sessionId: session.id, 
  url: session.url 
})
```

---

## Part 4: Update Your Code

Let me update the backend code now to use real Stripe:

**I'll modify the `/api/checkout/create-session` endpoint to:**
1. Import Stripe library
2. Initialize Stripe client
3. Create real checkout sessions
4. Return redirect URL for payment

---

## Part 5: Restart Your Server

After adding API keys:

```bash
cd /home/user/webapp

# Rebuild the project
npm run build

# Restart PM2
pm2 restart webapp

# Verify it's running
pm2 logs webapp --nostream
```

---

## Part 6: Test the Integration

### **Test 1: Check Configuration**

```bash
curl http://localhost:3000/api/checkout/create-session \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "serviceId": "dj_cease",
        "eventDate": "2024-12-25",
        "hours": 4
      }
    ]
  }'
```

**Expected Response (with keys configured):**
```json
{
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

### **Test 2: Use Test Cards**

Stripe provides test card numbers:

**Successful Payment:**
- Card: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., `12/25`)
- CVC: Any 3 digits (e.g., `123`)
- ZIP: Any 5 digits (e.g., `12345`)

**Declined Payment:**
- Card: `4000 0000 0000 0002`

---

## Part 7: Set Up Webhook (Important!)

Webhooks tell your server when payments succeed or fail.

### **For Local Testing (Development):**

1. Install Stripe CLI:
```bash
# Download Stripe CLI
wget https://github.com/stripe/stripe-cli/releases/download/v1.19.0/stripe_1.19.0_linux_x86_64.tar.gz

# Extract
tar -xzf stripe_1.19.0_linux_x86_64.tar.gz

# Move to PATH
sudo mv stripe /usr/local/bin/

# Login to Stripe
stripe login
```

2. Forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:3000/api/webhook/stripe
```

3. You'll get a **webhook signing secret** (starts with `whsec_...`)

4. Add to `.dev.vars`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

### **For Production (Cloudflare):**

1. Go to: **https://dashboard.stripe.com/webhooks**

2. Click **"Add endpoint"**

3. Enter your endpoint URL:
```
https://your-domain.pages.dev/api/webhook/stripe
```

4. Select events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`

5. Copy the **Signing secret** (starts with `whsec_...`)

6. Add to Cloudflare secrets:
```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --project-name webapp
```

---

## Part 8: Build Frontend Shopping Cart UI

You'll need to add:

### **1. Shopping Cart Icon (in header)**
```html
<div class="cart-icon" onclick="window.location.href='/cart'">
  <i class="fas fa-shopping-cart"></i>
  <span class="cart-count" id="cartCount">0</span>
</div>
```

### **2. Add to Cart Button (on DJ selection)**
```html
<button class="btn-3d" onclick="addToCart('dj_cease')">
  <i class="fas fa-cart-plus"></i> ADD TO CART
</button>
```

### **3. Cart Page (/cart route)**
- Display cart items
- Show total price
- "Proceed to Checkout" button

### **4. Checkout Button**
```javascript
async function checkout() {
  const response = await fetch('/api/checkout/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: cartItems // from your cart state
    })
  })
  
  const { url } = await response.json()
  window.location.href = url // Redirect to Stripe
}
```

---

## Part 9: Success & Cancel Pages

Create two pages for after payment:

### **Success Page (`/checkout/success`)**
```html
<h1>🎉 Payment Successful!</h1>
<p>Your booking is confirmed!</p>
<p>Check your email for details.</p>
```

### **Cancel Page (`/checkout/cancel`)**
```html
<h1>❌ Payment Cancelled</h1>
<p>Your order was not completed.</p>
<a href="/cart">Return to Cart</a>
```

---

## 🎯 Quick Start Checklist

- [ ] Create Stripe account
- [ ] Get test API keys
- [ ] Add keys to `.dev.vars`
- [ ] Restart server
- [ ] Test checkout endpoint
- [ ] Set up webhook
- [ ] Build frontend cart UI
- [ ] Test with Stripe test cards
- [ ] Create success/cancel pages
- [ ] Switch to live keys for production

---

## 🔐 Security Best Practices

1. **Never commit API keys to git** (.gitignore already configured)
2. **Use test keys for development** (start with `sk_test_`)
3. **Use live keys only in production** (start with `sk_live_`)
4. **Verify webhook signatures** (prevents fake payment notifications)
5. **Always process payments server-side** (never client-side)

---

## 🆘 Common Issues & Solutions

### **Issue: "Stripe not configured"**
- **Solution**: Add STRIPE_SECRET_KEY to `.dev.vars` and restart server

### **Issue: "Invalid API key"**
- **Solution**: Make sure you copied the full key (starts with `sk_test_`)

### **Issue: "No such customer"**
- **Solution**: You're using live key with test data (or vice versa)

### **Issue: Webhook not receiving events**
- **Solution**: Check webhook URL is correct and accessible from internet

---

## 📞 Need Help?

**Stripe Documentation:**
- Getting Started: https://stripe.com/docs/checkout/quickstart
- Test Cards: https://stripe.com/docs/testing
- Webhooks: https://stripe.com/docs/webhooks
- API Reference: https://stripe.com/docs/api

**Stripe Support:**
- Dashboard: https://dashboard.stripe.com
- Support: https://support.stripe.com

---

*Would you like me to update the backend code now to use real Stripe checkout?*
