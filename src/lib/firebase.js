import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// 【修正重點】：Vite 編譯器要求環境變數必須「靜態且完整」地宣告 (import.meta.env.VITE_XXX)。
// 不能使用函式或動態字串，否則在 Vercel 正式機打包時會全部變成 undefined 導致畫面崩潰！
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// 使用 try-catch 進行最安全的初始化，確保無論如何都不會因為重複初始化而引發白畫面
let app;
try {
  // 嘗試獲取已存在的 App (解決 HMR 或元件重複 import 的問題)
  app = getApp();
} catch (e) {
  // 如果還沒初始化過，則進行初始化
  app = initializeApp(firebaseConfig);
}

export const auth = getAuth(app);
export const db = getFirestore(app);
