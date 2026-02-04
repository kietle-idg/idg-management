// Authentication Module
// =====================

const Auth = {
  // Current user state
  currentUser: null,
  currentUserData: null,

  // Initialize auth listener
  init() {
    return new Promise((resolve) => {
      firebaseAuth.onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          // Fetch user data from Firestore
          try {
            const userDoc = await firebaseDb.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
              this.currentUserData = { id: user.uid, ...userDoc.data() };
              // Update last login
              firebaseDb.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
              });
            }
          } catch (error) {
            console.error('Error fetching user data:', error);
          }
        } else {
          this.currentUser = null;
          this.currentUserData = null;
        }
        resolve(user);
      });
    });
  },

  // Sign in with email/password
  async signIn(email, password) {
    try {
      const result = await firebaseAuth.signInWithEmailAndPassword(email, password);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Sign in error:', error);
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  },

  // Sign out
  async signOut() {
    try {
      await firebaseAuth.signOut();
      window.location.href = 'login.html';
    } catch (error) {
      console.error('Sign out error:', error);
    }
  },

  // Send password reset email
  async resetPassword(email) {
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      return { success: true };
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  },

  // Create new user (admin only)
  async createUser(email, password, userData) {
    try {
      // This requires Firebase Admin SDK or a Cloud Function
      // For now, we'll create the user document after they sign up
      const result = await firebaseAuth.createUserWithEmailAndPassword(email, password);
      
      // Create user document in Firestore
      await firebaseDb.collection('users').doc(result.user.uid).set({
        email: email,
        name: userData.name,
        role: userData.role,
        title: userData.title,
        assignedCompanies: userData.assignedCompanies || [],
        commitment: userData.commitment || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: null
      });

      return { success: true, user: result.user };
    } catch (error) {
      console.error('Create user error:', error);
      return { success: false, error: this.getErrorMessage(error.code) };
    }
  },

  // Check if user is authenticated
  isAuthenticated() {
    return this.currentUser !== null;
  },

  // Check user role
  hasRole(role) {
    if (!this.currentUserData) return false;
    return this.currentUserData.role === role;
  },

  // Check if user has any of the specified roles
  hasAnyRole(roles) {
    if (!this.currentUserData) return false;
    return roles.includes(this.currentUserData.role);
  },

  // Get user role
  getRole() {
    return this.currentUserData?.role || null;
  },

  // Protect page - redirect if not authenticated
  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  // Protect page - require specific role
  requireRole(roles) {
    if (!this.requireAuth()) return false;
    if (!this.hasAnyRole(roles)) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  // Get friendly error messages
  getErrorMessage(code) {
    const messages = {
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/network-request-failed': 'Network error. Please check your connection.'
    };
    return messages[code] || 'An error occurred. Please try again.';
  }
};

// Export
window.Auth = Auth;
