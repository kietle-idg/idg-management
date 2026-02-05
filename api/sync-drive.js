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
        
        if (files.length === 0) {
          results.push({
            companyName: folder.name,
            status: 'no_files',
            filesFound: 0,
            filesProcessed: 0
          });
          continue;
        }

        let combinedContent = '';
        let processedCount = 0;
        
        for (const file of files.slice(0, 5)) {
          const content = await getFileContent(drive, file);
          if (content && !content.startsWith('[Could not read')) {
            combinedContent += `\n\n--- ${file.name} ---\n${content}`;
            processedCount++;
          }
        }

        let extractedData = null;
        let savedToFirebase = false;
        
        if (combinedContent.length > 50) {
          extractedData = await extractPortfolioData(folder.name, combinedContent);
          
          // Save to Firebase if data was extracted
          if (extractedData && db) {
            const companyData = {
              name: extractedData.name || folder.name,
              sector: extractedData.sector || 'Other',
              stage: extractedData.stage || 'Seed',
              status: extractedData.status || 'Active',
              investmentDate: extractedData.investmentDate || null,
              investmentAmount: extractedData.investmentAmount || 0,
              currentValuation: extractedData.currentValuation || 0,
              ownership: extractedData.ownership || 0,
              founder: extractedData.founder || null,
              founderEmail: extractedData.founderEmail || null,
              location: extractedData.location || null,
              description: extractedData.description || null,
              lastUpdate: extractedData.lastUpdate || null,
              driveFolderId: folder.id,
              syncedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            // Check if company already exists
            const existing = await db.collection('companies')
              .where('driveFolderId', '==', folder.id)
              .limit(1)
              .get();
            
            if (!existing.empty) {
              await existing.docs[0].ref.update(companyData);
              savedToFirebase = true;
            } else {
              const byName = await db.collection('companies')
                .where('name', '==', companyData.name)
                .limit(1)
                .get();
              
              if (!byName.empty) {
                await byName.docs[0].ref.update(companyData);
                savedToFirebase = true;
              } else {
                companyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
                await db.collection('companies').add(companyData);
                savedToFirebase = true;
              }
            }
          }
        }
        
        // Count file types
        const fileTypes = {};
        files.forEach(f => {
          const type = f.mimeType.includes('google-apps.spreadsheet') ? 'Google Sheets' :
                       f.mimeType.includes('google-apps.document') ? 'Google Docs' :
                       f.mimeType.includes('pdf') ? 'PDF' :
                       f.mimeType.includes('spreadsheet') || f.mimeType.includes('excel') ? 'Excel' :
                       f.mimeType.includes('word') || f.mimeType.includes('document') ? 'Word' :
                       'Other';
          fileTypes[type] = (fileTypes[type] || 0) + 1;
        });

        results.push({
          companyName: folder.name,
          filesFound: files.length,
          filesProcessed: processedCount,
          fileTypes,
          status: savedToFirebase ? 'success' : (extractedData ? 'extracted_not_saved' : 'no_data_extracted'),
          savedToFirebase,
          extractedFields: extractedData ? Object.keys(extractedData).filter(k => extractedData[k] !== null) : []
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
