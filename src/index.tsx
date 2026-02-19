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
  sanitizeInput,
  escapeHtml
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
  securityHeaders
} from './security-middleware'
import {
  generateSkipLinks,
  generateAriaLiveRegion,
  generateFocusStyles,
  generateAccessibilityJS
} from './accessibility-helpers'
import { requireAdmin, requireAuth } from './middleware/admin-auth'
import { csrfProtection } from './middleware/csrf'
import { d1RateLimit } from './middleware/d1-rate-limit'
import passwordResetRoutes from './routes/password-reset'
import emailVerificationRoutes from './routes/email-verification'
import cancellationRoutes from './routes/cancellation'
import { generateImageObserverScript, generateImageOptimizationCSS } from './helpers/image-optimizer'
import type { Bindings } from './types'

// ===== REFERSION AFFILIATE TRACKING INTEGRATION =====
// Documentation: https://www.refersion.dev/reference/javascript-v4-tracking
// 
// How Refersion Affiliate Tracking Works:
// 1. TRACKING PIXEL: Added to ALL pages to track when visitors arrive via affiliate links
//    - Reads URL parameters like ?rfsn=12345.abcde or ?ref=affiliate_code
//    - Stores affiliate attribution in cookies for 30-90 days (configurable in Refersion dashboard)
// 
// 2. CONVERSION TRACKING: Added to success/thank-you pages to record sales
//    - Sends the cart_id (order ID) to Refersion when a purchase is completed
//    - Refersion matches the cart_id with the affiliate who referred the customer
//    - Commission is calculated based on your offer settings
//
// SETUP REQUIRED:
// 1. Create a Refersion account at https://www.refersion.com
// 2. Get your PUBLIC KEY from Account > Settings > API Keys
// 3. Add REFERSION_PUBLIC_KEY to your Cloudflare environment variables:
//    - For production: npx wrangler secret put REFERSION_PUBLIC_KEY
//    - For local dev: Add to .dev.vars file
// 4. Connect Stripe in Refersion dashboard for automatic commission tracking

// Generates the Refersion tracking pixel for all pages
// This MUST be on every page to properly track affiliate referrals
function generateRefersionTrackingScript(publicKey?: string): string {
  if (!publicKey) {
    return '<!-- Refersion tracking: Set REFERSION_PUBLIC_KEY environment variable to enable -->';
  }
  
  return `
    <!-- Refersion Affiliate Tracking Pixel v4 -->
    <!-- Tracks affiliate referrals from URL parameters: ?rfsn=xxx or ?ref=xxx -->
    <script>
      (function(d,t) {
        var g = d.createElement(t),
            s = d.getElementsByTagName(t)[0];
        g.src = "https://cdn.refersion.com/pixel.js";
        g.setAttribute("data-refersion-pubkey", "${publicKey}");
        g.async = true;
        s.parentNode.insertBefore(g, s);
      }(document, "script"));
    </script>
  `;
}

// Generates conversion tracking code for thank you/confirmation pages
// This records the sale and attributes it to the referring affiliate
function generateRefersionConversionScript(publicKey?: string, cartId?: string, cartValue?: number): string {
  if (!publicKey) {
    return '<!-- Refersion conversion: Set REFERSION_PUBLIC_KEY environment variable to enable -->';
  }
  
  // cartId should be a unique order identifier (booking ID, Stripe payment intent, etc.)
  // cartValue is the order total in dollars (optional but recommended for accurate commission calculation)
  const cartIdValue = cartId || '';
  const cartValueCode = cartValue ? `_refersion_cart_value = ${cartValue};` : '';
  
  return `
    <!-- Refersion Conversion Tracking -->
    <!-- Records completed purchase and attributes to referring affiliate -->
    <script>
      window._refersion = function() {
        _refersion_cart = "${cartIdValue}";
        ${cartValueCode}
      };
    </script>
  `;
}

const app = new Hono<{ Bindings: Bindings }>()

// Apply security headers to all routes (Zero-Trust Security)
app.use('*', securityHeaders)

// Enable CORS
app.use('/api/*', cors())

// CSRF protection for state-changing requests
app.use('/api/*', csrfProtection)

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// D1-backed rate limiting with progressive lockout
app.use('/api/auth/login', d1RateLimit(5, 60000, 15)) // 5 requests per minute, lockout after 15 failures
app.use('/api/auth/register', d1RateLimit(3, 60000)) // 3 registrations per minute
app.use('/api/auth/forgot-password', d1RateLimit(3, 300000)) // 3 resets per 5 minutes

// Add rate limiting to API endpoints
app.use('/api/*', d1RateLimit(100, 60000)) // 100 requests per minute for general API

// Admin route protection - require JWT with admin role
app.use('/api/admin/*', requireAdmin)

// Mount new feature routes
app.route('/', passwordResetRoutes)
app.route('/', emailVerificationRoutes)
app.route('/', cancellationRoutes)

// SEO Routes
// Favicon - inline SVG to prevent 404
app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#E31E24"/><text x="16" y="24" text-anchor="middle" font-size="22" font-weight="bold" fill="white" font-family="Arial">H</text></svg>`
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=604800, immutable'
    }
  })
})

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
    console.error('Registration error:', error)
    return c.json({ error: 'Registration failed' }, 500)
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
    console.error('Login error:', error)
    return c.json({ error: 'Login failed' }, 500)
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
    
    // Require setup key from environment (falls back to default for backwards compat)
    const SETUP_KEY = c.env?.SETUP_KEY || 'InTheHouse2026!'
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
    return c.json({ error: 'Password reset failed' }, 500)
  }
})

// Reset employee passwords (converts bcrypt seeds to PBKDF2)
app.post('/api/setup/reset-employees', async (c) => {
  const { DB } = c.env
  
  try {
    const body = await c.req.json()
    const { setup_key } = body
    
    const SETUP_KEY = c.env?.SETUP_KEY || 'InTheHouse2026!'
    if (setup_key !== SETUP_KEY) {
      return c.json({ error: 'Invalid setup key' }, 403)
    }
    
    // Get all employees
    const employees = await DB.prepare(`SELECT id, email, full_name FROM employees WHERE is_active = 1`).all()
    
    // Hash the default password with PBKDF2 (from env or fallback)
    const defaultPassword = c.env?.DEFAULT_EMPLOYEE_PASSWORD || 'Employee123!'
    const newHash = await hashPassword(defaultPassword)
    
    // Update all employees with the new PBKDF2 hash
    let updated = 0
    for (const emp of (employees.results || [])) {
      await DB.prepare(`UPDATE employees SET password_hash = ? WHERE id = ?`).bind(newHash, (emp as any).id).run()
      updated++
    }
    
    return c.json({
      success: true,
      message: `Reset ${updated} employee passwords to PBKDF2 format`,
      updated
    })
  } catch (error: any) {
    return c.json({ error: 'Failed to reset employee passwords' }, 500)
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
    
    // Require setup key from environment (can be changed or removed in production)
    const SETUP_KEY = c.env?.SETUP_KEY || 'InTheHouse2026!'
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
    return c.json({ error: 'Admin setup failed' }, 500)
  }
})

// ===== STRIPE SETUP (Create all products in Stripe) =====

// Service catalog for Stripe products
const stripeServiceCatalog = {
  dj_party: {
    name: 'DJ Service - Party Package',
    description: 'Professional DJ services for parties and events. Includes up to 4 hours of entertainment, professional sound equipment, and extensive music library.',
    category: 'dj',
    basePrice: 50000, // $500.00 in cents
    baseHours: 4,
    hourlyRate: 10000,
    metadata: { service_type: 'dj', package_type: 'party', includes: 'Sound system, DJ equipment, music library' }
  },
  dj_wedding: {
    name: 'DJ Service - Wedding Package',
    description: 'Premium DJ services specifically designed for weddings. Includes up to 5 hours, MC services, ceremony music, cocktail hour, reception, and special event announcements.',
    category: 'dj',
    basePrice: 85000, // $850.00 in cents
    baseHours: 5,
    hourlyRate: 10000,
    metadata: { service_type: 'dj', package_type: 'wedding', includes: 'MC services, ceremony music, cocktail hour, reception' }
  },
  dj_additional_hour: {
    name: 'DJ Service - Additional Hour',
    description: 'Add extra hour to your DJ booking.',
    category: 'dj',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: { service_type: 'dj', addon_type: 'additional_hour' }
  },
  photobooth_strips: {
    name: 'Photobooth - Unlimited Photo Strips',
    description: 'Professional photobooth service with unlimited 2x6 photo strip prints. Includes 4 hours, on-site attendant, props, custom backdrop, and digital gallery.',
    category: 'photobooth',
    basePrice: 50000, // $500.00 in cents
    baseHours: 4,
    hourlyRate: 10000,
    metadata: { service_type: 'photobooth', print_type: 'strips', includes: 'Unlimited prints, props, backdrop, digital gallery' }
  },
  photobooth_4x6: {
    name: 'Photobooth - 4x6 Print Package',
    description: 'Professional photobooth service with 4x6 prints. Includes 4 hours, on-site attendant, props, custom backdrop, and digital gallery.',
    category: 'photobooth',
    basePrice: 55000, // $550.00 in cents
    baseHours: 4,
    hourlyRate: 10000,
    metadata: { service_type: 'photobooth', print_type: '4x6', includes: '4x6 prints, props, backdrop, digital gallery' }
  },
  photobooth_additional_hour: {
    name: 'Photobooth - Additional Hour',
    description: 'Add extra hour to your Photobooth booking.',
    category: 'photobooth',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: { service_type: 'photobooth', addon_type: 'additional_hour' }
  },
  karaoke: {
    name: 'Karaoke Add-on',
    description: 'Add karaoke to your DJ event! Includes karaoke system, song library with thousands of tracks, wireless microphones, and on-screen lyrics display.',
    category: 'addon',
    basePrice: 10000, // $100.00 for 4hr event
    baseHours: 4,
    hourlyRate: 5000,
    metadata: { service_type: 'addon', addon_type: 'karaoke', includes: 'Karaoke system, microphones, song library' }
  },
  karaoke_additional_hour: {
    name: 'Karaoke - Additional Hour',
    description: 'Add extra hour to your Karaoke addon.',
    category: 'addon',
    basePrice: 5000, // $50.00 in cents
    isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'karaoke_additional_hour' }
  },
  uplighting: {
    name: 'Uplighting Add-on',
    description: 'Professional LED uplighting to transform your venue. Includes up to 6 wireless LED uplights with customizable colors.',
    category: 'addon',
    basePrice: 10000, // $100.00 for 4hr event
    baseHours: 4,
    hourlyRate: 5000,
    metadata: { service_type: 'addon', addon_type: 'uplighting', includes: '6 wireless LED uplights, color customization' }
  },
  uplighting_additional_hour: {
    name: 'Uplighting - Additional Hour',
    description: 'Add extra hour to your Uplighting addon.',
    category: 'addon',
    basePrice: 5000, // $50.00 in cents
    isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'uplighting_additional_hour' }
  },
  foam_pit: {
    name: 'Foam Pit Rental',
    description: 'Turn your event into an unforgettable foam party! Includes professional foam machine, foam solution for 4 hours, setup, and cleanup.',
    category: 'addon',
    basePrice: 50000, // $500.00 for 4hr event
    baseHours: 4,
    hourlyRate: 10000,
    metadata: { service_type: 'addon', addon_type: 'foam_pit', includes: 'Foam machine, foam solution, setup, cleanup' }
  },
  foam_pit_additional_hour: {
    name: 'Foam Pit - Additional Hour',
    description: 'Add extra hour to your Foam Pit rental.',
    category: 'addon',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: { service_type: 'addon', addon_type: 'foam_pit_additional_hour' }
  }
}

// Admin endpoint to setup all Stripe products
app.post('/api/setup/stripe-products', async (c) => {
  const { STRIPE_SECRET_KEY } = c.env
  
  try {
    const body = await c.req.json()
    const { setup_key } = body
    
    // Require setup key from environment
    const SETUP_KEY = c.env?.SETUP_KEY || 'InTheHouse2026!'
    if (setup_key !== SETUP_KEY) {
      return c.json({ error: 'Invalid setup key' }, 403)
    }
    
    // Check if Stripe is configured
    if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock') || STRIPE_SECRET_KEY.includes('Mock')) {
      return c.json({ 
        error: 'Stripe not configured',
        message: 'STRIPE_SECRET_KEY is not set or is a mock key. Please configure your Stripe API key in Cloudflare Pages secrets.'
      }, 400)
    }
    
    // Initialize Stripe
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' })
    
    // Verify Stripe connection
    let accountInfo
    try {
      accountInfo = await stripe.accounts.retrieve()
    } catch (e: any) {
      return c.json({ error: 'Failed to connect to Stripe', details: e.message }, 500)
    }
    
    const results: Record<string, any> = {}
    const errors: string[] = []
    
    // Get existing products to avoid duplicates
    const existingProducts = await stripe.products.list({ limit: 100, active: true })
    const existingByKey = new Map(
      existingProducts.data
        .filter(p => p.metadata.service_key)
        .map(p => [p.metadata.service_key, p])
    )
    
    for (const [serviceKey, service] of Object.entries(stripeServiceCatalog)) {
      try {
        let product = existingByKey.get(serviceKey)
        
        // Create product if not exists
        if (!product) {
          product = await stripe.products.create({
            name: service.name,
            description: service.description,
            active: true,
            metadata: {
              service_key: serviceKey,
              category: service.category,
              ...service.metadata
            }
          })
        }
        
        // Check existing prices
        const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 10 })
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
              base_hours: String(service.baseHours || 0)
            }
          })
        }
        
        // Create hourly price if applicable
        let hourlyPrice = null
        if (service.hourlyRate) {
          hourlyPrice = existingPrices.data.find(p => 
            p.metadata.price_type === 'hourly' && p.unit_amount === service.hourlyRate
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
          productId: product.id,
          productName: service.name,
          basePriceId: basePrice.id,
          baseAmount: `$${(service.basePrice / 100).toFixed(2)}`,
          hourlyPriceId: hourlyPrice?.id || null,
          hourlyAmount: service.hourlyRate ? `$${(service.hourlyRate / 100).toFixed(2)}/hr` : null,
          status: existingByKey.has(serviceKey) ? 'existing' : 'created'
        }
        
      } catch (e: any) {
        errors.push(`${serviceKey}: ${e.message}`)
        results[serviceKey] = { error: e.message }
      }
    }
    
    const successCount = Object.values(results).filter((r: any) => !r.error).length
    const errorCount = errors.length
    
    return c.json({
      success: true,
      message: `Stripe setup complete: ${successCount} products configured, ${errorCount} errors`,
      account: {
        id: accountInfo.id,
        name: accountInfo.business_profile?.name || 'N/A',
        chargesEnabled: accountInfo.charges_enabled
      },
      products: results,
      errors: errors.length > 0 ? errors : undefined
    })
    
  } catch (error: any) {
    console.error('Stripe setup error:', error)
    return c.json({ error: 'Stripe setup failed' }, 500)
  }
})

// Get Stripe public configuration (publishable key for frontend)
app.get('/api/stripe/config', (c) => {
  const publishableKey = c.env?.STRIPE_PUBLISHABLE_KEY
  
  if (!publishableKey || publishableKey.includes('YOUR_') || publishableKey.includes('not_configured')) {
    return c.json({ 
      publishableKey: 'not_configured',
      message: 'Stripe publishable key not configured. Add STRIPE_PUBLISHABLE_KEY to environment variables.'
    })
  }
  
  return c.json({ 
    publishableKey,
    mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test'
  })
})

// ===== REFERSION AFFILIATE TRACKING API =====

// Get Refersion configuration status
app.get('/api/refersion/config', (c) => {
  const publicKey = c.env?.REFERSION_PUBLIC_KEY
  
  return c.json({
    configured: !!publicKey && publicKey.length > 0,
    hasPublicKey: !!publicKey,
    trackingEnabled: !!publicKey,
    setupInstructions: !publicKey ? {
      step1: 'Create a Refersion account at https://www.refersion.com',
      step2: 'Get your PUBLIC KEY from Account > Settings > API Keys',
      step3: 'Add REFERSION_PUBLIC_KEY to Cloudflare environment: npx wrangler secret put REFERSION_PUBLIC_KEY',
      step4: 'Connect your Stripe account in Refersion dashboard for automatic commission tracking',
      docsUrl: 'https://www.refersion.dev/reference/javascript-v4-tracking'
    } : null,
    features: {
      visitorTracking: 'Tracks affiliate referrals from URL parameters (?rfsn=xxx or ?ref=xxx)',
      conversionTracking: 'Records completed bookings on success pages',
      stripeIntegration: 'Can connect with Stripe for automatic commission calculation'
    }
  })
})

// Refersion webhook endpoint (for receiving notifications from Refersion)
app.post('/api/refersion/webhook', async (c) => {
  try {
    const payload = await c.req.json()
    
    // Process webhook (in production, verify signature)
    
    // Process different webhook event types
    const eventType = payload.type || payload.event_type
    
    switch(eventType) {
      case 'conversion.created':
        // A new conversion was recorded
        break
      case 'conversion.approved':
        // Conversion was approved for commission
        break
      case 'affiliate.created':
        // New affiliate signed up
        break
      default:
        // Unknown event type - no action needed
    }
    
    return c.json({ received: true, eventType })
  } catch (error: any) {
    console.error('Refersion webhook error:', error)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// Get Stripe products status
app.get('/api/setup/stripe-status', async (c) => {
  const { STRIPE_SECRET_KEY } = c.env
  
  if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock') || STRIPE_SECRET_KEY.includes('Mock')) {
    return c.json({ 
      configured: false,
      mode: 'development',
      message: 'Stripe is in mock/development mode. Real Stripe API key not configured.'
    })
  }
  
  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' })
    const account = await stripe.accounts.retrieve()
    const products = await stripe.products.list({ limit: 100, active: true })
    
    const ithpProducts = products.data.filter(p => p.metadata.service_key)
    
    return c.json({
      configured: true,
      mode: STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test',
      account: {
        id: account.id,
        name: account.business_profile?.name || 'N/A',
        email: account.email,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled
      },
      products: {
        total: products.data.length,
        ithpProducts: ithpProducts.length,
        list: ithpProducts.map(p => ({
          id: p.id,
          name: p.name,
          serviceKey: p.metadata.service_key,
          active: p.active
        }))
      }
    })
  } catch (error: any) {
    return c.json({ 
      configured: true, 
      error: error.message,
      message: 'Stripe API key configured but connection failed'
    }, 500)
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
    return c.json({ error: 'Login failed' }, 500)
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
    return c.json({ error: 'Failed to block date' }, 500)
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DJ Profile Editor - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
    
    // Validate hours (minHours defaults to baseHours if not set)
    const minRequired = service.minHours || service.baseHours || 1
    if (hours < minRequired) {
      return c.json({ error: `Minimum ${minRequired} hours required` }, 400)
    }
    
    // Calculate price: base price covers baseHours, then hourlyRate for extra hours
    const additionalHours = Math.max(0, hours - (service.baseHours || hours))
    const subtotal = service.basePrice + (service.hourlyRate * additionalHours)
    
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
    
    // Detect wedding event type from eventDetails or booking record
    const eventType = eventDetails?.eventDetails?.eventType?.toLowerCase() 
      || eventDetails?.eventType?.toLowerCase() 
      || ''
    const isWeddingEvent = eventType.includes('wedding')
    
    for (const item of items) {
      // CRITICAL: For wedding events with DJ service, use wedding pricing tier
      let serviceKey = item.serviceId as keyof typeof servicePricing
      if (isWeddingEvent && item.serviceType === 'dj' && !item.serviceId?.includes('wedding')) {
        serviceKey = 'dj_wedding' as keyof typeof servicePricing
      }
      
      let service = servicePricing[serviceKey]
      if (!service) {
        // Fallback to original serviceId
        service = servicePricing[item.serviceId as keyof typeof servicePricing]
      }
      if (!service) {
        return c.json({ error: `Invalid service: ${item.serviceId}` }, 400)
      }
      
      const hours = item.hours || service.baseHours || 4
      const basePrice = service.basePrice
      const hourlyRate = service.hourlyRate || 0
      const baseHours = service.baseHours || 4
      
      // Calculate: base price + additional hours beyond base package
      const additionalHours = Math.max(0, hours - baseHours)
      let itemTotal = basePrice + (additionalHours * hourlyRate)
      
      // Convert to cents
      const itemTotalCents = itemTotal * 100
      totalAmount += itemTotalCents
      
      lineItems.push({
        serviceId: item.serviceId,
        serviceName: isWeddingEvent && item.serviceType === 'dj' ? 'DJ Wedding Package' : service.name,
        hours: hours,
        basePrice: basePrice,
        hourlyRate: hourlyRate,
        subtotal: itemTotal,
        subtotalCents: itemTotalCents
      })
    }
    
    // Get Stripe API key
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY
    const isDevelopmentMode = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock') || STRIPE_SECRET_KEY.includes('Mock')
    
    // DEVELOPMENT MODE: Return mock client secret
    if (isDevelopmentMode) {
      // Create booking in pending state
      let newBookingId = bookingId
      if (!bookingId && eventDetails && DB) {
        // Get start/end times from eventDetails or use defaults
        const startTime = eventDetails.startTime || eventDetails.start_time || items[0]?.startTime || '18:00:00'
        const endTime = eventDetails.endTime || eventDetails.end_time || items[0]?.endTime || '23:00:00'
        const eventDate = eventDetails.date || eventDetails.eventDate || items[0]?.eventDate || items[0]?.date
        
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
    if (!bookingId && eventDetails && DB) {
      const prodStartTime = eventDetails.startTime || eventDetails.start_time || items[0]?.startTime || '18:00:00'
      const prodEndTime = eventDetails.endTime || eventDetails.end_time || items[0]?.endTime || '23:00:00'
      const prodEventDate = eventDetails.date || eventDetails.eventDate || items[0]?.eventDate || items[0]?.date
      
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
    return c.json({ error: 'Failed to create payment' }, 500)
  }
})

// Confirm Payment - Handle webhook from Stripe
app.post('/api/payment/confirm', async (c) => {
  try {
    const { paymentIntentId, bookingId } = await c.req.json()
    const { DB } = c.env
    
    let isWedding = false
    
    // Update booking status
    if (bookingId) {
      // Get booking details for creating time slot
      const booking = await DB.prepare(`
        SELECT b.id, b.service_type, b.service_provider, b.event_date, 
               b.event_start_time, b.event_end_time, b.total_price,
               e.event_type
        FROM bookings b
        LEFT JOIN event_details e ON b.id = e.booking_id
        WHERE b.id = ?
      `).bind(bookingId).first() as any
      
      await DB.prepare(`
        UPDATE bookings 
        SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now')
        WHERE id = ?
      `).bind(bookingId).run()
      
      // CRITICAL: Create time slot NOW that payment is confirmed (blocks the calendar)
      if (booking && !booking.service_type?.startsWith('photobooth')) {
        // Check if slot already exists
        const existingSlot = await DB.prepare(`
          SELECT id FROM booking_time_slots WHERE booking_id = ?
        `).bind(bookingId).first()
        
        if (!existingSlot) {
          await DB.prepare(`
            INSERT INTO booking_time_slots (
              booking_id, service_provider, event_date, start_time, end_time, status
            ) VALUES (?, ?, ?, ?, ?, 'confirmed')
          `).bind(
            bookingId,
            booking.service_provider,
            booking.event_date,
            booking.event_start_time,
            booking.event_end_time
          ).run()
        }
      }
      
      // Auto-generate invoice for this booking
      try {
        await generateInvoiceForBooking(DB, bookingId)
      } catch (invoiceErr) {
        console.error('Invoice generation failed (non-blocking):', invoiceErr)
      }
      
      // Send confirmation email with invoice
      try {
        await sendPaymentConfirmationEmail(c.env, bookingId)
      } catch (emailErr) {
        console.error('Confirmation email failed (non-blocking):', emailErr)
      }
      
      // Check if this is a wedding event
      isWedding = booking?.event_type?.toLowerCase()?.includes('wedding') || false
      
      // For weddings: create initial wedding_event_forms record if not exists
      if (isWedding) {
        const existingForm = await DB.prepare(
          'SELECT id FROM wedding_event_forms WHERE booking_id = ?'
        ).bind(bookingId).first()
        
        if (!existingForm) {
          // Get user_id from booking
          const bookingForForm = await DB.prepare(
            'SELECT user_id FROM bookings WHERE id = ?'
          ).bind(bookingId).first() as any
          
          await DB.prepare(`
            INSERT INTO wedding_event_forms (booking_id, user_id, form_status)
            VALUES (?, ?, 'pending')
          `).bind(bookingId, bookingForForm?.user_id || 0).run()
        }
        
        // Send wedding form email to client
        try {
          const user = await DB.prepare(
            'SELECT id, full_name, email FROM users WHERE id = (SELECT user_id FROM bookings WHERE id = ?)'
          ).bind(bookingId).first() as any
          
          if (user) {
            const baseUrl = new URL(c.req.url).origin
            const formUrl = `${baseUrl}/wedding-planner/${bookingId}`
            await sendWeddingFormEmail(c.env, booking, user, formUrl)
          }
        } catch (weddingEmailErr) {
          console.error('Wedding form email failed (non-blocking):', weddingEmailErr)
        }
      }
    }
    
    return c.json({ 
      success: true, 
      message: 'Payment confirmed',
      isWedding,
      bookingId
    })
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
      return c.json({ error: 'Unauthorized - Please log in' }, 401)
    }
    
    const token = authHeader.substring(7)
    const secret = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, secret)
      // Token validated successfully
    } catch (tokenError: any) {
      return c.json({ error: 'Invalid or expired session. Please log in again.' }, 401)
    }
    
    const { items, bookingId } = await c.req.json()
    const { DB } = c.env
    
    // Processing checkout for authenticated user
    
    // Validate items
    if (!items || items.length === 0) {
      return c.json({ error: 'Cart is empty' }, 400)
    }
    
    // Calculate total (base price covers baseHours, hourlyRate for extra hours)
    let total = 0
    const lineItems = items.map((item: any) => {
      const service = servicePricing[item.serviceId as keyof typeof servicePricing]
      if (!service) throw new Error('Invalid service')
      
      const additionalHours = Math.max(0, item.hours - (service.baseHours || item.hours))
      const subtotal = service.basePrice + (service.hourlyRate * additionalHours)
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
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY
    const isDevelopmentMode = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock')
    
    // DEVELOPMENT MODE: Mock payment for testing without Stripe
    if (isDevelopmentMode) {
      // Development mode - using mock payment
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
    return c.json({ error: 'Failed to create checkout session' }, 500)
  }
})

// Webhook to handle Stripe events
app.post('/api/webhook/stripe', async (c) => {
  try {
    const signature = c.req.header('stripe-signature')
    const body = await c.req.text()
    
    const STRIPE_SECRET_KEY = c.env?.STRIPE_SECRET_KEY
    const WEBHOOK_SECRET = c.env?.STRIPE_WEBHOOK_SECRET
    
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
        
        // Update booking status
        const bookingId = session.metadata?.bookingId
        if (bookingId && DB) {
          // Get booking details for creating time slot
          const booking = await DB.prepare(`
            SELECT id, service_type, service_provider, event_date, event_start_time, event_end_time
            FROM bookings WHERE id = ?
          `).bind(bookingId).first() as any
          
          await DB.prepare(`
            UPDATE bookings 
            SET payment_status = 'paid', 
                status = 'confirmed',
                stripe_payment_intent_id = ?
            WHERE id = ?
          `).bind(session.payment_intent as string, bookingId).run()
          
          // CRITICAL: Create time slot NOW that payment is confirmed (blocks the calendar)
          if (booking && !booking.service_type?.startsWith('photobooth')) {
            // Check if slot already exists
            const existingSlot = await DB.prepare(`
              SELECT id FROM booking_time_slots WHERE booking_id = ?
            `).bind(bookingId).first()
            
            if (!existingSlot) {
              await DB.prepare(`
                INSERT INTO booking_time_slots (
                  booking_id, service_provider, event_date, start_time, end_time, status
                ) VALUES (?, ?, ?, ?, ?, 'confirmed')
              `).bind(
                bookingId,
                booking.service_provider,
                booking.event_date,
                booking.event_start_time,
                booking.event_end_time
              ).run()
            }
          }
          
        }
        
        break
        
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        // Payment intent processed successfully
        break
        
      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object as Stripe.PaymentIntent
        
        // Mark booking as failed if we can find it
        if (DB && failedPayment.metadata?.bookingId) {
          await DB.prepare(`
            UPDATE bookings 
            SET payment_status = 'failed', 
                status = 'cancelled'
            WHERE id = ?
          `).bind(failedPayment.metadata.bookingId).run()
          
          // Also cancel the time slot
          await DB.prepare(`
            UPDATE booking_time_slots 
            SET status = 'cancelled'
            WHERE booking_id = ?
          `).bind(failedPayment.metadata.bookingId).run()
        }
        break
        
      default:
        // Unhandled event type - no action needed
    }
    
    return c.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error.message)
    return c.json({ error: 'Webhook error' }, 400)
  }
})

// ===== AVAILABILITY CHECK CORE LOGIC (shared function) =====
async function checkAvailabilityLogic(DB: any, provider: string, date: string, startTime?: string, endTime?: string): Promise<any> {
  // Check manual blocks first
  const blocks = await DB.prepare(`
    SELECT COUNT(*) as count 
    FROM availability_blocks 
    WHERE service_provider = ? 
    AND block_date = ?
  `).bind(provider, date).first()
  
  if (blocks && blocks.count > 0) {
    return { available: false, reason: 'Date manually blocked', canDoubleBook: false }
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
    return { 
      available,
      reason: available ? '' : 'Both photobooth units booked',
      canDoubleBook: false,
      bookingsCount: bookings?.count || 0,
      maxBookings: 2
    }
  }
  
  // DJ logic: Check for double-booking possibility
  const existingBookings = await DB.prepare(`
    SELECT id, event_date, start_time, end_time
    FROM booking_time_slots
    WHERE service_provider = ?
    AND event_date = ?
    AND status = 'confirmed'
    ORDER BY start_time ASC
  `).bind(provider, date).all()
  
  const bookingsCount = existingBookings.results?.length || 0
  
  if (bookingsCount === 0) {
    return { available: true, canDoubleBook: true, bookingsCount: 0, maxBookings: 2 }
  }
  
  if (bookingsCount >= 2) {
    return { available: false, reason: 'DJ already has maximum 2 bookings on this date', canDoubleBook: false, bookingsCount, maxBookings: 2 }
  }
  
  // Has 1 booking: check if double-booking is possible
  const existing = existingBookings.results[0] as any
  const existingStart = parseTime(existing.start_time)
  const existingEnd = parseTime(existing.end_time)
  const newStart = startTime ? parseTime(startTime) : 0
  const newEnd = endTime ? parseTime(endTime) : 0
  
  if (existingStart >= parseTime('11:00')) {
    return { available: false, reason: 'DJ has afternoon/evening event (starts after 11:00 AM). Full day blocked.', canDoubleBook: false, bookingsCount: 1, maxBookings: 2 }
  }
  
  if (newStart >= parseTime('11:00')) {
    const gapHours = (newStart - existingEnd) / 60
    if (gapHours >= 3) {
      return { available: true, canDoubleBook: true, bookingsCount: 1, maxBookings: 2, message: 'Double-booking allowed: 3+ hour gap between events' }
    } else {
      return { available: false, reason: `Insufficient time gap: ${gapHours.toFixed(1)} hours (need 3 hours minimum)`, canDoubleBook: false, bookingsCount: 1, maxBookings: 2 }
    }
  }
  
  const gapHours = (newStart - existingEnd) / 60
  if (gapHours >= 3) {
    return { available: true, canDoubleBook: true, bookingsCount: 1, maxBookings: 2, message: 'Double-booking allowed: 3+ hour gap between early events' }
  }
  
  return { available: false, reason: 'Time conflict with existing booking', canDoubleBook: false, bookingsCount: 1, maxBookings: 2 }
}

// Check availability for a specific date, time and provider (DJ double-booking logic)
app.post('/api/availability/check', async (c) => {
  const body = await c.req.json()
  const provider = body.provider || body.serviceProvider
  const date = body.date || body.eventDate
  const startTime = body.startTime
  const endTime = body.endTime
  
  if (!provider || !date) {
    return c.json({ error: 'Provider and date are required' }, 400)
  }
  
  try {
    const result = await checkAvailabilityLogic(c.env.DB, provider, date, startTime, endTime)
    return c.json(result)
  } catch (error: any) {
    console.error('Availability check error:', error)
    return c.json({ error: 'Failed to check availability' }, 500)
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
    // IMPORTANT: Only count 'confirmed' slots (paid bookings) - 'pending' slots don't block dates
    const timeSlots = await DB.prepare(`
      SELECT event_date, COUNT(*) as count, 
             MAX(CASE WHEN start_time >= '11:00' THEN 1 ELSE 0 END) as has_afternoon
      FROM booking_time_slots
      WHERE service_provider = ?
      AND event_date BETWEEN ? AND ?
      AND status = 'confirmed'
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
    return c.json({ error: 'Failed to fetch availability' }, 500)
  }
})

// Create a new booking
app.post('/api/bookings/create', async (c) => {
  try {
    // Authenticate user
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    
    const token = authHeader.substring(7)
    const secret = getJWTSecret(c.env)
    
    let payload
    try {
      payload = await verifyToken(token, secret)
    } catch (tokenError: any) {
      return c.json({ error: 'Invalid or expired token. Please log in again.' }, 401)
    }
    
    const { DB } = c.env
    const bookingData = await c.req.json()
    
    // Validate required fields
    const required = ['serviceType', 'serviceProvider', 'eventDate', 'startTime', 'endTime', 'eventDetails']
    const missing = required.filter(field => !bookingData[field])
    
    if (missing.length > 0) {
      return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400)
    }
    
    // Check availability one more time (direct function call - no self-fetch to avoid Worker deadlock)
    const availResult = await checkAvailabilityLogic(
      DB,
      bookingData.serviceProvider,
      bookingData.eventDate,
      bookingData.startTime,
      bookingData.endTime
    )
    if (!availResult.available) {
      return c.json({ error: 'Time slot no longer available', reason: availResult.reason }, 409)
    }
    
    // Calculate pricing - check event type for wedding vs party rates
    const eventType = bookingData.eventDetails?.eventType?.toLowerCase() || 'party'
    const isWedding = eventType.includes('wedding')
    
    // For wedding DJ bookings, use wedding-specific pricing
    let pricingKey = bookingData.serviceProvider
    if (isWedding && bookingData.serviceType === 'dj') {
      pricingKey = 'dj_wedding'  // Use wedding package pricing ($850/5hrs)
    }
    
    let pricingEntry: any = servicePricing[pricingKey as keyof typeof servicePricing]
    if (!pricingEntry) {
      pricingEntry = servicePricing[bookingData.serviceProvider as keyof typeof servicePricing]
    }
    if (!pricingEntry) {
      pricingEntry = servicePricing[bookingData.serviceType as keyof typeof servicePricing]
    }
    if (!pricingEntry) {
      return c.json({ error: 'Invalid service type' }, 400)
    }
    
    // Resolve pricing values
    let basePrice = pricingEntry.basePrice
    let hourlyRate = pricingEntry.hourlyRate || 0
    let baseHours = pricingEntry.baseHours || 4
    
    // Handle nested structure fallback (e.g., dj: { party: {...}, wedding: {...} })
    if (basePrice === undefined && pricingEntry.party) {
      const subType = isWedding ? 'wedding' : 'party'
      const sub = pricingEntry[subType] || pricingEntry.party
      basePrice = sub.basePrice
      hourlyRate = sub.hourlyRate || 0
      baseHours = sub.baseHours || 4
    }
    
    const hours = calculateHours(bookingData.startTime, bookingData.endTime)
    const additionalHours = Math.max(0, hours - baseHours)
    const totalPrice = basePrice + (hourlyRate * additionalHours)
    
    // Insert booking (CRITICAL: Include event_start_time and event_end_time - NOT NULL fields)
    const bookingResult = await DB.prepare(`
      INSERT INTO bookings (
        user_id, service_type, service_provider, event_date,
        event_start_time, event_end_time,
        total_price, payment_status, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      payload.userId,
      bookingData.serviceType,
      bookingData.serviceProvider,
      bookingData.eventDate,
      bookingData.startTime,
      bookingData.endTime,
      totalPrice,
      'pending',
      'pending'
    ).run()
    
    const bookingId = bookingResult.meta.last_row_id
    
    // NOTE: Time slots are NOT created here - they are created only when payment is confirmed
    // This prevents unpaid bookings from blocking the calendar
    // Time slots will be created in /api/payment/confirm, /booking-success, and webhook handler
    
    // Insert event details (using production schema column names)
    const eventDetails = bookingData.eventDetails
    const eventResult = await DB.prepare(`
      INSERT INTO event_details (
        booking_id, event_name, event_type,
        street_address, city, state, zip_code,
        number_of_guests, special_requests, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      bookingId,
      eventDetails.eventName || '',
      eventDetails.eventType || '',
      (eventDetails.venueName ? eventDetails.venueName + ' - ' : '') + (eventDetails.venueAddress || ''),
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
    return c.json({ error: 'Failed to create booking' }, 500)
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
    // Development mode - notifications mocked
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
  
  // Use Resend REST API directly via fetch (avoids dynamic import overhead)
  const sendEmail = async (to: string | string[], subject: string, html: string) => {
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    })
  }
  
  // Use Twilio REST API directly via fetch to avoid large dependency
  const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  
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
  await sendEmail(
    user.email,
    `Booking Confirmation - ${booking.eventDetails.eventName}`,
    `
      <h2>Booking Confirmed!</h2>
      <p>Hi ${user.full_name},</p>
      <p>Your booking has been confirmed. Here are the details:</p>
      <pre>${eventInfo}</pre>
      <p><strong>Provider:</strong> ${provider.provider_name}</p>
      <p><strong>Provider Contact:</strong> ${provider.phone}</p>
      <p>We're excited to make your event amazing!</p>
      <p>- In The House Productions Team</p>
    `
  )
  
  // Send email to provider
  await sendEmail(
    [provider.email, 'mcecil38@yahoo.com'], // Send to provider AND Michael Cecil
    `New Booking - ${booking.eventDate}`,
    `
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
  )
  
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY

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
        
        ${generateRefersionTrackingScript(refersionKey)}

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
            /* Subtle radial gradient for depth - DJ club atmosphere */
            background-image: 
              radial-gradient(ellipse at 20% 30%, rgba(227, 30, 36, 0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 70%, rgba(255, 215, 0, 0.05) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 50%, rgba(192, 192, 192, 0.03) 0%, transparent 70%);
            background-attachment: fixed;
            color: #fff;
            font-family: 'Arial', sans-serif;
            overflow-x: hidden;
            /* Smooth scroll for better UX */
            scroll-behavior: smooth;
          }
          
          /* Image loading optimization */
          img {
            content-visibility: auto;
          }
          
          /* Lazy loading fade-in effect */
          img[loading="lazy"] {
            opacity: 0;
            transition: opacity 0.3s ease-in;
          }
          
          img[loading="lazy"].loaded,
          img[loading="lazy"]:not([src=""]) {
            opacity: 1;
          }
          
          /* ===== ENHANCED ANIMATED MUSICAL NOTES BACKGROUND ===== */
          /* Improved visibility, contrast, and visual impact */
          #musical-background {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            pointer-events: none;
            overflow: hidden;
            /* Subtle dark gradient overlay for depth */
            background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.3) 100%);
          }
          
          /* Musical staff lines for authenticity */
          #musical-background::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
              repeating-linear-gradient(
                0deg,
                transparent,
                transparent 18%,
                rgba(192, 192, 192, 0.04) 18%,
                rgba(192, 192, 192, 0.04) 18.5%,
                transparent 18.5%,
                transparent 22%,
                rgba(192, 192, 192, 0.04) 22%,
                rgba(192, 192, 192, 0.04) 22.5%,
                transparent 22.5%,
                transparent 26%,
                rgba(192, 192, 192, 0.04) 26%,
                rgba(192, 192, 192, 0.04) 26.5%,
                transparent 26.5%,
                transparent 30%,
                rgba(192, 192, 192, 0.04) 30%,
                rgba(192, 192, 192, 0.04) 30.5%,
                transparent 30.5%,
                transparent 34%,
                rgba(192, 192, 192, 0.04) 34%,
                rgba(192, 192, 192, 0.04) 34.5%,
                transparent 34.5%
              );
            pointer-events: none;
          }
          
          /* Individual musical note styling - ENHANCED */
          .note {
            position: absolute;
            font-size: clamp(1.8rem, 4vw, 3.5rem);
            animation: floatNote linear infinite;
            will-change: transform, opacity;
            filter: drop-shadow(0 0 8px currentColor);
            text-shadow: 
              0 0 10px currentColor,
              0 0 20px currentColor,
              0 0 30px rgba(227, 30, 36, 0.3);
          }
          
          /* Note color variations with glow effects */
          .note.note-red {
            color: #E31E24;
            filter: drop-shadow(0 0 12px rgba(227, 30, 36, 0.8));
          }
          
          .note.note-chrome {
            color: #C0C0C0;
            filter: drop-shadow(0 0 10px rgba(192, 192, 192, 0.6));
          }
          
          .note.note-gold {
            color: #FFD700;
            filter: drop-shadow(0 0 12px rgba(255, 215, 0, 0.7));
          }
          
          .note.note-neon {
            color: #FF0040;
            filter: drop-shadow(0 0 15px rgba(255, 0, 64, 0.9));
          }
          
          /* Size variations for depth perception */
          .note.note-large {
            font-size: clamp(2.5rem, 5vw, 4.5rem);
            opacity: 0.7;
          }
          
          .note.note-medium {
            font-size: clamp(1.8rem, 3.5vw, 3rem);
            opacity: 0.55;
          }
          
          .note.note-small {
            font-size: clamp(1.2rem, 2.5vw, 2rem);
            opacity: 0.4;
          }
          
          /* Main float animation - smoother with better visibility */
          @keyframes floatNote {
            0% {
              transform: translateX(0) translateY(0) rotate(0deg) scale(1);
              opacity: 0;
            }
            5% {
              opacity: 0.6;
            }
            50% {
              transform: translateX(-50vw) translateY(-20px) rotate(15deg) scale(1.1);
              opacity: 0.8;
            }
            95% {
              opacity: 0.5;
            }
            100% {
              transform: translateX(-110vw) translateY(10px) rotate(-10deg) scale(0.9);
              opacity: 0;
            }
          }
          
          /* Alternate animation for variety */
          @keyframes floatNoteWave {
            0% {
              transform: translateX(0) translateY(0) rotate(-5deg);
              opacity: 0;
            }
            10% {
              opacity: 0.7;
            }
            25% {
              transform: translateX(-25vw) translateY(-30px) rotate(10deg);
            }
            50% {
              transform: translateX(-50vw) translateY(20px) rotate(-5deg);
              opacity: 0.9;
            }
            75% {
              transform: translateX(-75vw) translateY(-15px) rotate(8deg);
            }
            90% {
              opacity: 0.4;
            }
            100% {
              transform: translateX(-115vw) translateY(0) rotate(-3deg);
              opacity: 0;
            }
          }
          
          /* Pulse animation for emphasis notes */
          @keyframes notePulse {
            0%, 100% {
              filter: drop-shadow(0 0 8px currentColor);
              transform: scale(1);
            }
            50% {
              filter: drop-shadow(0 0 20px currentColor) drop-shadow(0 0 40px currentColor);
              transform: scale(1.15);
            }
          }
          
          .note.note-pulse {
            animation: floatNote linear infinite, notePulse 2s ease-in-out infinite;
          }
          
          /* Responsive adjustments for mobile */
          @media (max-width: 768px) {
            .note {
              font-size: clamp(1.5rem, 5vw, 2.5rem);
            }
            .note.note-large {
              font-size: clamp(2rem, 6vw, 3rem);
            }
            #musical-background::before {
              opacity: 0.5;
            }
          }
          
          /* Reduce motion for accessibility */
          @media (prefers-reduced-motion: reduce) {
            .note {
              animation: none;
              opacity: 0.3;
            }
            #musical-background {
              background: rgba(0,0,0,0.1);
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
            <!-- Compact Header -->
            <header id="navigation" role="banner" class="text-center" style="padding: 1rem 0 0.5rem;">
                <div style="max-width: 625px; margin: 0 auto; padding: 0 1rem;">
                    <img src="/static/hero-logo-3d-v2.png" alt="IN THE HOUSE PRODUCTIONS" style="width: 100%; height: auto; display: block;">
                </div>
                <div style="max-width: 300px; margin: 0.75rem auto;">
                    <div class="staff-line"></div>
                </div>
                <p class="text-3d-gold" style="font-size: clamp(1.1rem, 3vw, 1.5rem); margin: 0.5rem 0 1rem; font-weight: 600;">"Your Event, Our Expertise"</p>
            </header>

            <!-- Service Cards - Compact Layout -->
            <main id="main-content" role="main" style="padding: 0 1rem 2rem;">
                <style>
                    .cards-wrapper { max-width: 900px; margin: 0 auto; padding: 0 1rem; }
                    .cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
                    @media (max-width: 700px) { .cards-grid { grid-template-columns: 1fr; max-width: 400px; margin: 0 auto; } }
                    .svc-card {
                        background: #0a0a0a; border: 2px solid #C0C0C0; border-radius: 12px;
                        padding: 1.25rem; cursor: pointer; transition: all 0.3s ease;
                    }
                    .svc-card:hover { border-color: #E31E24; box-shadow: 0 0 20px rgba(227,30,36,0.4); transform: translateY(-2px); }
                    .svc-logo { height: 130px; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; }
                    .svc-logo img { max-height: 120px; max-width: 100%; object-fit: contain; transform: scale(1.15); }
                    .svc-desc { color: #C0C0C0; font-size: 0.9rem; text-align: center; height: 40px; display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem; }
                    .svc-price-box { background: #1a1a1a; border: 1px solid #C0C0C0; border-radius: 8px; padding: 0.75rem; text-align: center; margin-bottom: 0.75rem; }
                    .svc-price { color: #FFD700; font-size: 1.3rem; font-weight: bold; margin-bottom: 0.25rem; }
                    .svc-price-detail { color: #C0C0C0; font-size: 0.8rem; line-height: 1.4; }
                    .svc-price-note { color: #888; font-size: 0.75rem; margin-top: 0.25rem; }
                    .svc-features { list-style: none; padding: 0; margin: 0 0 0.75rem 0; }
                    .svc-features li { color: #C0C0C0; font-size: 0.85rem; margin-bottom: 0.3rem; display: flex; align-items: center; }
                    .svc-features li i { color: #E31E24; margin-right: 0.5rem; font-size: 0.75rem; width: 14px; }
                    .svc-btn { width: 100%; background: linear-gradient(180deg, #E31E24 0%, #8B0000 100%); color: white; border: none; padding: 0.7rem; border-radius: 6px; font-weight: bold; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; }
                    .svc-btn:hover { background: linear-gradient(180deg, #ff3333 0%, #aa0000 100%); box-shadow: 0 0 15px rgba(227,30,36,0.6); }
                </style>
                <div class="cards-wrapper">
                    <div class="cards-grid">
                        <!-- DJ Services Card -->
                        <div class="svc-card" onclick="window.location.href='/dj-services'">
                            <div class="svc-logo"><img src="/static/dj-services-logo-3d.png" alt="DJ SERVICES"></div>
                            <div class="svc-desc">Professional DJs for your special event</div>
                            <div class="svc-price-box">
                                <div class="svc-price">Starting at $500</div>
                                <div class="svc-price-detail">Parties (up to 4 hrs)<br>Weddings: $850 (up to 5 hrs)</div>
                                <div class="svc-price-note">$100/hr additional</div>
                            </div>
                            <ul class="svc-features">
                                <li><i class="fas fa-check"></i>3 Professional DJs</li>
                                <li><i class="fas fa-check"></i>20+ Years Experience</li>
                                <li><i class="fas fa-check"></i>Custom Playlists</li>
                                <li><i class="fas fa-check"></i>All Event Types</li>
                            </ul>
                            <button class="svc-btn">SELECT SERVICE <i class="fas fa-arrow-right"></i></button>
                        </div>
                        
                        <!-- Photobooth Card -->
                        <div class="svc-card" onclick="window.location.href='/photobooth'">
                            <div class="svc-logo"><img src="/static/photobooth-logo-3d.png" alt="PHOTOBOOTH"></div>
                            <div class="svc-desc">Fun memories with instant prints</div>
                            <div class="svc-price-box">
                                <div class="svc-price">Starting at $500</div>
                                <div class="svc-price-detail">4 hours unlimited strips<br>4x6 Prints: $550 (4 hrs)</div>
                                <div class="svc-price-note">$100/hr additional</div>
                            </div>
                            <ul class="svc-features">
                                <li><i class="fas fa-check"></i>2 Professional Units</li>
                                <li><i class="fas fa-check"></i>Unlimited Prints</li>
                                <li><i class="fas fa-check"></i>Custom Backdrops</li>
                                <li><i class="fas fa-check"></i>Digital Gallery</li>
                            </ul>
                            <button class="svc-btn">SELECT SERVICE <i class="fas fa-arrow-right"></i></button>
                        </div>
                    </div>
                </div>
                
                <!-- Add-On Services Section -->
                <div style="margin-top: 2rem; max-width: 1200px; margin-left: auto; margin-right: auto;">
                    <h3 class="text-3d-logo-12k-gold text-center" style="font-size: clamp(1.25rem, 3vw, 1.75rem); margin-bottom: 1rem;">⭐ ADD-ON SERVICES ⭐</h3>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 px-2">
                        <!-- Karaoke -->
                        <div class="bg-black border border-chrome-silver rounded-lg p-3 hover:border-primary-red transition-all cursor-pointer" onclick="showServiceModal('karaoke')">
                            <div class="text-center mb-2">
                                <i class="fas fa-microphone text-3xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-sm font-bold text-center mb-1 text-chrome-silver">Karaoke</h4>
                            <p class="text-lg font-bold text-primary-red text-center">+$100</p>
                            <p class="text-xs text-gray-400 text-center">4hr event</p>
                        </div>

                        <!-- Uplighting -->
                        <div class="bg-black border border-chrome-silver rounded-lg p-3 hover:border-primary-red transition-all cursor-pointer" onclick="showServiceModal('uplighting')">
                            <div class="text-center mb-2">
                                <i class="fas fa-lightbulb text-3xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-sm font-bold text-center mb-1 text-chrome-silver">Uplighting</h4>
                            <p class="text-lg font-bold text-primary-red text-center">+$100</p>
                            <p class="text-xs text-gray-400 text-center">6 LED lights</p>
                        </div>

                        <!-- Foam Pit -->
                        <div class="bg-black border border-chrome-silver rounded-lg p-3 hover:border-primary-red transition-all cursor-pointer" onclick="showServiceModal('foampit')">
                            <div class="text-center mb-2">
                                <i class="fas fa-cloud text-3xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-sm font-bold text-center mb-1 text-chrome-silver">Foam Pit</h4>
                            <p class="text-lg font-bold text-primary-red text-center">$500</p>
                            <p class="text-xs text-gray-400 text-center">4hr rental</p>
                        </div>

                        <!-- Photography -->
                        <div class="bg-black border border-chrome-silver rounded-lg p-3 hover:border-primary-red transition-all cursor-pointer" onclick="showServiceModal('photography')">
                            <div class="text-center mb-2">
                                <i class="fas fa-camera text-3xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-sm font-bold text-center mb-1 text-chrome-silver">Photography</h4>
                            <p class="text-lg font-bold text-primary-red text-center">Quote</p>
                            <p class="text-xs text-gray-400 text-center">Weddings</p>
                        </div>

                        <!-- Coordinator -->
                        <div class="bg-black border border-chrome-silver rounded-lg p-3 hover:border-primary-red transition-all cursor-pointer" onclick="showServiceModal('coordinator')">
                            <div class="text-center mb-2">
                                <i class="fas fa-clipboard-check text-3xl" style="color: var(--primary-red);"></i>
                            </div>
                            <h4 class="text-sm font-bold text-center mb-1 text-chrome-silver">Coordinator</h4>
                            <p class="text-lg font-bold text-primary-red text-center">Quote</p>
                            <p class="text-xs text-gray-400 text-center">Events</p>
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
                        <!-- DK Farms & Gardens -->
                        <a href="https://www.dkfarmsandgardens.com/" target="_blank" rel="noopener noreferrer" class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center block" style="width: 150px; flex-shrink: 0; text-decoration: none;">
                            <img src="/static/dk-farms-logo.png" alt="DK Farms & Gardens" style="width: 80px; height: 80px; object-fit: contain; margin: 0 auto 0.5rem; display: block;">
                            <h4 class="text-sm font-bold text-chrome-silver">DK Farms & Gardens</h4>
                        </a>

                        <!-- The Big Red Barn -->
                        <a href="https://www.bigredbarnevents.com/" target="_blank" rel="noopener noreferrer" class="bg-black border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center block" style="width: 150px; flex-shrink: 0; text-decoration: none;">
                            <img src="/static/big-red-barn-logo.png" alt="The Big Red Barn" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; margin: 0 auto 0.5rem; display: block;">
                            <h4 class="text-sm font-bold text-chrome-silver">The Big Red Barn</h4>
                        </a>

                        <!-- Garden Gate Estate -->
                        <a href="https://gardengateestate.com/" target="_blank" rel="noopener noreferrer" class="bg-white border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center block" style="width: 150px; flex-shrink: 0; text-decoration: none;">
                            <img src="/static/garden-gate-logo.png" alt="Garden Gate Estate" style="width: 100%; height: 60px; object-fit: contain; margin: 0 auto 0.5rem; display: block;">
                            <h4 class="text-sm font-bold" style="color: #333;">Garden Gate Estate</h4>
                        </a>

                        <!-- Still Creek Farm -->
                        <a href="https://www.facebook.com/StillCreekFarm/" target="_blank" rel="noopener noreferrer" class="bg-white border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center block" style="width: 150px; flex-shrink: 0; text-decoration: none;">
                            <img src="/static/still-creek-logo.png" alt="Still Creek Farm" style="width: 80px; height: 80px; object-fit: contain; margin: 0 auto 0.5rem; display: block; border-radius: 8px;">
                            <h4 class="text-sm font-bold" style="color: #333;">Still Creek Farm</h4>
                        </a>

                        <!-- The Barn Yard WC -->
                        <a href="https://www.thebarnyardwc.com/" target="_blank" rel="noopener noreferrer" class="bg-white border-2 border-chrome-silver rounded-lg p-4 hover:border-primary-red transition-all hover:shadow-lg hover:shadow-red-500/20 text-center block" style="width: 150px; flex-shrink: 0; text-decoration: none;">
                            <img src="/static/barn-yard-logo.png" alt="The Barn Yard WC" style="width: 80px; height: 80px; object-fit: contain; margin: 0 auto 0.5rem; display: block;">
                            <h4 class="text-sm font-bold" style="color: #333;">The Barn Yard</h4>
                        </a>
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
          // ===== ENHANCED ANIMATED MUSICAL NOTES BACKGROUND =====
          // Industry-standard DJ website visual effects
          
          const noteSymbols = ['♪', '♫', '♬', '♩', '♭', '♮', '♯', '𝄞', '𝄢'];
          const colorClasses = ['note-red', 'note-chrome', 'note-gold', 'note-neon'];
          const sizeClasses = ['note-large', 'note-medium', 'note-small'];
          const animations = ['floatNote', 'floatNoteWave'];
          
          // Staff line positions (percentage from top) - mimics real music staff
          const staffPositions = [12, 18, 24, 30, 36, 45, 52, 60, 68, 75, 82];
          
          function createMusicalNote(options = {}) {
            const container = document.getElementById('musical-background');
            if (!container) return;
            
            const note = document.createElement('div');
            
            // Random symbol selection
            const symbol = options.symbol || noteSymbols[Math.floor(Math.random() * noteSymbols.length)];
            note.textContent = symbol;
            
            // Random color class for variety
            const colorClass = colorClasses[Math.floor(Math.random() * colorClasses.length)];
            
            // Random size for depth perception (larger = closer, smaller = farther)
            const sizeClass = sizeClasses[Math.floor(Math.random() * sizeClasses.length)];
            
            // Occasional pulse effect for emphasis (10% chance)
            const isPulse = Math.random() < 0.1;
            
            note.className = 'note ' + colorClass + ' ' + sizeClass + (isPulse ? ' note-pulse' : '');
            
            // Random vertical position along staff lines
            const topPosition = staffPositions[Math.floor(Math.random() * staffPositions.length)];
            note.style.top = topPosition + '%';
            
            // Start from right side of screen
            note.style.right = '-5%';
            
            // Random animation selection
            const animName = animations[Math.floor(Math.random() * animations.length)];
            
            // Duration based on size (larger = faster for parallax effect)
            let baseDuration;
            if (sizeClass === 'note-large') {
              baseDuration = 15 + Math.random() * 10; // 15-25s (faster)
            } else if (sizeClass === 'note-medium') {
              baseDuration = 25 + Math.random() * 15; // 25-40s (medium)
            } else {
              baseDuration = 35 + Math.random() * 20; // 35-55s (slower, farther)
            }
            
            note.style.animationName = animName;
            note.style.animationDuration = baseDuration + 's';
            note.style.animationDelay = (options.delay || Math.random() * 3) + 's';
            note.style.animationTimingFunction = 'linear';
            note.style.animationIterationCount = '1';
            note.style.animationFillMode = 'forwards';
            
            container.appendChild(note);
            
            // Remove note after animation completes
            setTimeout(() => {
              if (note.parentNode) note.remove();
            }, (baseDuration + 5) * 1000);
          }
          
          // Create a batch of notes with staggered timing
          function createNoteBatch(count, staggerMs) {
            for (let i = 0; i < count; i++) {
              setTimeout(() => createMusicalNote({ delay: 0 }), i * staggerMs);
            }
          }
          
          // Initialize background animation
          function initMusicalBackground() {
            // Create initial batch for immediate visual impact
            createNoteBatch(8, 400);
            
            // Continuous note generation at varying intervals
            let noteInterval = setInterval(() => {
              // Random interval between 1.5-3.5 seconds
              createMusicalNote();
            }, 1500 + Math.random() * 2000);
            
            // Occasional burst of notes (every 15-25 seconds)
            setInterval(() => {
              createNoteBatch(3, 200);
            }, 15000 + Math.random() * 10000);
            
            // Cleanup on page visibility change (save resources)
            document.addEventListener('visibilitychange', () => {
              if (document.hidden) {
                clearInterval(noteInterval);
              } else {
                noteInterval = setInterval(() => createMusicalNote(), 2000);
              }
            });
          }
          
          // Start animation when page is ready
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
              requestIdleCallback(initMusicalBackground, { timeout: 1000 });
            });
          } else {
            requestIdleCallback(initMusicalBackground, { timeout: 1000 });
          }
        </script>
    </body>
    </html>
  `)
})

// DJ Services Page - Profile Selection
app.get('/dj-services', (c) => {
  const baseUrl = 'https://www.inthehouseproductions.com'
  const refersionKey = c.env.REFERSION_PUBLIC_KEY

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
        
        ${generateRefersionTrackingScript(refersionKey)}

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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Select Date - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
            

            
            // Set the provider based on service type
            if (serviceType === 'photobooth') {
              // Map unit1/unit2 to photobooth_unit1/photobooth_unit2 for API calls
              if (selectedPhotobooth === 'unit1') {
                selectedProvider = 'photobooth_unit1';

              } else if (selectedPhotobooth === 'unit2') {
                selectedProvider = 'photobooth_unit2';

              } else if (selectedPhotobooth) {
                selectedProvider = selectedPhotobooth; // In case it's already the full ID

              } else {
                console.error('❌ CRITICAL: selectedPhotobooth is null/undefined!');
              }
            } else {
              selectedProvider = selectedDJ;

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

            renderCalendar().then(() => {
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

                
                if (!provider) {
                  console.warn('No provider selected');
                  availabilityData = {};
                  resolve();
                  return;
                }
                
                fetch(\`/api/availability/\${provider}/\${currentYear}/\${currentMonth + 1}\`)
                  .then(response => response.json())
                  .then(data => {

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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Event Details - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
              
              if (!response.ok) {
                // Only redirect to login for actual auth errors (401)
                if (response.status === 401) {
                  localStorage.removeItem('authToken');
                  localStorage.removeItem('user');
                  await showAlert('Your session has expired. Please log in again.', 'Session Expired');
                  window.location.href = '/login';
                  return;
                }
                
                throw new Error(result.error || 'Booking failed');
              }
              
              // Store booking ID and data for checkout page
              // CRITICAL FIX: Include startTime and endTime for payment intent creation
              localStorage.setItem('bookingId', result.bookingId);
              localStorage.setItem('bookingData', JSON.stringify({
                ...bookingData,
                startTime,
                endTime,
                eventDetails,
                bookingId: result.bookingId
              }));
              
              // Redirect to checkout page
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Checkout - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
                    
                    // Get Stripe publishable key from server config
                    const configResponse = await fetch('/api/stripe/config');
                    const stripeConfig = await configResponse.json();
                    
                    if (!stripeConfig.publishableKey || stripeConfig.publishableKey === 'not_configured') {
                        // Stripe publishable key not configured - show helpful message
                        document.getElementById('payment-element').innerHTML = \`
                            <div class="text-center py-6">
                                <i class="fas fa-exclamation-circle text-4xl mb-4" style="color: #FFD700;"></i>
                                <p class="text-lg font-bold mb-2" style="color: #FFD700;">Payment Setup Required</p>
                                <p class="text-gray-400 mb-4">Stripe publishable key needs to be configured.</p>
                                <p class="text-sm text-gray-500">Admin: Add STRIPE_PUBLISHABLE_KEY to environment variables.</p>
                            </div>
                        \`;
                        return;
                    }
                    
                    stripe = Stripe(stripeConfig.publishableKey);
                    
                    try {
                        elements = stripe.elements({ clientSecret });
                        paymentElement = elements.create('payment');
                        paymentElement.mount('#payment-element');
                        
                        paymentElement.on('ready', () => {
                            document.getElementById('submit-button').disabled = false;
                            document.getElementById('button-text').textContent = 'Pay ' + data.amountFormatted;
                        });
                        
                        paymentElement.on('loaderror', (event) => {
                            console.error('[STRIPE] Load error:', event.error);
                            document.getElementById('payment-element').innerHTML = \`
                                <div class="text-center py-6">
                                    <i class="fas fa-exclamation-triangle text-4xl mb-4" style="color: #ef4444;"></i>
                                    <p class="text-lg font-bold mb-2" style="color: #ef4444;">Payment Form Error</p>
                                    <p class="text-gray-400 mb-2">\${event.error?.message || 'Failed to load payment form'}</p>
                                    <p class="text-sm text-gray-500">This may be a Stripe configuration issue. Please contact support.</p>
                                </div>
                            \`;
                        });
                    } catch (stripeError) {
                        console.error('[STRIPE] Initialization error:', stripeError);
                        document.getElementById('payment-element').innerHTML = \`
                            <div class="text-center py-6">
                                <i class="fas fa-exclamation-triangle text-4xl mb-4" style="color: #ef4444;"></i>
                                <p class="text-lg font-bold mb-2" style="color: #ef4444;">Stripe Error</p>
                                <p class="text-gray-400 mb-2">\${stripeError.message || 'Failed to initialize Stripe'}</p>
                                <p class="text-sm text-gray-500">The publishable key may not match the secret key account.</p>
                            </div>
                        \`;
                    }
                    
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
                        
                        const confirmData = await confirmResponse.json();
                        
                        if (confirmResponse.ok) {
                            // Redirect to success page with wedding flag
                            const successUrl = '/checkout/mock-success?session_id=' + 
                                window.mockPaymentData.clientSecret + 
                                '&booking_id=' + window.mockPaymentData.bookingId + 
                                '&total=' + (window.mockPaymentData.amount / 100).toFixed(2) +
                                (confirmData.isWedding ? '&wedding=true' : '');
                            window.location.href = successUrl;
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  
  // Get booking details for Refersion conversion tracking
  let bookingTotal = 0
  let bookingId = ''
  let isWeddingBooking = false
  
  // Update booking if we have a payment intent
  if (paymentIntentId && DB) {
    // First get the booking details including total for Refersion
    const booking = await DB.prepare(
      "SELECT id, user_id, service_type, service_provider, event_date, event_start_time, event_end_time, total_price FROM bookings WHERE stripe_payment_intent_id = ?"
    ).bind(paymentIntentId).first() as any
    
    if (booking) {
      bookingId = booking.id.toString()
      bookingTotal = booking.total_price || 0
    }
    
    // Update booking status
    await DB.prepare(
      "UPDATE bookings SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE stripe_payment_intent_id = ?"
    ).bind(paymentIntentId).run()
    
    // CRITICAL: Create time slot NOW that payment is confirmed (blocks the calendar)
    if (booking?.id && !booking.service_type?.startsWith('photobooth')) {
      const existingSlot = await DB.prepare(
        "SELECT id FROM booking_time_slots WHERE booking_id = ?"
      ).bind(booking.id).first()
      
      if (!existingSlot) {
        await DB.prepare(`
          INSERT INTO booking_time_slots (
            booking_id, service_provider, event_date, start_time, end_time, status
          ) VALUES (?, ?, ?, ?, ?, 'confirmed')
        `).bind(
          booking.id,
          booking.service_provider,
          booking.event_date,
          booking.event_start_time,
          booking.event_end_time
        ).run()
      }
    }
    
    if (booking?.id) {
      // AUTO-GENERATE: Invoice for this booking (using shared helper)
      try {
        await generateInvoiceForBooking(DB, booking.id)
      } catch (invErr) {
        console.error('Auto-invoice error:', invErr)
      }
      
      // Send confirmation email with invoice
      try {
        await sendPaymentConfirmationEmail(c.env, booking.id)
      } catch (emailErr) {
        console.error('Confirmation email error:', emailErr)
      }
      
      // Check if this is a wedding booking
      try {
        const eventDetail = await DB.prepare(
          "SELECT event_type FROM event_details WHERE booking_id = ?"
        ).bind(booking.id).first() as any
        
        isWeddingBooking = eventDetail?.event_type?.toLowerCase()?.includes('wedding') || false
        
        if (isWeddingBooking) {
          // Create wedding form record if not exists
          const existingForm = await DB.prepare(
            "SELECT id FROM wedding_event_forms WHERE booking_id = ?"
          ).bind(booking.id).first()
          
          if (!existingForm) {
            await DB.prepare(`
              INSERT INTO wedding_event_forms (booking_id, user_id, form_status)
              VALUES (?, ?, 'pending')
            `).bind(booking.id, booking.user_id).run()
          }
          
          // Send wedding form email
          const user = await DB.prepare(
            "SELECT full_name, email FROM users WHERE id = ?"
          ).bind(booking.user_id).first()
          
          if (user) {
            const baseUrl = new URL(c.req.url).origin
            const formUrl = `${baseUrl}/wedding-planner/${booking.id}`
            await sendWeddingFormEmail(c.env, booking, user, formUrl)
          }
        }
      } catch (wfErr) {
        console.error('Wedding form trigger error:', wfErr)
      }
    }
  }
  
  // Use payment_intent as cart_id for Refersion (unique order identifier)
  const cartId = paymentIntentId || bookingId
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed! - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
        ${generateRefersionConversionScript(refersionKey, cartId, bookingTotal)}
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
                    <li><i class="fas fa-file-invoice text-green-500 mr-2"></i> Invoice automatically generated</li>
                    <li><i class="fas fa-calendar-check text-green-500 mr-2"></i> Your event date is reserved</li>
                    <li><i class="fas fa-user-tie text-green-500 mr-2"></i> Your DJ/Photobooth team has been notified</li>
                    <li><i class="fas fa-phone text-green-500 mr-2"></i> We'll contact you 1 week before your event</li>
                </ul>
            </div>
            
            <!-- Wedding Form CTA (shown dynamically for wedding bookings) -->
            <div id="weddingFormCta" style="display:none;" class="mb-6">
              <div style="background: linear-gradient(135deg, rgba(227,30,36,0.15), rgba(255,215,0,0.1)); border: 2px solid #FFD700; border-radius: 15px; padding: 1.5rem; text-align: center;">
                <i class="fas fa-ring text-4xl mb-3" style="color: #FFD700;"></i>
                <h3 class="text-xl font-bold mb-2" style="color: #FFD700;">Complete Your Wedding Planning Form!</h3>
                <p class="text-gray-300 mb-4">Help your DJ prepare the perfect wedding. Tell us about your ceremony, songs, bridal party, and more.</p>
                <a id="weddingFormLink" href="#" class="inline-block px-8 py-3 font-bold rounded-lg transition-colors" style="background: linear-gradient(135deg, #E31E24, #FF0040); color: white; text-decoration: none; border: 2px solid #C0C0C0; letter-spacing: 1px;">
                    <i class="fas fa-clipboard-list mr-2"></i>START WEDDING FORM
                </a>
                <p class="text-gray-500 text-xs mt-3">Also sent to your email. You can save progress and come back anytime.</p>
              </div>
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
            
            // Check if this was a wedding booking - show wedding form CTA
            try {
              const storedBooking = localStorage.getItem('bookingData');
              if (storedBooking) {
                const bd = JSON.parse(storedBooking);
                const isWedding = bd.eventDetails?.eventType === 'wedding' || bd.eventType === 'wedding';
                const bId = bd.bookingId || '${bookingId}';
                if (isWedding && bId) {
                  document.getElementById('weddingFormCta').style.display = 'block';
                  document.getElementById('weddingFormLink').href = '/wedding-planner/' + bId;
                }
              }
            } catch(e) {}
            
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY

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
        
        ${generateRefersionTrackingScript(refersionKey)}

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
  const sessionId = escapeHtml(c.req.query('session_id'))
  const bookingId = escapeHtml(c.req.query('booking_id'))
  const total = escapeHtml(c.req.query('total'))
  const weddingParam = c.req.query('wedding')
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  
  const { DB } = c.env
  
  // Detect if this is a wedding booking (from URL param or DB lookup)
  let isWedding = weddingParam === 'true'
  let invoiceNumber = ''
  
  if (bookingId && DB) {
    // Check event type in DB
    if (!isWedding) {
      const eventInfo = await DB.prepare(
        'SELECT event_type FROM event_details WHERE booking_id = ?'
      ).bind(bookingId).first() as any
      isWedding = eventInfo?.event_type?.toLowerCase()?.includes('wedding') || false
    }
    
    // Get invoice number
    const inv = await DB.prepare(
      'SELECT invoice_number FROM invoices WHERE booking_id = ?'
    ).bind(bookingId).first() as any
    invoiceNumber = inv?.invoice_number || ''
  }
  
  // Parse total for Refersion conversion tracking
  const totalValue = total ? parseFloat(total) : 0
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed! - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
        ${generateRefersionConversionScript(refersionKey, bookingId || sessionId, totalValue)}
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
          body { background: #000; color: #fff; }
          .success-container {
            max-width: 600px;
            margin: 2rem auto;
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
          .wedding-cta {
            background: linear-gradient(135deg, #E31E24, #FF0040);
            border: 2px solid #FFD700;
            padding: 20px 40px;
            border-radius: 15px;
            display: inline-block;
            text-decoration: none;
            color: white;
            font-weight: bold;
            font-size: 18px;
            letter-spacing: 1px;
            transition: all 0.3s ease;
            animation: pulse 2s infinite;
          }
          .wedding-cta:hover {
            transform: scale(1.05);
            box-shadow: 0 0 30px rgba(227, 30, 36, 0.5);
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
          @keyframes pulse {
            0%, 100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.3); }
            50% { box-shadow: 0 0 25px rgba(255, 215, 0, 0.6); }
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
                Your payment was successful and your booking is confirmed.
            </p>
            
            <div class="bg-gray-800 p-4 rounded-lg mb-6 text-left">
                <h3 class="text-lg font-bold mb-2" style="color: #FFD700;">Booking Details:</h3>
                <p class="text-gray-300">Booking ID: #${bookingId}</p>
                <p class="text-gray-300">Total Paid: <span style="color: #22c55e; font-weight: bold;">$${total}</span></p>
                ${invoiceNumber ? `<p class="text-gray-300">Invoice: ${invoiceNumber}</p>` : ''}
                <p class="text-gray-300 mt-2">Status: <span style="color: #22c55e; font-weight: bold;">CONFIRMED & PAID</span></p>
            </div>
            
            <div class="mb-6">
                <p class="text-gray-400 mb-2">
                    <i class="fas fa-envelope mr-2" style="color: #22c55e;"></i>
                    Confirmation email with invoice has been sent.
                </p>
                <p class="text-gray-400">
                    <i class="fas fa-file-invoice mr-2" style="color: #22c55e;"></i>
                    Invoice ${invoiceNumber || 'generated'} - Status: PAID
                </p>
            </div>
            
            ${isWedding ? `
            <div style="background: linear-gradient(135deg, rgba(227,30,36,0.15), rgba(255,215,0,0.1)); border: 2px solid #FFD700; border-radius: 15px; padding: 25px; margin: 25px 0;">
                <h2 class="text-2xl font-bold mb-3" style="color: #FFD700;">
                    <i class="fas fa-heart mr-2" style="color: #E31E24;"></i>
                    Next Step: Your Wedding Planning Form!
                </h2>
                <p class="text-gray-300 mb-6">
                    Please complete the wedding planning questionnaire so your DJ can prepare 
                    everything perfectly for your special day. Include your song choices, 
                    bridal party, timeline, and more!
                </p>
                <a href="/wedding-planner/${bookingId}" class="wedding-cta">
                    <i class="fas fa-clipboard-list mr-2"></i>
                    COMPLETE WEDDING FORM
                </a>
                <p class="text-sm text-gray-500 mt-4">
                    <i class="fas fa-info-circle mr-1"></i>
                    You can save progress and come back anytime. A link has also been emailed to you.
                </p>
            </div>
            ` : ''}
            
            <div class="mt-6 flex gap-4 justify-center flex-wrap">
                ${isWedding ? `
                <a href="/wedding-planner/${bookingId}" class="inline-block px-8 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
                    <i class="fas fa-clipboard-list mr-2"></i>
                    WEDDING FORM
                </a>
                ` : ''}
                <a href="/" class="inline-block px-8 py-3 ${isWedding ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'} text-white font-bold rounded-lg transition-colors">
                    <i class="fas fa-home mr-2"></i>
                    RETURN HOME
                </a>
            </div>
            
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed! - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Cancelled - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(` <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Login - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
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
            <div class="mt-4 text-center"><a href="/forgot-password" class="text-gray-500 hover:text-red-400 transition-colors text-sm"><i class="fas fa-lock mr-1"></i>Forgot Password?</a></div>
            <div class="mt-4 text-center"><p class="text-chrome-silver">Don't have an account? <a href="/register" class="text-primary-red hover:text-accent-neon transition-colors">Register Now</a></p></div>
            <div class="mt-4 text-center"><a href="/" class="text-chrome-silver hover:text-white transition-colors"><i class="fas fa-arrow-left mr-2"></i>Back to Home</a></div>
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
            // Save token
            try {
              localStorage.setItem('authToken', data.token);
              localStorage.setItem('user', JSON.stringify(data.user));
              
              // Verify token saved
              const savedToken = localStorage.getItem('authToken');
              if (!savedToken) {
                throw new Error('Failed to save token to localStorage');
              }
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

// Password Reset Page
app.get('/forgot-password', (c) => {
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Forgot Password - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/ultra-3d.css" rel="stylesheet">
    <style>
      body { background: #000; color: #fff; font-family: 'Arial', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .form-card { background: linear-gradient(145deg, #1a0000, #0a0a0a); border: 3px solid #E31E24; border-radius: 20px; padding: 2.5rem; width: 100%; max-width: 440px; box-shadow: 0 0 40px rgba(227, 30, 36, 0.3); }
      .form-input { width: 100%; padding: 0.75rem; background: rgba(0,0,0,0.6); border: 2px solid #555; border-radius: 8px; color: #fff; font-size: 1rem; }
      .form-input:focus { outline: none; border-color: #E31E24; box-shadow: 0 0 15px rgba(227,30,36,0.3); }
      .btn-submit { width: 100%; padding: 0.85rem; background: linear-gradient(135deg, #E31E24, #FF0040); color: #fff; border: none; border-radius: 50px; font-weight: bold; font-size: 1rem; cursor: pointer; transition: all 0.3s; }
      .btn-submit:hover { transform: translateY(-2px); box-shadow: 0 0 25px rgba(227,30,36,0.5); }
    </style>
</head>
<body>
    <div class="form-card">
        <div class="text-center mb-6">
            <i class="fas fa-lock text-5xl text-red-500 mb-3"></i>
            <h1 class="text-2xl font-bold" style="color: #FFD700;">Forgot Password?</h1>
            <p class="text-gray-400 mt-2 text-sm">Enter your email and we'll send you a reset link.</p>
        </div>
        <form id="forgotForm">
            <div class="mb-4">
                <label class="block text-gray-400 text-sm font-bold mb-2">Email Address</label>
                <input type="email" id="email" class="form-input" placeholder="your@email.com" required>
            </div>
            <div id="message" class="hidden mb-4 p-3 rounded-lg text-sm"></div>
            <button type="submit" id="submitBtn" class="btn-submit">
                <i class="fas fa-paper-plane mr-2"></i>SEND RESET LINK
            </button>
        </form>
        <div class="text-center mt-4">
            <a href="/login" class="text-gray-500 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Login</a>
        </div>
    </div>
    <script>
        document.getElementById('forgotForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            const msg = document.getElementById('message');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>SENDING...';
            try {
                const resp = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: document.getElementById('email').value })
                });
                const data = await resp.json();
                msg.classList.remove('hidden', 'bg-red-900', 'text-red-300');
                msg.classList.add('bg-green-900', 'text-green-300');
                msg.textContent = data.message || 'Check your email for the reset link.';
            } catch (err) {
                msg.classList.remove('hidden', 'bg-green-900', 'text-green-300');
                msg.classList.add('bg-red-900', 'text-red-300');
                msg.textContent = 'Something went wrong. Please try again.';
            }
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>SEND RESET LINK';
        });
    </script>
</body>
</html>`)
})

// Reset Password Page (with token from email)
app.get('/reset-password', (c) => {
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Password - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      body { background: #000; color: #fff; font-family: 'Arial', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .form-card { background: linear-gradient(145deg, #1a0000, #0a0a0a); border: 3px solid #E31E24; border-radius: 20px; padding: 2.5rem; width: 100%; max-width: 440px; box-shadow: 0 0 40px rgba(227, 30, 36, 0.3); }
      .form-input { width: 100%; padding: 0.75rem; background: rgba(0,0,0,0.6); border: 2px solid #555; border-radius: 8px; color: #fff; font-size: 1rem; }
      .form-input:focus { outline: none; border-color: #E31E24; }
      .btn-submit { width: 100%; padding: 0.85rem; background: linear-gradient(135deg, #E31E24, #FF0040); color: #fff; border: none; border-radius: 50px; font-weight: bold; font-size: 1rem; cursor: pointer; }
    </style>
</head>
<body>
    <div class="form-card">
        <div class="text-center mb-6">
            <i class="fas fa-key text-5xl text-yellow-500 mb-3"></i>
            <h1 class="text-2xl font-bold" style="color: #FFD700;">Set New Password</h1>
        </div>
        <form id="resetForm">
            <div class="mb-4">
                <label class="block text-gray-400 text-sm font-bold mb-2">New Password</label>
                <input type="password" id="password" class="form-input" placeholder="Min 8 chars, 1 uppercase, 1 number" required minlength="8">
            </div>
            <div class="mb-4">
                <label class="block text-gray-400 text-sm font-bold mb-2">Confirm Password</label>
                <input type="password" id="confirmPassword" class="form-input" placeholder="Re-enter password" required>
            </div>
            <div id="message" class="hidden mb-4 p-3 rounded-lg text-sm"></div>
            <button type="submit" id="submitBtn" class="btn-submit"><i class="fas fa-check mr-2"></i>RESET PASSWORD</button>
        </form>
    </div>
    <script>
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const email = params.get('email');
        if (!token || !email) {
            document.getElementById('message').classList.remove('hidden');
            document.getElementById('message').classList.add('bg-red-900', 'text-red-300');
            document.getElementById('message').textContent = 'Invalid reset link. Please request a new one.';
            document.getElementById('submitBtn').disabled = true;
        }
        document.getElementById('resetForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const pw = document.getElementById('password').value;
            const confirm = document.getElementById('confirmPassword').value;
            const msg = document.getElementById('message');
            if (pw !== confirm) { msg.classList.remove('hidden'); msg.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900 text-red-300'; msg.textContent = 'Passwords do not match'; return; }
            try {
                const resp = await fetch('/api/auth/reset-password', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, token, new_password: pw })
                });
                const data = await resp.json();
                msg.classList.remove('hidden');
                if (data.success) {
                    msg.className = 'mb-4 p-3 rounded-lg text-sm bg-green-900 text-green-300';
                    msg.textContent = 'Password reset! Redirecting to login...';
                    setTimeout(() => window.location.href = '/login', 2000);
                } else {
                    msg.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900 text-red-300';
                    msg.textContent = data.error || 'Failed to reset password';
                }
            } catch { msg.classList.remove('hidden'); msg.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900 text-red-300'; msg.textContent = 'Something went wrong.'; }
        });
    </script>
</body>
</html>`)
})

// Email Verification Page
app.get('/verify-email', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Email - In The House Productions</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>body { background: #000; color: #fff; font-family: Arial; min-height: 100vh; display: flex; align-items: center; justify-content: center; }</style>
</head>
<body>
    <div class="text-center" id="content"><i class="fas fa-spinner fa-spin text-5xl text-red-500 mb-4"></i><p class="text-gray-400">Verifying your email...</p></div>
    <script>
        (async () => {
            const params = new URLSearchParams(location.search);
            const el = document.getElementById('content');
            try {
                const resp = await fetch('/api/auth/verify-email', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: params.get('email'), token: params.get('token') })
                });
                const data = await resp.json();
                if (data.success) {
                    el.innerHTML = '<div style="font-size:5rem;">&#10003;</div><h1 class="text-3xl font-bold text-green-400 mt-4">Email Verified!</h1><p class="text-gray-400 mt-2">Your email has been verified. You can now use all features.</p><a href="/" class="inline-block mt-6 px-8 py-3 bg-red-600 text-white rounded-full font-bold">Go to Home</a>';
                } else {
                    el.innerHTML = '<div style="font-size:5rem; color: #E31E24;">&#10007;</div><h1 class="text-3xl font-bold text-red-400 mt-4">Verification Failed</h1><p class="text-gray-400 mt-2">' + (data.error || 'Invalid or expired token') + '</p><a href="/" class="inline-block mt-6 px-8 py-3 bg-gray-700 text-white rounded-full font-bold">Go to Home</a>';
                }
            } catch { el.innerHTML = '<p class="text-red-400">Something went wrong. Please try again.</p>'; }
        })();
    </script>
</body>
</html>`)
})

// Contact Us Page
app.get('/contact', (c) => {
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Us - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About Us - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - In The House Productions</title>
    ${generateRefersionTrackingScript(refersionKey)}
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
        <div id="tabContentBookings">
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
        </div>

        <!-- Tab Navigation -->
        <div class="admin-card rounded-lg p-4 mb-8" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn-primary" onclick="showTab('bookings')" id="tabBookings" style="opacity: 1;">
                <i class="fas fa-list mr-2"></i>Bookings
            </button>
            <button class="btn-primary" onclick="showTab('wedding-forms')" id="tabWeddingForms" style="opacity: 0.6;">
                <i class="fas fa-ring mr-2"></i>Wedding Forms
            </button>
            <button class="btn-primary" onclick="showTab('invoices')" id="tabInvoices" style="opacity: 0.6;">
                <i class="fas fa-file-invoice-dollar mr-2"></i>Invoices
            </button>
            <button class="btn-primary" onclick="showTab('providers')" id="tabProviders" style="opacity: 0.6;">
                <i class="fas fa-user-friends mr-2"></i>Providers
            </button>
        </div>

        <!-- WEDDING FORMS TAB -->
        <div id="tabContentWedding-forms" class="hidden">
          <div class="admin-card rounded-lg p-6 mb-8">
            <h2 class="text-2xl font-bold text-white mb-6">
                <i class="fas fa-ring text-primary-red mr-2"></i>Wedding Planning Forms
            </h2>
            <div id="weddingFormsLoading" class="text-center text-white py-8">
                <i class="fas fa-spinner loading text-4xl text-primary-gold mb-3"></i>
                <p>Loading wedding forms...</p>
            </div>
            <div id="weddingFormsTable" class="booking-table hidden">
                <table>
                    <thead><tr><th>Booking</th><th>Couple</th><th>Event Date</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                    <tbody id="weddingFormsBody"></tbody>
                </table>
            </div>
          </div>
          
          <!-- Wedding Form Detail Modal -->
          <div id="weddingFormDetail" class="admin-card rounded-lg p-6 hidden">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-2xl font-bold text-white"><i class="fas fa-ring text-primary-red mr-2"></i>Wedding Form Details</h2>
              <button onclick="document.getElementById('weddingFormDetail').classList.add('hidden')" class="btn-primary" style="padding: 6px 16px;"><i class="fas fa-times"></i></button>
            </div>
            <div id="weddingFormDetailContent"></div>
          </div>
        </div>

        <!-- INVOICES TAB -->
        <div id="tabContentInvoices" class="hidden">
          <div class="admin-card rounded-lg p-6 mb-8">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-2xl font-bold text-white">
                  <i class="fas fa-file-invoice-dollar text-primary-red mr-2"></i>Invoices
              </h2>
              <button onclick="autoGenerateInvoices()" class="btn-primary"><i class="fas fa-magic mr-2"></i>Auto-Generate Missing</button>
            </div>
            <div id="invoicesLoading" class="text-center text-white py-8">
                <i class="fas fa-spinner loading text-4xl text-primary-gold mb-3"></i>
                <p>Loading invoices...</p>
            </div>
            <div id="invoicesTable" class="booking-table hidden">
                <table>
                    <thead><tr><th>Invoice #</th><th>Client</th><th>Event Date</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="invoicesBody"></tbody>
                </table>
            </div>
          </div>
        </div>

        <!-- PROVIDERS TAB -->
        <div id="tabContentProviders" class="hidden">
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

        // Tab system
        let activeTab = 'bookings';
        function showTab(tab) {
            // Hide all tab content
            document.querySelectorAll('[id^="tabContent"]').forEach(el => el.classList.add('hidden'));
            // Reset all tab buttons
            document.querySelectorAll('[id^="tab"]').forEach(el => { if (el.id.startsWith('tab') && !el.id.startsWith('tabContent')) el.style.opacity = '0.6'; });
            // Show selected tab
            const contentId = 'tabContent' + tab.charAt(0).toUpperCase() + tab.slice(1);
            const contentEl = document.getElementById(contentId);
            if (contentEl) contentEl.classList.remove('hidden');
            // Also keep bookings table visible when on bookings tab
            if (tab === 'bookings') {
              document.getElementById('tabContentBookings').classList.remove('hidden');
            }
            // Highlight active tab button
            const tabNames = {'bookings':'tabBookings','wedding-forms':'tabWeddingForms','invoices':'tabInvoices','providers':'tabProviders'};
            if (tabNames[tab]) document.getElementById(tabNames[tab]).style.opacity = '1';
            activeTab = tab;
            // Load tab data
            if (tab === 'wedding-forms') loadWeddingForms();
            if (tab === 'invoices') loadInvoices();
            if (tab === 'providers') loadProviders();
        }
        
        // Load wedding forms
        async function loadWeddingForms() {
            try {
                const response = await axios.get('/api/admin/wedding-forms');
                if (response.data.success) {
                    const forms = response.data.forms;
                    const tbody = document.getElementById('weddingFormsBody');
                    
                    if (forms.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">No wedding forms yet. Forms are auto-created when clients book weddings.</td></tr>';
                    } else {
                        tbody.innerHTML = forms.map(form => {
                            const statusColors = {pending:'#FFA500',in_progress:'#3B82F6',completed:'#22c55e',reviewed:'#8B5CF6'};
                            const couple = [form.partner1_full_name, form.partner2_full_name].filter(Boolean).join(' & ') || form.client_name;
                            return \`<tr>
                                <td>#\${form.booking_id}</td>
                                <td>\${couple}<br><small class="text-gray-400">\${form.client_email}</small></td>
                                <td>\${form.event_date ? new Date(form.event_date).toLocaleDateString() : 'N/A'}</td>
                                <td><span class="status-badge" style="background:\${statusColors[form.form_status] || '#666'}">\${form.form_status}</span></td>
                                <td>\${form.completed_at ? '100%' : (form.last_saved_section ? Math.round((parseInt(form.last_saved_section)/10)*100) + '%' : '0%')}</td>
                                <td>
                                    <button onclick="viewWeddingForm(\${form.booking_id})" class="btn-primary" style="padding:4px 12px;font-size:12px;"><i class="fas fa-eye mr-1"></i>View</button>
                                    <button onclick="sendWeddingFormEmail(\${form.booking_id})" class="btn-primary" style="padding:4px 12px;font-size:12px;background:#3B82F6;"><i class="fas fa-envelope mr-1"></i>Send Email</button>
                                </td>
                            </tr>\`;
                        }).join('');
                    }
                    
                    document.getElementById('weddingFormsLoading').classList.add('hidden');
                    document.getElementById('weddingFormsTable').classList.remove('hidden');
                }
            } catch (error) {
                console.error('Failed to load wedding forms:', error);
                document.getElementById('weddingFormsLoading').innerHTML = '<p class="text-red-500">Failed to load</p>';
            }
        }
        
        async function viewWeddingForm(bookingId) {
            try {
                const resp = await axios.get('/api/wedding-form/' + bookingId);
                if (resp.data.success && resp.data.form) {
                    const f = resp.data.form;
                    const detail = document.getElementById('weddingFormDetail');
                    const content = document.getElementById('weddingFormDetailContent');
                    
                    let bridalParty = [], vipFamily = [], mustPlay = [], doNotPlay = [], toasts = [];
                    try { bridalParty = JSON.parse(f.bridal_party_json || '[]'); } catch(e){}
                    try { vipFamily = JSON.parse(f.vip_family_json || '[]'); } catch(e){}
                    try { mustPlay = JSON.parse(f.must_play_songs || '[]'); } catch(e){}
                    try { doNotPlay = JSON.parse(f.do_not_play_songs || '[]'); } catch(e){}
                    try { toasts = JSON.parse(f.toast_speakers_json || '[]'); } catch(e){}
                    
                    content.innerHTML = \`
                      <div class="grid md:grid-cols-2 gap-6">
                        <div>
                          <h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-heart mr-2"></i>Couple</h3>
                          <p class="text-gray-300"><strong>Partner 1:</strong> \${f.partner1_full_name || 'N/A'} | \${f.partner1_phone || ''} | \${f.partner1_email || ''}</p>
                          <p class="text-gray-300"><strong>Partner 2:</strong> \${f.partner2_full_name || 'N/A'} | \${f.partner2_phone || ''} | \${f.partner2_email || ''}</p>
                          <p class="text-gray-300"><strong>Hashtag:</strong> \${f.couple_hashtag || 'N/A'}</p>
                          \${f.how_they_met ? '<p class="text-gray-400 mt-2"><strong>How they met:</strong> ' + f.how_they_met + '</p>' : ''}
                        </div>
                        <div>
                          <h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-church mr-2"></i>Ceremony</h3>
                          <p class="text-gray-300"><strong>Location:</strong> \${f.ceremony_location || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Time:</strong> \${f.ceremony_time || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Officiant:</strong> \${f.officiant_name || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Processional:</strong> \${f.processional_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Recessional:</strong> \${f.recessional_song || 'N/A'}</p>
                        </div>
                      </div>
                      
                      <div class="grid md:grid-cols-2 gap-6 mt-6">
                        <div>
                          <h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-music mr-2"></i>Key Songs</h3>
                          <p class="text-gray-300"><strong>Grand Entrance:</strong> \${f.grand_entrance_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>First Dance:</strong> \${f.first_dance_song || 'N/A'} \${f.first_dance_style ? '(' + f.first_dance_style + ')' : ''}</p>
                          <p class="text-gray-300"><strong>Father/Daughter:</strong> \${f.father_daughter_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Mother/Son:</strong> \${f.mother_son_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Cake Cutting:</strong> \${f.cake_cutting_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Last Dance:</strong> \${f.last_dance_song || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Send-Off:</strong> \${f.send_off_song || 'N/A'} \${f.send_off_style ? '(' + f.send_off_style + ')' : ''}</p>
                        </div>
                        <div>
                          <h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-cocktail mr-2"></i>Cocktail & Reception</h3>
                          <p class="text-gray-300"><strong>Cocktail:</strong> \${f.cocktail_start_time || 'N/A'} - \${f.cocktail_end_time || 'N/A'} | Vibe: \${f.cocktail_music_vibe || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Reception Start:</strong> \${f.reception_start_time || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Entrance Style:</strong> \${f.grand_entrance_style || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Special:</strong> \${f.bouquet_toss ? 'Bouquet Toss' : ''} \${f.garter_toss ? '| Garter Toss' : ''} \${f.money_dance ? '| Money Dance' : ''} \${f.anniversary_dance ? '| Anniversary Dance' : ''}</p>
                          <p class="text-gray-300"><strong>Energy Level:</strong> \${f.dance_floor_energy || 'N/A'}</p>
                          <p class="text-gray-300"><strong>Clean Only:</strong> \${f.clean_music_only ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                      
                      \${bridalParty.length > 0 ? '<div class="mt-6"><h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-users mr-2"></i>Bridal Party (' + bridalParty.length + ')</h3><div class="grid md:grid-cols-2 gap-2">' + bridalParty.map(m => '<p class="text-gray-300"><strong>' + (m.role||'') + ':</strong> ' + (m.name||'') + (m.partner_name ? ' & ' + m.partner_name : '') + '</p>').join('') + '</div>' + (f.flower_girl_name ? '<p class="text-gray-300 mt-2"><strong>Flower Girl:</strong> ' + f.flower_girl_name + '</p>' : '') + (f.ring_bearer_name ? '<p class="text-gray-300"><strong>Ring Bearer:</strong> ' + f.ring_bearer_name + '</p>' : '') + '</div>' : ''}
                      
                      \${mustPlay.length > 0 ? '<div class="mt-6"><h3 style="color:#22c55e" class="text-lg font-bold mb-3"><i class="fas fa-check-circle mr-2"></i>Must-Play (' + mustPlay.length + ')</h3>' + mustPlay.map(s => '<p class="text-gray-300">"' + s.song + '" - ' + s.artist + (s.moment ? ' <span style="color:#FFD700">(' + s.moment + ')</span>' : '') + '</p>').join('') + '</div>' : ''}
                      
                      \${doNotPlay.length > 0 ? '<div class="mt-6"><h3 style="color:#E31E24" class="text-lg font-bold mb-3"><i class="fas fa-ban mr-2"></i>Do NOT Play (' + doNotPlay.length + ')</h3>' + doNotPlay.map(s => '<p class="text-gray-300">"' + s.song + '" - ' + s.artist + (s.reason ? ' <span style="color:#888">(' + s.reason + ')</span>' : '') + '</p>').join('') + '</div>' : ''}
                      
                      \${toasts.length > 0 ? '<div class="mt-6"><h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-glass-cheers mr-2"></i>Toast Speakers</h3>' + toasts.map((s,i) => '<p class="text-gray-300">#' + (i+1) + ': ' + s.name + ' (' + (s.role||'') + ')</p>').join('') + '</div>' : ''}
                      
                      \${f.memorial_tribute ? '<div class="mt-6" style="background:rgba(255,215,0,0.1);border:1px solid #FFD700;border-radius:10px;padding:1rem;"><h3 style="color:#FFD700" class="font-bold mb-2"><i class="fas fa-candle-holder mr-2"></i>Memorial Tribute</h3><p class="text-gray-300">' + f.memorial_tribute + '</p>' + (f.memorial_tribute_details ? '<p class="text-gray-400 text-sm mt-1">' + f.memorial_tribute_details + '</p>' : '') + '</div>' : ''}
                      
                      <div class="mt-6">
                        <h3 style="color:#FFD700" class="text-lg font-bold mb-3"><i class="fas fa-cog mr-2"></i>Logistics</h3>
                        <p class="text-gray-300"><strong>Setup Time:</strong> \${f.dj_setup_time || 'N/A'} | <strong>Indoor/Outdoor:</strong> \${f.indoor_outdoor || 'N/A'} | <strong>Dance Floor:</strong> \${f.dance_floor_size || 'N/A'}</p>
                        <p class="text-gray-300"><strong>DJ Placement:</strong> \${f.dj_placement || 'N/A'} | <strong>Power:</strong> \${f.power_location || 'N/A'}</p>
                        \${f.rain_plan ? '<p class="text-gray-300"><strong>Rain Plan:</strong> ' + f.rain_plan + '</p>' : ''}
                        <p class="text-gray-300"><strong>Add-ons:</strong> \${f.wants_uplighting ? 'Uplighting (' + (f.uplighting_color||'') + ')' : ''} \${f.wants_karaoke ? '| Karaoke' : ''} \${f.wants_fog_machine ? '| Fog Machine' : ''} \${f.wants_photobooth ? '| Photobooth' : ''}</p>
                      </div>
                    \`;
                    
                    detail.classList.remove('hidden');
                    detail.scrollIntoView({ behavior: 'smooth' });
                }
            } catch (error) {
                console.error('Failed to load wedding form:', error);
            }
        }
        
        async function sendWeddingFormEmail(bookingId) {
            try {
                await axios.post('/api/wedding-form/' + bookingId + '/send-email');
                alert('Wedding form email sent!');
            } catch (error) {
                alert('Failed to send email');
            }
        }
        
        // Load invoices
        async function loadInvoices() {
            try {
                const response = await axios.get('/api/admin/invoices');
                if (response.data.success) {
                    const invoices = response.data.invoices;
                    const tbody = document.getElementById('invoicesBody');
                    
                    if (invoices.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400">No invoices yet. Click "Auto-Generate Missing" to create invoices for existing bookings.</td></tr>';
                    } else {
                        tbody.innerHTML = invoices.map(inv => {
                            const statusColors = {draft:'#666',sent:'#3B82F6',viewed:'#8B5CF6',paid:'#22c55e',overdue:'#E31E24',cancelled:'#666',refunded:'#FFA500'};
                            return \`<tr>
                                <td style="font-weight:bold;color:#FFD700;">\${inv.invoice_number}</td>
                                <td>\${inv.client_name}<br><small class="text-gray-400">\${inv.client_email}</small></td>
                                <td>\${inv.event_date ? new Date(inv.event_date).toLocaleDateString() : 'N/A'}</td>
                                <td class="font-bold">$\${(inv.total || 0).toFixed(2)}</td>
                                <td style="color:#22c55e">$\${(inv.amount_paid || 0).toFixed(2)}</td>
                                <td style="color:\${inv.amount_due > 0 ? '#E31E24' : '#22c55e'}">$\${(inv.amount_due || 0).toFixed(2)}</td>
                                <td><span class="status-badge" style="background:\${statusColors[inv.status] || '#666'}">\${inv.status}</span></td>
                                <td>
                                    \${inv.status !== 'paid' && inv.amount_due > 0 ? '<button onclick="markInvoicePaid(' + inv.id + ')" class="btn-primary" style="padding:4px 10px;font-size:11px;background:#22c55e;margin-right:4px;"><i class="fas fa-check mr-1"></i>Mark Paid</button>' : ''}
                                    \${inv.status !== 'paid' && inv.amount_due > 0 ? '<button onclick="sendInvoiceReminder(' + inv.id + ')" class="btn-primary" style="padding:4px 10px;font-size:11px;background:#3B82F6;"><i class="fas fa-bell mr-1"></i>Remind</button>' : ''}
                                </td>
                            </tr>\`;
                        }).join('');
                    }
                    
                    document.getElementById('invoicesLoading').classList.add('hidden');
                    document.getElementById('invoicesTable').classList.remove('hidden');
                }
            } catch (error) {
                console.error('Failed to load invoices:', error);
            }
        }
        
        async function markInvoicePaid(invoiceId) {
            try {
                await axios.post('/api/invoices/' + invoiceId + '/status', { status: 'paid' });
                loadInvoices();
                loadStats();
            } catch (error) { alert('Failed to update'); }
        }
        
        async function sendInvoiceReminder(invoiceId) {
            try {
                await axios.post('/api/invoices/' + invoiceId + '/send-reminder');
                alert('Reminder sent!');
                loadInvoices();
            } catch (error) { alert('Failed to send reminder'); }
        }
        
        async function autoGenerateInvoices() {
            try {
                const resp = await axios.post('/api/invoices/auto-generate');
                if (resp.data.success) {
                    alert('Generated ' + resp.data.generated + ' invoice(s): ' + (resp.data.invoiceNumbers || []).join(', '));
                    loadInvoices();
                }
            } catch (error) { alert('Failed to auto-generate'); }
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            loadStats()
            loadBookings()
        })
    </script>
</body>
</html>
  `)
})

// ===== EMPLOYEE PORTAL PAGES =====

// Employee Login Page
app.get('/employee/login', (c) => {
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Employee Login - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Employee Dashboard - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
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

// ===== WEDDING EVENT PLANNING FORM SYSTEM =====

// Helper: Generate invoice for a specific booking (called after payment confirmation)
async function generateInvoiceForBooking(DB: D1Database, bookingId: number): Promise<{ invoiceNumber: string | null, error?: string }> {
  try {
    // Check if invoice already exists for this booking
    const existing = await DB.prepare(
      'SELECT invoice_number FROM invoices WHERE booking_id = ?'
    ).bind(bookingId).first() as any
    
    if (existing) {
      return { invoiceNumber: existing.invoice_number }
    }
    
    const booking = await DB.prepare(`
      SELECT b.*, e.event_name, e.event_type, u.full_name as client_name, u.email as client_email
      FROM bookings b
      LEFT JOIN event_details e ON b.id = e.booking_id
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.id = ?
    `).bind(bookingId).first() as any
    
    if (!booking) {
      return { invoiceNumber: null, error: 'Booking not found' }
    }
    
    const invoiceNumber = await generateInvoiceNumber(DB)
    const total = booking.total_price || 0
    const issueDate = new Date().toISOString().split('T')[0]
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const amountPaid = booking.payment_status === 'paid' ? total : 0
    
    const providerName = booking.service_provider?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    const lineItems = [{
      service: providerName || booking.service_type,
      description: `${booking.event_type || booking.service_type} - ${booking.event_name || 'Event'} on ${booking.event_date}`,
      qty: 1, rate: total, amount: total
    }]
    
    await DB.prepare(`
      INSERT INTO invoices (
        booking_id, user_id, invoice_number, status,
        subtotal, total, amount_paid, amount_due,
        line_items_json, issue_date, due_date,
        paid_date, auto_reminders, terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      bookingId, booking.user_id, invoiceNumber,
      amountPaid >= total ? 'paid' : 'sent',
      total, total, amountPaid, total - amountPaid,
      JSON.stringify(lineItems), issueDate, dueDate,
      amountPaid >= total ? issueDate : null,
      1, 'Payment is due within 14 days.'
    ).run()
    
    return { invoiceNumber }
  } catch (err: any) {
    console.error(`Failed to generate invoice for booking ${bookingId}:`, err)
    return { invoiceNumber: null, error: err.message }
  }
}

// Helper: Send booking confirmation + invoice email
async function sendPaymentConfirmationEmail(env: any, bookingId: number) {
  const { DB, RESEND_API_KEY } = env
  const isDevelopmentMode = !RESEND_API_KEY || RESEND_API_KEY.includes('mock')
  
  try {
    const booking = await DB.prepare(`
      SELECT b.*, e.event_name, e.event_type, e.street_address, e.city, e.state,
             u.full_name, u.email
      FROM bookings b
      LEFT JOIN event_details e ON b.id = e.booking_id
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.id = ?
    `).bind(bookingId).first() as any
    
    if (!booking) return { success: false, error: 'Booking not found' }
    
    // Get invoice
    const invoice = await DB.prepare(
      'SELECT * FROM invoices WHERE booking_id = ?'
    ).bind(bookingId).first() as any
    
    if (isDevelopmentMode) {
      console.log(`[DEV] Would send payment confirmation email to: ${booking.email}`)
      console.log(`[DEV] Booking #${bookingId} | Invoice: ${invoice?.invoice_number || 'N/A'} | Total: $${booking.total_price}`)
      return { success: true, developmentMode: true }
    }
    
    const isWedding = booking.event_type?.toLowerCase()?.includes('wedding')
    const providerName = booking.service_provider?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #E31E24; font-size: 28px;">In The House Productions</h1>
          <p style="color: #22c55e; font-size: 20px; font-weight: bold;">Payment Confirmed!</p>
        </div>
        
        <p style="color: #C0C0C0; font-size: 16px;">Hi ${booking.full_name},</p>
        <p style="color: #C0C0C0; line-height: 1.8;">
          Your booking has been confirmed and payment processed successfully. Here are your details:
        </p>
        
        <div style="background: #222; border: 1px solid #444; border-radius: 10px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #FFD700; margin-top: 0;">Booking Summary</h3>
          <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; font-weight: bold;">Event:</td><td>${booking.event_name || 'N/A'}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Type:</td><td>${booking.event_type || booking.service_type}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Date:</td><td>${booking.event_date}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Time:</td><td>${booking.event_start_time} - ${booking.event_end_time}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Provider:</td><td>${providerName}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Venue:</td><td>${booking.street_address || 'TBD'}${booking.city ? ', ' + booking.city : ''}${booking.state ? ', ' + booking.state : ''}</td></tr>
          </table>
        </div>
        
        ${invoice ? `
        <div style="background: #222; border: 1px solid #22c55e; border-radius: 10px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #22c55e; margin-top: 0;">Invoice ${invoice.invoice_number}</h3>
          <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; font-weight: bold;">Total:</td><td>$${Number(booking.total_price).toFixed(2)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Paid:</td><td style="color: #22c55e;">$${Number(invoice.amount_paid).toFixed(2)}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: bold;">Status:</td><td style="color: #22c55e;">PAID</td></tr>
          </table>
        </div>
        ` : ''}
        
        ${isWedding ? `
        <div style="background: rgba(227, 30, 36, 0.15); border: 2px solid #E31E24; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
          <h3 style="color: #FFD700; margin-top: 0;">Next Step: Complete Your Wedding Form!</h3>
          <p style="color: #C0C0C0; margin-bottom: 15px;">Please fill out the wedding planning form so your DJ can prepare for your special day.</p>
          <p style="color: #888; font-size: 13px;">You can access the form from the success page or check your email for the link.</p>
        </div>
        ` : ''}
        
        <p style="color: #888; font-size: 13px; margin-top: 20px;">
          If you have any questions, contact us at (816) 217-1094 or reply to this email.
        </p>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
          <p style="color: #666; font-size: 12px;">In The House Productions | (816) 217-1094 | www.inthehouseproductions.com</p>
        </div>
      </div>
    `
    
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: booking.email,
        subject: `Booking Confirmed! ${isWedding ? '💍' : '🎧'} ${booking.event_name || 'Your Event'} - ${booking.event_date}`,
        html: emailHtml
      })
    })
    
    // Also notify admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: ['mcecil38@yahoo.com'],
        subject: `NEW Booking Paid - ${booking.full_name} - ${booking.event_type || booking.service_type} on ${booking.event_date}`,
        html: emailHtml
      })
    })
    
    return { success: true }
  } catch (err) {
    console.error('Failed to send payment confirmation email:', err)
    return { success: false }
  }
}

// Helper: Generate next invoice number
async function generateInvoiceNumber(DB: D1Database): Promise<string> {
  const year = new Date().getFullYear()
  const lastInvoice = await DB.prepare(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`INV-${year}-%`).first() as any
  
  let nextNum = 1
  if (lastInvoice?.invoice_number) {
    const parts = lastInvoice.invoice_number.split('-')
    nextNum = parseInt(parts[2]) + 1
  }
  return `INV-${year}-${String(nextNum).padStart(4, '0')}`
}

// Helper: Send wedding form email to client
async function sendWeddingFormEmail(env: any, booking: any, user: any, formUrl: string) {
  const RESEND_API_KEY = env.RESEND_API_KEY
  if (!RESEND_API_KEY || RESEND_API_KEY.includes('mock')) {
    console.log('[DEV] Would send wedding form email to:', user.email)
    return { success: true, developmentMode: true }
  }
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: user.email,
        subject: `Wedding Planning Form - Complete Your Event Details!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #ffffff; padding: 30px; border-radius: 15px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #E31E24; font-size: 28px; margin: 0;">In The House Productions</h1>
              <p style="color: #C0C0C0; font-size: 14px;">Wedding Planning Questionnaire</p>
            </div>
            
            <p style="font-size: 18px; color: #FFD700;">Congratulations, ${user.full_name}!</p>
            
            <p style="color: #C0C0C0; line-height: 1.8;">
              Your wedding booking has been confirmed! To make your big day absolutely perfect, 
              please complete our wedding planning form. This helps your DJ prepare everything 
              exactly the way you want it.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${formUrl}" style="display: inline-block; background: linear-gradient(135deg, #E31E24, #FF0040); color: white; padding: 15px 40px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 18px; letter-spacing: 1px;">
                COMPLETE YOUR WEDDING FORM
              </a>
            </div>
            
            <div style="background: rgba(227, 30, 36, 0.1); border: 1px solid #E31E24; border-radius: 10px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #FFD700; margin-top: 0;">What we'll ask about:</h3>
              <ul style="color: #C0C0C0; line-height: 2;">
                <li>Ceremony & reception music choices</li>
                <li>First dance, parent dances & special songs</li>
                <li>Bridal party introductions</li>
                <li>Timeline & reception flow</li>
                <li>Must-play & do-not-play lists</li>
                <li>Special moments & announcements</li>
              </ul>
            </div>
            
            <p style="color: #888; font-size: 13px;">
              You can save your progress and come back to finish later. 
              Your DJ will review the completed form and follow up with you.
            </p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
              <p style="color: #666; font-size: 12px;">
                In The House Productions | (816) 217-1094 | www.inthehouseproductions.com
              </p>
            </div>
          </div>
        `
      })
    })
    
    return { success: response.ok }
  } catch (err) {
    console.error('Failed to send wedding form email:', err)
    return { success: false }
  }
}

// Helper: Send completed wedding form summary email
async function sendWeddingFormCompletedEmail(env: any, formData: any, booking: any, user: any) {
  const RESEND_API_KEY = env.RESEND_API_KEY
  if (!RESEND_API_KEY || RESEND_API_KEY.includes('mock')) {
    console.log('[DEV] Would send completed wedding form email')
    return { success: true, developmentMode: true }
  }
  
  const bridalParty = formData.bridal_party_json ? JSON.parse(formData.bridal_party_json) : []
  const vipFamily = formData.vip_family_json ? JSON.parse(formData.vip_family_json) : []
  const mustPlay = formData.must_play_songs ? JSON.parse(formData.must_play_songs) : []
  const doNotPlay = formData.do_not_play_songs ? JSON.parse(formData.do_not_play_songs) : []
  const toastSpeakers = formData.toast_speakers_json ? JSON.parse(formData.toast_speakers_json) : []
  
  const summaryHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
      <h1 style="color: #E31E24; text-align: center;">Wedding Planning Form - Complete!</h1>
      <p style="color: #FFD700; text-align: center; font-size: 18px;">${formData.partner1_full_name || ''} & ${formData.partner2_full_name || ''}</p>
      <p style="color: #C0C0C0; text-align: center;">Booking #${booking.id} | ${booking.event_date}</p>
      
      <hr style="border-color: #333; margin: 20px 0;">
      
      <h2 style="color: #FFD700;">Couple Information</h2>
      <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
        <tr><td style="padding: 5px; font-weight: bold;">Partner 1:</td><td style="padding: 5px;">${formData.partner1_full_name || 'N/A'} | ${formData.partner1_phone || ''} | ${formData.partner1_email || ''}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Partner 2:</td><td style="padding: 5px;">${formData.partner2_full_name || 'N/A'} | ${formData.partner2_phone || ''} | ${formData.partner2_email || ''}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Hashtag:</td><td style="padding: 5px;">${formData.couple_hashtag || 'N/A'}</td></tr>
      </table>
      
      <h2 style="color: #FFD700;">Ceremony</h2>
      <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
        <tr><td style="padding: 5px; font-weight: bold;">Processional:</td><td style="padding: 5px;">${formData.processional_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Recessional:</td><td style="padding: 5px;">${formData.recessional_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Unity Ceremony:</td><td style="padding: 5px;">${formData.unity_ceremony || 'None'}</td></tr>
      </table>
      
      <h2 style="color: #FFD700;">Reception Highlights</h2>
      <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
        <tr><td style="padding: 5px; font-weight: bold;">Grand Entrance Song:</td><td style="padding: 5px;">${formData.grand_entrance_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">First Dance:</td><td style="padding: 5px;">${formData.first_dance_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Father/Daughter:</td><td style="padding: 5px;">${formData.father_daughter_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Mother/Son:</td><td style="padding: 5px;">${formData.mother_son_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Cake Cutting:</td><td style="padding: 5px;">${formData.cake_cutting_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Last Dance:</td><td style="padding: 5px;">${formData.last_dance_song || 'N/A'}</td></tr>
        <tr><td style="padding: 5px; font-weight: bold;">Send-Off:</td><td style="padding: 5px;">${formData.send_off_song || 'N/A'} (${formData.send_off_style || 'N/A'})</td></tr>
      </table>
      
      ${bridalParty.length > 0 ? `
        <h2 style="color: #FFD700;">Bridal Party</h2>
        <table style="width: 100%; color: #C0C0C0; border-collapse: collapse;">
          ${bridalParty.map((m: any) => `<tr><td style="padding: 5px;">${m.role || ''}</td><td style="padding: 5px;">${m.name || ''} ${m.partner_name ? '& ' + m.partner_name : ''}</td></tr>`).join('')}
        </table>
      ` : ''}
      
      ${mustPlay.length > 0 ? `
        <h2 style="color: #22c55e;">Must-Play Songs</h2>
        <ul style="color: #C0C0C0;">
          ${mustPlay.map((s: any) => `<li>"${s.song}" - ${s.artist}${s.moment ? ' (' + s.moment + ')' : ''}</li>`).join('')}
        </ul>
      ` : ''}
      
      ${doNotPlay.length > 0 ? `
        <h2 style="color: #E31E24;">Do NOT Play</h2>
        <ul style="color: #C0C0C0;">
          ${doNotPlay.map((s: any) => `<li>"${s.song}" - ${s.artist}${s.reason ? ' (' + s.reason + ')' : ''}</li>`).join('')}
        </ul>
      ` : ''}
      
      ${formData.special_announcements ? `<h2 style="color: #FFD700;">Special Announcements</h2><p style="color: #C0C0C0;">${formData.special_announcements}</p>` : ''}
      ${formData.memorial_tribute ? `<h2 style="color: #FFD700;">Memorial Tribute</h2><p style="color: #C0C0C0;">${formData.memorial_tribute}: ${formData.memorial_tribute_details || ''}</p>` : ''}
      
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
        <p style="color: #666; font-size: 12px;">In The House Productions | Wedding Planning Form Summary</p>
      </div>
    </div>
  `
  
  try {
    // Send to client
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: user.email,
        subject: `Your Wedding Planning Form - Saved! (${formData.partner1_full_name} & ${formData.partner2_full_name})`,
        html: summaryHtml
      })
    })
    
    // Send to DJ/Admin
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'In The House Productions <noreply@inthehouseproductions.com>',
        to: ['mcecil38@yahoo.com'],
        subject: `NEW Wedding Form Completed - ${formData.partner1_full_name} & ${formData.partner2_full_name} (Booking #${booking.id})`,
        html: summaryHtml
      })
    })
    
    return { success: true }
  } catch (err) {
    console.error('Failed to send completed form email:', err)
    return { success: false }
  }
}

// API: Get wedding form for a booking
app.get('/api/wedding-form/:bookingId', async (c) => {
  try {
    const bookingId = c.req.param('bookingId')
    const { DB } = c.env
    
    const form = await DB.prepare(
      "SELECT * FROM wedding_event_forms WHERE booking_id = ?"
    ).bind(bookingId).first()
    
    if (!form) {
      return c.json({ success: true, form: null, message: 'No form found for this booking' })
    }
    
    return c.json({ success: true, form })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Save/Update wedding form (supports partial saves)
app.post('/api/wedding-form/:bookingId', async (c) => {
  try {
    const bookingId = c.req.param('bookingId')
    const { DB } = c.env
    const formData = await c.req.json()
    
    // Check if form exists
    const existingForm = await DB.prepare(
      "SELECT id FROM wedding_event_forms WHERE booking_id = ?"
    ).bind(bookingId).first()
    
    // Get booking info for user_id
    const booking = await DB.prepare(
      "SELECT user_id FROM bookings WHERE id = ?"
    ).bind(bookingId).first() as any
    
    if (!booking) {
      return c.json({ success: false, error: 'Booking not found' }, 404)
    }
    
    const isComplete = formData.form_status === 'completed'
    
    if (existingForm) {
      // Update existing form
      await DB.prepare(`
        UPDATE wedding_event_forms SET
          form_status = ?,
          partner1_full_name = ?, partner1_phone = ?, partner1_email = ?,
          partner2_full_name = ?, partner2_phone = ?, partner2_email = ?,
          couple_hashtag = ?, how_they_met = ?,
          ceremony_location = ?, ceremony_time = ?, officiant_name = ?,
          mic_needed_for_officiant = ?, processional_song = ?, bridesmaids_processional_song = ?,
          recessional_song = ?, ceremony_readers = ?, unity_ceremony = ?,
          unity_ceremony_song = ?, ceremony_special_notes = ?,
          cocktail_start_time = ?, cocktail_end_time = ?, cocktail_location = ?,
          cocktail_music_vibe = ?, cocktail_special_requests = ?,
          reception_start_time = ?, grand_entrance_style = ?, grand_entrance_song = ?,
          first_dance_song = ?, first_dance_style = ?, first_dance_notes = ?,
          father_daughter_song = ?, father_daughter_notes = ?,
          mother_son_song = ?, mother_son_notes = ?,
          cake_cutting_song = ?, bouquet_toss = ?, bouquet_toss_song = ?,
          garter_toss = ?, garter_toss_song = ?,
          money_dance = ?, money_dance_song = ?,
          anniversary_dance = ?, last_dance_song = ?,
          send_off_song = ?, send_off_style = ?,
          bridal_party_json = ?, flower_girl_name = ?, ring_bearer_name = ?,
          vip_family_json = ?, memorial_tribute = ?, memorial_tribute_details = ?,
          special_announcements = ?,
          music_genres_preferred = ?, music_genres_avoid = ?,
          must_play_songs = ?, do_not_play_songs = ?,
          dinner_music_vibe = ?, dance_floor_energy = ?, clean_music_only = ?,
          music_notes = ?,
          toast_speakers_json = ?, toast_mic_preference = ?, toast_time_limit = ?,
          dj_setup_time = ?, power_location = ?, indoor_outdoor = ?,
          rain_plan = ?, dj_placement = ?, dance_floor_size = ?, lighting_notes = ?,
          wants_uplighting = ?, uplighting_color = ?, wants_karaoke = ?,
          wants_fog_machine = ?, wants_photobooth = ?, photobooth_coordination_notes = ?,
          other_vendors = ?, vendor_contact_info = ?,
          last_saved_section = ?,
          completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE completed_at END,
          updated_at = datetime('now')
        WHERE booking_id = ?
      `).bind(
        formData.form_status || 'in_progress',
        formData.partner1_full_name || '', formData.partner1_phone || '', formData.partner1_email || '',
        formData.partner2_full_name || '', formData.partner2_phone || '', formData.partner2_email || '',
        formData.couple_hashtag || '', formData.how_they_met || '',
        formData.ceremony_location || '', formData.ceremony_time || '', formData.officiant_name || '',
        formData.mic_needed_for_officiant ? 1 : 0, formData.processional_song || '', formData.bridesmaids_processional_song || '',
        formData.recessional_song || '', formData.ceremony_readers || '', formData.unity_ceremony || '',
        formData.unity_ceremony_song || '', formData.ceremony_special_notes || '',
        formData.cocktail_start_time || '', formData.cocktail_end_time || '', formData.cocktail_location || '',
        formData.cocktail_music_vibe || '', formData.cocktail_special_requests || '',
        formData.reception_start_time || '', formData.grand_entrance_style || '', formData.grand_entrance_song || '',
        formData.first_dance_song || '', formData.first_dance_style || '', formData.first_dance_notes || '',
        formData.father_daughter_song || '', formData.father_daughter_notes || '',
        formData.mother_son_song || '', formData.mother_son_notes || '',
        formData.cake_cutting_song || '', formData.bouquet_toss ? 1 : 0, formData.bouquet_toss_song || '',
        formData.garter_toss ? 1 : 0, formData.garter_toss_song || '',
        formData.money_dance ? 1 : 0, formData.money_dance_song || '',
        formData.anniversary_dance ? 1 : 0, formData.last_dance_song || '',
        formData.send_off_song || '', formData.send_off_style || '',
        typeof formData.bridal_party_json === 'string' ? formData.bridal_party_json : JSON.stringify(formData.bridal_party_json || []),
        formData.flower_girl_name || '', formData.ring_bearer_name || '',
        typeof formData.vip_family_json === 'string' ? formData.vip_family_json : JSON.stringify(formData.vip_family_json || []),
        formData.memorial_tribute || '', formData.memorial_tribute_details || '',
        formData.special_announcements || '',
        typeof formData.music_genres_preferred === 'string' ? formData.music_genres_preferred : JSON.stringify(formData.music_genres_preferred || []),
        typeof formData.music_genres_avoid === 'string' ? formData.music_genres_avoid : JSON.stringify(formData.music_genres_avoid || []),
        typeof formData.must_play_songs === 'string' ? formData.must_play_songs : JSON.stringify(formData.must_play_songs || []),
        typeof formData.do_not_play_songs === 'string' ? formData.do_not_play_songs : JSON.stringify(formData.do_not_play_songs || []),
        formData.dinner_music_vibe || '', formData.dance_floor_energy || '', formData.clean_music_only ? 1 : 0,
        formData.music_notes || '',
        typeof formData.toast_speakers_json === 'string' ? formData.toast_speakers_json : JSON.stringify(formData.toast_speakers_json || []),
        formData.toast_mic_preference || '', formData.toast_time_limit || '',
        formData.dj_setup_time || '', formData.power_location || '', formData.indoor_outdoor || '',
        formData.rain_plan || '', formData.dj_placement || '', formData.dance_floor_size || '', formData.lighting_notes || '',
        formData.wants_uplighting ? 1 : 0, formData.uplighting_color || '', formData.wants_karaoke ? 1 : 0,
        formData.wants_fog_machine ? 1 : 0, formData.wants_photobooth ? 1 : 0, formData.photobooth_coordination_notes || '',
        formData.other_vendors || '', typeof formData.vendor_contact_info === 'string' ? formData.vendor_contact_info : JSON.stringify(formData.vendor_contact_info || ''),
        formData.last_saved_section || '',
        isComplete ? 1 : 0,
        bookingId
      ).run()
    } else {
      // Create new form
      await DB.prepare(`
        INSERT INTO wedding_event_forms (
          booking_id, user_id, form_status,
          partner1_full_name, partner1_phone, partner1_email,
          partner2_full_name, partner2_phone, partner2_email,
          couple_hashtag, how_they_met,
          ceremony_location, ceremony_time, officiant_name,
          mic_needed_for_officiant, processional_song, bridesmaids_processional_song,
          recessional_song, ceremony_readers, unity_ceremony,
          unity_ceremony_song, ceremony_special_notes,
          cocktail_start_time, cocktail_end_time, cocktail_location,
          cocktail_music_vibe, cocktail_special_requests,
          reception_start_time, grand_entrance_style, grand_entrance_song,
          first_dance_song, first_dance_style, first_dance_notes,
          father_daughter_song, father_daughter_notes,
          mother_son_song, mother_son_notes,
          cake_cutting_song, bouquet_toss, bouquet_toss_song,
          garter_toss, garter_toss_song,
          money_dance, money_dance_song,
          anniversary_dance, last_dance_song,
          send_off_song, send_off_style,
          bridal_party_json, flower_girl_name, ring_bearer_name,
          vip_family_json, memorial_tribute, memorial_tribute_details,
          special_announcements,
          music_genres_preferred, music_genres_avoid,
          must_play_songs, do_not_play_songs,
          dinner_music_vibe, dance_floor_energy, clean_music_only,
          music_notes,
          toast_speakers_json, toast_mic_preference, toast_time_limit,
          dj_setup_time, power_location, indoor_outdoor,
          rain_plan, dj_placement, dance_floor_size, lighting_notes,
          wants_uplighting, uplighting_color, wants_karaoke,
          wants_fog_machine, wants_photobooth, photobooth_coordination_notes,
          other_vendors, vendor_contact_info,
          last_saved_section,
          completed_at
        ) VALUES (
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?,
          CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END
        )
      `).bind(
        bookingId, booking.user_id, formData.form_status || 'in_progress',
        formData.partner1_full_name || '', formData.partner1_phone || '', formData.partner1_email || '',
        formData.partner2_full_name || '', formData.partner2_phone || '', formData.partner2_email || '',
        formData.couple_hashtag || '', formData.how_they_met || '',
        formData.ceremony_location || '', formData.ceremony_time || '', formData.officiant_name || '',
        formData.mic_needed_for_officiant ? 1 : 0, formData.processional_song || '', formData.bridesmaids_processional_song || '',
        formData.recessional_song || '', formData.ceremony_readers || '', formData.unity_ceremony || '',
        formData.unity_ceremony_song || '', formData.ceremony_special_notes || '',
        formData.cocktail_start_time || '', formData.cocktail_end_time || '', formData.cocktail_location || '',
        formData.cocktail_music_vibe || '', formData.cocktail_special_requests || '',
        formData.reception_start_time || '', formData.grand_entrance_style || '', formData.grand_entrance_song || '',
        formData.first_dance_song || '', formData.first_dance_style || '', formData.first_dance_notes || '',
        formData.father_daughter_song || '', formData.father_daughter_notes || '',
        formData.mother_son_song || '', formData.mother_son_notes || '',
        formData.cake_cutting_song || '', formData.bouquet_toss ? 1 : 0, formData.bouquet_toss_song || '',
        formData.garter_toss ? 1 : 0, formData.garter_toss_song || '',
        formData.money_dance ? 1 : 0, formData.money_dance_song || '',
        formData.anniversary_dance ? 1 : 0, formData.last_dance_song || '',
        formData.send_off_song || '', formData.send_off_style || '',
        typeof formData.bridal_party_json === 'string' ? formData.bridal_party_json : JSON.stringify(formData.bridal_party_json || []),
        formData.flower_girl_name || '', formData.ring_bearer_name || '',
        typeof formData.vip_family_json === 'string' ? formData.vip_family_json : JSON.stringify(formData.vip_family_json || []),
        formData.memorial_tribute || '', formData.memorial_tribute_details || '',
        formData.special_announcements || '',
        typeof formData.music_genres_preferred === 'string' ? formData.music_genres_preferred : JSON.stringify(formData.music_genres_preferred || []),
        typeof formData.music_genres_avoid === 'string' ? formData.music_genres_avoid : JSON.stringify(formData.music_genres_avoid || []),
        typeof formData.must_play_songs === 'string' ? formData.must_play_songs : JSON.stringify(formData.must_play_songs || []),
        typeof formData.do_not_play_songs === 'string' ? formData.do_not_play_songs : JSON.stringify(formData.do_not_play_songs || []),
        formData.dinner_music_vibe || '', formData.dance_floor_energy || '', formData.clean_music_only ? 1 : 0,
        formData.music_notes || '',
        typeof formData.toast_speakers_json === 'string' ? formData.toast_speakers_json : JSON.stringify(formData.toast_speakers_json || []),
        formData.toast_mic_preference || '', formData.toast_time_limit || '',
        formData.dj_setup_time || '', formData.power_location || '', formData.indoor_outdoor || '',
        formData.rain_plan || '', formData.dj_placement || '', formData.dance_floor_size || '', formData.lighting_notes || '',
        formData.wants_uplighting ? 1 : 0, formData.uplighting_color || '', formData.wants_karaoke ? 1 : 0,
        formData.wants_fog_machine ? 1 : 0, formData.wants_photobooth ? 1 : 0, formData.photobooth_coordination_notes || '',
        formData.other_vendors || '', typeof formData.vendor_contact_info === 'string' ? formData.vendor_contact_info : JSON.stringify(formData.vendor_contact_info || ''),
        formData.last_saved_section || '',
        formData.form_status || 'in_progress'
      ).run()
    }
    
    // If form is completed, send summary emails
    if (isComplete) {
      const fullForm = await DB.prepare("SELECT * FROM wedding_event_forms WHERE booking_id = ?").bind(bookingId).first()
      const fullBooking = await DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first()
      const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(booking.user_id).first()
      
      if (fullForm && fullBooking && user) {
        await sendWeddingFormCompletedEmail(c.env, fullForm, fullBooking, user)
        
        // Mark emails as sent
        await DB.prepare(
          "UPDATE wedding_event_forms SET emailed_to_client = 1, emailed_to_dj = 1 WHERE booking_id = ?"
        ).bind(bookingId).run()
      }
    }
    
    return c.json({ success: true, message: isComplete ? 'Wedding form submitted successfully!' : 'Progress saved!' })
  } catch (error: any) {
    console.error('Wedding form save error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Trigger wedding form email manually (admin)
app.post('/api/wedding-form/:bookingId/send-email', async (c) => {
  try {
    const bookingId = c.req.param('bookingId')
    const { DB } = c.env
    
    const booking = await DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first() as any
    if (!booking) return c.json({ error: 'Booking not found' }, 404)
    
    const user = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(booking.user_id).first() as any
    if (!user) return c.json({ error: 'User not found' }, 404)
    
    // Create form record if it doesn't exist
    const existingForm = await DB.prepare("SELECT id FROM wedding_event_forms WHERE booking_id = ?").bind(bookingId).first()
    if (!existingForm) {
      await DB.prepare(
        "INSERT INTO wedding_event_forms (booking_id, user_id, form_status) VALUES (?, ?, 'pending')"
      ).bind(bookingId, booking.user_id).run()
    }
    
    const baseUrl = new URL(c.req.url).origin
    const formUrl = `${baseUrl}/wedding-planner/${bookingId}`
    
    await sendWeddingFormEmail(c.env, booking, user, formUrl)
    
    return c.json({ success: true, message: 'Wedding form email sent!', formUrl })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Get all wedding forms (admin)
app.get('/api/admin/wedding-forms', async (c) => {
  try {
    const { DB } = c.env
    const result = await DB.prepare(`
      SELECT 
        wf.*,
        b.event_date, b.service_provider, b.status as booking_status, b.total_price,
        u.full_name as client_name, u.email as client_email, u.phone as client_phone
      FROM wedding_event_forms wf
      JOIN bookings b ON wf.booking_id = b.id
      JOIN users u ON wf.user_id = u.id
      ORDER BY wf.updated_at DESC
    `).all()
    
    return c.json({ success: true, forms: result.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== AUTOMATIC INVOICING SYSTEM =====

// API: Create invoice for a booking
app.post('/api/invoices/create', async (c) => {
  try {
    const { DB } = c.env
    const body = await c.req.json()
    const { bookingId, notes, dueInDays } = body
    
    const booking = await DB.prepare(`
      SELECT b.*, u.full_name, u.email, u.phone, 
             e.event_name, e.event_type, e.street_address, e.city, e.state, e.zip_code, e.number_of_guests
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN event_details e ON b.id = e.booking_id
      WHERE b.id = ?
    `).bind(bookingId).first() as any
    
    if (!booking) return c.json({ error: 'Booking not found' }, 404)
    
    // Check for existing invoice
    const existingInvoice = await DB.prepare(
      "SELECT id FROM invoices WHERE booking_id = ?"
    ).bind(bookingId).first()
    
    if (existingInvoice) {
      return c.json({ error: 'Invoice already exists for this booking' }, 409)
    }
    
    const invoiceNumber = await generateInvoiceNumber(DB)
    const total = booking.total_price || 0
    const issueDate = new Date().toISOString().split('T')[0]
    const dueDate = new Date(Date.now() + (dueInDays || 14) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const nextReminder = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    // Build line items
    const providerName = booking.service_provider?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    const lineItems = [{
      service: providerName || booking.service_type,
      description: `${booking.event_type || booking.service_type} - ${booking.event_name || 'Event'} on ${booking.event_date}`,
      qty: 1,
      rate: total,
      amount: total
    }]
    
    const amountPaid = booking.payment_status === 'paid' ? total : 0
    const amountDue = total - amountPaid
    
    await DB.prepare(`
      INSERT INTO invoices (
        booking_id, user_id, invoice_number, status,
        subtotal, total, amount_paid, amount_due,
        line_items_json, issue_date, due_date,
        paid_date, next_reminder_date, notes, terms,
        auto_reminders
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      bookingId, booking.user_id, invoiceNumber,
      amountPaid >= total ? 'paid' : 'sent',
      total, total, amountPaid, amountDue,
      JSON.stringify(lineItems), issueDate, dueDate,
      amountPaid >= total ? issueDate : null,
      amountDue > 0 ? nextReminder : null,
      notes || '',
      'Payment is due within ' + (dueInDays || 14) + ' days. Late payments may incur additional fees.',
      1
    ).run()
    
    // Send invoice email to client
    const RESEND_API_KEY = c.env.RESEND_API_KEY
    if (RESEND_API_KEY && !RESEND_API_KEY.includes('mock')) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'In The House Productions <noreply@inthehouseproductions.com>',
          to: booking.email,
          subject: `Invoice ${invoiceNumber} - In The House Productions`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
              <h1 style="color: #E31E24; text-align: center;">INVOICE</h1>
              <p style="color: #FFD700; text-align: center; font-size: 24px; font-weight: bold;">${invoiceNumber}</p>
              
              <table style="width: 100%; color: #C0C0C0; margin: 20px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Client:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.full_name}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Event:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.event_name || 'N/A'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.event_date}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Issue Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${issueDate}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Due Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${dueDate}</td></tr>
              </table>
              
              <table style="width: 100%; color: #C0C0C0; margin: 20px 0; border-collapse: collapse;">
                <tr style="background: rgba(227,30,36,0.3);">
                  <th style="padding: 10px; text-align: left;">Service</th>
                  <th style="padding: 10px; text-align: right;">Amount</th>
                </tr>
                ${lineItems.map(item => `<tr><td style="padding: 10px; border-bottom: 1px solid #333;">${item.description}</td><td style="padding: 10px; border-bottom: 1px solid #333; text-align: right;">$${item.amount.toFixed(2)}</td></tr>`).join('')}
                <tr style="font-size: 18px; font-weight: bold;">
                  <td style="padding: 15px; color: #FFD700;">TOTAL</td>
                  <td style="padding: 15px; text-align: right; color: #FFD700;">$${total.toFixed(2)}</td>
                </tr>
                ${amountPaid > 0 ? `<tr><td style="padding: 10px; color: #22c55e;">Amount Paid</td><td style="padding: 10px; text-align: right; color: #22c55e;">-$${amountPaid.toFixed(2)}</td></tr>` : ''}
                ${amountDue > 0 ? `<tr style="font-size: 20px; font-weight: bold;"><td style="padding: 15px; color: #E31E24;">AMOUNT DUE</td><td style="padding: 15px; text-align: right; color: #E31E24;">$${amountDue.toFixed(2)}</td></tr>` : '<tr><td colspan="2" style="padding: 15px; text-align: center; color: #22c55e; font-size: 20px; font-weight: bold;">PAID IN FULL</td></tr>'}
              </table>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
                <p style="color: #888; font-size: 12px;">In The House Productions | (816) 217-1094</p>
                <p style="color: #666; font-size: 11px;">Payment is due within ${dueInDays || 14} days</p>
              </div>
            </div>
          `
        })
      })
    }
    
    return c.json({ success: true, invoiceNumber, status: amountPaid >= total ? 'paid' : 'sent' })
  } catch (error: any) {
    console.error('Invoice creation error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Get all invoices (admin)
app.get('/api/admin/invoices', async (c) => {
  try {
    const { DB } = c.env
    const result = await DB.prepare(`
      SELECT 
        i.*,
        u.full_name as client_name, u.email as client_email, u.phone as client_phone,
        b.event_date, b.service_type, b.service_provider
      FROM invoices i
      JOIN users u ON i.user_id = u.id
      JOIN bookings b ON i.booking_id = b.id
      ORDER BY i.created_at DESC
    `).all()
    
    return c.json({ success: true, invoices: result.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Get single invoice
app.get('/api/invoices/:invoiceId', async (c) => {
  try {
    const invoiceId = c.req.param('invoiceId')
    const { DB } = c.env
    
    const invoice = await DB.prepare(`
      SELECT 
        i.*,
        u.full_name as client_name, u.email as client_email, u.phone as client_phone,
        b.event_date, b.event_start_time, b.event_end_time, b.service_type, b.service_provider,
        e.event_name, e.event_type, e.street_address, e.city, e.state, e.zip_code
      FROM invoices i
      JOIN users u ON i.user_id = u.id
      JOIN bookings b ON i.booking_id = b.id
      LEFT JOIN event_details e ON b.id = e.booking_id
      WHERE i.id = ?
    `).bind(invoiceId).first()
    
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    
    return c.json({ success: true, invoice })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Update invoice status
app.post('/api/invoices/:invoiceId/status', async (c) => {
  try {
    const invoiceId = c.req.param('invoiceId')
    const { status } = await c.req.json()
    const { DB } = c.env
    
    const validStatuses = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'refunded']
    if (!validStatuses.includes(status)) {
      return c.json({ error: 'Invalid status' }, 400)
    }
    
    if (status === 'paid') {
      await DB.prepare(
        `UPDATE invoices SET status = ?, updated_at = datetime('now'), paid_date = date('now'), amount_due = 0, amount_paid = total WHERE id = ?`
      ).bind(status, invoiceId).run()
    } else {
      await DB.prepare(
        `UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(status, invoiceId).run()
    }
    
    // Also update booking payment status if invoice is marked paid
    if (status === 'paid') {
      const invoice = await DB.prepare("SELECT booking_id FROM invoices WHERE id = ?").bind(invoiceId).first() as any
      if (invoice) {
        await DB.prepare("UPDATE bookings SET payment_status = 'paid', status = 'confirmed' WHERE id = ?")
          .bind(invoice.booking_id).run()
      }
    }
    
    return c.json({ success: true, message: 'Invoice status updated' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Send invoice reminder
app.post('/api/invoices/:invoiceId/send-reminder', async (c) => {
  try {
    const invoiceId = c.req.param('invoiceId')
    const { DB } = c.env
    
    const invoice = await DB.prepare(`
      SELECT i.*, u.full_name, u.email
      FROM invoices i
      JOIN users u ON i.user_id = u.id
      WHERE i.id = ?
    `).bind(invoiceId).first() as any
    
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
    if (invoice.status === 'paid') return c.json({ error: 'Invoice already paid' }, 400)
    
    const RESEND_API_KEY = c.env.RESEND_API_KEY
    if (RESEND_API_KEY && !RESEND_API_KEY.includes('mock')) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'In The House Productions <noreply@inthehouseproductions.com>',
          to: invoice.email,
          subject: `Payment Reminder - Invoice ${invoice.invoice_number} ($${invoice.amount_due.toFixed(2)} due)`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; color: #fff; padding: 30px; border-radius: 15px;">
              <h1 style="color: #FFD700; text-align: center;">Payment Reminder</h1>
              <p style="color: #C0C0C0; text-align: center;">Invoice ${invoice.invoice_number}</p>
              
              <div style="background: rgba(227,30,36,0.15); border: 2px solid #E31E24; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center;">
                <p style="color: #E31E24; font-size: 28px; font-weight: bold; margin: 0;">$${invoice.amount_due.toFixed(2)}</p>
                <p style="color: #C0C0C0; margin: 5px 0 0 0;">Amount Due by ${invoice.due_date}</p>
              </div>
              
              <p style="color: #C0C0C0;">Hi ${invoice.full_name},</p>
              <p style="color: #C0C0C0; line-height: 1.6;">
                This is a friendly reminder that payment for your upcoming event is due. 
                Please contact us at (816) 217-1094 if you have any questions about your invoice.
              </p>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #333;">
                <p style="color: #666; font-size: 12px;">In The House Productions | (816) 217-1094</p>
              </div>
            </div>
          `
        })
      })
    }
    
    // Update reminder tracking
    const nextReminder = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await DB.prepare(`
      UPDATE invoices SET 
        reminder_sent_count = reminder_sent_count + 1,
        last_reminder_sent = datetime('now'),
        next_reminder_date = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(nextReminder, invoiceId).run()
    
    return c.json({ success: true, message: 'Reminder sent!' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// API: Auto-generate invoices for confirmed bookings without one
app.post('/api/invoices/auto-generate', async (c) => {
  try {
    const { DB } = c.env
    
    // Find confirmed bookings without invoices
    const bookingsWithoutInvoices = await DB.prepare(`
      SELECT b.id
      FROM bookings b
      LEFT JOIN invoices i ON b.id = i.booking_id
      WHERE i.id IS NULL AND b.status IN ('pending', 'confirmed')
      ORDER BY b.created_at DESC
    `).all()
    
    const generated: string[] = []
    
    for (const row of bookingsWithoutInvoices.results as any[]) {
      try {
        const invoiceNumber = await generateInvoiceNumber(DB)
        const booking = await DB.prepare(`
          SELECT b.*, e.event_name, e.event_type
          FROM bookings b
          LEFT JOIN event_details e ON b.id = e.booking_id
          WHERE b.id = ?
        `).bind(row.id).first() as any
        
        if (!booking) continue
        
        const total = booking.total_price || 0
        const issueDate = new Date().toISOString().split('T')[0]
        const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        const amountPaid = booking.payment_status === 'paid' ? total : 0
        
        const providerName = booking.service_provider?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
        const lineItems = [{
          service: providerName || booking.service_type,
          description: `${booking.event_type || booking.service_type} - ${booking.event_name || 'Event'} on ${booking.event_date}`,
          qty: 1, rate: total, amount: total
        }]
        
        await DB.prepare(`
          INSERT INTO invoices (
            booking_id, user_id, invoice_number, status,
            subtotal, total, amount_paid, amount_due,
            line_items_json, issue_date, due_date,
            paid_date, auto_reminders, terms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          row.id, booking.user_id, invoiceNumber,
          amountPaid >= total ? 'paid' : 'sent',
          total, total, amountPaid, total - amountPaid,
          JSON.stringify(lineItems), issueDate, dueDate,
          amountPaid >= total ? issueDate : null,
          1, 'Payment is due within 14 days.'
        ).run()
        
        generated.push(invoiceNumber)
      } catch (err) {
        console.error(`Failed to generate invoice for booking ${row.id}:`, err)
      }
    }
    
    return c.json({ success: true, generated: generated.length, invoiceNumbers: generated })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Admin: Fix orphaned bookings missing event_details
app.post('/api/admin/fix-event-details', async (c) => {
  try {
    const { DB } = c.env
    
    // Find bookings without event_details
    const orphaned = await DB.prepare(`
      SELECT b.id, b.service_type, b.service_provider, b.event_date, b.event_start_time, b.event_end_time
      FROM bookings b
      LEFT JOIN event_details ed ON b.id = ed.booking_id
      WHERE ed.id IS NULL
    `).all()
    
    let fixed = 0
    for (const booking of (orphaned.results || []) as any[]) {
      await DB.prepare(`
        INSERT INTO event_details (
          booking_id, event_name, event_type, 
          street_address, city, state, zip_code,
          number_of_guests, special_requests, created_at
        ) VALUES (?, ?, ?, '', '', '', '', 0, 'Auto-generated: original event details missing', datetime('now'))
      `).bind(
        booking.id,
        `${booking.service_type} Event - ${booking.event_date}`,
        booking.service_type || 'party'
      ).run()
      fixed++
    }
    
    return c.json({ success: true, fixed, orphanedCount: orphaned.results?.length || 0 })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== WEDDING PLANNER FORM PAGE =====
app.get('/wedding-planner/:bookingId', (c) => {
  const bookingId = escapeHtml(c.req.param('bookingId'))
  const refersionKey = c.env.REFERSION_PUBLIC_KEY
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Wedding Planning Form - In The House Productions</title>
        ${generateRefersionTrackingScript(refersionKey)}
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="/static/ultra-3d.css" rel="stylesheet">
        <style>
          :root { --primary-red: #E31E24; --chrome-silver: #C0C0C0; --gold: #FFD700; --deep-black: #000; }
          body { background: #000; color: #fff; font-family: 'Arial', sans-serif; }
          .form-wrapper { max-width: 900px; margin: 0 auto; padding: 1rem; }
          .section-card { background: rgba(20,20,20,0.95); border: 2px solid #333; border-radius: 15px; padding: 1.5rem; margin-bottom: 1.5rem; transition: border-color 0.3s; }
          .section-card.active { border-color: var(--primary-red); box-shadow: 0 0 20px rgba(227,30,36,0.2); }
          .section-card.completed { border-color: #22c55e; }
          .section-header { display: flex; align-items: center; cursor: pointer; padding: 0.5rem 0; }
          .section-header h2 { font-size: 1.3rem; font-weight: bold; color: var(--gold); margin: 0; flex: 1; }
          .section-number { width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.9rem; margin-right: 12px; background: #333; color: #888; flex-shrink: 0; }
          .section-number.active { background: var(--primary-red); color: #fff; }
          .section-number.completed { background: #22c55e; color: #fff; }
          .section-body { display: none; padding-top: 1rem; }
          .section-body.open { display: block; }
          .form-group { margin-bottom: 1.2rem; }
          .form-label { display: block; color: var(--chrome-silver); font-weight: bold; margin-bottom: 0.4rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px; }
          .form-input, .form-select, .form-textarea { width: 100%; padding: 0.65rem; background: rgba(0,0,0,0.6); border: 2px solid #444; border-radius: 8px; color: #fff; font-size: 0.95rem; transition: border-color 0.3s; box-sizing: border-box; }
          .form-input:focus, .form-select:focus, .form-textarea:focus { outline: none; border-color: var(--primary-red); box-shadow: 0 0 10px rgba(227,30,36,0.2); }
          .form-textarea { resize: vertical; min-height: 80px; }
          .form-row { display: grid; gap: 1rem; }
          .form-row-2 { grid-template-columns: 1fr 1fr; }
          .form-row-3 { grid-template-columns: 1fr 1fr 1fr; }
          @media (max-width: 640px) { .form-row-2, .form-row-3 { grid-template-columns: 1fr; } }
          .checkbox-group { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem; }
          .checkbox-group input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--primary-red); }
          .checkbox-group label { color: var(--chrome-silver); cursor: pointer; }
          .btn { padding: 0.75rem 2rem; border: none; border-radius: 50px; font-weight: bold; cursor: pointer; transition: all 0.3s; text-transform: uppercase; letter-spacing: 1px; font-size: 0.95rem; }
          .btn-save { background: linear-gradient(135deg, #333, #555); color: #fff; border: 2px solid var(--chrome-silver); }
          .btn-save:hover { background: linear-gradient(135deg, #444, #666); transform: translateY(-2px); }
          .btn-submit { background: linear-gradient(135deg, var(--primary-red), #FF0040); color: #fff; border: 2px solid var(--chrome-silver); box-shadow: 0 0 20px rgba(227,30,36,0.4); }
          .btn-submit:hover { transform: translateY(-3px); box-shadow: 0 0 30px rgba(255,0,64,0.6); }
          .btn-next { background: linear-gradient(135deg, #333, #555); color: var(--gold); border: 2px solid var(--gold); }
          .btn-next:hover { background: var(--gold); color: #000; }
          .dynamic-list { margin-top: 0.5rem; }
          .dynamic-item { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; }
          .dynamic-item input { flex: 1; min-width: 120px; }
          .btn-remove { background: #DC3545; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 5px; cursor: pointer; font-size: 0.85rem; flex-shrink: 0; }
          .btn-add { background: none; border: 2px dashed #555; color: var(--chrome-silver); padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; width: 100%; margin-top: 0.5rem; transition: all 0.3s; }
          .btn-add:hover { border-color: var(--primary-red); color: var(--primary-red); }
          .genre-tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
          .genre-tag { padding: 0.4rem 1rem; border: 2px solid #555; border-radius: 20px; cursor: pointer; transition: all 0.3s; font-size: 0.85rem; color: #999; }
          .genre-tag.selected { border-color: var(--primary-red); background: rgba(227,30,36,0.2); color: #fff; }
          .genre-tag:hover { border-color: var(--primary-red); }
          .progress-bar { width: 100%; height: 6px; background: #333; border-radius: 3px; margin: 1rem 0; overflow: hidden; }
          .progress-fill { height: 100%; background: linear-gradient(90deg, var(--primary-red), var(--gold)); transition: width 0.5s ease; border-radius: 3px; }
          .save-indicator { position: fixed; top: 20px; right: 20px; background: #22c55e; color: #fff; padding: 0.5rem 1rem; border-radius: 8px; font-weight: bold; display: none; z-index: 9999; animation: fadeIn 0.3s; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
          .nav-dots { display: flex; justify-content: center; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
          .nav-dot { width: 12px; height: 12px; border-radius: 50%; background: #333; cursor: pointer; transition: all 0.3s; border: 2px solid #555; }
          .nav-dot.active { background: var(--primary-red); border-color: var(--primary-red); transform: scale(1.2); }
          .nav-dot.completed { background: #22c55e; border-color: #22c55e; }
          .success-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: none; align-items: center; justify-content: center; z-index: 10000; }
          .success-content { text-align: center; max-width: 500px; padding: 2rem; }
        </style>
    </head>
    <body>
        <div id="saveIndicator" class="save-indicator"><i class="fas fa-check mr-2"></i>Saved!</div>
        
        <div id="successOverlay" class="success-overlay">
          <div class="success-content">
            <i class="fas fa-check-circle text-green-500" style="font-size: 5rem;"></i>
            <h1 class="text-3xl font-bold mt-6 mb-4 text-green-400">Form Submitted!</h1>
            <p class="text-gray-300 text-lg mb-6">Your wedding planning form has been submitted. A copy has been emailed to you and your DJ will review everything.</p>
            <a href="/" class="btn btn-submit"><i class="fas fa-home mr-2"></i>Return Home</a>
          </div>
        </div>
        
        <div class="form-wrapper">
            <!-- Header -->
            <div class="text-center mb-6" style="padding-top: 1rem;">
                <h1 style="font-size: 2rem; color: var(--gold); font-weight: bold; text-shadow: 0 0 10px rgba(255,215,0,0.3);">
                  <i class="fas fa-ring mr-2"></i>Wedding Planning Form
                </h1>
                <p class="text-gray-400 mt-2">Help us make your big day perfect!</p>
                <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width: 0%"></div></div>
                <p class="text-sm text-gray-500" id="progressText">0% Complete</p>
            </div>
            
            <!-- Section Navigation Dots -->
            <div class="nav-dots" id="navDots"></div>
            
            <form id="weddingForm">
            
            <!-- SECTION 1: Couple Information -->
            <div class="section-card" id="section1" data-section="1">
              <div class="section-header" onclick="toggleSection(1)">
                <div class="section-number" id="sectionNum1">1</div>
                <h2><i class="fas fa-heart mr-2" style="color: var(--primary-red);"></i>Couple Information</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron1"></i>
              </div>
              <div class="section-body open" id="sectionBody1">
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Partner 1 Full Name *</label><input type="text" class="form-input" name="partner1_full_name" required></div>
                  <div class="form-group"><label class="form-label">Partner 2 Full Name *</label><input type="text" class="form-input" name="partner2_full_name" required></div>
                </div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Partner 1 Phone</label><input type="tel" class="form-input" name="partner1_phone"></div>
                  <div class="form-group"><label class="form-label">Partner 2 Phone</label><input type="tel" class="form-input" name="partner2_phone"></div>
                </div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Partner 1 Email</label><input type="email" class="form-input" name="partner1_email"></div>
                  <div class="form-group"><label class="form-label">Partner 2 Email</label><input type="email" class="form-input" name="partner2_email"></div>
                </div>
                <div class="form-group"><label class="form-label">Wedding Hashtag</label><input type="text" class="form-input" name="couple_hashtag" placeholder="#SmithJonesWedding"></div>
                <div class="form-group"><label class="form-label">How Did You Meet? (optional)</label><textarea class="form-textarea" name="how_they_met" placeholder="Your love story..."></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(2)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 2: Ceremony Details -->
            <div class="section-card" id="section2" data-section="2">
              <div class="section-header" onclick="toggleSection(2)">
                <div class="section-number" id="sectionNum2">2</div>
                <h2><i class="fas fa-church mr-2" style="color: var(--primary-red);"></i>Ceremony Details</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron2"></i>
              </div>
              <div class="section-body" id="sectionBody2">
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Ceremony Location</label><input type="text" class="form-input" name="ceremony_location" placeholder="Same as reception or different?"></div>
                  <div class="form-group"><label class="form-label">Ceremony Time</label><input type="time" class="form-input" name="ceremony_time"></div>
                </div>
                <div class="form-group"><label class="form-label">Officiant Name</label><input type="text" class="form-input" name="officiant_name"></div>
                <div class="checkbox-group"><input type="checkbox" id="micOfficiant" name="mic_needed_for_officiant"><label for="micOfficiant">Mic needed for officiant?</label></div>
                <div class="form-group"><label class="form-label">Processional Song (Bride walking down aisle)</label><input type="text" class="form-input" name="processional_song" placeholder="Song - Artist"></div>
                <div class="form-group"><label class="form-label">Bridesmaids Processional Song</label><input type="text" class="form-input" name="bridesmaids_processional_song" placeholder="Song - Artist (leave blank if same)"></div>
                <div class="form-group"><label class="form-label">Recessional Song (Walking out as married couple)</label><input type="text" class="form-input" name="recessional_song" placeholder="Song - Artist"></div>
                <div class="form-group"><label class="form-label">Ceremony Readers</label><input type="text" class="form-input" name="ceremony_readers" placeholder="Names of anyone doing readings"></div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Unity Ceremony</label>
                    <select class="form-select" name="unity_ceremony">
                      <option value="">None</option><option value="sand">Sand Ceremony</option><option value="candle">Unity Candle</option>
                      <option value="handfasting">Handfasting</option><option value="wine">Wine Ceremony</option><option value="other">Other</option>
                    </select>
                  </div>
                  <div class="form-group"><label class="form-label">Unity Ceremony Song</label><input type="text" class="form-input" name="unity_ceremony_song" placeholder="Song - Artist"></div>
                </div>
                <div class="form-group"><label class="form-label">Ceremony Special Notes</label><textarea class="form-textarea" name="ceremony_special_notes" placeholder="Anything else about the ceremony..."></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(3)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 3: Cocktail Hour -->
            <div class="section-card" id="section3" data-section="3">
              <div class="section-header" onclick="toggleSection(3)">
                <div class="section-number" id="sectionNum3">3</div>
                <h2><i class="fas fa-cocktail mr-2" style="color: var(--primary-red);"></i>Cocktail Hour</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron3"></i>
              </div>
              <div class="section-body" id="sectionBody3">
                <div class="form-row form-row-3">
                  <div class="form-group"><label class="form-label">Start Time</label><input type="time" class="form-input" name="cocktail_start_time"></div>
                  <div class="form-group"><label class="form-label">End Time</label><input type="time" class="form-input" name="cocktail_end_time"></div>
                  <div class="form-group"><label class="form-label">Location</label><input type="text" class="form-input" name="cocktail_location" placeholder="Same room, patio, etc."></div>
                </div>
                <div class="form-group"><label class="form-label">Music Vibe</label>
                  <select class="form-select" name="cocktail_music_vibe">
                    <option value="">Select...</option><option value="jazz">Jazz / Smooth</option><option value="acoustic">Acoustic / Soft</option>
                    <option value="lounge">Lounge / Chill</option><option value="upbeat">Upbeat Background</option><option value="classical">Classical</option>
                    <option value="no_preference">No Preference</option>
                  </select>
                </div>
                <div class="form-group"><label class="form-label">Special Requests</label><textarea class="form-textarea" name="cocktail_special_requests" placeholder="Any special requests for cocktail hour..."></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(4)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 4: Reception Timeline -->
            <div class="section-card" id="section4" data-section="4">
              <div class="section-header" onclick="toggleSection(4)">
                <div class="section-number" id="sectionNum4">4</div>
                <h2><i class="fas fa-music mr-2" style="color: var(--primary-red);"></i>Reception & Key Moments</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron4"></i>
              </div>
              <div class="section-body" id="sectionBody4">
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Reception Start Time</label><input type="time" class="form-input" name="reception_start_time"></div>
                  <div class="form-group"><label class="form-label">Grand Entrance Style</label>
                    <select class="form-select" name="grand_entrance_style">
                      <option value="">Select...</option><option value="announced">Announced by DJ</option><option value="walk_in">Casual Walk-in</option>
                      <option value="choreographed">Choreographed Entrance</option><option value="surprise">Surprise Entrance</option>
                    </select>
                  </div>
                </div>
                <div class="form-group"><label class="form-label">Grand Entrance Song</label><input type="text" class="form-input" name="grand_entrance_song" placeholder="Song - Artist"></div>
                
                <h3 style="color: var(--gold); margin: 1.5rem 0 0.8rem; font-size: 1.1rem;"><i class="fas fa-star mr-2"></i>First Dance</h3>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">First Dance Song *</label><input type="text" class="form-input" name="first_dance_song" placeholder="Song - Artist"></div>
                  <div class="form-group"><label class="form-label">Dance Style</label>
                    <select class="form-select" name="first_dance_style">
                      <option value="">Select...</option><option value="traditional">Traditional / Slow</option><option value="choreographed">Choreographed</option>
                      <option value="mashup">Mashup (slow then upbeat)</option><option value="surprise">Surprise</option>
                    </select>
                  </div>
                </div>
                <div class="form-group"><label class="form-label">First Dance Notes</label><input type="text" class="form-input" name="first_dance_notes" placeholder="Anything the DJ should know about the first dance?"></div>
                
                <h3 style="color: var(--gold); margin: 1.5rem 0 0.8rem; font-size: 1.1rem;"><i class="fas fa-heart mr-2"></i>Parent Dances</h3>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Father/Daughter Dance Song</label><input type="text" class="form-input" name="father_daughter_song" placeholder="Song - Artist"></div>
                  <div class="form-group"><label class="form-label">Mother/Son Dance Song</label><input type="text" class="form-input" name="mother_son_song" placeholder="Song - Artist"></div>
                </div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Father/Daughter Notes</label><input type="text" class="form-input" name="father_daughter_notes" placeholder="Any special notes?"></div>
                  <div class="form-group"><label class="form-label">Mother/Son Notes</label><input type="text" class="form-input" name="mother_son_notes" placeholder="Any special notes?"></div>
                </div>
                
                <h3 style="color: var(--gold); margin: 1.5rem 0 0.8rem; font-size: 1.1rem;"><i class="fas fa-calendar-check mr-2"></i>Special Moments</h3>
                <div class="form-group"><label class="form-label">Cake Cutting Song</label><input type="text" class="form-input" name="cake_cutting_song" placeholder="Song - Artist"></div>
                <div class="form-row form-row-2">
                  <div><div class="checkbox-group"><input type="checkbox" id="bouquetToss" name="bouquet_toss"><label for="bouquetToss">Bouquet Toss</label></div>
                    <div class="form-group"><label class="form-label">Bouquet Toss Song</label><input type="text" class="form-input" name="bouquet_toss_song" placeholder="Song - Artist"></div></div>
                  <div><div class="checkbox-group"><input type="checkbox" id="garterToss" name="garter_toss"><label for="garterToss">Garter Toss</label></div>
                    <div class="form-group"><label class="form-label">Garter Toss Song</label><input type="text" class="form-input" name="garter_toss_song" placeholder="Song - Artist"></div></div>
                </div>
                <div class="form-row form-row-2">
                  <div><div class="checkbox-group"><input type="checkbox" id="moneyDance" name="money_dance"><label for="moneyDance">Money Dance</label></div>
                    <div class="form-group"><label class="form-label">Money Dance Song</label><input type="text" class="form-input" name="money_dance_song" placeholder="Song - Artist"></div></div>
                  <div><div class="checkbox-group"><input type="checkbox" id="anniversaryDance" name="anniversary_dance"><label for="anniversaryDance">Anniversary Dance (Longest Married)</label></div></div>
                </div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">Last Dance Song</label><input type="text" class="form-input" name="last_dance_song" placeholder="Song - Artist"></div>
                  <div class="form-group"><label class="form-label">Send-Off Song</label><input type="text" class="form-input" name="send_off_song" placeholder="Song - Artist"></div>
                </div>
                <div class="form-group"><label class="form-label">Send-Off Style</label>
                  <select class="form-select" name="send_off_style">
                    <option value="">Select...</option><option value="sparklers">Sparklers</option><option value="bubbles">Bubbles</option>
                    <option value="confetti">Confetti</option><option value="lanterns">Lanterns</option><option value="petals">Flower Petals</option>
                    <option value="none">No Send-Off</option><option value="other">Other</option>
                  </select>
                </div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(5)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 5: Bridal Party -->
            <div class="section-card" id="section5" data-section="5">
              <div class="section-header" onclick="toggleSection(5)">
                <div class="section-number" id="sectionNum5">5</div>
                <h2><i class="fas fa-users mr-2" style="color: var(--primary-red);"></i>Bridal Party</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron5"></i>
              </div>
              <div class="section-body" id="sectionBody5">
                <p class="text-gray-400 text-sm mb-4">List your bridal party members in the order they should be announced during the grand entrance.</p>
                <div id="bridalPartyList" class="dynamic-list"></div>
                <button type="button" class="btn-add" onclick="addBridalPartyMember()"><i class="fas fa-plus mr-2"></i>Add Bridal Party Member</button>
                <div class="form-row form-row-2 mt-4">
                  <div class="form-group"><label class="form-label">Flower Girl Name</label><input type="text" class="form-input" name="flower_girl_name"></div>
                  <div class="form-group"><label class="form-label">Ring Bearer Name</label><input type="text" class="form-input" name="ring_bearer_name"></div>
                </div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(6)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 6: VIP & Family -->
            <div class="section-card" id="section6" data-section="6">
              <div class="section-header" onclick="toggleSection(6)">
                <div class="section-number" id="sectionNum6">6</div>
                <h2><i class="fas fa-star mr-2" style="color: var(--primary-red);"></i>VIP & Family</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron6"></i>
              </div>
              <div class="section-body" id="sectionBody6">
                <p class="text-gray-400 text-sm mb-4">Important family members to recognize or be aware of.</p>
                <div id="vipFamilyList" class="dynamic-list"></div>
                <button type="button" class="btn-add" onclick="addVipMember()"><i class="fas fa-plus mr-2"></i>Add VIP / Family Member</button>
                <div class="form-group mt-4"><label class="form-label">Memorial Tribute (In memory of...)</label><input type="text" class="form-input" name="memorial_tribute" placeholder="Name(s) of those being remembered"></div>
                <div class="form-group"><label class="form-label">Memorial Details</label><textarea class="form-textarea" name="memorial_tribute_details" placeholder="How would you like this handled? (moment of silence, reserved seat, candle, etc.)"></textarea></div>
                <div class="form-group"><label class="form-label">Special Announcements</label><textarea class="form-textarea" name="special_announcements" placeholder="Birthdays, anniversaries, or other announcements at the event?"></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(7)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 7: Music Preferences -->
            <div class="section-card" id="section7" data-section="7">
              <div class="section-header" onclick="toggleSection(7)">
                <div class="section-number" id="sectionNum7">7</div>
                <h2><i class="fas fa-headphones mr-2" style="color: var(--primary-red);"></i>Music Preferences</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron7"></i>
              </div>
              <div class="section-body" id="sectionBody7">
                <div class="form-group"><label class="form-label">Genres You LOVE (click to select)</label>
                  <div class="genre-tags" id="genresPreferred">
                    <span class="genre-tag" data-genre="top40" onclick="toggleGenre(this,'preferred')">Top 40</span>
                    <span class="genre-tag" data-genre="hiphop" onclick="toggleGenre(this,'preferred')">Hip-Hop</span>
                    <span class="genre-tag" data-genre="rnb" onclick="toggleGenre(this,'preferred')">R&B</span>
                    <span class="genre-tag" data-genre="country" onclick="toggleGenre(this,'preferred')">Country</span>
                    <span class="genre-tag" data-genre="rock" onclick="toggleGenre(this,'preferred')">Rock</span>
                    <span class="genre-tag" data-genre="pop" onclick="toggleGenre(this,'preferred')">Pop</span>
                    <span class="genre-tag" data-genre="edm" onclick="toggleGenre(this,'preferred')">EDM / Dance</span>
                    <span class="genre-tag" data-genre="latin" onclick="toggleGenre(this,'preferred')">Latin</span>
                    <span class="genre-tag" data-genre="jazz" onclick="toggleGenre(this,'preferred')">Jazz</span>
                    <span class="genre-tag" data-genre="motown" onclick="toggleGenre(this,'preferred')">Motown / Soul</span>
                    <span class="genre-tag" data-genre="80s" onclick="toggleGenre(this,'preferred')">80s</span>
                    <span class="genre-tag" data-genre="90s" onclick="toggleGenre(this,'preferred')">90s</span>
                    <span class="genre-tag" data-genre="2000s" onclick="toggleGenre(this,'preferred')">2000s</span>
                    <span class="genre-tag" data-genre="reggae" onclick="toggleGenre(this,'preferred')">Reggae</span>
                    <span class="genre-tag" data-genre="indie" onclick="toggleGenre(this,'preferred')">Indie</span>
                    <span class="genre-tag" data-genre="classical" onclick="toggleGenre(this,'preferred')">Classical</span>
                  </div>
                </div>
                <div class="form-group"><label class="form-label">Genres to AVOID</label>
                  <div class="genre-tags" id="genresAvoid">
                    <span class="genre-tag" data-genre="top40" onclick="toggleGenre(this,'avoid')">Top 40</span>
                    <span class="genre-tag" data-genre="hiphop" onclick="toggleGenre(this,'avoid')">Hip-Hop</span>
                    <span class="genre-tag" data-genre="rnb" onclick="toggleGenre(this,'avoid')">R&B</span>
                    <span class="genre-tag" data-genre="country" onclick="toggleGenre(this,'avoid')">Country</span>
                    <span class="genre-tag" data-genre="rock" onclick="toggleGenre(this,'avoid')">Rock</span>
                    <span class="genre-tag" data-genre="pop" onclick="toggleGenre(this,'avoid')">Pop</span>
                    <span class="genre-tag" data-genre="edm" onclick="toggleGenre(this,'avoid')">EDM / Dance</span>
                    <span class="genre-tag" data-genre="latin" onclick="toggleGenre(this,'avoid')">Latin</span>
                    <span class="genre-tag" data-genre="jazz" onclick="toggleGenre(this,'avoid')">Jazz</span>
                    <span class="genre-tag" data-genre="motown" onclick="toggleGenre(this,'avoid')">Motown / Soul</span>
                    <span class="genre-tag" data-genre="reggae" onclick="toggleGenre(this,'avoid')">Reggae</span>
                    <span class="genre-tag" data-genre="metal" onclick="toggleGenre(this,'avoid')">Metal</span>
                  </div>
                </div>
                
                <h3 style="color: #22c55e; margin: 1rem 0 0.5rem;"><i class="fas fa-check-circle mr-2"></i>Must-Play Songs</h3>
                <div id="mustPlayList" class="dynamic-list"></div>
                <button type="button" class="btn-add" onclick="addMustPlay()"><i class="fas fa-plus mr-2"></i>Add Must-Play Song</button>
                
                <h3 style="color: #E31E24; margin: 1rem 0 0.5rem;"><i class="fas fa-ban mr-2"></i>Do NOT Play Songs</h3>
                <div id="doNotPlayList" class="dynamic-list"></div>
                <button type="button" class="btn-add" onclick="addDoNotPlay()"><i class="fas fa-plus mr-2"></i>Add Do-Not-Play Song</button>
                
                <div class="form-row form-row-2 mt-4">
                  <div class="form-group"><label class="form-label">Dinner Music Vibe</label>
                    <select class="form-select" name="dinner_music_vibe">
                      <option value="">Select...</option><option value="background">Soft Background</option><option value="upbeat">Upbeat Background</option>
                      <option value="jazz">Jazz / Lounge</option><option value="acoustic">Acoustic</option><option value="no_preference">No Preference</option>
                    </select>
                  </div>
                  <div class="form-group"><label class="form-label">Dance Floor Energy Level</label>
                    <select class="form-select" name="dance_floor_energy">
                      <option value="">Select...</option><option value="low">Low / Chill</option><option value="medium">Medium / Mix</option>
                      <option value="high">High Energy</option><option value="insane">INSANE - Non-Stop Party!</option>
                    </select>
                  </div>
                </div>
                <div class="checkbox-group"><input type="checkbox" id="cleanOnly" name="clean_music_only"><label for="cleanOnly">Clean music only (no explicit lyrics)</label></div>
                <div class="form-group"><label class="form-label">Additional Music Notes</label><textarea class="form-textarea" name="music_notes" placeholder="Anything else about music preferences..."></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(8)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 8: Toasts & Speeches -->
            <div class="section-card" id="section8" data-section="8">
              <div class="section-header" onclick="toggleSection(8)">
                <div class="section-number" id="sectionNum8">8</div>
                <h2><i class="fas fa-glass-cheers mr-2" style="color: var(--primary-red);"></i>Toasts & Speeches</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron8"></i>
              </div>
              <div class="section-body" id="sectionBody8">
                <div id="toastSpeakersList" class="dynamic-list"></div>
                <button type="button" class="btn-add" onclick="addToastSpeaker()"><i class="fas fa-plus mr-2"></i>Add Toast Speaker</button>
                <div class="form-row form-row-2 mt-4">
                  <div class="form-group"><label class="form-label">Mic Preference</label>
                    <select class="form-select" name="toast_mic_preference">
                      <option value="">Select...</option><option value="wireless">Wireless Mic</option><option value="podium">Podium / Stand</option><option value="dj_announces">DJ Announces Them</option>
                    </select>
                  </div>
                  <div class="form-group"><label class="form-label">Time Limit per Speaker</label>
                    <select class="form-select" name="toast_time_limit">
                      <option value="">No Limit</option><option value="3">3 Minutes</option><option value="5">5 Minutes</option><option value="10">10 Minutes</option>
                    </select>
                  </div>
                </div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(9)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 9: Logistics -->
            <div class="section-card" id="section9" data-section="9">
              <div class="section-header" onclick="toggleSection(9)">
                <div class="section-number" id="sectionNum9">9</div>
                <h2><i class="fas fa-cog mr-2" style="color: var(--primary-red);"></i>Logistics & Setup</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron9"></i>
              </div>
              <div class="section-body" id="sectionBody9">
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">DJ Setup Time</label><input type="time" class="form-input" name="dj_setup_time"></div>
                  <div class="form-group"><label class="form-label">Indoor / Outdoor</label>
                    <select class="form-select" name="indoor_outdoor">
                      <option value="">Select...</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option><option value="both">Both</option>
                    </select>
                  </div>
                </div>
                <div class="form-group"><label class="form-label">Power Location Notes</label><input type="text" class="form-input" name="power_location" placeholder="Where are outlets? Extension cords needed?"></div>
                <div class="form-group"><label class="form-label">Rain Plan (if outdoor)</label><input type="text" class="form-input" name="rain_plan" placeholder="Move inside? Tent?"></div>
                <div class="form-row form-row-2">
                  <div class="form-group"><label class="form-label">DJ Placement</label><input type="text" class="form-input" name="dj_placement" placeholder="Where should DJ set up?"></div>
                  <div class="form-group"><label class="form-label">Dance Floor Size</label>
                    <select class="form-select" name="dance_floor_size">
                      <option value="">Select...</option><option value="small">Small (under 50 guests)</option><option value="medium">Medium (50-150 guests)</option><option value="large">Large (150+ guests)</option>
                    </select>
                  </div>
                </div>
                <div class="form-group"><label class="form-label">Lighting Notes</label><textarea class="form-textarea" name="lighting_notes" placeholder="String lights? Dim the lights for dances? Spotlight?"></textarea></div>
                <div class="text-right mt-4"><button type="button" class="btn btn-next" onclick="goToSection(10)">Next <i class="fas fa-arrow-right ml-2"></i></button></div>
              </div>
            </div>
            
            <!-- SECTION 10: Add-ons & Extras -->
            <div class="section-card" id="section10" data-section="10">
              <div class="section-header" onclick="toggleSection(10)">
                <div class="section-number" id="sectionNum10">10</div>
                <h2><i class="fas fa-magic mr-2" style="color: var(--primary-red);"></i>Add-ons & Other Vendors</h2>
                <i class="fas fa-chevron-down text-gray-500" id="chevron10"></i>
              </div>
              <div class="section-body" id="sectionBody10">
                <div class="checkbox-group"><input type="checkbox" id="wantsUplighting" name="wants_uplighting"><label for="wantsUplighting">Uplighting ($100/event)</label></div>
                <div class="form-group"><label class="form-label">Uplighting Color</label><input type="text" class="form-input" name="uplighting_color" placeholder="e.g., Blush pink, Navy, Gold, Match your colors"></div>
                <div class="checkbox-group"><input type="checkbox" id="wantsKaraoke" name="wants_karaoke"><label for="wantsKaraoke">Karaoke Add-on ($100/event)</label></div>
                <div class="checkbox-group"><input type="checkbox" id="wantsFog" name="wants_fog_machine"><label for="wantsFog">Fog Machine</label></div>
                <div class="checkbox-group"><input type="checkbox" id="wantsPhotobooth" name="wants_photobooth"><label for="wantsPhotobooth">Photobooth Coordination</label></div>
                <div class="form-group"><label class="form-label">Photobooth Notes</label><textarea class="form-textarea" name="photobooth_coordination_notes" placeholder="Timing, placement, coordination with DJ..."></textarea></div>
                <div class="form-group"><label class="form-label">Other Vendors (Photographer, Videographer, Coordinator)</label><textarea class="form-textarea" name="other_vendors" placeholder="List names so DJ can coordinate with them"></textarea></div>
                
                <div class="text-center mt-8" style="border-top: 2px solid #333; padding-top: 2rem;">
                  <p class="text-gray-400 mb-4">Ready to submit? You can also save and come back later.</p>
                  <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                    <button type="button" class="btn btn-save" onclick="saveProgress()"><i class="fas fa-save mr-2"></i>Save Progress</button>
                    <button type="submit" class="btn btn-submit"><i class="fas fa-paper-plane mr-2"></i>Submit Form</button>
                  </div>
                </div>
              </div>
            </div>
            
            </form>
            
            <!-- Floating Save Button -->
            <div style="position: fixed; bottom: 20px; right: 20px; z-index: 9998;">
              <button onclick="saveProgress()" class="btn btn-save" style="border-radius: 50%; width: 55px; height: 55px; padding: 0; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                <i class="fas fa-save" style="font-size: 1.2rem;"></i>
              </button>
            </div>
        </div>
        
        <script>
          const BOOKING_ID = '${bookingId}';
          const TOTAL_SECTIONS = 10;
          let currentSection = 1;
          let formData = {};
          let bridalParty = [];
          let vipFamily = [];
          let mustPlaySongs = [];
          let doNotPlaySongs = [];
          let toastSpeakers = [];
          let selectedGenresPreferred = [];
          let selectedGenresAvoid = [];
          
          // Initialize
          window.addEventListener('DOMContentLoaded', async () => {
            buildNavDots();
            await loadExistingData();
            updateProgress();
          });
          
          function buildNavDots() {
            const container = document.getElementById('navDots');
            for (let i = 1; i <= TOTAL_SECTIONS; i++) {
              const dot = document.createElement('div');
              dot.className = 'nav-dot' + (i === 1 ? ' active' : '');
              dot.id = 'navDot' + i;
              dot.title = 'Section ' + i;
              dot.onclick = () => goToSection(i);
              container.appendChild(dot);
            }
          }
          
          async function loadExistingData() {
            try {
              const resp = await fetch('/api/wedding-form/' + BOOKING_ID);
              const data = await resp.json();
              if (data.success && data.form) {
                const f = data.form;
                // Populate text/select inputs
                document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], input[type="time"], select, textarea').forEach(el => {
                  if (el.name && f[el.name] !== undefined && f[el.name] !== null) {
                    el.value = f[el.name];
                  }
                });
                // Populate checkboxes
                document.querySelectorAll('input[type="checkbox"]').forEach(el => {
                  if (el.name && f[el.name] !== undefined) {
                    el.checked = !!f[el.name];
                  }
                });
                // Populate dynamic lists
                if (f.bridal_party_json) { try { bridalParty = JSON.parse(f.bridal_party_json); renderBridalParty(); } catch(e){} }
                if (f.vip_family_json) { try { vipFamily = JSON.parse(f.vip_family_json); renderVipFamily(); } catch(e){} }
                if (f.must_play_songs) { try { mustPlaySongs = JSON.parse(f.must_play_songs); renderMustPlay(); } catch(e){} }
                if (f.do_not_play_songs) { try { doNotPlaySongs = JSON.parse(f.do_not_play_songs); renderDoNotPlay(); } catch(e){} }
                if (f.toast_speakers_json) { try { toastSpeakers = JSON.parse(f.toast_speakers_json); renderToastSpeakers(); } catch(e){} }
                if (f.music_genres_preferred) { try { selectedGenresPreferred = JSON.parse(f.music_genres_preferred); restoreGenres('preferred'); } catch(e){} }
                if (f.music_genres_avoid) { try { selectedGenresAvoid = JSON.parse(f.music_genres_avoid); restoreGenres('avoid'); } catch(e){} }
                
                // Go to last saved section
                if (f.last_saved_section) {
                  const sec = parseInt(f.last_saved_section);
                  if (sec > 0 && sec <= TOTAL_SECTIONS) goToSection(sec);
                }
              }
            } catch (err) { console.error('Failed to load form data:', err); }
          }
          
          function restoreGenres(type) {
            const arr = type === 'preferred' ? selectedGenresPreferred : selectedGenresAvoid;
            const containerId = type === 'preferred' ? 'genresPreferred' : 'genresAvoid';
            document.querySelectorAll('#' + containerId + ' .genre-tag').forEach(tag => {
              if (arr.includes(tag.dataset.genre)) tag.classList.add('selected');
            });
          }
          
          function toggleSection(num) {
            const body = document.getElementById('sectionBody' + num);
            const isOpen = body.classList.contains('open');
            // Close all
            for (let i = 1; i <= TOTAL_SECTIONS; i++) {
              document.getElementById('sectionBody' + i).classList.remove('open');
              document.getElementById('section' + i).classList.remove('active');
            }
            if (!isOpen) {
              body.classList.add('open');
              document.getElementById('section' + num).classList.add('active');
              currentSection = num;
              updateNavDots();
            }
          }
          
          function goToSection(num) {
            toggleSection(num);
            document.getElementById('section' + num).scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          
          function updateNavDots() {
            for (let i = 1; i <= TOTAL_SECTIONS; i++) {
              const dot = document.getElementById('navDot' + i);
              dot.classList.remove('active');
              if (i === currentSection) dot.classList.add('active');
            }
          }
          
          function updateProgress() {
            let filled = 0;
            let total = 0;
            document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], select, textarea').forEach(el => {
              if (el.name) { total++; if (el.value.trim()) filled++; }
            });
            const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
            document.getElementById('progressFill').style.width = pct + '%';
            document.getElementById('progressText').textContent = pct + '% Complete';
          }
          
          function collectFormData() {
            const data = { form_status: 'in_progress', last_saved_section: currentSection.toString() };
            document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], input[type="time"], select, textarea').forEach(el => {
              if (el.name) data[el.name] = el.value;
            });
            document.querySelectorAll('input[type="checkbox"]').forEach(el => {
              if (el.name) data[el.name] = el.checked;
            });
            data.bridal_party_json = JSON.stringify(bridalParty);
            data.vip_family_json = JSON.stringify(vipFamily);
            data.must_play_songs = JSON.stringify(mustPlaySongs);
            data.do_not_play_songs = JSON.stringify(doNotPlaySongs);
            data.toast_speakers_json = JSON.stringify(toastSpeakers);
            data.music_genres_preferred = JSON.stringify(selectedGenresPreferred);
            data.music_genres_avoid = JSON.stringify(selectedGenresAvoid);
            return data;
          }
          
          async function saveProgress() {
            const data = collectFormData();
            try {
              const resp = await fetch('/api/wedding-form/' + BOOKING_ID, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              const result = await resp.json();
              if (result.success) {
                const indicator = document.getElementById('saveIndicator');
                indicator.style.display = 'block';
                setTimeout(() => { indicator.style.display = 'none'; }, 2000);
              }
            } catch (err) { console.error('Save error:', err); }
            updateProgress();
          }
          
          // Form submission
          document.getElementById('weddingForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = collectFormData();
            data.form_status = 'completed';
            
            try {
              const resp = await fetch('/api/wedding-form/' + BOOKING_ID, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              const result = await resp.json();
              if (result.success) {
                document.getElementById('successOverlay').style.display = 'flex';
              }
            } catch (err) { console.error('Submit error:', err); }
          });
          
          // Genre toggling
          function toggleGenre(el, type) {
            const genre = el.dataset.genre;
            const arr = type === 'preferred' ? selectedGenresPreferred : selectedGenresAvoid;
            const idx = arr.indexOf(genre);
            if (idx > -1) { arr.splice(idx, 1); el.classList.remove('selected'); }
            else { arr.push(genre); el.classList.add('selected'); }
          }
          
          // Dynamic list helpers
          function addBridalPartyMember() { bridalParty.push({name:'',role:'',partner_name:''}); renderBridalParty(); }
          function removeBridalParty(i) { bridalParty.splice(i,1); renderBridalParty(); }
          function renderBridalParty() {
            const list = document.getElementById('bridalPartyList');
            list.innerHTML = bridalParty.map((m,i) => '<div class="dynamic-item"><select class="form-select" style="max-width:140px" onchange="bridalParty['+i+'].role=this.value"><option value="">Role</option><option value="Best Man"'+(m.role==='Best Man'?' selected':'')+'>Best Man</option><option value="Maid of Honor"'+(m.role==='Maid of Honor'?' selected':'')+'>Maid of Honor</option><option value="Groomsman"'+(m.role==='Groomsman'?' selected':'')+'>Groomsman</option><option value="Bridesmaid"'+(m.role==='Bridesmaid'?' selected':'')+'>Bridesmaid</option><option value="Usher"'+(m.role==='Usher'?' selected':'')+'>Usher</option><option value="Other"'+(m.role==='Other'?' selected':'')+'>Other</option></select><input type="text" class="form-input" placeholder="Name" value="'+(m.name||'')+'" onchange="bridalParty['+i+'].name=this.value"><input type="text" class="form-input" placeholder="Escorted by / Partner" value="'+(m.partner_name||'')+'" onchange="bridalParty['+i+'].partner_name=this.value"><button type="button" class="btn-remove" onclick="removeBridalParty('+i+')"><i class="fas fa-times"></i></button></div>').join('');
          }
          
          function addVipMember() { vipFamily.push({name:'',relationship:'',special_note:''}); renderVipFamily(); }
          function removeVip(i) { vipFamily.splice(i,1); renderVipFamily(); }
          function renderVipFamily() {
            const list = document.getElementById('vipFamilyList');
            list.innerHTML = vipFamily.map((m,i) => '<div class="dynamic-item"><input type="text" class="form-input" placeholder="Name" value="'+(m.name||'')+'" onchange="vipFamily['+i+'].name=this.value"><input type="text" class="form-input" placeholder="Relationship" value="'+(m.relationship||'')+'" onchange="vipFamily['+i+'].relationship=this.value"><input type="text" class="form-input" placeholder="Special note" value="'+(m.special_note||'')+'" onchange="vipFamily['+i+'].special_note=this.value"><button type="button" class="btn-remove" onclick="removeVip('+i+')"><i class="fas fa-times"></i></button></div>').join('');
          }
          
          function addMustPlay() { mustPlaySongs.push({song:'',artist:'',moment:''}); renderMustPlay(); }
          function removeMustPlay(i) { mustPlaySongs.splice(i,1); renderMustPlay(); }
          function renderMustPlay() {
            const list = document.getElementById('mustPlayList');
            list.innerHTML = mustPlaySongs.map((s,i) => '<div class="dynamic-item"><input type="text" class="form-input" placeholder="Song Name" value="'+(s.song||'')+'" onchange="mustPlaySongs['+i+'].song=this.value"><input type="text" class="form-input" placeholder="Artist" value="'+(s.artist||'')+'" onchange="mustPlaySongs['+i+'].artist=this.value"><input type="text" class="form-input" placeholder="When? (optional)" value="'+(s.moment||'')+'" onchange="mustPlaySongs['+i+'].moment=this.value"><button type="button" class="btn-remove" onclick="removeMustPlay('+i+')"><i class="fas fa-times"></i></button></div>').join('');
          }
          
          function addDoNotPlay() { doNotPlaySongs.push({song:'',artist:'',reason:''}); renderDoNotPlay(); }
          function removeDoNotPlay(i) { doNotPlaySongs.splice(i,1); renderDoNotPlay(); }
          function renderDoNotPlay() {
            const list = document.getElementById('doNotPlayList');
            list.innerHTML = doNotPlaySongs.map((s,i) => '<div class="dynamic-item"><input type="text" class="form-input" placeholder="Song Name" value="'+(s.song||'')+'" onchange="doNotPlaySongs['+i+'].song=this.value"><input type="text" class="form-input" placeholder="Artist" value="'+(s.artist||'')+'" onchange="doNotPlaySongs['+i+'].artist=this.value"><input type="text" class="form-input" placeholder="Reason (optional)" value="'+(s.reason||'')+'" onchange="doNotPlaySongs['+i+'].reason=this.value"><button type="button" class="btn-remove" onclick="removeDoNotPlay('+i+')"><i class="fas fa-times"></i></button></div>').join('');
          }
          
          function addToastSpeaker() { toastSpeakers.push({name:'',role:'',order:toastSpeakers.length+1}); renderToastSpeakers(); }
          function removeToast(i) { toastSpeakers.splice(i,1); renderToastSpeakers(); }
          function renderToastSpeakers() {
            const list = document.getElementById('toastSpeakersList');
            list.innerHTML = toastSpeakers.map((s,i) => '<div class="dynamic-item"><span style="color:#FFD700;font-weight:bold;width:25px;">#'+(i+1)+'</span><input type="text" class="form-input" placeholder="Speaker Name" value="'+(s.name||'')+'" onchange="toastSpeakers['+i+'].name=this.value"><input type="text" class="form-input" placeholder="Role (Best Man, MOH, etc.)" value="'+(s.role||'')+'" onchange="toastSpeakers['+i+'].role=this.value"><button type="button" class="btn-remove" onclick="removeToast('+i+')"><i class="fas fa-times"></i></button></div>').join('');
          }
          
          // Auto-save every 60 seconds
          setInterval(saveProgress, 60000);
          
          // Track progress on input change
          document.addEventListener('input', () => { updateProgress(); });
        </script>
    </body>
    </html>
  `)
})

export default app
