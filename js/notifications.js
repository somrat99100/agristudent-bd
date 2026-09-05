// ============================================
// STUDENT NOTIFICATIONS / INBOX
// ============================================
// Lets the admin send a free-text message to one student, which then
// shows up in that student's Profile page inbox (js/profile.js).
//
// Trust model: same as the rest of this project (see the note at the
// top of js/session.js) — students never sign in with Firebase Auth,
// so "read" and "mark as read" stay open the same way registrations /
// blogPosts / messages already are in firestore.rules. Only *creating*
// a notification requires the admin's Firebase Auth session.
//
// One doc per message, collection "notifications":
//   { targetRegId, targetName, targetStudentIdNumber, message,
//     sentAt, read, readAt }
// ============================================
import { db } from "./firebase-config.js";
import {
  collection, addDoc, query, where, orderBy, getDocs, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Admin: send a custom message to one student.
 * @returns {Promise<string>} the new notification's doc id
 */
export async function sendNotificationToStudent({ targetRegId, targetName, targetStudentIdNumber, message }) {
  const trimmed = (message || "").trim();
  if (!targetRegId) throw new Error("No student selected.");
  if (!trimmed) throw new Error("Message can't be empty.");

  const docRef = await addDoc(collection(db, "notifications"), {
    targetRegId,
    targetName: targetName || "",
    targetStudentIdNumber: targetStudentIdNumber || "",
    message: trimmed,
    sentAt: serverTimestamp(),
    read: false,
    readAt: null
  });
  return docRef.id;
}

/**
 * Student: fetch every notification ever sent to this registration id,
 * newest first. Called from the Profile page inbox.
 */
export async function fetchStudentNotifications(regId) {
  if (!regId) return [];
  const q = query(
    collection(db, "notifications"),
    where("targetRegId", "==", regId),
    orderBy("sentAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Student: mark one notification as read (only flips read/readAt). */
export async function markNotificationRead(notificationId) {
  if (!notificationId) return;
  await updateDoc(doc(db, "notifications", notificationId), {
    read: true,
    readAt: serverTimestamp()
  });
}

/**
 * Admin: recent history of everything sent, across all students —
 * for the "Notify User" tab's sent-log.
 */
export async function fetchNotificationHistory(max = 100) {
  const q = query(collection(db, "notifications"), orderBy("sentAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.slice(0, max).map(d => ({ id: d.id, ...d.data() }));
}
