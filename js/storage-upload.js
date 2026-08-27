import { storage, auth } from "./firebase-config.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/**
 * Uploads through Firebase Storage. The file path is scoped to the current UID.
 * Returns a tokenized download URL for public-facing assets, and a storage://
 * reference for private student-ID files. No Cloudinary credentials are exposed.
 */
export async function uploadToSecureStorage(file, folder, onProgress) {
  if (!file) throw new Error("No file selected.");
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const allowed = new Set(["resources","blog","terms","avatars","student-ids"]);
  if (!allowed.has(folder)) throw new Error("Invalid upload folder.");

  const safeName = String(file.name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-120) || "file";
  const path = `${folder}/${user.uid}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
  const storageRef = ref(storage, path);

  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: folder === "student-ids" ? "private, no-store" : "public,max-age=31536000,immutable"
  });

  await new Promise((resolve, reject) => {
    task.on("state_changed",
      snap => {
        if (onProgress && snap.totalBytes) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      resolve
    );
  });

  if (folder === "student-ids" || folder === "resources") return `storage://${path}`;
  return await getDownloadURL(storageRef);
}
