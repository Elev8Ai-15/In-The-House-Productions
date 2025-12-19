# 🚀 Stripe Quick Start - 5 Minutes to Live Payments!

## ✅ Status: Backend is READY - Just needs your API keys!

---

## Step 1: Get Your Stripe API Keys (2 minutes)

1. **Go to**: https://dashboard.stripe.com/register
2. **Sign up** with your email
3. **Go to**: https://dashboard.stripe.com/test/apikeys
4. **Copy both keys**:
   - Secret key (starts with `sk_test_...`)
   - Publishable key (starts with `pk_test_...`)

---

## Step 2: Add Keys to Your Project (1 minute)

**Edit the `.dev.vars` file:**

```bash
cd /home/user/webapp
nano .dev.vars
```

**Replace the placeholder with your actual keys:**

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY_HERE_FROM_DASHBOARD
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY_HERE_FROM_DASHBOARD

# JWT Secret (already configured)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
```

**Save**: Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 3: Restart Your Server (30 seconds)

```bash
cd /home/user/webapp
pm2 restart webapp
```

**That's it! Your Stripe integration is now LIVE!** 🎉

---

## Step 4: Test It Works (1 minute)

```bash
curl -X POST http://localhost:3000/api/checkout/create-session \
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

**Expected Response:**
```json
{
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "total": 1100
}
```

**If you see a URL** - Stripe is working! ✅

---

## 🎴 Test Payment with Stripe Test Card

Use these test card numbers:

**✅ Successful Payment:**
- Card: `4242 4242 4242 4242`
- Expiry: `12/25` (any future date)
- CVC: `123` (any 3 digits)
- ZIP: `12345` (any 5 digits)

**❌ Declined Payment (for testing errors):**
- Card: `4000 0000 0000 0002`

---

## 🎯 What Works Right Now

After adding your API keys, you can:

1. ✅ **Add services to cart**
   ```bash
   POST /api/cart/add
   ```

2. ✅ **Create checkout session**
   ```bash
   POST /api/checkout/create-session
   ```

3. ✅ **Redirect to Stripe checkout**
   - Customer enters card details on Stripe's secure page
   - You never handle sensitive card data

4. ✅ **Receive payment confirmation**
   - Webhook receives `checkout.session.completed` event
   - Your app knows payment succeeded

---

## 📋 What You Still Need to Build

### **Frontend Components** (next phase):

1. **Shopping Cart Icon**
   - Shows cart item count
   - Links to cart page

2. **Cart Page**
   - Display cart items
   - Show total price
   - "Checkout" button

3. **Checkout Button**
   - Calls `/api/checkout/create-session`
   - Redirects to Stripe URL

4. **Success Page** (`/checkout/success`)
   - "Payment successful!" message
   - Booking confirmation

5. **Cancel Page** (`/checkout/cancel`)
   - "Payment cancelled" message
   - Link back to cart

---

## 🔍 How to Debug

### **Check if Stripe is configured:**
```bash
curl -X POST http://localhost:3000/api/checkout/create-session \
  -H "Content-Type: application/json" \
  -d '{"items":[{"serviceId":"dj_cease","eventDate":"2024-12-25","hours":4}]}'
```

**If you see:**
- ✅ `"sessionId": "cs_test_..."` - **WORKING!**
- ❌ `"error": "Stripe not configured"` - Check your `.dev.vars` file
- ❌ `"error": "Invalid API Key"` - Wrong key, check dashboard

### **Check server logs:**
```bash
pm2 logs webapp --nostream
```

---

## 💡 Pro Tips

1. **Test Mode vs Live Mode**
   - Test keys start with `sk_test_`
   - Live keys start with `sk_live_`
   - Always use test keys for development

2. **Webhook Testing**
   - For local development, use Stripe CLI
   - For production, add webhook endpoint in Stripe Dashboard

3. **Security**
   - Never commit API keys to git (already in .gitignore)
   - Never expose secret key in frontend code
   - Always process payments server-side

---

## 📞 Need Help?

**Stripe Dashboard**: https://dashboard.stripe.com  
**API Keys**: https://dashboard.stripe.com/test/apikeys  
**Test Cards**: https://stripe.com/docs/testing  
**Documentation**: `STRIPE_COMPLETE_SETUP.md` (detailed guide)

---

## ✅ Checklist

- [ ] Create Stripe account
- [ ] Get test API keys
- [ ] Add keys to `.dev.vars`
- [ ] Restart server (`pm2 restart webapp`)
- [ ] Test checkout endpoint
- [ ] See successful response with `sessionId`
- [ ] 🎉 **You're done!**

---

*Your backend is production-ready. Just add your API keys and start accepting payments!*
