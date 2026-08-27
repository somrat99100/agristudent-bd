// Secure student session facade. Firebase Auth is the security boundary;
// localStorage/sessionStorage are never treated as authentication.
import { auth } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const SESSION_KEY = 'agri_session_v2';
let cachedUser = null;

onAuthStateChanged(auth, user => { cachedUser = user || null; });

export function getAuthUser() { return cachedUser || auth.currentUser || null; }
export function getSession() {
  const user = getAuthUser();
  if (!user) return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || parsed.uid !== user.uid) return null;
    return { ...parsed, uid: user.uid, email: user.email || parsed.email || '', emailVerified: !!user.emailVerified };
  } catch { localStorage.removeItem(SESSION_KEY); return null; }
}

export function saveSession(data) {
  const user = getAuthUser();
  if (!user) throw new Error('Authentication required.');
  const session = {
    uid: user.uid,
    regId: user.uid,
    fullName: data.fullName || '',
    email: user.email || data.email || '',
    gender: data.gender || '',
    avatarUrl: data.avatarUrl || (data.gender === 'female' ? 'assets/avatar-female.svg' : 'assets/avatar-male.svg'),
    status: data.status || 'verified'
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  try { sessionStorage.removeItem('agri_student_id'); sessionStorage.removeItem('agri_handnotes_user_email'); localStorage.removeItem('agri_handnotes_user_email'); } catch {}
  try { await signOut(auth); } catch {}
}

function renderAuthSlot() {
  const slot = document.getElementById('navbar-auth-slot');
  if (!slot) return;
  const session = getSession();
  if (!session) { slot.textContent = ''; slot.innerHTML = '<a href="login.html" class="navbar-auth-login">Login</a>'; return; }
  const name = (session.fullName || session.email).split(' ')[0];
  slot.textContent = '';
  const link = document.createElement('a'); link.href = 'profile.html'; link.className = 'navbar-auth-profile'; link.title = session.fullName || session.email;
  const img = document.createElement('img'); img.src = session.avatarUrl || 'assets/avatar-male.svg'; img.alt = ''; img.className = 'navbar-auth-avatar';
  const span = document.createElement('span'); span.textContent = name;
  link.append(img, span);
  const btn = document.createElement('button'); btn.type='button'; btn.className='navbar-auth-logout'; btn.textContent='Logout';
  btn.addEventListener('click', clearSession);
  slot.append(link, btn);
}
function whenNavbarReady(fn){ if(window.__navbarLoaded) fn(); else (window.__onNavbarReady=window.__onNavbarReady||[]).push(fn); }
whenNavbarReady(renderAuthSlot);
onAuthStateChanged(auth, renderAuthSlot);
