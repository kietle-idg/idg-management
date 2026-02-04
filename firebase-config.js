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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Auth state persistence
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// Export for use in other modules
window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseStorage = storage;

console.log('Firebase initialized');
