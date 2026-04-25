import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// 安全讀取環境變數的函式，防止在預覽環境中因為找不到變數而崩潰
const getEnv = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env[key];
    }
  } catch (e) {
    return undefined;
  }
  return undefined;
};

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY') || "MOCK_API_KEY",
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN') || "mock-app.firebaseapp.com",
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID') || "mock-project",
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET') || "mock-project.appspot.com",
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID') || "123456789",
  appId: getEnv('VITE_FIREBASE_APP_ID') || "1:123456789:web:mockid"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
