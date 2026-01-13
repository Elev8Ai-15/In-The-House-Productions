# 🌐 Custom Domain Configuration Guide
**Domain**: www.inthehouseproductions.com  
**Date**: January 13, 2026  
**Status**: ⚠️ NEEDS CORRECTION  

---

## ❌ Current Issue

Your custom domain `www.inthehouseproductions.com` is currently pointing to:
```
https://6fde20b0-62cb-4a62-a3c7-795f2e74b4f3.vip.gensparksite.com
```

This GenSpark URL is **NOT your Cloudflare Pages deployment** and returns a 404 error.

**Test Results**:
- ✅ DNS resolves correctly
- ✅ HTTPS works (returns 200)
- ❌ Shows 404 Not Found (LiteSpeed Web Server)
- ❌ Not serving your booking application

---

## ✅ Correct Configuration

Your Cloudflare Pages deployment URLs are:
- **Permanent URL**: `webapp-2mf.pages.dev` ✅ (RECOMMENDED)
- **Latest Deploy**: `8009ac0c.webapp-2mf.pages.dev` ✅

Your custom domain should point to your **Cloudflare Pages** deployment, not GenSpark.

---

## 📋 Step-by-Step Fix

### Option 1: Configure in Cloudflare Dashboard (RECOMMENDED)

#### Step 1: Access Cloudflare Pages Dashboard
1. Go to: https://dash.cloudflare.com/
2. Navigate to: **Workers & Pages**
3. Select your project: **webapp**
4. Click: **Custom domains** tab

#### Step 2: Add Custom Domain
1. Click: **Set up a custom domain**
2. Enter: `www.inthehouseproductions.com`
3. Click: **Continue**
4. Cloudflare will provide DNS records to add

#### Step 3: Update DNS Records
Cloudflare will show you the required DNS configuration. You'll need to add either:

**CNAME Record** (Recommended):
```
Type: CNAME
Name: www
Target: webapp-2mf.pages.dev
Proxy: Enabled (orange cloud)
TTL: Auto
```

OR

**A Records** (If CNAME isn't supported):
```
Type: A
Name: www
Target: [Cloudflare will provide IP addresses]
Proxy: Enabled (orange cloud)
TTL: Auto
```

#### Step 4: Verify Configuration
Once DNS records are added, Cloudflare will automatically:
- ✅ Verify DNS propagation
- ✅ Issue SSL/TLS certificate
- ✅ Enable HTTPS
- ✅ Activate the custom domain

**Wait Time**: 5-60 minutes for DNS propagation

---

### Option 2: Use Wrangler CLI

If you prefer command-line configuration:

```bash
# Navigate to project
cd /home/user/webapp

# Add custom domain
npx wrangler pages domain add www.inthehouseproductions.com --project-name webapp

# Follow the prompts and update DNS as instructed
```

---

## 🔍 Verification Steps

After updating DNS records, verify the configuration:

### 1. Check DNS Resolution (Wait 5-60 minutes)
```bash
dig +short www.inthehouseproductions.com
# Should show Cloudflare IPs or webapp-2mf.pages.dev
```

### 2. Test HTTPS
```bash
curl -I https://www.inthehouseproductions.com
# Should return 200 OK with Cloudflare headers
```

### 3. Test Health Endpoint
```bash
curl https://www.inthehouseproductions.com/api/health
# Should return: {"status":"ok","timestamp":"..."}
```

### 4. Test Homepage
```bash
curl -s https://www.inthehouseproductions.com/ | head -20
# Should show "In The House Productions" HTML
```

---

## 🎯 What You Need to Do

### Immediate Actions Required:

1. **Log into your domain registrar** (GoDaddy, Namecheap, Google Domains, etc.)
   
2. **Remove current DNS record** pointing to GenSpark URL:
   ```
   ❌ DELETE: www → 6fde20b0-62cb-4a62-a3c7-795f2e74b4f3.vip.gensparksite.com
   ```

3. **Add new DNS record** pointing to Cloudflare Pages:
   ```
   ✅ ADD: www → webapp-2mf.pages.dev (CNAME)
   ```
   
   OR follow Cloudflare dashboard instructions (Option 1 above)

4. **Enable Cloudflare proxy** (orange cloud) for:
   - Free SSL/TLS certificate
   - CDN caching
   - DDoS protection
   - Performance optimization

---

## 📊 Expected Results After Fix

### DNS Should Show:
```
www.inthehouseproductions.com → webapp-2mf.pages.dev
```

### HTTPS Should Work:
```
https://www.inthehouseproductions.com → Your Booking Application
```

### Health Check Should Return:
```json
{
  "status": "ok",
  "timestamp": "2026-01-13T04:36:21.110Z"
}
```

### Homepage Should Show:
- In The House Productions logo
- DJ Services and Photobooth cards
- Retro 80's/90's/2000's theme
- Working booking system

---

## 🔧 Troubleshooting

### Issue: DNS not updating
**Solution**: 
- Clear your browser cache
- Wait up to 24-48 hours for full DNS propagation
- Use incognito/private browsing mode
- Try different DNS resolver: `8.8.8.8` (Google DNS)

### Issue: SSL certificate not working
**Solution**:
- Ensure Cloudflare proxy is enabled (orange cloud)
- SSL/TLS mode: Full or Full (strict)
- Wait 5-10 minutes for certificate provisioning

### Issue: Still seeing 404
**Solution**:
- Verify DNS points to `webapp-2mf.pages.dev`
- Check Cloudflare Pages custom domain status
- Ensure domain is verified in Cloudflare dashboard

---

## 📞 Where to Configure DNS

Your DNS records should be configured in **ONE** of these places:

1. **Cloudflare Dashboard** (if using Cloudflare nameservers) ✅ BEST
   - Full integration with Pages
   - Automatic SSL
   - Best performance

2. **Your Domain Registrar** (GoDaddy, Namecheap, etc.)
   - Need to point to Cloudflare Pages manually
   - Add CNAME: www → webapp-2mf.pages.dev

3. **Other DNS Provider** (Route53, Google Domains, etc.)
   - Similar to registrar configuration
   - Add CNAME record as specified above

---

## 🎯 Quick Reference

| What | Current (Wrong) | Should Be (Correct) |
|------|----------------|---------------------|
| **DNS Target** | GenSpark URL | `webapp-2mf.pages.dev` |
| **HTTPS Status** | 200 (but 404 page) | 200 (with your app) |
| **Health Check** | 404 Not Found | `{"status":"ok"}` |
| **Application** | LiteSpeed 404 | Your Booking System |

---

## ✅ Success Checklist

After making changes, verify:
- [ ] DNS points to `webapp-2mf.pages.dev` (not GenSpark URL)
- [ ] HTTPS works: `https://www.inthehouseproductions.com`
- [ ] Health check returns: `{"status":"ok"}`
- [ ] Homepage loads with In The House Productions branding
- [ ] Booking flow works end-to-end
- [ ] SSL certificate is valid (green padlock)
- [ ] No redirect loops

---

## 📱 Contact Support

If you need help with DNS configuration:

1. **Cloudflare Support**: https://dash.cloudflare.com/?to=/:account/support
2. **Your Domain Registrar Support**: Contact your registrar's support team
3. **Documentation**: https://developers.cloudflare.com/pages/how-to/custom-domains/

---

## 🚀 Summary

**Current State**: Domain points to GenSpark (wrong) → Shows 404  
**Desired State**: Domain points to Cloudflare Pages (correct) → Shows your app  

**Action Required**: Update DNS records to point to `webapp-2mf.pages.dev`

**Once Fixed**: Your custom domain will serve your booking application with:
- ✅ HTTPS enabled
- ✅ Fast CDN delivery
- ✅ Cloudflare protection
- ✅ Professional custom domain
- ✅ Full booking functionality

---

**Last Updated**: January 13, 2026  
**Status**: ⚠️ Awaiting DNS configuration update  
**Next Step**: Update DNS records in your domain registrar or Cloudflare dashboard
