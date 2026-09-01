/**
 * One-time privacy migration. It PRESERVES old values in admin-only collections
 * before removing PII from student-readable content documents.
 *
 * Run from a trusted machine:
 *   npm install firebase-admin
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node scripts/migrate-privacy.mjs
 *
 * Optional Cloudinary student-ID migration:
 *   set CLOUDINARY_API_KEY=...
 *   set CLOUDINARY_API_SECRET=...
 *   set CLOUDINARY_CLOUD_NAME=db6r0up6r
 *
 * The script is idempotent: it skips documents already migrated.
 */
import admin from "firebase-admin";
import crypto from "node:crypto";

admin.initializeApp({ storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "agristudent-bd.firebasestorage.app" });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "db6r0up6r";

const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");

async function migrateCollection(name, privateCollection, fields, transform = {}) {
  const snap = await db.collection(name).get();
  let changed = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const privateData = {};
    let hasPrivate = false;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        privateData[field] = data[field];
        hasPrivate = true;
      }
    }
    const updates = {};
    if (hasPrivate) {
      const identityEmail = privateData.uploaderEmail || privateData.authorEmail;
      if (identityEmail && (name === "resources" || name === "terms" || name === "blogPosts" || name === "blogComments")) {
        const regs = await db.collection("registrations").where("email","==",String(identityEmail).trim().toLowerCase()).limit(1).get();
        const reg = regs.docs[0];
        const ownerField = name === "resources" || name === "terms" ? "uploaderRegId" : "authorRegId";
        if (reg && !data[ownerField]) updates[ownerField] = reg.id;
      }
      await db.collection(privateCollection).doc(d.id).set({
        sourceCollection: name,
        sourceId: d.id,
        ...privateData,
        migratedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      for (const field of fields) updates[field] = admin.firestore.FieldValue.delete();
    }
    if (Object.prototype.hasOwnProperty.call(transform, "public")) {
      updates.public = transform.public(data);
    } else if (["resources","terms","blogPosts"].includes(name) && !Object.prototype.hasOwnProperty.call(data,"public")) {
      updates.public = data.status === "approved";
    }
    updates.privacyVersion = 2;
    if (Object.keys(updates).length) {
      await d.ref.update(updates);
      changed++;
    }
  }
  console.log(`${name}: migrated ${changed} document(s).`);
}

async function migrateLikes() {
  const snap = await db.collection("blogLikes").get();
  let changed = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.uid) continue;
    if (!data.email) continue;
    const email = String(data.email).trim().toLowerCase();
    const regs = await db.collection("registrations").where("email","==",email).limit(1).get();
    const reg = regs.docs[0];
    await db.collection("privateBlogLikeMeta").doc(d.id).set({
      sourceId: d.id, email, migratedAt: admin.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
    if (reg?.data()?.authUid) {
      await d.ref.update({ uid: reg.data().authUid, email: admin.firestore.FieldValue.delete() });
      changed++;
    }
  }
  console.log(`blogLikes: linked ${changed} existing like(s) to Firebase Auth UIDs.`);
}

async function deleteCloudinaryAsset(url, cloud, key, secret) {
  try {
    const marker = "/upload/";
    const idx = url.indexOf(marker);
    if (idx < 0) return false;
    let publicId = url.slice(idx + marker.length).split("?")[0];
    publicId = publicId.replace(/^v\d+\//, "");
    publicId = publicId.replace(/\\.[a-z0-9]{2,5}$/i, "");
    const timestamp = Math.floor(Date.now()/1000);
    const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${secret}`).digest("hex");
    const body = new URLSearchParams({public_id:publicId,timestamp:String(timestamp),api_key:key,signature});
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    if (!response.ok) return false;
    const result = await response.json();
    return result.result === "ok" || result.result === "not found";
  } catch { return false; }
}


async function migrateResourceFiles() {
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.log("Cloudinary credentials not supplied; existing resource URLs are left untouched.");
    return;
  }
  const snap = await db.collection("resources").get();
  let moved = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const regId = data.uploaderRegId || `legacy_${d.id}`;
    const regs = await db.collection("registrations").doc(regId).get();
    const uid = regs.exists() && regs.data().authUid ? regs.data().authUid : `legacy_${regId}`;
    const files = Array.isArray(data.fileUrls) ? data.fileUrls : [];
    const next = [];
    let changed = false;
    for (const item of files) {
      const originalUrl = typeof item === "string" ? item : item?.url;
      if (!originalUrl || !String(originalUrl).startsWith("https://res.cloudinary.com/")) {
        next.push(item);
        continue;
      }
      const response = await fetch(originalUrl);
      if (!response.ok) { next.push(item); continue; }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const name = (typeof item === "object" && item?.name) ? item.name : "file";
      const safeName = String(name).replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-120) || "file";
      const path = `resources/${uid}/legacy_${Date.now()}_${sha256(originalUrl).slice(0,16)}_${safeName}`;
      await bucket.file(path).save(buffer,{metadata:{contentType,cacheControl:"private,no-store"}});
      next.push(typeof item === "string" ? {name:safeName,url:`storage://${path}`} : {...item,url:`storage://${path}`});
      await deleteCloudinaryAsset(originalUrl, cloud, key, secret);
      changed = true; moved++;
    }
    if (changed) {
      await db.collection("privateResourceMeta").doc(d.id).set({legacyFileUrls: files, migratedAt: admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      await d.ref.update({fileUrls:next});
    }
  }
  console.log(`resources: moved ${moved} Cloudinary file(s) to Firebase Storage.`);
}

async function migrateLegacyStudentIdFiles() {
  const key = CLOUDINARY_API_KEY;
  const secret = CLOUDINARY_API_SECRET;
  const cloud = CLOUDINARY_CLOUD_NAME;
  if (!key || !secret) {
    console.log("Cloudinary credentials not supplied; legacy student-ID URLs are kept private in Firestore but old Cloudinary assets are not copied/deleted.");
    return;
  }
  const snap = await db.collection("registrations").get();
  let moved = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (!data.studentIdUrl || data.studentIdStoragePath) continue;
    const url = String(data.studentIdUrl);
    if (!url.startsWith("https://res.cloudinary.com/")) continue;
    const response = await fetch(url);
    if (!response.ok) continue;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    const path = `student-ids/${data.authUid || `legacy_${d.id}`}/${Date.now()}_${sha256(url).slice(0,16)}.jpg`;
    await bucket.file(path).save(buffer, {metadata:{contentType, cacheControl:"private,no-store"}});
    await db.collection("privateStudentIdMeta").doc(d.id).set({
      legacyCloudinaryUrl: url, migratedAt: admin.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
    await d.ref.update({
      studentIdStoragePath: `storage://${path}`,
      studentIdUrl: admin.firestore.FieldValue.delete()
    });
    const deleted = await deleteCloudinaryAsset(url, cloud, key, secret);
    if (!deleted) console.warn(`Could not delete old Cloudinary asset for registration ${d.id}; keep the old URL private until it is manually removed.`);
    moved++;
  }
  console.log(`registrations: moved ${moved} legacy student-ID file(s) to private Firebase Storage.`);
}

await migrateCollection("resources","privateResourceMeta",["uploaderEmail","uploaderStudentId"]);
await migrateCollection("terms","privateTermMeta",["uploaderEmail"]);
await migrateCollection("blogPosts","privateBlogMeta",["authorEmail","authorStudentId"]);
await migrateCollection("blogComments","privateCommentMeta",["authorEmail","authorStudentId"]);
await migrateLikes();
await migrateResourceFiles();
await migrateLegacyStudentIdFiles();
console.log("Privacy migration complete. Review the counts above before production deployment.");
