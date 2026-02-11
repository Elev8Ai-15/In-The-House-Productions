# In The House Productions - Web Application

## Project Overview
**In The House Productions** is a comprehensive booking and project management system for mobile DJ and Photobooth services, featuring an 80's/90's/2000's music-era themed interface with automatic invoicing and wedding event planning.

## Live URLs
- **Production (Permanent)**: https://webapp-2mf.pages.dev
- **Custom Domain**: www.inthehouseproductions.com
- **Mode**: Stripe Test Mode (Real Stripe Integration Active)
- **System Health**: 100/100 - All 38 routes verified
- **Last Deploy**: February 11, 2026 - Stabilization: 15 bug fixes, 20% bundle reduction

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

### Feb 11, 2026 - Stabilization & Code Review
- **15 Bugs Fixed** - Buffer.from, process.env, cart pricing, error leaks, CSRF bypass, PBKDF2 iterations
- **120 LOC Dead Code Removed** - Legacy in-memory rate limiter and unused imports
- **Bundle Size**: 752 KB → 600 KB (**-20.2%**)
- **Security Hardened** - PBKDF2 100K iterations (backward-compatible), CSRF tightened, error details hidden
- **Stripe SDK Lazy-loaded** - Only imported when refund is actually needed
- **All 38 routes verified** - 19 pages 200, 9 APIs 200, 5 admin 401, 5 POST validation 400

### Feb 7, 2026 - Security & Feature Overhaul
- **Admin Route Protection** - All `/api/admin/*` endpoints now require JWT with admin role (401/403)
- **Password Reset Flow** - New `/forgot-password` and `/reset-password` pages + API endpoints
- **Email Verification** - New `/verify-email` page + `/api/auth/verify-email` endpoint
- **Booking Cancellation** - `/api/bookings/:id/cancel` with tiered refund policy (100%/50%/0%)
- **Booking Refund (Admin)** - `/api/bookings/:id/refund` with Stripe refund integration
- **My Bookings** - `/api/bookings/my-bookings` for authenticated users
- **CSRF Protection** - Origin/Referer validation on all POST/PUT/DELETE API calls
- **D1 Rate Limiting** - Persistent rate limiting via D1 SQLite (replaces in-memory)
- **Secrets Externalized** - Setup key and default passwords moved to environment variables
- **Fix Event Details** - Admin endpoint to repair orphaned bookings
- **Modular Architecture** - New middleware and route modules (admin-auth, csrf, d1-rate-limit, password-reset, email-verification, cancellation)
- **Image Optimization** - Lazy loading, intersection observer, responsive image helpers
- **Build**: 752 KB bundle | 28 pages + APIs | All routes verified 200 OK

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

### Phase 7: Admin Dashboard (90%)
- Admin authentication (separate from client)
- **NEW**: JWT middleware guard on all `/api/admin/*` routes (returns 401/403)
- Dashboard overview with booking stats
- All bookings view with status management
- Provider management
- Wedding Forms tab - view all client wedding planning forms
- Invoices tab - manage invoices, auto-generate, send reminders
- Fix orphaned event_details endpoint
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
| POST | `/api/auth/forgot-password` | **NEW** Request password reset email |
| POST | `/api/auth/reset-password` | **NEW** Reset password with token |
| POST | `/api/auth/verify-email` | **NEW** Verify email with token |
| POST | `/api/auth/resend-verification` | **NEW** Resend verification email |
| GET | `/api/services/dj` | DJ profiles |
| GET | `/api/services/photobooth` | Photobooth info |
| GET | `/api/services/pricing` | All service pricing |
| POST | `/api/availability/check` | Check availability |
| GET | `/api/availability/:provider/:year/:month` | Monthly availability |
| POST | `/api/bookings/create` | Create booking (auth required) |
| GET | `/api/bookings/my-bookings` | **NEW** User's bookings (auth required) |
| POST | `/api/bookings/:id/cancel` | **NEW** Cancel booking (auth required) |
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

### Admin (All require JWT with admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/bookings` | All bookings with details |
| POST | `/api/admin/bookings/:id/status` | Update booking status |
| POST | `/api/bookings/:id/refund` | **NEW** Process refund (Stripe) |
| GET | `/api/admin/providers` | All providers |
| GET | `/api/admin/invoices` | All invoices with client info |
| GET | `/api/admin/wedding-forms` | All wedding forms with client info |
| POST | `/api/admin/fix-event-details` | **NEW** Fix orphaned bookings |

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
| `/forgot-password` | **NEW** Password reset request |
| `/reset-password` | **NEW** Set new password (from email link) |
| `/verify-email` | **NEW** Email verification page |
| `/contact` | Contact page |
| `/about` | About page |

## Database Schema (13 Migrations, 12+ Tables)

### Core Tables
- **users** - Client and admin accounts (+ reset_token, email_verified columns)
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
- **rate_limits** - **NEW** D1-backed persistent rate limiting

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

**IMPORTANT**: Set `SETUP_KEY` and `DEFAULT_EMPLOYEE_PASSWORD` env vars in production!

## Security Architecture

### Authentication & Authorization
- **PBKDF2-SHA256** password hashing (100K iterations, 16-byte salt, backward-compatible with 10K)
- **JWT HS256** tokens with 24-hour expiry
- **Admin middleware** guards all `/api/admin/*` routes (returns 401/403)
- **Progressive lockout**: 5min after 5 failures, 15min after 10, 1hr after 15

### Request Protection
- **CSRF**: Origin/Referer header validation on all state-changing requests
- **Rate limiting**: D1-backed persistent store (survives worker restarts)
- **CSP**: Strict Content-Security-Policy with whitelisted CDNs
- **HSTS**: Strict-Transport-Security with 1-year max-age
- **Security headers**: X-Frame-Options, X-Content-Type-Options, Permissions-Policy

### Environment Variables (Secrets)
| Variable | Purpose | Required |
|----------|---------|----------|
| `JWT_SECRET` | JWT signing key | Yes |
| `SETUP_KEY` | Admin setup key (default: fallback) | Recommended |
| `DEFAULT_EMPLOYEE_PASSWORD` | Employee reset password | Recommended |
| `STRIPE_SECRET_KEY` | Stripe API key | For payments |
| `RESEND_API_KEY` | Email delivery | For emails |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN` | SMS | For SMS |
| `REFERSION_PUBLIC_KEY` | Affiliate tracking | Optional |

## Features Not Yet Implemented

### Phase 8: Client Dashboard
- Download invoices as PDF
- Edit wedding planning form from dashboard
- Payment history view

### Phase 9: Enhancements
- Booking reminders (7 days, 1 day before)
- Client testimonials section
- Photo gallery of past events
- Package deals (DJ + Photobooth bundles)
- Promo codes and discounts
- Advanced admin reports and analytics
- Search/filter on admin bookings
- Build-time Tailwind (replace CDN)

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
│   ├── index.tsx              # Main Hono app (routes + pages)
│   ├── types.ts               # Shared Bindings type
│   ├── auth.ts                # Auth utilities (PBKDF2, JWT)
│   ├── auth-middleware.ts     # JWT secret helper
│   ├── security-middleware.ts # CSP, headers, in-memory rate limiter
│   ├── accessibility-helpers.ts
│   ├── seo-helpers.ts
│   ├── middleware/
│   │   ├── admin-auth.ts      # Admin JWT guard middleware
│   │   ├── csrf.ts            # CSRF protection middleware
│   │   └── d1-rate-limit.ts   # D1-backed rate limiting
│   ├── routes/
│   │   ├── password-reset.ts  # Password reset flow
│   │   ├── email-verification.ts # Email verification flow
│   │   └── cancellation.ts    # Booking cancellation & refunds
│   └── helpers/
│       └── image-optimizer.ts # Image optimization utilities
├── public/static/             # Static assets (~21 MB logos, CSS)
├── migrations/                # 13 D1 migration files
│   ├── 0001_initial_schema.sql
│   ├── ...
│   ├── 0012_wedding_event_forms.sql
│   └── 0013_security_enhancements.sql
├── dist/                      # Build output (600 KB)
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
| Phase 7: Admin Dashboard | Active | 90% |
| Phase 7.5: Auto Invoicing | Complete | 100% |
| Phase 7.6: Wedding Forms | Complete | 100% |
| Phase 7.7: Security Overhaul | **Complete (NEW)** | 100% |
| Phase 7.8: Password Reset | **Complete (NEW)** | 100% |
| Phase 7.9: Email Verification | **Complete (NEW)** | 100% |
| Phase 7.10: Cancellation/Refunds | **Complete (NEW)** | 100% |
| Phase 8: Client Dashboard | Partial | 30% |
| Phase 9: Enhancements | Partial | 30% |

---

**Last Updated**: 2026-02-11
**Version**: 2.1.0 (Stabilization: 15 bug fixes, security hardening, 20% bundle reduction)
**Commit**: ab689ef on main
**Status**: Production-Ready | All 38 Routes Verified | Admin Routes Protected
