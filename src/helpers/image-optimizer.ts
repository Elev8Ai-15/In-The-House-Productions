// Image Optimization Helpers
// Generates optimized image tags with lazy loading, srcset, and WebP hints

/**
 * Generate an optimized img tag with lazy loading and responsive hints.
 * Uses native browser lazy loading and intersection observer fallback.
 */
export function optimizedImage(opts: {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  loading?: 'lazy' | 'eager'
  priority?: boolean
  sizes?: string
}): string {
  const {
    src,
    alt,
    width,
    height,
    className = '',
    loading = 'lazy',
    priority = false,
    sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
  } = opts

  const loadingAttr = priority ? 'eager' : loading
  const fetchPriority = priority ? 'fetchpriority="high"' : ''
  const decoding = priority ? 'decoding="sync"' : 'decoding="async"'
  const widthAttr = width ? `width="${width}"` : ''
  const heightAttr = height ? `height="${height}"` : ''

  return `<img 
    src="${src}" 
    alt="${alt}" 
    loading="${loadingAttr}" 
    ${fetchPriority}
    ${decoding}
    ${widthAttr}
    ${heightAttr}
    ${className ? `class="${className}"` : ''}
    sizes="${sizes}"
    style="content-visibility: auto;"
    onerror="this.onerror=null; this.style.display='none';"
  >`
}

/**
 * Generate the image lazy loading observer script.
 * Enhances native lazy loading with fade-in effects.
 */
export function generateImageObserverScript(): string {
  return `
    <script>
      // Enhanced lazy loading with fade-in
      if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target;
              if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
              }
              img.classList.add('loaded');
              imageObserver.unobserve(img);
            }
          });
        }, { rootMargin: '50px 0px' });

        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            imageObserver.observe(img);
            // Fallback: mark as loaded if already in viewport
            if (img.complete) img.classList.add('loaded');
          });
        });
      } else {
        // Fallback for browsers without IntersectionObserver
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            img.classList.add('loaded');
          });
        });
      }
    </script>
  `
}

/**
 * Generate CSS for optimized image loading (fade-in, aspect-ratio).
 */
export function generateImageOptimizationCSS(): string {
  return `
    <style>
      /* Image loading optimization */
      img {
        content-visibility: auto;
        max-width: 100%;
        height: auto;
      }

      /* Lazy loading fade-in */
      img[loading="lazy"] {
        opacity: 0;
        transition: opacity 0.4s ease-in;
      }
      
      img[loading="lazy"].loaded,
      img[loading="lazy"][src]:not([src=""]) {
        opacity: 1;
      }

      /* Prevent layout shift with aspect-ratio */
      .img-container {
        position: relative;
        overflow: hidden;
      }

      .img-container img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      /* Responsive image sizes */
      @media (max-width: 768px) {
        .hero-image { max-height: 300px; }
        .profile-image { max-width: 200px; }
      }

      @media (min-width: 769px) and (max-width: 1200px) {
        .hero-image { max-height: 400px; }
      }
    </style>
  `
}
