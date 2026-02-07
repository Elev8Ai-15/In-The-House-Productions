-- Wedding Event Planning Forms
-- Comprehensive questionnaire that auto-triggers when client books a wedding
-- Stores all planning details for DJ to prepare the perfect wedding

CREATE TABLE IF NOT EXISTS wedding_event_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  form_status TEXT DEFAULT 'pending' CHECK(form_status IN ('pending', 'in_progress', 'completed', 'reviewed')),
  
  -- ===== SECTION 1: COUPLE INFORMATION =====
  partner1_full_name TEXT,
  partner1_phone TEXT,
  partner1_email TEXT,
  partner2_full_name TEXT,
  partner2_phone TEXT,
  partner2_email TEXT,
  couple_hashtag TEXT,                     -- e.g., #SmithJonesWedding
  how_they_met TEXT,
  
  -- ===== SECTION 2: CEREMONY DETAILS =====
  ceremony_location TEXT,                  -- Same venue or different?
  ceremony_time TEXT,
  officiant_name TEXT,
  mic_needed_for_officiant BOOLEAN DEFAULT 0,
  processional_song TEXT,                  -- Bride walks down aisle
  bridesmaids_processional_song TEXT,      -- Bridesmaids walk down
  recessional_song TEXT,                   -- Couple walks out
  ceremony_readers TEXT,                   -- Names of readers
  unity_ceremony TEXT,                     -- Sand, candle, etc.
  unity_ceremony_song TEXT,
  ceremony_special_notes TEXT,
  
  -- ===== SECTION 3: COCKTAIL HOUR =====
  cocktail_start_time TEXT,
  cocktail_end_time TEXT,
  cocktail_location TEXT,
  cocktail_music_vibe TEXT,                -- Jazz, Acoustic, Upbeat, etc.
  cocktail_special_requests TEXT,
  
  -- ===== SECTION 4: RECEPTION TIMELINE =====
  reception_start_time TEXT,
  grand_entrance_style TEXT,               -- Announced, Walk-in, etc.
  grand_entrance_song TEXT,
  
  -- First Dance
  first_dance_song TEXT,
  first_dance_style TEXT,                  -- Traditional, Choreographed, Mashup
  first_dance_notes TEXT,
  
  -- Parent Dances
  father_daughter_song TEXT,
  father_daughter_notes TEXT,
  mother_son_song TEXT,
  mother_son_notes TEXT,
  
  -- Key Moments
  cake_cutting_song TEXT,
  bouquet_toss BOOLEAN DEFAULT 0,
  bouquet_toss_song TEXT,
  garter_toss BOOLEAN DEFAULT 0,
  garter_toss_song TEXT,
  money_dance BOOLEAN DEFAULT 0,
  money_dance_song TEXT,
  anniversary_dance BOOLEAN DEFAULT 0,     -- Longest married couple
  last_dance_song TEXT,
  send_off_song TEXT,
  send_off_style TEXT,                     -- Sparklers, Bubbles, etc.
  
  -- ===== SECTION 5: BRIDAL PARTY =====
  -- Stored as JSON array: [{name, role, partner_name}]
  bridal_party_json TEXT,
  flower_girl_name TEXT,
  ring_bearer_name TEXT,
  
  -- ===== SECTION 6: VIP & FAMILY =====
  -- Stored as JSON array: [{name, relationship, special_note}]
  vip_family_json TEXT,
  memorial_tribute TEXT,                   -- In memory of...
  memorial_tribute_details TEXT,
  special_announcements TEXT,              -- Birthdays, anniversaries at event
  
  -- ===== SECTION 7: MUSIC PREFERENCES =====
  music_genres_preferred TEXT,             -- JSON array of genres
  music_genres_avoid TEXT,                 -- JSON array of genres to avoid
  must_play_songs TEXT,                    -- JSON array [{song, artist, moment}]
  do_not_play_songs TEXT,                  -- JSON array [{song, artist, reason}]
  dinner_music_vibe TEXT,                  -- Background, Upbeat, Jazz, etc.
  dance_floor_energy TEXT,                 -- Low, Medium, High, Insane
  clean_music_only BOOLEAN DEFAULT 0,
  music_notes TEXT,
  
  -- ===== SECTION 8: TOASTS & SPEECHES =====
  -- Stored as JSON array: [{name, role, order}]
  toast_speakers_json TEXT,
  toast_mic_preference TEXT,               -- Wireless, Podium, DJ announces
  toast_time_limit TEXT,                   -- None, 3min, 5min
  
  -- ===== SECTION 9: LOGISTICS & SETUP =====
  dj_setup_time TEXT,
  power_location TEXT,
  indoor_outdoor TEXT,                     -- Indoor, Outdoor, Both
  rain_plan TEXT,
  dj_placement TEXT,                       -- Where should DJ set up?
  dance_floor_size TEXT,                   -- Small, Medium, Large
  lighting_notes TEXT,
  
  -- ===== SECTION 10: ADD-ONS & EXTRAS =====
  wants_uplighting BOOLEAN DEFAULT 0,
  uplighting_color TEXT,
  wants_karaoke BOOLEAN DEFAULT 0,
  wants_fog_machine BOOLEAN DEFAULT 0,
  wants_photobooth BOOLEAN DEFAULT 0,
  photobooth_coordination_notes TEXT,
  other_vendors TEXT,                      -- Photographer, Videographer, Coordinator names
  vendor_contact_info TEXT,                -- JSON for vendor contacts
  
  -- ===== META =====
  last_saved_section TEXT,                 -- Track where client left off
  completed_at DATETIME,
  emailed_to_client BOOLEAN DEFAULT 0,
  emailed_to_dj BOOLEAN DEFAULT 0,
  admin_notes TEXT,                        -- Notes from admin/DJ after review
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_wedding_forms_booking ON wedding_event_forms(booking_id);
CREATE INDEX IF NOT EXISTS idx_wedding_forms_user ON wedding_event_forms(user_id);
CREATE INDEX IF NOT EXISTS idx_wedding_forms_status ON wedding_event_forms(form_status);

-- Invoices table for automatic invoicing system
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  invoice_number TEXT UNIQUE NOT NULL,         -- e.g., INV-2026-0001
  stripe_invoice_id TEXT,                      -- Stripe Invoice ID if synced
  
  -- Invoice Details
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'refunded')),
  subtotal DECIMAL(10,2) NOT NULL,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  discount_code TEXT,
  total DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  amount_due DECIMAL(10,2) NOT NULL,
  
  -- Line Items stored as JSON
  line_items_json TEXT NOT NULL,               -- [{service, description, qty, rate, amount}]
  
  -- Dates
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  
  -- Payment
  payment_method TEXT,
  payment_reference TEXT,
  
  -- Reminders
  reminder_sent_count INTEGER DEFAULT 0,
  last_reminder_sent DATETIME,
  next_reminder_date DATE,
  auto_reminders BOOLEAN DEFAULT 1,
  
  -- Notes
  notes TEXT,
  terms TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date, status);
