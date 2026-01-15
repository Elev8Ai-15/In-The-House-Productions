# Test Account Creation Instructions

## The Issue
The calendar requires authentication. When you try to access `/calendar` without being logged in, it redirects you to `/login`.

## Solution - Create a Test Account

### Option 1: Register via Web Interface
1. Visit: https://8948874c.webapp-2mf.pages.dev/register
2. Fill in the form:
   - **Name**: Test User
   - **Email**: test@example.com
   - **Phone**: 555-123-4567
   - **Password**: Test123!
3. Click "REGISTER"
4. Then log in at: https://8948874c.webapp-2mf.pages.dev/login
5. Now try booking: Select DJ/Photobooth → Calendar should work

### Option 2: Use Existing Admin Account
If an admin account exists:
- **Email**: admin@inthehouseproductions.com
- **Password**: Admin123!

Try logging in with this at: https://8948874c.webapp-2mf.pages.dev/login

### Option 3: Create Test Account via API
```bash
# Create test account
curl -X POST https://8948874c.webapp-2mf.pages.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "phone": "555-123-4567",
    "password": "Test123!"
  }'

# Login
curl -X POST https://8948874c.webapp-2mf.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!"
  }'

# The response will contain: { "token": "...", "user": {...} }
# Copy the token and set it in localStorage:
# localStorage.setItem('authToken', 'THE_TOKEN_HERE')
```

## Why This Happens
The calendar page checks for authentication on line 2370-2375:
```javascript
const authToken = localStorage.getItem('authToken');
if (!authToken) {
  await showAlert('Please log in to continue booking.', 'Login Required');
  window.location.href = '/login';
  return;
}
```

This is intentional security - only logged-in users can book services.

## Test Flow
1. Register/Login → Get authToken
2. Go to DJ Services or Photobooth page
3. Select a provider
4. Click "CONTINUE TO CALENDAR"
5. Calendar should now load (you're authenticated!)
6. Select a date
7. Continue to event details
8. Complete booking with Stripe

## Debug Steps
If you're still having issues after logging in:
1. Open browser console (F12)
2. Check localStorage: `localStorage.getItem('authToken')`
3. Should see a JWT token
4. Check: `localStorage.getItem('serviceType')` should be 'dj' or 'photobooth'
5. Check: `localStorage.getItem('selectedDJ')` or `localStorage.getItem('selectedPhotobooth')`
6. All three should have values before calendar loads

## Current Status
✅ API endpoints working
✅ Calendar page loads
✅ Availability API returns correct format
❌ YOU NEED TO LOG IN FIRST!

The calendar itself is working correctly. You just need authentication to access it.
