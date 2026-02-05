// Firebase Configuration
// =====================
// INSTRUCTIONS: Replace the placeholder values below with your Firebase project credentials.
// 
// To get these values:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (or select existing)
// 3. Click the gear icon > Project settings
// 4. Scroll down to "Your apps" and click the web icon (</>)
// 5. Register your app and copy the config values below

const firebaseConfig = {
  apiKey: "AIzaSyCdZr2EYFmUrhUAboxDWI05TGIYnr8eEas",
  authDomain: "idg-management.firebaseapp.com",
  projectId: "idg-management",
  storageBucket: "idg-management.firebasestorage.app",
  messagingSenderId: "728812948064",
  appId: "1:728812948064:web:9603b994a74bf87d9a1105"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Storage is optional (not all pages need it)
let storage = null;
try {
  if (firebase.storage) {
    storage = firebase.storage();
  }
} catch (e) {
  console.log('Storage not available on this page');
}

// Auth state persistence
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// Export for use in other modules
window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseStorage = storage;

console.log('Firebase initialized');
