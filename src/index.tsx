import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { 
  hashPassword, 
  verifyPassword, 
  createToken, 
  verifyToken,
  isValidEmail,
  isValidPhone,
  isValidPassword,
  sanitizeInput
} from './auth'

type Bindings = {
  DB: D1Database
}

const JWT_SECRET = 'your-secret-key-change-in-production-2025'

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// API Routes
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ===== AUTHENTICATION ROUTES =====

// Register new user
app.post('/api/auth/register', async (c) => {
  const { DB } = c.env
  
  try {
    const body = await c.req.json()
    const { full_name, email, phone, password } = body
    
    // Validate required fields
    if (!full_name || !email || !phone || !password) {
      return c.json({ error: 'All fields are required' }, 400)
    }
    
    // Validate email
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }
    
    // Validate phone
    if (!isValidPhone(phone)) {
      return c.json({ error: 'Invalid phone format. Use format: +1-XXX-XXX-XXXX' }, 400)
    }
    
    // Validate password
    const passwordValidation = isValidPassword(password)
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.message }, 400)
    }
    
    // Sanitize inputs
    const cleanName = sanitizeInput(full_name)
    const cleanEmail = email.toLowerCase().trim()
    const cleanPhone = phone.trim()
    
    // Check if email already exists
    const existingUser = await DB.prepare(`
      SELECT id FROM users WHERE email = ?
    `).bind(cleanEmail).first()
    
    if (existingUser) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    
    // Hash password
    const passwordHash = await hashPassword(password)
    
    // Insert user
    const result = await DB.prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, 'client')
    `).bind(cleanName, cleanEmail, cleanPhone, passwordHash).run()
    
    // Create JWT token
    const token = await createToken({
      userId: result.meta.last_row_id,
      email: cleanEmail,
      role: 'client'
    }, JWT_SECRET)
    
    return c.json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: result.meta.last_row_id,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        role: 'client'
      }
    }, 201)
    
  } catch (error: any) {
    console.error('Registration error:', error)
    return c.json({ error: 'Registration failed', details: error.message }, 500)
  }
})

// Login user
app.post('/api/auth/login', async (c) => {
  const { DB } = c.env
  
  try {
    const body = await c.req.json()
    const { email, password } = body
    
    // Validate required fields
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }
    
    const cleanEmail = email.toLowerCase().trim()
    
    // Find user
    const user: any = await DB.prepare(`
      SELECT id, full_name, email, phone, password_hash, role
      FROM users
      WHERE email = ?
    `).bind(cleanEmail).first()
    
    if (!user) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    
    // Verify password
    const isValid = await verifyPassword(password, user.password_hash)
    
    if (!isValid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    
    // Create JWT token
    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role
    }, JWT_SECRET)
    
    return c.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    })
    
  } catch (error: any) {
    console.error('Login error:', error)
    return c.json({ error: 'Login failed', details: error.message }, 500)
  }
})

// Verify token and get user info
app.get('/api/auth/me', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, JWT_SECRET)
    
    // Get fresh user data
    const user: any = await DB.prepare(`
      SELECT id, full_name, email, phone, role, created_at
      FROM users
      WHERE id = ?
    `).bind(payload.userId).first()
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }
    
    return c.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        created_at: user.created_at
      }
    })
    
  } catch (error: any) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})

// Get DJ profiles
app.get('/api/services/dj', (c) => {
  const djProfiles = {
    dj_cease: {
      id: 'dj_cease',
      name: 'DJ Cease',
      realName: 'Mike Cecil',
      bio: 'With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event. Specializing in creating seamless musical journeys, Mike has mastered the art of reading the crowd and delivering exactly what the moment needs. From intimate gatherings to grand celebrations, DJ Cease ensures your event\'s soundtrack is nothing short of perfection.',
      specialties: [
        'Weddings & Special Events',
        'Top 40, Hip-Hop, R&B',
        'Crowd Reading & Energy Management',
        'Custom Playlist Curation',
        '20+ Years Experience'
      ],
      priority: 1
    },
    dj_elev8: {
      id: 'dj_elev8',
      name: 'DJ Elev8',
      realName: 'Brad Powell',
      bio: 'Brad Powell, known as DJ Elev8, elevates every event with his dynamic mixing style and vast musical knowledge. His ability to blend genres seamlessly while maintaining high energy keeps dance floors packed all night long. With a passion for creating memorable experiences, DJ Elev8 has become a sought-after name in the entertainment industry.',
      specialties: [
        'High-Energy Dance Events',
        'EDM, House, Top 40',
        'Corporate Events & Parties',
        'Creative Mixing & Transitions',
        '15+ Years Experience'
      ],
      priority: 2
    },
    tko_the_dj: {
      id: 'tko_the_dj',
      name: 'TKOtheDJ',
      realName: 'Joey Tate',
      bio: 'Joey Tate, performing as TKOtheDJ, delivers knockout performances that leave lasting impressions. Known for his technical precision and creative approach, Joey brings fresh energy to the DJ scene. His versatility across genres and dedication to client satisfaction make him an excellent choice for any celebration.',
      specialties: [
        'Versatile Genre Mixing',
        'Birthday Parties & Celebrations',
        'Hip-Hop, Pop, Rock Classics',
        'Interactive Crowd Engagement',
        '10+ Years Experience'
      ],
      priority: 3
    }
  }
  
  return c.json(djProfiles)
})

// Get photobooth info
app.get('/api/services/photobooth', (c) => {
  const photoboothProfile = {
    operators: 'Maria Cecil & Cora Scarborough',
    bio: 'Our professional photobooth service brings fun, laughter, and lasting memories to your event. With two state-of-the-art photobooth setups, we offer high-quality prints, digital sharing options, and a vast selection of props to match any theme. Maria and Cora ensure every guest leaves with a smile and a keepsake.',
    features: [
      'Two Professional Photobooth Units',
      'Unlimited Prints',
      'Digital Photo Gallery',
      'Custom Backdrops & Props',
      'On-Site Attendants',
      'Social Media Integration'
    ],
    capacity: 2
  }
  
  return c.json(photoboothProfile)
})

// Check availability for a specific date and provider
app.post('/api/availability/check', async (c) => {
  const { provider, date } = await c.req.json()
  const { DB } = c.env
  
  try {
    // Check bookings
    const bookings = await DB.prepare(`
      SELECT COUNT(*) as count 
      FROM bookings 
      WHERE service_provider = ? 
      AND event_date = ? 
      AND status != 'cancelled'
    `).bind(provider, date).first()
    
    // Check manual blocks
    const blocks = await DB.prepare(`
      SELECT COUNT(*) as count 
      FROM availability_blocks 
      WHERE service_provider = ? 
      AND block_date = ?
    `).bind(provider, date).first()
    
    let available = true
    let reason = ''
    
    if (blocks && blocks.count > 0) {
      available = false
      reason = 'Date manually blocked'
    } else if (provider.startsWith('photobooth')) {
      available = bookings && bookings.count < 2
      if (!available) reason = 'Both photobooth units booked'
    } else {
      available = bookings && bookings.count === 0
      if (!available) reason = 'DJ already booked on this date'
    }
    
    return c.json({ available, reason })
  } catch (error) {
    return c.json({ error: 'Failed to check availability' }, 500)
  }
})

// Get availability for a month
app.get('/api/availability/:provider/:year/:month', async (c) => {
  const { provider, year, month } = c.param()
  const { DB } = c.env
  
  try {
    const startDate = `${year}-${month.padStart(2, '0')}-01`
    const endDate = `${year}-${month.padStart(2, '0')}-31`
    
    // Get all bookings for this month
    const bookings = await DB.prepare(`
      SELECT event_date, COUNT(*) as count
      FROM bookings
      WHERE service_provider = ?
      AND event_date BETWEEN ? AND ?
      AND status != 'cancelled'
      GROUP BY event_date
    `).bind(provider, startDate, endDate).all()
    
    // Get manual blocks
    const blocks = await DB.prepare(`
      SELECT block_date
      FROM availability_blocks
      WHERE service_provider = ?
      AND block_date BETWEEN ? AND ?
    `).bind(provider, startDate, endDate).all()
    
    const bookedDates = bookings.results?.map((b: any) => b.event_date) || []
    const blockedDates = blocks.results?.map((b: any) => b.block_date) || []
    
    return c.json({ bookedDates, blockedDates })
  } catch (error) {
    return c.json({ error: 'Failed to fetch availability' }, 500)
  }
})

// Landing Page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>In The House Productions - DJ & Photobooth Services</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          /* Color Palette */
          :root {
            --primary-red: #E31E24;
            --deep-red: #8B0000;
            --pure-black: #000000;
            --chrome-silver: #C0C0C0;
            --metallic-chrome: #E8E8E8;
            --dark-chrome: #808080;
            --accent-neon: #FF0040;
          }
          
          body {
            background: #000;
            color: #fff;
            font-family: 'Arial', sans-serif;
            overflow-x: hidden;
          }
          
          /* Animated Musical Notes Background */
          #musical-background {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            opacity: 0.2;
            pointer-events: none;
          }
          
          .note {
            position: absolute;
            font-size: 2rem;
            animation: floatNote linear infinite;
            opacity: 0.5;
          }
          
          @keyframes floatNote {
            from {
              left: 100%;
              opacity: 0.5;
            }
            to {
              left: -10%;
              opacity: 0;
            }
          }
          
          /* Chrome/Red Theme */
          .chrome-border {
            border: 3px solid var(--chrome-silver);
            box-shadow: 0 0 20px rgba(227, 30, 36, 0.6);
            transition: all 0.3s ease;
          }
          
          .chrome-border:hover {
            transform: scale(1.05);
            box-shadow: 0 0 30px rgba(227, 30, 36, 1);
            border-color: var(--primary-red);
          }
          
          .neon-text {
            text-shadow: 0 0 10px rgba(227, 30, 36, 0.8), 0 0 20px rgba(227, 30, 36, 0.5);
          }
          
          .service-card {
            background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%);
            position: relative;
          }
          
          .btn-red {
            background: var(--primary-red);
            border: 2px solid var(--chrome-silver);
            color: white;
            padding: 12px 32px;
            font-weight: bold;
            letter-spacing: 1px;
            transition: all 0.3s ease;
            box-shadow: 0 0 15px rgba(227, 30, 36, 0.5);
          }
          
          .btn-red:hover {
            background: var(--accent-neon);
            box-shadow: 0 0 25px rgba(255, 0, 64, 0.8);
            transform: translateY(-2px);
          }
          
          /* Staff Lines */
          .staff-line {
            height: 2px;
            background: linear-gradient(90deg, transparent, var(--chrome-silver), transparent);
            margin: 10px 0;
          }
        </style>
    </head>
    <body class="min-h-screen">
        <!-- Animated Musical Notes Background -->
        <div id="musical-background"></div>
        
        <!-- Content -->
        <div class="relative z-10">
            <!-- Header -->
            <header class="py-8 text-center">
                <h1 class="text-6xl font-bold neon-text mb-2" style="letter-spacing: 3px;">
                    🎵 IN THE HOUSE PRODUCTIONS 🎵
                </h1>
                <div class="flex justify-center gap-4 my-4">
                    <div class="staff-line w-64"></div>
                </div>
                <p class="text-2xl text-chrome-silver italic">"Your Event, Our Expertise"</p>
            </header>
            
            <!-- Service Cards -->
            <main class="container mx-auto px-4 py-12">
                <div class="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    <!-- DJ Services Card -->
                    <div class="service-card chrome-border rounded-lg p-8 cursor-pointer" onclick="window.location.href='/dj-services'">
                        <div class="text-center mb-6">
                            <i class="fas fa-headphones-alt text-8xl" style="color: var(--primary-red);"></i>
                        </div>
                        <h2 class="text-4xl font-bold text-center mb-4 neon-text">🎧 DJ SERVICES</h2>
                        <p class="text-chrome-silver text-center mb-6 text-lg">
                            Professional DJs spinning the perfect soundtrack for your special event
                        </p>
                        <ul class="text-chrome-silver mb-6 space-y-2">
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> 3 Professional DJs</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> 20+ Years Experience</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> Custom Playlists</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> All Event Types</li>
                        </ul>
                        <button class="btn-3d w-full rounded text-uppercase">
                            SELECT SERVICE <i class="fas fa-arrow-right ml-2"></i>
                        </button>
                    </div>
                    
                    <!-- Photobooth Card -->
                    <div class="service-card chrome-border rounded-lg p-8 cursor-pointer" onclick="window.location.href='/photobooth'">
                        <div class="text-center mb-6">
                            <i class="fas fa-camera-retro text-8xl" style="color: var(--primary-red);"></i>
                        </div>
                        <h2 class="text-3d-red text-3d-large text-center mb-4 text-uppercase">PHOTOBOOTH</h2>
                        <p class="text-chrome-silver text-center mb-6 text-lg">
                            Fun memories with instant prints and shareable moments
                        </p>
                        <ul class="text-chrome-silver mb-6 space-y-2">
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> 2 Professional Units</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> Unlimited Prints</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> Custom Backdrops</li>
                            <li><i class="fas fa-check" style="color: var(--primary-red);"></i> Digital Gallery</li>
                        </ul>
                        <button class="btn-3d w-full rounded text-uppercase">
                            SELECT SERVICE <i class="fas fa-arrow-right ml-2"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Coming Soon Section -->
                <div class="mt-16 text-center">
                    <h3 class="text-3xl font-bold mb-6 neon-text">⭐ MORE SERVICES COMING SOON ⭐</h3>
                    <div class="flex justify-center gap-8 flex-wrap">
                        <div class="text-chrome-silver opacity-50">
                            <i class="fas fa-lightbulb text-4xl mb-2"></i>
                            <p>Professional Lighting</p>
                        </div>
                        <div class="text-chrome-silver opacity-50">
                            <i class="fas fa-video text-4xl mb-2"></i>
                            <p>Event Videography</p>
                        </div>
                        <div class="text-chrome-silver opacity-50">
                            <i class="fas fa-microphone text-4xl mb-2"></i>
                            <p>MC Services</p>
                        </div>
                        <div class="text-chrome-silver opacity-50">
                            <i class="fas fa-music text-4xl mb-2"></i>
                            <p>Karaoke Setup</p>
                        </div>
                    </div>
                </div>
                
                <!-- Auth Buttons -->
                <div class="mt-12 text-center space-x-4">
                    <button onclick="window.location.href='/register'" class="btn-red rounded px-8 py-3">
                        <i class="fas fa-user-plus mr-2"></i> GET STARTED
                    </button>
                    <button onclick="window.location.href='/login'" class="bg-transparent border-2 border-chrome-silver text-chrome-silver px-8 py-3 rounded hover:bg-chrome-silver hover:text-black transition-all">
                        <i class="fas fa-sign-in-alt mr-2"></i> SIGN IN
                    </button>
                </div>
            </main>
            
            <!-- Footer -->
            <footer class="py-8 text-center text-chrome-silver border-t border-dark-chrome mt-16">
                <p>&copy; 2025 In The House Productions. All rights reserved.</p>
                <p class="mt-2">80's • 90's • 2000's Music Era Vibes 🎶</p>
            </footer>
        </div>
        
        <script>
          // Animated Musical Notes Background
          function createMusicalNote() {
            const notes = ['♪', '♫', '♬', '♩', '♭', '♮', '♯'];
            const note = document.createElement('div');
            note.className = 'note';
            note.textContent = notes[Math.floor(Math.random() * notes.length)];
            
            // Random color (red or chrome)
            const colors = ['#E31E24', '#C0C0C0', '#FF0040'];
            note.style.color = colors[Math.floor(Math.random() * colors.length)];
            
            // Random vertical position (on staff lines)
            const staffPositions = [15, 25, 35, 45, 55];
            note.style.top = staffPositions[Math.floor(Math.random() * staffPositions.length)] + '%';
            
            // Random duration (20-40 seconds)
            const duration = 20 + Math.random() * 20;
            note.style.animationDuration = duration + 's';
            
            // Random delay
            note.style.animationDelay = Math.random() * 5 + 's';
            
            document.getElementById('musical-background').appendChild(note);
            
            // Remove note after animation
            setTimeout(() => note.remove(), (duration + 5) * 1000);
          }
          
          // Create notes continuously
          setInterval(createMusicalNote, 2000);
          
          // Initial batch
          for (let i = 0; i < 10; i++) {
            setTimeout(createMusicalNote, i * 500);
          }
        </script>
    </body>
    </html>
  `)
})

// DJ Services Page - Profile Selection
app.get('/dj-services', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DJ Services - In The House Productions</title>
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary-red: #E31E24;
            --chrome-silver: #C0C0C0;
            --accent-neon: #FF0040;
          }
          
          body {
            background: #000;
            color: #fff;
          }
          
          .neon-text {
            text-shadow: 0 0 10px rgba(227, 30, 36, 0.8), 0 0 20px rgba(227, 30, 36, 0.5);
          }
          
          .dj-card {
            background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%);
            border: 3px solid var(--chrome-silver);
            box-shadow: 0 0 20px rgba(227, 30, 36, 0.6);
            transition: all 0.3s ease;
          }
          
          .dj-card:hover {
            transform: scale(1.02);
            box-shadow: 0 0 30px rgba(227, 30, 36, 1);
            border-color: var(--primary-red);
          }
          
          .dj-card.selected {
            border-color: var(--accent-neon);
            box-shadow: 0 0 40px rgba(255, 0, 64, 1);
          }
          
          .heart-icon {
            width: 50px;
            height: 50px;
            cursor: pointer;
            transition: all 0.3s ease;
            filter: drop-shadow(0 0 5px rgba(192, 192, 192, 0.5));
          }
          
          .heart-icon:hover {
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
          
          .priority-badge {
            background: linear-gradient(135deg, var(--primary-red), var(--accent-neon));
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: bold;
            letter-spacing: 1px;
          }
          
          .btn-red {
            background: var(--primary-red);
            border: 2px solid var(--chrome-silver);
            transition: all 0.3s ease;
            box-shadow: 0 0 15px rgba(227, 30, 36, 0.5);
          }
          
          .btn-red:hover {
            background: var(--accent-neon);
            box-shadow: 0 0 25px rgba(255, 0, 64, 0.8);
            transform: translateY(-2px);
          }
          
          .dj-image {
            width: 150px;
            height: 150px;
            border-radius: 50%;
            border: 4px solid var(--chrome-silver);
            background: linear-gradient(135deg, #333, #666);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 4rem;
            margin: 0 auto;
          }
        </style>
    </head>
    <body class="min-h-screen">
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="text-3d-ultra text-3d-huge mb-2 text-uppercase">🎧 SELECT YOUR DJ</h1>
                <p class="text-chrome-silver text-xl">Choose from our professional DJs</p>
                <p class="text-gray-400 mt-2">
                    <i class="fas fa-info-circle mr-2"></i>
                    DJ Cease is automatically selected. Click ❤️ to choose a different DJ.
                </p>
            </div>
            
            <!-- DJ Selection Info -->
            <div id="selectionInfo" class="text-center mb-8 p-4 rounded" style="background: rgba(227, 30, 36, 0.1); border: 2px solid var(--primary-red);">
                <p class="text-lg">
                    <i class="fas fa-check-circle mr-2"></i>
                    <span id="selectedDJName">DJ Cease (Mike Cecil)</span> will be your DJ!
                </p>
            </div>
            
            <!-- DJ Profile Cards -->
            <div class="grid md:grid-cols-3 gap-6 mb-8">
                <!-- DJ Cease -->
                <div class="dj-card rounded-lg p-6 selected" id="card-dj_cease">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-3d-gold text-sm">1ST CHOICE</span>
                        <div class="heart-container" onclick="selectDJ('dj_cease')">
                            <svg class="heart-icon selected" id="heart-dj_cease" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#E31E24">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="dj-image mb-4">
                        🎧
                    </div>
                    
                    <h2 class="text-3xl font-bold text-center mb-2 neon-text">DJ CEASE</h2>
                    <p class="text-center text-chrome-silver mb-4">Mike Cecil</p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-red);"></i>
                            Specialties
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• Weddings & Special Events</li>
                            <li>• Top 40, Hip-Hop, R&B</li>
                            <li>• Crowd Reading</li>
                            <li>• 20+ Years Experience</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">Bio</h3>
                        <p class="text-sm text-gray-400">
                            With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event.
                        </p>
                    </div>
                    
                    <button onclick="viewFullBio('dj_cease')" class="text-primary-red hover:text-accent-neon text-sm">
                        <i class="fas fa-info-circle mr-1"></i> View Full Bio
                    </button>
                </div>
                
                <!-- DJ Elev8 -->
                <div class="dj-card rounded-lg p-6" id="card-dj_elev8">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-3d-gold text-sm">2ND CHOICE</span>
                        <div class="heart-container" onclick="selectDJ('dj_elev8')">
                            <svg class="heart-icon" id="heart-dj_elev8" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#C0C0C0" stroke-width="2">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="dj-image mb-4">
                        🎵
                    </div>
                    
                    <h2 class="text-3xl font-bold text-center mb-2 neon-text">DJ ELEV8</h2>
                    <p class="text-center text-chrome-silver mb-4">Brad Powell</p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-red);"></i>
                            Specialties
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• High-Energy Events</li>
                            <li>• EDM, House, Top 40</li>
                            <li>• Corporate Events</li>
                            <li>• 15+ Years Experience</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">Bio</h3>
                        <p class="text-sm text-gray-400">
                            Brad Powell elevates every event with his dynamic mixing style and vast musical knowledge.
                        </p>
                    </div>
                    
                    <button onclick="viewFullBio('dj_elev8')" class="text-primary-red hover:text-accent-neon text-sm">
                        <i class="fas fa-info-circle mr-1"></i> View Full Bio
                    </button>
                </div>
                
                <!-- TKOtheDJ -->
                <div class="dj-card rounded-lg p-6" id="card-tko_the_dj">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-3d-gold text-sm">3RD CHOICE</span>
                        <div class="heart-container" onclick="selectDJ('tko_the_dj')">
                            <svg class="heart-icon" id="heart-tko_the_dj" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#C0C0C0" stroke-width="2">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="dj-image mb-4">
                        🎶
                    </div>
                    
                    <h2 class="text-3xl font-bold text-center mb-2 neon-text">TKOtheDJ</h2>
                    <p class="text-center text-chrome-silver mb-4">Joey Tate</p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-red);"></i>
                            Specialties
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• Versatile Genre Mixing</li>
                            <li>• Birthday Parties</li>
                            <li>• Hip-Hop, Pop, Rock</li>
                            <li>• 10+ Years Experience</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">Bio</h3>
                        <p class="text-sm text-gray-400">
                            Joey Tate delivers knockout performances that leave lasting impressions with his versatility.
                        </p>
                    </div>
                    
                    <button onclick="viewFullBio('tko_the_dj')" class="text-primary-red hover:text-accent-neon text-sm">
                        <i class="fas fa-info-circle mr-1"></i> View Full Bio
                    </button>
                </div>
            </div>
            
            <!-- Action Buttons -->
            <div class="text-center space-x-4">
                <button onclick="window.location.href='/'" class="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded font-bold">
                    <i class="fas fa-arrow-left mr-2"></i> Back
                </button>
                <button onclick="continueToCalendar()" class="btn-red px-8 py-3 rounded font-bold text-lg">
                    <i class="fas fa-calendar-alt mr-2"></i> CONTINUE TO CALENDAR
                </button>
            </div>
        </div>
        
        <script>
          let selectedDJ = 'dj_cease'; // Default selection
          
          const djData = {
            dj_cease: {
              name: 'DJ Cease (Mike Cecil)',
              fullBio: 'With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event. Specializing in creating seamless musical journeys, Mike has mastered the art of reading the crowd and delivering exactly what the moment needs. From intimate gatherings to grand celebrations, DJ Cease ensures your event\\'s soundtrack is nothing short of perfection.'
            },
            dj_elev8: {
              name: 'DJ Elev8 (Brad Powell)',
              fullBio: 'Brad Powell, known as DJ Elev8, elevates every event with his dynamic mixing style and vast musical knowledge. His ability to blend genres seamlessly while maintaining high energy keeps dance floors packed all night long. With a passion for creating memorable experiences, DJ Elev8 has become a sought-after name in the entertainment industry.'
            },
            tko_the_dj: {
              name: 'TKOtheDJ (Joey Tate)',
              fullBio: 'Joey Tate, performing as TKOtheDJ, delivers knockout performances that leave lasting impressions. Known for his technical precision and creative approach, Joey brings fresh energy to the DJ scene. His versatility across genres and dedication to client satisfaction make him an excellent choice for any celebration.'
            }
          };
          
          function selectDJ(djId) {
            selectedDJ = djId;
            
            // Update all cards
            ['dj_cease', 'dj_elev8', 'tko_the_dj'].forEach(id => {
              const card = document.getElementById('card-' + id);
              const heart = document.getElementById('heart-' + id);
              
              if (id === djId) {
                card.classList.add('selected');
                heart.classList.add('selected');
                heart.setAttribute('fill', '#E31E24');
              } else {
                card.classList.remove('selected');
                heart.classList.remove('selected');
                heart.setAttribute('fill', 'none');
              }
            });
            
            // Update selection info
            document.getElementById('selectedDJName').textContent = djData[djId].name;
          }
          
          function viewFullBio(djId) {
            alert(djData[djId].fullBio);
          }
          
          function continueToCalendar() {
            // Store selected DJ in localStorage
            localStorage.setItem('selectedDJ', selectedDJ);
            
            // Check if user is logged in
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              alert('Please log in to continue booking');
              window.location.href = '/login';
              return;
            }
            
            // Navigate to calendar (placeholder for now)
            alert('Calendar booking coming soon! You selected: ' + djData[selectedDJ].name);
            // window.location.href = '/calendar';
          }
          
          // Check if user is logged in on page load
          window.addEventListener('DOMContentLoaded', () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              const shouldLogin = confirm('You need to be logged in to book a DJ. Would you like to log in now?');
              if (shouldLogin) {
                window.location.href = '/login';
              } else {
                window.location.href = '/';
              }
            }
          });
        </script>
    </body>
    </html>
  `)
})

// Photobooth Page (placeholder for now)
app.get('/photobooth', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Photobooth - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-black text-white min-h-screen">
        <div class="container mx-auto px-4 py-8">
            <div class="text-center">
                <h1 class="text-4xl font-bold mb-4" style="color: #E31E24;">Photobooth Services</h1>
                <p class="text-2xl text-gray-400 mb-8">Coming Soon: Photobooth Booking</p>
                <button onclick="window.location.href='/'" class="bg-red-600 hover:bg-red-700 px-6 py-3 rounded">
                    <i class="fas fa-arrow-left mr-2"></i> Back to Home
                </button>
            </div>
        </div>
    </body>
    </html>
  `)
})

// Register Page
app.get('/register', (c) => {
  return c.html(` <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register - In The House Productions</title>
        <link href="/static/ultra-3d.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      :root {
        --primary-red: #E31E24;
        --chrome-silver: #C0C0C0;
        --accent-neon: #FF0040;
      }
      body { background: #000; color: #fff; }
      .neon-text { text-shadow: 0 0 10px rgba(227, 30, 36, 0.8), 0 0 20px rgba(227, 30, 36, 0.5); }
      .form-card { background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%); border: 3px solid var(--chrome-silver); box-shadow: 0 0 20px rgba(227, 30, 36, 0.6); }
      .input-field { background: #0A0A0A; border: 2px solid var(--chrome-silver); color: white; transition: all 0.3s ease; }
      .input-field:focus { outline: none; border-color: var(--primary-red); box-shadow: 0 0 10px rgba(227, 30, 36, 0.5); }
      .btn-red { background: var(--primary-red); border: 2px solid var(--chrome-silver); transition: all 0.3s ease; box-shadow: 0 0 15px rgba(227, 30, 36, 0.5); }
      .btn-red:hover:not(:disabled) { background: var(--accent-neon); box-shadow: 0 0 25px rgba(255, 0, 64, 0.8); transform: translateY(-2px); }
      .btn-red:disabled { opacity: 0.6; cursor: not-allowed; }
      .error-message { background: rgba(227, 30, 36, 0.2); border: 1px solid var(--primary-red); color: var(--primary-red); }
      .success-message { background: rgba(0, 255, 0, 0.2); border: 1px solid #00ff00; color: #00ff00; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
        <div class="text-center mb-8">
            <h1 class="text-3d-ultra text-3d-huge mb-2 text-uppercase">🎵 REGISTER</h1>
            <p class="text-chrome-silver text-lg">Join In The House Productions</p>
        </div>
        <div class="form-card rounded-lg p-8">
            <div id="message" class="hidden mb-4 p-3 rounded"></div>
            <form id="registerForm" class="space-y-4">
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-user mr-2"></i>Full Name *</label><input type="text" id="full_name" required class="input-field w-full px-4 py-3 rounded" placeholder="John Doe" /></div>
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-envelope mr-2"></i>Email *</label><input type="email" id="email" required class="input-field w-full px-4 py-3 rounded" placeholder="john@example.com" /></div>
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-phone mr-2"></i>Phone Number *</label><input type="tel" id="phone" required class="input-field w-full px-4 py-3 rounded" placeholder="+1-555-123-4567" /></div>
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-lock mr-2"></i>Password *</label><input type="password" id="password" required class="input-field w-full px-4 py-3 rounded" placeholder="Min 8 chars, 1 uppercase, 1 number" /><p class="text-xs text-gray-400 mt-1">Must be at least 8 characters with 1 uppercase letter and 1 number</p></div>
                <button type="submit" class="btn-red w-full py-3 rounded font-bold text-lg"><i class="fas fa-user-plus mr-2"></i>CREATE ACCOUNT</button>
            </form>
            <div class="mt-6 text-center"><p class="text-chrome-silver">Already have an account? <a href="/login" class="text-primary-red hover:text-accent-neon transition-colors">Sign In</a></p></div>
            <div class="mt-4 text-center"><a href="/" class="text-chrome-silver hover:text-white transition-colors"><i class="fas fa-arrow-left mr-2"></i>Back to Home</a></div>
        </div>
    </div>
    <script>
      document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageEl = document.getElementById('message');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const formData = { full_name: document.getElementById('full_name').value, email: document.getElementById('email').value, phone: document.getElementById('phone').value, password: document.getElementById('password').value };
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating Account...';
        try {
          const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
          const data = await response.json();
          if (response.ok) {
            messageEl.className = 'success-message p-3 rounded mb-4';
            messageEl.textContent = '✓ ' + data.message + ' Redirecting...';
            messageEl.classList.remove('hidden');
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setTimeout(() => { window.location.href = '/dj-services'; }, 2000);
          } else {
            messageEl.className = 'error-message p-3 rounded mb-4';
            messageEl.textContent = '✗ ' + (data.error || 'Registration failed');
            messageEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>CREATE ACCOUNT';
          }
        } catch (error) {
          messageEl.className = 'error-message p-3 rounded mb-4';
          messageEl.textContent = '✗ Network error. Please try again.';
          messageEl.classList.remove('hidden');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-user-plus mr-2"></i>CREATE ACCOUNT';
        }
      });
    </script>
</body>
</html>`)
})

// Login Page
app.get('/login', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - In The House Productions</title>
        <link href="/static/ultra-3d.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      :root { --primary-red: #E31E24; --chrome-silver: #C0C0C0; --accent-neon: #FF0040; }
      body { background: #000; color: #fff; }
      .neon-text { text-shadow: 0 0 10px rgba(227, 30, 36, 0.8), 0 0 20px rgba(227, 30, 36, 0.5); }
      .form-card { background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%); border: 3px solid var(--chrome-silver); box-shadow: 0 0 20px rgba(227, 30, 36, 0.6); }
      .input-field { background: #0A0A0A; border: 2px solid var(--chrome-silver); color: white; transition: all 0.3s ease; }
      .input-field:focus { outline: none; border-color: var(--primary-red); box-shadow: 0 0 10px rgba(227, 30, 36, 0.5); }
      .btn-red { background: var(--primary-red); border: 2px solid var(--chrome-silver); transition: all 0.3s ease; box-shadow: 0 0 15px rgba(227, 30, 36, 0.5); }
      .btn-red:hover:not(:disabled) { background: var(--accent-neon); box-shadow: 0 0 25px rgba(255, 0, 64, 0.8); transform: translateY(-2px); }
      .btn-red:disabled { opacity: 0.6; cursor: not-allowed; }
      .error-message { background: rgba(227, 30, 36, 0.2); border: 1px solid var(--primary-red); color: var(--primary-red); }
      .success-message { background: rgba(0, 255, 0, 0.2); border: 1px solid #00ff00; color: #00ff00; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-md">
        <div class="text-center mb-8">
            <h1 class="text-3d-ultra text-3d-huge mb-2 text-uppercase">🎵 SIGN IN</h1>
            <p class="text-chrome-silver text-lg">Welcome Back!</p>
        </div>
        <div class="form-card rounded-lg p-8">
            <div id="message" class="hidden mb-4 p-3 rounded"></div>
            <form id="loginForm" class="space-y-4">
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-envelope mr-2"></i>Email</label><input type="email" id="email" required class="input-field w-full px-4 py-3 rounded" placeholder="john@example.com" /></div>
                <div><label class="block text-chrome-silver mb-2"><i class="fas fa-lock mr-2"></i>Password</label><input type="password" id="password" required class="input-field w-full px-4 py-3 rounded" placeholder="Enter your password" /></div>
                <button type="submit" class="btn-red w-full py-3 rounded font-bold text-lg"><i class="fas fa-sign-in-alt mr-2"></i>SIGN IN</button>
            </form>
            <div class="mt-6 text-center"><p class="text-chrome-silver">Don't have an account? <a href="/register" class="text-primary-red hover:text-accent-neon transition-colors">Register Now</a></p></div>
            <div class="mt-4 text-center"><a href="/" class="text-chrome-silver hover:text-white transition-colors"><i class="fas fa-arrow-left mr-2"></i>Back to Home</a></div>
            <div class="mt-6 text-center text-sm text-gray-500"><p>Testing? Use admin@inthehouseproductions.com / Admin123!</p></div>
        </div>
    </div>
    <script>
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageEl = document.getElementById('message');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const formData = { email: document.getElementById('email').value, password: document.getElementById('password').value };
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing In...';
        try {
          const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
          const data = await response.json();
          if (response.ok) {
            messageEl.className = 'success-message p-3 rounded mb-4';
            messageEl.textContent = '✓ ' + data.message + ' Redirecting...';
            messageEl.classList.remove('hidden');
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setTimeout(() => { if (data.user.role === 'admin') { window.location.href = '/admin'; } else { window.location.href = '/dj-services'; } }, 2000);
          } else {
            messageEl.className = 'error-message p-3 rounded mb-4';
            messageEl.textContent = '✗ ' + (data.error || 'Login failed');
            messageEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>SIGN IN';
          }
        } catch (error) {
          messageEl.className = 'error-message p-3 rounded mb-4';
          messageEl.textContent = '✗ Network error. Please try again.';
          messageEl.classList.remove('hidden');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>SIGN IN';
        }
      });
    </script>
</body>
</html>`)
})

export default app
