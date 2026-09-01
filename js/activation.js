import { auth, functions, db } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { saveSession } from "./session.js";

const requestOtp = httpsCallable(functions, "requestAccountActivationOtp");
const verifyOtp = httpsCallable(functions, "verifyAccountActivationOtp");
const form = document.getElementById("activation-form");
const sendBtn = document.getElementById("activation-send");
const verifyBtn = document.getElementById("activation-verify");
const panel = document.getElementById("activation-otp-panel");
const status = document.getElementById("activation-status");
let state = null;

const msg = (text, error=false) => { status.textContent=text; status.style.color=error?"var(--terracotta-500)":"var(--moss-600)"; };

form.addEventListener("submit", async e => {
  e.preventDefault();
  const email=document.getElementById("activation-email").value.trim().toLowerCase();
  const studentIdNumber=document.getElementById("activation-student-id").value.trim();
  const password=document.getElementById("activation-password").value;
  const confirm=document.getElementById("activation-password-confirm").value;
  if(password.length<8 || password.length>128) return msg("Password must be 8-128 characters.",true);
  if(password!==confirm) return msg("Passwords do not match.",true);
  sendBtn.disabled=true; msg("Sending verification code…");
  try {
    const {data}=await requestOtp({email,studentIdNumber});
    state={email,password,challengeId:data.challengeId||null};
    if(data.challengeId){ panel.classList.remove("hidden"); msg("If the details match an existing account, a code has been sent."); }
    else msg("If the details match an existing account, a verification code has been sent.");
  } catch(err){ msg("Unable to start activation. Please try again later.",true); }
  finally{sendBtn.disabled=false;}
});

verifyBtn.addEventListener("click", async ()=>{
  if(!state?.challengeId) return;
  const code=document.getElementById("activation-code").value.trim();
  if(!/^\d{6}$/.test(code)) return msg("Enter the 6-digit code.",true);
  verifyBtn.disabled=true; msg("Activating account…");
  try {
    const {data}=await verifyOtp({challengeId:state.challengeId,code,password:state.password});
    await signInWithCustomToken(data.customToken);
    const snap=await getDoc(doc(db,"registrations",data.regId));
    const reg=snap.exists()?snap.data():{};
    saveSession({regId:data.regId,fullName:reg.fullName,gender:reg.gender,avatarUrl:reg.avatarUrl,status:reg.status||"verified"});
    window.location.href="profile.html";
  } catch(err) { msg("Verification failed. The code may be invalid or expired.",true); }
  finally{verifyBtn.disabled=false;}
});
