# Blog Update — Inline Images (drag & resize) + optional images

This adds a second way to place images in a post, on top of the Facebook-style
gallery grid from the last update. Nothing about the gallery grid changed —
this is additive.

## What's new

**Two image buttons in the composer:**
- 📄 **Inline** — drops the image directly into the text at your cursor, like
  a photo placed on a page. Click it to select, then:
  - Drag the image itself to move it to a different spot in the text.
  - Drag the small green handle in the bottom-right corner to resize it.
  - Use the mini toolbar above it to choose how text sits around it:
    🔤 in the flow of text, ⬅️ float left (text wraps on the right),
    ➡️ float right (text wraps on the left), ⏺️ centered on its own line.
  - Hit the ✕ to remove it.
- 🖼️ **Gallery** — unchanged: adds photos to the grid that appears below the
  post (Facebook-style layout from the previous update).

You can use either button, both in the same post, or neither — **a post with
no images at all works exactly as before**; only a title plus some text (or
at least one image, of either kind) is required.

## Under the hood

- Inline images upload to Cloudinary the moment you pick them (same as
  gallery images), so the composer always shows the real image, not a
  placeholder.
- The rich-text sanitizer (`js/blog.js`) now allows `<img>` tags, but **only**
  when the `src` is a `res.cloudinary.com` URL — any other source is dropped.
  It also only keeps the specific wrapper classes/width style used for inline
  images and strips out the composer's edit-only controls (resize handle,
  delete button, alignment toolbar) before saving, so what's stored is clean,
  static HTML.
- Submitting is blocked with a short message if an inline image is still
  mid-upload, so you can't post with a broken image.
- Max images per post (10) and max size per image (8MB) are enforced across
  gallery + inline images combined.

## Files touched
- `blog.html` — composer toolbar/hint text, two file inputs.
- `css/blog.css` — `.inline-image` styling (align/resize/toolbar/spinner),
  float clearing so wrapped text doesn't overflow the post card.
- `js/blog.js` — insertion, drag-to-reposition, resize, alignment, upload,
  and the updated sanitizer.

No Firestore rules or schema changes are needed — inline images live inside
the existing `content` field (rich text), gallery images stay in the existing
`imageUrls` array.
