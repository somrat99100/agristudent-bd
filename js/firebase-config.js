// ============================================
// Firebase setup — shared across all pages
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6Dl94tK5tB8VJq_z-K0_xbt--fkd9UH8",
  authDomain: "agristudent-bd.firebaseapp.com",
  projectId: "agristudent-bd",
  storageBucket: "agristudent-bd.firebasestorage.app",
  messagingSenderId: "946325749814",
  appId: "1:946325749814:web:a56fbbf3765dbfbb419897",
  measurementId: "G-RLN99KFDMB"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

