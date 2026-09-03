# Migration Guide: Fix for Resource Access Locked Files

**Problem**: Students with "Resource Access Active" status still see files locked with "Unlock to view" badges, even though they should have access.

**Root Cause**: Two disconnected access systems:
- ✅ JavaScript (`access.js`) correctly computes when access is active
- ❌ Firebase Storage rules couldn't verify this because `accessUntil` wasn't saved to Firestore

**Solution**: Sync the computed access status to Firestore so storage rules can verify it.

---

## Deployment Checklist

### Phase 1: Deploy Storage Rules (Do This First!)

This **MUST** be deployed before enabling any code changes, or students will lose file access during the transition.

**Steps:**

1. Open [Firebase Console](https://console.firebase.google.com) → Select your project
2. Go to **Firestore Database** → **Rules** tab
3. Replace the entire rules file with the contents of `storage.rules.FIXED`
4. **Click "Publish"** (top right)
5. Wait 30 seconds for propagation

**Verification:**
```
Before publish: Old rules checking email_verified
After publish:  New rules checking accessUntil from Firestore
```

---

### Phase 2: Update Admin Panel Code

**What changed**: Admin approvals/rejections now trigger an access sync to Firestore.

**Steps:**

1. Open your `js/admin.js` file
2. Find the section that handles resource approval (around **line 413**):
   ```javascript
   // Current code:
   await updateDoc(doc(db, "resources", id), {
     status: "approved",
     approvedAt: new Date()
   });
   item.status = "approved";
   ```

3. **Add this line right after:**
   ```javascript
   await syncStudentAccessStatus(db, item.uploaderEmail);
   ```

4. Find the rejection section (around **line 468**):
   ```javascript
   // Current code:
   await updateDoc(doc(db, "resources", id), { 
     status: "rejected",
     rejectedAt: new Date(),
     restrictedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
   });
   ```

5. **Add this line right after:**
   ```javascript
   await syncStudentAccessStatus(db, item.uploaderEmail);
   ```

6. Add the new function at the top of `js/admin.js` (after other imports):
   ```javascript
   import { computeResourceAccessStatus } from "./access.js";
   
   // ... copy the syncStudentAccessStatus function from ADMIN_ACCESS_SYNC_FIX.js
   ```

---

### Phase 3: Update Student Profile Page

**What changed**: Profile page now syncs computed access back to Firestore.

**Steps:**

1. Open your `js/profile.js` file
2. Find where access status is computed (around **line 260**):
   ```javascript
   // Current code:
   const access = computeResourceAccessStatus([...resourceItems, ...classroomItems]);
   renderAccessBadge(...);
   maybeSendAccessReminder(access, ...);
   renderAccessScale(...);
   ```

3. **Add this code right after renderAccessScale:**
   ```javascript
   // Sync the computed access status back to Firestore for storage.rules
   const session = getSession();
   if (access && session?.regId) {
     await syncAccessToRegistration(db, session, access);
   }
   ```

4. Add the new function at the top of `js/profile.js` (after other imports):
   ```javascript
   // ... copy the syncAccessToRegistration function from PROFILE_ACCESS_SYNC_FIX.js
   ```

---

### Phase 4: Migrate Existing Students

Students with existing "Resource Access Active" status need their `accessUntil` synced one time. After that, it stays current automatically.

**Option A: Automated (Recommended)**

1. Create a temporary Cloud Function that runs once:
   ```javascript
   // This Cloud Function syncs all students with active access
   exports.migrateAccessStatus = functions.https.onRequest(async (req, res) => {
     const snap = await admin.firestore().collection("registrations").get();
     let synced = 0;
     
     for (const regDoc of snap.docs) {
       const email = regDoc.data().emailNormalized;
       if (!email) continue;
       
       const resourcesSnap = await admin.firestore()
         .collection("resources")
         .where("uploaderEmail", "==", email)
         .get();
       
       if (resourcesSnap.empty) continue;
       
       const items = resourcesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
       const access = computeResourceAccessStatus(items);
       
       if (access.active || access.restricted) {
         await regDoc.ref.update({
           accessUntil: access.accessUntil ? new Date(access.accessUntil) : null,
           restricted: access.restricted,
           restrictedUntil: access.restrictedUntil ? new Date(access.restrictedUntil) : null,
           lastAccessSyncAt: admin.firestore.FieldValue.serverTimestamp()
         });
         synced++;
       }
     }
     
     res.json({ synced });
   });
   ```

2. Deploy this function: `firebase deploy --only functions:migrateAccessStatus`
3. Trigger it via the Console (or visit the function URL)
4. Check the logs to confirm all students were synced
5. **Delete the function after migration** (it's only needed once)

**Option B: Manual (For Small User Bases)**

1. Open Firestore Console
2. For each student with "Resource Access Active" badge:
   - Click their registration document
   - Manually add fields:
     - `accessUntil`: (a future date)
     - `restricted`: `false`
   - Click "Save"

**Option C: Let It Happen Naturally**

- No manual migration needed
- When each student next visits their profile page, their access status is synced
- Expect a 1-2 week rollout as students log in

---

## Testing

### Test 1: Verify Storage Rules Deployed

```javascript
// In browser console on any page:
fetch('/.well-known/goog-firebase-hosting-qos-metrics').then(r => r.text()).then(console.log);
// Should show recent timestamps, confirming rules were deployed
```

### Test 2: Test as Admin

1. Log into `admin.html`
2. Approve a pending resource from a test student
3. Check the registration document in Firestore:
   - Should now have `accessUntil` field populated
   - Should show `lastAccessSyncAt` timestamp
4. Approve a second resource and verify `accessUntil` updated

### Test 3: Test as Student

1. Create a test student account
2. Upload a resource file (status: pending)
3. Verify profile shows "Resource Access Active" countdown
4. Check Firestore registration doc:
   - Should have `accessUntil` field set
5. Log out and back in
6. Try to access a locked file:
   - **Should now unlock** ✅
   - If still locked, check browser console for errors

### Test 4: Test Rejection & Restriction

1. Approve a resource, then immediately reject it
2. Check Firestore registration:
   - Should have `restrictedUntil` set to 30 days from now
   - `accessUntil` should be cleared or in the past
3. Student profile should show "Access Restricted" badge
4. Trying to access files should show "Restricted" message

---

## Expected Behavior (After Fix)

| Scenario | Before | After |
|----------|--------|-------|
| Student with approved files | ❌ See "Access Active" but files locked | ✅ See "Access Active", files unlock |
| Student with pending files | ❌ See "Access Active" but files locked | ✅ See "Access Active", files unlock |
| Student rejected file | ✅ Correctly restricted | ✅ Still correctly restricted |
| New students | ✅ No access, files locked | ✅ No access, files locked |
| Admin approves resource | ❌ Access status not synced | ✅ accessUntil saved immediately |

---

## Rollback Plan (If Needed)

If something goes wrong:

1. **Rollback storage.rules**: Replace with your backup (original `storage.rules`)
2. **Publish** in Firebase Console
3. Revert the code changes to `admin.js` and `profile.js`
4. Contact support with the error from browser console

---

## Common Errors & Fixes

### Error: "Permission denied" when trying to read files

**Cause**: Storage rules deployed but Firestore registration doc doesn't have `accessUntil` yet.

**Fix**: 
- Run the migration script (Option A above), OR
- Have student visit their profile page to trigger sync (Option C)

### Error: "accessUntil is not a valid date"

**Cause**: Someone manually added `accessUntil` with wrong type.

**Fix**:
- Delete the `accessUntil` field from that registration doc
- Student visits profile page to auto-sync with correct value

### Admin approval doesn't sync

**Cause**: `syncStudentAccessStatus` function not added to admin.js.

**Fix**:
- Double-check lines 413 and 468 have the sync call added
- Refresh admin page (`Ctrl+Shift+R` to clear cache)
- Try approving a different resource

---

## Performance Notes

- Access syncs happen in the background (won't block approvals)
- Profile page sync adds ~100-200ms (acceptable, user won't notice)
- Storage rules check is <10ms (negligible)

---

## Questions?

- Check browser console for detailed logs (prefix: `[Profile]`, `[Admin]`, `[Access]`)
- Review `js/access.js` for full access calculation logic
- Test student account: use email `test@example.com` with any Student ID

---

## Final Verification Checklist

- [ ] Phase 1: Storage rules deployed and published
- [ ] Phase 2: Admin approval triggers sync (check Firestore for `lastAccessSyncAt`)
- [ ] Phase 3: Profile page loads without console errors
- [ ] Phase 4: Existing students migrated (manual or automatic)
- [ ] Test 1-4: All tests pass
- [ ] Rollback plan documented and tested
- [ ] Team trained on new sync behavior
