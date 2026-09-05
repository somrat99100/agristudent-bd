# Facebook-Style Reactions + View Count Fix

## Overview
This update fixes TWO critical issues:

### Issue 1: Reaction Count Limited to 2 Users ❌ → Multi-Reaction Support ✅
**Problem:** The old system used a binary like/unlike model that only allowed ONE reaction per user per post. When multiple users tried to react, the counter would stall or fall.

**Solution:** Implement Facebook-style reactions (like, love, haha, wow, sad, angry) where:
- Each user can only have ONE active reaction per post
- Users can change their reaction type anytime
- Counter tracks each reaction type separately
- Total reaction count displays prominently

### Issue 2: View Count Only Counts Once Per 24H ❌ → Every View Counts ✅
**Problem:** The old system used localStorage with a 24-hour cache. Same post viewed in different tabs/windows/sessions only counted once per day.

**Solution:** Use sessionStorage-based tracking where:
- EVERY new browser tab/window session counts as a new view
- Views only require 5 seconds of on-screen time (same as before)
- Viewers don't need to be logged in
- Sessions automatically track per-browser-instance

---

## Files Modified

### 1. **js/blog.js** → **js/blog-fixed.js** (Replacement)
**Key Changes:**
- Replaced binary like system with multi-reaction system
- 6 reaction types with emojis: 👍 (like), ❤️ (love), 😂 (haha), 😮 (wow), 😢 (sad), 😠 (angry)
- Changed data model from `blogLikes` collection to `blogReactions` collection
- Added `reactionType` field to track which emoji user selected
- View tracking now uses `sessionStorage` instead of `localStorage`
- View counter increments on EVERY session (not cached for 24h)
- Reaction menu displays on hover/click with smooth animations
- Users can click any emoji to change their reaction instantly

### 2. **css/blog-reactions.css** (NEW FILE)
**Contains:**
- Facebook-style reaction menu popup
- Smooth animations and hover effects
- Mobile-responsive layout
- Color theming for active reactions
- Reaction button styling

### 3. **firestore.rules** (Updated)
**Changes:**
- Added new `blogReactions` collection with rules
- Allows incrementing individual reaction counters: `likeCount`, `loveCount`, `hahaCount`, `wowCount`, `sadCount`, `angryCount`
- Maintains backward compatibility with old `blogLikes` collection
- Validates that each user can only have one reaction per post

---

## Implementation Steps

### Step 1: Backup Current Files
```bash
cp js/blog.js js/blog.js.backup
cp firestore.rules firestore.rules.backup
```

### Step 2: Replace blog.js
```bash
# Delete old file
rm js/blog.js

# Rename the fixed version
mv js/blog-fixed.js js/blog.js
```

### Step 3: Add Reaction CSS
In your `blog.html` (or main HTML file), add this link in the `<head>`:
```html
<link rel="stylesheet" href="css/blog-reactions.css">
```

If you already have a `<link>` to `css/blog.css`, add the reactions CSS right after it:
```html
<link rel="stylesheet" href="css/blog.css">
<link rel="stylesheet" href="css/blog-reactions.css">
```

### Step 4: Update Firestore Rules
1. Go to **Firebase Console** → **Firestore Database** → **Rules**
2. Replace the entire rules content with the updated `firestore.rules`
3. Click **Publish**
4. Wait for confirmation (usually takes 30 seconds - 1 minute)

### Step 5: Test the Changes

#### Test Reactions:
1. Open the blog page in your browser
2. Click the reaction button (should show "🤍 React")
3. Click any emoji in the reaction menu that appears
4. The button should update to show your selected emoji
5. Switch to a different reaction - the counter should update instantly
6. Open blog page in an INCOGNITO window
7. React with a different emotion - both reactions should show
8. Refresh the page - your reaction should persist

#### Test View Counting:
1. Open blog.html in a fresh browser tab
2. Scroll to a blog post and keep it visible for 5+ seconds
3. Check the view count - it should increase by 1
4. Open blog.html in ANOTHER tab (same browser)
5. Scroll to the SAME post for 5+ seconds
6. Check the view count - it should increase by 1 AGAIN
7. Refresh the first tab (5+ seconds)
8. View count should increase AGAIN (because it's a new session)

---

## Database Schema Changes

### Old: blogLikes Collection
```javascript
// Doc ID: {postId}_{email}
{
  postId: "abc123",
  email: "student@example.com",
  createdAt: timestamp
}
// blogPosts had: likesCount
```

### New: blogReactions Collection
```javascript
// Doc ID: {postId}_{email}
{
  postId: "abc123",
  email: "student@example.com",
  reactionType: "love",  // NEW: can be like/love/haha/wow/sad/angry
  createdAt: timestamp
}
// blogPosts now has: likeCount, loveCount, hahaCount, wowCount, sadCount, angryCount
```

### Migration Note
The old `blogPosts` document may still have `likesCount` field. You can:
1. **Option A:** Leave it (backwards compatible, won't hurt)
2. **Option B:** Update old posts via Firebase Console or a migration script

To migrate old data, create a script using the Firebase Admin SDK:
```javascript
const admin = require('firebase-admin');
const db = admin.firestore();

async function migrateOldLikes() {
  const posts = await db.collection('blogPosts').get();
  
  for (const post of posts.docs) {
    const oldLikes = post.data().likesCount || 0;
    if (oldLikes > 0) {
      await post.ref.update({
        likesCount: undefined, // Remove old field
        likeCount: oldLikes,   // Add new field
        loveCount: 0,
        hahaCount: 0,
        wowCount: 0,
        sadCount: 0,
        angryCount: 0
      });
    }
  }
  
  console.log('Migration complete!');
}

migrateOldLikes().catch(console.error);
```

---

## UI Changes

### Reaction Button Before → After
```
BEFORE: ❤️ Like  (only one option, binary on/off)
AFTER:  🤍 React (click to reveal menu)
        ↓
        [👍] [❤️] [😂] [😮] [😢] [😠]  (choose any emoji)
        
        Then shows: ❤️ Love (or whatever you chose)
```

### Stats Display Before → After
```
BEFORE: 👁️ 10 views  ❤️ 2  💬 3 comments  ↗️ 1 share
AFTER:  👁️ 10 views  5   💬 3 comments  ↗️ 1 share
        (5 = total of all reactions: 2 likes + 1 love + 1 haha + 1 wow)
```

---

## Troubleshooting

### Reactions Not Saving
**Symptoms:** Click reaction but it doesn't persist or updates don't show

**Solution:**
1. Check browser console for errors (F12 → Console tab)
2. Verify Firestore Rules are **PUBLISHED** (not just saved)
3. Check that `/blogReactions` collection exists in Firebase
4. Try incognito window to rule out cache issues

**Firestore Rules not published?**
```
Firebase Console → Firestore Database → Rules → Publish
```

### View Count Not Incrementing
**Symptoms:** Scroll to post, wait 5+ seconds, count doesn't change

**Solution:**
1. Check that post is visible (at least 50% on screen)
2. Wait at least 5 continuous seconds before scrolling away
3. Open DevTools → Application tab → Session Storage
4. Look for `agri_blog_session_id` key (should exist)
5. Check console for errors

### Old Likes Not Showing
**Symptoms:** Posts show 0 reactions even though people liked them before

**Solution:**
- Old likes are stored in `blogLikes` collection, new reactions in `blogReactions`
- Use migration script above to copy old data
- Or manually update post documents via Firebase Console

---

## Code Architecture

### Reaction System Flow
```
User clicks reaction button
  ↓
Reaction menu appears (6 emoji buttons)
  ↓
User clicks emoji (e.g., "❤️ Love")
  ↓
Check if user already has a reaction:
  - If YES: Delete old reaction + decrement its counter
  - If NO: Skip delete step
  ↓
Create new reaction in blogReactions collection
  ↓
Increment new reaction counter (e.g., loveCount +1)
  ↓
Update button: "🤍 React" → "❤️ Love"
  ↓
Update total reactions display: "5"
  ↓
Live listener updates all other open instances
```

### View Tracking Flow
```
Post renders on page
  ↓
Check: hasViewedThisSession(postId)?
  - YES: Stop, this session already counted this post
  - NO: Continue
  ↓
Start IntersectionObserver on post
  ↓
Is post ≥50% visible?
  - YES: Start 5-second timer
  - NO: Stop timer (will restart if post comes back into view)
  ↓
5 seconds elapsed without scrolling away?
  - YES: Mark viewed + increment counter
  - NO: Reset timer
  ↓
Next tab/window = new session = can count again
```

---

## Performance Notes

- **Reactions:** Each update is 1 Firestore write (delete old + create new = 2, but atomic)
- **Views:** Only 1 write per session per post (not per scroll)
- **Live Updates:** Uses onSnapshot listeners (real-time updates, scales well)
- **Storage:** sessionStorage used instead of localStorage (clears on tab close)

---

## Browser Compatibility

✅ Chrome/Edge 90+  
✅ Firefox 88+  
✅ Safari 14+  
✅ Mobile browsers (iOS Safari, Chrome Mobile)

Session storage and Intersection Observer supported on all modern browsers.

---

## Rollback Instructions

If something goes wrong:

```bash
# Restore old blog.js
cp js/blog.js.backup js/blog.js

# Restore old Firestore rules
# (Go to Firebase Console → Firestore → Rules, paste old rules, Publish)

# Undo CSS link in HTML if needed
# (Remove or comment out the css/blog-reactions.css link)
```

Then refresh the browser cache (Ctrl+Shift+R / Cmd+Shift+R).

---

## Questions or Issues?

Check:
1. Browser console (F12) for JavaScript errors
2. Firebase Console → Firestore → Indexes (create composite index if prompted)
3. Firestore Rules are PUBLISHED (not just saved)
4. blogReactions collection exists (created automatically on first write)
5. CSS file is linked correctly in HTML

