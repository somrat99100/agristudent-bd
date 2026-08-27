import admin from 'firebase-admin';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file outside the project.');
}
admin.initializeApp();
const rl = readline.createInterface({ input, output });
const email = (await rl.question('Admin email: ')).trim().toLowerCase();
rl.close();
if (!email) throw new Error('Email is required.');
const user = await admin.auth().getUserByEmail(email);
await admin.auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
console.log(`Admin claim set for ${email}. Sign out/in again to refresh the ID token.`);
