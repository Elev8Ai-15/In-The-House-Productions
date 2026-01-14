# 🔍 SESSION TIMEOUT DEBUGGING GUIDE

## 📱 What You Need To Do

The "Session Expired" error is still appearing. I've added comprehensive logging to help us identify the exact cause. Please follow these steps:

---

## 🧪 **Testing Steps**

### 1. Open Browser DevTools
- On your phone, use Chrome browser
- Go to `chrome://inspect` or use desktop Chrome with remote debugging
- OR use desktop browser for easier console access

### 2. Clear Everything First
```javascript
// In browser console (F12 → Console tab)
localStorage.clear()
sessionStorage.clear()
location.reload()
```

### 3. Complete the Full Flow

#### Step A: Login
1. Go to https://www.inthehouseproductions.com/login
2. Login with your credentials
3. **IMPORTANT**: Check console for these logs:
   ```
   🔑 Creating token with secret: DEFAULT (dev) or CUSTOM
   ✅ Token created, length: [number]
   ```
4. **Copy these details** and share them with me

#### Step B: Select Service
1. Choose DJ or Photobooth
2. Continue to calendar

#### Step C: Choose Date
1. Select a date
2. Continue to event details

#### Step D: Fill Event Details
1. Fill out the form
2. Click "CONTINUE TO PAYMENT"
3. **CRITICAL**: Watch the console closely
4. You should see these logs:
   ```
   🔑 Auth token present: true
   🔑 Token length: [number]
   🔑 Token preview: [first 50 characters]...
   📤 Creating booking: {...}
   🔐 Verifying token...
   JWT_SECRET being used: DEFAULT (dev) or CUSTOM
   Token length: [number]
   Token preview: [first 50 characters]...
   ```

5. **If it fails**, you'll see:
   ```
   ❌ Token verification failed: [error message]
   Token was: [first 100 characters]...
   JWT_SECRET: Using DEFAULT dev secret or Using custom secret
   ```

---

## 📋 **What To Share With Me**

Please copy and paste ALL console messages, especially:

### From Login:
- [ ] `🔑 Creating token with secret:` [DEFAULT or CUSTOM]
- [ ] `✅ Token created, length:` [number]

### From Event Details Submission:
- [ ] `🔑 Auth token present:` [true/false]
- [ ] `🔑 Token length:` [number]
- [ ] `🔑 Token preview:` [first 50 chars]

### From Backend:
- [ ] `🔐 Verifying token...`
- [ ] `JWT_SECRET being used:` [DEFAULT or CUSTOM]
- [ ] `Token length:` [number]
- [ ] `Token preview:` [first 50 chars]

### If Error:
- [ ] `❌ Token verification failed:` [error message]
- [ ] `JWT_SECRET:` [which secret]

---

## 🔎 **What We're Looking For**

### Scenario 1: Secret Mismatch
**Symptoms:**
```
Login: Creating token with secret: DEFAULT (dev)
Booking: JWT_SECRET being used: CUSTOM
❌ Token verification failed: Invalid signature
```

**Cause**: Token created with one secret, verified with different secret
**Fix**: Configure `JWT_SECRET` environment variable in Cloudflare

### Scenario 2: Corrupted Token
**Symptoms:**
```
🔑 Token length: 0
OR
🔑 Token preview: undefined...
```

**Cause**: Token not stored properly in localStorage
**Fix**: Check localStorage save/retrieve logic

### Scenario 3: Expired Token
**Symptoms:**
```
❌ Token verification failed: Token expired
Token exp: [timestamp in past]
Current now: [timestamp now]
```

**Cause**: Token actually expired (> 24 hours old)
**Fix**: Login again

### Scenario 4: Invalid Format
**Symptoms:**
```
❌ Token verification failed: Invalid token format
```

**Cause**: Token structure corrupted
**Fix**: Clear storage and login again

---

## 🛠️ **Quick Fixes To Try**

### Fix 1: Clear All Storage
```javascript
// In browser console
localStorage.clear()
sessionStorage.clear()
location.reload()
// Then login again
```

### Fix 2: Check Token in Storage
```javascript
// Check if token exists
const token = localStorage.getItem('authToken')
console.log('Token exists:', !!token)
console.log('Token length:', token ? token.length : 0)
console.log('Token preview:', token ? token.substring(0, 50) : 'NO TOKEN')

// Check user data
const user = localStorage.getItem('user')
console.log('User data:', user)
```

### Fix 3: Manual Token Test
```javascript
// After login, immediately check if token is valid
const token = localStorage.getItem('authToken')
fetch('/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(r => r.json())
.then(d => console.log('Token validation:', d))
.catch(e => console.error('Token invalid:', e))
```

---

## 🚨 **Common Issues**

### Issue 1: Token Not Saving
**Check**: Does `localStorage.getItem('authToken')` return a value?
**If NO**: Frontend not saving token after login
**Solution**: Check login response handler

### Issue 2: Token Wrong Format
**Check**: Does token start with `eyJ`?
**If NO**: Token corrupted or not a JWT
**Solution**: Re-login to get fresh token

### Issue 3: Secret Mismatch
**Check**: Do login and booking use same secret?
**If NO**: Environment variable not set correctly
**Solution**: Configure `JWT_SECRET` in Cloudflare

### Issue 4: CORS/Network Error
**Check**: Do you see CORS errors in console?
**If YES**: Request being blocked
**Solution**: Check network tab for details

---

## 📱 **Mobile Debugging**

If you're testing on mobile:

### Option 1: Chrome Remote Debugging (Best)
1. On desktop: Open Chrome
2. Go to `chrome://inspect`
3. Connect your Android phone via USB
4. Enable USB debugging on phone
5. Select your device
6. Click "Inspect" on the page
7. See full console logs on desktop

### Option 2: Use Eruda (Console on Mobile)
Add this to browser console or bookmark:
```javascript
(function () { var script = document.createElement('script'); script.src="//cdn.jsdelivr.net/npm/eruda"; document.body.appendChild(script); script.onload = function () { eruda.init() } })();
```

### Option 3: Desktop Browser (Easiest)
- Just test on desktop Chrome/Firefox
- Open DevTools (F12)
- Complete the flow
- Share console logs

---

## 📊 **Expected vs Actual**

### ✅ Expected Flow (Should Work)
```
1. Login → Token created with secret: DEFAULT (dev)
2. Token saved to localStorage
3. Event details submit → Token retrieved from localStorage
4. Backend verifies → Using same secret: DEFAULT (dev)
5. ✅ Token verified successfully
6. Proceed to checkout
```

### ❌ Current Flow (Not Working)
```
1. Login → Token created
2. Token saved (maybe?)
3. Event details submit → Token sent
4. Backend verifies → ???
5. ❌ Token verification failed
6. Session expired error
```

---

## 🎯 **Next Steps**

1. **Do the test** following steps above
2. **Copy all console logs** (especially the 🔑 and 🔐 messages)
3. **Share with me** so I can see exactly what's failing
4. **I'll identify the root cause** and provide the fix

---

## 🔗 **Testing URLs**

- **Production**: https://www.inthehouseproductions.com
- **Latest Deploy**: https://09cbb312.webapp-2mf.pages.dev
- **Login**: https://www.inthehouseproductions.com/login

---

## 📞 **What to Send Me**

Please send:
1. **Full console log** from login through error
2. **Screenshots** of the console messages
3. **Error message** text
4. **Browser** you're using (Chrome, Firefox, Safari, etc.)
5. **Device** (iPhone, Android, Desktop)

With this information, I'll be able to pinpoint exactly why the token verification is failing and provide the specific fix needed.

---

**Status**: DEBUGGING IN PROGRESS
**Latest Deploy**: https://09cbb312.webapp-2mf.pages.dev
**Commit**: 4aadd12
