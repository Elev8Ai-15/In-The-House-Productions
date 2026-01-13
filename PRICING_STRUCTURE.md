# 💰 Pricing Structure - In The House Productions

**Last Updated**: January 13, 2026  
**Status**: ✅ Implemented & Deployed  
**Production URL**: https://8c94742d.webapp-2mf.pages.dev

---

## 📋 Complete Pricing Overview

### 🎧 DJ Services

#### Parties & Corporate Events
- **Base Price**: $500
- **Duration**: Up to 4 hours
- **Additional Hours**: $100 per hour

#### Weddings
- **Base Price**: $850
- **Duration**: Up to 5 hours
- **Additional Hours**: $100 per hour

#### Available DJs
1. **DJ Cease (Mike Cecil)** - Priority #1 (Auto-selected)
2. **DJ Elev8 (Brad Powell)** - Priority #2
3. **TKOtheDJ (Joey Tate)** - Priority #3

All DJs have the same pricing structure. Selection determines availability and priority booking.

---

### 📸 Photobooth Services

#### Unlimited Strips Package
- **Base Price**: $500
- **Duration**: 4 hours
- **Print Type**: Unlimited 2x6 photo strips
- **Additional Hours**: $100 per hour

#### 4x6 Prints Package
- **Base Price**: $550
- **Duration**: 4 hours
- **Print Type**: Unlimited 4x6 photo prints
- **Additional Hours**: $100 per hour

#### Available Units
- **Unit 1**: Professional photobooth with instant printing
- **Unit 2**: Professional photobooth with instant printing

Both units can be booked simultaneously for larger events (double the price).

---

### ⭐ Add-On Services

#### Karaoke Setup
- **Price**: $100 per 4-hour event
- **Additional Hours**: $50 per hour
- **Includes**: Professional karaoke system with extensive song library

#### Uplighting
- **Price**: $100 per 4-hour event
- **Additional Hours**: $50 per hour
- **Includes**: Up to 6 LED uplights with customizable colors

#### Foam Pit Rental
- **Price**: $500 per 4-hour event
- **Includes**: Commercial foam machine and setup
- **Additional Hours**: $100 per hour

#### Wedding Photography
- **Price**: Info on request
- **Package**: Custom packages available
- **Contact**: Through event details form

#### Event Coordinator
- **Price**: Info on request
- **Package**: Custom packages available
- **Contact**: Through event details form

---

## 💻 Technical Implementation

### Backend Configuration (`src/index.tsx`)

```typescript
const servicePricing = {
  // DJ Services
  dj: {
    party: {
      basePrice: 500,      // Up to 4 hours
      baseHours: 4,
      hourlyRate: 100      // $100 per additional hour
    },
    wedding: {
      basePrice: 850,      // Up to 5 hours
      baseHours: 5,
      hourlyRate: 100      // $100 per additional hour
    }
  },
  
  // Individual DJ pricing
  dj_cease: {
    basePrice: 500,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4
  },
  dj_elev8: {
    basePrice: 500,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4
  },
  tko_the_dj: {
    basePrice: 500,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4
  },
  
  // Photobooth Services
  photobooth_unit1: {
    basePrice: 500,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4,
    printType: 'strips'
  },
  photobooth_unit2: {
    basePrice: 500,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4,
    printType: 'strips'
  },
  photobooth_4x6: {
    basePrice: 550,
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4,
    printType: '4x6'
  },
  
  // Add-on Services
  karaoke: {
    basePrice: 100,
    baseHours: 4,
    hourlyRate: 50         // $50 per additional hour
  },
  uplighting: {
    basePrice: 100,
    baseHours: 4,
    hourlyRate: 50         // $50 per additional hour
  }
}
```

### Frontend Display

#### DJ Services Card
```html
<div style="background: rgba(227, 30, 36, 0.15); border: 2px solid var(--primary-red); border-radius: 8px; padding: 1rem; margin: 1rem 0;">
    <p style="font-size: 1.5rem; font-weight: bold; color: var(--primary-red); text-align: center;">Starting at $500</p>
    <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center;">Parties (up to 4 hrs)</p>
    <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center;">Weddings: $850 (up to 5 hrs)</p>
    <p style="font-size: 0.8rem; color: #999; text-align: center;">$100/hr additional</p>
</div>
```

#### Photobooth Card
```html
<div style="background: rgba(227, 30, 36, 0.15); border: 2px solid var(--primary-red); border-radius: 8px; padding: 1rem; margin: 1rem 0;">
    <p style="font-size: 1.5rem; font-weight: bold; color: var(--primary-red); text-align: center;">Starting at $500</p>
    <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center;">4 hours unlimited strips</p>
    <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center;">4x6 Prints: $550 (4 hrs)</p>
    <p style="font-size: 0.8rem; color: #999; text-align: center;">$100/hr additional</p>
</div>
```

---

## 📊 Pricing Calculation Examples

### Example 1: Party DJ Service (6 hours)
- Base: $500 (4 hours included)
- Additional: 2 hours × $100 = $200
- **Total**: $700

### Example 2: Wedding DJ Service (8 hours)
- Base: $850 (5 hours included)
- Additional: 3 hours × $100 = $300
- **Total**: $1,150

### Example 3: Photobooth with Strips (6 hours)
- Base: $500 (4 hours included)
- Additional: 2 hours × $100 = $200
- **Total**: $700

### Example 4: Photobooth with 4x6 Prints (4 hours)
- Base: $550 (4 hours included)
- Additional: 0 hours
- **Total**: $550

### Example 5: Complete Package (Wedding DJ + Photobooth + Add-ons)
- Wedding DJ (8 hrs): $850 + $300 = $1,150
- Photobooth 4x6 (6 hrs): $550 + $200 = $750
- Karaoke: $100
- Uplighting: $100
- **Total**: $2,100

---

## 🎯 Business Rules

### DJ Services
1. **Event Type Matters**: Weddings automatically use $850 base price; all other events use $500
2. **Minimum Hours**: 4 hours minimum booking
3. **Double-Booking Prevention**: Smart scheduling prevents conflicts
4. **Priority System**: DJ Cease → DJ Elev8 → TKOtheDJ

### Photobooth Services
1. **Print Type Selection**: Customers choose between strips ($500) or 4x6 ($550)
2. **Concurrent Bookings**: Both units can be booked simultaneously
3. **Minimum Hours**: 4 hours minimum booking
4. **Unlimited Prints**: No per-print charges

### Add-On Services
1. **Per Event Pricing**: $100 flat rate per 4-hour event
2. **Additional Hours**: Included in base service additional hour rate
3. **Availability**: Must be booked with DJ or Photobooth service

---

## 🔄 Future Enhancements

### Potential Features
- [ ] Dynamic pricing based on demand (surge pricing)
- [ ] Seasonal discounts and promotions
- [ ] Package deals (DJ + Photobooth bundles)
- [ ] Loyalty program for repeat customers
- [ ] Early bird discounts for advance bookings
- [ ] Multi-day event packages

### Suggested Packages
- **Basic Party Package**: DJ (4 hrs) = $500
- **Standard Party Package**: DJ (4 hrs) + Karaoke = $600
- **Premium Party Package**: DJ (4 hrs) + Photobooth (4 hrs) = $1,000
- **Ultimate Party Package**: DJ (6 hrs) + Photobooth (6 hrs) + Karaoke + Uplighting = $1,600

- **Basic Wedding Package**: DJ (5 hrs) = $850
- **Standard Wedding Package**: DJ (5 hrs) + Photobooth (4 hrs) = $1,350
- **Premium Wedding Package**: DJ (8 hrs) + Photobooth (6 hrs) + Uplighting = $1,950
- **Ultimate Wedding Package**: DJ (8 hrs) + Photobooth (6 hrs) + Karaoke + Uplighting + Coordinator = Custom Quote

---

## 📝 Notes

### Current Status
- ✅ All pricing implemented in backend
- ✅ All pricing displayed on frontend
- ✅ Calculation logic working correctly
- ✅ Stripe integration ready (mock mode)
- ✅ Event type detection working (wedding vs party)

### Testing Checklist
- [x] Backend pricing configuration
- [x] Frontend pricing display
- [x] Wedding pricing calculation
- [x] Party pricing calculation
- [x] Photobooth pricing (strips)
- [x] Photobooth pricing (4x6)
- [x] Add-on pricing (Karaoke)
- [x] Add-on pricing (Uplighting)
- [x] Additional hours calculation
- [ ] Stripe checkout with real prices (pending production keys)

### Contact Information
- **Primary Contact**: DJ Cease (Mike Cecil)
- **Booking**: Through website event details form
- **Questions**: Use contact form or call directly

---

**Document Version**: 1.0  
**Git Commit**: c0b40d2  
**Deployment**: https://8c94742d.webapp-2mf.pages.dev  
**GitHub**: https://github.com/Elev8Ai-15/In-The-House-Productions
