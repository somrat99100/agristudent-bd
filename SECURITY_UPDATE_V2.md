# Security Hardening Update - v2.0

**Audit Date:** September 2026  
**Status:** Critical & Medium priority fixes identified  
**Action:** Review and implement recommendations below

---

## 🔴 CRITICAL ISSUES

### 1. **Blog Post Deletion - No Authentication Required**
**File:** `firestore.rules` (Line 273)  
**Issue:** `allow delete: if true;` permits ANYONE to delete ANY blog post

```firestore
// ❌ CURRENT (UNSAFE)
allow delete: if true;

// ✅ RECOMMENDED
allow delete: if request.auth != null;
```

**Risk:** Malicious actors can wipe entire blog content  
**Impact:** Data loss, service disruption  

---

### 2. **Cloudinary Upload Preset Exposed**
**File:** `js/firebase-config.js` (Line 26)  
**Issue:** `CLOUDINARY_UPLOAD_PRESET` is hardcoded in frontend

```javascript
// ❌ CURRENT
export const CLOUDINARY_UPLOAD_PRESET = "Agriculture";

// ✅ RECOMMENDED
// Move to backend environment variables or use signed uploads
// For now: Regenerate preset with strict folder/format restrictions
```

**Risk:** Unauthorized file uploads, storage abuse  
**Action:** 
- Regenerate upload preset in Cloudinary with:
  - Folder: `agristudent-bd/` only
  - File type: Images + PDFs only
  - Max file size: 50MB
  - Delete old preset

---

### 3. **Session-Based Authentication (Client-Side)**
**Files:** `js/session.js`, `js/login.js`  
**Issue:** User session stored in sessionStorage, not backed by real auth

```javascript
// ❌ CURRENT
// Login works via sessionStorage session only
saveSession({ regId, email, ... });

// ✅ RECOMMENDED
// Implement Firebase Authentication as backup verification
// Even though site is unauthenticated by design, add optional:
// - Email/Password login for trusted users
// - Session timeout (30 min)
// - Session validation on page load
```

**Risk:** Spoofed sessions, account takeover  

---

## 🟡 MEDIUM PRIORITY

### 4. **Missing Rate Limiting**
**All POST/CREATE endpoints vulnerable to abuse:**
- Registration spam
- Comment/post spam
- Resource upload spam

**Recommendation:**
```firestore
// Add timestamp-based rate limiting
// Example for comments:
allow create: if
  !exists(/databases/$(database)/documents/rateLimits/user_$(request.auth.uid)_comment_$(request.timeValue.toMillis())) ||
  get(/databases/$(database)/documents/rateLimits/user_$(request.auth.uid)_comment_$(request.timeValue.toMillis())).data.timestamp < now.toMillis() - 3600000;
```

Or use Cloud Functions + Firestore triggers for rate limiting.

---

### 5. **No Input Sanitization for Blog Content**
**File:** `js/blog.js`  
**Issue:** HTML content stored in posts, relies on client-side escaping

```javascript
// ✅ ADD: Server-side HTML sanitization
// Use Firebase Cloud Function to sanitize all user input:
// - Remove script tags
// - Escape HTML entities
// - Validate image URLs point to trusted CDN (Cloudinary only)
```

---

### 6. **Storage Rules - Path Traversal Risk**
**File:** `storage.rules` (Line 32 - avatars)  
**Issue:** Avatar read access is `if true;` (public)

```firestore
// ✅ RECOMMENDED (if avatars should be private)
match /avatars/{uid}/{fileName} {
  allow read: if verified() || admin();  // Change from true
  allow write: if (verified() && request.auth.uid == uid ...) || admin();
  allow delete: if (verified() && request.auth.uid == uid) || admin();
}
```

---

### 7. **Missing CORS & Security Headers**
**Add to `firebase.json`:**

```json
{
  "hosting": {
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "X-Content-Type-Options",
            "value": "nosniff"
          },
          {
            "key": "X-Frame-Options",
            "value": "DENY"
          },
          {
            "key": "X-XSS-Protection",
            "value": "1; mode=block"
          },
          {
            "key": "Referrer-Policy",
            "value": "strict-origin-when-cross-origin"
          },
          {
            "key": "Strict-Transport-Security",
            "value": "max-age=31536000; includeSubDomains"
          },
          {
            "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'self' https://www.gstatic.com https://www.googletagmanager.com; img-src 'self' https://res.cloudinary.com data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://www.googleapis.com https://www.firebaseio.com https://api.cloudinary.com"
          }
        ]
      }
    ]
  }
}
```

---

### 8. **No Account Lockout on Failed Logins**
**File:** `js/login.js`  
**Recommendation:** Track failed login attempts

```javascript
// Track failed attempts in Firestore
const loginAttempts = collection(db, "loginAttempts");
// Lock account after 5 failed attempts for 30 minutes
// Use timestamp + email as key
```

---

### 9. **OTP Not Time-Limited Strictly**
**File:** `js/otp.js`  
**Recommendation:** Strengthen OTP validation

```javascript
// ✅ Ensure OTP:
// - Expires after 10 minutes (currently unclear)
// - Single-use only
// - Invalidates after 3 failed attempts
// - Is 6-8 digits minimum (entropy check)
```

---

### 10. **Email Verification Not Enforced**
**File:** `firestore.rules` (Line 28)  
**Issue:** get allows status=="verified" OR unauthenticated

```firestore
// Only truly verified emails should access sensitive data
allow get: if
  resource.data.status == "verified" &&
  resource.data.email is string &&
  resource.data.email.size() > 3;  // Basic format check
```

---

## ✅ IMMEDIATE ACTIONS

### Priority 1 (Deploy ASAP):
```bash
# 1. Fix blog deletion
# Edit firestore.rules line 273:
allow delete: if request.auth != null;

# 2. Deploy updated rules
firebase deploy --only firestore:rules,storage:rules

# 3. Rotate Cloudinary preset
# In Cloudinary dashboard:
# - Create new upload preset with restrictions
# - Update CLOUDINARY_UPLOAD_PRESET in js/firebase-config.js
# - Delete old preset

# 4. Git commit
git add firestore.rules storage.rules js/firebase-config.js SECURITY_UPDATE_V2.md
git commit -m "Security update: Fix blog deletion, update storage rules, rotate Cloudinary preset"
git push origin main
```

### Priority 2 (Next Release):
- Implement rate limiting via Cloud Functions
- Add security headers to firebase.json
- Add account lockout on failed login attempts
- Implement server-side HTML sanitization

### Priority 3 (Long-term):
- Migrate to Firebase Authentication for all users (optional)
- Implement API key rotation policy
- Add security audit logging
- Implement automated vulnerability scanning

---

## 📋 SECURITY CHECKLIST

- [ ] Blog deletion requires auth (`firestore.rules`)
- [ ] Storage rules reviewed (`storage.rules`)
- [ ] Cloudinary preset regenerated with restrictions
- [ ] Security headers added to `firebase.json`
- [ ] Firebase deployed: `firebase deploy --only firestore:rules,storage:rules`
- [ ] Changes committed and pushed to GitHub
- [ ] Email verification rules strengthened
- [ ] OTP validation tightened (10 min expiry, 3 attempts max)
- [ ] Input sanitization documented for Cloud Functions
- [ ] Rate limiting strategy selected and documented

---

## 📚 REFERENCE

- [Firebase Security Best Practices](https://firebase.google.com/docs/firestore/best-practices)
- [OWASP Web Top 10](https://owasp.org/www-project-top-ten/)
- [Firebase Storage Security](https://firebase.google.com/docs/storage/security)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
