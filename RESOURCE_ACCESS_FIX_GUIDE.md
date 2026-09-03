# Agri Core: Resource Access Fix — Complete Package

## The Problem (From Your Screenshots)

You see "Resource Access Active" with 11 days remaining, but files still show "Unlock to view" badges and can't be accessed. This is because two separate systems got out of sync:

1. **JavaScript app** (access.js) correctly calculates that you have active access
2. **Firebase Storage rules** can't see that calculation because it's never saved to Firestore

## The Solution (3 Parts)

All three files work together to fix this:

### 1. **storage.rules.FIXED** ← Deploy this first
New Firebase Storage security rules that check for active access status in Firestore.

**What's different:**
- ❌ Old rules checked: `email_verified` (a Firebase Auth property)
- ✅ New rules check: `accessUntil` on the registration document

**How to deploy:**
```
Firebase Console → Firestore Database → Rules
(Replace entire file content) → Publish
```

**Deployment time:** 30 seconds, affects all file access

---

### 2. **ADMIN_ACCESS_SYNC_FIX.js** ← Add to admin.js
When an admin approves or rejects a resource, immediately recalculate and save the student's access status.

**Why needed:**
- Without this, when you approve a resource, the `accessUntil` field doesn't update
- Students' access wouldn't show as current until they reload their profile
- Storage rules would still see stale data

**How to apply:**
```
Edit js/admin.js
Find: resource approval (line ~413) and rejection (line ~468)
Add: await syncStudentAccessStatus(db, item.uploaderEmail);
```

**Code location:** Lines 2-40 of this file (just copy the function)

---

### 3. **PROFILE_ACCESS_SYNC_FIX.js** ← Add to profile.js
When a student loads their profile, compute fresh access status and save it back to Firestore.

**Why needed:**
- This keeps the sync automatic
- If admin adds a new file while student is logged in, profile sync makes sure Firestore sees it
- Students don't need to do anything — it's background

**How to apply:**
```
Edit js/profile.js
Find: renderAccessScale() call (line ~260)
Add: Call syncAccessToRegistration() after it
```

**Code location:** Lines 2-45 of this file (just copy the function)

---

## Quick Deployment (5 minutes)

### Step 1: Deploy Storage Rules (Critical)
1. Copy contents of `storage.rules.FIXED`
2. Go to Firebase Console → Firestore → Rules
3. Paste → Publish
4. **Wait 30 seconds** for global propagation

### Step 2: Update Admin Panel (5 min)
1. Edit `js/admin.js`
2. Add 2 lines (one at line 413, one at line 468)
3. Add the `syncStudentAccessStatus` function from ADMIN_ACCESS_SYNC_FIX.js
4. Test: Approve a resource → Check Firestore registration for `lastAccessSyncAt` field

### Step 3: Update Profile Page (5 min)
1. Edit `js/profile.js`
2. Add 1 line after renderAccessScale() call
3. Add the `syncAccessToRegistration` function from PROFILE_ACCESS_SYNC_FIX.js
4. Test: Load profile page → Check browser console, should see `[Profile] Synced access`

### Step 4: Migrate Existing Students (Choose One)
- **Option A (Automated)**: Run Cloud Function (see MIGRATION_GUIDE section)
- **Option B (Manual)**: Manually update each active student's registration doc in Firestore
- **Option C (Natural)**: Let it happen as students visit their profile page (1-2 weeks)

---

## Testing Your Fix

### Quick Test (2 min)
1. Create a test student account
2. Upload a resource file (as student)
3. **As admin**: Approve it
4. Check Firestore `registrations` collection:
   - Find your test student's doc
   - Should have `accessUntil` field with a future date ✅

### Full Test (10 min)
1. Log in as test student
2. Go to profile page
3. Browser console should show: `[Profile] Synced access status`
4. Reload the page
5. Try to access a locked resource file
6. Should now unlock/download instead of showing "Unlock to view" ✅

---

## Files Included

| File | Purpose | Deploy To |
|------|---------|-----------|
| `storage.rules.FIXED` | New Firebase Storage security rules | Firebase Console |
| `ADMIN_ACCESS_SYNC_FIX.js` | Code to add to js/admin.js | Your codebase |
| `PROFILE_ACCESS_SYNC_FIX.js` | Code to add to js/profile.js | Your codebase |
| `MIGRATION_GUIDE_ACCESS_FIX.md` | Detailed step-by-step instructions | Reference |
| `README_ACCESS_FIX.md` | This file | Reference |

---

## What Changed (Technical)

### Before (Broken)
```
Student tries to read file
  ↓
JavaScript says: ✅ "Access is active" (computeResourceAccessStatus works)
  ↓
Storage rules check: ❌ "No accessUntil field in Firestore"
  ↓
File stays locked (BROKEN STATE)
```

### After (Fixed)
```
Student tries to read file
  ↓
JavaScript says: ✅ "Access is active"
  ↓
Profile page syncs: accessUntil = [calculated date]
  ↓
Storage rules check: ✅ "accessUntil is in future"
  ↓
File unlocks (FIXED)
```

---

## Expected Results

**Before Fix:**
- ❌ See "Resource Access Active" badge
- ❌ See countdown (11 days remaining)
- ❌ Click resource → "Unlock to view" (doesn't work)

**After Fix:**
- ✅ See "Resource Access Active" badge
- ✅ See countdown (11 days remaining)
- ✅ Click resource → File downloads/displays ✅

---

## Rollback Plan

If something goes wrong, you can roll back in 2 minutes:

1. Firebase Console → Firestore → Rules
2. Paste your **original storage.rules** content
3. Publish
4. Revert the code changes to admin.js and profile.js

---

## Support Notes

### If files still don't unlock after deployment:

1. **Check storage rules deployed:**
   - Firebase Console → Firestore → Rules
   - Confirm it mentions `hasActiveResourceAccess()` function

2. **Check sync happened:**
   - Open Firestore Console
   - Find your registration doc
   - Look for `accessUntil`, `restricted`, `lastAccessSyncAt` fields
   - If missing, profile sync didn't run yet

3. **Trigger manual sync:**
   - Student visits profile page (wait 2 sec for sync)
   - Or manually update registration doc with:
     ```
     accessUntil: (any future date)
     restricted: false
     ```

4. **Check browser console:**
   - Open DevTools (F12)
   - Look for messages starting with `[Profile]` or `[Admin]`
   - Any errors will show there

---

## Questions?

Refer to the full `MIGRATION_GUIDE_ACCESS_FIX.md` for:
- Detailed deployment steps with screenshots
- Automated migration script
- Troubleshooting each error
- Performance testing
- Team training notes

Good luck! 🚀
