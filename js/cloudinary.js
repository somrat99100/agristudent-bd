// Compatibility wrapper: new uploads use Firebase Storage.
// Existing Cloudinary URLs remain untouched so no existing data is lost.
import { uploadToSecureStorage } from "./storage-upload.js";

export async function uploadSignedToCloudinary(file, folder, onProgress) {
  return uploadToSecureStorage(file, folder, onProgress);
}
