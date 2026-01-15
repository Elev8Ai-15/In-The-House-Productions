# 📅 BOOKING LOGIC & RULES

## DJ Booking Rules

### Single Booking (Default)
- **Any event starting at or after 11:00 AM** = Full day booking
- Entire day is blocked for that DJ

### Double Booking (Special Case)
- **Only allowed** if first event is early morning
- **First Event**: Must END by a specific time
- **Gap Required**: Minimum 3 hours between events
- **Second Event**: Can start in evening

#### Example Valid Double Booking:
```
Event 1: 8:00 AM - 12:00 PM (4 hours)
Gap:     12:00 PM - 3:00 PM (3 hours minimum)
Event 2: 3:00 PM - 11:00 PM (allowed)
```

#### Double Booking Logic:
1. **First Event End Time** ≤ 11:00 AM = Morning slot
2. **Gap Calculation**: End of Event 1 + 3 hours = Earliest start for Event 2
3. **Second Event Start Time** ≥ (First Event End + 3 hours)

### Availability Check Algorithm (DJ):
```javascript
function checkDJAvailability(djId, date, startTime, endTime) {
  // Get existing bookings for this DJ on this date
  const existingBookings = getBookingsForDate(djId, date);
  
  if (existingBookings.length === 0) {
    return { available: true, slotType: determineSlotType(startTime) };
  }
  
  if (existingBookings.length === 1) {
    const existing = existingBookings[0];
    
    // Check if existing is morning slot
    if (existing.slot_type === 'morning' && existing.end_time <= '11:00') {
      // Calculate minimum start time for second event
      const minStart = addHours(existing.end_time, 3);
      
      if (startTime >= minStart && startTime >= '14:00') {
        return { available: true, slotType: 'evening' };
      }
    }
    
    // Check if new booking is morning and existing allows evening
    if (endTime <= '11:00' && !existing.slot_type === 'full_day') {
      const minStart = addHours(endTime, 3);
      if (existing.start_time >= minStart && existing.start_time >= '14:00') {
        return { available: true, slotType: 'morning' };
      }
    }
    
    return { available: false, reason: 'DJ already booked for this day' };
  }
  
  // If 2 bookings exist, day is fully booked
  return { available: false, reason: 'DJ has maximum bookings for this day' };
}

function determineSlotType(startTime) {
  if (startTime < '11:00') {
    return 'morning';
  } else if (startTime >= '14:00') {
    return 'evening';
  } else {
    return 'full_day';
  }
}
```

---

## Photobooth Booking Rules

### Two Units Available
- **Unit 1**: Maria Cecil
- **Unit 2**: Cora Scarborough

### Concurrent Booking Logic:
- Each unit can have **one booking per day**
- **Both units can be booked simultaneously** on the same date
- Each unit operates independently

### Availability Check Algorithm (Photobooth):
```javascript
function checkPhotoboothAvailability(date, startTime, endTime) {
  // Get bookings for both units on this date
  const unit1Bookings = getBookingsForDate('photobooth_unit1', date);
  const unit2Bookings = getBookingsForDate('photobooth_unit2', date);
  
  // Check Unit 1 availability
  if (unit1Bookings.length === 0) {
    return { 
      available: true, 
      unit: 'photobooth_unit1',
      operator: 'Maria Cecil'
    };
  }
  
  // Check Unit 2 availability
  if (unit2Bookings.length === 0) {
    return { 
      available: true, 
      unit: 'photobooth_unit2',
      operator: 'Cora Scarborough'
    };
  }
  
  // Both units booked
  return { 
    available: false, 
    reason: 'Both photobooth units are booked for this date' 
  };
}
```

---

## Real-Time Availability Display

### Calendar View Logic:
```javascript
function getMonthAvailability(provider, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const availability = {};
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${month}-${day}`;
    
    if (provider.startsWith('dj_')) {
      availability[date] = checkDJDateAvailability(provider, date);
    } else if (provider === 'photobooth') {
      availability[date] = checkPhotoboothDateAvailability(date);
    }
  }
  
  return availability;
}

function checkDJDateAvailability(djId, date) {
  const bookings = getBookingsForDate(djId, date);
  
  if (bookings.length === 0) {
    return { available: true, slots: 2, remainingSlots: 2 };
  } else if (bookings.length === 1) {
    const booking = bookings[0];
    if (booking.slot_type === 'morning' && booking.end_time <= '11:00') {
      return { available: true, slots: 2, remainingSlots: 1, bookedSlot: 'morning' };
    } else {
      return { available: false, slots: 2, remainingSlots: 0, bookedSlot: 'full_day' };
    }
  } else {
    return { available: false, slots: 2, remainingSlots: 0, bookedSlot: 'both' };
  }
}

function checkPhotoboothDateAvailability(date) {
  const unit1Booked = getBookingsForDate('photobooth_unit1', date).length > 0;
  const unit2Booked = getBookingsForDate('photobooth_unit2', date).length > 0;
  
  if (!unit1Booked && !unit2Booked) {
    return { available: true, capacity: 2, remainingSlots: 2 };
  } else if (!unit1Booked || !unit2Booked) {
    return { available: true, capacity: 2, remainingSlots: 1 };
  } else {
    return { available: false, capacity: 2, remainingSlots: 0 };
  }
}
```

---

## Notification System

### Trigger Points:
1. **Booking Confirmed** (after payment)
2. **Booking Modified**
3. **Booking Cancelled**
4. **Reminder (24 hours before event)**

### Recipients:
1. **Client** (user who made booking)
2. **Service Provider** (DJ or Photobooth operator)

### Notification Types:

#### Email Notifications (Resend API)
```javascript
async function sendBookingConfirmationEmail(booking, client, provider) {
  const emailData = {
    to: [client.email, provider.email],
    from: 'noreply@inthehouseproductions.com',
    subject: `Booking Confirmed: ${booking.event_name} on ${booking.event_date}`,
    html: generateBookingEmailHTML(booking, client, provider)
  };
  
  return await resend.emails.send(emailData);
}
```

#### SMS Notifications (Twilio API)
```javascript
async function sendBookingSMS(booking, recipient) {
  const message = `
In The House Productions:
Booking confirmed for ${booking.event_name} on ${formatDate(booking.event_date)}.
Event: ${booking.event_start_time} - ${booking.event_end_time}
Location: ${booking.street_address}, ${booking.city}
  `.trim();
  
  return await twilio.messages.create({
    to: recipient.phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: message
  });
}
```

### Notification Content:

#### For Client:
- Booking confirmation number
- Service provider name and contact
- Event date, time, and location
- Total price and payment status
- Cancellation policy
- Contact information for support

#### For Service Provider:
- Client name and contact information
- Event date, time, and location
- Event type and guest count
- Special requests / music preferences
- Do-not-play list
- VIP information (if wedding)

---

## Database Schema

### bookings table:
- Stores main booking information
- Links to user, event details, and payment

### booking_time_slots table:
- Tracks specific time slots for DJ double-booking
- `slot_type`: 'morning', 'evening', 'full_day'
- Actual start/end times for gap calculation

### notifications table:
- Tracks all sent notifications
- Status tracking (pending, sent, failed)
- Links to booking for history

### provider_contacts table:
- Contact information for each DJ and photobooth operator
- Notification preferences
- Active status

---

## API Endpoints

### Availability Check:
```
POST /api/availability/check
Body: { provider, date, startTime, endTime }
Response: { available, reason, suggestedAlternatives }
```

### Get Monthly Availability:
```
GET /api/availability/:provider/:year/:month
Response: { [date]: { available, slots, remainingSlots } }
```

### Create Booking:
```
POST /api/bookings/create
Body: { userId, provider, date, startTime, endTime, eventDetails }
Response: { bookingId, confirmationNumber, notifications }
```

### Send Notifications:
```
POST /api/notifications/send
Body: { bookingId, types: ['email', 'sms'] }
Response: { sent, failed, details }
```

---

## Edge Cases & Handling

### 1. Booking Conflicts:
- Real-time availability check before payment
- Lock mechanism during checkout process
- Rollback if payment fails

### 2. Time Zone Handling:
- All times stored in local event timezone
- Display times in user's timezone
- Clear timezone indication in notifications

### 3. Cancellation Rules:
- Within 24 hours: No refund
- 24-48 hours: 50% refund
- 48+ hours: Full refund

### 4. Notification Failures:
- Retry mechanism (3 attempts)
- Fallback to email if SMS fails
- Admin notification for persistent failures

### 5. Manual Overrides:
- Admin can block specific dates
- Admin can override double-booking rules
- Logged in availability_blocks table

---

**Status**: Ready for implementation  
**Last Updated**: December 19, 2025
