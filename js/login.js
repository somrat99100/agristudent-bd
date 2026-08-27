import { db, auth } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { getSession, saveSession } from "./session.js";

if (getSession()) window.location.replace("profile.html");
const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");
const statusBox = document.getElementById("login-status");
function showStatus(msg, isError=false){ statusBox.textContent=msg; statusBox.style.color=isError?"var(--terracotta-500)":"var(--moss-600)"; statusBox.classList.remove("hidden"); }

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const email=normalizeEmail(document.getElementById("login-email").value);
  const studentId=normalizeStudentId(document.getElementById("login-studentId").value);
  const password=document.getElementById("login-password").value;
  if(!email||!studentId||!password){ showStatus("Please complete all fields.",true); return; }
  submitBtn.disabled=true; submitBtn.textContent="Signing in…"; showStatus("Signing you in securely…");
  try{
    const credential=await signInWithEmailAndPassword(auth,email,password);
    const uid=credential.user.uid;
    const snap=await getDoc(doc(db,"registrations",uid));
    if(!snap.exists() || snap.data().status!=="verified" || normalizeStudentId(snap.data().studentIdNumber)!==studentId){
      await signOut(auth);
      showStatus("Login details could not be verified. Please check your email, password, and Student ID.",true);
      return;
    }
    const reg=snap.data();
    saveSession({uid,regId:uid,fullName:reg.fullName,email:reg.email,studentIdNumber:reg.studentIdNumber,gender:reg.gender,avatarUrl:reg.avatarUrl,status:reg.status});
    showStatus("✅ Logged in! Redirecting…");
    setTimeout(()=>window.location.href="profile.html",500);
  }catch(err){
    console.error("[Login] failed:",err);
    showStatus("Login failed. Please check your details and try again.",true);
  }finally{ submitBtn.disabled=false; submitBtn.textContent="Log In"; }
});
