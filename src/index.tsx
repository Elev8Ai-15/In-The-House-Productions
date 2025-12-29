import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import Stripe from 'stripe'
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
  JWT_SECRET?: string
  STRIPE_SECRET_KEY?: string
  RESEND_API_KEY?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_PHONE_NUMBER?: string
}

// JWT Secret from environment variable (fallback for development)
const getJWTSecret = (env: any) => {
  return env.JWT_SECRET || 'dev-secret-key-change-in-production-2025'
}

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
    }, getJWTSecret(c.env))
    
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
    // Log only in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Registration error:', error)
    }
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
    }, getJWTSecret(c.env))
    
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
    // Log only in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Login error:', error)
    }
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
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
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
      logo: '/static/dj-cease-logo.png',
      profilePic: '/static/dj-cease-profile.png',
      phone: '727.359.4701',
      bio: 'DJ Cease has 16+ years of DJ experience and knows how to keep any party going! Professional, Reliable, Licensed and Insured.',
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
      profilePic: '/static/dj-elev8-profile.png',
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
      profilePic: '/static/tko-the-dj-profile.png',
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

// DJ Profile Editor Route
app.get('/dj-editor', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DJ Profile Editor - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
            :root {
                --primary-red: #E31E24;
                --chrome-silver: #C0C0C0;
                --deep-black: #0a0a0a;
                --gold: #FFD700;
            }
            
            body {
                background: linear-gradient(135deg, #000 0%, #1a0000 50%, #000 100%);
                min-height: 100vh;
            }
            
            .editor-container {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 2rem;
                max-width: 1800px;
                margin: 0 auto;
                padding: 2rem;
            }
            
            @media (max-width: 1200px) {
                .editor-container {
                    grid-template-columns: 1fr;
                }
            }
            
            .editor-panel {
                background: linear-gradient(145deg, #1a0000, #0a0a0a);
                border: 3px solid var(--primary-red);
                border-radius: 15px;
                padding: 2rem;
                box-shadow: 0 0 30px rgba(227, 30, 36, 0.3);
            }
            
            .preview-panel {
                background: linear-gradient(145deg, #0a0a0a, #1a0000);
                border: 3px solid var(--chrome-silver);
                border-radius: 15px;
                padding: 2rem;
                box-shadow: 0 0 30px rgba(192, 192, 192, 0.3);
                position: sticky;
                top: 2rem;
                max-height: calc(100vh - 4rem);
                overflow-y: auto;
            }
            
            .form-group {
                margin-bottom: 1.5rem;
            }
            
            .form-label {
                display: block;
                color: var(--gold);
                font-weight: bold;
                margin-bottom: 0.5rem;
                text-transform: uppercase;
                letter-spacing: 1px;
                font-size: 0.85rem;
            }
            
            .form-input, .form-textarea, .form-select {
                width: 100%;
                padding: 0.75rem;
                background: rgba(0, 0, 0, 0.5);
                border: 2px solid var(--chrome-silver);
                border-radius: 8px;
                color: white;
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            
            .form-input:focus, .form-textarea:focus, .form-select:focus {
                outline: none;
                border-color: var(--primary-red);
                box-shadow: 0 0 15px rgba(227, 30, 36, 0.5);
            }
            
            .form-textarea {
                min-height: 120px;
                resize: vertical;
                font-family: inherit;
            }
            
            .dj-selector {
                display: flex;
                gap: 1rem;
                margin-bottom: 2rem;
                flex-wrap: wrap;
            }
            
            .dj-btn {
                flex: 1;
                padding: 1rem;
                background: linear-gradient(145deg, #1a0000, #0a0a0a);
                border: 2px solid var(--chrome-silver);
                border-radius: 10px;
                color: white;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s ease;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .dj-btn:hover {
                border-color: var(--primary-red);
                box-shadow: 0 0 20px rgba(227, 30, 36, 0.5);
                transform: translateY(-2px);
            }
            
            .dj-btn.active {
                background: linear-gradient(145deg, var(--primary-red), #a00000);
                border-color: var(--gold);
                box-shadow: 0 0 25px rgba(227, 30, 36, 0.8);
            }
            
            .specialty-list {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            
            .specialty-item {
                display: flex;
                gap: 0.5rem;
                align-items: center;
            }
            
            .specialty-input {
                flex: 1;
                padding: 0.5rem;
                background: rgba(0, 0, 0, 0.5);
                border: 2px solid var(--chrome-silver);
                border-radius: 5px;
                color: white;
            }
            
            .btn-add, .btn-remove {
                padding: 0.5rem 1rem;
                border-radius: 5px;
                border: none;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.3s ease;
            }
            
            .btn-add {
                background: var(--gold);
                color: black;
            }
            
            .btn-remove {
                background: var(--primary-red);
                color: white;
            }
            
            .btn-add:hover, .btn-remove:hover {
                transform: scale(1.05);
                box-shadow: 0 0 15px currentColor;
            }
            
            .preview-card {
                background: linear-gradient(145deg, #1a0000 0%, #0a0a0a 100%);
                border: 3px solid var(--chrome-silver);
                border-radius: 15px;
                padding: 2rem;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            
            .preview-header {
                text-align: center;
                margin-bottom: 1.5rem;
                padding-bottom: 1.5rem;
                border-bottom: 2px solid var(--primary-red);
            }
            
            .preview-bio {
                background: rgba(227, 30, 36, 0.1);
                border-left: 4px solid var(--primary-red);
                padding: 1rem;
                border-radius: 5px;
                color: #ccc;
                line-height: 1.6;
                margin: 1.5rem 0;
            }
            
            .preview-specialties {
                display: grid;
                gap: 0.75rem;
                margin-top: 1.5rem;
            }
            
            .preview-specialty-item {
                background: rgba(192, 192, 192, 0.1);
                border: 2px solid var(--chrome-silver);
                border-radius: 8px;
                padding: 0.75rem 1rem;
                color: white;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            
            .export-btn {
                width: 100%;
                padding: 1rem;
                background: linear-gradient(145deg, var(--gold), #cc9900);
                border: none;
                border-radius: 10px;
                color: black;
                font-weight: bold;
                font-size: 1.1rem;
                cursor: pointer;
                margin-top: 2rem;
                text-transform: uppercase;
                letter-spacing: 1px;
                transition: all 0.3s ease;
            }
            
            .export-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 30px var(--gold);
            }
            
            .priority-badge {
                display: inline-block;
                padding: 0.25rem 0.75rem;
                background: var(--gold);
                color: black;
                border-radius: 20px;
                font-size: 0.75rem;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
        </style>
    </head>
    <body>
        <div class="container mx-auto px-4 py-8">
            <h1 class="text-3d-ultra text-center mb-8" style="font-size: 3rem;">DJ PROFILE EDITOR</h1>
            
            <div class="dj-selector">
                <button class="dj-btn active" onclick="selectDJ('dj_cease')">DJ CEASE</button>
                <button class="dj-btn" onclick="selectDJ('dj_elev8')">DJ ELEV8</button>
                <button class="dj-btn" onclick="selectDJ('tko_the_dj')">TKO THE DJ</button>
            </div>
            
            <div class="editor-container">
                <!-- Editor Panel -->
                <div class="editor-panel">
                    <h2 class="text-3d-gold text-2xl mb-6">EDIT PROFILE</h2>
                    
                    <div class="form-group">
                        <label class="form-label">DJ Name</label>
                        <input type="text" id="djName" class="form-input" placeholder="e.g., DJ Cease">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Real Name</label>
                        <input type="text" id="realName" class="form-input" placeholder="e.g., Mike Cecil">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Priority (1=First Choice, 2=Second, 3=Third)</label>
                        <select id="priority" class="form-select">
                            <option value="1">1st Choice</option>
                            <option value="2">2nd Choice</option>
                            <option value="3">3rd Choice</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Years of Experience</label>
                        <input type="text" id="yearsExp" class="form-input" placeholder="e.g., 20+ Years">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Biography</label>
                        <textarea id="bio" class="form-textarea" placeholder="Write a compelling bio..."></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Specialties</label>
                        <div id="specialtiesList" class="specialty-list"></div>
                        <button onclick="addSpecialty()" class="btn-add mt-2">+ ADD SPECIALTY</button>
                    </div>
                    
                    <button onclick="updatePreview()" class="export-btn">UPDATE PREVIEW</button>
                    <button onclick="exportJSON()" class="export-btn" style="background: linear-gradient(145deg, var(--primary-red), #a00000); color: white;">EXPORT JSON</button>
                </div>
                
                <!-- Preview Panel -->
                <div class="preview-panel">
                    <h2 class="text-3d-chrome text-2xl mb-6 text-center">LIVE PREVIEW</h2>
                    
                    <div class="preview-card" id="previewCard">
                        <div class="preview-header">
                            <div id="previewPriority" class="priority-badge mb-2">1ST CHOICE</div>
                            <h3 class="text-3d-chrome text-3xl mb-2" id="previewName">DJ CEASE</h3>
                            <p class="text-gray-400 text-lg" id="previewRealName">Mike Cecil</p>
                        </div>
                        
                        <div class="preview-bio" id="previewBio">
                            With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event.
                        </div>
                        
                        <div class="preview-specialties" id="previewSpecialties">
                            <!-- Specialties will be rendered here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <script>
            // DJ Data Storage
            const djData = {
                dj_cease: {
                    id: 'dj_cease',
                    name: 'DJ Cease',
                    realName: 'Mike Cecil',
                    logo: '/static/dj-cease-logo.png',
                    profilePic: '/static/dj-cease-profile.png',
                    phone: '727.359.4701',
                    bio: 'DJ Cease has 16+ years of DJ experience and knows how to keep any party going! Professional, Reliable, Licensed and Insured.',
                    specialties: [
                        'Weddings & Special Events',
                        'Top 40, Hip-Hop, R&B',
                        'Crowd Reading & Energy Management',
                        'Custom Playlist Curation',
                        '16+ Years Experience'
                    ],
                    priority: 1,
                    yearsExp: '16+ Years'
                },
                dj_elev8: {
                    id: 'dj_elev8',
                    name: 'DJ Elev8',
                    realName: 'Brad Powell',
                    profilePic: '/static/dj-elev8-profile.png',
                    bio: 'Brad Powell, known as DJ Elev8, elevates every event with his dynamic mixing style and vast musical knowledge. His ability to blend genres seamlessly while maintaining high energy keeps dance floors packed all night long. With a passion for creating memorable experiences, DJ Elev8 has become a sought-after name in the entertainment industry.',
                    specialties: [
                        'High-Energy Dance Events',
                        'EDM, House, Top 40',
                        'Corporate Events & Parties',
                        'Creative Mixing & Transitions',
                        '15+ Years Experience'
                    ],
                    priority: 2,
                    yearsExp: '15+ Years'
                },
                tko_the_dj: {
                    id: 'tko_the_dj',
                    name: 'TKOtheDJ',
                    realName: 'Joey Tate',
                    profilePic: '/static/tko-the-dj-profile.png',
                    bio: 'Joey Tate, performing as TKOtheDJ, delivers knockout performances that leave lasting impressions. Known for his technical precision and creative approach, Joey brings fresh energy to the DJ scene. His versatility across genres and dedication to client satisfaction make him an excellent choice for any celebration.',
                    specialties: [
                        'Versatile Genre Mixing',
                        'Birthday Parties & Celebrations',
                        'Hip-Hop, Pop, Rock Classics',
                        'Interactive Crowd Engagement',
                        '10+ Years Experience'
                    ],
                    priority: 3,
                    yearsExp: '10+ Years'
                }
            };
            
            let currentDJ = 'dj_cease';
            
            function selectDJ(djId) {
                currentDJ = djId;
                
                // Update button states
                document.querySelectorAll('.dj-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                event.target.classList.add('active');
                
                // Load DJ data into form
                const dj = djData[djId];
                document.getElementById('djName').value = dj.name;
                document.getElementById('realName').value = dj.realName;
                document.getElementById('priority').value = dj.priority;
                document.getElementById('yearsExp').value = dj.yearsExp;
                document.getElementById('bio').value = dj.bio;
                
                // Render specialties
                renderSpecialties(dj.specialties);
                
                // Update preview
                updatePreview();
            }
            
            function renderSpecialties(specialties) {
                const list = document.getElementById('specialtiesList');
                list.innerHTML = specialties.map((spec, index) => \`
                    <div class="specialty-item">
                        <input type="text" class="specialty-input" value="\${spec}" onchange="updateSpecialty(\${index}, this.value)">
                        <button class="btn-remove" onclick="removeSpecialty(\${index})">✕</button>
                    </div>
                \`).join('');
            }
            
            function updateSpecialty(index, value) {
                djData[currentDJ].specialties[index] = value;
                updatePreview();
            }
            
            function addSpecialty() {
                djData[currentDJ].specialties.push('New Specialty');
                renderSpecialties(djData[currentDJ].specialties);
                updatePreview();
            }
            
            function removeSpecialty(index) {
                djData[currentDJ].specialties.splice(index, 1);
                renderSpecialties(djData[currentDJ].specialties);
                updatePreview();
            }
            
            function updatePreview() {
                const dj = djData[currentDJ];
                
                // Update from form inputs
                dj.name = document.getElementById('djName').value;
                dj.realName = document.getElementById('realName').value;
                dj.priority = parseInt(document.getElementById('priority').value);
                dj.yearsExp = document.getElementById('yearsExp').value;
                dj.bio = document.getElementById('bio').value;
                
                // Update preview
                const priorityText = ['1ST CHOICE', '2ND CHOICE', '3RD CHOICE'][dj.priority - 1];
                document.getElementById('previewPriority').textContent = priorityText;
                document.getElementById('previewName').textContent = dj.name.toUpperCase();
                document.getElementById('previewRealName').textContent = dj.realName;
                document.getElementById('previewBio').textContent = dj.bio;
                
                // Render specialties preview
                const specialtiesHTML = dj.specialties.map(spec => \`
                    <div class="preview-specialty-item">
                        <span style="color: var(--gold);">▶</span>
                        <span>\${spec}</span>
                    </div>
                \`).join('');
                document.getElementById('previewSpecialties').innerHTML = specialtiesHTML;
            }
            
            function exportJSON() {
                const output = {
                    dj_cease: djData.dj_cease,
                    dj_elev8: djData.dj_elev8,
                    tko_the_dj: djData.tko_the_dj
                };
                
                const jsonStr = JSON.stringify(output, null, 2);
                
                // Create download
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'dj_profiles.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Data exported successfully
                showSuccess('JSON exported! Check your downloads folder for dj_profiles.json', 'Export Complete');
            }
            
            // Initialize on load
            selectDJ('dj_cease');
        </script>
    </body>
    </html>
  `)
})

// Get photobooth info
app.get('/api/services/photobooth', (c) => {
  const photoboothProfile = {
    operators: 'Maria Cecil & Cora Scarborough',
    profilePic: '/static/photobooth-profile.png',
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

// ===== STRIPE SHOPPING CART API =====

// Service pricing configuration
const servicePricing = {
  dj_cease: {
    name: 'DJ Cease (Mike Cecil)',
    basePrice: 500,
    hourlyRate: 150,
    minHours: 3
  },
  dj_elev8: {
    name: 'DJ Elev8 (Brad Powell)',
    basePrice: 500,
    hourlyRate: 150,
    minHours: 3
  },
  tko_the_dj: {
    name: 'TKOtheDJ (Joey Tate)',
    basePrice: 450,
    hourlyRate: 125,
    minHours: 3
  },
  photobooth: {
    name: 'Photobooth Service',
    basePrice: 400,
    hourlyRate: 100,
    minHours: 2
  }
}

// Get cart (stored in client session for now, later use DB)
app.get('/api/cart', async (c) => {
  try {
    // For now, return empty cart structure
    // In production, fetch from database using user session
    return c.json({
      items: [],
      total: 0,
      tax: 0,
      grandTotal: 0
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch cart' }, 500)
  }
})

// Add item to cart
app.post('/api/cart/add', async (c) => {
  try {
    const { serviceId, eventDate, hours } = await c.req.json()
    
    // Validate service
    const service = servicePricing[serviceId as keyof typeof servicePricing]
    if (!service) {
      return c.json({ error: 'Invalid service' }, 400)
    }
    
    // Validate hours
    if (hours < service.minHours) {
      return c.json({ error: `Minimum ${service.minHours} hours required` }, 400)
    }
    
    // Calculate price
    const subtotal = service.basePrice + (service.hourlyRate * hours)
    
    const cartItem = {
      id: `${serviceId}-${Date.now()}`,
      serviceId,
      serviceName: service.name,
      eventDate,
      hours,
      basePrice: service.basePrice,
      hourlyRate: service.hourlyRate,
      subtotal
    }
    
    return c.json({
      success: true,
      item: cartItem,
      message: 'Added to cart'
    })
  } catch (error) {
    return c.json({ error: 'Failed to add to cart' }, 500)
  }
})

// Remove item from cart
app.delete('/api/cart/remove/:itemId', async (c) => {
  try {
    const itemId = c.req.param('itemId')
    
    return c.json({
      success: true,
      message: 'Item removed from cart'
    })
  } catch (error) {
    return c.json({ error: 'Failed to remove item' }, 500)
  }
})

// Create Stripe checkout session
app.post('/api/checkout/create-session', async (c) => {
  try {
    const { items, bookingId } = await c.req.json()
    const { DB } = c.env
    
    // Validate items
    if (!items || items.length === 0) {
      return c.json({ error: 'Cart is empty' }, 400)
    }
    
    // Calculate total
    let total = 0
    const lineItems = items.map((item: any) => {
      const service = servicePricing[item.serviceId as keyof typeof servicePricing]
      if (!service) throw new Error('Invalid service')
      
      const subtotal = service.basePrice + (service.hourlyRate * item.hours)
      total += subtotal
      
      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: service.name,
            description: `${item.hours} hours on ${item.eventDate}`
          },
          unit_amount: subtotal * 100 // Stripe uses cents
        },
        quantity: 1
      }
    })
    
    // Get Stripe API key from environment
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    
    if (!STRIPE_SECRET_KEY) {
      return c.json({
        error: 'Stripe not configured',
        message: 'Please add STRIPE_SECRET_KEY to .dev.vars file',
        instructions: 'Get your key from https://dashboard.stripe.com/test/apikeys',
        total,
        items: lineItems
      }, 500)
    }
    
    // Initialize Stripe client
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any
    })
    
    // Get the base URL for success/cancel redirects
    const baseUrl = new URL(c.req.url).origin
    
    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
      metadata: {
        bookingId: bookingId?.toString() || '',
        items: JSON.stringify(items.map((item: any) => ({
          serviceId: item.serviceId,
          eventDate: item.eventDate,
          hours: item.hours
        })))
      }
    })
    
    // Update booking with Stripe session ID
    if (bookingId && DB) {
      await DB.prepare(`
        UPDATE bookings 
        SET stripe_session_id = ?, payment_status = 'pending'
        WHERE id = ?
      `).bind(session.id, bookingId).run()
    }
    
    return c.json({ 
      sessionId: session.id, 
      url: session.url,
      total
    })
    
  } catch (error: any) {
    console.error('Checkout session error:', error)
    return c.json({ error: error.message || 'Failed to create checkout session' }, 500)
  }
})

// Webhook to handle Stripe events
app.post('/api/webhook/stripe', async (c) => {
  try {
    const signature = c.req.header('stripe-signature')
    const body = await c.req.text()
    
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    const WEBHOOK_SECRET = c.env?.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
    
    if (!STRIPE_SECRET_KEY) {
      return c.json({ error: 'Stripe not configured' }, 500)
    }
    
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any
    })
    
    let event: Stripe.Event
    
    // Verify webhook signature if secret is configured
    if (WEBHOOK_SECRET && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET)
      } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message)
        return c.json({ error: 'Invalid signature' }, 400)
      }
    } else {
      // If no webhook secret, just parse the event (for testing only)
      event = JSON.parse(body)
    }
    
    const { DB } = c.env
    
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session
        console.log('Payment successful:', session.id)
        
        // Update booking status
        const bookingId = session.metadata?.bookingId
        if (bookingId && DB) {
          await DB.prepare(`
            UPDATE bookings 
            SET payment_status = 'paid', 
                status = 'confirmed',
                stripe_payment_intent_id = ?
            WHERE id = ?
          `).bind(session.payment_intent as string, bookingId).run()
          
          console.log('Booking ' + bookingId + ' marked as paid')
        }
        
        break
        
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.log('Payment intent succeeded:', paymentIntent.id)
        break
        
      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object as Stripe.PaymentIntent
        console.error('Payment failed:', failedPayment.id)
        
        // Mark booking as failed if we can find it
        if (DB && failedPayment.metadata?.bookingId) {
          await DB.prepare(`
            UPDATE bookings 
            SET payment_status = 'failed', 
                status = 'cancelled'
            WHERE id = ?
          `).bind(failedPayment.metadata.bookingId).run()
        }
        break
        
      default:
        console.log('Unhandled event type: ' + event.type)
    }
    
    return c.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error.message)
    return c.json({ error: 'Webhook error' }, 400)
  }
})

// Check availability for a specific date, time and provider (DJ double-booking logic)
app.post('/api/availability/check', async (c) => {
  const { provider, date, startTime, endTime } = await c.req.json()
  const { DB } = c.env
  
  try {
    // Check manual blocks first
    const blocks = await DB.prepare(`
      SELECT COUNT(*) as count 
      FROM availability_blocks 
      WHERE service_provider = ? 
      AND block_date = ?
    `).bind(provider, date).first()
    
    if (blocks && blocks.count > 0) {
      return c.json({ 
        available: false, 
        reason: 'Date manually blocked',
        canDoubleBook: false
      })
    }
    
    // Photobooth logic: 2 units, 1 booking per unit per day
    if (provider.startsWith('photobooth')) {
      const bookings = await DB.prepare(`
        SELECT COUNT(*) as count 
        FROM bookings 
        WHERE service_type = 'photobooth'
        AND event_date = ? 
        AND status != 'cancelled'
      `).bind(date).first()
      
      const available = bookings && bookings.count < 2
      return c.json({ 
        available,
        reason: available ? '' : 'Both photobooth units booked',
        canDoubleBook: false,
        bookingsCount: bookings?.count || 0,
        maxBookings: 2
      })
    }
    
    // DJ logic: Check for double-booking possibility
    const existingBookings = await DB.prepare(`
      SELECT id, event_date, start_time, end_time
      FROM booking_time_slots
      WHERE service_provider = ?
      AND event_date = ?
      AND status != 'cancelled'
      ORDER BY start_time ASC
    `).bind(provider, date).all()
    
    const bookingsCount = existingBookings.results?.length || 0
    
    // No bookings = fully available
    if (bookingsCount === 0) {
      return c.json({ 
        available: true,
        canDoubleBook: true,
        bookingsCount: 0,
        maxBookings: 2
      })
    }
    
    // Already has 2 bookings = not available
    if (bookingsCount >= 2) {
      return c.json({ 
        available: false,
        reason: 'DJ already has maximum 2 bookings on this date',
        canDoubleBook: false,
        bookingsCount,
        maxBookings: 2
      })
    }
    
    // Has 1 booking: check if double-booking is possible
    const existing = existingBookings.results[0] as any
    const existingStart = parseTime(existing.start_time)
    const existingEnd = parseTime(existing.end_time)
    const newStart = parseTime(startTime)
    const newEnd = parseTime(endTime)
    
    // Rule 1: If existing booking starts after 11:00 AM, entire day is blocked
    if (existingStart >= parseTime('11:00')) {
      return c.json({
        available: false,
        reason: 'DJ has afternoon/evening event (starts after 11:00 AM). Full day blocked.',
        canDoubleBook: false,
        bookingsCount: 1,
        maxBookings: 2,
        existingBooking: {
          startTime: existing.start_time,
          endTime: existing.end_time
        }
      })
    }
    
    // Rule 2: If new booking starts after 11:00 AM, check if there's time after existing
    if (newStart >= parseTime('11:00')) {
      // Need 3-hour gap after existing booking ends
      const gapHours = (newStart - existingEnd) / 60
      if (gapHours >= 3) {
        return c.json({
          available: true,
          canDoubleBook: true,
          bookingsCount: 1,
          maxBookings: 2,
          message: 'Double-booking allowed: 3+ hour gap between events',
          existingBooking: {
            startTime: existing.start_time,
            endTime: existing.end_time
          }
        })
      } else {
        return c.json({
          available: false,
          reason: `Insufficient time gap: ${gapHours.toFixed(1)} hours (need 3 hours minimum)`,
          canDoubleBook: false,
          bookingsCount: 1,
          maxBookings: 2,
          existingBooking: {
            startTime: existing.start_time,
            endTime: existing.end_time
          }
        })
      }
    }
    
    // Rule 3: Both early bookings (before 11 AM) - check 3-hour gap
    const gapHours = (newStart - existingEnd) / 60
    if (gapHours >= 3) {
      return c.json({
        available: true,
        canDoubleBook: true,
        bookingsCount: 1,
        maxBookings: 2,
        message: 'Double-booking allowed: 3+ hour gap between early events',
        existingBooking: {
          startTime: existing.start_time,
          endTime: existing.end_time
        }
      })
    }
    
    return c.json({
      available: false,
      reason: 'Time conflict with existing booking',
      canDoubleBook: false,
      bookingsCount: 1,
      maxBookings: 2,
      existingBooking: {
        startTime: existing.start_time,
        endTime: existing.end_time
      }
    })
    
  } catch (error: any) {
    console.error('Availability check error:', error)
    return c.json({ error: 'Failed to check availability', details: error.message }, 500)
  }
})

// Helper function to parse time (HH:MM format) to minutes since midnight
function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

// Get availability for a month
app.get('/api/availability/:provider/:year/:month', async (c) => {
  const provider = c.req.param('provider')
  const year = c.req.param('year')
  const month = c.req.param('month')
  const { DB } = c.env
  
  try {
    const startDate = `${year}-${month.padStart(2, '0')}-01`
    const endDate = `${year}-${month.padStart(2, '0')}-31`
    
    // For photobooths, check combined bookings
    if (provider.startsWith('photobooth')) {
      const bookings = await DB.prepare(`
        SELECT event_date, COUNT(*) as count
        FROM bookings
        WHERE service_type = 'photobooth'
        AND event_date BETWEEN ? AND ?
        AND status != 'cancelled'
        GROUP BY event_date
      `).bind(startDate, endDate).all()
      
      const bookedDates = (bookings.results || [])
        .filter((b: any) => b.count >= 2)
        .map((b: any) => b.event_date)
      
      const partiallyBookedDates = (bookings.results || [])
        .filter((b: any) => b.count === 1)
        .map((b: any) => b.event_date)
      
      return c.json({ bookedDates, partiallyBookedDates, blockedDates: [] })
    }
    
    // For DJs, check individual bookings and time slots
    const timeSlots = await DB.prepare(`
      SELECT event_date, COUNT(*) as count, 
             MAX(CASE WHEN start_time >= '11:00' THEN 1 ELSE 0 END) as has_afternoon
      FROM booking_time_slots
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
    
    const bookedDates = (timeSlots.results || [])
      .filter((slot: any) => slot.count >= 2 || slot.has_afternoon === 1)
      .map((slot: any) => slot.event_date)
    
    const partiallyBookedDates = (timeSlots.results || [])
      .filter((slot: any) => slot.count === 1 && slot.has_afternoon === 0)
      .map((slot: any) => slot.event_date)
    
    const blockedDates = blocks.results?.map((b: any) => b.block_date) || []
    
    return c.json({ bookedDates, partiallyBookedDates, blockedDates })
  } catch (error: any) {
    console.error('Fetch availability error:', error)
    return c.json({ error: 'Failed to fetch availability', details: error.message }, 500)
  }
})

// Create a new booking
app.post('/api/bookings/create', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    
    const token = authHeader.substring(7)
    const JWT_SECRET = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, JWT_SECRET)
    } catch (tokenError) {
      console.error('Token verification failed:', tokenError)
      return c.json({ error: 'Invalid or expired token. Please log in again.' }, 401)
    }
    
    const { DB, RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = c.env
    const bookingData = await c.req.json()
    
    // Validate required fields
    const required = ['serviceType', 'serviceProvider', 'eventDate', 'startTime', 'endTime', 'eventDetails']
    for (const field of required) {
      if (!bookingData[field]) {
        return c.json({ error: `Missing required field: ${field}` }, 400)
      }
    }
    
    // Check availability one more time
    const availCheck = await fetch(`${c.req.url.replace('/bookings/create', '/availability/check')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: bookingData.serviceProvider,
        date: bookingData.eventDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime
      })
    })
    
    const availResult = await availCheck.json()
    if (!availResult.available) {
      return c.json({ error: 'Time slot no longer available', reason: availResult.reason }, 409)
    }
    
    // Calculate pricing
    const service = servicePricing[bookingData.serviceType as keyof typeof servicePricing]
    if (!service) {
      return c.json({ error: 'Invalid service type' }, 400)
    }
    
    const hours = calculateHours(bookingData.startTime, bookingData.endTime)
    const totalPrice = service.basePrice + (service.hourlyRate * hours)
    
    // Insert booking
    const bookingResult = await DB.prepare(`
      INSERT INTO bookings (
        user_id, service_type, service_provider, event_date,
        total_price, payment_status, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      payload.userId,
      bookingData.serviceType,
      bookingData.serviceProvider,
      bookingData.eventDate,
      totalPrice,
      'pending',
      'pending'
    ).run()
    
    const bookingId = bookingResult.meta.last_row_id
    
    // Insert time slot for DJ bookings
    if (!bookingData.serviceType.startsWith('photobooth')) {
      await DB.prepare(`
        INSERT INTO booking_time_slots (
          booking_id, service_provider, event_date,
          start_time, end_time, status
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        bookingId,
        bookingData.serviceProvider,
        bookingData.eventDate,
        bookingData.startTime,
        bookingData.endTime,
        'confirmed'
      ).run()
    }
    
    // Insert event details
    const eventDetails = bookingData.eventDetails
    const eventResult = await DB.prepare(`
      INSERT INTO event_details (
        booking_id, event_name, event_type, venue_name,
        venue_address, venue_city, venue_state, venue_zip,
        expected_guests, special_requests, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      bookingId,
      eventDetails.eventName || '',
      eventDetails.eventType || '',
      eventDetails.venueName || '',
      eventDetails.venueAddress || '',
      eventDetails.venueCity || '',
      eventDetails.venueState || '',
      eventDetails.venueZip || '',
      eventDetails.expectedGuests || 0,
      eventDetails.specialRequests || ''
    ).run()
    
    // Send notifications
    try {
      await sendBookingNotifications(c.env, {
        bookingId,
        userId: payload.userId,
        serviceType: bookingData.serviceType,
        serviceProvider: bookingData.serviceProvider,
        eventDate: bookingData.eventDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        eventDetails,
        totalPrice
      })
    } catch (notifError) {
      console.error('Notification error:', notifError)
      // Don't fail booking if notifications fail
    }
    
    return c.json({
      success: true,
      bookingId,
      message: 'Booking created successfully',
      totalPrice,
      nextStep: 'payment'
    })
    
  } catch (error: any) {
    console.error('Booking creation error:', error)
    return c.json({ error: 'Failed to create booking', details: error.message }, 500)
  }
})

// Helper: Calculate hours between times
function calculateHours(startTime: string, endTime: string): number {
  const start = parseTime(startTime)
  const end = parseTime(endTime)
  return Math.ceil((end - start) / 60)
}

// Helper: Send booking notifications (email + SMS)
async function sendBookingNotifications(env: any, booking: any) {
  const { DB, RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = env
  
  // Get user info
  const user = await DB.prepare(`
    SELECT full_name, email, phone FROM users WHERE id = ?
  `).bind(booking.userId).first()
  
  // Get provider contact info
  const provider = await DB.prepare(`
    SELECT provider_name, email, phone FROM provider_contacts WHERE provider_id = ?
  `).bind(booking.serviceProvider).first()
  
  if (!user || !provider) {
    throw new Error('User or provider not found')
  }
  
  // Initialize Resend for emails
  const { Resend } = await import('resend')
  const resend = new Resend(RESEND_API_KEY)
  
  // Use Twilio REST API directly via fetch to avoid large dependency
  const twilioAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  
  // Format event details
  const eventInfo = `
Event: ${booking.eventDetails.eventName || 'N/A'}
Type: ${booking.eventDetails.eventType || 'N/A'}
Date: ${booking.eventDate}
Time: ${booking.startTime} - ${booking.endTime}
Venue: ${booking.eventDetails.venueName || 'N/A'}
Address: ${booking.eventDetails.venueAddress}, ${booking.eventDetails.venueCity}, ${booking.eventDetails.venueState} ${booking.eventDetails.venueZip}
Guests: ${booking.eventDetails.expectedGuests || 'N/A'}
Price: $${booking.totalPrice}
  `.trim()
  
  // Send email to client
  await resend.emails.send({
    from: 'In The House Productions <noreply@inthehouseproductions.com>',
    to: user.email,
    subject: `Booking Confirmation - ${booking.eventDetails.eventName}`,
    html: `
      <h2>Booking Confirmed!</h2>
      <p>Hi ${user.full_name},</p>
      <p>Your booking has been confirmed. Here are the details:</p>
      <pre>${eventInfo}</pre>
      <p><strong>Provider:</strong> ${provider.provider_name}</p>
      <p><strong>Provider Contact:</strong> ${provider.phone}</p>
      <p>We're excited to make your event amazing!</p>
      <p>- In The House Productions Team</p>
    `
  })
  
  // Send email to provider
  await resend.emails.send({
    from: 'In The House Productions <noreply@inthehouseproductions.com>',
    to: [provider.email, 'mcecil38@yahoo.com'], // Send to provider AND Michael Cecil
    subject: `New Booking - ${booking.eventDate}`,
    html: `
      <h2>New Booking Alert!</h2>
      <p>Hi ${provider.provider_name},</p>
      <p>You have a new booking:</p>
      <pre>${eventInfo}</pre>
      <p><strong>Client:</strong> ${user.full_name}</p>
      <p><strong>Client Phone:</strong> ${user.phone}</p>
      <p><strong>Client Email:</strong> ${user.email}</p>
      <p>Please confirm receipt and reach out to the client to finalize details.</p>
      <p>Booking ID: ${booking.bookingId}</p>
    `
  })
  
  // Send SMS to provider via Twilio REST API
  const smsBody = `NEW BOOKING: ${booking.eventDetails.eventName} on ${booking.eventDate} at ${booking.startTime}. Client: ${user.full_name} (${user.phone}). Check email for details.`
  
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${twilioAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      From: TWILIO_PHONE_NUMBER,
      To: provider.phone,
      Body: smsBody
    })
  })
  
  // Log notifications
  await DB.prepare(`
    INSERT INTO notifications (
      booking_id, recipient_type, recipient_id,
      notification_type, channel, status, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(booking.bookingId, 'client', booking.userId, 'booking_confirmed', 'email', 'sent').run()
  
  await DB.prepare(`
    INSERT INTO notifications (
      booking_id, recipient_type, recipient_id,
      notification_type, channel, status, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(booking.bookingId, 'provider', booking.serviceProvider, 'booking_confirmed', 'email', 'sent').run()
  
  await DB.prepare(`
    INSERT INTO notifications (
      booking_id, recipient_type, recipient_id,
      notification_type, channel, status, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(booking.bookingId, 'provider', booking.serviceProvider, 'booking_confirmed', 'sms', 'sent').run()
}

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
            background: #000000;
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
            <header class="py-12 text-center">
                <div class="mb-8">
                    <img src="/static/hero-logo-3d-v2.png" alt="IN THE HOUSE PRODUCTIONS" class="mx-auto" style="max-width: 90%; height: auto;">
                </div>
                <div class="flex justify-center gap-4 my-6">
                    <div class="staff-line w-96"></div>
                </div>
                <p class="text-2xl text-gold italic" style="color: #FFD700; text-shadow: 0 0 20px rgba(255, 215, 0, 0.8);">"Your Event, Our Expertise"</p>
            </header>
            
            <!-- Service Cards -->
            <main class="container mx-auto px-4 py-12">
                <div class="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    <!-- DJ Services Card -->
                    <div class="service-card chrome-border rounded-lg p-8 cursor-pointer" onclick="window.location.href='/dj-services'">
                        <div class="text-center mb-6">
                            <i class="fas fa-headphones-alt text-8xl" style="color: var(--primary-red);"></i>
                        </div>
                        <div class="text-center mb-4">
                            <img src="/static/dj-services-logo-3d.png" alt="DJ SERVICES" class="mx-auto" style="max-width: 400px; height: auto;">
                        </div>
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
                        <div class="text-center mb-4">
                            <img src="/static/photobooth-logo-3d.png" alt="PHOTOBOOTH" class="mx-auto" style="max-width: 400px; height: auto;">
                        </div>
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
                    <h3 class="text-3d-logo-12k-gold text-3d-medium mb-6">⭐ MORE SERVICES COMING SOON ⭐</h3>
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
            background: #000000;
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
        <!-- Professional Modal -->
        <div id="proModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);z-index:9999;justify-content:center;align-items:center;">
            <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border:2px solid #FFD700;border-radius:16px;padding:32px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(220,20,60,0.5);animation:slideUp 0.3s ease;">
                <div id="proModalIcon" style="text-align:center;font-size:64px;margin-bottom:20px;"></div>
                <h2 id="proModalTitle" style="color:white;font-size:24px;font-weight:bold;text-align:center;margin-bottom:16px;"></h2>
                <p id="proModalMsg" style="color:#C0C0C0;font-size:16px;text-align:center;line-height:1.6;margin-bottom:24px;"></p>
                <div id="proModalBtns" style="display:flex;gap:12px;justify-content:center;"></div>
            </div>
        </div>
        <style>
        @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        #proModal.show{display:flex!important}
        .pro-btn{padding:12px 32px;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:all 0.3s;text-transform:uppercase}
        .pro-btn-primary{background:linear-gradient(135deg,#DC143C,#ff1744);color:white}
        .pro-btn-primary:hover{box-shadow:0 6px 20px rgba(220,20,60,0.6);transform:translateY(-2px)}
        .pro-btn-secondary{background:linear-gradient(135deg,#555,#777);color:white}
        .pro-btn-secondary:hover{box-shadow:0 6px 20px rgba(192,192,192,0.4);transform:translateY(-2px)}
        </style>
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <img src="/static/dj-page-hero-3d.png" alt="SELECT YOUR DJ" class="mx-auto mb-4" style="max-width: 600px; height: auto;">
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
                    
                    <div class="dj-image mb-4 text-center">
                        <img src="/static/dj-cease-logo.png" alt="DJ Cease Logo" class="mx-auto" style="max-width: 200px; border-radius: 10px;">
                    </div>
                    
                    <div class="text-center mb-2">
                        <img src="/static/dj-cease-name-3d.png" alt="DJ CEASE" class="mx-auto" style="max-width: 180px; height: auto;">
                    </div>
                    <p class="text-center text-chrome-silver mb-4">Mike Cecil</p>
                    <p class="text-center text-gold mb-4">
                        <i class="fas fa-phone mr-2"></i>727.359.4701
                    </p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-red);"></i>
                            Specialties
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• Weddings & Special Events</li>
                            <li>• Top 40, Hip-Hop, R&B</li>
                            <li>• Crowd Reading</li>
                            <li>• 16+ Years Experience</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">Bio</h3>
                        <p class="text-sm text-gray-400">
                            DJ Cease has 16+ years of DJ experience and knows how to keep any party going! Professional, Reliable, Licensed and Insured.
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
                    
                    <div class="dj-image mb-4 text-center">
                        <img src="/static/dj-elev8-profile.png" alt="DJ Elev8" class="mx-auto" style="max-width: 200px; border-radius: 10px;">
                    </div>
                    
                    <div class="text-center mb-2">
                        <img src="/static/dj-elev8-name-3d.png" alt="DJ ELEV8" class="mx-auto" style="max-width: 180px; height: auto;">
                    </div>
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
                    
                    <div class="dj-image mb-4 text-center">
                        <img src="/static/tko-the-dj-profile.png" alt="TKOtheDJ" class="mx-auto" style="max-width: 200px; border-radius: 10px;">
                    </div>
                    
                    <div class="text-center mb-2">
                        <img src="/static/tko-name-3d.png" alt="TKOTHEDJ" class="mx-auto" style="max-width: 180px; height: auto;">
                    </div>
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
          
          async function viewFullBio(djId) {
            await showAlert(djData[djId].fullBio, djData[djId].name + ' - Full Bio');
          }
          
          function continueToCalendar() async {
            // Store selected DJ in localStorage
            localStorage.setItem('selectedDJ', selectedDJ);
            
            // Check if user is logged in
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              await showAlert('Please log in to continue booking', 'Login Required');
              window.location.href = '/login';
              return;
            }
            
            // Navigate to calendar
            window.location.href = "/calendar";
          }
          
          // Professional Modal Functions
          window.showConfirm=function(msg,title='Confirm'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-question-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-secondary">Cancel</button><button class="pro-btn pro-btn-primary">Confirm</button>';b.querySelectorAll('button')[0].onclick=()=>{m.classList.remove('show');r(false)};b.querySelectorAll('button')[1].onclick=()=>{m.classList.remove('show');r(true)};m.classList.add('show')})};
          window.showAlert=function(msg,title='Notice'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-info-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          window.showSuccess=function(msg,title='Success'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-check-circle" style="color:#28A745"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          window.showError=function(msg,title='Error'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-times-circle" style="color:#DC143C"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          
          // Check if user is logged in on page load
          window.addEventListener('DOMContentLoaded', async () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              const shouldLogin = await showConfirm('You need to be logged in to book a DJ. Would you like to log in now?', 'Login Required');
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


// Calendar Page - Date Selection
app.get('/calendar', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Select Date - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <link href="/static/calendar.css" rel="stylesheet">
        <style>
          :root {
            --primary-red: #E31E24;
            --deep-red: #8B0000;
            --chrome-silver: #C0C0C0;
            --accent-neon: #FF0040;
          }
          
          body {
            background: #000;
            color: #fff;
            min-height: 100vh;
          }
        </style>
    </head>
    <body class="p-4">
        <!-- Header -->
        <div class="text-center mb-8">
            <img src="/static/calendar-hero-3d.png" alt="SELECT YOUR DATE" style="max-width: 600px; width: 100%; margin: 0 auto; display: block;" class="mb-4">
            <p class="text-3d-gold text-3d-small" id="selectedDJDisplay">Loading DJ selection...</p>
        </div>

        <!-- Calendar Container -->
        <div class="calendar-container">
            <!-- Calendar Header with Navigation -->
            <div class="calendar-header">
                <button class="calendar-nav-btn" onclick="previousMonth()">
                    <i class="fas fa-chevron-left"></i> PREV
                </button>
                <div class="calendar-month-year text-3d-chrome" id="monthYear">
                    Loading...
                </div>
                <button class="calendar-nav-btn" onclick="nextMonth()">
                    NEXT <i class="fas fa-chevron-right"></i>
                </button>
            </div>

            <!-- Calendar Grid -->
            <div class="calendar-grid" id="calendarGrid">
                <!-- Calendar will be populated by JavaScript -->
            </div>

            <!-- Legend -->
            <div class="calendar-legend">
                <div class="legend-item">
                    <div class="legend-box available"></div>
                    <span>Available</span>
                </div>
                <div class="legend-item">
                    <div class="legend-box booked"></div>
                    <span>Booked</span>
                </div>
                <div class="legend-item">
                    <div class="legend-box selected"></div>
                    <span>Selected</span>
                </div>
                <div class="legend-item">
                    <div class="legend-box today"></div>
                    <span>Today</span>
                </div>
            </div>

            <!-- Selected Date Display -->
            <div id="selectedDateContainer" style="display: none;">
                <div class="selected-date-display">
                    <h3 class="text-3d-gold">SELECTED DATE</h3>
                    <p id="selectedDateText"></p>
                    <p class="availability-status" id="availabilityStatus"></p>
                </div>
                
                <div class="flex justify-center">
                    <button class="continue-booking-btn" onclick="continueToEventDetails()">
                        CONTINUE TO EVENT DETAILS
                        <i class="fas fa-arrow-right ml-2"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- Back Button -->
        <div class="text-center mt-8">
            <button class="btn-3d" onclick="window.location.href='/dj-services'">
                <i class="fas fa-arrow-left mr-2"></i>
                BACK TO DJ SELECTION
            </button>
        </div>

        <script>
          let currentMonth = new Date().getMonth();
          let currentYear = new Date().getFullYear();
          let selectedDate = null;
          let selectedDJ = null;
          let availabilityData = {};
          
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          
          // Check authentication and load selection
          window.addEventListener('DOMContentLoaded', async () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              await showAlert('Please log in to continue booking.', 'Login Required');
              window.location.href = '/login';
              return;
            }
            
            // Get service type (DJ or Photobooth)
            const serviceType = localStorage.getItem('serviceType');
            selectedDJ = localStorage.getItem('selectedDJ');
            const selectedPhotobooth = localStorage.getItem('selectedPhotobooth');
            
            // Check if ANY service is selected
            if (!selectedDJ && !selectedPhotobooth) {
              await showAlert('Please select a service first (DJ or Photobooth).', 'Selection Required');
              window.location.href = '/';
              return;
            }
            
            // Display selected service
            if (serviceType === 'photobooth') {
              const photoboothNames = {
                'unit1': 'Photobooth Unit 1 (Maria Cecil)',
                'unit2': 'Photobooth Unit 2 (Cora Scarborough)'
              };
              document.getElementById('selectedDJDisplay').textContent = 
                'Booking for: ' + (photoboothNames[selectedPhotobooth] || 'Photobooth');
            } else {
              const djNames = {
                'dj_cease': 'DJ Cease',
                'dj_elev8': 'DJ Elev8',
                'tko_the_dj': 'TKOtheDJ'
              };
              document.getElementById('selectedDJDisplay').textContent = 
                'Booking for: ' + (djNames[selectedDJ] || 'DJ Service');
            }
            
            // Load calendar
            await renderCalendar();
          });
          
          async function renderCalendar() {
            // Update month/year display
            document.getElementById('monthYear').textContent = 
              monthNames[currentMonth] + ' ' + currentYear;
            
            // Load availability data for current month
            await loadAvailability();
            
            const grid = document.getElementById('calendarGrid');
            grid.innerHTML = '';
            
            // Add day headers
            dayNames.forEach(day => {
              const header = document.createElement('div');
              header.className = 'calendar-day-header';
              header.textContent = day;
              grid.appendChild(header);
            });
            
            // Get first day of month and number of days
            const firstDay = new Date(currentYear, currentMonth, 1).getDay();
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Add empty cells for days before month starts
            for (let i = 0; i < firstDay; i++) {
              const emptyDay = document.createElement('div');
              emptyDay.className = 'calendar-day empty';
              grid.appendChild(emptyDay);
            }
            
            // Add days of month
            for (let day = 1; day <= daysInMonth; day++) {
              const dayElement = document.createElement('div');
              const dateStr = \`\${currentYear}-\${String(currentMonth + 1).padStart(2, '0')}-\${String(day).padStart(2, '0')}\`;
              const cellDate = new Date(currentYear, currentMonth, day);
              cellDate.setHours(0, 0, 0, 0);
              
              dayElement.className = 'calendar-day';
              
              // Check if past date
              if (cellDate < today) {
                dayElement.classList.add('past');
              } else {
                // Check availability
                const availability = availabilityData[dateStr];
                if (availability) {
                  if (availability.available) {
                    dayElement.classList.add('available');
                    dayElement.onclick = () => selectDate(dateStr);
                  } else {
                    dayElement.classList.add('booked');
                  }
                  
                  // Add capacity indicator
                  const capacity = document.createElement('div');
                  capacity.className = 'capacity-indicator';
                  capacity.textContent = \`\${availability.remainingSlots}/\${availability.capacity}\`;
                  dayElement.appendChild(capacity);
                } else {
                  // No availability data yet - assume available and make clickable
                  dayElement.classList.add('available');
                  dayElement.onclick = () => selectDate(dateStr);
                }
              }
              
              // Check if today
              if (cellDate.getTime() === today.getTime()) {
                dayElement.classList.add('today');
              }
              
              // Check if selected
              if (selectedDate === dateStr) {
                dayElement.classList.add('selected');
              }
              
              // Add day number
              const dayNumber = document.createElement('div');
              dayNumber.className = 'day-number';
              dayNumber.textContent = day;
              dayElement.insertBefore(dayNumber, dayElement.firstChild);
              
              grid.appendChild(dayElement);
            }
          }
          
          async function loadAvailability() {
            try {
              // Get availability for current month
              const provider = selectedDJ;
              const response = await fetch(\`/api/availability/\${provider}/\${currentYear}/\${currentMonth + 1}\`);
              const data = await response.json();
              availabilityData = data;
            } catch (error) {
              // Error handled silently - show user-friendly message
              availabilityData = {};
            }
          }
          
          function selectDate(dateStr) {
            selectedDate = dateStr;
            localStorage.setItem('selectedDate', dateStr);
            
            // Update calendar display
            renderCalendar();
            
            // Show selected date display
            const container = document.getElementById('selectedDateContainer');
            container.style.display = 'block';
            
            // Format and display date
            const date = new Date(dateStr);
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            document.getElementById('selectedDateText').textContent = 
              date.toLocaleDateString('en-US', options);
            
            // Show availability status
            const availability = availabilityData[dateStr];
            if (availability && availability.available) {
              document.getElementById('availabilityStatus').textContent = 
                \`✅ Available - \${availability.remainingSlots} slot(s) remaining\`;
            }
            
            // Scroll to selected date display
            container.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          
          function previousMonth() {
            currentMonth--;
            if (currentMonth < 0) {
              currentMonth = 11;
              currentYear--;
            }
            renderCalendar();
          }
          
          function nextMonth() {
            currentMonth++;
            if (currentMonth > 11) {
              currentMonth = 0;
              currentYear++;
            }
            renderCalendar();
          }
          
          function continueToEventDetails() {
            if (!selectedDate) {
              await showAlert('Please select a date first.', 'Selection Required');
              return;
            }
            
            // Get service type and provider
            const serviceType = localStorage.getItem('serviceType');
            const selectedPhotobooth = localStorage.getItem('selectedPhotobooth');
            
            // Store all booking data
            const bookingDataToSave = {
              date: selectedDate
            };
            
            if (serviceType === 'photobooth') {
              bookingDataToSave.serviceType = 'photobooth';
              bookingDataToSave.serviceProvider = selectedPhotobooth;
              const photoboothNames = {
                'unit1': 'Photobooth Unit 1 (Maria Cecil)',
                'unit2': 'Photobooth Unit 2 (Cora Scarborough)'
              };
              bookingDataToSave.photoboothName = photoboothNames[selectedPhotobooth];
            } else {
              bookingDataToSave.serviceType = 'dj';
              bookingDataToSave.dj = selectedDJ;
              bookingDataToSave.serviceProvider = selectedDJ;
              const djNames = {
                'dj_cease': 'DJ Cease',
                'dj_elev8': 'DJ Elev8',
                'tko_the_dj': 'TKOtheDJ'
              };
              bookingDataToSave.djName = djNames[selectedDJ];
            }
            
            localStorage.setItem('bookingData', JSON.stringify(bookingDataToSave));
            
            // Navigate to event details form
            window.location.href = '/event-details';
          }
        </script>
    </body>
    </html>
  `)
})

// Event Details Form Page
app.get('/event-details', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Event Details - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
          :root {
            --primary-red: #E31E24;
            --chrome-silver: #C0C0C0;
            --deep-black: #000;
          }
          
          body {
            background: #000;
            color: #fff;
          }
          
          .form-container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(20, 20, 20, 0.9);
            border: 2px solid var(--chrome-silver);
            border-radius: 15px;
            padding: 2rem;
            box-shadow: 0 0 30px rgba(227, 30, 36, 0.3);
          }
          
          .form-group {
            margin-bottom: 1.5rem;
          }
          
          .form-label {
            display: block;
            color: var(--chrome-silver);
            font-weight: bold;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .form-input, .form-select, .form-textarea {
            width: 100%;
            padding: 0.75rem;
            background: rgba(0, 0, 0, 0.5);
            border: 2px solid #333;
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            transition: all 0.3s ease;
          }
          
          .form-input:focus, .form-select:focus, .form-textarea:focus {
            outline: none;
            border-color: var(--primary-red);
            box-shadow: 0 0 15px rgba(227, 30, 36, 0.3);
          }
          
          .form-textarea {
            resize: vertical;
            min-height: 100px;
          }
          
          .btn-submit {
            background: linear-gradient(135deg, var(--primary-red), #FF0040);
            color: white;
            padding: 1rem 3rem;
            border: 2px solid var(--chrome-silver);
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 2px;
            box-shadow: 0 0 20px rgba(227, 30, 36, 0.5);
          }
          
          .btn-submit:hover {
            transform: translateY(-3px);
            box-shadow: 0 0 30px rgba(255, 0, 64, 0.8);
          }
          
          .btn-submit:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .booking-summary {
            background: rgba(227, 30, 36, 0.1);
            border: 2px solid var(--primary-red);
            border-radius: 10px;
            padding: 1.5rem;
            margin-bottom: 2rem;
          }
          
          .required {
            color: var(--primary-red);
          }
          
          .time-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
          }
        </style>
    </head>
    <body class="min-h-screen p-4">
        <div class="form-container">
            <!-- Header -->
            <div class="text-center mb-8">
                <img src="/static/event-details-hero-3d.png" alt="EVENT DETAILS" style="max-width: 600px; width: 100%; margin: 0 auto; display: block;" class="mb-2">
                <p class="text-chrome-silver">Tell us about your event</p>
            </div>
            
            <!-- Booking Summary -->
            <div class="booking-summary">
                <h2 class="text-xl font-bold mb-3 text-center">Your Selection</h2>
                <div class="grid md:grid-cols-2 gap-4 text-center">
                    <div>
                        <p class="text-chrome-silver text-sm">SERVICE</p>
                        <p class="text-lg font-bold" id="summaryService">Loading...</p>
                    </div>
                    <div>
                        <p class="text-chrome-silver text-sm">DATE</p>
                        <p class="text-lg font-bold" id="summaryDate">Loading...</p>
                    </div>
                </div>
            </div>
            
            <!-- Event Details Form -->
            <form id="eventForm">
                <!-- Event Name -->
                <div class="form-group">
                    <label class="form-label">
                        Event Name <span class="required">*</span>
                    </label>
                    <input type="text" id="eventName" class="form-input" 
                           placeholder="e.g., Sarah & John's Wedding Reception" required>
                </div>
                
                <!-- Event Type -->
                <div class="form-group">
                    <label class="form-label">
                        Event Type <span class="required">*</span>
                    </label>
                    <select id="eventType" class="form-select" required>
                        <option value="">-- Select Event Type --</option>
                        <option value="wedding">Wedding</option>
                        <option value="corporate">Corporate Event</option>
                        <option value="birthday">Birthday Party</option>
                        <option value="anniversary">Anniversary</option>
                        <option value="graduation">Graduation</option>
                        <option value="holiday">Holiday Party</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                
                <!-- Time Selection -->
                <div class="form-group">
                    <label class="form-label">
                        Event Time <span class="required">*</span>
                    </label>
                    <div class="time-grid">
                        <div>
                            <label class="text-sm text-gray-400">Start Time</label>
                            <input type="time" id="startTime" class="form-input" required>
                        </div>
                        <div>
                            <label class="text-sm text-gray-400">End Time</label>
                            <input type="time" id="endTime" class="form-input" required>
                        </div>
                    </div>
                </div>
                
                <!-- Venue Name -->
                <div class="form-group">
                    <label class="form-label">
                        Venue Name <span class="required">*</span>
                    </label>
                    <input type="text" id="venueName" class="form-input" 
                           placeholder="e.g., Grand Ballroom" required>
                </div>
                
                <!-- Venue Address -->
                <div class="form-group">
                    <label class="form-label">
                        Venue Address <span class="required">*</span>
                    </label>
                    <input type="text" id="venueAddress" class="form-input" 
                           placeholder="Street Address" required>
                </div>
                
                <!-- City, State, ZIP -->
                <div class="grid md:grid-cols-3 gap-4 mb-6">
                    <div>
                        <label class="form-label">City <span class="required">*</span></label>
                        <input type="text" id="venueCity" class="form-input" required>
                    </div>
                    <div>
                        <label class="form-label">State <span class="required">*</span></label>
                        <input type="text" id="venueState" class="form-input" 
                               maxlength="2" placeholder="FL" required>
                    </div>
                    <div>
                        <label class="form-label">ZIP <span class="required">*</span></label>
                        <input type="text" id="venueZip" class="form-input" 
                               maxlength="10" placeholder="33701" required>
                    </div>
                </div>
                
                <!-- Expected Guests -->
                <div class="form-group">
                    <label class="form-label">
                        Expected Number of Guests <span class="required">*</span>
                    </label>
                    <input type="number" id="expectedGuests" class="form-input" 
                           min="1" placeholder="e.g., 150" required>
                </div>
                
                <!-- Special Requests -->
                <div class="form-group">
                    <label class="form-label">
                        Special Requests or Notes
                    </label>
                    <textarea id="specialRequests" class="form-textarea" 
                              placeholder="Any special music requests, equipment needs, or other details we should know..."></textarea>
                </div>
                
                <!-- Submit Button -->
                <div class="text-center mt-8">
                    <button type="submit" class="btn-submit" id="submitBtn">
                        <i class="fas fa-arrow-right mr-2"></i>
                        CONTINUE TO PAYMENT
                    </button>
                </div>
            </form>
        </div>
        
        <script>
          // Load booking data from localStorage
          let bookingData = {};
          
          window.addEventListener('DOMContentLoaded', async () => {
            // Check authentication
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              await showAlert('Please log in to continue.', 'Login Required');
              window.location.href = '/login';
              return;
            }
            
            // Load booking data
            const storedData = localStorage.getItem('bookingData');
            if (!storedData) {
              await showAlert('No booking data found. Please start from the beginning.', 'Error');
              window.location.href = '/';
              return;
            }
            
            bookingData = JSON.parse(storedData);
            
            // Display summary
            document.getElementById('summaryService').textContent = 
              bookingData.serviceType === 'photobooth' ? 'Photobooth Service' : 
              (bookingData.djName || 'DJ Service');
            
            const dateObj = new Date(bookingData.date);
            document.getElementById('summaryDate').textContent = 
              dateObj.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              });
          });
          
          // Form submission
          document.getElementById('eventForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>PROCESSING...';
            
            try {
              // Check if user is logged in
              const authToken = localStorage.getItem('authToken');
              if (!authToken) {
                await showAlert('Please log in to continue with your booking.', 'Login Required');
                window.location.href = '/login';
                return;
              }
              
              // Collect form data
              const eventDetails = {
                eventName: document.getElementById('eventName').value,
                eventType: document.getElementById('eventType').value,
                venueName: document.getElementById('venueName').value,
                venueAddress: document.getElementById('venueAddress').value,
                venueCity: document.getElementById('venueCity').value,
                venueState: document.getElementById('venueState').value.toUpperCase(),
                venueZip: document.getElementById('venueZip').value,
                expectedGuests: parseInt(document.getElementById('expectedGuests').value),
                specialRequests: document.getElementById('specialRequests').value
              };
              
              const startTime = document.getElementById('startTime').value;
              const endTime = document.getElementById('endTime').value;
              
              // Create booking
              const response = await fetch('/api/bookings/create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': \`Bearer \${authToken}\`
                },
                body: JSON.stringify({
                  serviceType: bookingData.serviceType || bookingData.dj,
                  serviceProvider: bookingData.dj || bookingData.serviceProvider,
                  eventDate: bookingData.date,
                  startTime,
                  endTime,
                  eventDetails
                })
              });
              
              const result = await response.json();
              
              if (!response.ok) {
                // If token is invalid/expired, clear storage and redirect to login
                if (result.error && (result.error.includes('token') || result.error.includes('Token'))) {
                  localStorage.removeItem('authToken');
                  localStorage.removeItem('user');
                  await showAlert('Your session has expired. Please log in again.', 'Session Expired');
                  window.location.href = '/login';
                  return;
                }
                throw new Error(result.error || 'Booking failed');
              }
              
              // Store booking ID
              localStorage.setItem('bookingId', result.bookingId);
              
              // Create Stripe checkout session
              const checkoutResponse = await fetch('/api/checkout/create-session', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': \`Bearer \${authToken}\`
                },
                body: JSON.stringify({
                  bookingId: result.bookingId,
                  items: [{
                    serviceId: bookingData.dj || bookingData.serviceType,
                    eventDate: bookingData.date,
                    hours: calculateHours(startTime, endTime)
                  }]
                })
              });
              
              const checkoutData = await checkoutResponse.json();
              
              if (!checkoutResponse.ok) {
                throw new Error(checkoutData.error || 'Checkout session creation failed');
              }
              
              // Redirect to Stripe
              window.location.href = checkoutData.url;
              
            } catch (error) {
              await showError('Error: ' + error.message, 'Booking Error');
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>CONTINUE TO PAYMENT';
            }
          });
          
          function calculateHours(start, end) {
            const [startHour, startMin] = start.split(':').map(Number);
            const [endHour, endMin] = end.split(':').map(Number);
            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;
            return Math.ceil((endMinutes - startMinutes) / 60);
          }
        </script>
    </body>
    </html>
  `)
})

// Photobooth Page
app.get('/photobooth', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Photobooth Services - In The House Productions</title>
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary-gold: #FFD700;
            --chrome-silver: #C0C0C0;
            --accent-gold: #FFA500;
          }
          
          body {
            background: #000;
            color: #fff;
          }
          
          .photobooth-card {
            background: #000000;
            border: 3px solid var(--chrome-silver);
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.6);
            transition: all 0.3s ease;
          }
          
          .photobooth-card:hover {
            transform: scale(1.02);
            box-shadow: 0 0 30px rgba(255, 215, 0, 1);
            border-color: var(--primary-gold);
          }
          
          .photobooth-card.selected {
            border-color: var(--accent-gold);
            box-shadow: 0 0 40px rgba(255, 165, 0, 1);
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
            filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.8));
          }
          
          .heart-icon.selected {
            filter: drop-shadow(0 0 15px rgba(255, 215, 0, 1));
            animation: heartPulse 1.5s ease-in-out infinite;
          }
          
          @keyframes heartPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
          
          .btn-gold {
            background: var(--primary-gold);
            color: #000;
            border: 2px solid var(--chrome-silver);
            transition: all 0.3s ease;
            box-shadow: 0 0 15px rgba(255, 215, 0, 0.5);
          }
          
          .btn-gold:hover {
            background: var(--accent-gold);
            box-shadow: 0 0 25px rgba(255, 165, 0, 0.8);
            transform: translateY(-2px);
          }
          
          .photobooth-image {
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
        <!-- Professional Modal -->
        <div id="proModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);z-index:9999;justify-content:center;align-items:center;">
            <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border:2px solid #FFD700;border-radius:16px;padding:32px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(220,20,60,0.5);animation:slideUp 0.3s ease;">
                <div id="proModalIcon" style="text-align:center;font-size:64px;margin-bottom:20px;"></div>
                <h2 id="proModalTitle" style="color:white;font-size:24px;font-weight:bold;text-align:center;margin-bottom:16px;"></h2>
                <p id="proModalMsg" style="color:#C0C0C0;font-size:16px;text-align:center;line-height:1.6;margin-bottom:24px;"></p>
                <div id="proModalBtns" style="display:flex;gap:12px;justify-content:center;"></div>
            </div>
        </div>
        <style>
        @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        #proModal.show{display:flex!important}
        .pro-btn{padding:12px 32px;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:all 0.3s;text-transform:uppercase}
        .pro-btn-primary{background:linear-gradient(135deg,#DC143C,#ff1744);color:white}
        .pro-btn-primary:hover{box-shadow:0 6px 20px rgba(220,20,60,0.6);transform:translateY(-2px)}
        .pro-btn-secondary{background:linear-gradient(135deg,#555,#777);color:white}
        .pro-btn-secondary:hover{box-shadow:0 6px 20px rgba(192,192,192,0.4);transform:translateY(-2px)}
        </style>
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <img src="/static/photobooth-page-hero-3d.png" alt="SELECT YOUR PHOTOBOOTH" class="mx-auto mb-4" style="max-width: 600px; height: auto;">
                <p class="text-chrome-silver text-xl">Choose from our professional photobooths</p>
                <p class="text-gray-400 mt-2">
                    <i class="fas fa-info-circle mr-2"></i>
                    Unit 1 is automatically selected. Click ❤️ to choose Unit 2 instead.
                </p>
            </div>
            
            <!-- Photobooth Selection Info -->
            <div id="selectionInfo" class="text-center mb-8 p-4 rounded" style="background: rgba(255, 215, 0, 0.1); border: 2px solid var(--primary-gold);">
                <p class="text-lg">
                    <i class="fas fa-check-circle mr-2"></i>
                    <span id="selectedPhotoboothName">Photobooth Unit 1 (Maria Cecil)</span> will be at your event!
                </p>
            </div>
            
            <!-- Photobooth Cards -->
            <div class="grid md:grid-cols-2 gap-6 mb-8 max-w-4xl mx-auto">
                <!-- Unit 1 - Maria -->
                <div class="photobooth-card rounded-lg p-6 selected" id="card-unit1">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-3d-gold text-sm">1ST CHOICE</span>
                        <div class="heart-container" onclick="selectPhotobooth('unit1')">
                            <svg class="heart-icon selected" id="heart-unit1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD700">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="photobooth-image mb-4 text-center">
                        <img src="/static/photobooth-profile.png" alt="Maria Cecil" class="mx-auto" style="max-width: 200px; border-radius: 10px;">
                    </div>
                    
                    <h2 class="text-2xl font-bold text-center mb-2 text-3d-gold">UNIT 1</h2>
                    <p class="text-center text-chrome-silver mb-4">Operated by Maria Cecil</p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-gold);"></i>
                            Features
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• Professional Photobooth Unit</li>
                            <li>• Unlimited High-Quality Prints</li>
                            <li>• Digital Gallery Access</li>
                            <li>• Custom Backdrops Available</li>
                            <li>• Props Package Included</li>
                            <li>• On-Site Attendant</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">About Maria</h3>
                        <p class="text-sm text-gray-400">
                            Maria brings warmth and professionalism to every event, ensuring guests have a fantastic photobooth experience with lasting memories.
                        </p>
                    </div>
                </div>
                
                <!-- Unit 2 - Cora -->
                <div class="photobooth-card rounded-lg p-6" id="card-unit2">
                    <div class="flex justify-between items-start mb-4">
                        <span class="text-3d-gold text-sm">2ND CHOICE</span>
                        <div class="heart-container" onclick="selectPhotobooth('unit2')">
                            <svg class="heart-icon" id="heart-unit2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#C0C0C0" stroke-width="2">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="photobooth-image mb-4 text-center">
                        <img src="/static/photobooth-profile.png" alt="Cora Scarborough" class="mx-auto" style="max-width: 200px; border-radius: 10px;">
                    </div>
                    
                    <h2 class="text-2xl font-bold text-center mb-2 text-3d-gold">UNIT 2</h2>
                    <p class="text-center text-chrome-silver mb-4">Operated by Cora Scarborough</p>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2 flex items-center">
                            <i class="fas fa-star mr-2" style="color: var(--primary-gold);"></i>
                            Features
                        </h3>
                        <ul class="text-sm space-y-1 text-gray-300">
                            <li>• Professional Photobooth Unit</li>
                            <li>• Unlimited High-Quality Prints</li>
                            <li>• Digital Gallery Access</li>
                            <li>• Custom Backdrops Available</li>
                            <li>• Props Package Included</li>
                            <li>• Social Media Integration</li>
                        </ul>
                    </div>
                    
                    <div class="mb-4">
                        <h3 class="text-lg font-bold mb-2">About Cora</h3>
                        <p class="text-sm text-gray-400">
                            Cora's attention to detail and engaging personality make her photobooth service a highlight of any celebration.
                        </p>
                    </div>
                </div>
            </div>
            
            <!-- Action Buttons -->
            <div class="text-center space-x-4">
                <button onclick="window.location.href='/'" class="bg-gray-700 hover:bg-gray-600 px-8 py-3 rounded font-bold">
                    <i class="fas fa-arrow-left mr-2"></i> Back
                </button>
                <button onclick="continueToCalendar()" class="btn-gold px-8 py-3 rounded font-bold text-lg">
                    <i class="fas fa-calendar-alt mr-2"></i> CONTINUE TO CALENDAR
                </button>
            </div>
        </div>
        
        <script>
          let selectedPhotobooth = 'unit1'; // Default selection
          
          const photoboothData = {
            unit1: {
              name: 'Photobooth Unit 1 (Maria Cecil)',
              operator: 'Maria Cecil'
            },
            unit2: {
              name: 'Photobooth Unit 2 (Cora Scarborough)',
              operator: 'Cora Scarborough'
            }
          };
          
          function selectPhotobooth(unit) {
            selectedPhotobooth = unit;
            
            // Update all cards
            ['unit1', 'unit2'].forEach(id => {
              const card = document.getElementById('card-' + id);
              const heart = document.getElementById('heart-' + id);
              
              if (id === unit) {
                card.classList.add('selected');
                heart.classList.add('selected');
                heart.setAttribute('fill', '#FFD700');
              } else {
                card.classList.remove('selected');
                heart.classList.remove('selected');
                heart.setAttribute('fill', 'none');
              }
            });
            
            // Update selection info
            document.getElementById('selectedPhotoboothName').textContent = photoboothData[unit].name;
          }
          
          function continueToCalendar() async {
            // Store selected photobooth in localStorage
            localStorage.setItem('selectedPhotobooth', selectedPhotobooth);
            localStorage.setItem('serviceType', 'photobooth');
            
            // Check if user is logged in
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              await showAlert('Please log in to continue booking', 'Login Required');
              window.location.href = '/login';
              return;
            }
            
            // Navigate to calendar
            window.location.href = "/calendar";
          }
          
          // Professional Modal Functions
          window.showConfirm=function(msg,title='Confirm'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-question-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-secondary">Cancel</button><button class="pro-btn pro-btn-primary">Confirm</button>';b.querySelectorAll('button')[0].onclick=()=>{m.classList.remove('show');r(false)};b.querySelectorAll('button')[1].onclick=()=>{m.classList.remove('show');r(true)};m.classList.add('show')})};
          window.showAlert=function(msg,title='Notice'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-info-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          window.showSuccess=function(msg,title='Success'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-check-circle" style="color:#28A745"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          window.showError=function(msg,title='Error'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-times-circle" style="color:#DC143C"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
          
          // Check if user is logged in on page load
          window.addEventListener('DOMContentLoaded', async () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              const shouldLogin = await showConfirm('You need to be logged in to book a photobooth. Would you like to log in now?', 'Login Required');
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

// Checkout Success Page
app.get('/checkout/success', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed! - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { background: #000; color: #fff; }
          .success-container {
            max-width: 600px;
            margin: 4rem auto;
            text-align: center;
            padding: 2rem;
          }
          .success-icon {
            font-size: 5rem;
            color: #22c55e;
            animation: bounce 1s ease-in-out;
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
        </style>
    </head>
    <body>
        <div class="success-container">
            <i class="fas fa-check-circle success-icon"></i>
            <h1 class="text-4xl font-bold mt-6 mb-4" style="color: #22c55e;">
                Booking Confirmed!
            </h1>
            <p class="text-xl mb-6 text-gray-300">
                Your payment was successful and your booking is confirmed.
            </p>
            <p class="text-lg mb-8 text-gray-400">
                <i class="fas fa-envelope mr-2"></i>
                Confirmation emails have been sent to you and your provider.
            </p>
            <p class="text-lg mb-8 text-gray-400">
                <i class="fas fa-sms mr-2"></i>
                Your provider has also received an SMS notification.
            </p>
            <div class="mt-12">
                <a href="/" class="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition-all">
                    <i class="fas fa-home mr-2"></i>
                    Return to Home
                </a>
            </div>
        </div>
    </body>
    </html>
  `)
})

// Checkout Cancel Page
app.get('/checkout/cancel', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Cancelled - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { background: #000; color: #fff; }
          .cancel-container {
            max-width: 600px;
            margin: 4rem auto;
            text-align: center;
            padding: 2rem;
          }
          .cancel-icon {
            font-size: 5rem;
            color: #ef4444;
          }
        </style>
    </head>
    <body>
        <div class="cancel-container">
            <i class="fas fa-times-circle cancel-icon"></i>
            <h1 class="text-4xl font-bold mt-6 mb-4" style="color: #ef4444;">
                Booking Cancelled
            </h1>
            <p class="text-xl mb-6 text-gray-300">
                Your payment was cancelled and no charges were made.
            </p>
            <p class="text-lg mb-8 text-gray-400">
                Your booking information has been saved. You can resume the checkout process anytime.
            </p>
            <div class="mt-12 space-x-4">
                <a href="/event-details" class="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition-all">
                    <i class="fas fa-redo mr-2"></i>
                    Try Again
                </a>
                <a href="/" class="inline-block bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-8 rounded-full transition-all">
                    <i class="fas fa-home mr-2"></i>
                    Go Home
                </a>
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
            <img src="/static/register-hero-3d.png" alt="REGISTER" style="max-width: 500px; width: 100%; margin: 0 auto 1rem auto; display: block;">
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
            setTimeout(() => { window.location.href = '/'; }, 2000);
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
            <img src="/static/login-hero-3d.png" alt="SIGN IN" style="max-width: 500px; width: 100%; margin: 0 auto 1rem auto; display: block;">
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

// Contact Us Page
app.get('/contact', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Us - In The House Productions</title>
    <link href="/static/ultra-3d.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      :root {
        --primary-red: #E31E24;
        --chrome-silver: #C0C0C0;
        --accent-neon: #FF0040;
        --deep-black: #000;
      }
      body { background: #000; color: #fff; }
      .contact-card {
        background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%);
        border: 3px solid var(--chrome-silver);
        box-shadow: 0 0 30px rgba(227, 30, 36, 0.4);
      }
      .contact-item {
        background: rgba(227, 30, 36, 0.1);
        border: 2px solid var(--chrome-silver);
        transition: all 0.3s ease;
      }
      .contact-item:hover {
        border-color: var(--primary-red);
        box-shadow: 0 0 20px rgba(227, 30, 36, 0.6);
        transform: translateY(-3px);
      }
      .icon-circle {
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, var(--primary-red), var(--accent-neon));
        border: 2px solid var(--chrome-silver);
        box-shadow: 0 0 15px rgba(227, 30, 36, 0.5);
      }
    </style>
</head>
<body class="min-h-screen py-12 px-4">
    <div class="max-w-4xl mx-auto">
        <!-- Header -->
        <div class="text-center mb-12">
            <img src="/static/hero-logo-3d-v2.png" alt="IN THE HOUSE PRODUCTIONS" style="max-width: 600px; width: 100%; margin: 0 auto 2rem auto; display: block;">
            <h2 class="text-2xl text-chrome-silver mb-4">We'd Love to Hear From You!</h2>
            <p class="text-lg text-gray-400">Get in touch with us for bookings, questions, or just to say hello.</p>
        </div>

        <!-- Contact Cards -->
        <div class="grid md:grid-cols-2 gap-6 mb-12">
            <!-- Phone Contact -->
            <div class="contact-item rounded-lg p-6">
                <div class="flex items-center mb-4">
                    <div class="icon-circle rounded-full flex items-center justify-center mr-4">
                        <i class="fas fa-phone-alt text-2xl text-white"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-white">Call Us</h3>
                        <p class="text-chrome-silver text-sm">We're here to help</p>
                    </div>
                </div>
                <a href="tel:+17273594701" class="text-2xl font-bold text-primary-red hover:text-accent-neon transition-colors block">
                    (727) 359-4701
                </a>
                <p class="text-gray-400 text-sm mt-2">Available 7 days a week</p>
            </div>

            <!-- Email Contact -->
            <div class="contact-item rounded-lg p-6">
                <div class="flex items-center mb-4">
                    <div class="icon-circle rounded-full flex items-center justify-center mr-4">
                        <i class="fas fa-envelope text-2xl text-white"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-white">Email Us</h3>
                        <p class="text-chrome-silver text-sm">Quick response guaranteed</p>
                    </div>
                </div>
                <a href="mailto:mike@inthehouseproductions.com" class="text-xl font-bold text-primary-red hover:text-accent-neon transition-colors block break-all">
                    mike@inthehouseproductions.com
                </a>
                <p class="text-gray-400 text-sm mt-2">Response within 24 hours</p>
            </div>

            <!-- Location -->
            <div class="contact-item rounded-lg p-6">
                <div class="flex items-center mb-4">
                    <div class="icon-circle rounded-full flex items-center justify-center mr-4">
                        <i class="fas fa-map-marker-alt text-2xl text-white"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-white">Service Area</h3>
                        <p class="text-chrome-silver text-sm">We come to you</p>
                    </div>
                </div>
                <p class="text-lg text-white font-semibold">Tampa Bay Area</p>
                <p class="text-gray-400 text-sm mt-2">Serving all of Central Florida</p>
            </div>

            <!-- Social Media -->
            <div class="contact-item rounded-lg p-6">
                <div class="flex items-center mb-4">
                    <div class="icon-circle rounded-full flex items-center justify-center mr-4">
                        <i class="fas fa-share-alt text-2xl text-white"></i>
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-white">Follow Us</h3>
                        <p class="text-chrome-silver text-sm">Stay connected</p>
                    </div>
                </div>
                <div class="flex gap-4 mt-4">
                    <a href="#" class="text-3xl text-chrome-silver hover:text-primary-red transition-colors">
                        <i class="fab fa-facebook"></i>
                    </a>
                    <a href="#" class="text-3xl text-chrome-silver hover:text-primary-red transition-colors">
                        <i class="fab fa-instagram"></i>
                    </a>
                    <a href="#" class="text-3xl text-chrome-silver hover:text-primary-red transition-colors">
                        <i class="fab fa-twitter"></i>
                    </a>
                </div>
            </div>
        </div>

        <!-- CTA Section -->
        <div class="contact-card rounded-lg p-8 text-center">
            <h2 class="text-3xl font-bold text-white mb-4">Ready to Book Your Event?</h2>
            <p class="text-lg text-chrome-silver mb-6">Let's make your event unforgettable!</p>
            <div class="flex flex-wrap justify-center gap-4">
                <a href="/dj-services" class="bg-gradient-to-r from-red-600 to-red-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-red-500/50 transition-all">
                    <i class="fas fa-music mr-2"></i>Book a DJ
                </a>
                <a href="/photobooth" class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-yellow-500/50 transition-all">
                    <i class="fas fa-camera mr-2"></i>Book Photobooth
                </a>
            </div>
        </div>

        <!-- Back to Home -->
        <div class="text-center mt-8">
            <a href="/" class="text-chrome-silver hover:text-white transition-colors text-lg">
                <i class="fas fa-arrow-left mr-2"></i>Back to Home
            </a>
        </div>
    </div>
</body>
</html>`)
})

// About Us Page
app.get('/about', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About Us - In The House Productions</title>
    <link href="/static/ultra-3d.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      :root {
        --primary-red: #E31E24;
        --chrome-silver: #C0C0C0;
        --accent-neon: #FF0040;
        --primary-gold: #FFD700;
      }
      body { background: #000; color: #fff; }
      .about-card {
        background: linear-gradient(135deg, #0A0A0A 0%, #000000 100%);
        border: 3px solid var(--chrome-silver);
        box-shadow: 0 0 30px rgba(227, 30, 36, 0.4);
      }
      .stat-box {
        background: rgba(227, 30, 36, 0.1);
        border: 2px solid var(--chrome-silver);
      }
      .service-icon {
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, var(--primary-red), var(--accent-neon));
        border: 3px solid var(--chrome-silver);
        box-shadow: 0 0 20px rgba(227, 30, 36, 0.6);
      }
    </style>
</head>
<body class="min-h-screen py-12 px-4">
    <div class="max-w-6xl mx-auto">
        <!-- Header -->
        <div class="text-center mb-12">
            <img src="/static/hero-logo-3d-v2.png" alt="IN THE HOUSE PRODUCTIONS" style="max-width: 700px; width: 100%; margin: 0 auto 2rem auto; display: block;">
            <h2 class="text-3xl font-bold text-primary-red mb-4">Your Premier Mobile DJ & Photobooth Service</h2>
            <p class="text-xl text-chrome-silver max-w-3xl mx-auto">
                Making memories and moving dance floors since day one. We bring the energy, professionalism, and experience to make your event unforgettable.
            </p>
        </div>

        <!-- Stats Section -->
        <div class="grid md:grid-cols-4 gap-6 mb-12">
            <div class="stat-box rounded-lg p-6 text-center">
                <div class="text-4xl font-bold text-primary-red mb-2">40+</div>
                <div class="text-chrome-silver">Years Combined Experience</div>
            </div>
            <div class="stat-box rounded-lg p-6 text-center">
                <div class="text-4xl font-bold text-primary-red mb-2">1000+</div>
                <div class="text-chrome-silver">Events Completed</div>
            </div>
            <div class="stat-box rounded-lg p-6 text-center">
                <div class="text-4xl font-bold text-primary-red mb-2">3</div>
                <div class="text-chrome-silver">Professional DJs</div>
            </div>
            <div class="stat-box rounded-lg p-6 text-center">
                <div class="text-4xl font-bold text-primary-red mb-2">2</div>
                <div class="text-chrome-silver">Photobooth Units</div>
            </div>
        </div>

        <!-- Our Story -->
        <div class="about-card rounded-lg p-8 mb-12">
            <h2 class="text-3xl font-bold text-white mb-6 text-center">
                <i class="fas fa-heart text-primary-red mr-2"></i>Our Story
            </h2>
            <div class="text-lg text-gray-300 space-y-4 max-w-4xl mx-auto">
                <p>
                    <strong class="text-white">In The House Productions</strong> was born from a passion for music, celebration, and creating unforgettable moments. With over 40 years of combined experience, our team of professional DJs and event specialists has mastered the art of reading the crowd and keeping the energy high.
                </p>
                <p>
                    Whether it's a wedding, corporate event, birthday party, or any special celebration, we bring the perfect blend of professionalism, personality, and technical expertise to every event. Our state-of-the-art equipment, extensive music library spanning all genres and eras, and commitment to excellence ensure your event is nothing short of spectacular.
                </p>
                <p>
                    From Tampa Bay to Central Florida, we've built our reputation on reliability, versatility, and the ability to turn any event into an experience your guests will talk about for years to come.
                </p>
            </div>
        </div>

        <!-- What We Offer -->
        <div class="about-card rounded-lg p-8 mb-12">
            <h2 class="text-3xl font-bold text-white mb-8 text-center">
                <i class="fas fa-star text-primary-gold mr-2"></i>What We Offer
            </h2>
            <div class="grid md:grid-cols-2 gap-8">
                <!-- DJ Services -->
                <div class="text-center">
                    <div class="service-icon rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fas fa-headphones text-4xl text-white"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-white mb-3">Professional DJ Services</h3>
                    <ul class="text-left text-gray-300 space-y-2">
                        <li><i class="fas fa-check text-primary-red mr-2"></i>3 Experienced DJs to choose from</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Weddings, Corporate Events, Parties</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>All music genres: Top 40, Hip-Hop, R&B, EDM, Rock</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Professional sound and lighting equipment</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>MC services and event coordination</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Custom playlist creation</li>
                    </ul>
                </div>

                <!-- Photobooth Services -->
                <div class="text-center">
                    <div class="service-icon rounded-full flex items-center justify-center mx-auto mb-4" style="background: linear-gradient(135deg, var(--primary-gold), #FFA500);">
                        <i class="fas fa-camera text-4xl text-white"></i>
                    </div>
                    <h3 class="text-2xl font-bold text-white mb-3">Premium Photobooth Rentals</h3>
                    <ul class="text-left text-gray-300 space-y-2">
                        <li><i class="fas fa-check text-primary-gold mr-2"></i>2 Professional photobooth units available</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Unlimited prints for your guests</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Custom backdrops and props</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Digital gallery of all photos</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>On-site attendant included</li>
                        <li><i class="fas fa-check text-primary-red mr-2"></i>Perfect for any event size</li>
                    </ul>
                </div>
            </div>
        </div>

        <!-- Why Choose Us -->
        <div class="about-card rounded-lg p-8 mb-12">
            <h2 class="text-3xl font-bold text-white mb-6 text-center">
                <i class="fas fa-trophy text-primary-gold mr-2"></i>Why Choose Us?
            </h2>
            <div class="grid md:grid-cols-3 gap-6">
                <div class="text-center">
                    <i class="fas fa-user-check text-5xl text-primary-red mb-4"></i>
                    <h3 class="text-xl font-bold text-white mb-2">Professional & Reliable</h3>
                    <p class="text-gray-300">Licensed, insured, and always on time. Your event is in good hands.</p>
                </div>
                <div class="text-center">
                    <i class="fas fa-music text-5xl text-primary-red mb-4"></i>
                    <h3 class="text-xl font-bold text-white mb-2">Extensive Music Library</h3>
                    <p class="text-gray-300">From classic hits to today's top tracks, we've got every genre covered.</p>
                </div>
                <div class="text-center">
                    <i class="fas fa-smile text-5xl text-primary-red mb-4"></i>
                    <h3 class="text-xl font-bold text-white mb-2">Crowd Reading Experts</h3>
                    <p class="text-gray-300">We know how to read the room and keep the energy perfect all night.</p>
                </div>
            </div>
        </div>

        <!-- CTA Section -->
        <div class="text-center">
            <h2 class="text-3xl font-bold text-white mb-6">Ready to Make Your Event Unforgettable?</h2>
            <div class="flex flex-wrap justify-center gap-4 mb-8">
                <a href="/dj-services" class="bg-gradient-to-r from-red-600 to-red-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-red-500/50 transition-all">
                    <i class="fas fa-music mr-2"></i>Book a DJ
                </a>
                <a href="/photobooth" class="bg-gradient-to-r from-yellow-600 to-yellow-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-yellow-500/50 transition-all">
                    <i class="fas fa-camera mr-2"></i>Book Photobooth
                </a>
                <a href="/contact" class="bg-gradient-to-r from-gray-700 to-gray-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:shadow-lg hover:shadow-gray-500/50 transition-all">
                    <i class="fas fa-phone mr-2"></i>Contact Us
                </a>
            </div>
            <a href="/" class="text-chrome-silver hover:text-white transition-colors text-lg">
                <i class="fas fa-arrow-left mr-2"></i>Back to Home
            </a>
        </div>
    </div>
</body>
</html>`)
})

// ================================
// ADMIN DASHBOARD ROUTES
// ================================

// Admin API: Get all bookings with details
app.get('/api/admin/bookings', async (c) => {
  try {
    const { env } = c
    const { DB } = env

    // Get all bookings with client and provider info
    const result = await DB.prepare(`
      SELECT 
        b.id,
        b.event_date,
        b.event_start_time as start_time,
        b.event_end_time as end_time,
        b.service_type,
        b.service_provider,
        b.total_price,
        b.status,
        b.created_at,
        u.full_name as client_name,
        u.email as client_email,
        u.phone as client_phone,
        e.event_name,
        e.event_type,
        e.street_address,
        e.city,
        e.state,
        e.zip_code,
        e.number_of_guests,
        e.special_requests
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN event_details e ON b.id = e.booking_id
      ORDER BY b.created_at DESC
    `).all()

    return c.json({ success: true, bookings: result.results })
  } catch (error) {
    console.error('Admin bookings error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Admin API: Get system stats
app.get('/api/admin/stats', async (c) => {
  try {
    const { env } = c
    const { DB } = env

    // Get counts
    const totalBookings = await DB.prepare('SELECT COUNT(*) as count FROM bookings').first()
    const totalUsers = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
    const totalProviders = await DB.prepare('SELECT COUNT(*) as count FROM provider_contacts').first()
    
    // Get revenue
    const revenue = await DB.prepare('SELECT SUM(total_price) as total FROM bookings WHERE status = "confirmed"').first()
    
    // Get recent bookings
    const recentBookings = await DB.prepare('SELECT COUNT(*) as count FROM bookings WHERE created_at >= datetime("now", "-7 days")').first()

    return c.json({
      success: true,
      stats: {
        totalBookings: totalBookings.count || 0,
        totalUsers: totalUsers.count || 0,
        totalProviders: totalProviders.count || 0,
        totalRevenue: revenue.total || 0,
        recentBookings: recentBookings.count || 0
      }
    })
  } catch (error) {
    console.error('Admin stats error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Admin API: Update booking status
app.post('/api/admin/bookings/:id/status', async (c) => {
  try {
    const { env } = c
    const { DB } = env
    const bookingId = c.req.param('id')
    const { status } = await c.req.json()

    // Valid statuses: pending, confirmed, completed, cancelled
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled']
    if (!validStatuses.includes(status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400)
    }

    await DB.prepare('UPDATE bookings SET status = ? WHERE id = ?')
      .bind(status, bookingId)
      .run()

    return c.json({ success: true, message: 'Booking status updated' })
  } catch (error) {
    console.error('Update status error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Admin API: Get all providers
app.get('/api/admin/providers', async (c) => {
  try {
    const { env } = c
    const { DB } = env

    const result = await DB.prepare('SELECT * FROM provider_contacts ORDER BY provider_name').all()

    return c.json({ success: true, providers: result.results })
  } catch (error) {
    console.error('Admin providers error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Admin Dashboard Page
app.get('/admin', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - In The House Productions</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary-red: #DC143C;
            --primary-gold: #FFD700;
            --chrome-silver: #C0C0C0;
            --deep-black: #000000;
        }
        
        body {
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            font-family: 'Arial', sans-serif;
            min-height: 100vh;
        }
        
        .admin-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        
        .stat-card {
            background: linear-gradient(135deg, rgba(220, 20, 60, 0.2) 0%, rgba(255, 215, 0, 0.2) 100%);
            border: 2px solid var(--chrome-silver);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 40px rgba(220, 20, 60, 0.4);
        }
        
        .booking-table {
            width: 100%;
            overflow-x: auto;
        }
        
        .booking-table table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .booking-table th {
            background: rgba(220, 20, 60, 0.3);
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
        }
        
        .booking-table td {
            padding: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
        }
        
        .booking-table tr:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .status-pending { background: #FFA500; color: white; }
        .status-confirmed { background: #28A745; color: white; }
        .status-completed { background: #007BFF; color: white; }
        .status-cancelled { background: #DC3545; color: white; }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary-red) 0%, #ff1744 100%);
            color: white;
            padding: 10px 24px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
        }
        
        .btn-primary:hover {
            box-shadow: 0 6px 20px rgba(220, 20, 60, 0.5);
            transform: translateY(-2px);
        }
        
        .loading {
            display: inline-block;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container mx-auto px-4 py-8">
        <!-- Header -->
        <div class="admin-card rounded-lg p-6 mb-8">
            <div class="flex justify-between items-center">
                <div>
                    <h1 class="text-4xl font-bold text-white mb-2">
                        <i class="fas fa-tachometer-alt text-primary-red mr-3"></i>
                        Admin Dashboard
                    </h1>
                    <p class="text-gray-300">In The House Productions - Management Console</p>
                </div>
                <div>
                    <a href="/" class="btn-primary">
                        <i class="fas fa-home mr-2"></i>Back to Home
                    </a>
                </div>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="grid md:grid-cols-5 gap-6 mb-8">
            <div class="stat-card rounded-lg p-6 text-center">
                <i class="fas fa-calendar-check text-5xl text-primary-gold mb-3"></i>
                <h3 class="text-3xl font-bold text-white mb-1" id="totalBookings">
                    <i class="fas fa-spinner loading"></i>
                </h3>
                <p class="text-gray-300 text-sm">Total Bookings</p>
            </div>
            
            <div class="stat-card rounded-lg p-6 text-center">
                <i class="fas fa-users text-5xl text-primary-gold mb-3"></i>
                <h3 class="text-3xl font-bold text-white mb-1" id="totalUsers">
                    <i class="fas fa-spinner loading"></i>
                </h3>
                <p class="text-gray-300 text-sm">Total Clients</p>
            </div>
            
            <div class="stat-card rounded-lg p-6 text-center">
                <i class="fas fa-user-tie text-5xl text-primary-gold mb-3"></i>
                <h3 class="text-3xl font-bold text-white mb-1" id="totalProviders">
                    <i class="fas fa-spinner loading"></i>
                </h3>
                <p class="text-gray-300 text-sm">Providers</p>
            </div>
            
            <div class="stat-card rounded-lg p-6 text-center">
                <i class="fas fa-dollar-sign text-5xl text-primary-gold mb-3"></i>
                <h3 class="text-3xl font-bold text-white mb-1" id="totalRevenue">
                    <i class="fas fa-spinner loading"></i>
                </h3>
                <p class="text-gray-300 text-sm">Total Revenue</p>
            </div>
            
            <div class="stat-card rounded-lg p-6 text-center">
                <i class="fas fa-clock text-5xl text-primary-gold mb-3"></i>
                <h3 class="text-3xl font-bold text-white mb-1" id="recentBookings">
                    <i class="fas fa-spinner loading"></i>
                </h3>
                <p class="text-gray-300 text-sm">Last 7 Days</p>
            </div>
        </div>

        <!-- Bookings Table -->
        <div class="admin-card rounded-lg p-6 mb-8">
            <h2 class="text-2xl font-bold text-white mb-6">
                <i class="fas fa-list text-primary-red mr-2"></i>All Bookings
            </h2>
            
            <div id="bookingsLoading" class="text-center text-white py-12">
                <i class="fas fa-spinner loading text-5xl text-primary-gold mb-4"></i>
                <p class="text-xl">Loading bookings...</p>
            </div>
            
            <div id="bookingsTable" class="booking-table hidden">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Date</th>
                            <th>Client</th>
                            <th>Provider</th>
                            <th>Event Type</th>
                            <th>Venue</th>
                            <th>Price</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="bookingsBody">
                        <!-- Dynamic content -->
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Providers Section -->
        <div class="admin-card rounded-lg p-6">
            <h2 class="text-2xl font-bold text-white mb-6">
                <i class="fas fa-user-friends text-primary-red mr-2"></i>Providers
            </h2>
            
            <div id="providersLoading" class="text-center text-white py-8">
                <i class="fas fa-spinner loading text-4xl text-primary-gold mb-3"></i>
                <p>Loading providers...</p>
            </div>
            
            <div id="providersGrid" class="grid md:grid-cols-3 gap-4 hidden">
                <!-- Dynamic content -->
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script>
        // Load stats
        async function loadStats() {
            try {
                const response = await axios.get('/api/admin/stats')
                if (response.data.success) {
                    const stats = response.data.stats
                    document.getElementById('totalBookings').textContent = stats.totalBookings
                    document.getElementById('totalUsers').textContent = stats.totalUsers
                    document.getElementById('totalProviders').textContent = stats.totalProviders
                    document.getElementById('totalRevenue').textContent = '$' + stats.totalRevenue.toFixed(2)
                    document.getElementById('recentBookings').textContent = stats.recentBookings
                }
            } catch (error) {
                console.error('Failed to load stats:', error)
            }
        }

        // Load bookings
        async function loadBookings() {
            try {
                const response = await axios.get('/api/admin/bookings')
                if (response.data.success) {
                    const bookings = response.data.bookings
                    const tbody = document.getElementById('bookingsBody')
                    
                    if (bookings.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400">No bookings yet</td></tr>'
                    } else {
                        tbody.innerHTML = bookings.map(booking => \`
                            <tr>
                                <td>#\${booking.id}</td>
                                <td>\${new Date(booking.event_date).toLocaleDateString()}<br>
                                    <small class="text-gray-400">\${booking.start_time} - \${booking.end_time}</small>
                                </td>
                                <td>
                                    \${booking.client_name}<br>
                                    <small class="text-gray-400">\${booking.client_phone}</small>
                                </td>
                                <td>\${booking.service_provider}</td>
                                <td>\${booking.event_type || 'N/A'}</td>
                                <td>\${booking.city}, \${booking.state}</td>
                                <td class="font-bold text-primary-gold">$\${booking.total_price || '0.00'}</td>
                                <td>
                                    <span class="status-badge status-\${booking.status}">\${booking.status}</span>
                                </td>
                                <td>
                                    <select onchange="updateStatus(\${booking.id}, this.value)" class="bg-gray-700 text-white px-2 py-1 rounded text-sm">
                                        <option value="">Change Status</option>
                                        <option value="pending">Pending</option>
                                        <option value="confirmed">Confirmed</option>
                                        <option value="completed">Completed</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                </td>
                            </tr>
                        \`).join('')
                    }
                    
                    document.getElementById('bookingsLoading').classList.add('hidden')
                    document.getElementById('bookingsTable').classList.remove('hidden')
                }
            } catch (error) {
                console.error('Failed to load bookings:', error)
                document.getElementById('bookingsLoading').innerHTML = '<p class="text-red-500">Failed to load bookings</p>'
            }
        }

        // Load providers
        async function loadProviders() {
            try {
                const response = await axios.get('/api/admin/providers')
                if (response.data.success) {
                    const providers = response.data.providers
                    const grid = document.getElementById('providersGrid')
                    
                    grid.innerHTML = providers.map(provider => \`
                        <div class="bg-gray-800 rounded-lg p-4">
                            <h3 class="text-xl font-bold text-white mb-2">\${provider.provider_name}</h3>
                            <p class="text-gray-300 text-sm mb-2">ID: \${provider.provider_id}</p>
                            <p class="text-gray-400 text-xs">
                                <i class="fas fa-envelope mr-1"></i>\${provider.email}<br>
                                <i class="fas fa-phone mr-1"></i>\${provider.phone}<br>
                                <i class="fas fa-bell mr-1"></i>\${provider.notification_preferences}
                            </p>
                        </div>
                    \`).join('')
                    
                    document.getElementById('providersLoading').classList.add('hidden')
                    document.getElementById('providersGrid').classList.remove('hidden')
                }
            } catch (error) {
                console.error('Failed to load providers:', error)
            }
        }

        // Update booking status
        async function updateStatus(bookingId, newStatus) {
            if (!newStatus) return
            
            try {
                const response = await axios.post(\`/api/admin/bookings/\${bookingId}/status\`, {
                    status: newStatus
                })
                
                if (response.data.success) {
                    await showSuccess('Booking status updated successfully!', 'Success')
                    loadBookings() // Reload to show updated status
                } else {
                    await showError('Failed to update status: ' + response.data.error, 'Update Failed')
                }
            } catch (error) {
                console.error('Failed to update status:', error)
                await showError('Error updating status', 'Update Failed')
            }
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            loadStats()
            loadBookings()
            loadProviders()
        })
    </script>
</body>
</html>
  `)
})

export default app
