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
import { getJWTSecret } from './auth-middleware'
import {
  generateMetaTags,
  generateOrganizationSchema,
  generateServiceSchema,
  generateBreadcrumbSchema,
  generateLocalBusinessSchema,
  generateSitemap,
  generateRobotsTxt
} from './seo-helpers'
import {
  securityHeaders,
  rateLimit,
  validateAndSanitize
} from './security-middleware'
import {
  generateSkipLinks,
  generateAriaLiveRegion,
  generateFocusStyles,
  generateAccessibilityJS
} from './accessibility-helpers'

type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  STRIPE_SECRET_KEY?: string
  RESEND_API_KEY?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_PHONE_NUMBER?: string
}

// JWT Secret is now imported from auth-middleware.ts

const app = new Hono<{ Bindings: Bindings }>()

// Apply security headers to all routes (Zero-Trust Security)
app.use('*', securityHeaders)

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// Add rate limiting to authentication endpoints
app.use('/api/auth/login', rateLimit(5, 60000, 15)) // 5 requests per minute, lockout after 15 failures
app.use('/api/auth/register', rateLimit(3, 60000)) // 3 registrations per minute

// Add rate limiting to API endpoints
app.use('/api/*', rateLimit(100, 60000)) // 100 requests per minute for general API

// SEO Routes
app.get('/robots.txt', (c) => {
  return c.text(generateRobotsTxt())
})

app.get('/sitemap.xml', (c) => {
  c.header('Content-Type', 'application/xml')
  return c.text(generateSitemap())
})

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
    const secret = getJWTSecret(c.env)
    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role
    }, secret)
    
    console.log('[LOGIN] Token created for user:', user.id)
    
    // Set HTTP-only cookie (works even if localStorage is blocked)
    c.header('Set-Cookie', `authToken=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`)
    
    return c.json({
      success: true,
      message: 'Login successful',
      token, // Still return for localStorage (if it works)
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

// ===== ADMIN SETUP (One-time initialization) =====

// Reset admin password - for fixing bcrypt/PBKDF2 mismatch
app.post('/api/setup/reset-admin', async (c) => {
  const { DB } = c.env
  
  try {
    const body = await c.req.json()
    const { email, new_password, setup_key } = body
    
    // Require setup key for security
    const SETUP_KEY = 'InTheHouse2026!'
    if (setup_key !== SETUP_KEY) {
      return c.json({ error: 'Invalid setup key' }, 403)
    }
    
    if (!email || !new_password) {
      return c.json({ error: 'Email and new_password are required' }, 400)
    }
    
    // Validate password
    const passwordValidation = isValidPassword(new_password)
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.message }, 400)
    }
    
    const cleanEmail = email.toLowerCase().trim()
    
    // Find admin user
    const adminUser: any = await DB.prepare(`
      SELECT id, full_name, email, role FROM users WHERE email = ? AND role = 'admin'
    `).bind(cleanEmail).first()
    
    if (!adminUser) {
      return c.json({ error: 'Admin user not found with this email' }, 404)
    }
    
    // Hash new password using PBKDF2
    const passwordHash = await hashPassword(new_password)
    
    // Update password
    await DB.prepare(`
      UPDATE users SET password_hash = ? WHERE id = ?
    `).bind(passwordHash, adminUser.id).run()
    
    // Create JWT token
    const token = await createToken({
      userId: adminUser.id,
      email: cleanEmail,
      role: 'admin'
    }, getJWTSecret(c.env))
    
    return c.json({
      success: true,
      message: 'Admin password reset successfully',
      token,
      user: {
        id: adminUser.id,
        full_name: adminUser.full_name,
        email: adminUser.email,
        role: 'admin'
      }
    })
    
  } catch (error: any) {
    console.error('Admin password reset error:', error)
    return c.json({ error: 'Password reset failed', details: error.message }, 500)
  }
})

// Create admin user - only works if no admin exists
app.post('/api/setup/admin', async (c) => {
  const { DB } = c.env
  
  try {
    // Check if admin already exists
    const existingAdmin: any = await DB.prepare(`
      SELECT id FROM users WHERE role = 'admin'
    `).first()
    
    if (existingAdmin) {
      return c.json({ error: 'Admin user already exists. Use /login to sign in.' }, 409)
    }
    
    const body = await c.req.json()
    const { full_name, email, phone, password, setup_key } = body
    
    // Require setup key for security (can be changed or removed in production)
    const SETUP_KEY = 'InTheHouse2026!'
    if (setup_key !== SETUP_KEY) {
      return c.json({ error: 'Invalid setup key' }, 403)
    }
    
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
    
    // Hash password using PBKDF2 (same as regular registration)
    const passwordHash = await hashPassword(password)
    
    // Insert admin user
    const result = await DB.prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).bind(cleanName, cleanEmail, cleanPhone, passwordHash).run()
    
    // Create JWT token
    const token = await createToken({
      userId: result.meta.last_row_id,
      email: cleanEmail,
      role: 'admin'
    }, getJWTSecret(c.env))
    
    return c.json({
      success: true,
      message: 'Admin user created successfully',
      token,
      user: {
        id: result.meta.last_row_id,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        role: 'admin'
      }
    }, 201)
    
  } catch (error: any) {
    console.error('Admin setup error:', error)
    return c.json({ error: 'Admin setup failed', details: error.message }, 500)
  }
})

// ===== EMPLOYEE AUTHENTICATION & MANAGEMENT =====

// Employee Login
app.post('/api/employee/login', async (c) => {
  const { DB } = c.env
  
  try {
    const body = await c.req.json()
    const { email, password } = body
    
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }
    
    const cleanEmail = email.toLowerCase().trim()
    
    // Find employee
    const employee: any = await DB.prepare(`
      SELECT id, full_name, email, phone, password_hash, provider_id, service_type, is_active
      FROM employees
      WHERE email = ? AND is_active = 1
    `).bind(cleanEmail).first()
    
    if (!employee) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    
    // Verify password
    const isValid = await verifyPassword(password, employee.password_hash)
    
    if (!isValid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    
    // Create JWT token
    const token = await createToken({
      employeeId: employee.id,
      email: employee.email,
      providerId: employee.provider_id,
      role: 'employee'
    }, getJWTSecret(c.env))
    
    // Log employee login
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    await DB.prepare(`
      INSERT INTO change_logs (employee_id, action_type, ip_address)
      VALUES (?, 'login', ?)
    `).bind(employee.id, clientIp).run()
    
    return c.json({
      success: true,
      message: 'Login successful',
      token,
      employee: {
        id: employee.id,
        full_name: employee.full_name,
        email: employee.email,
        phone: employee.phone,
        provider_id: employee.provider_id,
        service_type: employee.service_type,
        role: 'employee'
      }
    })
    
  } catch (error: any) {
    console.error('Employee login error:', error)
    return c.json({ error: 'Login failed', details: error.message }, 500)
  }
})

// Employee Logout (log action)
app.post('/api/employee/logout', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    // Log logout
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    await DB.prepare(`
      INSERT INTO change_logs (employee_id, action_type, ip_address)
      VALUES (?, 'logout', ?)
    `).bind(payload.employeeId, clientIp).run()
    
    return c.json({ success: true, message: 'Logged out successfully' })
    
  } catch (error: any) {
    return c.json({ error: 'Logout failed' }, 500)
  }
})

// Get Employee Info
app.get('/api/employee/me', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    // Get employee data
    const employee: any = await DB.prepare(`
      SELECT id, full_name, email, phone, provider_id, service_type, created_at
      FROM employees
      WHERE id = ? AND is_active = 1
    `).bind(payload.employeeId).first()
    
    if (!employee) {
      return c.json({ error: 'Employee not found' }, 404)
    }
    
    return c.json({
      success: true,
      employee: {
        id: employee.id,
        full_name: employee.full_name,
        email: employee.email,
        phone: employee.phone,
        provider_id: employee.provider_id,
        service_type: employee.service_type,
        role: 'employee'
      }
    })
    
  } catch (error: any) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})

// Get Employee's Blocked Dates
app.get('/api/employee/blocked-dates', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId || !payload.providerId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    // Get blocked dates for this provider
    const blockedDates = await DB.prepare(`
      SELECT id, service_provider, block_date, reason, created_at
      FROM availability_blocks
      WHERE service_provider = ?
      ORDER BY block_date DESC
    `).bind(payload.providerId).all()
    
    return c.json({
      success: true,
      blocked_dates: blockedDates.results
    })
    
  } catch (error: any) {
    console.error('Get blocked dates error:', error)
    return c.json({ error: 'Failed to fetch blocked dates' }, 500)
  }
})

// Block a Date
app.post('/api/employee/block-date', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId || !payload.providerId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    const body = await c.req.json()
    const { date, reason } = body
    
    if (!date) {
      return c.json({ error: 'Date is required' }, 400)
    }
    
    // Check if date is already blocked
    const existing = await DB.prepare(`
      SELECT id FROM availability_blocks
      WHERE service_provider = ? AND block_date = ?
    `).bind(payload.providerId, date).first()
    
    if (existing) {
      return c.json({ error: 'Date is already blocked' }, 400)
    }
    
    // Block the date
    const result = await DB.prepare(`
      INSERT INTO availability_blocks (service_provider, block_date, reason, employee_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(payload.providerId, date, reason || 'Blocked by employee', payload.employeeId, payload.employeeId).run()
    
    // Log the change
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    await DB.prepare(`
      INSERT INTO change_logs (employee_id, action_type, target_date, new_value, reason, ip_address)
      VALUES (?, 'block_date', ?, 'blocked', ?, ?)
    `).bind(payload.employeeId, date, reason || 'Blocked by employee', clientIp).run()
    
    return c.json({
      success: true,
      message: 'Date blocked successfully',
      block_id: result.meta.last_row_id
    })
    
  } catch (error: any) {
    console.error('Block date error:', error)
    return c.json({ error: 'Failed to block date', details: error.message }, 500)
  }
})

// Unblock a Date
app.delete('/api/employee/unblock-date/:blockId', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId || !payload.providerId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    const blockId = c.req.param('blockId')
    
    // Get block details before deleting (for logging)
    const block: any = await DB.prepare(`
      SELECT block_date, reason FROM availability_blocks
      WHERE id = ? AND service_provider = ?
    `).bind(blockId, payload.providerId).first()
    
    if (!block) {
      return c.json({ error: 'Block not found or unauthorized' }, 404)
    }
    
    // Delete the block
    await DB.prepare(`
      DELETE FROM availability_blocks
      WHERE id = ? AND service_provider = ?
    `).bind(blockId, payload.providerId).run()
    
    // Log the change
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    await DB.prepare(`
      INSERT INTO change_logs (employee_id, action_type, target_date, old_value, reason, ip_address)
      VALUES (?, 'unblock_date', ?, 'blocked', ?, ?)
    `).bind(payload.employeeId, block.block_date, block.reason || 'Unblocked by employee', clientIp).run()
    
    return c.json({
      success: true,
      message: 'Date unblocked successfully'
    })
    
  } catch (error: any) {
    console.error('Unblock date error:', error)
    return c.json({ error: 'Failed to unblock date' }, 500)
  }
})

// Get Employee's Bookings (Read-only)
app.get('/api/employee/bookings', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId || !payload.providerId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    // Get bookings for this provider
    const bookings = await DB.prepare(`
      SELECT 
        b.id,
        b.event_date,
        b.event_start_time,
        b.event_end_time,
        b.status,
        ed.event_name,
        ed.event_type,
        ed.street_address,
        ed.city,
        ed.state
      FROM bookings b
      LEFT JOIN event_details ed ON b.id = ed.booking_id
      WHERE b.service_provider = ?
      ORDER BY b.event_date ASC
    `).bind(payload.providerId).all()
    
    return c.json({
      success: true,
      bookings: bookings.results
    })
    
  } catch (error: any) {
    console.error('Get bookings error:', error)
    return c.json({ error: 'Failed to fetch bookings' }, 500)
  }
})

// Get Employee's Change Log (Audit Trail)
app.get('/api/employee/change-log', async (c) => {
  const { DB } = c.env
  
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (!payload.employeeId) {
      return c.json({ error: 'Invalid employee token' }, 401)
    }
    
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')
    
    // Get change logs for this employee
    const logs = await DB.prepare(`
      SELECT 
        id,
        action_type,
        target_date,
        old_value,
        new_value,
        reason,
        ip_address,
        created_at
      FROM change_logs
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(payload.employeeId, limit, offset).all()
    
    return c.json({
      success: true,
      logs: logs.results,
      limit,
      offset
    })
    
  } catch (error: any) {
    console.error('Get change log error:', error)
    return c.json({ error: 'Failed to fetch change log' }, 500)
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
  // DJ Services
  dj: {
    name: 'DJ Service',
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
  
  // Individual DJ pricing (use party rates by default)
  dj_cease: {
    name: 'DJ Cease (Mike Cecil)',
    basePrice: 500,        // Parties up to 4 hrs
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4
  },
  dj_elev8: {
    name: 'DJ Elev8 (Brad Powell)',
    basePrice: 500,        // Parties up to 4 hrs
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4
  },
  tko_the_dj: {
    name: 'TKOtheDJ (Joey Tate)',
    basePrice: 500,        // Parties up to 4 hrs
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4
  },
  
  // Photobooth Services
  photobooth_unit1: {
    name: 'Photobooth Unit 1 (Unlimited Strips)',
    basePrice: 500,        // 4 hours unlimited strips
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4,
    printType: 'strips'
  },
  photobooth_unit2: {
    name: 'Photobooth Unit 2 (Unlimited Strips)',
    basePrice: 500,        // 4 hours unlimited strips
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4,
    printType: 'strips'
  },
  photobooth_4x6: {
    name: 'Photobooth (4x6 Prints)',
    basePrice: 550,        // 4 hours with 4x6 prints
    baseHours: 4,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 4,
    printType: '4x6'
  },
  photobooth: {
    name: 'Photobooth Service',
    basePrice: 500,        // Default to strips
    baseHours: 4,
    hourlyRate: 100,
    minHours: 4
  },
  
  // Add-on Services
  karaoke: {
    name: 'Karaoke Add-on',
    basePrice: 100,        // $100 per 4hr event
    baseHours: 4,
    hourlyRate: 50         // $50 per additional hour
  },
  uplighting: {
    name: 'Uplighting Add-on',
    basePrice: 100,        // $100 per 4hr event
    baseHours: 4,
    hourlyRate: 50         // $50 per additional hour
  },
  foam_pit: {
    name: 'Foam Pit Rental',
    basePrice: 500,        // $500 per 4hr event
    baseHours: 4,
    hourlyRate: 100        // $100 per additional hour
  },
  
  // Wedding-specific DJ pricing
  dj_wedding: {
    name: 'DJ Wedding Package',
    basePrice: 850,        // Weddings up to 5 hrs
    baseHours: 5,
    hourlyRate: 100,       // $100 per additional hour
    minHours: 5
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

// ===== STRIPE PAYMENT INTENTS API =====

// Create Payment Intent - Server-side price calculation (SECURE)
app.post('/api/create-payment-intent', async (c) => {
  try {
    // Verify authentication
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized - Please log in' }, 401)
    }
    
    const token = authHeader.substring(7)
    const secret = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, secret)
    } catch (tokenError: any) {
      return c.json({ error: 'Invalid or expired session. Please log in again.' }, 401)
    }
    
    const { DB } = c.env
    const body = await c.req.json()
    const { items, bookingId, eventDetails } = body
    
    // Validate items
    if (!items || items.length === 0) {
      return c.json({ error: 'No items provided' }, 400)
    }
    
    // Calculate total on server side (CRITICAL - never trust client-side prices)
    let totalAmount = 0 // in cents
    const lineItems: any[] = []
    
    for (const item of items) {
      const service = servicePricing[item.serviceId as keyof typeof servicePricing]
      if (!service) {
        return c.json({ error: `Invalid service: ${item.serviceId}` }, 400)
      }
      
      const hours = item.hours || service.baseHours || 4
      const basePrice = service.basePrice
      const hourlyRate = service.hourlyRate || 0
      const baseHours = service.baseHours || 4
      
      // Calculate: base price + additional hours
      let itemTotal = basePrice
      if (hours > baseHours) {
        itemTotal += (hours - baseHours) * hourlyRate
      }
      
      // Convert to cents
      const itemTotalCents = itemTotal * 100
      totalAmount += itemTotalCents
      
      lineItems.push({
        serviceId: item.serviceId,
        serviceName: service.name,
        hours: hours,
        basePrice: basePrice,
        hourlyRate: hourlyRate,
        subtotal: itemTotal,
        subtotalCents: itemTotalCents
      })
    }
    
    // Get Stripe API key
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    const isDevelopmentMode = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock') || STRIPE_SECRET_KEY.includes('Mock')
    
    // DEVELOPMENT MODE: Return mock client secret
    if (isDevelopmentMode) {
      console.log('⚠️  DEVELOPMENT MODE: Using mock payment intent')
      
      // Create booking in pending state
      let newBookingId = bookingId
      if (!bookingId && eventDetails) {
        // Get start/end times from eventDetails or use defaults
        const startTime = eventDetails.startTime || items[0].startTime || '18:00:00'
        const endTime = eventDetails.endTime || items[0].endTime || '23:00:00'
        const eventDate = eventDetails.eventDate || eventDetails.date || items[0].eventDate
        
        const bookingResult = await DB.prepare(`
          INSERT INTO bookings (
            user_id, service_type, service_provider, event_date,
            event_start_time, event_end_time,
            total_price, payment_status, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          payload.userId,
          items[0].serviceType || 'dj',
          items[0].serviceId,
          eventDate,
          startTime,
          endTime,
          totalAmount / 100,
          'pending',
          'pending'
        ).run()
        newBookingId = bookingResult.meta.last_row_id
      }
      
      const mockClientSecret = `pi_mock_${Date.now()}_secret_${Math.random().toString(36).substring(7)}`
      
      return c.json({
        clientSecret: mockClientSecret,
        amount: totalAmount,
        amountFormatted: `$${(totalAmount / 100).toFixed(2)}`,
        lineItems: lineItems,
        bookingId: newBookingId,
        developmentMode: true,
        message: '⚠️ Development mode - Use test card 4242424242424242'
      })
    }
    
    // PRODUCTION: Create real Stripe Payment Intent
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any
    })
    
    // Create booking first to get booking ID
    let newBookingId = bookingId
    if (!bookingId && eventDetails) {
      const prodStartTime = eventDetails.startTime || items[0].startTime || '18:00:00'
      const prodEndTime = eventDetails.endTime || items[0].endTime || '23:00:00'
      const prodEventDate = eventDetails.eventDate || eventDetails.date || items[0].eventDate
      
      const bookingResult = await DB.prepare(`
        INSERT INTO bookings (
          user_id, service_type, service_provider, event_date,
          event_start_time, event_end_time,
          total_price, payment_status, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        payload.userId,
        items[0].serviceType || 'dj',
        items[0].serviceId,
        prodEventDate,
        prodStartTime,
        prodEndTime,
        totalAmount / 100,
        'pending',
        'pending'
      ).run()
      newBookingId = bookingResult.meta.last_row_id
    }
    
    // Create Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        bookingId: newBookingId?.toString() || '',
        userId: payload.userId.toString(),
        items: JSON.stringify(lineItems.map(item => ({
          serviceId: item.serviceId,
          hours: item.hours,
          subtotal: item.subtotal
        })))
      },
      description: `In The House Productions - ${lineItems.map(i => i.serviceName).join(', ')}`
    })
    
    // Update booking with payment intent ID
    if (newBookingId) {
      await DB.prepare(`
        UPDATE bookings 
        SET stripe_payment_intent_id = ?, payment_status = 'pending'
        WHERE id = ?
      `).bind(paymentIntent.id, newBookingId).run()
    }
    
    return c.json({
      clientSecret: paymentIntent.client_secret,
      amount: totalAmount,
      amountFormatted: `$${(totalAmount / 100).toFixed(2)}`,
      lineItems: lineItems,
      bookingId: newBookingId,
      paymentIntentId: paymentIntent.id
    })
    
  } catch (error: any) {
    console.error('Payment intent error:', error)
    return c.json({ error: error.message || 'Failed to create payment' }, 500)
  }
})

// Confirm Payment - Handle webhook from Stripe
app.post('/api/payment/confirm', async (c) => {
  try {
    const { paymentIntentId, bookingId } = await c.req.json()
    const { DB } = c.env
    
    // Update booking status
    if (bookingId) {
      await DB.prepare(`
        UPDATE bookings 
        SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now')
        WHERE id = ?
      `).bind(bookingId).run()
    }
    
    return c.json({ success: true, message: 'Payment confirmed' })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// Get service pricing - Public endpoint for displaying prices
app.get('/api/services/pricing', (c) => {
  // Format pricing for frontend display
  const pricing = {
    dj: {
      party: {
        name: 'DJ Party Package',
        basePrice: 500,
        baseHours: 4,
        hourlyRate: 100,
        description: 'Professional DJ for parties (up to 4 hours)'
      },
      wedding: {
        name: 'DJ Wedding Package',
        basePrice: 850,
        baseHours: 5,
        hourlyRate: 100,
        description: 'Premium DJ + MC for weddings (up to 5 hours)'
      }
    },
    photobooth: {
      strips: {
        name: 'Photobooth - Unlimited Strips',
        basePrice: 500,
        baseHours: 4,
        hourlyRate: 100,
        description: 'Unlimited 2x6 photo strips (4 hours)'
      },
      prints_4x6: {
        name: 'Photobooth - 4x6 Prints',
        basePrice: 550,
        baseHours: 4,
        hourlyRate: 100,
        description: '4x6 prints package (4 hours)'
      }
    },
    addons: {
      karaoke: {
        name: 'Karaoke Add-on',
        basePrice: 100,
        baseHours: 4,
        hourlyRate: 50,
        description: 'Karaoke system with song library'
      },
      uplighting: {
        name: 'Uplighting Add-on',
        basePrice: 100,
        baseHours: 4,
        hourlyRate: 50,
        description: 'Up to 6 LED uplights'
      },
      foam_pit: {
        name: 'Foam Pit Rental',
        basePrice: 500,
        baseHours: 4,
        hourlyRate: 100,
        description: 'Foam party machine & solution'
      }
    }
  }
  
  return c.json(pricing)
})

// Create Stripe checkout session
app.post('/api/checkout/create-session', async (c) => {
  try {
    // Verify authentication
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[CHECKOUT] No auth token')
      return c.json({ error: 'Unauthorized - Please log in' }, 401)
    }
    
    const token = authHeader.substring(7)
    const secret = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, secret)
      console.log('[CHECKOUT] Token valid for user:', payload.userId)
    } catch (tokenError: any) {
      console.error('[CHECKOUT] Token verification failed:', tokenError.message)
      return c.json({ error: 'Invalid or expired session. Please log in again.' }, 401)
    }
    
    const { items, bookingId } = await c.req.json()
    const { DB } = c.env
    
    console.log('[CHECKOUT] Processing checkout for user:', payload.userId, 'booking:', bookingId)
    
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
    const isDevelopmentMode = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock')
    
    // DEVELOPMENT MODE: Mock payment for testing without Stripe
    if (isDevelopmentMode) {
      console.log('⚠️  DEVELOPMENT MODE: Using mock payment (Stripe not configured)')
      const mockSessionId = 'cs_test_mock_' + Date.now()
      const baseUrl = new URL(c.req.url).origin
      
      // Update booking with mock session ID
      if (bookingId && DB) {
        await DB.prepare(`
          UPDATE bookings 
          SET stripe_session_id = ?, payment_status = 'pending'
          WHERE id = ?
        `).bind(mockSessionId, bookingId).run()
      }
      
      return c.json({ 
        sessionId: mockSessionId,
        url: `${baseUrl}/checkout/mock-success?session_id=${mockSessionId}&booking_id=${bookingId}&total=${total}`,
        total,
        developmentMode: true,
        message: '⚠️  Using mock payment - Add real Stripe key for production'
      })
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
    
    // Calculate number of days in the month
    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate()
    
    // Initialize availability object with all dates in month
    const availability: Record<string, any> = {}
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${month.padStart(2, '0')}-${String(day).padStart(2, '0')}`
      availability[dateStr] = {
        available: true,
        capacity: 2, // Default capacity
        remainingSlots: 2,
        bookings: 0
      }
    }
    
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
      
      // Update availability based on bookings
      for (const booking of (bookings.results || [])) {
        const dateStr = booking.event_date as string
        if (availability[dateStr]) {
          availability[dateStr].bookings = booking.count
          availability[dateStr].remainingSlots = 2 - (booking.count as number)
          availability[dateStr].available = (booking.count as number) < 2
        }
      }
      
      return c.json(availability)
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
    
    // Mark blocked dates
    for (const block of (blocks.results || [])) {
      const dateStr = block.block_date as string
      if (availability[dateStr]) {
        availability[dateStr].available = false
        availability[dateStr].remainingSlots = 0
        availability[dateStr].blocked = true
      }
    }
    
    // Update DJ availability based on bookings
    for (const slot of (timeSlots.results || [])) {
      const dateStr = slot.event_date as string
      if (availability[dateStr]) {
        const count = slot.count as number
        const hasAfternoon = slot.has_afternoon as number
        
        availability[dateStr].bookings = count
        
        // DJ can have max 2 bookings per day (morning + afternoon)
        // Or 1 booking if it's an afternoon booking (>=11:00)
        if (count >= 2 || hasAfternoon === 1) {
          availability[dateStr].available = false
          availability[dateStr].remainingSlots = 0
        } else {
          availability[dateStr].available = true
          availability[dateStr].remainingSlots = 2 - count
        }
      }
    }
    
    return c.json(availability)
  } catch (error: any) {
    console.error('Fetch availability error:', error)
    return c.json({ error: 'Failed to fetch availability', details: error.message }, 500)
  }
})

// Create a new booking
app.post('/api/bookings/create', async (c) => {
  try {
    // Authenticate user
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[BOOKING] No auth header')
      return c.json({ error: 'Unauthorized' }, 401)
    }
    
    const token = authHeader.substring(7)
    const secret = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, secret)
      console.log('[BOOKING] Token valid for user:', payload.userId)
    } catch (tokenError: any) {
      console.error('[BOOKING] Token verification failed:', tokenError.message)
      return c.json({ error: 'Invalid or expired token. Please log in again.' }, 401)
    }
    
    const { DB } = c.env
    const bookingData = await c.req.json()
    
    console.log('[BOOKING] Creating booking for user:', payload.userId)
    
    // Validate required fields
    const required = ['serviceType', 'serviceProvider', 'eventDate', 'startTime', 'endTime', 'eventDetails']
    const missing = required.filter(field => !bookingData[field])
    
    if (missing.length > 0) {
      console.error('[BOOKING] Missing fields:', missing)
      return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400)
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
  
  // DEVELOPMENT MODE: Mock notifications if Resend not configured
  const isDevelopmentMode = !RESEND_API_KEY || RESEND_API_KEY.includes('mock')
  
  if (isDevelopmentMode) {
    console.log('⚠️  DEVELOPMENT MODE: Mock email/SMS (Resend/Twilio not configured)')
    console.log('📧 Would send email to customer')
    console.log('📧 Would send email to provider')
    console.log('📱 Would send SMS to provider')
    console.log('Booking details:', {
      bookingId: booking.bookingId,
      eventDate: booking.eventDate,
      eventName: booking.eventDetails.eventName
    })
    return { success: true, developmentMode: true }
  }
  
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
  const baseUrl = 'https://www.inthehouseproductions.com'

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
        <title>In The House Productions - DJ & Photobooth Services</title>

        ${generateMetaTags({
          title: 'In The House Productions - Professional DJ & Photobooth Services',
          description: 'Premium DJ and photobooth services for weddings, corporate events, and private parties. Professional entertainment with state-of-the-art equipment and experienced DJs. Book your event today!',
          canonical: '/',
          keywords: 'DJ services, photobooth rental, wedding DJ, party DJ, corporate events, event entertainment, professional DJ, photobooth services, karaoke, uplighting',
          ogImage: `${baseUrl}/static/hero-logo-3d-v2.png`
        }, baseUrl)}

        ${generateOrganizationSchema(baseUrl)}
        ${generateLocalBusinessSchema(baseUrl)}

        <!-- Performance: DNS Prefetch & Preconnect -->
        <link rel="preconnect" href="https://cdn.tailwindcss.com" crossorigin>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
        <link rel="dns-prefetch" href="https://cdn.tailwindcss.com">
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
        
        <!-- Critical CSS First -->
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <link href="/static/responsive-mobile.css" rel="stylesheet">
        
        <!-- Non-blocking: Load Tailwind with defer -->
        <script src="https://cdn.tailwindcss.com" defer></script>
        
        <!-- Non-blocking: Load Font Awesome async -->
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" media="print" onload="this.media='all'">
        <noscript><link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"></noscript>
        
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

        ${generateFocusStyles()}
        ${generateAccessibilityJS()}
    </head>
    <body class="min-h-screen">
        ${generateSkipLinks()}
        ${generateAriaLiveRegion()}

        <!-- Animated Musical Notes Background -->
        <div id="musical-background" aria-hidden="true"></div>

        <!-- Content -->
        <div class="relative z-10">
            <!-- Header -->
            <header id="navigation" role="banner" class="section-spacing text-center responsive-container">
                <div class="hero-logo-wrapper breathing-room">
                    <img src="/static/hero-logo-3d-v2.png" alt="IN THE HOUSE PRODUCTIONS" style="width: 100%; height: auto; display: block;">
                </div>
                <div class="flex justify-center gap-4 breathing-room">
                    <div class="staff-line" style="max-width: min(90%, 400px); width: 100%;"></div>
                </div>
                <p class="tagline text-3d-gold">"Your Event, Our Expertise"</p>
            </header>

            <!-- Service Cards -->
            <main id="main-content" role="main" class="responsive-container section-spacing">
                <div class="service-grid" style="max-width: 1000px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; padding: 0 1rem;">
            <main class="responsive-container section-spacing">
                <style>
                    .service-cards-container {
                        max-width: 1000px;
                        margin: 0 auto;
                        padding: 0 2rem;
                    }
                    .service-cards-grid {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 450px));
                        gap: 2rem;
                        justify-content: center;
                    }
                    @media (max-width: 768px) {
                        .service-cards-grid {
                            grid-template-columns: 1fr;
                            max-width: 450px;
                            margin: 0 auto;
                        }
                    }
                </style>
                <div class="service-cards-container">
                    <div class="service-cards-grid">
                    <!-- DJ Services Card -->
                    <div class="service-card no-select focusable" onclick="window.location.href='/dj-services'" role="button" tabindex="0" aria-label="Book DJ Services - Professional DJs starting at $500" onkeypress="if(event.key==='Enter')window.location.href='/dj-services'">
                        <div class="service-card-icon">
                            <i class="fas fa-headphones-alt" style="color: var(--primary-red); font-size: 70px; display: block; text-align: center;"></i>
                        </div>
                        <div class="breathing-room" style="max-width: 100%; overflow: hidden;">
                            <img src="/static/dj-services-logo-3d.png" alt="DJ SERVICES" loading="lazy" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
                        </div>
                        <p class="service-card-subtitle breathing-room">
                            Professional DJs spinning the perfect soundtrack for your special event
                        </p>
                        <div style="background: linear-gradient(135deg, rgba(192, 192, 192, 0.1) 0%, rgba(255, 215, 0, 0.05) 100%); border: 1px solid rgba(192, 192, 192, 0.3); border-radius: 12px; padding: 1.25rem; margin: 1rem 0; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);">
                            <p style="font-size: 1.5rem; font-weight: bold; background: linear-gradient(135deg, #FFD700, #FFA500); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-align: center; margin-bottom: 0.5rem;">Starting at $500</p>
                            <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center; margin-bottom: 0.25rem;">Parties (up to 4 hrs)</p>
                            <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center; margin-bottom: 0.25rem;">Weddings: $850 (up to 5 hrs)</p>
                            <p style="font-size: 0.8rem; color: #999; text-align: center;">$100/hr additional</p>
                        </div>
                        <ul class="service-card-subtitle breathing-room" style="list-style: none; padding: 0;">
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> 3 Professional DJs</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> 20+ Years Experience</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> Custom Playlists</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> All Event Types</li>
                        </ul>
                        <button class="btn-3d btn-responsive">
                            SELECT SERVICE <i class="fas fa-arrow-right" style="margin-left: 0.5rem;"></i>
                        </button>
                    </div>
                    
                    <!-- Photobooth Card -->
                    <div class="service-card no-select focusable" onclick="window.location.href='/photobooth'" role="button" tabindex="0" aria-label="Book Photobooth Services - Premium photobooths starting at $500" onkeypress="if(event.key==='Enter')window.location.href='/photobooth'">
                        <div class="service-card-icon">
                            <i class="fas fa-camera-retro" style="color: var(--primary-red); font-size: 70px; display: block; text-align: center;"></i>
                        </div>
                        <div class="breathing-room" style="max-width: 100%; overflow: hidden;">
                            <img src="/static/photobooth-logo-3d.png" alt="PHOTOBOOTH" loading="lazy" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">
                        </div>
                        <p class="service-card-subtitle breathing-room">
                            Fun memories with instant prints and shareable moments
                        </p>
                        <div style="background: linear-gradient(135deg, rgba(192, 192, 192, 0.1) 0%, rgba(255, 215, 0, 0.05) 100%); border: 1px solid rgba(192, 192, 192, 0.3); border-radius: 12px; padding: 1.25rem; margin: 1rem 0; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);">
                            <p style="font-size: 1.5rem; font-weight: bold; background: linear-gradient(135deg, #FFD700, #FFA500); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-align: center; margin-bottom: 0.5rem;">Starting at $500</p>
                            <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center; margin-bottom: 0.25rem;">4 hours unlimited strips</p>
                            <p style="font-size: 0.9rem; color: var(--chrome-silver); text-align: center; margin-bottom: 0.25rem;">4x6 Prints: $550 (4 hrs)</p>
                            <p style="font-size: 0.8rem; color: #999; text-align: center;">$100/hr additional</p>
                        </div>
                        <ul class="service-card-subtitle breathing-room" style="list-style: none; padding: 0;">
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> 2 Professional Units</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> Unlimited Prints</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> Custom Backdrops</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--primary-red); margin-right: 0.5rem;"></i> Digital Gallery</li>
                        </ul>
                        <button class="btn-3d btn-responsive">
                            SELECT SERVICE <i class="fas fa-arrow-right" style="margin-left: 0.5rem;"></i>
                        </button>
                    </div>
                    </div>
                </div>
                </div>
                
                <!-- Add-On Services Section -->
                <div class="mt-16">
                    <h3 class="text-3d-logo-12k-gold text-3d-medium mb-8 text-center">⭐ ADD-ON SERVICES ⭐</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 max-w-7xl mx-auto px-4">
                        <!-- Karaoke Setup -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-6 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/30 cursor-pointer" onclick="showServiceModal('karaoke')">
                            <div class="text-center mb-4">
                                <i class="fas fa-microphone text-5xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-xl font-bold text-center mb-2 text-chrome-silver">Karaoke Setup</h4>
                            <div class="text-center mb-4">
                                <p class="text-2xl font-bold text-primary-red">Additional $100</p>
                                <p class="text-sm text-chrome-silver">Per 4-hour event</p>
                                <p class="text-xs text-gray-400 mt-1">$50/hr additional</p>
                            </div>
                            <p class="text-sm text-center text-gray-400">Professional karaoke system with extensive song library</p>
                            <button class="mt-4 w-full bg-primary-red text-white py-2 rounded font-bold hover:bg-accent-neon transition-all">
                                LEARN MORE
                            </button>
                        </div>

                        <!-- Uplighting -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-6 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/30 cursor-pointer" onclick="showServiceModal('uplighting')">
                            <div class="text-center mb-4">
                                <i class="fas fa-lightbulb text-5xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-xl font-bold text-center mb-2 text-chrome-silver">Uplighting</h4>
                            <div class="text-center mb-4">
                                <p class="text-2xl font-bold text-primary-red">Additional $100</p>
                                <p class="text-sm text-chrome-silver">Per 4-hour event</p>
                                <p class="text-xs text-gray-400 mt-1">$50/hr additional</p>
                            </div>
                            <p class="text-sm text-center text-gray-400">Transform your venue with customizable ambient lighting (up to 6 lights)</p>
                            <button class="mt-4 w-full bg-primary-red text-white py-2 rounded font-bold hover:bg-accent-neon transition-all">
                                LEARN MORE
                            </button>
                        </div>

                        <!-- Foam Pit -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-6 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/30 cursor-pointer" onclick="showServiceModal('foampit')">
                            <div class="text-center mb-4">
                                <i class="fas fa-cloud text-5xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-xl font-bold text-center mb-2 text-chrome-silver">Foam Pit</h4>
                            <div class="text-center mb-4">
                                <p class="text-2xl font-bold text-primary-red">$500</p>
                                <p class="text-sm text-chrome-silver">Per 4-hour event</p>
                                <p class="text-xs text-gray-400 mt-1">$100/hr additional</p>
                            </div>
                            <p class="text-sm text-center text-gray-400">Ultimate party experience with foam machine rental</p>
                            <button class="mt-4 w-full bg-primary-red text-white py-2 rounded font-bold hover:bg-accent-neon transition-all">
                                LEARN MORE
                            </button>
                        </div>

                        <!-- Wedding Photography -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-6 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/30 cursor-pointer" onclick="showServiceModal('photography')">
                            <div class="text-center mb-4">
                                <i class="fas fa-camera text-5xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-xl font-bold text-center mb-2 text-chrome-silver">Wedding Photography</h4>
                            <div class="text-center mb-4">
                                <p class="text-xl font-bold text-primary-red">Info on Request</p>
                                <p class="text-sm text-chrome-silver">Custom packages</p>
                            </div>
                            <p class="text-sm text-center text-gray-400">Professional wedding photography to capture your special day</p>
                            <button class="mt-4 w-full bg-primary-red text-white py-2 rounded font-bold hover:bg-accent-neon transition-all">
                                CONTACT US
                            </button>
                        </div>

                        <!-- Wedding/Event Coordinator -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-6 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/30 cursor-pointer" onclick="showServiceModal('coordinator')">
                            <div class="text-center mb-4">
                                <i class="fas fa-clipboard-check text-5xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-xl font-bold text-center mb-2 text-chrome-silver">Event Coordinator</h4>
                            <div class="text-center mb-4">
                                <p class="text-xl font-bold text-primary-red">Info on Request</p>
                                <p class="text-sm text-chrome-silver">Custom packages</p>
                            </div>
                            <p class="text-sm text-center text-gray-400">Professional event coordination for stress-free celebrations</p>
                            <button class="mt-4 w-full bg-primary-red text-white py-2 rounded font-bold hover:bg-accent-neon transition-all">
                                CONTACT US
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Service Detail Modal -->
                <div id="serviceModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);backdrop-filter:blur(5px);z-index:9999;justify-content:center;align-items:center;">
                    <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border:3px solid var(--primary-red);border-radius:16px;padding:32px;max-width:600px;width:92%;margin:0 auto;box-shadow:0 20px 60px rgba(227,30,36,0.8);">
                        <div id="serviceModalContent"></div>
                        <button onclick="closeServiceModal()" class="mt-6 w-full bg-chrome-silver text-black py-3 rounded font-bold hover:bg-white transition-all">
                            CLOSE
                        </button>
                    </div>
                </div>
                
                <script>
                const serviceDetails = {
                    karaoke: {
                        icon: 'fa-microphone',
                        title: 'Karaoke Setup',
                        price: '$100 per 4-hour event',
                        additional: '$50 per additional hour',
                        description: 'Professional karaoke system with extensive song library covering all genres and eras.',
                        features: [
                            'Extensive song library (1000s of songs)',
                            'Professional audio equipment',
                            'Multiple microphones',
                            'Easy-to-use song selection',
                            'Lyrics display screens',
                            'Perfect for weddings, parties, and corporate events'
                        ]
                    },
                    uplighting: {
                        icon: 'fa-lightbulb',
                        title: 'Uplighting',
                        price: '$100 per 4-hour event',
                        additional: 'Up to 6 lights included',
                        description: 'Transform your venue with customizable LED uplighting to match your event theme.',
                        features: [
                            'Up to 6 wireless LED uplights',
                            'Customizable colors to match your theme',
                            'Remote-controlled brightness and effects',
                            'Professional placement and setup',
                            'Creates stunning ambiance',
                            'Perfect for weddings, galas, and upscale events'
                        ]
                    },
                    foampit: {
                        icon: 'fa-cloud',
                        title: 'Foam Pit Rental',
                        price: '$500 per 4-hour event',
                        additional: '$100 per additional hour',
                        description: 'Ultimate party experience! Our foam machine creates an unforgettable dance floor.',
                        features: [
                            'Professional-grade foam machine',
                            'Safe, hypoallergenic foam solution',
                            'Creates 2-4 feet of foam coverage',
                            'Attendant included for operation',
                            'Indoor or outdoor use',
                            'Perfect for school dances, parties, and summer events'
                        ]
                    },
                    photography: {
                        icon: 'fa-camera',
                        title: 'Wedding Photography',
                        price: 'Custom packages available',
                        additional: 'Info provided upon request',
                        description: 'Professional wedding photography to capture every precious moment of your special day.',
                        features: [
                            'Experienced wedding photographer',
                            'Full-day coverage options',
                            'High-resolution digital images',
                            'Online gallery delivery',
                            'Custom photo packages',
                            'Contact us for detailed pricing and availability'
                        ]
                    },
                    coordinator: {
                        icon: 'fa-clipboard-check',
                        title: 'Wedding/Event Coordinator',
                        price: 'Custom packages available',
                        additional: 'Info provided upon request',
                        description: 'Professional event coordination to ensure your special day runs smoothly from start to finish.',
                        features: [
                            'Experienced event coordinator',
                            'Pre-event planning and consultation',
                            'Day-of coordination and management',
                            'Vendor communication and scheduling',
                            'Timeline creation and execution',
                            'Stress-free event experience for you and your guests'
                        ]
                    }
                };
                
                function showServiceModal(service) {
                    const modal = document.getElementById('serviceModal');
                    const content = document.getElementById('serviceModalContent');
                    const details = serviceDetails[service];
                    
                    let html = \`
                        <div class="text-center mb-6">
                            <i class="fas \${details.icon} text-6xl" style="color: var(--primary-red);"></i>
                        </div>
                        <h2 class="text-3xl font-bold text-center mb-4" style="color: var(--chrome-silver);">\${details.title}</h2>
                        <div class="text-center mb-6">
                            <p class="text-3xl font-bold" style="color: var(--primary-red);">\${details.price}</p>
                            <p class="text-sm text-gray-400 mt-2">\${details.additional}</p>
                        </div>
                        <p class="text-center text-gray-300 mb-6">\${details.description}</p>
                        <div class="text-left">
                            <h3 class="text-xl font-bold mb-3" style="color: var(--chrome-silver);">Features:</h3>
                            <ul class="space-y-2">
                    \`;
                    
                    details.features.forEach(feature => {
                        html += \`<li class="text-gray-300"><i class="fas fa-check mr-2" style="color: var(--primary-red);"></i>\${feature}</li>\`;
                    });
                    
                    html += \`
                            </ul>
                        </div>
                    \`;
                    
                    content.innerHTML = html;
                    modal.style.display = 'flex';
                }
                
                function closeServiceModal() {
                    document.getElementById('serviceModal').style.display = 'none';
                }
                </script>
                
                <!-- Preferred Event Vendors Section -->
                <div class="mt-20">
                    <h3 class="text-3d-logo-12k-gold text-3d-medium mb-8 text-center">🤝 PREFERRED EVENT VENDORS 🤝</h3>
                    <p class="text-center text-chrome-silver mb-8 max-w-3xl mx-auto px-4">
                        We're proud to partner with these exceptional venues across the region. 
                        Professional service and unforgettable celebrations!
                    </p>
                    <div style="display: flex; flex-wrap: wrap; gap: 1.5rem; max-width: 900px; margin: 0 auto; padding: 0 2rem; justify-content: center;">
                        <!-- DK Farms -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center" style="width: 150px; flex-shrink: 0;">
                            <div class="text-4xl mb-2">🚜</div>
                            <h4 class="text-sm font-bold text-chrome-silver">DK Farms</h4>
                        </div>

                        <!-- The Big Red Barn -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center" style="width: 150px; flex-shrink: 0;">
                            <div class="text-4xl mb-2">🏚️</div>
                            <h4 class="text-sm font-bold text-chrome-silver">The Big Red Barn</h4>
                        </div>

                        <!-- Garden Gate -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center" style="width: 150px; flex-shrink: 0;">
                            <div class="text-4xl mb-2">🌸</div>
                            <h4 class="text-sm font-bold text-chrome-silver">Garden Gate</h4>
                        </div>

                        <!-- Still Creek -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center" style="width: 150px; flex-shrink: 0;">
                            <div class="text-4xl mb-2">🌊</div>
                            <h4 class="text-sm font-bold text-chrome-silver">Still Creek</h4>
                        </div>

                        <!-- Barn Yard -->
                        <div class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center" style="width: 150px; flex-shrink: 0;">
                            <div class="text-4xl mb-2">🐄</div>
                            <h4 class="text-sm font-bold text-chrome-silver">Barn Yard</h4>
                        </div>
                    </div>
                    <p class="text-center text-gray-400 text-sm mt-6 px-4">
                        <i class="fas fa-star mr-1" style="color: var(--primary-red);"></i>
                        Trusted partners for exceptional events
                        <i class="fas fa-star ml-1" style="color: var(--primary-red);"></i>
                    </p>
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
          
          // Create notes continuously (after page load)
          requestIdleCallback(() => {
            setInterval(createMusicalNote, 2000);
            
            // Initial batch
            for (let i = 0; i < 10; i++) {
              setTimeout(createMusicalNote, i * 500);
            }
          }, { timeout: 2000 });
        </script>
    </body>
    </html>
  `)
})

// DJ Services Page - Profile Selection
app.get('/dj-services', (c) => {
  const baseUrl = 'https://www.inthehouseproductions.com'

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DJ Services - In The House Productions</title>

        ${generateMetaTags({
          title: 'Professional DJ Services - Weddings, Parties & Corporate Events',
          description: 'Choose from our roster of experienced professional DJs: DJ Cease, DJ Elev8, and TKO The DJ. Specializing in weddings, parties, and corporate events with customizable packages starting at $500.',
          canonical: '/dj-services',
          keywords: 'professional DJ, wedding DJ, party DJ, corporate event DJ, DJ services, event entertainment, DJ booking',
          ogImage: `${baseUrl}/static/dj-page-hero-3d.png`
        }, baseUrl)}

        ${generateServiceSchema({
          name: 'Professional DJ Services',
          description: 'Expert DJs for all event types with state-of-the-art equipment and extensive music libraries',
          price: '500.00',
          image: `${baseUrl}/static/dj-page-hero-3d.png`
        }, baseUrl)}

        ${generateBreadcrumbSchema([
          { name: 'Home', url: '/' },
          { name: 'DJ Services', url: '/dj-services' }
        ], baseUrl)}

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
            <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border:2px solid #FFD700;border-radius:16px;padding:24px;max-width:440px;width:92%;margin:0 auto;box-shadow:0 20px 60px rgba(220,20,60,0.5);animation:slideUp 0.3s ease;">
                <div id="proModalIcon" style="text-align:center;font-size:48px;margin-bottom:16px;"></div>
                <h2 id="proModalTitle" style="color:white;font-size:20px;font-weight:bold;text-align:center;margin-bottom:12px;"></h2>
                <p id="proModalMsg" style="color:#C0C0C0;font-size:15px;text-align:center;line-height:1.5;margin-bottom:20px;"></p>
                <div id="proModalBtns" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;"></div>
            </div>
        </div>
        <style>
        @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        #proModal.show{display:flex!important}
        .pro-btn{padding:12px 24px;min-height:48px;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:all 0.3s;text-transform:uppercase}
        .pro-btn-primary{background:linear-gradient(135deg,#DC143C,#ff1744);color:white}
        .pro-btn-primary:hover{box-shadow:0 6px 20px rgba(220,20,60,0.6);transform:translateY(-2px)}
        .pro-btn-secondary{background:linear-gradient(135deg,#555,#777);color:white}
        .pro-btn-secondary:hover{box-shadow:0 6px 20px rgba(192,192,192,0.4);transform:translateY(-2px)}
        </style>
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <img src="/static/dj-page-hero-3d.png" alt="SELECT YOUR DJ" class="mx-auto mb-4" style="width: 100%; max-width: 480px; height: auto;">
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
          
          async function continueToCalendar() {
            // Store selected DJ in localStorage
            localStorage.setItem('selectedDJ', selectedDJ);
            localStorage.setItem('serviceType', 'dj');
            // Clear any photobooth selection
            localStorage.removeItem('selectedPhotobooth');
            
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
          let selectedPhotobooth = null; // ADD THIS
          let selectedProvider = null; // Can be DJ or Photobooth
          let serviceType = null;
          let availabilityData = {};
          
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          
          // Alert and error dialogs
          function showAlert(message, title = 'Notice') {
            return new Promise((resolve) => {
              alert(title + '\\n\\n' + message);
              resolve();
            });
          }
          
          function showError(message, title = 'Error') {
            return new Promise((resolve) => {
              alert(title + '\\n\\n' + message);
              resolve();
            });
          }
          
          // Check authentication and load selection
          window.addEventListener('DOMContentLoaded', () => {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
              showAlert('Please log in to continue booking.', 'Login Required').then(() => {
                window.location.href = '/login';
              });
              return;
            }
            
            // Get service type (DJ or Photobooth)
            serviceType = localStorage.getItem('serviceType');
            selectedDJ = localStorage.getItem('selectedDJ');
            selectedPhotobooth = localStorage.getItem('selectedPhotobooth'); // Changed from const
            
            // CRITICAL DEBUG: Log what we have in localStorage
            console.log('📦 localStorage values:', {
              serviceType,
              selectedDJ,
              selectedPhotobooth,
              authToken: !!localStorage.getItem('authToken')
            });
            
            // Set the provider based on service type
            if (serviceType === 'photobooth') {
              // Map unit1/unit2 to photobooth_unit1/photobooth_unit2 for API calls
              if (selectedPhotobooth === 'unit1') {
                selectedProvider = 'photobooth_unit1';
                console.log('✅ Mapped unit1 → photobooth_unit1');
              } else if (selectedPhotobooth === 'unit2') {
                selectedProvider = 'photobooth_unit2';
                console.log('✅ Mapped unit2 → photobooth_unit2');
              } else if (selectedPhotobooth) {
                selectedProvider = selectedPhotobooth; // In case it's already the full ID
                console.log('✅ Using existing photobooth ID:', selectedPhotobooth);
              } else {
                console.error('❌ CRITICAL: selectedPhotobooth is null/undefined!');
              }
            } else {
              selectedProvider = selectedDJ;
              console.log('✅ Using DJ provider:', selectedDJ);
            }
            
            // Check if ANY service is selected
            if (!selectedProvider) {
              console.error('❌ CRITICAL: No provider selected!', {
                serviceType,
                selectedDJ,
                selectedPhotobooth
              });
              showAlert('Please select a service first (DJ or Photobooth).', 'Selection Required').then(() => {
                window.location.href = '/';
              });
              return;
            }
            
            console.log('✅ Calendar loaded successfully:', { 
              serviceType, 
              selectedProvider, 
              selectedDJ, 
              selectedPhotobooth 
            });
            
            // Display selected service
            if (serviceType === 'photobooth') {
              const photoboothNames = {
                'unit1': 'Photobooth Unit 1 (Maria Cecil)',
                'unit2': 'Photobooth Unit 2 (Cora Scarborough)',
                'photobooth_unit1': 'Photobooth Unit 1 (Maria Cecil)',
                'photobooth_unit2': 'Photobooth Unit 2 (Cora Scarborough)'
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
            console.log('🗓️  Starting calendar render...');
            renderCalendar().then(() => {
              console.log('✅ Calendar render complete!');
            }).catch((error) => {
              console.error('❌ Calendar render failed:', error);
              document.getElementById('selectedDJDisplay').textContent = 'ERROR: Calendar failed to load';
              document.getElementById('monthYear').textContent = 'Error loading calendar';
              showError('Failed to load calendar. Please try again or contact support.', 'Calendar Error');
            });
          });
          
          function renderCalendar() {
            // Update month/year display
            document.getElementById('monthYear').textContent = 
              monthNames[currentMonth] + ' ' + currentYear;
            
            // Load availability data for current month
            return loadAvailability().then(() => {
            
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
            }); // Close the loadAvailability().then()
          }
          
          function loadAvailability() {
            return new Promise((resolve, reject) => {
              try {
                // Get availability for current month using selectedProvider
                const provider = selectedProvider || selectedDJ;
                console.log('Loading availability for:', provider, currentYear, currentMonth + 1);
                
                if (!provider) {
                  console.warn('No provider selected');
                  availabilityData = {};
                  resolve();
                  return;
                }
                
                fetch(\`/api/availability/\${provider}/\${currentYear}/\${currentMonth + 1}\`)
                  .then(response => response.json())
                  .then(data => {
                    console.log('Availability data loaded:', data);
                    availabilityData = data;
                    resolve();
                  })
                  .catch(error => {
                    console.error('Error loading availability:', error);
                    availabilityData = {};
                    resolve(); // Resolve anyway to not block calendar
                  });
              } catch (error) {
                console.error('Error loading availability:', error);
                availabilityData = {};
                resolve();
              }
            });
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
              showAlert('Please select a date first.', 'Selection Required');
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
          // Helper functions for alerts
          function showAlert(message, title = 'Notice') {
            return new Promise((resolve) => {
              const modal = document.createElement('div');
              modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
              modal.innerHTML = \`
                <div style="background: #141414; border: 2px solid #FFD700; border-radius: 15px; padding: 2rem; max-width: 500px; width: 90%; box-shadow: 0 0 30px rgba(255, 215, 0, 0.5); animation: slideIn 0.3s ease-out;">
                  <div style="text-align: center; margin-bottom: 1.5rem;">
                    <i class="fas fa-info-circle" style="font-size: 3rem; color: #FFD700;"></i>
                  </div>
                  <h2 style="color: #FFD700; text-align: center; font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">\${title}</h2>
                  <p style="color: #C0C0C0; text-align: center; font-size: 1rem; line-height: 1.6; margin-bottom: 1.5rem;">\${message}</p>
                  <div style="text-align: center;">
                    <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove(); window.alertResolve();" style="background: linear-gradient(135deg, #FFD700, #FFA500); color: #000; padding: 0.75rem 2rem; border: none; border-radius: 50px; font-weight: bold; font-size: 1rem; cursor: pointer; transition: all 0.3s; text-transform: uppercase; letter-spacing: 1px;">
                      OK
                    </button>
                  </div>
                </div>
              \`;
              document.body.appendChild(modal);
              window.alertResolve = resolve;
            });
          }
          
          function showError(message, title = 'Error') {
            return new Promise((resolve) => {
              const modal = document.createElement('div');
              modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
              modal.innerHTML = \`
                <div style="background: #141414; border: 2px solid #E31E24; border-radius: 15px; padding: 2rem; max-width: 500px; width: 90%; box-shadow: 0 0 30px rgba(227, 30, 36, 0.5); animation: slideIn 0.3s ease-out;">
                  <div style="text-align: center; margin-bottom: 1.5rem;">
                    <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: #E31E24;"></i>
                  </div>
                  <h2 style="color: #E31E24; text-align: center; font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem;">\${title}</h2>
                  <p style="color: #C0C0C0; text-align: center; font-size: 1rem; line-height: 1.6; margin-bottom: 1.5rem;">\${message}</p>
                  <div style="text-align: center;">
                    <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove(); window.errorResolve();" style="background: linear-gradient(135deg, #E31E24, #FF0040); color: #fff; padding: 0.75rem 2rem; border: none; border-radius: 50px; font-weight: bold; font-size: 1rem; cursor: pointer; transition: all 0.3s; text-transform: uppercase; letter-spacing: 1px;">
                      OK
                    </button>
                  </div>
                </div>
              \`;
              document.body.appendChild(modal);
              window.errorResolve = resolve;
            });
          }
          
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
              
              // CRITICAL FIX: Correctly map service provider
              let serviceType = bookingData.serviceType;
              let serviceProvider = bookingData.serviceProvider;
              
              // Handle DJ bookings
              if (!serviceType && bookingData.dj) {
                serviceType = 'dj';
                serviceProvider = bookingData.dj;
              }
              
              // CRITICAL: Map photobooth unit IDs to database format
              if (serviceType === 'photobooth') {
                const photoboothMapping = {
                  'unit1': 'photobooth_unit1',
                  'unit2': 'photobooth_unit2',
                  'photobooth_unit1': 'photobooth_unit1', // Already correct
                  'photobooth_unit2': 'photobooth_unit2'  // Already correct
                };
                serviceProvider = photoboothMapping[serviceProvider] || serviceProvider;
              }
              
              console.log('📤 Creating booking:', {
                serviceType,
                serviceProvider,
                eventDate: bookingData.date,
                startTime,
                endTime
              });
              
              // Validate required fields before sending
              if (!serviceType) {
                throw new Error('Service type is missing');
              }
              if (!serviceProvider) {
                throw new Error('Service provider is missing');
              }
              if (!bookingData.date) {
                throw new Error('Event date is missing');
              }
              if (!startTime || !endTime) {
                throw new Error('Start time and end time are required');
              }
              
              console.log('[FRONTEND] Creating booking...');
              
              // Create booking
              const response = await fetch('/api/bookings/create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': \`Bearer \${authToken}\`
                },
                body: JSON.stringify({
                  serviceType,
                  serviceProvider,
                  eventDate: bookingData.date,
                  startTime,
                  endTime,
                  eventDetails
                })
              });
              
              const result = await response.json();
              console.log('[FRONTEND] Booking response status:', response.status);
              
              if (!response.ok) {
                // CRITICAL: Only redirect to login for actual auth errors (401)
                // Other errors should show the message without logging out
                if (response.status === 401) {
                  console.error('🔒 Authentication failed:', result.error);
                  localStorage.removeItem('authToken');
                  localStorage.removeItem('user');
                  await showAlert('Your session has expired. Please log in again.', 'Session Expired');
                  window.location.href = '/login';
                  return;
                }
                
                // For other errors (400, 409, 500, etc), show the error without logging out
                console.error('❌ Booking creation failed:', result.error);
                throw new Error(result.error || 'Booking failed');
              }
              
              // Store booking ID and data for checkout page
              localStorage.setItem('bookingId', result.bookingId);
              localStorage.setItem('bookingData', JSON.stringify({
                ...bookingData,
                bookingId: result.bookingId
              }));
              console.log('[FRONTEND] Booking created, redirecting to checkout page...');
              
              // Redirect to new checkout page with Stripe Elements
              window.location.href = '/checkout';
              
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

// Checkout Page with Stripe Elements
app.get('/checkout', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Checkout - In The House Productions</title>
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://js.stripe.com/v3/"></script>
        <style>
          :root {
            --primary-red: #E31E24;
            --chrome-silver: #C0C0C0;
            --accent-neon: #FF0040;
          }
          body { background: #000; color: #fff; min-height: 100vh; }
          .checkout-container {
            max-width: 600px;
            margin: 0 auto;
            padding: 2rem;
          }
          .order-summary {
            background: linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%);
            border: 2px solid var(--chrome-silver);
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
          }
          .line-item {
            display: flex;
            justify-content: space-between;
            padding: 0.75rem 0;
            border-bottom: 1px solid #333;
          }
          .line-item:last-child {
            border-bottom: none;
          }
          .total-line {
            font-size: 1.5rem;
            font-weight: bold;
            color: #22c55e;
            padding-top: 1rem;
            margin-top: 0.5rem;
            border-top: 2px solid var(--primary-red);
          }
          .payment-form {
            background: linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%);
            border: 2px solid var(--chrome-silver);
            border-radius: 1rem;
            padding: 1.5rem;
          }
          #payment-element {
            min-height: 200px;
            padding: 1rem;
            background: #fff;
            border-radius: 0.5rem;
            margin-bottom: 1rem;
          }
          #submit-button {
            width: 100%;
            background: linear-gradient(135deg, #22c55e, #16a34a);
            color: white;
            font-weight: bold;
            font-size: 1.25rem;
            padding: 1rem 2rem;
            border: none;
            border-radius: 0.5rem;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
          }
          #submit-button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(34, 197, 94, 0.5);
          }
          #submit-button:disabled {
            background: #666;
            cursor: not-allowed;
          }
          #error-message {
            color: #ef4444;
            padding: 1rem;
            text-align: center;
            font-weight: bold;
          }
          .dev-notice {
            background: #fbbf24;
            color: #000;
            padding: 1rem;
            border-radius: 0.5rem;
            text-align: center;
            margin-bottom: 1rem;
          }
          .loading-spinner {
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .secure-badge {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            color: #22c55e;
            font-size: 0.875rem;
            margin-top: 1rem;
          }
        </style>
    </head>
    <body>
        <div class="checkout-container">
            <!-- Header -->
            <div class="text-center mb-8">
                <a href="/">
                    <img src="/static/logo-chrome-3d.png" alt="In The House Productions" style="max-height: 80px; margin: 0 auto;" onerror="this.style.display='none'">
                </a>
                <h1 class="text-3xl font-bold mt-4" style="color: var(--primary-red);">
                    <i class="fas fa-lock mr-2"></i>Secure Checkout
                </h1>
            </div>

            <!-- Development Mode Notice (shown when in dev mode) -->
            <div id="dev-notice" class="dev-notice hidden">
                <i class="fas fa-flask mr-2"></i>
                <strong>Development Mode</strong> - Use test card: 4242 4242 4242 4242
            </div>

            <!-- Order Summary -->
            <div class="order-summary">
                <h2 class="text-xl font-bold mb-4" style="color: var(--chrome-silver);">
                    <i class="fas fa-receipt mr-2"></i>Order Summary
                </h2>
                <div id="line-items">
                    <div class="text-center text-gray-400 py-4">
                        <i class="fas fa-spinner loading-spinner mr-2"></i>Loading order details...
                    </div>
                </div>
                <div class="line-item total-line">
                    <span>Total</span>
                    <span id="order-total">$0.00</span>
                </div>
            </div>

            <!-- Payment Form -->
            <div class="payment-form">
                <h2 class="text-xl font-bold mb-4" style="color: var(--chrome-silver);">
                    <i class="fas fa-credit-card mr-2"></i>Payment Details
                </h2>
                
                <form id="payment-form">
                    <div id="payment-element">
                        <!-- Stripe Elements will be inserted here -->
                        <div class="text-center text-gray-400 py-8">
                            <i class="fas fa-spinner loading-spinner mr-2"></i>Loading payment form...
                        </div>
                    </div>
                    
                    <button type="submit" id="submit-button" disabled>
                        <i class="fas fa-lock mr-2"></i>
                        <span id="button-text">Pay Now</span>
                    </button>
                    
                    <div id="error-message"></div>
                    
                    <div class="secure-badge">
                        <i class="fas fa-shield-alt"></i>
                        <span>Secured by Stripe - 256-bit SSL encryption</span>
                    </div>
                </form>
            </div>

            <!-- Back Link -->
            <div class="text-center mt-6">
                <a href="/event-details" class="text-gray-400 hover:text-white transition-colors">
                    <i class="fas fa-arrow-left mr-2"></i>Back to Event Details
                </a>
            </div>
        </div>

        <script>
            // Get booking data from localStorage
            const authToken = localStorage.getItem('authToken');
            const bookingData = JSON.parse(localStorage.getItem('bookingData') || '{}');
            const bookingId = localStorage.getItem('bookingId');
            
            console.log('[CHECKOUT] Auth token:', authToken ? 'Present' : 'Missing');
            console.log('[CHECKOUT] Booking data:', bookingData);
            console.log('[CHECKOUT] Booking ID:', bookingId);
            
            // Redirect if not authenticated
            if (!authToken) {
                alert('Please log in to continue with checkout');
                window.location.href = '/login';
            }
            
            // Initialize Stripe
            let stripe = null;
            let elements = null;
            let paymentElement = null;
            let clientSecret = null;
            
            // Calculate hours
            function calculateHours(start, end) {
                if (!start || !end) return 4;
                const [startHour, startMin] = start.split(':').map(Number);
                const [endHour, endMin] = end.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                return Math.max(Math.ceil((endMinutes - startMinutes) / 60), 4);
            }
            
            // Initialize checkout
            async function initializeCheckout() {
                try {
                    // Prepare items for payment
                    const items = [{
                        serviceId: bookingData.dj || bookingData.serviceType || 'dj_cease',
                        serviceType: bookingData.serviceType || 'dj',
                        eventDate: bookingData.date,
                        hours: calculateHours(bookingData.startTime, bookingData.endTime)
                    }];
                    
                    // Create Payment Intent
                    const response = await fetch('/api/create-payment-intent', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + authToken
                        },
                        body: JSON.stringify({
                            items: items,
                            bookingId: bookingId,
                            eventDetails: bookingData
                        })
                    });
                    
                    const data = await response.json();
                    console.log('[CHECKOUT] Payment Intent response:', data);
                    
                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to create payment');
                    }
                    
                    // Update order summary
                    const lineItemsContainer = document.getElementById('line-items');
                    lineItemsContainer.innerHTML = data.lineItems.map(item => \`
                        <div class="line-item">
                            <span>
                                <strong>\${item.serviceName}</strong><br>
                                <small class="text-gray-400">\${item.hours} hours</small>
                            </span>
                            <span>$\${item.subtotal.toFixed(2)}</span>
                        </div>
                    \`).join('');
                    
                    document.getElementById('order-total').textContent = data.amountFormatted;
                    
                    // Handle development mode
                    if (data.developmentMode) {
                        document.getElementById('dev-notice').classList.remove('hidden');
                        
                        // In dev mode, show mock payment form
                        document.getElementById('payment-element').innerHTML = \`
                            <div class="text-center py-6">
                                <i class="fas fa-credit-card text-4xl mb-4" style="color: var(--chrome-silver);"></i>
                                <p class="text-lg font-bold mb-2">Development Mode Payment</p>
                                <p class="text-gray-600 mb-4">Click "Pay Now" to simulate a successful payment</p>
                                <div class="bg-gray-100 p-3 rounded text-sm text-gray-600">
                                    Test Card: 4242 4242 4242 4242<br>
                                    Expiry: Any future date | CVC: Any 3 digits
                                </div>
                            </div>
                        \`;
                        
                        document.getElementById('submit-button').disabled = false;
                        document.getElementById('button-text').textContent = 'Pay ' + data.amountFormatted + ' (Test)';
                        
                        // Store data for mock payment
                        window.mockPaymentData = {
                            bookingId: data.bookingId,
                            amount: data.amount,
                            clientSecret: data.clientSecret
                        };
                        
                        return; // Don't initialize Stripe in dev mode
                    }
                    
                    // Production mode - Initialize Stripe
                    clientSecret = data.clientSecret;
                    
                    // Get Stripe public key (you'll need to provide this)
                    const stripePublicKey = 'pk_test_YOUR_PUBLIC_KEY'; // Replace with actual key
                    stripe = Stripe(stripePublicKey);
                    
                    elements = stripe.elements({ clientSecret });
                    paymentElement = elements.create('payment');
                    paymentElement.mount('#payment-element');
                    
                    paymentElement.on('ready', () => {
                        document.getElementById('submit-button').disabled = false;
                        document.getElementById('button-text').textContent = 'Pay ' + data.amountFormatted;
                    });
                    
                } catch (error) {
                    console.error('[CHECKOUT] Initialization error:', error);
                    document.getElementById('error-message').textContent = error.message;
                    document.getElementById('payment-element').innerHTML = \`
                        <div class="text-center text-red-500 py-6">
                            <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
                            <p>\${error.message}</p>
                            <a href="/event-details" class="inline-block mt-4 text-blue-500 hover:underline">
                                Go back and try again
                            </a>
                        </div>
                    \`;
                }
            }
            
            // Handle form submission
            document.getElementById('payment-form').addEventListener('submit', async (event) => {
                event.preventDefault();
                
                const submitButton = document.getElementById('submit-button');
                const buttonText = document.getElementById('button-text');
                const errorMessage = document.getElementById('error-message');
                
                submitButton.disabled = true;
                buttonText.innerHTML = '<i class="fas fa-spinner loading-spinner mr-2"></i>Processing...';
                errorMessage.textContent = '';
                
                try {
                    // Handle development mode mock payment
                    if (window.mockPaymentData) {
                        console.log('[CHECKOUT] Processing mock payment...');
                        
                        // Confirm mock payment
                        const confirmResponse = await fetch('/api/payment/confirm', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + authToken
                            },
                            body: JSON.stringify({
                                paymentIntentId: window.mockPaymentData.clientSecret,
                                bookingId: window.mockPaymentData.bookingId
                            })
                        });
                        
                        if (confirmResponse.ok) {
                            // Redirect to success page
                            window.location.href = '/checkout/mock-success?session_id=' + 
                                window.mockPaymentData.clientSecret + 
                                '&booking_id=' + window.mockPaymentData.bookingId + 
                                '&total=' + (window.mockPaymentData.amount / 100).toFixed(2);
                        } else {
                            throw new Error('Mock payment confirmation failed');
                        }
                        return;
                    }
                    
                    // Production mode - Confirm payment with Stripe
                    const { error } = await stripe.confirmPayment({
                        elements,
                        confirmParams: {
                            return_url: window.location.origin + '/booking-success'
                        }
                    });
                    
                    if (error) {
                        throw new Error(error.message);
                    }
                    
                } catch (error) {
                    console.error('[CHECKOUT] Payment error:', error);
                    errorMessage.textContent = error.message;
                    submitButton.disabled = false;
                    buttonText.innerHTML = '<i class="fas fa-lock mr-2"></i>Try Again';
                }
            });
            
            // Initialize on page load
            initializeCheckout();
        </script>
    </body>
    </html>
  `)
})

// Booking Success Page (after Stripe redirect)
app.get('/booking-success', async (c) => {
  const paymentIntentId = c.req.query('payment_intent')
  const { DB } = c.env
  
  // Update booking if we have a payment intent
  if (paymentIntentId && DB) {
    await DB.prepare(
      "UPDATE bookings SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE stripe_payment_intent_id = ?"
    ).bind(paymentIntentId).run()
  }
  
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
          .confetti {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 1000;
          }
        </style>
    </head>
    <body>
        <div class="confetti" id="confetti"></div>
        <div class="success-container" style="position: relative; z-index: 1001;">
            <i class="fas fa-check-circle success-icon"></i>
            <h1 class="text-4xl font-bold mt-6 mb-4" style="color: #22c55e;">
                Booking Confirmed!
            </h1>
            <p class="text-xl mb-6 text-gray-300">
                Your payment was successful and your booking is confirmed.
            </p>
            <div class="bg-gray-800 p-6 rounded-lg mb-6 text-left">
                <h3 class="text-lg font-bold mb-4" style="color: #FFD700;">What's Next?</h3>
                <ul class="space-y-3 text-gray-300">
                    <li><i class="fas fa-envelope text-green-500 mr-2"></i> Confirmation email sent to your inbox</li>
                    <li><i class="fas fa-calendar-check text-green-500 mr-2"></i> Your event date is reserved</li>
                    <li><i class="fas fa-user-tie text-green-500 mr-2"></i> Your DJ/Photobooth team has been notified</li>
                    <li><i class="fas fa-phone text-green-500 mr-2"></i> We'll contact you 1 week before your event</li>
                </ul>
            </div>
            <div class="flex gap-4 justify-center">
                <a href="/" class="inline-block px-8 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
                    <i class="fas fa-home mr-2"></i>Return Home
                </a>
            </div>
            <p class="text-sm text-gray-500 mt-6">
                Questions? Contact us at (816) 217-1094 or info@inthehouseproductions.com
            </p>
        </div>
        <script>
            // Simple confetti animation
            var colors = ['#E31E24', '#FFD700', '#22c55e', '#C0C0C0', '#FF0040'];
            var confettiContainer = document.getElementById('confetti');
            
            for (var i = 0; i < 100; i++) {
                var confetti = document.createElement('div');
                var color = colors[Math.floor(Math.random() * colors.length)];
                var left = Math.random() * 100;
                var animDuration = 2 + Math.random() * 3;
                var animDelay = Math.random() * 2;
                confetti.style.cssText = 'position: absolute; width: 10px; height: 10px; background: ' + color + '; left: ' + left + '%; top: -10px; animation: fall ' + animDuration + 's linear forwards; animation-delay: ' + animDelay + 's;';
                confettiContainer.appendChild(confetti);
            }
            
            var style = document.createElement('style');
            style.textContent = '@keyframes fall { to { transform: translateY(100vh) rotate(720deg); opacity: 0; } }';
            document.head.appendChild(style);
            
            // Clear localStorage booking data
            localStorage.removeItem('bookingData');
            localStorage.removeItem('bookingId');
        </script>
    </body>
    </html>
  `)
})

// Photobooth Page
app.get('/photobooth', (c) => {
  const baseUrl = 'https://www.inthehouseproductions.com'

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Photobooth Services - In The House Productions</title>

        ${generateMetaTags({
          title: 'Premium Photobooth Rentals - Weddings, Parties & Corporate Events',
          description: 'Professional photobooth rental services with instant sharing, custom backdrops, and unlimited prints. Perfect for weddings, parties, and corporate events. Starting at $500 for 4 hours.',
          canonical: '/photobooth',
          keywords: 'photobooth rental, photo booth, wedding photobooth, party photobooth, corporate photobooth, instant photo prints, photo booth props',
          ogImage: `${baseUrl}/static/photobooth-page-hero-3d.png`
        }, baseUrl)}

        ${generateServiceSchema({
          name: 'Premium Photobooth Rental Services',
          description: 'Professional photobooths with instant sharing, unlimited prints, and custom backdrops for all event types',
          price: '500.00',
          image: `${baseUrl}/static/photobooth-page-hero-3d.png`
        }, baseUrl)}

        ${generateBreadcrumbSchema([
          { name: 'Home', url: '/' },
          { name: 'Photobooth Services', url: '/photobooth' }
        ], baseUrl)}

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
            <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border:2px solid #FFD700;border-radius:16px;padding:24px;max-width:440px;width:92%;margin:0 auto;box-shadow:0 20px 60px rgba(220,20,60,0.5);animation:slideUp 0.3s ease;">
                <div id="proModalIcon" style="text-align:center;font-size:48px;margin-bottom:16px;"></div>
                <h2 id="proModalTitle" style="color:white;font-size:20px;font-weight:bold;text-align:center;margin-bottom:12px;"></h2>
                <p id="proModalMsg" style="color:#C0C0C0;font-size:15px;text-align:center;line-height:1.5;margin-bottom:20px;"></p>
                <div id="proModalBtns" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;"></div>
            </div>
        </div>
        <style>
        @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        #proModal.show{display:flex!important}
        .pro-btn{padding:12px 24px;min-height:48px;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:all 0.3s;text-transform:uppercase}
        .pro-btn-primary{background:linear-gradient(135deg,#DC143C,#ff1744);color:white}
        .pro-btn-primary:hover{box-shadow:0 6px 20px rgba(220,20,60,0.6);transform:translateY(-2px)}
        .pro-btn-secondary{background:linear-gradient(135deg,#555,#777);color:white}
        .pro-btn-secondary:hover{box-shadow:0 6px 20px rgba(192,192,192,0.4);transform:translateY(-2px)}
        </style>
        <div class="container mx-auto px-4 py-8">
            <!-- Header -->
            <div class="text-center mb-8">
                <img src="/static/photobooth-page-hero-3d.png" alt="SELECT YOUR PHOTOBOOTH" class="mx-auto mb-4" style="width: 100%; max-width: 480px; height: auto;">
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
          
          async function continueToCalendar() {
            // Store selected photobooth in localStorage
            localStorage.setItem('selectedPhotobooth', selectedPhotobooth);
            localStorage.setItem('serviceType', 'photobooth');
            // Clear any DJ selection
            localStorage.removeItem('selectedDJ');
            
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

// Mock Checkout Success Page (Development Mode)
app.get('/checkout/mock-success', async (c) => {
  const sessionId = c.req.query('session_id')
  const bookingId = c.req.query('booking_id')
  const total = c.req.query('total')
  
  // Mark booking as paid in development mode
  const { DB } = c.env
  if (bookingId && DB) {
    await DB.prepare(`
      UPDATE bookings 
      SET payment_status = 'paid', 
          status = 'confirmed'
      WHERE id = ?
    `).bind(bookingId).run()
  }
  
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
          .dev-badge {
            display: inline-block;
            background: #fbbf24;
            color: #000;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-weight: bold;
            margin-bottom: 1rem;
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
        </style>
    </head>
    <body>
        <div class="success-container">
            <div class="dev-badge">
                <i class="fas fa-flask mr-2"></i>
                DEVELOPMENT MODE - Mock Payment
            </div>
            <i class="fas fa-check-circle success-icon"></i>
            <h1 class="text-4xl font-bold mt-6 mb-4" style="color: #22c55e;">
                Booking Confirmed!
            </h1>
            <p class="text-xl mb-6 text-gray-300">
                Your mock payment was successful and your booking is confirmed.
            </p>
            <div class="bg-gray-800 p-4 rounded-lg mb-6 text-left">
                <h3 class="text-lg font-bold mb-2" style="color: #FFD700;">Booking Details:</h3>
                <p class="text-gray-300">Session ID: ${sessionId}</p>
                <p class="text-gray-300">Booking ID: ${bookingId}</p>
                <p class="text-gray-300">Total: $${total}</p>
                <p class="text-gray-300 mt-2">Status: <span style="color: #22c55e;">CONFIRMED</span></p>
            </div>
            <div class="bg-yellow-900 border-2 border-yellow-500 p-4 rounded-lg mb-6">
                <p class="text-sm text-yellow-200">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    <strong>Note:</strong> This is a mock payment for development/testing. 
                    No real charge was made. Add a real Stripe API key for production.
                </p>
            </div>
            <p class="text-lg mb-4 text-gray-400">
                <i class="fas fa-envelope mr-2"></i>
                In production, confirmation emails would be sent.
            </p>
            <p class="text-lg mb-8 text-gray-400">
                <i class="fas fa-sms mr-2"></i>
                In production, SMS notifications would be sent.
            </p>
            <a href="/" class="inline-block px-8 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
                <i class="fas fa-home mr-2"></i>
                RETURN HOME
            </a>
            <p class="text-sm text-gray-500 mt-6">
                Thank you for choosing In The House Productions!
            </p>
        </div>
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
  const version = Date.now() // Cache busting
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Login - In The House Productions</title>
        <link href="/static/ultra-3d.css?v=${version}" rel="stylesheet">
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
          console.log('[LOGIN PAGE] Sending login request...');
          const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
          const data = await response.json();
          console.log('[LOGIN PAGE] Response received:', { ok: response.ok, status: response.status, hasToken: !!data.token });
          
          if (response.ok) {
            console.log('[LOGIN PAGE] Login successful, saving token...');
            console.log('[LOGIN PAGE] Token length:', data.token ? data.token.length : 0);
            
            // Save token
            try {
              localStorage.setItem('authToken', data.token);
              localStorage.setItem('user', JSON.stringify(data.user));
              console.log('[LOGIN PAGE] Token saved to localStorage');
              
              // Verify immediately
              const savedToken = localStorage.getItem('authToken');
              console.log('[LOGIN PAGE] Verification - Token exists:', !!savedToken, 'Length:', savedToken ? savedToken.length : 0);
              
              if (!savedToken) {
                alert('ERROR: Token was not saved! Check console.');
                throw new Error('Failed to save token to localStorage');
              }
              
              console.log('[LOGIN PAGE] Token verified successfully!');
            } catch (storageError) {
              console.error('[LOGIN PAGE] localStorage error:', storageError);
              alert('Storage Error: ' + storageError.message);
              throw storageError;
            }
            
            messageEl.className = 'success-message p-3 rounded mb-4';
            messageEl.textContent = '✓ ' + data.message + ' Token saved! Redirecting...';
            messageEl.classList.remove('hidden');
            
            setTimeout(() => { 
              if (data.user.role === 'admin') { 
                window.location.href = '/admin'; 
              } else { 
                window.location.href = '/dj-services'; 
              } 
            }, 2000);
          } else {
            console.error('[LOGIN PAGE] Login failed:', data.error);
            messageEl.className = 'error-message p-3 rounded mb-4';
            messageEl.textContent = '✗ ' + (data.error || 'Login failed');
            messageEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>SIGN IN';
          }
        } catch (error) {
          console.error('[LOGIN PAGE] Network error:', error);
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

// ================================
// STRIPE PRODUCT MANAGEMENT
// ================================

// Complete service catalog for Stripe
const stripeServiceCatalog = {
  // DJ Services
  dj_party: {
    name: 'DJ Service - Party Package',
    description: 'Professional DJ services for parties. Up to 4 hours, sound equipment, extensive music library.',
    basePrice: 50000, baseHours: 4, hourlyRate: 10000,
    metadata: { service_type: 'dj', package_type: 'party' }
  },
  dj_wedding: {
    name: 'DJ Service - Wedding Package',
    description: 'Premium DJ services for weddings. Up to 5 hours, MC services, ceremony and reception music.',
    basePrice: 85000, baseHours: 5, hourlyRate: 10000,
    metadata: { service_type: 'dj', package_type: 'wedding' }
  },
  dj_additional_hour: {
    name: 'DJ Service - Additional Hour',
    description: 'Add extra hour to your DJ booking.',
    basePrice: 10000, isAddon: true,
    metadata: { service_type: 'dj', addon_type: 'additional_hour' }
  },
  // Photobooth Services
  photobooth_strips: {
    name: 'Photobooth - Unlimited Photo Strips',
    description: 'Professional photobooth with unlimited 2x6 prints. 4 hours, attendant, props, digital gallery.',
    basePrice: 50000, baseHours: 4, hourlyRate: 10000,
    metadata: { service_type: 'photobooth', print_type: 'strips' }
  },
  photobooth_4x6: {
    name: 'Photobooth - 4x6 Print Package',
    description: 'Professional photobooth with 4x6 prints. 4 hours, attendant, props, digital gallery.',
    basePrice: 55000, baseHours: 4, hourlyRate: 10000,
    metadata: { service_type: 'photobooth', print_type: '4x6' }
  },
  photobooth_additional_hour: {
    name: 'Photobooth - Additional Hour',
    description: 'Add extra hour to your Photobooth booking.',
    basePrice: 10000, isAddon: true,
    metadata: { service_type: 'photobooth', addon_type: 'additional_hour' }
  },
  // Add-on Services
  karaoke: {
    name: 'Karaoke Add-on',
    description: 'Add karaoke to your event! Karaoke system, wireless mics, thousands of songs.',
    basePrice: 10000, baseHours: 4, hourlyRate: 5000,
    metadata: { service_type: 'addon', addon_type: 'karaoke' }
  },
  karaoke_additional_hour: {
    name: 'Karaoke - Additional Hour',
    description: 'Add extra hour to Karaoke addon.',
    basePrice: 5000, isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'karaoke_hour' }
  },
  uplighting: {
    name: 'Uplighting Add-on',
    description: 'Professional LED uplighting. Up to 6 wireless lights, customizable colors.',
    basePrice: 10000, baseHours: 4, hourlyRate: 5000,
    metadata: { service_type: 'addon', addon_type: 'uplighting' }
  },
  uplighting_additional_hour: {
    name: 'Uplighting - Additional Hour',
    description: 'Add extra hour to Uplighting addon.',
    basePrice: 5000, isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'uplighting_hour' }
  },
  foam_pit: {
    name: 'Foam Pit Rental',
    description: 'Turn your event into a foam party! Professional foam machine, solution, setup and cleanup.',
    basePrice: 50000, baseHours: 4, hourlyRate: 10000,
    metadata: { service_type: 'addon', addon_type: 'foam_pit' }
  },
  foam_pit_additional_hour: {
    name: 'Foam Pit - Additional Hour',
    description: 'Add extra hour to Foam Pit rental.',
    basePrice: 10000, isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'foam_pit_hour' }
  }
}

// Admin API: Sync all products to Stripe
app.post('/api/admin/stripe/sync-products', async (c) => {
  try {
    // Verify admin authentication
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (payload.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403)
    }
    
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY
    if (!STRIPE_SECRET_KEY) {
      return c.json({ error: 'Stripe not configured' }, 500)
    }
    
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any
    })
    
    const results: any = {}
    
    // Get existing products
    const existingProducts = await stripe.products.list({ limit: 100, active: true })
    const existingMap = new Map(
      existingProducts.data.map(p => [p.metadata.service_key, p])
    )
    
    for (const [serviceKey, service] of Object.entries(stripeServiceCatalog)) {
      try {
        let product = existingMap.get(serviceKey)
        
        // Create product if not exists
        if (!product) {
          product = await stripe.products.create({
            name: service.name,
            description: service.description,
            active: true,
            metadata: {
              service_key: serviceKey,
              ...service.metadata
            }
          })
        }
        
        // Check for existing base price
        const existingPrices = await stripe.prices.list({
          product: product.id,
          active: true,
          limit: 10
        })
        
        let basePrice = existingPrices.data.find(p => 
          p.metadata.price_type === 'base' && p.unit_amount === service.basePrice
        )
        
        // Create base price if not exists
        if (!basePrice) {
          basePrice = await stripe.prices.create({
            product: product.id,
            unit_amount: service.basePrice,
            currency: 'usd',
            metadata: {
              price_type: 'base',
              service_key: serviceKey,
              base_hours: service.baseHours?.toString() || '0'
            }
          })
        }
        
        // Create hourly price if applicable
        let hourlyPrice = null
        if (service.hourlyRate) {
          hourlyPrice = existingPrices.data.find(p => 
            p.metadata.price_type === 'hourly'
          )
          
          if (!hourlyPrice) {
            hourlyPrice = await stripe.prices.create({
              product: product.id,
              unit_amount: service.hourlyRate,
              currency: 'usd',
              metadata: {
                price_type: 'hourly',
                service_key: serviceKey
              }
            })
          }
        }
        
        results[serviceKey] = {
          success: true,
          productId: product.id,
          basePriceId: basePrice.id,
          hourlyPriceId: hourlyPrice?.id || null,
          name: service.name,
          baseAmount: `$${(service.basePrice / 100).toFixed(2)}`,
          hourlyAmount: service.hourlyRate ? `$${(service.hourlyRate / 100).toFixed(2)}/hr` : null
        }
      } catch (error: any) {
        results[serviceKey] = {
          success: false,
          error: error.message
        }
      }
    }
    
    const successful = Object.values(results).filter((r: any) => r.success).length
    const failed = Object.values(results).filter((r: any) => !r.success).length
    
    return c.json({
      success: true,
      message: `Synced ${successful} products to Stripe${failed > 0 ? `, ${failed} failed` : ''}`,
      results
    })
    
  } catch (error: any) {
    console.error('Stripe sync error:', error)
    return c.json({ error: error.message || 'Stripe sync failed' }, 500)
  }
})

// Admin API: List Stripe products
app.get('/api/admin/stripe/products', async (c) => {
  try {
    // Verify admin authentication
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, getJWTSecret(c.env))
    
    if (payload.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403)
    }
    
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY
    if (!STRIPE_SECRET_KEY) {
      return c.json({ error: 'Stripe not configured' }, 500)
    }
    
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any
    })
    
    const products = await stripe.products.list({ limit: 100, active: true })
    const prices = await stripe.prices.list({ limit: 100, active: true })
    
    const productData = products.data.map(p => {
      const productPrices = prices.data.filter(pr => pr.product === p.id)
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        active: p.active,
        metadata: p.metadata,
        prices: productPrices.map(pr => ({
          id: pr.id,
          amount: `$${((pr.unit_amount || 0) / 100).toFixed(2)}`,
          type: pr.metadata.price_type || 'base'
        }))
      }
    })
    
    return c.json({
      success: true,
      count: products.data.length,
      products: productData
    })
    
  } catch (error: any) {
    console.error('Stripe products error:', error)
    return c.json({ error: error.message || 'Failed to fetch products' }, 500)
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

// ===== EMPLOYEE PORTAL PAGES =====

// Employee Login Page
app.get('/employee/login', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Employee Login - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
          :root {
            --primary-red: #E31E24;
            --deep-red: #8B0000;
            --chrome-silver: #C0C0C0;
          }
          body {
            background: #000;
            color: #fff;
            min-height: 100vh;
          }
          .form-group {
            margin-bottom: 1.5rem;
          }
          .form-label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 700;
            color: var(--chrome-silver);
          }
          .form-input {
            width: 100%;
            padding: 0.75rem 1rem;
            background: #1a1a1a;
            border: 2px solid var(--chrome-silver);
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
          }
          .form-input:focus {
            outline: none;
            border-color: var(--primary-red);
            box-shadow: 0 0 20px rgba(227, 30, 36, 0.5);
          }
          .btn-login {
            width: 100%;
            padding: 1rem;
            background: linear-gradient(180deg, #E31E24 0%, #8B0000 100%);
            border: 2px solid var(--chrome-silver);
            color: white;
            font-weight: 900;
            font-size: 1.1rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
            box-shadow: 0 5px 0 #660000, 0 8px 15px rgba(0, 0, 0, 0.5);
          }
          .btn-login:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 0 #660000, 0 10px 20px rgba(0, 0, 0, 0.6);
          }
          .btn-login:active {
            transform: translateY(3px);
            box-shadow: 0 2px 0 #660000, 0 3px 8px rgba(0, 0, 0, 0.5);
          }
        </style>
    </head>
    <body class="p-4">
        <div class="max-w-md mx-auto mt-12">
            <!-- Header -->
            <div class="text-center mb-8">
                <h1 class="text-3d-chrome text-3d-large mb-2">EMPLOYEE PORTAL</h1>
                <p class="text-3d-gold text-3d-small">In The House Productions</p>
            </div>
            
            <!-- Login Form -->
            <div class="bg-gray-900 p-8 rounded-xl border-2 border-chrome-silver shadow-2xl">
                <h2 class="text-2xl font-bold text-center mb-6 text-3d-gold">Login</h2>
                
                <form id="loginForm">
                    <div class="form-group">
                        <label class="form-label" for="email">
                            <i class="fas fa-envelope mr-2"></i>Email
                        </label>
                        <input 
                            type="email" 
                            id="email" 
                            class="form-input" 
                            placeholder="your.email@inthehouseproductions.com"
                            required
                        >
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="password">
                            <i class="fas fa-lock mr-2"></i>Password
                        </label>
                        <input 
                            type="password" 
                            id="password" 
                            class="form-input" 
                            placeholder="Enter your password"
                            required
                        >
                    </div>
                    
                    <button type="submit" class="btn-login">
                        <i class="fas fa-sign-in-alt mr-2"></i>
                        LOGIN
                    </button>
                </form>
                
                <div class="mt-6 text-center">
                    <a href="/" class="text-chrome-silver hover:text-primary-red text-sm">
                        <i class="fas fa-arrow-left mr-1"></i>
                        Back to Homepage
                    </a>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const email = document.getElementById('email').value
                const password = document.getElementById('password').value
                
                try {
                    const response = await fetch('/api/employee/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    })
                    
                    const data = await response.json()
                    
                    if (data.success) {
                        // Store token and employee data
                        localStorage.setItem('employeeToken', data.token)
                        localStorage.setItem('employeeData', JSON.stringify(data.employee))
                        
                        // Redirect to dashboard
                        window.location.href = '/employee/dashboard'
                    } else {
                        alert('Login failed: ' + (data.error || 'Unknown error'))
                    }
                } catch (error) {
                    console.error('Login error:', error)
                    alert('Login failed. Please try again.')
                }
            })
        </script>
    </body>
    </html>
  `)
})

// Employee Dashboard
app.get('/employee/dashboard', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Employee Dashboard - In The House Productions</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
          :root {
            --primary-red: #E31E24;
            --deep-red: #8B0000;
            --chrome-silver: #C0C0C0;
          }
          body {
            background: #000;
            color: #fff;
            min-height: 100vh;
          }
          .stat-card {
            background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
            border: 2px solid var(--chrome-silver);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 0 20px rgba(227, 30, 36, 0.3);
          }
          .section-card {
            background: #1a1a1a;
            border: 2px solid var(--chrome-silver);
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
          }
          .blocked-date-item {
            background: #2a2a2a;
            border: 1px solid var(--chrome-silver);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .blocked-date-item:hover {
            border-color: var(--primary-red);
            box-shadow: 0 0 15px rgba(227, 30, 36, 0.5);
          }
          .btn-danger {
            background: linear-gradient(180deg, #E31E24 0%, #8B0000 100%);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            border: 1px solid var(--chrome-silver);
            cursor: pointer;
            font-weight: 700;
          }
          .btn-danger:hover {
            box-shadow: 0 0 15px rgba(227, 30, 36, 0.8);
          }
          .btn-primary {
            background: linear-gradient(180deg, #FFD700 0%, #FFA500 100%);
            color: #000;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            border: 2px solid white;
            cursor: pointer;
            font-weight: 900;
            box-shadow: 0 5px 0 #CC8800, 0 8px 15px rgba(0, 0, 0, 0.5);
          }
          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 7px 0 #CC8800, 0 10px 20px rgba(0, 0, 0, 0.6);
          }
          .btn-secondary {
            background: #333;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            border: 1px solid var(--chrome-silver);
            cursor: pointer;
          }
          .form-input {
            width: 100%;
            padding: 0.75rem;
            background: #0a0a0a;
            border: 2px solid var(--chrome-silver);
            border-radius: 6px;
            color: #fff;
            margin-bottom: 1rem;
          }
          .form-input:focus {
            outline: none;
            border-color: var(--primary-red);
          }
        </style>
    </head>
    <body class="p-4">
        <!-- Header -->
        <div class="max-w-7xl mx-auto">
            <div class="flex justify-between items-center mb-8">
                <div>
                    <h1 class="text-3d-chrome text-3d-large">EMPLOYEE DASHBOARD</h1>
                    <p class="text-3d-gold text-xl" id="employeeName">Loading...</p>
                </div>
                <button onclick="logout()" class="btn-secondary">
                    <i class="fas fa-sign-out-alt mr-2"></i>Logout
                </button>
            </div>
            
            <!-- Stats Cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="stat-card">
                    <div class="text-chrome-silver text-sm mb-2">
                        <i class="fas fa-calendar-alt mr-2"></i>Upcoming Bookings
                    </div>
                    <div class="text-3d-gold text-3xl font-bold" id="upcomingCount">0</div>
                </div>
                <div class="stat-card">
                    <div class="text-chrome-silver text-sm mb-2">
                        <i class="fas fa-ban mr-2"></i>Blocked Dates
                    </div>
                    <div class="text-3d-red text-3xl font-bold" id="blockedCount">0</div>
                </div>
                <div class="stat-card">
                    <div class="text-chrome-silver text-sm mb-2">
                        <i class="fas fa-history mr-2"></i>Recent Changes
                    </div>
                    <div class="text-3d-chrome text-3xl font-bold" id="changesCount">0</div>
                </div>
            </div>
            
            <!-- Block New Date Section -->
            <div class="section-card">
                <h2 class="text-2xl font-bold mb-4 text-3d-gold">
                    <i class="fas fa-ban mr-2"></i>Block New Date
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input type="date" id="blockDate" class="form-input">
                    <input type="text" id="blockReason" class="form-input" placeholder="Reason (optional)">
                    <button onclick="blockDate()" class="btn-primary">
                        <i class="fas fa-plus mr-2"></i>BLOCK DATE
                    </button>
                </div>
            </div>
            
            <!-- Blocked Dates List -->
            <div class="section-card">
                <h2 class="text-2xl font-bold mb-4 text-3d-chrome">
                    <i class="fas fa-list mr-2"></i>Your Blocked Dates
                </h2>
                <div id="blockedDatesList">
                    <p class="text-gray-400">Loading...</p>
                </div>
            </div>
            
            <!-- Upcoming Bookings -->
            <div class="section-card">
                <h2 class="text-2xl font-bold mb-4 text-3d-chrome">
                    <i class="fas fa-calendar-check mr-2"></i>Upcoming Bookings
                </h2>
                <div id="bookingsList">
                    <p class="text-gray-400">Loading...</p>
                </div>
            </div>
            
            <!-- Recent Changes Log -->
            <div class="section-card">
                <h2 class="text-2xl font-bold mb-4 text-3d-chrome">
                    <i class="fas fa-history mr-2"></i>Your Recent Changes
                </h2>
                <div id="changeLogList">
                    <p class="text-gray-400">Loading...</p>
                </div>
            </div>
        </div>

        <script>
            const token = localStorage.getItem('employeeToken')
            const employeeData = JSON.parse(localStorage.getItem('employeeData') || '{}')
            
            if (!token) {
                window.location.href = '/employee/login'
            }
            
            // Set employee name
            document.getElementById('employeeName').textContent = employeeData.full_name || 'Employee'
            
            async function fetchWithAuth(url, options = {}) {
                return fetch(url, {
                    ...options,
                    headers: {
                        ...options.headers,
                        'Authorization': \`Bearer \${token}\`,
                        'Content-Type': 'application/json'
                    }
                })
            }
            
            async function loadDashboard() {
                // Load blocked dates
                const blockedRes = await fetchWithAuth('/api/employee/blocked-dates')
                const blockedData = await blockedRes.json()
                
                if (blockedData.success) {
                    document.getElementById('blockedCount').textContent = blockedData.blocked_dates.length
                    renderBlockedDates(blockedData.blocked_dates)
                }
                
                // Load bookings
                const bookingsRes = await fetchWithAuth('/api/employee/bookings')
                const bookingsData = await bookingsRes.json()
                
                if (bookingsData.success) {
                    const upcoming = bookingsData.bookings.filter(b => 
                        new Date(b.event_date) >= new Date()
                    )
                    document.getElementById('upcomingCount').textContent = upcoming.length
                    renderBookings(upcoming)
                }
                
                // Load change log
                const logRes = await fetchWithAuth('/api/employee/change-log?limit=10')
                const logData = await logRes.json()
                
                if (logData.success) {
                    document.getElementById('changesCount').textContent = logData.logs.length
                    renderChangeLog(logData.logs)
                }
            }
            
            function renderBlockedDates(dates) {
                const container = document.getElementById('blockedDatesList')
                
                if (dates.length === 0) {
                    container.innerHTML = '<p class="text-gray-400">No blocked dates</p>'
                    return
                }
                
                container.innerHTML = dates.map(date => \`
                    <div class="blocked-date-item">
                        <div>
                            <div class="font-bold text-primary-red">
                                <i class="fas fa-calendar-times mr-2"></i>
                                \${new Date(date.block_date).toLocaleDateString()}
                            </div>
                            <div class="text-sm text-gray-400">\${date.reason || 'No reason provided'}</div>
                        </div>
                        <button onclick="unblockDate(\${date.id})" class="btn-danger">
                            <i class="fas fa-trash mr-1"></i>Unblock
                        </button>
                    </div>
                \`).join('')
            }
            
            function renderBookings(bookings) {
                const container = document.getElementById('bookingsList')
                
                if (bookings.length === 0) {
                    container.innerHTML = '<p class="text-gray-400">No upcoming bookings</p>'
                    return
                }
                
                container.innerHTML = bookings.map(booking => \`
                    <div class="blocked-date-item">
                        <div>
                            <div class="font-bold text-chrome-silver">
                                <i class="fas fa-calendar mr-2"></i>
                                \${new Date(booking.event_date).toLocaleDateString()} - \${booking.event_name || 'Event'}
                            </div>
                            <div class="text-sm text-gray-400">
                                \${booking.event_type || 'Unknown'} | \${booking.city || ''}, \${booking.state || ''}
                            </div>
                            <div class="text-sm text-gray-400">
                                Time: \${booking.event_start_time} - \${booking.event_end_time}
                            </div>
                        </div>
                        <span class="px-3 py-1 rounded-full text-xs font-bold bg-green-900 text-green-300">
                            \${booking.status.toUpperCase()}
                        </span>
                    </div>
                \`).join('')
            }
            
            function renderChangeLog(logs) {
                const container = document.getElementById('changeLogList')
                
                if (logs.length === 0) {
                    container.innerHTML = '<p class="text-gray-400">No recent changes</p>'
                    return
                }
                
                container.innerHTML = logs.slice(0, 10).map(log => \`
                    <div class="text-sm mb-2 pb-2 border-b border-gray-700">
                        <div class="font-bold text-chrome-silver">
                            <i class="fas fa-history mr-2"></i>
                            \${log.action_type.replace('_', ' ').toUpperCase()}
                        </div>
                        <div class="text-gray-400">
                            \${log.target_date ? new Date(log.target_date).toLocaleDateString() : ''} 
                            \${log.reason || ''}
                        </div>
                        <div class="text-xs text-gray-500">
                            \${new Date(log.created_at).toLocaleString()}
                        </div>
                    </div>
                \`).join('')
            }
            
            async function blockDate() {
                const date = document.getElementById('blockDate').value
                const reason = document.getElementById('blockReason').value
                
                if (!date) {
                    alert('Please select a date')
                    return
                }
                
                try {
                    const response = await fetchWithAuth('/api/employee/block-date', {
                        method: 'POST',
                        body: JSON.stringify({ date, reason })
                    })
                    
                    const data = await response.json()
                    
                    if (data.success) {
                        alert('Date blocked successfully!')
                        document.getElementById('blockDate').value = ''
                        document.getElementById('blockReason').value = ''
                        loadDashboard()
                    } else {
                        alert('Failed to block date: ' + (data.error || 'Unknown error'))
                    }
                } catch (error) {
                    console.error('Block date error:', error)
                    alert('Failed to block date')
                }
            }
            
            async function unblockDate(blockId) {
                if (!confirm('Are you sure you want to unblock this date?')) {
                    return
                }
                
                try {
                    const response = await fetchWithAuth(\`/api/employee/unblock-date/\${blockId}\`, {
                        method: 'DELETE'
                    })
                    
                    const data = await response.json()
                    
                    if (data.success) {
                        alert('Date unblocked successfully!')
                        loadDashboard()
                    } else {
                        alert('Failed to unblock date: ' + (data.error || 'Unknown error'))
                    }
                } catch (error) {
                    console.error('Unblock date error:', error)
                    alert('Failed to unblock date')
                }
            }
            
            async function logout() {
                try {
                    await fetchWithAuth('/api/employee/logout', { method: 'POST' })
                } catch (error) {
                    console.error('Logout error:', error)
                }
                
                localStorage.removeItem('employeeToken')
                localStorage.removeItem('employeeData')
                window.location.href = '/employee/login'
            }
            
            // Initialize dashboard
            loadDashboard()
        </script>
    </body>
    </html>
  `)
})

// Diagnostic Tool Page
app.get('/diagnostic', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Session Diagnostic Tool</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-black text-white p-4 md:p-8">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-2xl md:text-3xl font-bold mb-8 text-center">🔍 Session Diagnostic Tool</h1>
            
            <div id="diagnosticResults" class="space-y-4"></div>
            
            <button onclick="runDiagnostics()" class="mt-8 bg-red-600 text-white px-8 py-4 rounded-lg font-bold w-full hover:bg-red-700">
                🔄 RUN FULL DIAGNOSTIC
            </button>
            
            <div class="mt-4 text-center text-sm text-gray-400">
                <p>This tool will test your login session and show all results visibly on screen.</p>
                <p class="mt-2">Take a screenshot of the results and send them to support.</p>
            </div>
        </div>
        
        <script>
          function displayResult(title, value, status) {
            const color = status === 'success' ? 'green' : status === 'error' ? 'red' : 'yellow';
            const icon = status === 'success' ? '✅' : status === 'error' ? '❌' : '⚠️';
            return \`
              <div class="bg-gray-900 p-4 rounded-lg border-2 border-\${color}-500">
                <div class="font-bold text-\${color}-400 mb-2">\${icon} \${title}</div>
                <div class="text-sm font-mono break-all whitespace-pre-wrap">\${value}</div>
              </div>
            \`;
          }
          
          async function runDiagnostics() {
            const container = document.getElementById('diagnosticResults');
            container.innerHTML = '<div class="text-center text-yellow-400 text-xl">⏳ Running diagnostics...</div>';
            
            let html = '';
            
            // Check 1: Token in localStorage
            const token = localStorage.getItem('authToken');
            html += displayResult(
              '1. Token in localStorage',
              token ? \`✅ Found\\nLength: \${token.length} characters\\nPreview: \${token.substring(0, 100)}...\` : '❌ NOT FOUND - You need to login first!',
              token ? 'success' : 'error'
            );
            
            // Check 2: User data in localStorage
            const user = localStorage.getItem('user');
            html += displayResult(
              '2. User data in localStorage',
              user ? \`✅ Found:\\n\${user}\` : '❌ NOT FOUND',
              user ? 'success' : 'error'
            );
            
            // Check 3: Token format
            if (token) {
              const validFormat = token.startsWith('eyJ');
              html += displayResult(
                '3. Token format validation',
                validFormat ? '✅ Valid JWT format (starts with eyJ)' : '❌ INVALID FORMAT - Token is corrupted',
                validFormat ? 'success' : 'error'
              );
              
              // Check 4: Test token with /api/auth/me
              try {
                console.log('Testing /api/auth/me endpoint...');
                const meResponse = await fetch('/api/auth/me', {
                  headers: { 'Authorization': \`Bearer \${token}\` }
                });
                const meData = await meResponse.json();
                html += displayResult(
                  '4. Token validation test (/api/auth/me)',
                  \`HTTP Status: \${meResponse.status}\\n\\nResponse:\\n\${JSON.stringify(meData, null, 2)}\`,
                  meResponse.ok ? 'success' : 'error'
                );
              } catch (error) {
                html += displayResult(
                  '4. Token validation test (/api/auth/me)',
                  \`❌ Error: \${error.message}\`,
                  'error'
                );
              }
              
              // Check 5: Test booking endpoint (without actually creating a booking)
              try {
                console.log('Testing booking endpoint auth...');
                const bookingResponse = await fetch('/api/bookings/create', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': \`Bearer \${token}\`
                  },
                  body: JSON.stringify({
                    serviceType: 'dj',
                    serviceProvider: 'dj_cease',
                    eventDate: '2026-02-01',
                    startTime: '18:00',
                    endTime: '22:00',
                    eventDetails: {
                      eventName: 'Diagnostic Test',
                      eventType: 'test',
                      venueName: 'Test Venue',
                      venueAddress: '123 Test St',
                      venueCity: 'Test City',
                      venueState: 'FL',
                      venueZip: '12345',
                      expectedGuests: 50,
                      specialRequests: 'This is a diagnostic test'
                    }
                  })
                });
                const bookingData = await bookingResponse.json();
                
                let statusText = '';
                if (bookingResponse.status === 401) {
                  statusText = '❌ AUTHENTICATION FAILED - This is the bug!';
                } else if (bookingResponse.ok) {
                  statusText = '✅ Authentication passed (booking endpoint accepts token)';
                } else {
                  statusText = \`⚠️  Other error (status \${bookingResponse.status})\`;
                }
                
                html += displayResult(
                  '5. Booking endpoint auth test',
                  \`\${statusText}\\n\\nHTTP Status: \${bookingResponse.status}\\n\\nResponse:\\n\${JSON.stringify(bookingData, null, 2)}\`,
                  bookingResponse.status === 401 ? 'error' : (bookingResponse.ok ? 'success' : 'warning')
                );
              } catch (error) {
                html += displayResult(
                  '5. Booking endpoint auth test',
                  \`❌ Error: \${error.message}\`,
                  'error'
                );
              }
            } else {
              html += displayResult(
                '3-5. Remaining tests skipped',
                '⚠️  No token found in localStorage\\n\\nPlease login first at /login then come back to this page',
                'warning'
              );
            }
            
            // Summary
            html += \`
              <div class="mt-8 p-6 bg-blue-900 rounded-lg">
                <h3 class="text-xl font-bold mb-4">📋 Diagnostic Summary</h3>
                <p class="mb-2"><strong>What to do next:</strong></p>
                <ol class="list-decimal list-inside space-y-2 text-sm">
                  <li>Take a screenshot of this entire page</li>
                  <li>Send the screenshot to support</li>
                  <li>Support will identify the exact issue and provide a fix</li>
                </ol>
                <p class="text-sm text-gray-300 mt-4">Test Time: \${new Date().toISOString()}</p>
                <p class="text-sm text-gray-300">Test URL: \${window.location.href}</p>
              </div>
            \`;
            
            container.innerHTML = html;
          }
          
          // Auto-run on load
          window.addEventListener('DOMContentLoaded', runDiagnostics);
        </script>
    </body>
    </html>
  `)
})

export default app
