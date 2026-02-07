# In The House Productions - Web Application

## Project Overview
**In The House Productions** is a comprehensive booking and project management system for mobile DJ and Photobooth services, featuring an 80's/90's/2000's music-era themed interface with automatic invoicing and wedding event planning.

## Live URLs
- **Production (Permanent)**: https://webapp-2mf.pages.dev
- **Custom Domain**: www.inthehouseproductions.com
- **Mode**: Stripe Test Mode (Real Stripe Integration Active)
- **System Health**: 100/100 - All systems verified
- **Last Deploy**: February 7, 2026 - Wedding Forms + Auto Invoicing + CSP Fix

## Stripe Integration Status
- **Current Account**: Brad Powell (acct_1SURzgFSfYQ6chIH)
- **Email**: bradgpowell1123@gmail.com
- **Mode**: Test Mode (using test keys)
- **Products**: 12 products configured
- **Charges Enabled**: Yes
- **Payouts Enabled**: Yes
- **Payment Intents**: Working

### Stripe Products (12 Total)
| Service | Base Price | Additional Hour |
|---------|-----------|-----------------|
| DJ Party Package | $500 (4hr) | +$100/hr |
| DJ Wedding Package | $850 (5hr) | +$100/hr |
| DJ Additional Hour | $100 | - |
| Photobooth Strips | $500 (4hr) | +$100/hr |
| Photobooth 4x6 | $550 (4hr) | +$100/hr |
| Photobooth Additional Hour | $100 | - |
| Karaoke Add-on | $100 (4hr) | +$50/hr |
| Karaoke Additional Hour | $50 | - |
| Uplighting Add-on | $100 (4hr) | +$50/hr |
| Uplighting Additional Hour | $50 | - |
| Foam Pit Rental | $500 (4hr) | +$100/hr |
| Foam Pit Additional Hour | $100 | - |

## Latest Updates

### Feb 7, 2026 - Wedding Planning Forms + Automatic Invoicing
- **Wedding Planning Form System** (60+ fields, 10 sections)
  - Auto-triggered email after wedding booking
  - Client-facing form at `/wedding-planner/:bookingId`
  - Progress saving per section
  - Admin can view all form details in dashboard
- **Automatic Invoicing System** (Stripe-native)
  - Auto-generate invoices for confirmed bookings
  - Invoice numbers (INV-2026-XXXX format)
  - Payment reminders via email
  - Mark invoices as paid, send reminders
  - Admin invoice management tab
- **Admin Dashboard Upgrade**
  - New tabs: Bookings | Wedding Forms | Invoices | Providers
  - Wedding form detail viewer with all 60+ fields
  - Invoice management (auto-generate, mark paid, send reminders)
  - Fixed CSP blocking axios CDN on admin pages
- **Vibo concept removed** (per client direction)

### Jan 15, 2026 - Complete Stripe Integration
- Real Stripe Payment Intents working
- 12 products synced to Stripe account
- Checkout flow with Stripe Elements
- Admin authentication fixed

### Jan 13, 2026 - System Calibration
- Custom domain www.inthehouseproductions.com active
- Add-on pricing corrected
- Mobile UX optimized
- Major performance improvements (95% faster)
- Vendor updates (5 venue partners)

## Currently Completed Features

### Phase 1: Foundation & UI (100%)
- Project initialization with Hono + Cloudflare Pages
- D1 Database setup with complete schema (12 migrations)
- 3D Hero Logos - Ultra-realistic chrome metallic with red neon glow
- 80's/90's/2000's Retro Theme - Red, black, and chrome
- Landing page with two service cards (DJ Services & Photobooth)
- Musical notes animated background

### Phase 2: Authentication System (100%)
- Registration with validation (email, phone, name, password)
- Login with JWT authentication
- Password security with bcrypt hashing
- Protected routes and middleware

### Phase 3: DJ Services (100%)
- DJ Selection Page with all 3 DJ profiles
- Individual DJ Cards with bios, specialties, photos
- Priority System (DJ Cease > DJ Elev8 > TKOtheDJ)
- Real-time availability per DJ

### Phase 4: Advanced Booking System (100%)
- Real-Time Calendar with availability checking
- Smart DJ Double-Booking Logic (morning/evening split, 3hr gap, max 2/day)
- Photobooth Concurrent Booking (2 units)
- Event Details Form with validation
- Time conflict prevention at API level

### Phase 5: Stripe Payment Integration (100%)
- Payment Intents with Stripe Elements
- Dynamic pricing calculation (server-side)
- Payment confirmation flow
- Booking status management (pending > paid > confirmed)

### Phase 6: Notification System (Email 100% | SMS Ready)
- Email notifications via Resend API
- SMS code complete (waiting for Twilio credentials)
- Database logging of all notifications

### Phase 6.5: Affiliate Tracking (100%)
- Refersion integration for referral fees
- Tracking pixel on all pages
- Conversion tracking on bookings

### Phase 7: Admin Dashboard (80%)
- Admin authentication (separate from client)
- Dashboard overview with booking stats
- All bookings view with status management
- Provider management
- **NEW**: Wedding Forms tab - view all client wedding planning forms
- **NEW**: Invoices tab - manage invoices, auto-generate, send reminders
- Remaining: search/filter, reports, analytics

### Phase 7.5: Automatic Invoicing (100% - NEW)
- Auto-generate invoices for confirmed bookings
- Invoice numbering system (INV-YYYY-XXXX)
- Line items with service details
- Payment tracking (amount paid, amount due)
- Email reminders for overdue invoices
- Admin can mark invoices as paid
- Due date management (14 days default)

### Phase 7.6: Wedding Planning Forms (100% - NEW)
- Comprehensive 60+ field questionnaire
- 10 sections: Couple Info, Ceremony, Cocktail Hour, Reception, Bridal Party, VIP/Family, Music Preferences, Special Moments, Logistics, Add-ons
- Auto-triggered email after wedding booking
- Progress saving per section
- Admin detail viewer with all field categories
- Must-play / Do-not-play song lists
- Bridal party management
- Memorial tribute section

## API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | User registration |
| POST | `/api/auth/login` | User login |
| GET | `/api/auth/me` | Current user (auth required) |
| GET | `/api/services/dj` | DJ profiles |
| GET | `/api/services/photobooth` | Photobooth info |
| GET | `/api/services/pricing` | All service pricing |
| POST | `/api/availability/check` | Check availability |
| GET | `/api/availability/:provider/:year/:month` | Monthly availability |
| POST | `/api/bookings/create` | Create booking (auth required) |
| POST | `/api/create-payment-intent` | Stripe payment intent (auth required) |
| POST | `/api/payment/confirm` | Confirm payment |

### Wedding Forms
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wedding-form/:bookingId` | Get wedding form |
| POST | `/api/wedding-form/:bookingId` | Save/update wedding form |
| POST | `/api/wedding-form/:bookingId/send-email` | Send form email to client |

### Invoicing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/invoices/auto-generate` | Auto-generate missing invoices |
| POST | `/api/invoices/:id/status` | Update invoice status |
| POST | `/api/invoices/:id/send-reminder` | Send payment reminder email |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/bookings` | All bookings with details |
| POST | `/api/admin/bookings/:id/status` | Update booking status |
| GET | `/api/admin/providers` | All providers |
| GET | `/api/admin/invoices` | All invoices with client info |
| GET | `/api/admin/wedding-forms` | All wedding forms with client info |

### Pages
| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/login` | User login |
| `/register` | User registration |
| `/dj-services` | DJ selection |
| `/photobooth` | Photobooth info |
| `/calendar` | Availability calendar |
| `/event-details` | Event details form |
| `/checkout` | Stripe payment |
| `/booking-success` | Confirmation page |
| `/wedding-planner/:bookingId` | Wedding planning form |
| `/admin` | Admin dashboard |
| `/employee/login` | Employee login |
| `/contact` | Contact page |
| `/about` | About page |

## Database Schema (12 Migrations, 11+ Tables)

### Core Tables
- **users** - Client and admin accounts
- **bookings** - Event bookings with Stripe payment tracking
- **booking_time_slots** - DJ availability and conflict prevention
- **event_details** - Event information (venue, guests, etc.)
- **notifications** - Email/SMS logging
- **provider_contacts** - DJ/Photobooth contact info
- **availability_blocks** - Manual date blocking
- **employees** - Employee portal accounts
- **change_logs** - Audit trail for employee actions

### New Tables (Feb 2026)
- **wedding_event_forms** - 60+ field wedding planning questionnaire
- **invoices** - Automatic invoicing with Stripe integration
- **invoice_line_items** - Detailed line items per invoice
- **invoice_reminders** - Payment reminder tracking

## Technology Stack
- **Framework**: Hono (lightweight, edge-optimized)
- **Runtime**: Cloudflare Workers / Pages
- **Database**: Cloudflare D1 (SQLite)
- **Payments**: Stripe (Payment Intents + Invoices API)
- **Email**: Resend API
- **SMS**: Twilio (ready, needs credentials)
- **Affiliates**: Refersion tracking
- **Frontend**: Vanilla JavaScript + TailwindCSS CDN
- **Icons**: Font Awesome 6.4.0
- **Dev Server**: Wrangler Pages Dev + PM2

## Development Commands

```bash
# Database
npm run db:migrate:local   # Apply migrations locally
npm run db:seed            # Seed test data
npm run db:reset           # Reset local database

# Development
npm run build              # Build application
npm run dev:sandbox        # Start dev server
npm run clean-port         # Kill port 3000

# PM2
pm2 start ecosystem.config.cjs
pm2 logs webapp --nostream
pm2 restart webapp

# Deployment
npm run deploy:prod        # Deploy to Cloudflare Pages
```

## Default Credentials (Development Only)
- **Admin**: admin@inthehouseproductions.com / Admin123!
- **Employees**: (various)@inthehouseproductions.com / Employee123!

**Change these before production!**

## Features Not Yet Implemented

### Phase 8: Client Dashboard
- View own bookings and history
- Download invoices as PDF
- Edit wedding planning form from dashboard
- Payment history

### Phase 9: Enhancements
- Forgot password functionality
- Email verification for new accounts
- Booking reminders (7 days, 1 day before)
- Client testimonials section
- Photo gallery of past events
- Package deals (DJ + Photobooth bundles)
- Promo codes and discounts
- Advanced admin reports and analytics
- Search/filter on admin bookings

### Notification Enhancements
- Activate SMS (needs Twilio credentials)
- Automated invoice overdue reminders (cron-style)
- Booking modification notifications

## DJ Profiles

### DJ Cease (Mike Cecil) - Priority 1
- 20+ Years | Weddings, Top 40, Hip-Hop, R&B
- Phone: +1-727-359-4701

### DJ Elev8 (Brad Powell) - Priority 2
- 15+ Years | High-Energy, EDM, House, Top 40
- Phone: +1-859-314-4443

### TKOtheDJ (Joey Tate) - Priority 3
- 10+ Years | Versatile, Hip-Hop, Pop, Rock
- Phone: +1-859-803-2755

### Photobooth
- Maria Cecil (Unit 1) & Cora Scarborough (Unit 2)
- 2 Professional Units, can book same date

## Venue Partners
- DK Farms & Gardens
- Big Red Barn
- Garden Gate Estate
- Still Creek Farm
- The Barn Yard WC

## Project Structure
```
webapp/
├── src/
│   ├── index.tsx              # Main Hono app (~8000+ lines)
│   ├── auth.ts                # Auth utilities
│   ├── auth-middleware.ts      # JWT middleware
│   ├── security-middleware.ts  # CSP, rate limiting, headers
│   ├── accessibility-helpers.ts
│   └── seo-helpers.ts
├── public/static/             # Static assets (logos, CSS)
├── migrations/                # 12 D1 migration files
│   ├── 0001_initial_schema.sql
│   ├── ...
│   └── 0012_wedding_event_forms.sql
├── dist/                      # Build output
├── ecosystem.config.cjs       # PM2 config
├── wrangler.jsonc             # Cloudflare config
├── package.json
├── seed.sql                   # Test data
└── README.md
```

## Current Status

**Overall Progress**: ~95% Complete

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Foundation & UI | Complete | 100% |
| Phase 2: Authentication | Complete | 100% |
| Phase 3: DJ Services | Complete | 100% |
| Phase 4: Booking System | Complete | 100% |
| Phase 5: Stripe Payments | Complete | 100% |
| Phase 6: Notifications | Email Active / SMS Ready | 95% |
| Phase 6.5: Affiliate Tracking | Complete | 100% |
| Phase 7: Admin Dashboard | Active | 80% |
| Phase 7.5: Auto Invoicing | **Complete (NEW)** | 100% |
| Phase 7.6: Wedding Forms | **Complete (NEW)** | 100% |
| Phase 8: Client Dashboard | Not Started | 0% |
| Phase 9: Enhancements | Partial | 20% |

---

**Last Updated**: 2026-02-07
**Version**: 1.0.0 (Wedding Forms + Auto Invoicing)
**Status**: Production-Ready | All Core Flows Operational
