import { db } from './firebase-config.js';
import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { saveSession } from './session.js';

const form=document.getElementById('login-form'), btn=document.getElementById('login-submit'), status=document.getElementById('login-status');
function msg(t,e=false){status.textContent=t;status.style.color=e?'var(--terracotta-500)':'var(--moss-600)';status.classList.remove('hidden');}
form.addEventListener('submit',async e=>{
 e.preventDefault(); const email=document.getElementById('login-email').value.trim().toLowerCase(); const password=document.getElementById('login-password').value;
 if(!email||!password){msg('Please enter your email and password.',true);return;} btn.disabled=true; btn.textContent='Signing in…';
 try{
  const cred=await signInWithEmailAndPassword(auth,email,password);
  if(!cred.user.emailVerified){ await sendEmailVerification(cred.user).catch(()=>{}); msg('Please verify your email first. A new verification link was sent.',true); return; }
  const snap=await getDoc(doc(db,'registrations',cred.user.uid));
  if(!snap.exists()){msg('Account profile is incomplete. Please contact the site administrator.',true);return;}
  const r=snap.data(); await updateDoc(doc(db,'registrations',cred.user.uid),{status:'verified'}); saveSession({fullName:r.fullName,studentIdNumber:r.studentIdNumber,gender:r.gender,avatarUrl:r.avatarUrl,status:r.status});
  msg('Logged in! Redirecting…'); setTimeout(()=>location.replace('profile.html'),300);
 }catch(err){console.error('[Login]',err); msg('Invalid email or password.',true);} finally{btn.disabled=false;btn.textContent='Log In';}
});
