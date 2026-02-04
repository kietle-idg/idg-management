# IDG Ventures Fund Management Platform

A modern, minimal VC fund management platform with role-based access control, built with Firebase.

## Features

- **Authentication** - Secure login with Firebase Auth
- **Role-Based Access** - Admin, GP, LP, and Team roles with different permissions
- **Dashboard** - Fund metrics, portfolio overview, upcoming events
- **Portfolio Management** - Track all portfolio companies with filtering and search
- **Document Storage** - Upload and manage fund documents with Firebase Storage
- **Personal View** - Events and tasks for each user
- **Admin Panel** - User management and fund settings
- **Export** - PDF and Excel export for portfolio data

## Getting Started

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create a project" (or "Add project")
3. Name it `idg-ventures` (or any name you prefer)
4. Disable Google Analytics (optional, not needed)
5. Click "Create project"

### Step 2: Enable Authentication

1. In Firebase Console, click "Authentication" in the left sidebar
2. Click "Get started"
3. Click on "Email/Password" under Sign-in providers
4. Enable "Email/Password" (first toggle)
5. Click "Save"

### Step 3: Create Firestore Database

1. Click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Select "Start in test mode" (we'll secure it later)
4. Choose a location closest to you
5. Click "Enable"

### Step 4: Create Storage Bucket

1. Click "Storage" in the left sidebar
2. Click "Get started"
3. Select "Start in test mode"
4. Click "Next" and then "Done"

### Step 5: Get Your Firebase Config

1. Click the gear icon ⚙️ next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps"
4. Click the web icon `</>`
5. Register app name: `idg-ventures-web`
6. Copy the `firebaseConfig` object values

### Step 6: Update firebase-config.js

Open `firebase-config.js` and replace the placeholder values:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",           // paste your apiKey
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",     // paste your projectId
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Step 7: Run Initial Setup

1. Start a local server:
   ```bash
   cd "/Users/kietle/Documents/IDG Documents/IDG Management"
   python3 -m http.server 8000
   ```

2. Open `http://localhost:8000/setup.html` in your browser

3. Create your admin account:
   - Enter your name, email, and password
   - Click "Create Admin Account"

4. Load sample data:
   - Click "Load Sample Data"
   - Wait for completion

5. Click "Go to Dashboard" - you're ready!

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Login | `/login.html` | Sign in page |
| Dashboard | `/index.html` | Fund overview and metrics |
| Portfolio | `/portfolio.html` | All portfolio companies |
| My View | `/personal.html` | Personal events and tasks |
| Documents | `/documents.html` | Document management |
| Admin | `/admin.html` | User and settings management |
| Setup | `/setup.html` | Initial setup (first time only) |

## User Roles

| Role | Access |
|------|--------|
| **Admin** | Full access to everything, user management |
| **GP** | Full fund data, all companies, documents |
| **LP** | Fund performance only, LP documents, no company details |
| **Team** | Assigned companies only, tasks, events |

## Security Rules (Production)

For production, update your Firestore rules in Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read their own data
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'Admin';
    }
    
    // Fund data - authenticated users only
    match /fund/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['Admin', 'GP'];
    }
    
    // Companies - role based
    match /companies/{companyId} {
      allow read: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['Admin', 'GP', 'Team'];
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['Admin', 'GP'];
    }
    
    // Events and tasks
    match /events/{eventId} {
      allow read, write: if request.auth != null;
    }
    
    match /tasks/{taskId} {
      allow read, write: if request.auth != null;
    }
    
    // Documents
    match /documents/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['Admin', 'GP'];
    }
  }
}
```

## File Structure

```
IDG Management/
├── index.html          # Dashboard
├── login.html          # Login page
├── portfolio.html      # Portfolio companies
├── personal.html       # Personal view
├── documents.html      # Document management
├── admin.html          # Admin panel
├── setup.html          # Initial setup
├── styles.css          # Design system
├── app.js              # Legacy (can be removed)
├── firebase-config.js  # Firebase configuration
├── auth.js             # Authentication module
├── database.js         # Firestore operations
├── storage.js          # File storage operations
├── README.md           # This file
└── data/               # Legacy JSON data (can be removed)
```

## Customization

### Colors

Edit the CSS variables in `styles.css`:

```css
:root {
  --accent: #7C3AED;        /* Violet - main accent */
  --accent-hover: #6D28D9;   /* Darker violet */
  --accent-light: #EDE9FE;   /* Light violet background */
}
```

### Fund Data

Update fund metrics in Admin Panel → Fund Settings, or directly in Firestore.

## Troubleshooting

### "Permission denied" errors
- Check that Firebase Auth is enabled
- Make sure you're signed in
- Verify Firestore rules allow access

### "Cannot connect to Firebase"
- Check your `firebase-config.js` values
- Ensure you're running via a local server (not file://)
- Check browser console for specific errors

### Data not loading
- Open browser Developer Tools (F12)
- Check Console for errors
- Verify Firestore database exists and has data

## Support

For issues or questions, check the browser console for error messages. Most problems are related to:
1. Firebase configuration values
2. Running the app without a local server
3. Firestore security rules blocking access

---

Built with Firebase, designed with a Mercury-inspired minimal aesthetic.
