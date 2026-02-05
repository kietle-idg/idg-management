const { google } = require('googleapis');
const OpenAI = require('openai');
const admin = require('firebase-admin');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
}

// Get Firestore reference
const db = admin.apps.length ? admin.firestore() : null;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Google Drive
function getGoogleAuth() {
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
  if (depth > 2) return []; // Limit recursion depth
  
  // Get all files and folders
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 100
  });
  
  const items = response.data.files || [];
  let files = [];
  
  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // Recursively get files from subfolders
      const subFiles = await listFilesInFolder(drive, item.id, depth + 1);
      files = files.concat(subFiles);
    } else if (
      item.mimeType === 'application/pdf' ||
      item.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      item.mimeType === 'application/vnd.ms-excel' ||
      item.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      item.mimeType === 'application/msword' ||
      item.mimeType === 'application/vnd.google-apps.spreadsheet' ||
      item.mimeType === 'application/vnd.google-apps.document' ||
      item.mimeType === 'text/plain' ||
      item.mimeType === 'text/csv'
    ) {
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
      // Export Google Sheets as CSV
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: 'text/csv'
      }, { responseType: 'text' });
      content = response.data;
    } else if (file.mimeType === 'application/vnd.google-apps.document') {
      // Export Google Docs as plain text
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: 'text/plain'
      }, { responseType: 'text' });
      content = response.data;
    } else if (file.mimeType === 'text/plain' || file.mimeType === 'text/csv') {
      // Download text files directly
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, { responseType: 'text' });
      content = response.data;
    } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
               file.mimeType === 'application/vnd.ms-excel') {
      // Excel files - download and parse
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      const XLSX = require('xlsx');
      const workbook = XLSX.read(response.data, { type: 'buffer' });
      
      // Get content from all sheets
      for (const sheetName of workbook.SheetNames.slice(0, 3)) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        content += `\n[Sheet: ${sheetName}]\n${csv}`;
      }
    } else if (file.mimeType === 'application/pdf') {
      // PDF files - download and parse
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(Buffer.from(response.data));
      content = pdfData.text;
    } else if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
               file.mimeType === 'application/msword') {
      // Word files - download and parse
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media'
      }, { responseType: 'arraybuffer' });
      
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: Buffer.from(response.data) });
      content = result.value;
    } else {
      content = `[File: ${file.name} - type: ${file.mimeType}]`;
    }
    
    // Limit content length to avoid token limits
    return content.substring(0, 8000);
  } catch (error) {
    console.error(`Error reading file ${file.name}:`, error.message);
    return `[File: ${file.name} - could not read: ${error.message}]`;
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
    // Parse the JSON from the response
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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!folderId) {
      return res.status(400).json({ error: 'Google Drive folder ID not configured' });
    }

    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Get all company folders
    const companyFolders = await listCompanyFolders(drive, folderId);
    
    const results = [];
    const errors = [];

    for (const folder of companyFolders) {
      try {
        // Get files in this company's folder
        const files = await listFilesInFolder(drive, folder.id);
        
        if (files.length === 0) {
          results.push({
            companyName: folder.name,
            status: 'no_files',
            data: null
          });
          continue;
        }

        // Get content from each file
        let combinedContent = '';
        for (const file of files.slice(0, 5)) { // Limit to 5 files per company
          const content = await getFileContent(drive, file);
          combinedContent += `\n\n--- ${file.name} ---\n${content}`;
        }

        // Extract data using AI
        const extractedData = await extractPortfolioData(folder.name, combinedContent);
        
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
          
          // Check if company already exists (by driveFolderId or name)
          const existing = await db.collection('companies')
            .where('driveFolderId', '==', folder.id)
            .limit(1)
            .get();
          
          if (!existing.empty) {
            // Update existing company
            await existing.docs[0].ref.update(companyData);
          } else {
            // Check by name
            const byName = await db.collection('companies')
              .where('name', '==', companyData.name)
              .limit(1)
              .get();
            
            if (!byName.empty) {
              await byName.docs[0].ref.update(companyData);
            } else {
              // Create new company
              companyData.createdAt = admin.firestore.FieldValue.serverTimestamp();
              await db.collection('companies').add(companyData);
            }
          }
        }
        
        results.push({
          companyName: folder.name,
          folderId: folder.id,
          filesProcessed: Math.min(files.length, 5),
          totalFiles: files.length,
          status: extractedData ? 'success' : 'no_data_extracted',
          data: extractedData,
          savedToFirebase: extractedData && db ? true : false
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
      foldersProcessed: companyFolders.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
