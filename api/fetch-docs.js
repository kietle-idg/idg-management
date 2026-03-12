const { google } = require('googleapis');
const pdfParse = require('pdf-parse');

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

function parseDriveUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // Google Drive folder: /drive/folders/ID or /drive/u/0/folders/ID
  let m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: 'folder', id: m[1] };

  // Google Docs/Sheets/Slides: /document/d/ID or /spreadsheets/d/ID or /presentation/d/ID
  m = url.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (m) {
    const typeMap = { document: 'doc', spreadsheets: 'sheet', presentation: 'slides' };
    return { type: typeMap[m[1]], id: m[2] };
  }

  // Google Drive file: /file/d/ID
  m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: 'file', id: m[1] };

  // Direct Drive ID (e.g., just the ID string)
  m = url.match(/^([a-zA-Z0-9_-]{20,})$/);
  if (m) return { type: 'file', id: m[1] };

  return null;
}

async function getFileContent(drive, file) {
  const mimeType = file.mimeType;
  const MAX_CHARS = 8000;

  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
    return (res.data || '').substring(0, MAX_CHARS);
  }

  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await drive.files.export({ fileId: file.id, mimeType: 'text/csv' });
    return (res.data || '').substring(0, MAX_CHARS);
  }

  if (mimeType === 'application/vnd.google-apps.presentation') {
    const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
    return (res.data || '').substring(0, MAX_CHARS);
  }

  if (mimeType?.startsWith('text/')) {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return text.substring(0, MAX_CHARS);
  }

  if (mimeType === 'application/pdf') {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    const pdf = await pdfParse(buffer);
    const text = (pdf.text || '').substring(0, MAX_CHARS);
    return text.trim().length > 50 ? text : null;
  }

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { links } = req.body;
    if (!links || !Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'links array required' });
    }

    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });
    const results = [];
    const TOTAL_CHAR_LIMIT = 40000;
    let totalChars = 0;

    for (const url of links.slice(0, 10)) {
      if (totalChars >= TOTAL_CHAR_LIMIT) break;

      const parsed = parseDriveUrl(url);
      if (!parsed) {
        results.push({ url, content: null, error: 'Could not parse Drive URL' });
        continue;
      }

      try {
        if (parsed.type === 'folder') {
          const fileList = await drive.files.list({
            q: `'${parsed.id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
            fields: 'files(id, name, mimeType, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 8
          });

          const files = fileList.data.files || [];
          let folderContent = '';

          for (const f of files) {
            if (totalChars + folderContent.length >= TOTAL_CHAR_LIMIT) break;
            try {
              const text = await getFileContent(drive, f);
              if (text) {
                folderContent += `\n--- ${f.name} ---\n${text}\n`;
              }
            } catch (e) {
              console.error(`Error reading ${f.name}:`, e.message);
            }
          }

          totalChars += folderContent.length;
          results.push({
            url,
            fileCount: files.length,
            content: folderContent || null
          });

        } else {
          // Single file — get metadata first to know the mimeType
          let mimeType;
          if (parsed.type === 'doc') mimeType = 'application/vnd.google-apps.document';
          else if (parsed.type === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
          else if (parsed.type === 'slides') mimeType = 'application/vnd.google-apps.presentation';
          else {
            const meta = await drive.files.get({ fileId: parsed.id, fields: 'id,name,mimeType' });
            mimeType = meta.data.mimeType;
          }

          const text = await getFileContent(drive, { id: parsed.id, mimeType });
          totalChars += (text || '').length;
          results.push({ url, content: text || null });
        }
      } catch (e) {
        console.error(`Error fetching ${url}:`, e.message);
        results.push({ url, content: null, error: e.message });
      }
    }

    return res.status(200).json({ success: true, documents: results });

  } catch (error) {
    console.error('Fetch docs error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
