# Agri Core — Implementation Guide V4
## Complete Setup Instructions for All New Features

---

## 📋 TABLE OF CONTENTS
1. [Blog Features](#blog-features)
2. [Help System Setup](#help-system-setup)
3. [Resources Management](#resources-management)
4. [Firestore Rules](#firestore-rules)
5. [Testing Checklist](#testing-checklist)

---

## 🎯 BLOG FEATURES

### A. Text Size Formatting

**What Users See:**
- Font size dropdown in the composer toolbar
- Options: Small (14px), Normal (16px), Large (18px), Extra Large (20px), Heading (24px)

**How It Works:**
1. User opens composer ("What's on your mind?")
2. Types or selects text
3. Clicks font size dropdown
4. Selects desired size
5. Text is formatted and applies to selected content

**Files Involved:**
- `blog.html` — Contains the HTML select dropdown
- `js/blog.js` — Lines 705-716 handle the dropdown change event
- `css/blog.css` — Lines 176-189 style the dropdown

**Code Snippet (from js/blog.js):**
```javascript
const fontSizeSelect = document.getElementById("font-size-select");
fontSizeSelect?.addEventListener("change", (e) => {
  const size = e.target.value;
  if (size) {
    document.execCommand("fontSize", false, "7");
    const spans = postBodyInput.querySelectorAll("span[style*='font-size']");
    spans.forEach(span => {
      span.style.fontSize = size;
    });
    postBodyInput.focus();
    fontSizeSelect.value = "";
  }
});
```

---

### B. Post Editing by Authors

**What Users See:**
- Edit (✏️) and Delete (🗑️) buttons on their own posts (top right)
- Only visible to the post author
- For other users' posts: buttons hidden

**How It Works:**

#### Editing a Post:
1. Author clicks ✏️ Edit button
2. Composer modal opens with post content pre-loaded
3. Button text changes to "💾 Save Changes"
4. Author edits title, content, or images
5. Author clicks "💾 Save Changes"
6. Post status changes to `pending_edit`
7. Admin receives notification and reviews changes
8. Admin approves or rejects the edit
9. Once approved, post reverts to normal status

#### Deleting a Post:
1. Author clicks 🗑️ Delete button
2. Confirmation dialog: "Are you sure? This cannot be undone."
3. If confirmed, post is deleted immediately
4. Post removed from feed

**Database Status Flow:**
```
pending → approved (normal post)
pending_edit ← (after author edits approved post)
pending_edit → approved (after admin approves edit)
pending_edit → pending (if admin rejects edit)
```

**Files Involved:**
- `blog.html` — Edit/Delete buttons added to post header (lines 1034-1057)
- `js/blog.js` — Lines 1034-1087 (edit/delete button handlers)
- `css/blog.css` — Lines 517-542 (menu button styling)
- `firestore.rules` — Lines 237-244, 248 (security rules for editing/deleting)

**Key Code (from js/blog.js):**
```javascript
editBtn?.addEventListener("click", () => {
  const s = getSession();
  if (!s || normalizeEmail(s.email) !== item.authorEmail) {
    alert("You can only edit your own posts");
    return;
  }
  // Load post into composer
  postTitleInput.value = item.title;
  postBodyInput.innerHTML = item.content;
  composerModal.classList.remove("hidden");
  postSubmitBtn.textContent = "💾 Save Changes";
});
```

---

### C. Edit Status Badge

**What Users See:**
- "📝 Pending Approval" badge on edited posts waiting for admin review
- Replaces the normal "Not verified" badge during edit review
- Changes back to "✅ Verified" once admin approves

**Display Logic:**
- New posts: "🕓 Not verified" → after admin approval → "✅ Verified"
- Edited posts: "📝 Pending Approval" → after admin approval → "✅ Verified"

**Files:**
- `js/blog.js` — `statusBadgeHTML()` function (lines 1028-1031)
- `css/blog.css` — `.blog-badge--edited` class (line 519)

---

### D. Grid Layout (Facebook-Style)

**What Changed:**
- Blog feed now displays in a CSS Grid layout
- Mobile: Single column (one post per row)
- Desktop: Single column but with responsive width (max 600px)
- Maintains spacing and visual hierarchy

**CSS Changes (blog.css lines 450-466):**
```css
.blog-feed {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
}
```

**Why Grid?**
- More flexible layout system
- Better alignment on different screen sizes
- Easier to adjust to 2-column or 3-column layouts in future if needed

---

### E. View Tracking (Every 10 Seconds)

**What Changed:**
- Views now count every 10 seconds while post is visible
- Previous system: counted only once when user first viewed post

**How It Works:**
1. User scrolls to a post (post enters viewport)
2. Intersection Observer detects post is visible
3. 10-second timer starts
4. After 10 seconds → +1 view added to database
5. Another 10 seconds → +1 more view
6. This continues as long as post remains visible
7. User scrolls away → timer stops
8. Next time post becomes visible → timer restarts

**Benefits:**
- Accurate engagement metric
- Reflects actual time spent viewing content
- Rewards high-quality content with more views
- Distinguishes between quick scrolls and genuine interest

**Code (js/blog.js lines 1092-1125):**
```javascript
// View tracking — count views every 10 seconds of scrolling/viewing
let viewCountInterval = null;
let viewsCountedThisSession = new Set();

const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // Post is in view — start counting views every 10 seconds
      if (!viewCountInterval) {
        viewCountInterval = setInterval(async () => {
          const viewKey = `${id}_${new Date().getTime() / 10000 | 0}`;
          if (!viewsCountedThisSession.has(viewKey)) {
            viewsCountedThisSession.add(viewKey);
            await updateDoc(doc(db, "blogPosts", id), { views: increment(1) });
            // Update UI...
          }
        }, 10000); // Every 10 seconds
      }
    } else {
      // Post left view — stop counting
      if (viewCountInterval) {
        clearInterval(viewCountInterval);
        viewCountInterval = null;
      }
    }
  });
}, { threshold: 0.2 });

io.observe(article);
```

---

## 📧 HELP SYSTEM SETUP

### A. Auto-Fill User Information

**What Users See:**
- Name field automatically filled (for logged-in users)
- Email field automatically filled (for logged-in users)
- Both fields editable if user wants to change them

**How It Works:**
1. Page loads (user must be logged in)
2. System checks `getSession()` for user data
3. If session found:
   - `displayName` → populates Name field
   - `email` → populates Email field
4. User can clear and edit fields before submitting
5. Submit form → message sent with user-provided info

**Code (js/help.js lines 14-25):**
```javascript
function autofillUserInfo() {
  const session = getSession();
  if (session) {
    if (session.displayName) {
      nameInput.value = session.displayName;
    }
    if (session.email) {
      emailInput.value = session.email;
    }
  }
}

window.addEventListener("load", autofillUserInfo);
```

---

### B. Email Notifications to Admin

**Setup Required:** ⚠️ **IMPORTANT**

You must create an EmailJS template for help messages to be emailed to the admin. Here's how:

#### Step 1: Log into EmailJS
- Go to https://www.emailjs.com
- Log in with your account (same one used for other templates)

#### Step 2: Create New Template
1. Navigate to **Email Templates** section
2. Click **Create New Template**
3. Fill in template details:

| Field | Value |
|-------|-------|
| Template Name | `Help Message Template` |
| Subject | `🆘 New Help Request from {{from_name}}` |
| To Email | `iubatagriculture@gmail.com` |

#### Step 3: Template Body
Use this HTML structure:

```html
<h2>New Help Message from Agri Core</h2>

<p><strong>From:</strong> {{from_name}}</p>
<p><strong>Email:</strong> <a href="mailto:{{from_email}}">{{from_email}}</a></p>

<hr>

<p><strong>Message:</strong></p>
<p>{{message}}</p>

<hr>

<p><em>Site: {{site_name}}</em></p>
```

#### Step 4: Get Template ID
1. Click **Save** to create template
2. Copy the **Template ID** (e.g., `template_abc123def456`)
3. Keep this value

#### Step 5: Update js/help.js
Update the template ID in the code (line ~46):

```javascript
await window.emailjs.send(
  "service_6ys3bsi", // EmailJS Service ID (existing)
  "template_help_msg", // ← Change this to your actual template ID
  { ... }
);
```

**Current Code (js/help.js lines 27-55):**
```javascript
async function sendHelpMessage(name, email, message) {
  // Save to Firestore
  await addDoc(collection(db, "messages"), {
    name, email, message,
    submittedAt: serverTimestamp(),
    read: false
  });

  // Send email to admin via EmailJS
  if (typeof window !== "undefined" && window.emailjs) {
    try {
      await window.emailjs.send(
        "service_6ys3bsi",
        "template_help_msg", // ← UPDATE THIS TEMPLATE ID
        {
          to_email: "iubatagriculture@gmail.com",
          from_name: name,
          from_email: email,
          message: message,
          site_name: "Agri Core"
        }
      );
    } catch (err) {
      console.warn("[Help] EmailJS not configured:", err);
    }
  }
}
```

**Fallback:** If EmailJS is not configured:
- Messages still save to Firestore database
- You can manually check admin panel for messages
- User doesn't see an error (failure is silent)

---

## 📚 RESOURCES MANAGEMENT

### A. File-Level Resource Counting

**What Changed:**
- Resource count now reflects actual number of files, not folders

**Example:**
```
Before:
  Folder "AGR 101 - Lecture Notes" = 1 resource (contains 5 PDFs)
  Total: 1 resource on homepage
  
After:
  5 PDF files in "AGR 101" = 5 resources
  Total: 5 resources on homepage
```

**How It Works:**
- System queries database for all approved resources
- Counts each file entry individually
- No changes to upload or storage system

**Files:**
- `js/stats.js` (lines 16-19)

**Code:**
```javascript
"stat-resources": () => {
  return getCountFromServer(
    query(collection(db, "resources"), where("status", "==", "approved"))
  );
}
```

---

### B. Automatic Rename for Duplicate Filenames

**What Users Experience:**
- Upload `lesson.pdf` for AGR 101 → saves as `lesson.pdf`
- Upload same filename again → automatically saves as `lesson (1).pdf`
- Upload again → saves as `lesson (2).pdf`
- And so on...

**Benefits:**
- No file overwrites
- No manual renaming needed
- Maintains original filename as base
- Clear numbering scheme

**How It Works:**
1. User uploads file during submission
2. System checks if filename exists in database (same course + faculty)
3. If duplicate found:
   - Extract filename: `lesson.pdf`
   - Extract extension: `.pdf`
   - Extract base name: `lesson`
   - Add counter: `lesson (1).pdf`
4. Check again if `lesson (1).pdf` exists
5. If yes, increment counter to `lesson (2).pdf`
6. Continue until unique name found
7. Upload file with new name

**Code (js/resources.js lines 40-77):**
```javascript
async function autoRenameIfDuplicate(fileName, courseCode, facultyName) {
  // Check if this filename already exists
  const q = query(
    collection(db, "resources"),
    where("courseCode", "==", courseCode),
    where("fac", "==", facultyName),
    where("status", "==", "approved")
  );
  
  const docs = await getDocs(q);
  const existingNames = [];
  docs.forEach(d => {
    (d.fileUrls || []).forEach(f => {
      existingNames.push(f.name);
    });
  });

  if (!existingNames.includes(fileName)) {
    return fileName; // No conflict
  }

  // Rename with counter
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? "." + parts[parts.length - 1] : "";
  const base = parts.slice(0, -1).join(".");
  
  let counter = 1;
  let newName = `${base} (${counter})${ext}`;
  
  while (existingNames.includes(newName)) {
    counter++;
    newName = `${base} (${counter})${ext}`;
  }
  
  return newName;
}
```

**Applied To:**
- Regular file uploads (js/resources.js line 428)
- Hand notes uploads (js/resources.js line 903)
- Assignment uploads (js/resources.js line 1564)

---

## 🔐 FIRESTORE RULES

### A. New Edit Rules for Blog Posts

**What Changed:**
- Added new security rules allowing authors to edit their own posts

**Rule Details:**
```javascript
allow update: if 
  request.auth != null &&
  resource.data.authorEmail == request.auth.token.email &&
  request.resource.data.status == "pending_edit" &&
  request.resource.data.authorEmail == resource.data.authorEmail &&
  request.resource.data.diff(resource.data).affectedKeys()
    .hasOnly(['title', 'content', 'imageUrls', 'status', 'editedAt', 'editedBy']);
```

**What This Means:**
1. User must be authenticated (`request.auth != null`)
2. User's email must match post's author email
3. New status must be "pending_edit" (for admin review)
4. Can only modify: title, content, images, status, editedAt, editedBy
5. Cannot modify: author email, author name, creation date, counters

**Location:** `firestore.rules` lines 237-244

---

### B. Updated Delete Rules

**What Changed:**
- Delete now restricted to post author only
- Previously: any authenticated user could delete any post

**New Rule:**
```javascript
allow delete: if 
  request.auth != null && 
  resource.data.authorEmail == request.auth.token.email;
```

**What This Means:**
- User must be authenticated
- User's email must match post's author email
- Only the original post author can delete their post
- Admins can still delete in admin panel (separate rules)

**Location:** `firestore.rules` line 248

---

## ✅ TESTING CHECKLIST

### Blog Features Tests

- [ ] **Text Formatting**
  - [ ] Open composer
  - [ ] Type text
  - [ ] Select text and click font size dropdown
  - [ ] Apply "Large (18px)" formatting
  - [ ] Verify text appears larger in preview
  - [ ] Submit post
  - [ ] View post in feed
  - [ ] Verify formatted text displays correctly

- [ ] **Post Editing**
  - [ ] Create a test post
  - [ ] Verify Edit (✏️) button appears on your post
  - [ ] Click Edit button
  - [ ] Verify post content loads into composer
  - [ ] Change title and/or content
  - [ ] Verify button shows "💾 Save Changes"
  - [ ] Click save
  - [ ] Verify post now shows "📝 Pending Approval" badge
  - [ ] Log in as admin
  - [ ] Check admin panel for "pending_edit" posts
  - [ ] Approve edit
  - [ ] Verify post reverts to normal status

- [ ] **Post Deletion**
  - [ ] Create a test post
  - [ ] Click Delete (🗑️) button
  - [ ] Verify confirmation dialog appears
  - [ ] Confirm deletion
  - [ ] Verify post disappears from feed immediately
  - [ ] Refresh page
  - [ ] Verify post doesn't reappear

- [ ] **View Tracking**
  - [ ] Open a post in the middle of feed
  - [ ] Leave browser for 10 seconds (page in view)
  - [ ] Check view count in post
  - [ ] Wait another 10 seconds
  - [ ] Verify view count increased by 2 total
  - [ ] Scroll post out of view
  - [ ] Wait 10 seconds
  - [ ] Scroll back to view post
  - [ ] Verify view count stopped increasing while out of view
  - [ ] Wait 10 more seconds
  - [ ] Verify count continues incrementing

### Help System Tests

- [ ] **Auto-Fill (Logged In)**
  - [ ] Log in to platform
  - [ ] Navigate to Help page
  - [ ] Verify Name field is pre-filled
  - [ ] Verify Email field is pre-filled
  - [ ] Edit Email field (change it)
  - [ ] Submit form
  - [ ] Verify message sent with modified email

- [ ] **Auto-Fill (Logged Out)**
  - [ ] Log out
  - [ ] Navigate to Help page
  - [ ] Verify Name field is empty
  - [ ] Verify Email field is empty
  - [ ] Fill in form
  - [ ] Submit
  - [ ] Verify message sent

- [ ] **Email Notification to Admin**
  - [ ] Fill out help form with test message
  - [ ] Submit
  - [ ] Check email at `iubatagriculture@gmail.com` within 5 minutes
  - [ ] Verify email contains:
    - [ ] Your name (From field)
    - [ ] Your email (From email field)
    - [ ] Your message text
  - [ ] Verify sender is recognizable

### Resources Tests

- [ ] **File Counting**
  - [ ] Check homepage stat for Resources count
  - [ ] Count PDFs in Resources section manually
  - [ ] Verify stat matches actual file count (not folder count)

- [ ] **Duplicate Filename Auto-Rename**
  - [ ] Upload `test.pdf` for AGR 101
  - [ ] Note the filename
  - [ ] Upload another `test.pdf` for same course
  - [ ] Navigate to Resources for that course
  - [ ] Verify files show as:
    - [ ] `test.pdf`
    - [ ] `test (1).pdf`
  - [ ] Upload third `test.pdf`
  - [ ] Verify shows as `test (2).pdf`

---

## 🚀 DEPLOYMENT STEPS

1. **Backup Current System**
   ```bash
   cp -r firebase_config.json firebase_config.json.backup
   ```

2. **Extract Zip File**
   ```bash
   unzip agristudent-bd-updated-v4.zip
   cd agristudent-bd
   ```

3. **Update Firebase Rules**
   - Open Firebase Console
   - Navigate to Firestore > Rules
   - Replace with content from `firestore.rules`
   - Publish rules

4. **Deploy Files to Hosting**
   - Upload all HTML files to Firebase Hosting
   - Upload all files in `/css`, `/js`, `/assets` folders
   - Test deployment in staging environment first

5. **Configure EmailJS** (if using help emails)
   - Create template as described in [Help System Setup](#b-email-notifications-to-admin)
   - Update template ID in `js/help.js` if using different ID

6. **Test All Features**
   - Run through Testing Checklist above
   - Test on mobile and desktop
   - Test with different user roles (student, admin)

7. **Monitor After Launch**
   - Check admin panel for new "pending_edit" posts
   - Monitor help messages in database
   - Watch for any console errors in browser dev tools

---

## 📞 SUPPORT

If you encounter issues:

1. **Blog Edit Not Saving?**
   - Check Firestore rules are deployed
   - Verify user email matches post author email
   - Check browser console for errors

2. **Help Emails Not Sending?**
   - Verify EmailJS template ID is correct
   - Check EmailJS service and template exist
   - Check browser console for email errors
   - Messages will still save to database even if email fails

3. **Duplicate Rename Not Working?**
   - Verify files are marked as "approved" status
   - Check course code and faculty name match exactly
   - Ensure Firestore database has data

4. **View Tracking Not Counting?**
   - Verify Intersection Observer is supported (modern browsers)
   - Check that browser isn't blocking requests to update views
   - Wait full 10 seconds while post is visible

---

## 📝 FILE MANIFEST

All updated files included in `agristudent-bd-updated-v4.zip`:

**HTML Files:**
- `blog.html` — Updated with font size dropdown
- `help.html` — Unchanged (JavaScript handles auto-fill)

**JavaScript Files:**
- `js/blog.js` — Major updates: edit/delete, font size, view tracking
- `js/help.js` — Updated with auto-fill and email notifications
- `js/resources.js` — Added auto-rename function
- `js/stats.js` — Updated resource counting logic

**CSS Files:**
- `css/blog.css` — Added grid layout, edit badge, menu buttons, font select

**Database:**
- `firestore.rules` — New rules for blog editing/deleting

**Documentation:**
- `UPDATES_V4.md` — Summary of all changes
- `IMPLEMENTATION_GUIDE.md` — This file

---

Last Updated: August 26, 2026
Version: 4.0.0
