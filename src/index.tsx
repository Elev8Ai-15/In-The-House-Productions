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
  JWT_SECRET?: string
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
                alert('JSON exported! Check your downloads folder for dj_profiles.json');
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
    const { items } = await c.req.json()
    
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
    
    // In production, you would use actual Stripe API here
    // For now, return a mock session
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    
    if (!STRIPE_SECRET_KEY) {
      return c.json({
        error: 'Stripe not configured',
        message: 'Please add STRIPE_SECRET_KEY to environment variables',
        total,
        items: lineItems
      }, 500)
    }
    
    // Initialize Stripe (commented out until key is added)
    // const Stripe = require('stripe')
    // const stripe = new Stripe(STRIPE_SECRET_KEY)
    // 
    // const session = await stripe.checkout.sessions.create({
    //   payment_method_types: ['card'],
    //   line_items: lineItems,
    //   mode: 'payment',
    //   success_url: `${c.req.url.split('/api')[0]}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    //   cancel_url: `${c.req.url.split('/api')[0]}/checkout/cancel`
    // })
    // 
    // return c.json({ sessionId: session.id, url: session.url })
    
    // Temporary response until Stripe is configured
    return c.json({
      message: 'Stripe backend ready',
      total,
      items: lineItems,
      note: 'Add STRIPE_SECRET_KEY to .dev.vars to enable checkout'
    })
    
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to create checkout session' }, 500)
  }
})

// Webhook to handle Stripe events
app.post('/api/webhook/stripe', async (c) => {
  try {
    const signature = c.req.header('stripe-signature')
    const body = await c.req.text()
    
    // Verify webhook signature and process event
    // This would use Stripe's webhook verification
    
    return c.json({ received: true })
  } catch (error) {
    return c.json({ error: 'Webhook error' }, 400)
  }
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
                            <img src="/static/dj-services-logo-3d.png" alt="DJ SERVICES" class="mx-auto" style="max-width: 300px; height: auto;">
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
                            <img src="/static/photobooth-logo-3d.png" alt="PHOTOBOOTH" class="mx-auto" style="max-width: 300px; height: auto;">
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
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="text-3d-logo-12k text-3d-huge mb-2">🎧 SELECT YOUR DJ</h1>
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
            window.location.href = "/calendar";
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
            <h1 class="text-3d-ultra text-3d-huge mb-4 text-uppercase">SELECT YOUR DATE</h1>
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
          
          // Check authentication and load DJ selection
          window.addEventListener('DOMContentLoaded', async () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              alert('Please log in to continue booking.');
              window.location.href = '/login';
              return;
            }
            
            // Get selected DJ from localStorage
            selectedDJ = localStorage.getItem('selectedDJ');
            if (!selectedDJ) {
              alert('Please select a DJ first.');
              window.location.href = '/dj-services';
              return;
            }
            
            // Display selected DJ
            const djNames = {
              'dj_cease': 'DJ Cease',
              'dj_elev8': 'DJ Elev8',
              'tko_the_dj': 'TKOtheDJ'
            };
            document.getElementById('selectedDJDisplay').textContent = 
              'Booking for: ' + djNames[selectedDJ];
            
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
                  // Loading or unknown
                  dayElement.classList.add('loading');
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
              alert('Please select a date first.');
              return;
            }
            
            // Store all booking data
            localStorage.setItem('bookingData', JSON.stringify({
              dj: selectedDJ,
              date: selectedDate
            }));
            
            // Navigate to event details form
            window.location.href = '/event-details';
          }
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
            <h1 class="text-3d-ultra text-3d-huge mb-2 text-uppercase">REGISTER</h1>
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
            <h1 class="text-3d-ultra text-3d-huge mb-2 text-uppercase">SIGN IN</h1>
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
