import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ★ plus-ver05 専用プロジェクト（現行 plus-manager-58162 とは完全分離）
const firebaseConfig = {
  apiKey: "AIzaSyCITPuzAPRji4OMLVruCY_T8M11frcnPcI",
  authDomain: "plus-ver05.firebaseapp.com",
  projectId: "plus-ver05",
  storageBucket: "plus-ver05.firebasestorage.app",
  messagingSenderId: "1048776424311",
  appId: "1:1048776424311:web:f69f88acf90573aa3e3f72"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
