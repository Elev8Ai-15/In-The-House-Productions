# 🗺️ BOOKING SYSTEM IMPLEMENTATION ROADMAP

## Status: Foundation Complete ✅

**Current State**: Database schema designed, logic documented, providers configured  
**Next Phase**: Backend API + Calendar Integration + Notifications

---

## 📋 IMPLEMENTATION PHASES

### Phase 1: Backend API (High Priority) 🔴
**Estimate**: 2-3 hours  
**Status**: Ready to start

#### Tasks:
1. ✅ Database migrations complete
2. ⏳ Implement booking availability API
   - DJ double-booking logic
   - Photobooth 2-unit logic
   - Real-time availability checks
3. ⏳ Implement booking creation API
   - Validation and conflict checking
   - Time slot allocation
   - Payment integration
4. ⏳ Update existing availability endpoints
   - Add DJ time slot details
   - Add photobooth unit allocation

#### Files to Modify:
- `src/index.tsx` - Add new API endpoints
- Test with curl commands

---

### Phase 2: Notification System (High Priority) 🔴
**Estimate**: 1-2 hours  
**Status**: Waiting for API keys

#### Tasks:
1. ⏳ Set up Resend API integration (email)
2. ⏳ Set up Twilio API integration (SMS)
3. ⏳ Create notification templates
   - Client confirmation email
   - Provider notification email
   - Client confirmation SMS
   - Provider notification SMS
4. ⏳ Implement notification sending logic
5. ⏳ Add notification tracking to database

#### Required:
- **Resend API Key** from https://resend.com
- **Twilio Credentials** from https://twilio.com

#### Files to Modify:
- `src/index.tsx` - Add notification functions
- `.dev.vars` - Add real API keys (when available)

---

### Phase 3: Calendar Integration (High Priority) 🔴
**Estimate**: 2-3 hours  
**Status**: Can start after Phase 1

#### Tasks:
1. ⏳ Update calendar page for DJ services
   - Show real-time availability
   - Display time slots (morning/evening/full)
   - Handle double-booking scenarios
2. ⏳ Create calendar page for Photobooth
   - Show unit availability
   - Auto-assign units
3. ⏳ Add time selection interface
   - Start time picker
   - End time picker
   - Duration calculator
4. ⏳ Real-time availability refresh
   - WebSocket or polling
   - Lock mechanism during selection

#### Files to Modify:
- `src/index.tsx` - Update `/calendar` route
- Add `/calendar-photobooth` route
- Add JavaScript for time selection

---

### Phase 4: Event Details Form (Medium Priority) 🟡
**Estimate**: 1-2 hours  
**Status**: Can start after Phase 3

#### Tasks:
1. ⏳ Create event details form page
   - Event name and type
   - Address and location
   - Guest count
   - Special requests
2. ⏳ Add music preferences (DJ only)
   - Genre preferences
   - Do-not-play list
   - Special song requests
3. ⏳ Add wedding-specific fields (if applicable)
   - Bride/Groom names
   - Bridal party list
   - VIP family members
4. ⏳ Form validation and submission

#### Files to Create:
- `/event-details` route in `src/index.tsx`

---

### Phase 5: Payment Integration (High Priority) 🔴
**Estimate**: 1-2 hours  
**Status**: Can start after Phase 4

#### Tasks:
1. ⏳ Update Stripe checkout to include booking data
2. ⏳ Add booking creation in webhook handler
3. ⏳ Link Stripe session to booking record
4. ⏳ Trigger notifications after payment success
5. ⏳ Handle payment failures and rollbacks

#### Files to Modify:
- `src/index.tsx` - Update `/api/checkout/create-session`
- Update `/api/webhook/stripe` for booking creation

---

### Phase 6: Testing & Refinement (High Priority) 🔴
**Estimate**: 2-3 hours  
**Status**: After all phases complete

#### Tasks:
1. ⏳ End-to-end booking flow test (DJ)
2. ⏳ End-to-end booking flow test (Photobooth)
3. ⏳ Test double-booking scenarios
4. ⏳ Test concurrent photobooth bookings
5. ⏳ Test notification delivery
6. ⏳ Test payment + booking creation
7. ⏳ Test error handling and edge cases

---

## 🎯 CRITICAL PATH

```
Phase 1: Backend API (✅ can start now)
    ↓
Phase 2: Notifications (⚠️ needs API keys)
    ↓
Phase 3: Calendar Integration
    ↓
Phase 4: Event Details Form
    ↓
Phase 5: Payment Integration
    ↓
Phase 6: Testing
```

---

## 🔑 REQUIRED API KEYS

### For Development:
1. **Resend** (Email Notifications)
   - Sign up: https://resend.com
   - Get API key: https://resend.com/api-keys
   - Add to `.dev.vars`: `RESEND_API_KEY=re_...`

2. **Twilio** (SMS Notifications)
   - Sign up: https://www.twilio.com
   - Get credentials: https://console.twilio.com
   - Add to `.dev.vars`:
     - `TWILIO_ACCOUNT_SID=AC...`
     - `TWILIO_AUTH_TOKEN=...`
     - `TWILIO_PHONE_NUMBER=+1...`

3. **Stripe** (Already configured, needs real keys)
   - Test mode keys for development
   - Production keys for deployment

---

## 📦 DEPENDENCIES TO ADD

```bash
# For notifications (when implementing Phase 2)
npm install resend twilio

# Optional: For date/time handling
npm install date-fns
```

---

## 🚀 RECOMMENDED NEXT STEPS

### Option A: Full Implementation (All Phases)
**Time**: 8-12 hours total  
**Requires**: All API keys  
**Result**: Complete booking system with notifications

### Option B: Core Booking Only (Phases 1, 3, 4, 5)
**Time**: 6-8 hours  
**Requires**: Stripe keys only  
**Result**: Working booking system, add notifications later

### Option C: Incremental Approach
**Start with**: Phase 1 (Backend API)  
**Then**: Phase 3 (Calendar)  
**Then**: Get API keys and add notifications  
**Benefit**: See progress faster, test as you go

---

## 💡 IMPLEMENTATION NOTES

### For DJ Double-Booking:
- Check existing bookings on date
- If 1 booking exists, check if it's morning slot
- Calculate 3-hour gap from end time
- Allow evening booking only if gap is sufficient

### For Photobooth:
- Check both Unit 1 and Unit 2
- Auto-assign first available unit
- Show "Both units booked" if neither available

### For Notifications:
- Always send to both client AND provider
- Use database to track notification status
- Implement retry logic for failures
- Consider fallback: email if SMS fails

---

## 📊 SUCCESS CRITERIA

- [ ] DJs can be double-booked (morning + evening with 3hr gap)
- [ ] Photobooth units work independently (2 concurrent bookings)
- [ ] Real-time availability updates in calendar
- [ ] Booking blocks dates immediately
- [ ] Notifications sent to client AND provider
- [ ] Payment integrates with booking creation
- [ ] All edge cases handled gracefully

---

## 🛠️ QUICK START

To begin implementation:

```bash
# 1. Ensure database is migrated
npm run db:migrate:local

# 2. Start development server
pm2 restart webapp

# 3. Begin Phase 1 implementation
# Edit src/index.tsx and add booking API endpoints
```

---

**Status**: 📋 Roadmap Complete  
**Foundation**: ✅ Ready  
**Next**: Start Phase 1 (Backend API)  
**Last Updated**: December 19, 2025
