const { google } = require('googleapis');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT environment variable not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
}

async function listCompanyFolders(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 100
  });
  return response.data.files || [];
}

async function listFilesInFolder(drive, folderId) {
  // List files in folder and subfolders (one level deep)
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    pageSize: 50
  });
  const files = response.data.files || [];
  
  // Check for subfolders and get their files too
  const subfolders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  const nonFolderFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  
  for (const sub of subfolders.slice(0, 5)) { // limit to 5 subfolders
    try {
      const subFiles = await drive.files.list({
        q: `'${sub.id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
        fields: 'files(id, name, mimeType, size, modifiedTime)',
        pageSize: 20
      });
      if (subFiles.data.files) {
        nonFolderFiles.push(...subFiles.data.files);
      }
    } catch (e) {
      console.error(`Error listing subfolder ${sub.name}:`, e.message);
    }
  }
  
  return nonFolderFiles;
}

async function getFileContent(drive, file) {
  try {
    const mimeType = file.mimeType;
    
    // Google Doc → plain text
    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
      return { name: file.name, type: 'Google Doc', content: (res.data || '').substring(0, 4000) };
    }
    
    // Google Sheet → CSV
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/csv' });
      return { name: file.name, type: 'Google Sheet', content: (res.data || '').substring(0, 4000) };
    }
    
    // Google Slides → plain text
    if (mimeType === 'application/vnd.google-apps.presentation') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
      return { name: file.name, type: 'Google Slides', content: (res.data || '').substring(0, 4000) };
    }
    
    // Plain text / CSV
    if (mimeType?.startsWith('text/')) {
      const res = await drive.files.get({ fileId: file.id, alt: 'media' });
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      return { name: file.name, type: 'Text', content: text.substring(0, 4000) };
    }
    
    // Binary files (PDF, Word, Excel, etc.) — return filename only
    const typeNames = {
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
      'application/msword': 'Word',
      'application/vnd.ms-excel': 'Excel',
      'image/jpeg': 'Image',
      'image/png': 'Image',
    };
    return { name: file.name, type: typeNames[mimeType] || mimeType, content: null };
    
  } catch (error) {
    return { name: file.name, type: file.mimeType, content: null, error: error.message };
  }
}

async function analyzeWithAI(companyName, filesData) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY environment variable not set');

  // Build context from files
  let context = `Company folder name: "${companyName}"\n\nDocuments found:\n`;
  
  for (const file of filesData) {
    context += `\n--- ${file.name} (${file.type}) ---\n`;
    if (file.content) {
      context += file.content + '\n';
    } else {
      context += `[Binary file - filename only]\n`;
    }
  }

  const prompt = `You are analyzing a venture capital portfolio company's data room documents.

Based on the documents below, extract all relevant information about this company. Return a JSON object with these fields:
- "description": What does this company do? (2-3 clear sentences. Be specific about their product/service.)
- "latestUpdates": Array of strings - latest news, updates, milestones, or developments mentioned (up to 5 items, most recent first)
- "sector": Industry sector (e.g. "FinTech", "Healthcare", "AI/ML", "Blockchain", "E-commerce", "SaaS", "DeepTech", "Consumer")
- "stage": Investment stage if mentioned (e.g. "Seed", "Series A", "Series B", "Growth")
- "highlights": Array of strings - key achievements, traction metrics, partnerships, or notable facts (up to 5 items)
- "founders": Array of founder/CEO names if mentioned
- "location": Company headquarters location if mentioned
- "keyMetrics": Object with any business metrics found (e.g. {"revenue": "$1M ARR", "users": "50K", "growth": "20% MoM"})

If information is not available for a field, use null for strings/objects and empty array [] for arrays.
Return ONLY valid JSON, no markdown formatting, no code blocks.

${context}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1200
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI error: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '{}';
  
  // Parse JSON (handle possible markdown wrapping)
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query?.action || 'list';
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // ── LIST: Return all company folders ──
    if (action === 'list') {
      const folderId = FOLDER_ID;
      if (!folderId) return res.status(400).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not set' });
      
      const folders = await listCompanyFolders(drive, folderId);
      return res.status(200).json({
        success: true,
        folders: folders.map(f => ({ id: f.id, name: f.name })),
        totalFolders: folders.length
      });
    }

    // ── ANALYZE: Read files from one company folder and extract data via AI ──
    if (action === 'analyze') {
      const folderId = req.query?.folderId;
      const folderName = decodeURIComponent(req.query?.folderName || 'Unknown');
      
      if (!folderId) return res.status(400).json({ error: 'folderId required' });

      // List files in the company folder
      const files = await listFilesInFolder(drive, folderId);
      
      if (files.length === 0) {
        return res.status(200).json({
          success: true,
          companyName: folderName,
          data: { description: null, latestUpdates: [], sector: null, stage: null, highlights: [], founders: [], location: null, keyMetrics: null },
          filesFound: 0,
          hasReadableContent: false
        });
      }

      // Read file contents (limit to 10 files to stay within timeout)
      const filesToRead = files.slice(0, 10);
      const filesData = [];
      
      for (const file of filesToRead) {
        const fileData = await getFileContent(drive, file);
        filesData.push(fileData);
      }

      // Check if we have any readable text content
      const hasContent = filesData.some(f => f.content && f.content.length > 20);
      
      let aiResult;
      if (hasContent) {
        aiResult = await analyzeWithAI(folderName, filesData);
      } else {
        // No readable content — return basic info from folder/file names
        aiResult = {
          description: `Portfolio company with ${files.length} files in data room. Documents include: ${filesData.map(f => f.name).slice(0, 5).join(', ')}.`,
          latestUpdates: [],
          sector: null,
          stage: null,
          highlights: [],
          founders: [],
          location: null,
          keyMetrics: null
        };
      }

      return res.status(200).json({
        success: true,
        companyName: folderName,
        data: aiResult,
        filesFound: files.length,
        filesRead: filesData.length,
        hasReadableContent: hasContent,
        fileTypes: filesData.map(f => ({ name: f.name, type: f.type, hasContent: !!f.content }))
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "list" or "analyze"' });

  } catch (error) {
    console.error('AI Sync error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
