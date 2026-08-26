# Blog feature — what was added

## New files
- `js/blog.js` — all blog logic: composer, feed, like, comment, share, views.
- `css/blog.css` — Facebook-timeline-style visual design.

## Changed files
- `blog.html` — replaced the "under construction" placeholder with the
  live composer + timeline feed.
- `firestore.rules` — added `blogPosts`, `blogComments`, `blogLikes`
  collections (same public-write-with-validation trust model as
  `resources`/`terms`, since students never hold a Firebase Auth session).
- `admin.html` — new "Blog" sidebar tab + moderation panel, plus three
  new Danger Zone wipe buttons (Blog Posts / Comments / Likes).
- `js/admin.js` — `loadBlogPosts()` moderation logic (approve / reject /
  delete, with an email notification to the author on status change,
  reusing the same `sendReviewEmail` used for resources).

## How it behaves
1. Any **logged-in** student (has a `registrations` record — verified
   or not) can open the composer from the timeline and write a post:
   a title, a formatted body (bold/italic/underline/bullets) and any
   number of inline images uploaded to Cloudinary.
2. The post appears in the **public timeline immediately**, watermarked
   **"🕓 Not verified"** in the corner — visible to everyone, logged in
   or not.
3. In `admin.html → Blog`, the admin reviews it and sets it to:
   - **Approved** → the corner badge flips to **"✅ Approved"**.
   - **Rejected** → the post disappears from the public timeline (still
     visible/manageable in the admin panel) — the author gets an email.
4. Anyone can browse and view post/like counts; **logged-in** students
   can **Like** (❤️ toggle), **Comment**, and **Share** (native share
   sheet or copy-link, which deep-links back via `blog.html?post=ID`).
   Each post's view count increments once per browser the first time
   its card actually scrolls into view.
5. The rich-text body is sanitized on the client (an allowlist of safe
   tags; images restricted to `res.cloudinary.com` URLs only) before
   it's ever written to Firestore, and Firestore rules independently
   cap title/body length and required fields on every write.
