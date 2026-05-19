import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBal3hf84oasSsVBn2-87PUxdtPJ0K8ePQ",
  authDomain: "dcl-tournament-2b298.firebaseapp.com",
  databaseURL: "https://dcl-tournament-2b298-default-rtdb.firebaseio.com",
  projectId: "dcl-tournament-2b298",
  storageBucket: "dcl-tournament-2b298.firebasestorage.app",
  messagingSenderId: "584447283372",
  appId: "1:584447283372:web:a0a6f5e9c23ae669f08f09"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
