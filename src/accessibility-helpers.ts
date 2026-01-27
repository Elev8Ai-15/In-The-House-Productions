// Accessibility (WCAG 2.1 AAA & ADA Compliance) Helpers
// Only includes functions that are actively used in the application

/**
 * Generate skip navigation links for keyboard users
 */
export function generateSkipLinks(): string {
  return `
    <!-- Skip Links for Keyboard Navigation -->
    <div class="skip-links" style="position: absolute; top: -40px; left: 0; background: #E31E24; color: white; padding: 8px; z-index: 100; transition: top 0.3s;">
      <a href="#main-content" class="skip-link" style="color: white; text-decoration: underline;">Skip to main content</a> |
      <a href="#navigation" class="skip-link" style="color: white; text-decoration: underline;">Skip to navigation</a>
    </div>
    <style>
      .skip-links:focus-within {
        top: 0 !important;
      }
      .skip-link:focus {
        outline: 3px solid #FFD700;
        outline-offset: 2px;
      }
    </style>
  `
}

/**
 * Generate ARIA live region for dynamic content announcements
 */
export function generateAriaLiveRegion(): string {
  return `
    <!-- Screen Reader Announcements -->
    <div id="aria-live-region" aria-live="polite" aria-atomic="true" class="sr-only" style="
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    "></div>
    <div id="aria-live-assertive" aria-live="assertive" aria-atomic="true" class="sr-only" style="
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    "></div>
  `
}

/**
 * Generate focus visible styles for keyboard navigation
 */
export function generateFocusStyles(): string {
  return `
    <style>
      /* Enhanced Focus Styles for WCAG 2.1 AAA */
      *:focus {
        outline: 3px solid #FFD700;
        outline-offset: 2px;
      }

      /* Focus-visible for modern browsers (mouse vs keyboard) */
      *:focus:not(:focus-visible) {
        outline: none;
      }

      *:focus-visible {
        outline: 3px solid #FFD700;
        outline-offset: 2px;
        box-shadow: 0 0 0 5px rgba(255, 215, 0, 0.3);
      }

      /* Button focus states */
      button:focus-visible,
      a:focus-visible,
      [role="button"]:focus-visible {
        outline: 3px solid #FFD700;
        outline-offset: 2px;
        box-shadow: 0 0 0 5px rgba(255, 215, 0, 0.3);
      }

      /* Form input focus states */
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        outline: 3px solid #FFD700;
        outline-offset: 2px;
        border-color: #FFD700;
      }

      /* Skip link focus */
      .skip-link:focus {
        position: absolute;
        top: 0;
        left: 0;
        background: #E31E24;
        color: white;
        padding: 10px;
        z-index: 10000;
        outline: 3px solid #FFD700;
      }

      /* Error states for accessibility */
      [aria-invalid="true"] {
        border-color: #E31E24;
        border-width: 2px;
      }

      .error-message {
        color: #E31E24;
        font-weight: bold;
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
      }

      .error-message::before {
        content: "⚠ ";
        margin-right: 0.25rem;
      }

      /* Required field indicator */
      .required-indicator {
        color: #E31E24;
        font-weight: bold;
      }

      /* Screen reader only class */
      .sr-only {
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }

      /* High contrast mode support */
      @media (prefers-contrast: high) {
        * {
          border-width: 2px !important;
        }

        button, [role="button"] {
          border: 2px solid currentColor !important;
        }
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
          scroll-behavior: auto !important;
        }
      }

      /* Focus within for container focus */
      .form-group:focus-within label {
        color: #FFD700;
        font-weight: bold;
      }
    </style>
  `
}

/**
 * JavaScript utilities for accessibility
 */
export function generateAccessibilityJS(): string {
  return `
    <script>
      // Screen reader announcement utility
      function announceToScreenReader(message, assertive = false) {
        const region = document.getElementById(assertive ? 'aria-live-assertive' : 'aria-live-region');
        if (region) {
          region.textContent = message;
          setTimeout(() => { region.textContent = ''; }, 1000);
        }
      }

      // Form validation with accessibility
      function validateFieldAccessible(fieldId, isValid, errorMessage) {
        const field = document.getElementById(fieldId);
        const errorId = field?.getAttribute('data-error-id');
        const errorElement = errorId ? document.getElementById(errorId) : null;

        if (!field) return;

        if (isValid) {
          field.setAttribute('aria-invalid', 'false');
          if (errorElement) {
            errorElement.style.display = 'none';
            errorElement.textContent = '';
          }
        } else {
          field.setAttribute('aria-invalid', 'true');
          if (errorElement) {
            errorElement.style.display = 'block';
            errorElement.textContent = errorMessage;
          }
          announceToScreenReader(errorMessage, true);
        }
      }

      // Keyboard navigation enhancements
      document.addEventListener('DOMContentLoaded', function() {
        // Add keyboard support to role="button" elements
        document.querySelectorAll('[role="button"]').forEach(function(element) {
          if (!element.hasAttribute('tabindex')) {
            element.setAttribute('tabindex', '0');
          }

          element.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              element.click();
            }
          });
        });

        // Announce page changes to screen readers
        const pageTitle = document.title;
        announceToScreenReader(\`Page loaded: \${pageTitle}\`);

        // Add focus indication class for keyboard users
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Tab') {
            document.body.classList.add('keyboard-user');
          }
        });
        document.addEventListener('mousedown', function() {
          document.body.classList.remove('keyboard-user');
        });
      });
    </script>
  `
}
