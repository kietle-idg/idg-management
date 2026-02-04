// Storage Module (Firebase Storage Operations)
// ============================================

const Storage = {
  // Upload a file
  async uploadFile(file, path) {
    try {
      const storageRef = firebaseStorage.ref();
      const fileRef = storageRef.child(path);
      
      // Upload file
      const snapshot = await fileRef.put(file);
      
      // Get download URL
      const downloadURL = await snapshot.ref.getDownloadURL();
      
      return { 
        success: true, 
        url: downloadURL,
        path: path,
        name: file.name,
        size: file.size,
        type: file.type
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      return { success: false, error: error.message };
    }
  },

  // Upload document with metadata
  async uploadDocument(file, companyId, docType, accessRoles) {
    try {
      // Create unique path
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = companyId 
        ? `documents/companies/${companyId}/${timestamp}_${safeName}`
        : `documents/fund/${timestamp}_${safeName}`;
      
      // Upload to storage
      const uploadResult = await this.uploadFile(file, path);
      if (!uploadResult.success) {
        return uploadResult;
      }
      
      // Create document record in Firestore
      const docData = {
        name: file.name,
        type: docType,
        companyId: companyId || null,
        storagePath: path,
        storageUrl: uploadResult.url,
        size: file.size,
        mimeType: file.type,
        accessRoles: accessRoles,
        uploadedBy: Auth.currentUser?.uid,
        uploadedByName: Auth.currentUserData?.name
      };
      
      const result = await Database.createDocument(docData);
      
      if (result.success) {
        // Log activity
        Database.logActivity('upload', 'document', result.id, { fileName: file.name });
      }
      
      return { success: true, documentId: result.id, url: uploadResult.url };
    } catch (error) {
      console.error('Error uploading document:', error);
      return { success: false, error: error.message };
    }
  },

  // Delete a file
  async deleteFile(path) {
    try {
      const storageRef = firebaseStorage.ref();
      const fileRef = storageRef.child(path);
      await fileRef.delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  },

  // Delete document with storage file
  async deleteDocument(documentId, storagePath) {
    try {
      // Delete from storage
      if (storagePath) {
        await this.deleteFile(storagePath);
      }
      
      // Delete from Firestore
      await Database.deleteDocument(documentId);
      
      // Log activity
      Database.logActivity('delete', 'document', documentId);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting document:', error);
      return { success: false, error: error.message };
    }
  },

  // Get file download URL
  async getDownloadURL(path) {
    try {
      const storageRef = firebaseStorage.ref();
      const fileRef = storageRef.child(path);
      const url = await fileRef.getDownloadURL();
      return { success: true, url };
    } catch (error) {
      console.error('Error getting download URL:', error);
      return { success: false, error: error.message };
    }
  },

  // Format file size
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // Get file icon based on type
  getFileIcon(mimeType) {
    if (!mimeType) return 'file';
    if (mimeType.includes('pdf')) return 'file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'file-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'file-excel';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'file-ppt';
    if (mimeType.includes('image')) return 'file-image';
    if (mimeType.includes('video')) return 'file-video';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'file-archive';
    return 'file';
  }
};

// Export
window.Storage = Storage;
