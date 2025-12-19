# In The House Productions - Web Application Design Specification

## Document Version: 1.0
**Last Updated:** 2025-11-18  
**Project Code Name:** webapp  
**Client:** In The House Productions

---

## Table of Contents
1. [Application Overview](#1-application-overview)
2. [User Flows](#2-user-flows)
3. [UI/UX Design Specifications](#3-uiux-design-specifications)
4. [Core Feature Breakdown](#4-core-feature-breakdown)
5. [Technical Considerations](#5-technical-considerations)
6. [Future Expansion Points](#6-future-expansion-points)
7. [Development Roadmap](#7-development-roadmap)

---

## 1. Application Overview

### 1.1 Project Context
**In The House Productions** is a mobile entertainment company providing DJ and Photobooth services for events. The web application serves as a comprehensive booking and project management system that:

- Streamlines client booking processes
- Manages service provider availability
- Organizes event details and project information
- Provides an engaging, themed user experience

**Target Audience:**
- Primary: Clients seeking DJ and/or Photobooth services for events
- Secondary: Internal staff managing bookings and service providers

### 1.2 Business Goals
1. Reduce booking friction with intuitive interface
2. Prevent double-booking conflicts automatically
3. Provide transparent service provider information
4. Create memorable brand experience through retro music theme
5. Centralize event management for internal operations

### 1.3 Technical Approach
**Platform:** Cloudflare Pages + Hono Framework  
**Storage:** Cloudflare D1 Database (relational data)  
**Frontend:** Vanilla JavaScript + TailwindCSS  
**Theme:** 80's/90's/2000's music era aesthetic

---

## 2. User Flows

### 2.1 New Client Booking Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         LANDING PAGE                             │
│  - Dynamic musical notes background                              │
│  - Two main cards: [DJ Services] [Photobooth]                   │
│  - "Get Started" call-to-action                                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ACCOUNT CREATION (Mandatory)                  │
│  Required Fields:                                                │
│  - Full Name                                                     │
│  - Email Address                                                 │
│  - Phone Number                                                  │
│  - Password                                                      │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICE SELECTION                             │
│  Two Options:                                                    │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  DJ SERVICES     │  │   PHOTOBOOTH     │                    │
│  │  [Select]        │  │   [Select]       │                    │
│  └──────────────────┘  └──────────────────┘                    │
└────────────────┬────────────────────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
┌─────────────┐   ┌─────────────┐
│ DJ PROFILES │   │ PHOTOBOOTH  │
│             │   │   PROFILE   │
└──────┬──────┘   └──────┬──────┘
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ DJ SELECTION│   │   CALENDAR  │
│ (Default or │   │  SELECTION  │
│  ❤️ Override)│   │             │
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CALENDAR SELECTION                            │
│  - Interactive calendar showing available dates                  │
│  - Red dates: Fully booked                                       │
│  - Chrome/Silver dates: Available                                │
│  - Black dates: Past dates (disabled)                            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT DETAILS FORM                            │
│  Required Information:                                           │
│  - Event Name                                                    │
│  - Event Address (Street, City, State, ZIP)                     │
│  - Event Date (pre-filled from calendar)                         │
│  - Event Type (Wedding, Birthday, Corporate, etc.)              │
│  - Event Start Time                                              │
│  - Event End Time                                                │
│  - Number of Guests (estimate)                                   │
│                                                                  │
│  Optional Information:                                           │
│  - Special Requests/Notes                                        │
│  - Bridal Party Names (for weddings)                            │
│  - Family Member Names (VIPs)                                    │
│  - Music Preferences                                             │
│  - Do Not Play List                                              │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BOOKING CONFIRMATION                          │
│  - Review all details                                            │
│  - Service provider assigned                                     │
│  - Total estimated price                                         │
│  - [Confirm Booking] button                                      │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIRMATION PAGE                             │
│  - Booking confirmation number                                   │
│  - Email/SMS confirmation sent                                   │
│  - Next steps information                                        │
│  - Link to client dashboard                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Returning Client Flow

```
Landing Page → Login → Client Dashboard → View/Edit Bookings
```

### 2.3 Admin/Staff Flow

```
Landing Page → Admin Login → Admin Dashboard → Manage All Services
  ├─ View All Bookings
  ├─ Manage DJ Availability
  ├─ Manage Photobooth Availability
  ├─ View Client Details
  └─ Generate Reports
```

---

## 3. UI/UX Design Specifications

### 3.1 Color Palette (Strict Adherence Required)

**Primary Colors:**
```css
--primary-red: #E31E24;        /* Vibrant Red */
--deep-red: #8B0000;           /* Dark Red (accents) */
--pure-black: #000000;         /* True Black */
--off-black: #0A0A0A;          /* Slightly lighter black */

--chrome-silver: #C0C0C0;      /* Chrome Silver */
--metallic-chrome: #E8E8E8;    /* Light Chrome */
--dark-chrome: #808080;        /* Dark Chrome/Gray */

--accent-neon: #FF0040;        /* Neon Red (highlights) */
--glow-white: #FFFFFF;         /* Pure White (text/glow) */
```

**Color Usage Guidelines:**
- **Backgrounds:** Primarily black (#000000) with gradient overlays
- **Primary CTAs:** Red (#E31E24) with chrome borders
- **Secondary Elements:** Chrome/silver tones
- **Text:** White on dark backgrounds, black on light backgrounds
- **Hover States:** Neon red glow effects
- **Disabled States:** Dark chrome (#808080)

### 3.2 Typography

**Font Stack:**
```css
/* Headers - Bold, Retro Feel */
--font-heading: 'Bebas Neue', 'Impact', sans-serif;

/* Body - Clean, Readable */
--font-body: 'Roboto', 'Helvetica Neue', Arial, sans-serif;

/* Accent - Retro 80s Style */
--font-accent: 'Orbitron', 'Courier New', monospace;
```

**Type Scale:**
- H1 (Page Titles): 48px, Bold, Letter-spacing: 2px
- H2 (Section Headers): 36px, Bold, Letter-spacing: 1.5px
- H3 (Card Titles): 24px, Semi-Bold
- Body: 16px, Regular
- Small/Caption: 14px, Regular

### 3.3 Visual Theme: 80's/90's/2000's Music Era

**Design Elements:**
1. **Cassette Tape Motifs:** Loading animations, progress bars
2. **Vinyl Record Graphics:** Circular navigation elements
3. **Boombox Aesthetics:** Audio player-inspired controls
4. **Neon Glow Effects:** Text shadows, border glows
5. **Geometric Patterns:** Sharp angles, grid overlays
6. **Retro Gradients:** Red-to-black, chrome reflections

**Animation Style:**
- Smooth transitions (300-500ms)
- Bounce/elastic easing for playful feel
- Glow pulse effects on interactive elements
- Slide-in animations from sides

### 3.4 Dynamic Musical Notes Background

**Specification:**
```javascript
// Background Animation Requirements
{
  element: "Animated Canvas Background",
  features: [
    "Musical staff (5 horizontal lines) spanning viewport",
    "Musical notes (♪ ♫ ♬) floating along staff",
    "Notes move from right to left continuously",
    "Random note types and positions",
    "Parallax effect (multiple layers at different speeds)",
    "Color scheme: Red and chrome notes with subtle glow",
    "Opacity: 15-30% to avoid overwhelming foreground content",
    "Performance: Hardware-accelerated, 60fps"
  ],
  colors: [
    "rgba(227, 30, 36, 0.2)",  // Red notes
    "rgba(192, 192, 192, 0.3)", // Chrome notes
    "rgba(255, 255, 255, 0.1)"  // Glow effect
  ],
  animation: {
    speed: "Slow (20-40 seconds per note crossing)",
    variation: "Random vertical positions within staff",
    interaction: "Notes subtly react to cursor proximity (optional)"
  }
}
```

**Implementation Notes:**
- Use HTML5 Canvas API for smooth animation
- Implement requestAnimationFrame for performance
- Ensure mobile responsiveness (reduced complexity on mobile)
- Add preference toggle for users sensitive to motion

### 3.5 UI Component Specifications

#### 3.5.1 Service Selection Cards

```
┌─────────────────────────────────────────┐
│  ┌─────────────────────────────────┐   │
│  │   [AI-Generated DJ Image]       │   │
│  │   (Retro DJ with turntables)    │   │
│  └─────────────────────────────────┘   │
│                                         │
│        🎵 DJ SERVICES 🎵                │
│                                         │
│  "Spin the perfect soundtrack for      │
│   your unforgettable night"            │
│                                         │
│     [SELECT SERVICE →]                  │
│                                         │
└─────────────────────────────────────────┘

Styling:
- Border: 3px solid chrome with red glow on hover
- Background: Black with subtle gradient
- Corner Style: Slightly beveled (retro effect)
- Shadow: Large chrome drop shadow
- Hover: Scale(1.05), increased glow intensity
```

#### 3.5.2 DJ Profile Cards

```
┌──────────────────────────────────────────────┐
│  ┌────────────────┐   ❤️ (Heart Icon)       │
│  │  [AI Profile]  │   Click to Select       │
│  │  [Photo]       │                         │
│  └────────────────┘                         │
│                                              │
│  DJ CEASE (Mike Cecil)                      │
│  ━━━━━━━━━━━━━━━━━━━                        │
│                                              │
│  🎧 Specialties:                            │
│  • Weddings & Special Events                │
│  • Top 40, Hip-Hop, R&B                     │
│  • 20+ Years Experience                     │
│                                              │
│  📝 Bio:                                     │
│  "Creating unforgettable moments through    │
│   music since 2003..."                      │
│                                              │
│  📅 Status: AVAILABLE / BOOKED              │
│                                              │
└──────────────────────────────────────────────┘

Heart Icon States:
- Default: Chrome outline, hollow
- Hover: Red glow pulse
- Selected: Filled red with glow effect
- Locked: Grayed out (if DJ unavailable on selected date)
```

#### 3.5.3 Calendar Component

```
┌──────────────────────────────────────────────────────┐
│           NOVEMBER 2025                              │
│                                                      │
│  SUN   MON   TUE   WED   THU   FRI   SAT            │
│  ─────────────────────────────────────────────       │
│   1     2     3     4     5     6     7             │
│  [ ]   [X]   [ ]   [ ]   [X]   [ ]   [ ]           │
│                                                      │
│   8     9    10    11    12    13    14             │
│  [ ]   [ ]   [X]   [ ]   [ ]   [X]   [ ]           │
│                                                      │
│  Legend:                                             │
│  [ ] Available (Chrome silver)                      │
│  [X] Fully Booked (Red)                             │
│  [░] Past Date (Dark, disabled)                     │
│  [■] Selected (Glowing red)                         │
│                                                      │
└──────────────────────────────────────────────────────┘

Interaction:
- Hover: Available dates scale slightly with chrome glow
- Click: Selected date pulses red, advances to form
- Unavailable: No hover effect, cursor: not-allowed
```

#### 3.5.4 Event Details Form

```
┌──────────────────────────────────────────────────────┐
│  📋 EVENT DETAILS                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                      │
│  Event Name *                                        │
│  [________________________]                          │
│                                                      │
│  Event Type *                                        │
│  [▼ Select Type        ]                            │
│    • Wedding                                         │
│    • Birthday Party                                  │
│    • Corporate Event                                 │
│    • Anniversary                                     │
│    • Other                                           │
│                                                      │
│  Event Address *                                     │
│  Street: [_________________]                         │
│  City: [__________] State: [___] ZIP: [_____]       │
│                                                      │
│  Event Date: November 15, 2025 ✓                    │
│                                                      │
│  Event Time *                                        │
│  Start: [▼ 6:00 PM] End: [▼ 11:00 PM]              │
│                                                      │
│  Number of Guests *                                  │
│  [___] guests (approximate)                          │
│                                                      │
│  ─────── Optional Details ───────                   │
│                                                      │
│  Special Requests                                    │
│  [________________________________]                  │
│  [________________________________]                  │
│                                                      │
│  For Weddings:                                       │
│  Bride: [______________] Groom: [______________]    │
│                                                      │
│  Bridal Party Names (Add as needed)                 │
│  [+] Add Bridal Party Member                        │
│                                                      │
│  VIP Family Members                                  │
│  [+] Add Family Member                              │
│                                                      │
│  Music Preferences                                   │
│  [________________________________]                  │
│                                                      │
│  Do Not Play List                                    │
│  [________________________________]                  │
│                                                      │
│     [BACK]           [CONTINUE →]                   │
│                                                      │
└──────────────────────────────────────────────────────┘

Styling:
- Input fields: Black background, chrome borders
- Focus state: Red border glow
- Labels: Chrome text
- Required fields (*): Red asterisk
- Buttons: Red with chrome borders, glow on hover
```

### 3.6 AI-Generated Visual Requirements

**All images must be generated with ultra-realistic quality using AI tools:**

#### Required Images:

1. **Landing Page Hero Images:**
   - DJ Services Card: Retro DJ with turntables, 80s/90s aesthetic, red/chrome lighting
   - Photobooth Card: Vintage photobooth setup, props, colorful backdrop

2. **DJ Profile Photos:**
   - DJ Cease (Mike Cecil): Professional portrait with DJ equipment
   - DJ Elev8 (Brad Powell): Professional portrait with DJ equipment
   - TKOtheDJ (Joey Tate): Professional portrait with DJ equipment
   - Style: High contrast, dramatic lighting, red/chrome color grading

3. **Photobooth Profile Photo:**
   - Maria Cecil & Cora Scarborough: Professional photo with photobooth equipment
   - Style: Fun, approachable, vibrant

4. **Background Elements:**
   - Cassette tape graphics
   - Vinyl record textures
   - Boombox silhouettes
   - Musical note icons (various styles)

5. **UI Decorative Elements:**
   - Chrome texture overlays
   - Neon glow effects
   - Geometric pattern backgrounds

**AI Generation Prompts Template:**
```
"Ultra-realistic professional portrait of [DJ NAME], 
standing with DJ turntables and equipment, 
dramatic lighting with red and chrome color scheme,
80s/90s music era aesthetic, 
high contrast photography style, 
black background with neon accents,
confident pose, professional attire,
cinematic quality, 4K resolution"
```

---

## 4. Core Feature Breakdown

### 4.1 User Authentication System

#### 4.1.1 Account Creation (Mandatory)

**Required Fields:**
- Full Name (validation: min 2 characters)
- Email Address (validation: valid email format, unique)
- Phone Number (validation: US format +1-XXX-XXX-XXXX)
- Password (validation: min 8 chars, 1 uppercase, 1 number)

**Database Schema:**
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'client', -- 'client' or 'admin'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
```

**Security Requirements:**
- Passwords hashed using bcrypt
- JWT tokens for session management
- Email verification (optional for v1, recommended for v2)

#### 4.1.2 Login System

- Email + Password authentication
- "Remember Me" option (extended JWT expiration)
- "Forgot Password" recovery flow
- Admin login separate route (/admin/login)

### 4.2 Service Selection Logic

#### 4.2.1 DJ Services Path

**Step 1: DJ Profile Display**

Display all three DJ profiles with:
- Profile photo (AI-generated)
- Name and stage name
- Bio (150-200 words)
- Specialties list
- Current availability indicator
- Heart icon for selection override

**Default Selection Algorithm:**
```javascript
function getDefaultDJ(selectedDate, userPreference = null) {
  if (userPreference !== null && isDJAvailable(userPreference, selectedDate)) {
    return userPreference; // User overrode with heart selection
  }
  
  // Priority order: DJ Cease → DJ Elev8 → TKOtheDJ
  const djPriority = ['dj_cease', 'dj_elev8', 'tko_the_dj'];
  
  for (const dj of djPriority) {
    if (isDJAvailable(dj, selectedDate)) {
      return dj;
    }
  }
  
  return null; // No DJs available on this date
}
```

**Heart Override Feature:**
- User can click heart icon on any DJ profile
- Heart fills with red glow animation
- Overrides default selection IF that DJ is available
- If selected DJ becomes unavailable, revert to default logic
- Visual feedback: "You've selected [DJ NAME] for your event!"

**DJ Information:**

```javascript
const djProfiles = {
  dj_cease: {
    name: "DJ Cease",
    realName: "Mike Cecil",
    bio: "With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event. Specializing in creating seamless musical journeys, Mike has mastered the art of reading the crowd and delivering exactly what the moment needs. From intimate gatherings to grand celebrations, DJ Cease ensures your event's soundtrack is nothing short of perfection.",
    specialties: [
      "Weddings & Special Events",
      "Top 40, Hip-Hop, R&B",
      "Crowd Reading & Energy Management",
      "Custom Playlist Curation",
      "20+ Years Experience"
    ],
    priority: 1
  },
  dj_elev8: {
    name: "DJ Elev8",
    realName: "Brad Powell",
    bio: "Brad Powell, known as DJ Elev8, elevates every event with his dynamic mixing style and vast musical knowledge. His ability to blend genres seamlessly while maintaining high energy keeps dance floors packed all night long. With a passion for creating memorable experiences, DJ Elev8 has become a sought-after name in the entertainment industry.",
    specialties: [
      "High-Energy Dance Events",
      "EDM, House, Top 40",
      "Corporate Events & Parties",
      "Creative Mixing & Transitions",
      "15+ Years Experience"
    ],
    priority: 2
  },
  tko_the_dj: {
    name: "TKOtheDJ",
    realName: "Joey Tate",
    bio: "Joey Tate, performing as TKOtheDJ, delivers knockout performances that leave lasting impressions. Known for his technical precision and creative approach, Joey brings fresh energy to the DJ scene. His versatility across genres and dedication to client satisfaction make him an excellent choice for any celebration.",
    specialties: [
      "Versatile Genre Mixing",
      "Birthday Parties & Celebrations",
      "Hip-Hop, Pop, Rock Classics",
      "Interactive Crowd Engagement",
      "10+ Years Experience"
    ],
    priority: 3
  }
};
```

#### 4.2.2 Photobooth Path

**Profile Information:**
```javascript
const photoboothProfile = {
  operators: "Maria Cecil & Cora Scarborough",
  bio: "Our professional photobooth service brings fun, laughter, and lasting memories to your event. With two state-of-the-art photobooth setups, we offer high-quality prints, digital sharing options, and a vast selection of props to match any theme. Maria and Cora ensure every guest leaves with a smile and a keepsake.",
  features: [
    "Two Professional Photobooth Units",
    "Unlimited Prints",
    "Digital Photo Gallery",
    "Custom Backdrops & Props",
    "On-Site Attendants",
    "Social Media Integration"
  ],
  capacity: 2 // Can book same date twice
};
```

**Availability Logic:**
- Track bookings per photobooth unit (unit_1, unit_2)
- Date remains available until both units are booked
- Visual indicator: "1 Photobooth Available" or "2 Photobooths Available"

### 4.3 Calendar Integration

#### 4.3.1 Calendar Database Schema

```sql
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_type TEXT NOT NULL, -- 'dj' or 'photobooth'
  service_provider TEXT NOT NULL, -- DJ name or 'photobooth_1'/'photobooth_2'
  event_date DATE NOT NULL,
  event_start_time TIME NOT NULL,
  event_end_time TIME NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'cancelled'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_bookings_date ON bookings(event_date);
CREATE INDEX idx_bookings_provider ON bookings(service_provider, event_date);
```

#### 4.3.2 Availability Calculation

**For DJ Services:**
```javascript
function getDJAvailability(djName, month, year) {
  // Query database for all bookings for this DJ
  const bookedDates = db.query(`
    SELECT event_date 
    FROM bookings 
    WHERE service_provider = ? 
    AND status != 'cancelled'
    AND strftime('%Y-%m', event_date) = ?
  `, [djName, `${year}-${month.toString().padStart(2, '0')}`]);
  
  return {
    availableDates: getAllDatesInMonth(month, year).filter(
      date => !bookedDates.includes(date) && date >= today
    ),
    bookedDates: bookedDates
  };
}
```

**For Photobooth:**
```javascript
function getPhotoboothAvailability(month, year) {
  // Count bookings per date
  const bookingCounts = db.query(`
    SELECT event_date, COUNT(*) as count
    FROM bookings 
    WHERE service_type = 'photobooth'
    AND status != 'cancelled'
    AND strftime('%Y-%m', event_date) = ?
    GROUP BY event_date
  `, [`${year}-${month.toString().padStart(2, '0')}`]);
  
  return {
    availableDates: getAllDatesInMonth(month, year).filter(date => {
      const bookingCount = bookingCounts[date] || 0;
      return bookingCount < 2 && date >= today;
    }),
    partiallyBookedDates: Object.keys(bookingCounts).filter(
      date => bookingCounts[date] === 1
    ),
    fullyBookedDates: Object.keys(bookingCounts).filter(
      date => bookingCounts[date] >= 2
    )
  };
}
```

#### 4.3.3 Calendar UI States

**Visual States:**
- **Available:** Chrome/silver background, clickable
- **Partially Booked (Photobooth only):** Yellow indicator, still clickable
- **Fully Booked:** Red background, not clickable
- **Past Date:** Dark gray, disabled
- **Selected:** Glowing red border, filled
- **Today:** Chrome border highlight

### 4.4 Event Details Form

#### 4.4.1 Database Schema

```sql
CREATE TABLE event_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  street_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  number_of_guests INTEGER,
  special_requests TEXT,
  music_preferences TEXT,
  do_not_play_list TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE wedding_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_detail_id INTEGER UNIQUE NOT NULL,
  bride_name TEXT,
  groom_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_detail_id) REFERENCES event_details(id)
);

CREATE TABLE bridal_party (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wedding_detail_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT, -- 'bridesmaid', 'groomsman', 'maid_of_honor', etc.
  FOREIGN KEY (wedding_detail_id) REFERENCES wedding_details(id)
);

CREATE TABLE vip_family (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_detail_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT,
  FOREIGN KEY (event_detail_id) REFERENCES event_details(id)
);
```

#### 4.4.2 Form Validation Rules

**Required Fields:**
- Event Name: min 3 characters
- Event Type: must select from dropdown
- Full Address: all fields required
- Event Date: auto-filled from calendar
- Event Times: start < end, minimum 2 hours
- Number of Guests: positive integer

**Optional Fields:**
- All other fields can be blank
- Dynamic "Add More" functionality for bridal party and VIP lists

#### 4.4.3 Form Submission Flow

```javascript
async function submitEventForm(formData) {
  // 1. Validate all required fields
  const validation = validateEventForm(formData);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors };
  }
  
  // 2. Create booking record
  const booking = await createBooking({
    user_id: currentUser.id,
    service_type: formData.serviceType,
    service_provider: formData.selectedProvider,
    event_date: formData.eventDate,
    event_start_time: formData.startTime,
    event_end_time: formData.endTime,
    status: 'pending'
  });
  
  // 3. Create event details
  const eventDetails = await createEventDetails({
    booking_id: booking.id,
    ...formData
  });
  
  // 4. If wedding, create wedding-specific details
  if (formData.eventType === 'wedding') {
    await createWeddingDetails({
      event_detail_id: eventDetails.id,
      bride_name: formData.brideName,
      groom_name: formData.groomName
    });
    
    // Add bridal party members
    for (const member of formData.bridalParty) {
      await addBridalPartyMember({
        wedding_detail_id: weddingDetails.id,
        name: member.name,
        role: member.role
      });
    }
  }
  
  // 5. Add VIP family members
  for (const vip of formData.vipFamily) {
    await addVIPFamilyMember({
      event_detail_id: eventDetails.id,
      name: vip.name,
      relationship: vip.relationship
    });
  }
  
  // 6. Send confirmation email
  await sendConfirmationEmail(currentUser, booking, eventDetails);
  
  // 7. Return success with booking ID
  return { 
    success: true, 
    bookingId: booking.id,
    confirmationNumber: generateConfirmationNumber(booking.id)
  };
}
```

### 4.5 Admin Dashboard

#### 4.5.1 Dashboard Overview

**Main Dashboard Sections:**

```
┌────────────────────────────────────────────────────────────┐
│  IN THE HOUSE PRODUCTIONS - ADMIN DASHBOARD               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  📊 QUICK STATS                                           │
│  ┌──────────────┬──────────────┬──────────────────────┐  │
│  │ Total        │ This Month   │ Upcoming (30 days)  │  │
│  │ Bookings: 47 │ Bookings: 12 │ Bookings: 8         │  │
│  └──────────────┴──────────────┴──────────────────────┘  │
│                                                            │
│  📅 CALENDAR VIEW                                         │
│  [Filter: All Services ▼] [Month: November ▼]           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Calendar with all bookings color-coded by service│  │
│  │  - Red: DJ Cease                                   │  │
│  │  - Blue: DJ Elev8                                  │  │
│  │  - Green: TKOtheDJ                                 │  │
│  │  - Purple: Photobooth                              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  📋 RECENT BOOKINGS                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Nov 15 | Wedding - Johnson/Smith | DJ Cease       │  │
│  │ Nov 18 | Birthday - Miller       | Photobooth     │  │
│  │ Nov 22 | Corporate - Tech Co     | DJ Elev8       │  │
│  └────────────────────────────────────────────────────┘  │
│  [View All Bookings →]                                    │
│                                                            │
│  👥 SERVICE PROVIDERS                                     │
│  ┌───────────┬───────────┬──────────────────────────┐   │
│  │ DJ Cease  │ DJ Elev8  │ TKOtheDJ                │   │
│  │ Available │ Booked    │ Available                │   │
│  │ Next: 11/20│ Next: 11/16│ Next: 11/25            │   │
│  └───────────┴───────────┴──────────────────────────┘   │
│                                                            │
│  📦 QUICK ACTIONS                                         │
│  [+ New Booking] [Manage Availability] [Reports]         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### 4.5.2 All Bookings Management

**Features:**
- Searchable/filterable booking list
- Sort by date, service type, status
- Quick actions: View, Edit, Cancel, Mark as Complete
- Export to CSV/PDF

**Booking Detail View:**
```
┌────────────────────────────────────────────────────────────┐
│  BOOKING #12345 - Johnson/Smith Wedding                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  📅 Event Information                                     │
│  Date: November 15, 2025                                  │
│  Time: 6:00 PM - 11:00 PM                                 │
│  Type: Wedding                                             │
│  Guests: 150                                               │
│                                                            │
│  📍 Location                                              │
│  The Grand Ballroom                                        │
│  123 Main Street                                           │
│  Springfield, IL 62701                                     │
│                                                            │
│  🎵 Service Provider                                      │
│  DJ Cease (Mike Cecil)                                    │
│  Status: Confirmed                                         │
│                                                            │
│  👤 Client Information                                    │
│  Name: John & Sarah Johnson                               │
│  Email: johnjohnson@email.com                             │
│  Phone: +1-555-123-4567                                   │
│                                                            │
│  💑 Wedding Details                                       │
│  Bride: Sarah Smith                                        │
│  Groom: John Johnson                                       │
│  Bridal Party: [View 8 members]                           │
│                                                            │
│  📝 Special Requests                                      │
│  "Please play 'Endless Love' for first dance..."          │
│                                                            │
│  🎶 Music Preferences                                     │
│  "80s classics, Top 40, some country..."                  │
│                                                            │
│  🚫 Do Not Play                                           │
│  "Electric Slide, Cupid Shuffle..."                       │
│                                                            │
│  [Edit Booking] [Cancel Booking] [Send Message] [Print]  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### 4.5.3 Provider Availability Management

**Features:**
- Manual date blocking for vacations, maintenance
- Bulk date selection
- Availability calendar for each provider
- Conflict prevention warnings

**Interface:**
```
┌────────────────────────────────────────────────────────────┐
│  MANAGE AVAILABILITY - DJ CEASE                           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  [View Calendar] [Block Dates] [View Bookings]           │
│                                                            │
│  📅 November 2025                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Calendar showing:                                  │  │
│  │  - Booked dates (red, locked)                      │  │
│  │  - Manually blocked dates (orange, editable)       │  │
│  │  - Available dates (green, can block)              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  🚫 Block New Dates                                       │
│  From: [Date Picker] To: [Date Picker]                   │
│  Reason: [Vacation/Maintenance/Personal]                  │
│  [Block These Dates]                                       │
│                                                            │
│  📋 Currently Blocked Dates                               │
│  Nov 24-26: Thanksgiving Holiday [Remove Block]           │
│  Dec 23-25: Christmas Holiday [Remove Block]              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### 4.5.4 Reports & Analytics

**Available Reports:**
- Booking summary by month/year
- Revenue tracking (if pricing implemented)
- Provider utilization rates
- Popular event types
- Client acquisition trends
- Cancellation rates

---

## 5. Technical Considerations

### 5.1 Availability Management System

#### 5.1.1 Real-Time Availability Checks

**Challenge:** Prevent double-booking during concurrent bookings

**Solution: Optimistic Locking**
```javascript
async function attemptBooking(userId, providerId, eventDate) {
  // Start transaction
  const transaction = await db.beginTransaction();
  
  try {
    // Check availability with row lock
    const isAvailable = await db.query(`
      SELECT COUNT(*) as count
      FROM bookings
      WHERE service_provider = ?
      AND event_date = ?
      AND status != 'cancelled'
      FOR UPDATE
    `, [providerId, eventDate]);
    
    if (providerId.startsWith('photobooth')) {
      // Photobooth: allow up to 2 bookings
      if (isAvailable.count >= 2) {
        await transaction.rollback();
        return { success: false, error: 'Date fully booked' };
      }
    } else {
      // DJ: allow only 1 booking
      if (isAvailable.count >= 1) {
        await transaction.rollback();
        return { success: false, error: 'DJ not available on this date' };
      }
    }
    
    // Create booking
    const booking = await db.insert('bookings', {
      user_id: userId,
      service_provider: providerId,
      event_date: eventDate,
      status: 'pending'
    });
    
    await transaction.commit();
    return { success: true, bookingId: booking.id };
    
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

#### 5.1.2 Calendar Caching Strategy

**Challenge:** Avoid database queries for every calendar render

**Solution: Smart Caching**
```javascript
// Cache availability for current and next 2 months
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

class AvailabilityCache {
  constructor() {
    this.cache = new Map();
  }
  
  getCacheKey(providerId, year, month) {
    return `${providerId}_${year}_${month}`;
  }
  
  async getAvailability(providerId, year, month) {
    const key = this.getCacheKey(providerId, year, month);
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }
    
    // Fetch fresh data
    const availability = await fetchAvailabilityFromDB(providerId, year, month);
    
    this.cache.set(key, {
      data: availability,
      timestamp: Date.now()
    });
    
    return availability;
  }
  
  invalidate(providerId, eventDate) {
    // Invalidate cache for the month of the event
    const year = eventDate.getFullYear();
    const month = eventDate.getMonth() + 1;
    const key = this.getCacheKey(providerId, year, month);
    this.cache.delete(key);
  }
}
```

### 5.2 DJ Override Logic Implementation

#### 5.2.1 Heart Selection State Management

**Frontend State:**
```javascript
class DJSelectionManager {
  constructor() {
    this.selectedDate = null;
    this.userPreferredDJ = null; // null = use default logic
    this.availableDJs = [];
  }
  
  async updateDate(newDate) {
    this.selectedDate = newDate;
    this.availableDJs = await this.fetchAvailableDJs(newDate);
    
    // If previously preferred DJ is no longer available, reset
    if (this.userPreferredDJ && !this.availableDJs.includes(this.userPreferredDJ)) {
      this.userPreferredDJ = null;
      this.showNotification('Your preferred DJ is not available on this date');
    }
    
    this.updateUI();
  }
  
  toggleHeartSelection(djId) {
    if (!this.availableDJs.includes(djId)) {
      this.showNotification('This DJ is not available on your selected date');
      return;
    }
    
    // Toggle selection
    this.userPreferredDJ = this.userPreferredDJ === djId ? null : djId;
    this.updateUI();
  }
  
  getFinalDJSelection() {
    if (this.userPreferredDJ) {
      return this.userPreferredDJ;
    }
    
    // Default priority: DJ Cease → DJ Elev8 → TKOtheDJ
    const priority = ['dj_cease', 'dj_elev8', 'tko_the_dj'];
    for (const dj of priority) {
      if (this.availableDJs.includes(dj)) {
        return dj;
      }
    }
    
    return null;
  }
  
  updateUI() {
    // Update heart icons
    document.querySelectorAll('.dj-card').forEach(card => {
      const djId = card.dataset.djId;
      const heartIcon = card.querySelector('.heart-icon');
      const isSelected = this.userPreferredDJ === djId;
      const isAvailable = this.availableDJs.includes(djId);
      
      heartIcon.classList.toggle('selected', isSelected);
      heartIcon.classList.toggle('disabled', !isAvailable);
      card.classList.toggle('unavailable', !isAvailable);
    });
    
    // Show selected DJ
    const finalDJ = this.getFinalDJSelection();
    if (finalDJ) {
      this.showNotification(`${getDJName(finalDJ)} will be your DJ!`);
    }
  }
}
```

#### 5.2.2 Visual Feedback

**Heart Icon CSS:**
```css
.heart-icon {
  width: 40px;
  height: 40px;
  cursor: pointer;
  transition: all 0.3s ease;
  filter: drop-shadow(0 0 5px rgba(192, 192, 192, 0.5));
}

.heart-icon.disabled {
  opacity: 0.3;
  cursor: not-allowed;
  filter: none;
}

.heart-icon:not(.disabled):hover {
  transform: scale(1.2);
  filter: drop-shadow(0 0 10px rgba(227, 30, 36, 0.8));
}

.heart-icon.selected {
  filter: drop-shadow(0 0 15px rgba(227, 30, 36, 1));
  animation: heartPulse 1.5s ease-in-out infinite;
}

@keyframes heartPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
```

### 5.3 Database Optimization

#### 5.3.1 Indexes for Performance

```sql
-- Speed up availability queries
CREATE INDEX idx_bookings_provider_date 
ON bookings(service_provider, event_date, status);

-- Speed up user booking lookups
CREATE INDEX idx_bookings_user_status 
ON bookings(user_id, status, event_date);

-- Speed up date range queries
CREATE INDEX idx_bookings_date_range 
ON bookings(event_date) 
WHERE status != 'cancelled';

-- Full-text search on event names
CREATE VIRTUAL TABLE event_search USING fts5(
  event_name, 
  event_type, 
  content=event_details, 
  content_rowid=id
);
```

#### 5.3.2 Data Retention Policy

```sql
-- Archive old bookings (older than 2 years)
CREATE TABLE bookings_archive (
  -- Same schema as bookings table
);

-- Automated archival process (run monthly)
INSERT INTO bookings_archive 
SELECT * FROM bookings 
WHERE event_date < date('now', '-2 years');

DELETE FROM bookings 
WHERE event_date < date('now', '-2 years');
```

### 5.4 API Endpoints Specification

**Base URL:** `/api`

#### Authentication Endpoints
```
POST   /api/auth/register          - Create new user account
POST   /api/auth/login             - User login
POST   /api/auth/logout            - User logout
POST   /api/auth/refresh           - Refresh JWT token
POST   /api/auth/forgot-password   - Request password reset
POST   /api/auth/reset-password    - Reset password with token
```

#### User Endpoints
```
GET    /api/users/me               - Get current user profile
PUT    /api/users/me               - Update user profile
GET    /api/users/me/bookings      - Get user's bookings
```

#### Service Endpoints
```
GET    /api/services               - Get all services
GET    /api/services/dj            - Get DJ profiles
GET    /api/services/photobooth    - Get photobooth info
```

#### Availability Endpoints
```
GET    /api/availability/dj/:djId/month/:year/:month  
       - Get DJ availability for specific month
       
GET    /api/availability/photobooth/month/:year/:month
       - Get photobooth availability for specific month
       
POST   /api/availability/check
       - Check if specific date/provider is available
       Body: { provider: string, date: string }
```

#### Booking Endpoints
```
POST   /api/bookings               - Create new booking
       Body: { serviceType, provider, eventDate, userPreference }
       
GET    /api/bookings/:id           - Get booking details
PUT    /api/bookings/:id           - Update booking
DELETE /api/bookings/:id           - Cancel booking

POST   /api/bookings/:id/event-details
       - Add event details to booking
       
POST   /api/bookings/:id/wedding-details
       - Add wedding-specific details
```

#### Admin Endpoints (Requires Admin Role)
```
GET    /api/admin/dashboard        - Get dashboard stats
GET    /api/admin/bookings         - Get all bookings (with filters)
GET    /api/admin/bookings/:id     - Get booking detail (admin view)
PUT    /api/admin/bookings/:id/status
       - Update booking status
       
POST   /api/admin/availability/block
       - Manually block dates
       Body: { provider, startDate, endDate, reason }
       
DELETE /api/admin/availability/block/:id
       - Remove date block
       
GET    /api/admin/reports/:type    - Generate reports
```

### 5.5 Security Considerations

#### 5.5.1 Input Validation

```javascript
// Server-side validation middleware
const validateBookingInput = (req, res, next) => {
  const schema = {
    serviceType: { type: 'string', enum: ['dj', 'photobooth'] },
    provider: { type: 'string', required: true },
    eventDate: { type: 'date', min: 'today' },
    eventStartTime: { type: 'time', required: true },
    eventEndTime: { type: 'time', required: true, after: 'eventStartTime' },
    eventName: { type: 'string', minLength: 3, maxLength: 100 },
    // ... more validations
  };
  
  const validated = validate(req.body, schema);
  if (!validated.isValid) {
    return res.status(400).json({ errors: validated.errors });
  }
  
  next();
};
```

#### 5.5.2 Rate Limiting

```javascript
// Prevent booking spam
const bookingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 booking attempts per 15 minutes
  message: 'Too many booking attempts, please try again later'
});

app.post('/api/bookings', bookingRateLimit, createBooking);
```

#### 5.5.3 CORS Configuration

```javascript
// Allow frontend to access API
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'https://inthehouseproductions.pages.dev',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
```

---

## 6. Future Expansion Points

### 6.1 Extra Services Placeholder

**Implementation Strategy:**

```javascript
// services.js - Extensible service structure
const services = {
  dj: { /* existing DJ config */ },
  photobooth: { /* existing photobooth config */ },
  
  // Future service placeholders
  extras: [
    {
      id: 'lighting',
      name: 'Professional Lighting',
      status: 'coming_soon',
      icon: '💡',
      description: 'Enhance your event with professional lighting setups'
    },
    {
      id: 'videography',
      name: 'Event Videography',
      status: 'coming_soon',
      icon: '🎥',
      description: 'Capture every moment with professional video services'
    },
    {
      id: 'mc_services',
      name: 'MC / Host Services',
      status: 'coming_soon',
      icon: '🎤',
      description: 'Professional emcee services for your event'
    },
    {
      id: 'karaoke',
      name: 'Karaoke Setup',
      status: 'coming_soon',
      icon: '🎶',
      description: 'Interactive karaoke entertainment'
    }
  ]
};
```

**UI Placeholder Design:**

```
┌─────────────────────────────────────────┐
│  ┌─────────────────────────────────┐   │
│  │     [Blurred Service Image]     │   │
│  └─────────────────────────────────┘   │
│                                         │
│        💡 PROFESSIONAL LIGHTING         │
│                                         │
│     ⭐ COMING SOON ⭐                   │
│                                         │
│  "Enhance your event with              │
│   professional lighting setups"        │
│                                         │
│     [NOTIFY ME WHEN AVAILABLE]          │
│                                         │
└─────────────────────────────────────────┘
```

**Database Schema for Future Services:**

```sql
-- Flexible services table
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'active', -- 'active', 'coming_soon', 'inactive'
  description TEXT,
  config JSON, -- Service-specific configuration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Interest tracking for coming soon services
CREATE TABLE service_interest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  notified BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES services(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 6.2 Package Deals

**Future Enhancement:**

```javascript
// Bundled service packages
const packages = {
  ultimate_wedding: {
    name: 'Ultimate Wedding Package',
    services: ['dj', 'photobooth', 'lighting'],
    discount: 0.15, // 15% off
    description: 'Complete entertainment solution for your special day'
  },
  corporate_premium: {
    name: 'Corporate Premium Package',
    services: ['dj', 'lighting', 'mc_services'],
    discount: 0.10,
    description: 'Professional entertainment for corporate events'
  }
};
```

### 6.3 Payment Integration

**Placeholder for Future Implementation:**

- Deposit collection at booking time
- Final payment tracking
- Invoice generation
- Payment gateway integration (Stripe/Square)
- Payment status in admin dashboard

```sql
-- Payment tracking schema (future)
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_type TEXT NOT NULL, -- 'deposit', 'final', 'refund'
  payment_method TEXT, -- 'card', 'cash', 'check'
  status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  transaction_id TEXT,
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);
```

### 6.4 Client Communication Portal

**Future Features:**
- In-app messaging between clients and providers
- Automated reminder emails (1 week, 1 day before event)
- Post-event feedback collection
- Photo/video sharing after event

### 6.5 Mobile App

**Considerations for Future Native App:**
- React Native or Flutter implementation
- Push notifications for booking updates
- Offline mode for viewing booked events
- QR code check-in for events
- Real-time chat with providers

### 6.6 Analytics & Insights

**Future Admin Analytics:**
- Revenue forecasting
- Seasonal booking trends
- Client retention rates
- Service popularity metrics
- Geographic heatmaps of bookings
- DJ performance ratings (post-event reviews)

---

## 7. Development Roadmap

### Phase 1: Foundation (Weeks 1-2)
**Priority: Critical**

- [ ] Project setup (Cloudflare Pages + Hono)
- [ ] Database schema creation (D1)
- [ ] User authentication system
- [ ] Basic routing structure
- [ ] Color palette and base styling implementation

**Deliverable:** Working authentication system with proper theme styling

### Phase 2: Core Booking Flow (Weeks 3-4)
**Priority: Critical**

- [ ] Landing page with service cards
- [ ] DJ profile pages with bios
- [ ] Photobooth profile page
- [ ] Calendar component with availability logic
- [ ] Heart override feature implementation
- [ ] Basic availability checking

**Deliverable:** Users can view profiles and check availability

### Phase 3: Event Details & Booking (Weeks 5-6)
**Priority: Critical**

- [ ] Event details form (all fields)
- [ ] Wedding-specific fields (conditional)
- [ ] Dynamic bridal party / VIP additions
- [ ] Form validation (client & server)
- [ ] Booking creation and confirmation
- [ ] Confirmation emails

**Deliverable:** Complete booking flow from start to confirmation

### Phase 4: Admin Dashboard (Weeks 7-8)
**Priority: High**

- [ ] Admin authentication
- [ ] Dashboard overview with stats
- [ ] All bookings view (searchable/filterable)
- [ ] Booking detail view (admin)
- [ ] Provider availability management
- [ ] Manual date blocking

**Deliverable:** Functional admin panel for managing all bookings

### Phase 5: Visual Polish (Weeks 9-10)
**Priority: High**

- [ ] AI-generated images (all profiles)
- [ ] Animated musical notes background
- [ ] Smooth transitions and animations
- [ ] Mobile responsive design
- [ ] Loading states and error handling
- [ ] Cross-browser testing

**Deliverable:** Fully themed, polished UI with retro aesthetic

### Phase 6: Advanced Features (Weeks 11-12)
**Priority: Medium**

- [ ] Client dashboard (view own bookings)
- [ ] Edit existing bookings (within constraints)
- [ ] Cancel booking functionality
- [ ] Email/SMS notifications
- [ ] "Coming Soon" service placeholders
- [ ] Interest tracking for future services

**Deliverable:** Complete client self-service capabilities

### Phase 7: Optimization & Testing (Weeks 13-14)
**Priority: High**

- [ ] Performance optimization
- [ ] Security audit
- [ ] Load testing
- [ ] Bug fixes
- [ ] Documentation completion
- [ ] User acceptance testing

**Deliverable:** Production-ready application

### Phase 8: Launch & Post-Launch (Week 15+)
**Priority: Critical**

- [ ] Production deployment to Cloudflare Pages
- [ ] Custom domain setup
- [ ] Analytics integration
- [ ] Monitoring setup
- [ ] User training (admin)
- [ ] Gather feedback for iterations

**Deliverable:** Live, operational system

---

## Appendix A: Wireframe Concepts

### A.1 Landing Page Wireframe

```
╔════════════════════════════════════════════════════════════════╗
║  [Animated Musical Notes Background]                           ║
║                                                                ║
║          🎵 IN THE HOUSE PRODUCTIONS 🎵                        ║
║          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                        ║
║          "Your Event, Our Expertise"                           ║
║                                                                ║
║    ┌────────────────────────┐  ┌────────────────────────┐    ║
║    │                        │  │                        │    ║
║    │   [DJ Image - Red/     │  │   [Photobooth Image   │    ║
║    │    Chrome filtered]    │  │    - Retro style]     │    ║
║    │                        │  │                        │    ║
║    ├────────────────────────┤  ├────────────────────────┤    ║
║    │   🎧 DJ SERVICES      │  │   📸 PHOTOBOOTH       │    ║
║    │                        │  │                        │    ║
║    │  Professional DJs for  │  │  Fun memories with    │    ║
║    │  your special event    │  │  instant prints       │    ║
║    │                        │  │                        │    ║
║    │  [SELECT SERVICE →]    │  │  [SELECT SERVICE →]   │    ║
║    └────────────────────────┘  └────────────────────────┘    ║
║                                                                ║
║                    [GET STARTED]                               ║
║                                                                ║
║                    [SIGN IN]                                   ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

### A.2 DJ Profile Selection Wireframe

```
╔════════════════════════════════════════════════════════════════╗
║  ← BACK                     DJ SERVICES                        ║
║                                                                ║
║  Select your preferred DJ for [Selected Date]                 ║
║                                                                ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐║
║  │  [Profile Pic]   │  │  [Profile Pic]   │  │ [Profile Pic]│║
║  │                  │  │                  │  │              │║
║  │  ❤️  (heart)     │  │  ♡  (heart)     │  │  ♡  (heart) │║
║  ├──────────────────┤  ├──────────────────┤  ├──────────────┤║
║  │  DJ CEASE        │  │  DJ ELEV8        │  │  TKOtheDJ    │║
║  │  Mike Cecil      │  │  Brad Powell     │  │  Joey Tate   │║
║  │                  │  │                  │  │              │║
║  │  🎧 SPECIALTIES  │  │  🎧 SPECIALTIES  │  │ 🎧 SPECIAL...│║
║  │  • Weddings      │  │  • High Energy   │  │ • Versatile  │║
║  │  • Top 40        │  │  • EDM/House     │  │ • Birthday   │║
║  │  • 20+ Years     │  │  • 15+ Years     │  │ • 10+ Years  │║
║  │                  │  │                  │  │              │║
║  │  [VIEW FULL BIO] │  │  [VIEW FULL BIO] │  │ [VIEW FULL...]│║
║  │                  │  │                  │  │              │║
║  │  ✓ AVAILABLE     │  │  ⚠ UNAVAILABLE   │  │ ✓ AVAILABLE │║
║  │  (1st Choice)    │  │                  │  │ (3rd Choice)│║
║  └──────────────────┘  └──────────────────┘  └──────────────┘║
║                                                                ║
║  ℹ️  DJ Cease is automatically selected as he's your          ║
║      1st choice. Click ❤️ to override and choose another DJ.  ║
║                                                                ║
║                        [CONTINUE TO CALENDAR →]                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

### A.3 Calendar Selection Wireframe

```
╔════════════════════════════════════════════════════════════════╗
║  ← BACK              SELECT EVENT DATE                         ║
║                                                                ║
║  Service: DJ Cease                                             ║
║                                                                ║
║              ◄  NOVEMBER 2025  ►                               ║
║  ┌────────────────────────────────────────────────────────┐   ║
║  │  SUN   MON   TUE   WED   THU   FRI   SAT              │   ║
║  │  ─────────────────────────────────────────────────     │   ║
║  │   1     2     3     4     5     6     7               │   ║
║  │  [░]   [X]   [ ]   [ ]   [X]   [ ]   [ ]             │   ║
║  │                                                        │   ║
║  │   8     9    10    11    12    13    14               │   ║
║  │  [ ]   [ ]   [X]   [ ]   [ ]   [■]   [ ]             │   ║
║  │                              (selected)                │   ║
║  │  15    16    17    18    19    20    21               │   ║
║  │  [ ]   [ ]   [ ]   [X]   [ ]   [ ]   [ ]             │   ║
║  │                                                        │   ║
║  │  22    23    24    25    26    27    28               │   ║
║  │  [ ]   [X]   [ ]   [ ]   [ ]   [ ]   [X]             │   ║
║  │                                                        │   ║
║  │  29    30                                              │   ║
║  │  [ ]   [ ]                                             │   ║
║  └────────────────────────────────────────────────────────┘   ║
║                                                                ║
║  LEGEND:                                                       ║
║  [ ] Available   [X] Booked   [░] Past   [■] Selected         ║
║                                                                ║
║  Selected: Saturday, November 13, 2025                         ║
║  DJ: DJ Cease (Mike Cecil)                                     ║
║                                                                ║
║                        [CONTINUE TO EVENT DETAILS →]           ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

### A.4 Admin Dashboard Wireframe

```
╔════════════════════════════════════════════════════════════════╗
║  🏠 IN THE HOUSE PRODUCTIONS - ADMIN                          ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                                ║
║  [Dashboard] [Bookings] [Providers] [Reports] [Logout]        ║
║                                                                ║
║  📊 QUICK STATS                                               ║
║  ┌──────────────┬──────────────┬──────────────┬─────────────┐║
║  │ Total Books  │ This Month   │ Next 30 Days │ Revenue     │║
║  │    47        │     12       │      8       │  $XX,XXX    │║
║  └──────────────┴──────────────┴──────────────┴─────────────┘║
║                                                                ║
║  📅 THIS MONTH'S BOOKINGS                                     ║
║  [Filter: All ▼] [Month: Nov ▼] [View: Calendar ⚬ List ⚫]   ║
║  ┌────────────────────────────────────────────────────────┐  ║
║  │ Date   | Event              | Service    | Status      │  ║
║  ├────────────────────────────────────────────────────────┤  ║
║  │ Nov 13 | Johnson Wedding    | DJ Cease   | Confirmed ✓│  ║
║  │ Nov 15 | Miller Birthday    | Photobooth | Pending ⏱  │  ║
║  │ Nov 18 | Tech Corp Event    | DJ Elev8   | Confirmed ✓│  ║
║  │ Nov 20 | Anderson Wedding   | DJ Cease   | Pending ⏱  │  ║
║  └────────────────────────────────────────────────────────┘  ║
║                          [VIEW ALL BOOKINGS]                   ║
║                                                                ║
║  👥 PROVIDER STATUS                                           ║
║  ┌─────────────┬─────────────┬─────────────┬──────────────┐ ║
║  │ DJ Cease    │ DJ Elev8    │ TKOtheDJ    │ Photobooth   │ ║
║  │ Available ✓ │ Booked 🔴  │ Available ✓ │ 1 Available  │ ║
║  │ Next: 11/20 │ Until 11/19 │ Next: 11/25 │ Next: 11/16  │ ║
║  └─────────────┴─────────────┴─────────────┴──────────────┘ ║
║                                                                ║
║  [+ NEW BOOKING] [MANAGE AVAILABILITY] [EXPORT REPORT]        ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Appendix B: Color Swatch Reference

```css
/* Primary Palette */
--primary-red: #E31E24;
--deep-red: #8B0000;
--pure-black: #000000;
--off-black: #0A0A0A;
--chrome-silver: #C0C0C0;
--metallic-chrome: #E8E8E8;
--dark-chrome: #808080;
--accent-neon: #FF0040;
--glow-white: #FFFFFF;

/* Gradient Definitions */
--gradient-red-black: linear-gradient(135deg, #E31E24 0%, #000000 100%);
--gradient-chrome: linear-gradient(135deg, #E8E8E8 0%, #808080 50%, #C0C0C0 100%);
--gradient-neon-glow: radial-gradient(circle, #FF0040 0%, #E31E24 50%, transparent 100%);

/* Shadow Definitions */
--shadow-red-glow: 0 0 20px rgba(227, 30, 36, 0.6);
--shadow-chrome: 0 4px 12px rgba(192, 192, 192, 0.3);
--shadow-deep: 0 8px 24px rgba(0, 0, 0, 0.8);

/* Text Shadows */
--text-shadow-neon: 0 0 10px rgba(227, 30, 36, 0.8), 
                    0 0 20px rgba(227, 30, 36, 0.5);
--text-shadow-chrome: 1px 1px 2px rgba(192, 192, 192, 0.5);
```

---

## Appendix C: Responsive Design Breakpoints

```css
/* Mobile First Approach */

/* Extra Small Devices (phones, portrait) */
@media (max-width: 575.98px) {
  /* Single column layout */
  /* Simplified calendar */
  /* Stacked service cards */
}

/* Small Devices (phones, landscape) */
@media (min-width: 576px) and (max-width: 767.98px) {
  /* Two column layout for cards */
}

/* Medium Devices (tablets) */
@media (min-width: 768px) and (max-width: 991.98px) {
  /* Two column layout */
  /* Side-by-side service cards */
}

/* Large Devices (desktops) */
@media (min-width: 992px) and (max-width: 1199.98px) {
  /* Three column layout */
  /* Full calendar display */
}

/* Extra Large Devices (large desktops) */
@media (min-width: 1200px) {
  /* Full desktop layout */
  /* Enhanced animations */
}
```

---

## Appendix D: Accessibility Requirements

### WCAG 2.1 AA Compliance

**Color Contrast:**
- Text on red: Use white text (#FFFFFF) - Contrast ratio 5.5:1 ✓
- Text on black: Use white/chrome text - Contrast ratio 21:1 ✓
- Red on chrome: Minimum contrast ratio 3:1 for large text ✓

**Keyboard Navigation:**
- All interactive elements must be keyboard accessible
- Clear focus indicators (red glow)
- Logical tab order throughout application

**Screen Reader Support:**
- Proper ARIA labels on all components
- Alt text for all images
- Form labels associated with inputs
- Status announcements for dynamic content

**Animation Controls:**
- Respect `prefers-reduced-motion` media query
- Provide toggle for background animations
- Ensure animations don't cause seizures (no rapid flashing)

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Document Control

**Version History:**

| Version | Date       | Author | Changes                          |
|---------|------------|--------|----------------------------------|
| 1.0     | 2025-11-18 | System | Initial specification document   |

**Review Schedule:**
- Weekly reviews during development phases
- Major revisions after each phase completion
- Final review before production launch

**Approval Required From:**
- In The House Productions - Business Owner
- Development Team Lead
- UX/UI Designer

---

**END OF SPECIFICATION DOCUMENT**

This document serves as the complete blueprint for the In The House Productions web application. All features, designs, and technical requirements are specified to guide development from concept to launch.
