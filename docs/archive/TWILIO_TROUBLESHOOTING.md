# Twilio Number Purchase Troubleshooting Guide

## 🔴 Current Problem

**Issue**: Cannot purchase a local Twilio phone number  
**Current Number**: +1-866-658-0683 (Toll-free - **BLOCKED by carriers**)  
**Error Codes**: 30044, 30032 (messages failing to deliver)

---

## ✅ Temporary Solution (ACTIVE NOW)

All provider SMS notifications are now sent to: **+1-816-217-1094** (your verified number)

### What This Means:
- ✅ **You'll receive ALL booking notifications**
- ✅ SMS will work immediately with this setup
- ✅ You can forward booking info to DJs manually
- ✅ Email notifications still go to each provider directly

**Status**: System configured to send to verified number

---

## 🔍 Why You Can't Buy a Number

### Common Reasons & Solutions:

### 1. **Trial Account Restrictions**
**Problem**: Trial accounts have limited number purchases  
**Check**: Go to https://www.twilio.com/console  
**Solution**: Upgrade to paid account ($20 minimum credit)

```
Steps to Upgrade:
1. Go to https://www.twilio.com/console/billing
2. Click "Upgrade"
3. Add payment method
4. Add $20 credit (no monthly fees, pay-as-you-go)
5. Account upgraded immediately
```

### 2. **Payment Method Required**
**Problem**: No credit card on file  
**Check**: https://www.twilio.com/console/billing/payment-methods  
**Solution**: Add valid credit card

### 3. **Address Verification Needed**
**Problem**: Business address not verified  
**Check**: https://www.twilio.com/console/account/settings  
**Solution**: Complete address verification form

### 4. **Identity Verification Required**
**Problem**: Account flagged for verification  
**Check**: Email from Twilio or console notifications  
**Solution**: Submit ID verification documents

### 5. **Regional Compliance**
**Problem**: Some countries require regulatory approval  
**Check**: https://www.twilio.com/guidelines/regulatory  
**Solution**: Complete regulatory bundle (US usually exempt)

---

## 📋 Step-by-Step: How to Buy Local Number

### Once Purchase is Enabled:

1. **Go to Phone Numbers**  
   https://www.twilio.com/console/phone-numbers/search

2. **Search Settings**:
   - ❌ **UNCHECK "Toll Free"** (very important!)
   - ✅ Check "SMS" capability
   - ✅ Select country: United States
   - ✅ Optional: Enter area code (816 for Kansas City)

3. **Find a Number**:
   - Click "Search"
   - Look for numbers with **SMS** icon
   - Check capabilities show: Voice + SMS

4. **Buy the Number**:
   - Click "Buy" next to a number you like
   - Confirm purchase ($1/month)
   - Number is active immediately

5. **Copy New Number**:
   - Format will be: **+1-XXX-XXX-XXXX**
   - Example: **+1-816-555-1234**

6. **Give Me the Number**:
   - I'll update `.dev.vars`
   - Restart the service
   - Test SMS immediately

---

## 💰 Cost Breakdown

### Local Number:
- **Purchase**: $0 (one-time)
- **Monthly**: $1.00/month
- **SMS Sent**: $0.0079 per message
- **SMS Received**: Free

### Example Monthly Cost:
- Number rental: $1.00
- 100 bookings × $0.0079: $0.79
- **Total**: ~$1.79/month

**Much cheaper than toll-free registration ($15-50 + months of waiting)**

---

## 🚫 Why Toll-Free Doesn't Work

Your current number: **+1-866-658-0683**

### Toll-Free SMS Requirements:
- ❌ Must register for A2P 10DLC messaging
- ❌ Costs $15-50 setup fee
- ❌ Takes 4-6 weeks for approval
- ❌ Monthly compliance fees
- ❌ Requires business verification
- ❌ Not worth it for small businesses

**Carriers block unregistered toll-free SMS** = Your messages fail

---

## ✅ What to Try RIGHT NOW

### Option 1: Upgrade Account (Recommended)
```
1. Go to: https://www.twilio.com/console/billing
2. Click "Upgrade Your Account"
3. Add $20 credit
4. Try purchasing local number again
```

### Option 2: Contact Twilio Support
```
1. Go to: https://www.twilio.com/help/contact
2. Select "Account Management"
3. Explain: "Cannot purchase local phone number"
4. They can unlock your account
```

### Option 3: Check Console Notifications
```
1. Go to: https://www.twilio.com/console
2. Look for red banner notifications
3. Follow any verification steps shown
```

---

## 📱 Alternative: Use Current Setup

**Keep using verified number for ALL notifications:**
- ✅ Already configured (done above)
- ✅ Working immediately
- ✅ All booking SMS go to 816-217-1094
- ✅ You can text DJs manually
- ✅ Email still goes to each provider

**This is perfectly fine for now!**

---

## 🔧 When You Get the New Number

**Tell me the new number and I'll:**
1. Update `.dev.vars` with new TWILIO_PHONE_NUMBER
2. Restart the service
3. Send test SMS
4. Update provider phone numbers (if you want individual numbers)

**Format**: `+1XXXXXXXXXX` (example: `+18165551234`)

---

## 🎯 Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Twilio Account | ✅ Active | Trial account verified |
| Toll-Free Number | ❌ Blocked | Can't send SMS (error 30044/30032) |
| Local Number | ⏳ Pending | Need to purchase |
| Verified Number | ✅ Working | 816-217-1094 can receive |
| Email Notifications | ✅ Working | All providers get email |
| SMS Notifications | 🔄 Temporary | All going to 816-217-1094 |

---

## 📞 Twilio Support Contact

If you're stuck:
- **Phone**: +1 (888) 908-9454
- **Email**: help@twilio.com
- **Console**: https://www.twilio.com/help/contact
- **Live Chat**: Available in console

Tell them: *"I need to purchase a local US phone number with SMS capability for business notifications, but the purchase is being blocked."*

---

## 🎉 Quick Win

**You can use the system RIGHT NOW** with the verified number setup!

When someone books:
1. ✅ Client gets email confirmation
2. ✅ Provider gets email notification  
3. ✅ **YOU get SMS alert** (all bookings)
4. ✅ You forward info to the right DJ

**It works! Just not automated to individual DJs yet.**

---

**Last Updated**: December 19, 2025  
**Status**: Temporary solution active, researching local number purchase
