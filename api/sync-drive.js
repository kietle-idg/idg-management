const { google } = require('googleapis');
const OpenAI = require('openai');

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

// List files in a folder
async function listFilesInFolder(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (
      mimeType='application/pdf' or 
      mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or
      mimeType='application/vnd.ms-excel' or
      mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or
      mimeType='application/msword' or
      mimeType='application/vnd.google-apps.spreadsheet' or
      mimeType='application/vnd.google-apps.document'
    )`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 50
  });
  return response.data.files || [];
}

// Download file content as text (for Google Docs/Sheets)
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
    } else {
      // For other files, just note the file name for now
      // (Full binary parsing would require more complex handling)
      content = `[File: ${file.name}]`;
    }
    
    return content.substring(0, 5000); // Limit content length
  } catch (error) {
    console.error(`Error reading file ${file.name}:`, error.message);
    return `[Could not read: ${file.name}]`;
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
        
        results.push({
          companyName: folder.name,
          folderId: folder.id,
          filesProcessed: Math.min(files.length, 5),
          totalFiles: files.length,
          status: extractedData ? 'success' : 'no_data_extracted',
          data: extractedData
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
