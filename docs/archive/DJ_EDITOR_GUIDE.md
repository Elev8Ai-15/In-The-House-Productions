# 🎧 DJ PROFILE EDITOR - Visual Guide

## 🌐 Live Editor URL
**Access the DJ Profile Editor:**
https://3000-iep0ibbw2vbqh3zzjh4nq-2b54fc91.sandbox.novita.ai/dj-editor

---

## 📋 Overview
The DJ Profile Editor is a **live, interactive tool** that allows you to:
- ✏️ Edit all DJ profile details in real-time
- 👁️ See live preview as you type
- 💾 Export all DJ profiles as JSON
- 🎨 Full red, black, chrome, and gold 3D styling

---

## 🎯 Features

### 1. **Three DJ Profiles Pre-Loaded**
- **DJ Cease** (Mike Cecil) - 1st Choice, 20+ Years
- **DJ Elev8** (Brad Powell) - 2nd Choice, 15+ Years
- **TKOtheDJ** (Joey Tate) - 3rd Choice, 10+ Years

### 2. **Editable Fields**
Each DJ profile includes:
- **DJ Name**: Stage name (e.g., "DJ Cease")
- **Real Name**: Legal name (e.g., "Mike Cecil")
- **Priority**: 1st, 2nd, or 3rd Choice
- **Years of Experience**: (e.g., "20+ Years")
- **Biography**: Full description paragraph
- **Specialties**: List of skills/expertise (add/remove items)

### 3. **Live Preview Panel**
The right side shows:
- Ultra-realistic 3D text effects
- Chrome/gold styling
- Exact layout as it will appear on the website
- Priority badges
- All specialties with styled bullets

### 4. **Interactive Controls**
- **Switch DJ**: Click top buttons to edit different DJs
- **Add Specialty**: Click "+ ADD SPECIALTY" to add new items
- **Remove Specialty**: Click "✕" button next to any specialty
- **Update Preview**: Click to refresh the preview panel
- **Export JSON**: Downloads complete DJ data file

---

## 📖 How to Use

### Step 1: Open the Editor
Navigate to: https://3000-iep0ibbw2vbqh3zzjh4nq-2b54fc91.sandbox.novita.ai/dj-editor

### Step 2: Select a DJ
Click one of the three buttons at the top:
- `DJ CEASE` (default)
- `DJ ELEV8`
- `TKO THE DJ`

### Step 3: Edit Details
**Left Panel (Editor):**
1. **DJ Name**: Type the stage name
2. **Real Name**: Enter legal name
3. **Priority**: Select from dropdown (1st, 2nd, 3rd Choice)
4. **Years of Experience**: Type experience level
5. **Biography**: Write full bio paragraph
6. **Specialties**:
   - Type in existing fields to edit
   - Click `+ ADD SPECIALTY` to add new
   - Click `✕` to remove items

### Step 4: Preview Changes
**Right Panel (Live Preview):**
- Shows exactly how the profile will look
- Updates when you click "UPDATE PREVIEW"
- Displays:
  - Priority badge (gold)
  - DJ name (chrome 3D text)
  - Real name (gray text)
  - Biography (red accent border)
  - Specialties (chrome bordered items)

### Step 5: Export Data
When finished editing:
1. Click **"EXPORT JSON"** button
2. File `dj_profiles.json` downloads automatically
3. Share this file to update the website

---

## 🎨 Visual Design

### Color Scheme
- **Primary Red**: `#E31E24` - Borders, accents, buttons
- **Chrome Silver**: `#C0C0C0` - Headers, borders, specialty items
- **Gold**: `#FFD700` - Labels, priority badges, bullets
- **Deep Black**: `#0a0a0a` - Backgrounds

### 3D Text Effects
- **Ultra 3D**: Main title (30-layer shadow)
- **Chrome 3D**: DJ names (metallic gradient)
- **Gold 3D**: Section headers (gold gradient)

### Layout
- **2-Column Grid**: Editor left, Preview right
- **Responsive**: Stacks on mobile (<1200px)
- **Sticky Preview**: Preview panel stays visible while scrolling

---

## 💾 Data Structure

### JSON Export Format
```json
{
  "dj_cease": {
    "id": "dj_cease",
    "name": "DJ Cease",
    "realName": "Mike Cecil",
    "bio": "With over 20 years...",
    "specialties": [
      "Weddings & Special Events",
      "Top 40, Hip-Hop, R&B",
      "Crowd Reading & Energy Management",
      "Custom Playlist Curation",
      "20+ Years Experience"
    ],
    "priority": 1,
    "yearsExp": "20+ Years"
  },
  "dj_elev8": { ... },
  "tko_the_dj": { ... }
}
```

---

## 📝 Current DJ Profiles

### DJ Cease (Mike Cecil)
**Priority:** 1st Choice  
**Experience:** 20+ Years  
**Bio:** With over 20 years behind the decks, DJ Cease brings unmatched energy and professionalism to every event. Specializing in creating seamless musical journeys, Mike has mastered the art of reading the crowd and delivering exactly what the moment needs.

**Specialties:**
- Weddings & Special Events
- Top 40, Hip-Hop, R&B
- Crowd Reading & Energy Management
- Custom Playlist Curation
- 20+ Years Experience

---

### DJ Elev8 (Brad Powell)
**Priority:** 2nd Choice  
**Experience:** 15+ Years  
**Bio:** Brad Powell, known as DJ Elev8, elevates every event with his dynamic mixing style and vast musical knowledge. His ability to blend genres seamlessly while maintaining high energy keeps dance floors packed all night long.

**Specialties:**
- High-Energy Dance Events
- EDM, House, Top 40
- Corporate Events & Parties
- Creative Mixing & Transitions
- 15+ Years Experience

---

### TKOtheDJ (Joey Tate)
**Priority:** 3rd Choice  
**Experience:** 10+ Years  
**Bio:** Joey Tate, performing as TKOtheDJ, delivers knockout performances that leave lasting impressions. Known for his technical precision and creative approach, Joey brings fresh energy to the DJ scene.

**Specialties:**
- Versatile Genre Mixing
- Birthday Parties & Celebrations
- Hip-Hop, Pop, Rock Classics
- Interactive Crowd Engagement
- 10+ Years Experience

---

## ✅ Next Steps

### After Editing:
1. ✏️ Edit all DJ profiles to your liking
2. 👁️ Verify everything looks perfect in preview
3. 💾 Click "EXPORT JSON"
4. 📤 Share the downloaded `dj_profiles.json` file
5. 🔄 Profiles will be updated on the main website

### Update Website:
Once you share the JSON file, I will:
1. Update the `/api/services/dj` endpoint
2. Update the `/dj-services` page
3. Rebuild and redeploy the application
4. Verify all changes are live

---

## 🎯 Tips for Great Profiles

### Biography Writing:
- Start with years of experience
- Highlight unique skills/approach
- Mention event types
- Keep it 3-4 sentences
- Use action words and energy

### Specialties:
- List 4-6 specialties
- Include music genres
- Add event types
- Mention unique skills
- End with experience level

### Priority Setting:
- **1st Choice**: Most experienced/versatile
- **2nd Choice**: Strong alternative
- **3rd Choice**: Third option/specialized

---

## 📊 Technical Details

### File Information:
- **Route**: `/dj-editor`
- **Bundle Size**: 108KB (includes editor)
- **Framework**: Hono + Vanilla JS
- **Styling**: TailwindCSS + Custom CSS
- **Data Storage**: JavaScript object (export to JSON)

### Browser Support:
- ✅ Chrome/Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers

---

## 🚀 Quick Start

```bash
# 1. Open the editor
https://3000-iep0ibbw2vbqh3zzjh4nq-2b54fc91.sandbox.novita.ai/dj-editor

# 2. Click a DJ button at the top
# 3. Edit the fields on the left
# 4. Click "UPDATE PREVIEW" to see changes
# 5. Click "EXPORT JSON" when finished
# 6. Share the downloaded file
```

---

## 📞 Support

If you need help:
1. Check the live preview to see how it will look
2. All changes are saved in the editor (per DJ)
3. Export JSON anytime to save your work
4. Refresh page to reset to original data

---

**Created:** December 2, 2025  
**Version:** 1.0.0  
**Project:** In The House Productions  
**Progress:** 70% Complete (Phase 4 Done)
