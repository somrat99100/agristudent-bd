# Security Update v2.0 - Git Commands

## Apply Security Updates

### Step 1: Add Files
```bash
git add firestore.rules storage.rules firebase.json SECURITY_UPDATE_V2.md GIT_COMMANDS_SECURITY_UPDATE.md
```

### Step 2: Commit
```bash
git commit -m "Security update v2.0: Fix blog deletion auth, restrict avatar access, add CSP headers"
```

### Step 3: Push to GitHub
```bash
git push origin main
```

### Step 4: Deploy to Firebase
```bash
firebase deploy --only firestore:rules,storage:rules,hosting:headers
```

---

## What Changed

### Critical Fixes
1. **Blog Post Deletion** - Now requires authentication (was public)
2. **Avatar Access** - Now restricted to verified users (was public)
3. **Security Headers** - Added CSP, X-XSS-Protection, and enhanced CSP

### Files Modified
- `firestore.rules` - Fixed blog deletion rule
- `storage.rules` - Restricted avatar read access
- `firebase.json` - Added security headers
- `SECURITY_UPDATE_V2.md` - Full security audit report

---

## One-Line Quick Commands

```bash
# Check what changed
git diff firestore.rules storage.rules firebase.json

# Apply all at once
git add firestore.rules storage.rules firebase.json SECURITY_UPDATE_V2.md && git commit -m "Security update v2.0: Fix blog deletion auth, restrict avatar access, add CSP headers" && git push origin main

# Deploy to Firebase
firebase deploy --only firestore:rules,storage:rules
```

---

## Next Steps (From SECURITY_UPDATE_V2.md)

### Priority 2 Actions:
1. Regenerate Cloudinary upload preset with restrictions
2. Add rate limiting (Cloud Functions)
3. Implement account lockout

### Priority 3 Actions:
1. Migrate to Firebase Authentication
2. Add security audit logging
3. Implement vulnerability scanning

See `SECURITY_UPDATE_V2.md` for full details.
