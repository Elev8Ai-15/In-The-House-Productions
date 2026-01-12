# 🎯 Quick Start: Connect Your Services

## TL;DR - 3 Easy Options

### Option 1: Use Interactive Setup Script ⭐ RECOMMENDED
```bash
cd /home/user/webapp
./setup-services.sh
```
Follow the prompts to add your API keys!

### Option 2: Manual Setup (Production)
```bash
cd /home/user/webapp

# Add Stripe (for payments)
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
# Paste your sk_test_... key

# Add Resend (for emails)
npx wrangler pages secret put RESEND_API_KEY --project-name webapp
# Paste your re_... key
```

### Option 3: Manual Setup (Local Dev)
```bash
cd /home/user/webapp

# Create .dev.vars file
cat > .dev.vars << 'EOF'
JWT_SECRET=dev-secret-key-change-in-production-2025
STRIPE_SECRET_KEY=sk_test_your_stripe_test_key
RESEND_API_KEY=re_your_resend_key
EOF
```

---

## ✅ What's Already Working

| Feature | Status |
|---------|--------|
| Website Hosting | ✅ Live on Cloudflare |
| User Registration/Login | ✅ Working |
| DJ/Photobooth Selection | ✅ Working |
| Calendar with Availability | ✅ Working |
| Event Details Form | ✅ Working |
| Database Storage | ✅ Working |

---

## 🔌 What Needs Your API Keys

| Service | Why You Need It | Required? |
|---------|----------------|-----------|
| **Stripe** | Process credit card payments | ✅ YES |
| **Resend** | Send booking confirmation emails | ✅ YES |
| **Twilio** | Send SMS notifications | ⭐ Optional |

---

## 📋 Get Your API Keys

### 1. Stripe (Required for Payments)
1. Go to: https://dashboard.stripe.com/test/apikeys
2. Sign in or create account
3. Copy your **"Secret key"** (starts with `sk_test_`)
4. Keep it safe!

### 2. Resend (Required for Emails)
1. Go to: https://resend.com/api-keys
2. Sign up or log in
3. Click **"Create API Key"**
4. Name it: "In The House Productions"
5. Copy the key (starts with `re_`)

### 3. Twilio (Optional for SMS)
1. Go to: https://www.twilio.com/console
2. Find **Account SID** and **Auth Token**
3. Buy a phone number (if you want SMS)

---

## 🔄 Can You Switch to Client's Accounts Later?

**YES!** Absolutely! Here's how it works:

### Now (Development):
✅ Use YOUR Stripe account (test mode)  
✅ Use YOUR Resend account  
✅ Test everything works  
✅ Client can see demo with your accounts

### Later (Production):
✅ Get client's Stripe account (or create one for them)  
✅ Get client's Resend account  
✅ Run setup script again with their keys  
✅ **NO CODE CHANGES NEEDED** - just swap the secrets!

### How to Switch:
```bash
# Just run the setup script again with new keys
cd /home/user/webapp
./setup-services.sh

# Or manually update secrets
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name webapp
# Paste CLIENT's key this time

npx wrangler pages secret put RESEND_API_KEY --project-name webapp
# Paste CLIENT's key this time
```

**That's it!** The website automatically uses the new keys.

---

## 🚀 Quick Setup (Right Now)

If you have your Stripe and Resend keys ready:

```bash
cd /home/user/webapp

# Interactive setup (easiest)
./setup-services.sh

# Choose:
# 1. Both (production + local)
# 3. Stripe + Resend

# Then paste your keys when prompted!
```

**Done!** Your booking system will now:
- ✅ Process real credit card payments (test mode)
- ✅ Send confirmation emails to customers
- ✅ Notify DJs/Photobooth providers

---

## 🧪 Test It Works

After setup:

1. **Test Payment Flow**:
   ```
   Login → Select DJ → Pick Date → Event Details → Payment
   ```
   Use test card: `4242 4242 4242 4242`
   
2. **Check Stripe Dashboard**:
   - See the test payment
   - See booking details

3. **Check Email**:
   - Customer gets confirmation
   - DJ/Provider gets notification

---

## ❓ FAQ

**Q: Can I use test mode Stripe keys?**  
A: Yes! Always start with test keys (`sk_test_...`). No real charges.

**Q: Will the client see my accounts?**  
A: No, they only see the booking confirmation. The API keys are hidden.

**Q: What if I don't have Resend?**  
A: Sign up for free at resend.com - it has a generous free tier.

**Q: Do I need Twilio?**  
A: No, it's optional. Email confirmations are usually enough.

**Q: How do I switch to live mode?**  
A: Get your Stripe live key (`sk_live_...`) and re-run setup.

**Q: Can I switch to client's account later?**  
A: Yes! Just run setup again with their keys. Zero code changes.

---

## 📖 Full Documentation

- **[SERVICE_INTEGRATION_GUIDE.md](SERVICE_INTEGRATION_GUIDE.md)** - Complete setup guide
- **[setup-services.sh](setup-services.sh)** - Interactive setup script
- **[ALL_ISSUES_RESOLVED.md](ALL_ISSUES_RESOLVED.md)** - Current system status

---

## ✨ Summary

**Current State**: Website works, bookings save to database

**To Enable Payments**: Add Stripe key (5 minutes)

**To Enable Emails**: Add Resend key (5 minutes)

**Total Setup Time**: ~10 minutes

**Can Switch to Client Later**: YES, easily!

---

**Ready to connect your services?**

```bash
cd /home/user/webapp
./setup-services.sh
```

🚀 Let's get payments working!
