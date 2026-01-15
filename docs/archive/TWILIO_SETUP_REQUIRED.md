# Twilio SMS Setup Required

## Current Status
❌ **Twilio credentials in `.dev.vars` are test/placeholder values and DO NOT work**

## What You Need
To enable SMS notifications for bookings, you need:

1. **Twilio Account** (Sign up at https://www.twilio.com if you don't have one)
2. **Phone Number** (Purchase a Twilio phone number - starts at $1/month)
3. **Credentials**:
   - Account SID
   - Auth Token
   - Twilio Phone Number

## How to Set Up

### Step 1: Get Twilio Credentials
1. Go to https://console.twilio.com
2. Find your **Account SID** and **Auth Token** on the dashboard
3. Go to Phone Numbers → Buy a Number (if you don't have one)
4. Copy your Twilio phone number

### Step 2: Update `.dev.vars` (Local Development)
```bash
# Open .dev.vars and replace with your real credentials:
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

### Step 3: Update Wrangler Secrets (Production)
```bash
cd /home/user/webapp
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_PHONE_NUMBER
```

## Current Notification Behavior

### ✅ What's Working Now:
- **Email notifications** are working (via Resend API)
- **Database tracking** of all notifications
- **Provider contacts** are correctly configured:
  - DJ Cease: +17273594701
  - Joey (TKOtheDJ): +13528015099
  - Others: +1-816-217-1094 (fallback)

### ⏳ What Will Work After Twilio Setup:
- **SMS notifications** to providers when bookings are created
- **SMS alerts** for booking confirmations
- **Text messages** with event details

## Testing
Once you update the credentials, the system will automatically send SMS to providers when bookings are made.

## Cost Estimate
- Twilio Phone Number: ~$1/month
- SMS Messages: ~$0.0079 per message (US)
- For ~100 bookings/month: ~$2/month total

## Questions?
Contact Twilio support or let me know if you need help!
