import { db } from './firebase-config.js';
import { auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { saveSession } from './session.js';

const form=document.getElementById('register-form'), btn=document.getElementById('submit-btn'), status=document.getElementById('form-status'), wrap=document.getElementById('upload-progress-wrap'), success=document.getElementById('form-success');
function show(t,e=false){wrap.classList.remove('hidden');status.textContent=t;status.style.color=e?'var(--terracotta-500)':'var(--moss-600)';}
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const fullName=document.getElementById('fullName').value.trim(); const email=document.getElementById('email').value.trim().toLowerCase(); const gender=document.querySelector('input[name="gender"]:checked')?.value||''; const studentIdNumber=document.getElementById('studentIdNumber').value.trim().toUpperCase(); const password=document.getElementById('password').value; const confirm=document.getElementById('confirmPassword').value;
 if(fullName.length<2||fullName.length>120){show('Enter a valid full name.',true);return;} if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){show('Enter a valid email address.',true);return;} if(!gender){show('Please select your gender.',true);return;} if(!studentIdNumber){show('Student ID number is required.',true);return;} if(!/^.{10,}$/.test(password)||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)){show('Password must be at least 10 characters and contain letters and numbers.',true);return;} if(password!==confirm){show('Passwords do not match.',true);return;}
 btn.disabled=true; btn.textContent='Creating secure account…'; show('Creating your secure account…');
 try{
  const cred=await createUserWithEmailAndPassword(auth,email,password);
  await sendEmailVerification(cred.user);
  // No student ID photo is uploaded to a public third-party unsigned endpoint.
  // The profile is keyed by the Firebase Auth UID; Firestore rules enforce ownership.
  await setDoc(doc(db,'registrations',cred.user.uid),{uid:cred.user.uid,email:cred.user.email,fullName,gender,studentIdNumber,status:'unverified',avatarUrl:gender==='female'?'assets/avatar-female.svg':'assets/avatar-male.svg',submittedAt:serverTimestamp()});
  saveSession({fullName,studentIdNumber,gender,status:'unverified'});
  success.classList.remove('hidden'); form.classList.add('hidden'); wrap.classList.add('hidden');
  status.textContent='';
  document.getElementById('form-success')?.querySelector('h3')?.insertAdjacentText('afterend',' Check your email to verify your account.');
 }catch(err){console.error('[Registration]',err); let m='Could not create the account.'; if(err.code==='auth/email-already-in-use')m='An account already exists for this email. Please log in.'; if(err.code==='auth/weak-password')m='Please choose a stronger password.'; show(m,true);} finally{btn.disabled=false;btn.textContent='Register';}
});
