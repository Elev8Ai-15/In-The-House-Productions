# 🎯 HOW TO GET TO YOUR ACTUAL DOMAIN DNS SETTINGS

You're looking at ACCOUNT SETTINGS (default settings for new domains).

You need to go to YOUR SPECIFIC DOMAIN settings.

---

## ✅ CORRECT PATH IN NAMECHEAP

### Step 1: Go to Domain List
1. Click **"Domain List"** in the left sidebar or top menu
2. You should see a list of YOUR domains

### Step 2: Find Your Domain
1. Look for: **inthehouseproductions.com**
2. Click the **"Manage"** button next to it

### Step 3: Find Advanced DNS Tab
1. You should see tabs at the top like:
   - Details
   - **Advanced DNS** ← Click this one
   - Sharing & Transfer
   - etc.

### Step 4: Add CNAME Record
In Advanced DNS, you'll see:
- **Host Records** section
- **Add New Record** button ← Click this
- Select: **CNAME Record**
- Host: **www**
- Value: **webapp-2mf.pages.dev**
- TTL: Automatic
- Save

---

## 🔥 ALTERNATIVE: USE CLOUDFLARE NAMESERVERS

If you STILL can't find it, let's switch to Cloudflare DNS (easier):

### What You Need to Do in Namecheap:

1. Go to Domain List → inthehouseproductions.com → **Manage**
2. Find the **Nameservers** section
3. Change from "Namecheap BasicDNS" to **"Custom DNS"**
4. Enter these 2 nameservers:

```
aron.ns.cloudflare.com
nola.ns.cloudflare.com
```

5. Save

Then **I** can manage the DNS records in Cloudflare dashboard and add the CNAME for you.

---

## 📸 WHAT TO DO NOW

Take a screenshot of:
- Your Namecheap Domain List page
- Or the main page after clicking "Manage" on your domain

So I can see exactly what options YOU have.

---

**Are you in the Domain List page or still in Account Settings?**
