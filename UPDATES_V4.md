# AgriStudent BD — Updates V4 (August 26, 2026)

## Overview
Major feature additions for blog post editing, text formatting, improved resource counting, and enhanced help system.

---

## BLOG FEATURES (blog.html, js/blog.js, css/blog.css)

### 1. **Text Size Formatting Option**
- **Added:** Font size dropdown selector in composer toolbar
- **Available sizes:** Small (14px), Normal (16px), Large (18px), Extra Large (20px), Heading (24px)
- **File:** `blog.html` (lines 66-71), `js/blog.js` (lines 705-716), `css/blog.css` (lines 176-189)
- **How it works:** Select size from dropdown → applies formatting to selected text

### 2. **Post Edit & Delete by Authors**
- **Added:** Edit (✏️) and Delete (🗑️) buttons visible only to post authors
- **Edit Flow:**
  1. Author clicks Edit button
  2. Post content loads into composer
  3. Author makes changes
  4. Submit button shows "💾 Save Changes"
  5. System updates post and sets status to `pending_edit`
  6. Admin reviews and approves or rejects changes
  
- **Delete Flow:**
  1. Author clicks Delete button
  2. Confirmation dialog appears
  3. Post is permanently deleted from database
  
- **Files modified:**
  - `blog.html` (lines 1034-1087)
  - `js/blog.js` (lines 1034-1170)
  - `css/blog.css` (lines 517-542)

### 3. **Edit Status Badge**
- **New Status:** "pending_edit" — shows when a post has been edited and awaits admin approval
- **Display:** Posts with edited content show "📝 Pending Approval" badge instead of regular status
- **Files:** `js/blog.js` (lines 1028-1031), `css/blog.css` (lines 519)

### 4. **Grid Layout (Facebook-style)**
- **Changed:** Blog feed now uses CSS Grid with single column layout on mobile, responsive on desktop
- **Mobile:** One post per row (stacked vertically)
- **Desktop:** Still single column but optimized for wider screens
- **Files:** `css/blog.css` (lines 450-466)

### 5. **View Tracking (10-Second Intervals)**
- **New Logic:** Views are now counted every 10 seconds while a post is visible (scrolling or stationary)
- **Previous:** Only counted once when post entered viewport
- **How it works:**
  1. Post enters viewport → start 10-second interval counter
  2. Every 10 seconds → increment views counter in database
  3. Post leaves viewport → stop counting
  4. Views persist across sessions (each 10-second interval is a separate view)
- **Files:** `js/blog.js` (lines 1092-1125)

### 6. **See More / See Less Toggle** (Already Implemented)
- No changes needed — existing functionality preserved

---

## RESOURCES & FILE MANAGEMENT (js/resources.js, js/stats.js)

### 1. **File-Level Resource Counting** 
- **Changed:** Resources homepage stat now counts individual files, not just folders
- **Benefit:** Accurate count reflects actual number of PDF/presentation files available
- **Example:**
  - Before: 1 folder = 1 resource (regardless of 5 PDFs inside)
  - After: 5 PDFs in 1 folder = 5 resources
- **Files:** `js/stats.js` (lines 16-19)

### 2. **Automatic Rename for Duplicate Filenames**
- **New Function:** `autoRenameIfDuplicate()` in `js/resources.js` (lines 40-77)
- **When it triggers:** During file upload, system checks if filename already exists in same course/faculty
- **How it works:**
  - If `report.pdf` already exists → uploads as `report (1).pdf`
  - If `report (1).pdf` also exists → uploads as `report (2).pdf`
  - Continues numbering until unique name found
- **Applied to:** All three file upload flows (courses, hand notes, assignments)
- **Files:** 
  - `js/resources.js` (lines 40-77, 419-428, 894-903, 1555-1564)

---

## HELP & CONTACT SYSTEM (help.html, js/help.js)

### 1. **Auto-Fill User Information**
- **Feature:** Name and Email fields auto-populate for logged-in users
- **Benefit:** Users can still change email if needed
- **Implementation:**
  - On page load, system checks user session
  - If logged in: populates name from `displayName` and email from `email`
  - User can edit both fields before submitting
- **Files:** `js/help.js` (lines 1-25)

### 2. **Email Notifications to Admin**
- **New:** Help messages are sent to `iubatagriculture@gmail.com` via EmailJS
- **Setup Required:** Create EmailJS template named `template_help_msg` with variables:
  - `to_email`: iubatagriculture@gmail.com
  - `from_name`: User's name
  - `from_email`: User's email
  - `message`: Help message body
  - `site_name`: "AgriStudent BD"
  
- **Fallback:** If EmailJS not configured, messages still save to Firestore database
- **Files:** `js/help.js` (lines 27-55)

---

## DATABASE & SECURITY (firestore.rules)

### 1. **Blog Post Edit Rules**
- **Added:** New security rule allowing authenticated authors to edit their own posts
- **Rule:** Posts can only be edited by the author (authorEmail must match request auth token email)
- **Conditions:**
  - Only title, content, imageUrls, status, editedAt, editedBy fields can be modified
  - Status must be set to "pending_edit" (for admin review)
  - Author email cannot be changed
- **Lines:** 237-244 (new rules added)

### 2. **Blog Post Delete Rules**
- **Updated:** Delete now restricted to post author only (was: any authenticated user)
- **Rule:** Only the post's author can delete it
- **Line:** 248

---

## FILE STRUCTURE SUMMARY

### HTML Files
- `blog.html` — Added font size dropdown to toolbar
- `help.html` — No changes needed

### JavaScript Files
- `js/blog.js` — Edit/delete buttons, font size handler, edit status badge, improved view tracking
- `js/help.js` — Auto-fill user info, email notifications to admin
- `js/resources.js` — Auto-rename function, applied to all 3 upload flows
- `js/stats.js` — Updated resource counting logic

### CSS Files
- `css/blog.css` — Grid layout, menu button styles, edited badge styling, font size select styling

### Database Rules
- `firestore.rules` — New blog edit rules, updated delete permissions

---

## DEPLOYMENT CHECKLIST

- [ ] Update `/js/blog.js` with edit/delete handlers and view tracking
- [ ] Update `/js/help.js` with auto-fill and email notifications
- [ ] Update `/js/resources.js` with auto-rename function
- [ ] Update `/css/blog.css` with new grid and menu styles
- [ ] Update `/firestore.rules` with new edit/delete permissions
- [ ] Update `/blog.html` to include font size dropdown
- [ ] **EmailJS Setup:** Create template `template_help_msg` in EmailJS dashboard
- [ ] Test blog post editing flow (create → edit → verify pending_edit status)
- [ ] Test file upload with duplicate filenames
- [ ] Test help form auto-fill for logged-in users
- [ ] Verify view tracking counts every 10 seconds

---

## TESTING SCENARIOS

### Blog Edit Flow
1. Create a post → Verify it shows ✏️ Edit and 🗑️ Delete buttons (author only)
2. Click Edit → Post loads into composer
3. Make changes → Click "💾 Save Changes"
4. Verify post status changes to "📝 Pending Approval"
5. As admin, approve/reject the edit

### Resource Duplicate Filenames
1. Upload `lesson.pdf` for AGR 101
2. Upload `lesson.pdf` again for same course
3. Verify second file saves as `lesson (1).pdf`
4. Upload again → saves as `lesson (2).pdf`

### Help Form Auto-Fill
1. Log in as a user
2. Navigate to Help page
3. Verify Name field shows your name
4. Verify Email field shows your email
5. Submit form → verify admin receives email at iubatagriculture@gmail.com

### View Tracking
1. Scroll to a post and leave it on-screen
2. Wait 10 seconds → View count should increase by 1
3. Wait another 10 seconds → View count should increase by 2 total
4. Scroll post out of view → Wait 10 seconds → View count should stop increasing

---

## NOTES FOR ADMIN

- **Edited Posts:** Check admin panel for posts with "pending_edit" status in a new section
- **Duplicate Files:** System automatically handles - no manual intervention needed
- **Help Messages:** Set up EmailJS template for email notifications, or messages will save to database only
- **View Tracking:** More accurate now - each 10-second viewing session counts as one view

---

## Version History
- **V1** — Initial platform launch
- **V2** — Added comments, likes, resource uploads
- **V3** — Added admin panel, verification workflow
- **V4** — Post editing, text formatting, improved resource management, help email notifications
