// SEO Optimization Helpers

export function generateMetaTags(config: {
  title: string
  description: string
  canonical: string
  keywords: string
  ogImage: string
}, baseUrl: string): string {
  return `
    <meta name="title" content="${config.title}">
    <meta name="description" content="${config.description}">
    <meta name="keywords" content="${config.keywords}">
    <link rel="canonical" href="${baseUrl}${config.canonical}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${baseUrl}${config.canonical}">
    <meta property="og:title" content="${config.title}">
    <meta property="og:description" content="${config.description}">
    <meta property="og:image" content="${config.ogImage}">
    <meta property="og:site_name" content="In The House Productions">
    <meta property="og:locale" content="en_US">
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${baseUrl}${config.canonical}">
    <meta property="twitter:title" content="${config.title}">
    <meta property="twitter:description" content="${config.description}">
    <meta property="twitter:image" content="${config.ogImage}">
    <meta name="robots" content="index, follow">
    <meta name="theme-color" content="#E31E24">
  `
}

export function generateOrganizationSchema(baseUrl: string): string {
  return `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "In The House Productions",
      "url": "${baseUrl}",
      "logo": "${baseUrl}/static/hero-logo-3d-v2.png",
      "description": "Professional DJ and photobooth services"
    }
    </script>
  `
}

export function generateLocalBusinessSchema(baseUrl: string): string {
  return `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "In The House Productions",
      "image": "${baseUrl}/static/hero-logo-3d-v2.png",
      "url": "${baseUrl}",
      "priceRange": "$$"
    }
    </script>
  `
}

export function generateServiceSchema(config: {
  name: string
  description: string
  price: string
  image: string
}, baseUrl: string): string {
  return `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Service",
      "serviceType": "${config.name}",
      "description": "${config.description}",
      "offers": {
        "@type": "Offer",
        "price": "${config.price}",
        "priceCurrency": "USD"
      }
    }
    </script>
  `
}

export function generateBreadcrumbSchema(items: Array<{name: string, url: string}>, baseUrl: string): string {
  const listItems = items.map((item, index) => `{
    "@type": "ListItem",
    "position": ${index + 1},
    "name": "${item.name}",
    "item": "${baseUrl}${item.url}"
  }`).join(',')

  return `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [${listItems}]
    }
    </script>
  `
}

export function generateRobotsTxt(): string {
  return 'User-agent: *\nAllow: /\n\nDisallow: /api/\nDisallow: /admin\n\nSitemap: https://www.inthehouseproductions.com/sitemap.xml'
}

export function generateSitemap(): string {
  const baseUrl = 'https://www.inthehouseproductions.com'
  const pages = [
    { url: '/', priority: '1.0', changefreq: 'weekly' },
    { url: '/dj-services', priority: '0.9', changefreq: 'weekly' },
    { url: '/photobooth', priority: '0.9', changefreq: 'weekly' },
    { url: '/calendar', priority: '0.8', changefreq: 'daily' },
    { url: '/event-details', priority: '0.7', changefreq: 'monthly' },
    { url: '/about', priority: '0.6', changefreq: 'monthly' },
    { url: '/contact', priority: '0.6', changefreq: 'monthly' },
    { url: '/register', priority: '0.5', changefreq: 'monthly' },
    { url: '/login', priority: '0.5', changefreq: 'monthly' }
  ]

  const lastmod = new Date().toISOString().split('T')[0]

  const urlEntries = pages.map(page => `
  <url>
    <loc>${baseUrl}${page.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('')

  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urlEntries + '\n</urlset>'
}
