// Database Module (Firestore Operations)
// ======================================

const Database = {
  // ==================
  // FUND OPERATIONS
  // ==================
  
  async getFund() {
    try {
      const doc = await firebaseDb.collection('fund').doc('main').get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Error getting fund:', error);
      return null;
    }
  },

  async updateFund(data) {
    try {
      await firebaseDb.collection('fund').doc('main').update(data);
      return { success: true };
    } catch (error) {
      console.error('Error updating fund:', error);
      return { success: false, error };
    }
  },

  // ==================
  // COMPANY OPERATIONS
  // ==================

  async getCompanies() {
    try {
      const snapshot = await firebaseDb.collection('companies').orderBy('name').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting companies:', error);
      return [];
    }
  },

  async getCompany(id) {
    try {
      const doc = await firebaseDb.collection('companies').doc(id).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting company:', error);
      return null;
    }
  },

  async getCompaniesByIds(ids) {
    if (!ids || ids.length === 0) return [];
    try {
      const promises = ids.map(id => this.getCompany(id));
      const results = await Promise.all(promises);
      return results.filter(c => c !== null);
    } catch (error) {
      console.error('Error getting companies by IDs:', error);
      return [];
    }
  },

  async createCompany(data) {
    try {
      const docRef = await firebaseDb.collection('companies').add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creating company:', error);
      return { success: false, error };
    }
  },

  async updateCompany(id, data) {
    try {
      await firebaseDb.collection('companies').doc(id).update(data);
      return { success: true };
    } catch (error) {
      console.error('Error updating company:', error);
      return { success: false, error };
    }
  },

  async deleteCompany(id) {
    try {
      await firebaseDb.collection('companies').doc(id).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting company:', error);
      return { success: false, error };
    }
  },

  // ==================
  // USER OPERATIONS
  // ==================

  async getUsers() {
    try {
      const snapshot = await firebaseDb.collection('users').orderBy('name').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting users:', error);
      return [];
    }
  },

  async getUser(id) {
    try {
      const doc = await firebaseDb.collection('users').doc(id).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  },

  async getUsersByRole(role) {
    try {
      const snapshot = await firebaseDb.collection('users')
        .where('role', '==', role)
        .orderBy('name')
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting users by role:', error);
      return [];
    }
  },

  async updateUser(id, data) {
    try {
      await firebaseDb.collection('users').doc(id).update(data);
      return { success: true };
    } catch (error) {
      console.error('Error updating user:', error);
      return { success: false, error };
    }
  },

  // ==================
  // EVENT OPERATIONS
  // ==================

  async getEvents() {
    try {
      const snapshot = await firebaseDb.collection('events').orderBy('date').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting events:', error);
      return [];
    }
  },

  async getUpcomingEvents(userId = null, limit = 10) {
    try {
      const today = new Date().toISOString().split('T')[0];
      let query = firebaseDb.collection('events')
        .where('date', '>=', today)
        .orderBy('date')
        .limit(limit);
      
      const snapshot = await query.get();
      let events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Filter by user if specified
      if (userId) {
        events = events.filter(e => e.attendees && e.attendees.includes(userId));
      }
      
      return events;
    } catch (error) {
      console.error('Error getting upcoming events:', error);
      return [];
    }
  },

  async createEvent(data) {
    try {
      const docRef = await firebaseDb.collection('events').add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creating event:', error);
      return { success: false, error };
    }
  },

  async updateEvent(id, data) {
    try {
      await firebaseDb.collection('events').doc(id).update(data);
      return { success: true };
    } catch (error) {
      console.error('Error updating event:', error);
      return { success: false, error };
    }
  },

  async deleteEvent(id) {
    try {
      await firebaseDb.collection('events').doc(id).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting event:', error);
      return { success: false, error };
    }
  },

  // ==================
  // TASK OPERATIONS
  // ==================

  async getTasks() {
    try {
      const snapshot = await firebaseDb.collection('tasks').orderBy('dueDate').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting tasks:', error);
      return [];
    }
  },

  async getTasksByUser(userId) {
    try {
      const snapshot = await firebaseDb.collection('tasks')
        .where('assignee', '==', userId)
        .orderBy('dueDate')
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting tasks by user:', error);
      return [];
    }
  },

  async getPendingTasks(userId = null) {
    try {
      let query = firebaseDb.collection('tasks')
        .where('status', 'in', ['pending', 'in_progress'])
        .orderBy('dueDate');
      
      const snapshot = await query.get();
      let tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (userId) {
        tasks = tasks.filter(t => t.assignee === userId);
      }
      
      return tasks;
    } catch (error) {
      console.error('Error getting pending tasks:', error);
      return [];
    }
  },

  async createTask(data) {
    try {
      const docRef = await firebaseDb.collection('tasks').add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creating task:', error);
      return { success: false, error };
    }
  },

  async updateTask(id, data) {
    try {
      await firebaseDb.collection('tasks').doc(id).update(data);
      return { success: true };
    } catch (error) {
      console.error('Error updating task:', error);
      return { success: false, error };
    }
  },

  async completeTask(id) {
    return this.updateTask(id, { 
      status: 'completed',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  async deleteTask(id) {
    try {
      await firebaseDb.collection('tasks').doc(id).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting task:', error);
      return { success: false, error };
    }
  },

  // ==================
  // DOCUMENT OPERATIONS
  // ==================

  async getDocuments() {
    try {
      const snapshot = await firebaseDb.collection('documents')
        .orderBy('uploadedAt', 'desc')
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting documents:', error);
      return [];
    }
  },

  async getDocumentsByCompany(companyId) {
    try {
      const snapshot = await firebaseDb.collection('documents')
        .where('companyId', '==', companyId)
        .orderBy('uploadedAt', 'desc')
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting documents by company:', error);
      return [];
    }
  },

  async getDocumentsByRole(role) {
    try {
      const snapshot = await firebaseDb.collection('documents')
        .where('accessRoles', 'array-contains', role)
        .orderBy('uploadedAt', 'desc')
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting documents by role:', error);
      return [];
    }
  },

  async createDocument(data) {
    try {
      const docRef = await firebaseDb.collection('documents').add({
        ...data,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Error creating document:', error);
      return { success: false, error };
    }
  },

  async deleteDocument(id) {
    try {
      await firebaseDb.collection('documents').doc(id).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting document:', error);
      return { success: false, error };
    }
  },

  // ==================
  // ACTIVITY LOG
  // ==================

  async logActivity(action, targetType, targetId, details = {}) {
    try {
      await firebaseDb.collection('activityLog').add({
        userId: Auth.currentUser?.uid,
        userName: Auth.currentUserData?.name,
        action,
        targetType,
        targetId,
        details,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  },

  async getActivityLog(limit = 50) {
    try {
      const snapshot = await firebaseDb.collection('activityLog')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting activity log:', error);
      return [];
    }
  }
};

// Export
window.Database = Database;
