const { google } = require('googleapis');

// Initialize Google Drive
function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT environment variable not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  return auth;
}

// List all folders (each folder = one company)
async function listCompanyFolders(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 100
  });
  return response.data.files || [];
}

// Count files in a folder
async function countFilesInFolder(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    pageSize: 100
  });
  return (response.data.files || []).length;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Check required environment variables
    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
      return res.status(400).json({ 
        success: false,
        error: 'GOOGLE_DRIVE_FOLDER_ID not configured' 
      });
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
      return res.status(400).json({ 
        success: false,
        error: 'GOOGLE_SERVICE_ACCOUNT not configured' 
      });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    let auth;
    try {
      auth = getGoogleAuth();
    } catch (authError) {
      return res.status(400).json({
        success: false,
        error: `Google Auth error: ${authError.message}`
      });
    }
    
    const drive = google.drive({ version: 'v3', auth });

    // Get all company folders
    const allFolders = await listCompanyFolders(drive, folderId);
    
    // Get offset from query params (for pagination)
    const offset = parseInt(req.query?.offset) || 0;
    const limit = parseInt(req.query?.limit) || 10;
    
    const companyFolders = allFolders.slice(offset, offset + limit);
    
    const companies = [];

    for (const folder of companyFolders) {
      try {
        const fileCount = await countFilesInFolder(drive, folder.id);
        
        // Clean up folder name (remove numbering like "1. " or "5.6. ")
        let companyName = folder.name.replace(/^\d+(\.\d+)*\.?\s*/, '').trim();
        // Get display name (before parentheses if any)
        const displayName = companyName.split('(')[0].trim();
        
        companies.push({
          name: companyName,
          displayName: displayName,
          driveFolderId: folder.id,
          driveFileCount: fileCount,
          status: 'Active'
        });

      } catch (error) {
        companies.push({
          name: folder.name,
          driveFolderId: folder.id,
          error: error.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      totalFolders: allFolders.length,
      foldersProcessed: companyFolders.length,
      offset,
      limit,
      hasMore: offset + limit < allFolders.length,
      nextOffset: offset + limit < allFolders.length ? offset + limit : null,
      companies
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
