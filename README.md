# In The House Productions - Web Application

## Project Overview
**In The House Productions** is a comprehensive booking and project management system for mobile DJ and Photobooth services, featuring an 80's/90's/2000's music-era themed interface.

## 🌐 Live URLs
- **Development**: https://3000-iep0ibbw2vbqh3zzjh4nq-2b54fc91.sandbox.novita.ai
- **Production**: Coming soon (Cloudflare Pages deployment pending)

## ✅ Currently Completed Features

### Phase 1: Foundation & Landing Page (COMPLETED)
- ✅ Project initialization with Hono + Cloudflare Pages
- ✅ Git repository with comprehensive .gitignore
- ✅ D1 Database setup with complete schema
- ✅ **Animated Musical Notes Background** - Dynamic floating notes with staff lines
- ✅ **80's/90's/2000's Retro Theme** - Red, black, and chrome color scheme
- ✅ **Landing Page** with two service cards (DJ Services & Photobooth)
- ✅ Neon text effects and chrome borders with hover animations
- ✅ Coming Soon section for future services
- ✅ PM2 service management configuration

### API Endpoints (COMPLETED)
- ✅ `GET /api/health` - Health check endpoint
- ✅ `GET /api/services/dj` - Get all DJ profiles with bios and specialties
- ✅ `GET /api/services/photobooth` - Get photobooth service information
- ✅ `POST /api/availability/check` - Check availability for specific date/provider
- ✅ `GET /api/availability/:provider/:year/:month` - Get month availability

### Database Schema (COMPLETED)
- ✅ Users table (authentication)
- ✅ Bookings table (with user preference tracking)
- ✅ Event details table (comprehensive event information)
- ✅ Wedding details table (bride/groom names)
- ✅ Bridal party table
- ✅ VIP family members table
- ✅ Availability blocks table (manual date blocking)
- ✅ Service interest table (for coming soon features)
- ✅ Sample seed data for testing

## 🚧 Features Not Yet Implemented

### Phase 2: User Authentication (IN PROGRESS)
- ⏳ Registration page with mandatory fields (email, phone, name, password)
- ⏳ Login page with JWT authentication
- ⏳ Password hashing with bcrypt
- ⏳ Session management
- ⏳ Forgot password functionality

### Phase 3: DJ Services Flow
- ⏳ DJ profile selection page
- ⏳ Individual DJ profile cards with photos
- ⏳ Heart icon override feature (select preferred DJ)
- ⏳ Default DJ selection logic (Cease → Elev8 → TKO)
- ⏳ Real-time availability display per DJ

### Phase 4: Booking System
- ⏳ Integrated calendar component
- ⏳ Date selection with availability checking
- ⏳ Event details form (comprehensive fields)
- ⏳ Wedding-specific fields (conditional)
- ⏳ Dynamic bridal party/VIP additions
- ⏳ Booking confirmation page
- ⏳ Email notifications

### Phase 5: Photobooth Service
- ⏳ Photobooth service page
- ⏳ Dual-unit booking logic (2 bookings per date)
- ⏳ Availability tracking for both units

### Phase 6: Admin Dashboard
- ⏳ Admin authentication
- ⏳ Dashboard overview with stats
- ⏳ All bookings view (searchable/filterable)
- ⏳ Booking detail management
- ⏳ Provider availability management
- ⏳ Manual date blocking interface
- ⏳ Reports and analytics

## 📋 Recommended Next Steps

### Immediate Priority (Next Session)
1. **Complete user authentication** (register/login pages)
2. **Build DJ profile selection** page with heart override feature
3. **Implement calendar component** with real availability checking
4. **Create event booking form** with validation

### Future Enhancements
1. **AI-generated profile images** for DJs and photobooth operators
2. **Client dashboard** for managing own bookings
3. **Email/SMS notifications** for booking confirmations
4. **Payment integration** (Stripe/Square)
5. **Mobile responsiveness** optimization
6. **Package deals** (DJ + Photobooth bundles)

## 🎨 Design Specifications

### Color Palette
- **Primary Red**: #E31E24
- **Deep Red**: #8B0000
- **Pure Black**: #000000
- **Chrome Silver**: #C0C0C0
- **Metallic Chrome**: #E8E8E8
- **Dark Chrome**: #808080
- **Accent Neon**: #FF0040

### Theme
- 80's, 90's, 2000's music era aesthetic
- Neon glow effects on text and borders
- Chrome metallic styling
- Animated musical notes background
- Retro cassette tape and vinyl record motifs (planned)

## 🗄️ Data Architecture

### Storage Services
- **Cloudflare D1 Database** (SQLite) - All relational data
- Local development uses `.wrangler/state/v3/d1` for SQLite

### Key Data Models
- **Users**: Client accounts and admin users
- **Bookings**: Event bookings with service provider assignments
- **Event Details**: Comprehensive event information
- **Wedding Details**: Bride/groom and bridal party information
- **Availability Blocks**: Manual date blocking by admin

### Data Flow
1. Client creates account (mandatory)
2. Selects service (DJ or Photobooth)
3. Views provider profiles
4. Checks calendar availability
5. Books date and submits event details
6. Admin manages bookings and availability

## 🚀 Technology Stack

- **Framework**: Hono (lightweight, edge-optimized)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Vanilla JavaScript + TailwindCSS
- **Icons**: Font Awesome 6.4.0
- **Dev Server**: Wrangler Pages Dev
- **Process Manager**: PM2

## 💻 Development Commands

```bash
# Database Management
npm run db:migrate:local   # Apply migrations locally
npm run db:seed            # Seed database with test data
npm run db:reset           # Reset local database
npm run db:console:local   # Open local database console

# Development
npm run build              # Build the application
npm run dev:sandbox        # Start dev server (sandbox)
npm run clean-port         # Kill process on port 3000
npm run test               # Test API health endpoint

# PM2 Management
pm2 start ecosystem.config.cjs  # Start service
pm2 logs webapp --nostream      # Check logs
pm2 restart webapp              # Restart service
pm2 delete webapp               # Stop and remove service

# Deployment
npm run deploy:prod        # Deploy to Cloudflare Pages
```

## 🔐 Default Admin Credentials (Development)
- **Email**: admin@inthehouseproductions.com
- **Password**: Admin123!

⚠️ **Change these credentials before production deployment!**

## 📊 Current Project Status

**Overall Progress**: ~30% Complete

- ✅ Phase 1: Foundation (100%)
- 🔄 Phase 2: Authentication (0%)
- ⏳ Phase 3: DJ Profiles (0%)
- ⏳ Phase 4: Booking System (0%)
- ⏳ Phase 5: Photobooth (0%)
- ⏳ Phase 6: Admin Dashboard (0%)
- ⏳ Phase 7: Polish & Testing (0%)

## 📁 Project Structure

```
webapp/
├── src/
│   ├── index.tsx           # Main Hono application
│   └── renderer.tsx        # JSX renderer (unused currently)
├── public/
│   └── static/
│       └── style.css       # Custom styles (minimal)
├── migrations/
│   └── 0001_initial_schema.sql  # Database schema
├── seed.sql                # Test data
├── dist/                   # Build output (generated)
├── ecosystem.config.cjs    # PM2 configuration
├── wrangler.jsonc          # Cloudflare configuration
├── package.json            # Dependencies and scripts
├── DESIGN_SPECIFICATION.md # Complete design document (65+ pages)
└── README.md               # This file
```

## 🎯 Business Goals

1. **Streamline client bookings** - Reduce friction in booking process
2. **Prevent double-booking** - Automatic availability management
3. **Transparent service info** - Detailed provider profiles
4. **Memorable experience** - Retro music theme branding
5. **Centralized management** - All-in-one admin dashboard

## 📞 DJ Profiles

### 1. DJ Cease (Mike Cecil) - Priority 1
- 20+ Years Experience
- Specialties: Weddings, Top 40, Hip-Hop, R&B
- First choice for automatic selection

### 2. DJ Elev8 (Brad Powell) - Priority 2
- 15+ Years Experience
- Specialties: High-Energy, EDM, House, Top 40
- Second choice for automatic selection

### 3. TKOtheDJ (Joey Tate) - Priority 3
- 10+ Years Experience
- Specialties: Versatile, Hip-Hop, Pop, Rock
- Third choice for automatic selection

### Photobooth (Maria Cecil & Cora Scarborough)
- 2 Professional Units
- Can book same date twice
- Unlimited prints, custom backdrops, digital gallery

## 🔗 Important Links

- **Design Specification**: See `DESIGN_SPECIFICATION.md` for complete requirements
- **GitHub**: (To be set up)
- **Cloudflare Pages**: (To be deployed)

## 📝 Recent Updates

### 2025-11-18 - Initial Launch
- Project initialized with Hono + Cloudflare Pages
- D1 database created and migrated
- Landing page with animated background deployed
- API endpoints implemented
- Development server running on PM2

---

**Last Updated**: 2025-11-18  
**Version**: 0.1.0 (Alpha)  
**Status**: 🚧 Active Development
