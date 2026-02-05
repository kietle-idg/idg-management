const { google } = require('googleapis');
const OpenAI = require('openai');
const admin = require('firebase-admin');

// Initialize Firebase Admin (only once)
let db = null;
try {
  if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.project_id) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      db = admin.firestore();
    }
  } else if (admin.apps.length) {
    db = admin.firestore();
  }
} catch (e) {
  console.error('Firebase init error:', e.message);
}

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// List files in a folder (including subfolders recursively)
async function listFilesInFolder(drive, folderId, depth = 0) {
  if (depth > 2) return [];
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 100
  });
  
  const items = response.data.files || [];
  let files = [];
  
  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      const subFiles = await listFilesInFolder(drive, item.id, depth + 1);
      files = files.concat(subFiles);
    } else {
      // Include all file types - we'll handle them in getFileContent
      files.push(item);
    }
  }
  
  return files;
}

// Download file content as text
async function getFileContent(drive, file) {
  try {
    let content = '';
    
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: 'text/csv'
      }, { responseType: 'text' });
      content = response.data;
    } else if (file.mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: 'text/plain'
      }, { responseType: 'text' });
      content = response.data;
    } else if (file.mimeType === 'text/plain' || file.mimeType === 'text/csv') {
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, { responseType: 'text' });
      content = response.data;
    } else {
      // For PDFs, Excel, Word - we can't read them directly in serverless
      // but we note the file name which often contains useful info
      content = `[Binary file: ${file.name}] - File type: ${file.mimeType}`;
    }
    
    return content.substring(0, 8000);
  } catch (error) {
    console.error(`Error reading file ${file.name}:`, error.message);
    return `[Could not read: ${file.name}] Error: ${error.message}`;
  }
}

// Use AI to extract portfolio data from documents
async function extractPortfolioData(companyName, fileContents) {
  const prompt = `You are analyzing documents for a portfolio company called "${companyName}".

Based on the following document contents, extract any relevant investment/portfolio data you can find.

Documents:
${fileContents}

Extract and return a JSON object with any of these fields you can find (use null for fields you can't determine):
{
  "name": "company name",
  "sector": "industry/sector",
  "stage": "Seed, Series A, Series B, Series C, Growth, or Exited",
  "status": "Active or Exited",
  "investmentDate": "YYYY-MM-DD format or null",
  "investmentAmount": number in dollars or null,
  "currentValuation": number in dollars or null,
  "ownership": percentage as decimal (e.g., 15.5) or null,
  "founder": "founder name or null",
  "founderEmail": "email or null",
  "location": "city, state or null",
  "description": "brief company description or null",
  "lastUpdate": "any recent news or updates found"
}

Return ONLY the JSON object, no other text.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error('OpenAI extraction error:', error.message);
    return null;
  }
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
    const missingVars = [];
    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) missingVars.push('GOOGLE_DRIVE_FOLDER_ID');
    if (!process.env.GOOGLE_SERVICE_ACCOUNT) missingVars.push('GOOGLE_SERVICE_ACCOUNT');
    if (!process.env.OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY');
    
    if (missingVars.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: `Missing environment variables: ${missingVars.join(', ')}` 
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
    const limit = parseInt(req.query?.limit) || 5; // Process 5 at a time
    
    const companyFolders = allFolders.slice(offset, offset + limit);
    
    const results = [];
    const errors = [];

    for (const folder of companyFolders) {
      try {
        const files = await listFilesInFolder(drive, folder.id);
        let savedToFirebase = false;
        
        // Always create/update company from folder - user will fill details later
        if (db) {
          // Clean up folder name (remove numbering like "1. " or "5.6. ")
          let companyName = folder.name.replace(/^\d+(\.\d+)*\.?\s*/, '').trim();
          // Handle names like "Company (OldName)" - use the main name
          const mainName = companyName.split('(')[0].trim();
          
          const companyData = {
            name: companyName,
            displayName: mainName,
            sector: null,
            stage: null,
            status: 'Active',
            investmentDate: null,
            investmentAmount: null,
            currentValuation: null,
            ownership: null,
            founder: null,
            founderEmail: null,
            location: null,
            description: null,
            driveFolderId: folder.id,
            driveFileCount: files.length,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          
          // Check if company already exists by driveFolderId
          const existing = await db.collection('companies')
            .where('driveFolderId', '==', folder.id)
            .limit(1)
            .get();
          
          if (!existing.empty) {
            // Update only sync-related fields, preserve user-edited data
            await existing.docs[0].ref.update({
              driveFileCount: files.length,
              syncedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            savedToFirebase = true;
          } else {
            // Check by name similarity
            const byName = await db.collection('companies')
              .where('name', '==', companyName)
              .limit(1)
              .get();
            
            if (!byName.empty) {
              await byName.docs[0].ref.update({
                driveFolderId: folder.id,
                driveFileCount: files.length,
                syncedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              savedToFirebase = true;
            } else {
              // Create new company
              companyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
              await db.collection('companies').add(companyData);
              savedToFirebase = true;
            }
          }
        }

        results.push({
          companyName: folder.name,
          filesFound: files.length,
          status: savedToFirebase ? 'success' : 'not_saved',
          savedToFirebase
        });

      } catch (error) {
        errors.push({
          companyName: folder.name,
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
      firebaseConnected: db !== null,
      results,
      errors
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};
