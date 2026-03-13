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

  let m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: 'folder', id: m[1] };

  m = url.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (m) {
    const typeMap = { document: 'doc', spreadsheets: 'sheet', presentation: 'slides' };
    return { type: typeMap[m[1]], id: m[2] };
  }

  m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: 'file', id: m[1] };

  m = url.match(/^([a-zA-Z0-9_-]{20,})$/);
  if (m) return { type: 'file', id: m[1] };

  return null;
}

async function getFileContent(drive, file) {
  const mimeType = file.mimeType;
  const MAX_CHARS = 6000;

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
    const res = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data);
    const pdf = await pdfParse(buffer);
    const text = (pdf.text || '').substring(0, MAX_CHARS);
    return text.trim().length > 50 ? text : null;
  }

  return null;
}

async function fetchFolder(drive, folderId, url) {
  const fileList = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 4,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  const files = fileList.data.files || [];
  if (files.length === 0) {
    return { url, content: null, fileCount: 0, note: 'Folder empty or no readable files' };
  }

  let content = '';
  for (const f of files) {
    try {
      const text = await getFileContent(drive, f);
      if (text) content += `\n--- ${f.name} ---\n${text}\n`;
    } catch (e) {
      console.error(`Error reading ${f.name}:`, e.message);
    }
  }

  return { url, content: content || null, fileCount: files.length };
}

async function fetchSingleFile(drive, parsed, url) {
  let mimeType;
  if (parsed.type === 'doc') mimeType = 'application/vnd.google-apps.document';
  else if (parsed.type === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
  else if (parsed.type === 'slides') mimeType = 'application/vnd.google-apps.presentation';
  else {
    const meta = await drive.files.get({
      fileId: parsed.id,
      fields: 'id,name,mimeType',
      supportsAllDrives: true
    });
    mimeType = meta.data.mimeType;
  }

  const text = await getFileContent(drive, { id: parsed.id, mimeType });
  return { url, content: text || null };
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

    // Process all links in parallel for speed
    const promises = links.slice(0, 8).map(async (url) => {
      const parsed = parseDriveUrl(url);
      if (!parsed) return { url, content: null, error: 'Could not parse Drive URL' };

      try {
        if (parsed.type === 'folder') {
          return await fetchFolder(drive, parsed.id, url);
        } else {
          return await fetchSingleFile(drive, parsed, url);
        }
      } catch (e) {
        console.error(`Error fetching ${url}:`, e.message);
        return { url, content: null, error: e.message };
      }
    });

    const results = await Promise.all(promises);

    const hasAnyContent = results.some(r => r.content);
    const errors = results.filter(r => r.error).map(r => r.error);

    return res.status(200).json({
      success: true,
      documents: results,
      summary: {
        total: results.length,
        withContent: results.filter(r => r.content).length,
        errors: errors.length,
        errorMessages: errors.length ? errors : undefined
      }
    });

  } catch (error) {
    console.error('Fetch docs error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
