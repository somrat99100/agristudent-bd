import { storage } from "./firebase-config.js";
import { ref, getBlob } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const cache = new Map();

export function isStorageRef(value) {
  return typeof value === "string" && value.startsWith("storage://");
}

export async function resolveStorageRef(value) {
  if (!isStorageRef(value)) return value;
  if (cache.has(value)) return cache.get(value);
  const path = value.slice("storage://".length);
  const blob = await getBlob(ref(storage, path));
  const url = URL.createObjectURL(blob);
  cache.set(value, url);
  return url;
}

export async function hydrateStorageImages(root = document) {
  const imgs = [...root.querySelectorAll("img[data-storage-ref]")];
  await Promise.all(imgs.map(async img => {
    try {
      img.src = await resolveStorageRef(img.dataset.storageRef);
      img.removeAttribute("data-storage-ref");
    } catch {
      img.alt = "Unable to load image";
    }
  }));
}
