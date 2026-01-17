#!/usr/bin/env node
/**
 * Stripe Product & Price Setup Script
 * 
 * This script creates all products and prices in your Stripe account
 * for In The House Productions services.
 * 
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.js
 * 
 * Or with .env:
 *   npm run stripe:setup
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('mock')) {
  console.error('❌ ERROR: Valid STRIPE_SECRET_KEY environment variable required');
  console.error('');
  console.error('Please set your Stripe API key:');
  console.error('  export STRIPE_SECRET_KEY=sk_test_your_key_here');
  console.error('');
  console.error('Get your test key from: https://dashboard.stripe.com/test/apikeys');
  process.exit(1);
}

// Import Stripe
const Stripe = require('stripe');
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia'
});

// ============================================
// SERVICE CATALOG - In The House Productions
// ============================================
const serviceCatalog = {
  // ===== DJ SERVICES =====
  dj_party: {
    name: 'DJ Service - Party Package',
    description: 'Professional DJ services for parties and events. Includes up to 4 hours of entertainment, professional sound equipment, and extensive music library.',
    category: 'dj',
    basePrice: 50000, // $500.00 in cents
    baseHours: 4,
    hourlyRate: 10000, // $100.00 per additional hour
    metadata: {
      service_type: 'dj',
      package_type: 'party',
      includes: 'Sound system, DJ equipment, music library'
    }
  },
  dj_wedding: {
    name: 'DJ Service - Wedding Package',
    description: 'Premium DJ services specifically designed for weddings. Includes up to 5 hours, MC services, ceremony music, cocktail hour, reception, and special event announcements.',
    category: 'dj',
    basePrice: 85000, // $850.00 in cents
    baseHours: 5,
    hourlyRate: 10000, // $100.00 per additional hour
    metadata: {
      service_type: 'dj',
      package_type: 'wedding',
      includes: 'MC services, ceremony music, cocktail hour, reception, announcements'
    }
  },
  dj_additional_hour: {
    name: 'DJ Service - Additional Hour',
    description: 'Add extra hour to your DJ booking.',
    category: 'dj',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: {
      service_type: 'dj',
      addon_type: 'additional_hour'
    }
  },

  // ===== PHOTOBOOTH SERVICES =====
  photobooth_strips: {
    name: 'Photobooth - Unlimited Photo Strips',
    description: 'Professional photobooth service with unlimited 2x6 photo strip prints. Includes 4 hours, on-site attendant, props, custom backdrop, and digital gallery.',
    category: 'photobooth',
    basePrice: 50000, // $500.00 in cents
    baseHours: 4,
    hourlyRate: 10000, // $100.00 per additional hour
    metadata: {
      service_type: 'photobooth',
      print_type: 'strips',
      includes: 'Unlimited prints, props, backdrop, digital gallery, attendant'
    }
  },
  photobooth_4x6: {
    name: 'Photobooth - 4x6 Print Package',
    description: 'Professional photobooth service with 4x6 prints. Includes 4 hours, on-site attendant, props, custom backdrop, and digital gallery.',
    category: 'photobooth',
    basePrice: 55000, // $550.00 in cents
    baseHours: 4,
    hourlyRate: 10000, // $100.00 per additional hour
    metadata: {
      service_type: 'photobooth',
      print_type: '4x6',
      includes: '4x6 prints, props, backdrop, digital gallery, attendant'
    }
  },
  photobooth_additional_hour: {
    name: 'Photobooth - Additional Hour',
    description: 'Add extra hour to your Photobooth booking.',
    category: 'photobooth',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: {
      service_type: 'photobooth',
      addon_type: 'additional_hour'
    }
  },

  // ===== ADD-ON SERVICES =====
  karaoke: {
    name: 'Karaoke Add-on',
    description: 'Add karaoke to your DJ event! Includes karaoke system, song library with thousands of tracks, wireless microphones, and on-screen lyrics display.',
    category: 'addon',
    basePrice: 10000, // $100.00 for 4hr event
    baseHours: 4,
    hourlyRate: 5000, // $50.00 per additional hour
    metadata: {
      service_type: 'addon',
      addon_type: 'karaoke',
      includes: 'Karaoke system, microphones, song library'
    }
  },
  karaoke_additional_hour: {
    name: 'Karaoke - Additional Hour',
    description: 'Add extra hour to your Karaoke addon.',
    category: 'addon',
    basePrice: 5000, // $50.00 in cents
    isAddon: true,
    metadata: {
      service_type: 'addon',
      addon_type: 'karaoke_additional_hour'
    }
  },
  uplighting: {
    name: 'Uplighting Add-on',
    description: 'Professional LED uplighting to transform your venue. Includes up to 6 wireless LED uplights with customizable colors to match your theme.',
    category: 'addon',
    basePrice: 10000, // $100.00 for 4hr event
    baseHours: 4,
    hourlyRate: 5000, // $50.00 per additional hour
    metadata: {
      service_type: 'addon',
      addon_type: 'uplighting',
      includes: '6 wireless LED uplights, color customization'
    }
  },
  uplighting_additional_hour: {
    name: 'Uplighting - Additional Hour',
    description: 'Add extra hour to your Uplighting addon.',
    category: 'addon',
    basePrice: 5000, // $50.00 in cents
    isAddon: true,
    metadata: {
      service_type: 'addon',
      addon_type: 'uplighting_additional_hour'
    }
  },
  foam_pit: {
    name: 'Foam Pit Rental',
    description: 'Turn your event into an unforgettable foam party! Includes professional foam machine, foam solution for 4 hours, setup, and cleanup.',
    category: 'addon',
    basePrice: 50000, // $500.00 for 4hr event
    baseHours: 4,
    hourlyRate: 10000, // $100.00 per additional hour
    metadata: {
      service_type: 'addon',
      addon_type: 'foam_pit',
      includes: 'Foam machine, foam solution, setup, cleanup'
    }
  },
  foam_pit_additional_hour: {
    name: 'Foam Pit - Additional Hour',
    description: 'Add extra hour to your Foam Pit rental.',
    category: 'addon',
    basePrice: 10000, // $100.00 in cents
    isAddon: true,
    metadata: {
      service_type: 'addon',
      addon_type: 'foam_pit_additional_hour'
    }
  }
};

// ============================================
// STRIPE SETUP FUNCTIONS
// ============================================

async function createProduct(serviceKey, service) {
  console.log(`\n📦 Creating product: ${service.name}`);
  
  try {
    // Check if product already exists
    const existingProducts = await stripe.products.list({
      limit: 100,
      active: true
    });
    
    const existing = existingProducts.data.find(p => 
      p.metadata.service_key === serviceKey
    );
    
    if (existing) {
      console.log(`   ⚠️  Product already exists (ID: ${existing.id})`);
      return existing;
    }
    
    // Create new product
    const product = await stripe.products.create({
      name: service.name,
      description: service.description,
      active: true,
      metadata: {
        service_key: serviceKey,
        category: service.category,
        ...service.metadata
      }
    });
    
    console.log(`   ✅ Created product (ID: ${product.id})`);
    return product;
    
  } catch (error) {
    console.error(`   ❌ Error creating product: ${error.message}`);
    throw error;
  }
}

async function createPrice(product, service, serviceKey) {
  console.log(`   💰 Creating price: $${(service.basePrice / 100).toFixed(2)}`);
  
  try {
    // Check if price already exists
    const existingPrices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 10
    });
    
    const existingBase = existingPrices.data.find(p => 
      p.metadata.price_type === 'base' && p.unit_amount === service.basePrice
    );
    
    if (existingBase) {
      console.log(`   ⚠️  Base price already exists (ID: ${existingBase.id})`);
      return { base: existingBase };
    }
    
    // Create base price
    const basePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: service.basePrice,
      currency: 'usd',
      metadata: {
        price_type: 'base',
        service_key: serviceKey,
        base_hours: service.baseHours?.toString() || '0'
      }
    });
    
    console.log(`   ✅ Created base price (ID: ${basePrice.id})`);
    
    // Create hourly rate price if applicable
    let hourlyPrice = null;
    if (service.hourlyRate) {
      hourlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: service.hourlyRate,
        currency: 'usd',
        metadata: {
          price_type: 'hourly',
          service_key: serviceKey
        }
      });
      console.log(`   ✅ Created hourly price: $${(service.hourlyRate / 100).toFixed(2)}/hr (ID: ${hourlyPrice.id})`);
    }
    
    return { base: basePrice, hourly: hourlyPrice };
    
  } catch (error) {
    console.error(`   ❌ Error creating price: ${error.message}`);
    throw error;
  }
}

async function setupAllProducts() {
  console.log('='.repeat(60));
  console.log('🎵 IN THE HOUSE PRODUCTIONS - STRIPE SETUP');
  console.log('='.repeat(60));
  console.log('');
  console.log('Creating products and prices in Stripe...');
  console.log('');
  
  const results = {};
  
  for (const [serviceKey, service] of Object.entries(serviceCatalog)) {
    try {
      const product = await createProduct(serviceKey, service);
      const prices = await createPrice(product, service, serviceKey);
      
      results[serviceKey] = {
        productId: product.id,
        basePriceId: prices.base.id,
        hourlyPriceId: prices.hourly?.id || null,
        name: service.name,
        baseAmount: service.basePrice,
        hourlyAmount: service.hourlyRate || null
      };
    } catch (error) {
      console.error(`\n❌ Failed to setup ${serviceKey}: ${error.message}`);
      results[serviceKey] = { error: error.message };
    }
  }
  
  return results;
}

async function verifyStripeAccount() {
  console.log('🔐 Verifying Stripe connection...');
  
  try {
    const account = await stripe.accounts.retrieve();
    console.log(`   ✅ Connected to Stripe account: ${account.business_profile?.name || account.id}`);
    console.log(`   📧 Email: ${account.email || 'N/A'}`);
    console.log(`   🏢 Country: ${account.country}`);
    console.log(`   💳 Charges enabled: ${account.charges_enabled}`);
    console.log('');
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to connect to Stripe: ${error.message}`);
    return false;
  }
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  try {
    // Verify Stripe connection
    const connected = await verifyStripeAccount();
    if (!connected) {
      process.exit(1);
    }
    
    // Setup all products
    const results = await setupAllProducts();
    
    // Print summary
    console.log('\n');
    console.log('='.repeat(60));
    console.log('📊 SETUP COMPLETE - SUMMARY');
    console.log('='.repeat(60));
    console.log('');
    
    const successful = Object.entries(results).filter(([k, v]) => !v.error);
    const failed = Object.entries(results).filter(([k, v]) => v.error);
    
    console.log(`✅ Successfully created: ${successful.length} services`);
    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.length} services`);
    }
    
    console.log('\n📋 Service IDs for your application:\n');
    console.log('```javascript');
    console.log('const stripeProducts = {');
    for (const [key, data] of Object.entries(results)) {
      if (!data.error) {
        console.log(`  ${key}: {`);
        console.log(`    productId: '${data.productId}',`);
        console.log(`    basePriceId: '${data.basePriceId}',`);
        if (data.hourlyPriceId) {
          console.log(`    hourlyPriceId: '${data.hourlyPriceId}',`);
        }
        console.log(`    baseAmount: ${data.baseAmount}, // $${(data.baseAmount / 100).toFixed(2)}`);
        if (data.hourlyAmount) {
          console.log(`    hourlyAmount: ${data.hourlyAmount} // $${(data.hourlyAmount / 100).toFixed(2)}/hr`);
        }
        console.log(`  },`);
      }
    }
    console.log('};');
    console.log('```');
    
    console.log('\n✨ Stripe setup complete!');
    console.log('\nNext steps:');
    console.log('1. Copy the stripeProducts object into your application');
    console.log('2. Update the checkout flow to use these price IDs');
    console.log('3. Set up webhook endpoint in Stripe Dashboard');
    console.log('   Webhook URL: https://webapp-2mf.pages.dev/api/webhook/stripe');
    console.log('');
    
    // Output JSON file
    const outputPath = './stripe-products.json';
    require('fs').writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`📄 Full product data saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();
