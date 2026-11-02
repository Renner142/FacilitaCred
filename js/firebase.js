// Único lugar que conhece o Firebase. Para trocar de versão do SDK, mude só a variável V.
import { firebaseConfig } from '../firebase-config.js';

const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

const { initializeApp } = await import(`${BASE}/firebase-app.js`);
const A = await import(`${BASE}/firebase-auth.js`);
const F = await import(`${BASE}/firebase-firestore.js`);

export const configurado = !String(firebaseConfig.apiKey).startsWith('COLE');
const app = initializeApp(firebaseConfig);
export const auth = A.getAuth(app);
export const db = F.getFirestore(app);
// Segundo app só para criar usuários sem derrubar o login do administrador
export const auth2 = A.getAuth(initializeApp(firebaseConfig, 'secundario'));

export const {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword
} = A;
export const {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, writeBatch, runTransaction, serverTimestamp
} = F;
