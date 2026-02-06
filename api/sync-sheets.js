const { google } = require('googleapis');

const SPREADSHEET_ID = '1FOqG47xZxQfUrqYcZt_xJT4upRAxBMPyol6oDKBiRHE';
const SHEET_GID = 444195703;

function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT environment variable not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
  return auth;
}

function toNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = val.toString().replace(/[$,\s%]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function toMultiplier(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = val.toString().replace(/[,\s]/g, '');
  const match = str.match(/([\d.]+)\s*x/i);
  if (match) return parseFloat(match[1]);
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Get spreadsheet metadata to find sheet name by GID
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties'
    });

    let sheetName = null;
    for (const sheet of metadata.data.sheets) {
      if (sheet.properties.sheetId === SHEET_GID) {
        sheetName = sheet.properties.title;
        break;
      }
    }
    if (!sheetName) {
      sheetName = metadata.data.sheets[0]?.properties?.title || 'Sheet1';
    }

    // Read headers with FORMATTED_VALUE to get header text
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:Z1`,
      valueRenderOption: 'FORMATTED_VALUE'
    });

    // Read data rows with UNFORMATTED_VALUE to get raw numbers
    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A2:Z200`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });

    const headerRow = (headerResp.data.values && headerResp.data.values[0]) || [];
    const dataRows = dataResp.data.values || [];

    if (headerRow.length === 0) {
      return res.status(200).json({ success: true, companies: [], message: 'No headers found' });
    }

    // Build headers
    const headers = headerRow.map(h => (h || '').toString().trim());
    const headersLower = headers.map(h => h.toLowerCase());

    // Find column by keywords (ALL keywords must appear in header)
    const findCol = (...keywords) => {
      return headersLower.findIndex(h => keywords.every(k => h.includes(k.toLowerCase())));
    };

    // Find column by keywords, excluding certain indices
    const findColExcluding = (exclude, ...keywords) => {
      return headersLower.findIndex((h, i) => !exclude.includes(i) && keywords.every(k => h.includes(k.toLowerCase())));
    };

    // Map columns - be very flexible
    const colMap = {};

    // Company name column
    colMap.name = findCol('portfolio');
    if (colMap.name < 0) colMap.name = findCol('company');
    if (colMap.name < 0) colMap.name = findCol('name');
    if (colMap.name < 0) colMap.name = 1; // fallback column B

    // Investors
    colMap.investors = findCol('investor');

    // Investment date/period
    colMap.investmentDate = findCol('investment', 'made');
    if (colMap.investmentDate < 0) colMap.investmentDate = findCol('investment', 'date');
    if (colMap.investmentDate < 0) colMap.investmentDate = findCol('date');

    // Total invested
    colMap.totalInvested = findCol('total', 'invested');
    if (colMap.totalInvested < 0) colMap.totalInvested = findCol('invested');
    if (colMap.totalInvested < 0) colMap.totalInvested = findCol('investment', 'amount');

    // Entry valuation - must contain both "valuation" AND "investment" (to distinguish from quarterly)
    colMap.entryValuation = findCol('valuation', 'investment');
    if (colMap.entryValuation < 0) colMap.entryValuation = findCol('entry', 'valuation');
    if (colMap.entryValuation < 0) colMap.entryValuation = findCol('valuation at');

    // Ownership
    colMap.ownership = findCol('ownership');
    if (colMap.ownership < 0) colMap.ownership = findCol('stake');

    // Latest/current valuation
    colMap.latestValuation = findCol('latest', 'valuation');
    if (colMap.latestValuation < 0) colMap.latestValuation = findCol('current', 'valuation');

    // Net value
    colMap.netValue = findCol('net', 'value');
    if (colMap.netValue < 0) colMap.netValue = findCol('net value');

    // Net ROI / MOIC
    colMap.netROI = findCol('net', 'roi');
    if (colMap.netROI < 0) colMap.netROI = findCol('roi');
    if (colMap.netROI < 0) colMap.netROI = findCol('moic');

    // Detect "million" in headers for scaling
    const isMillion = (colIdx) => {
      if (colIdx < 0 || colIdx >= headers.length) return false;
      return headers[colIdx].toLowerCase().includes('million');
    };

    const entryValMillion = isMillion(colMap.entryValuation);
    const latestValMillion = isMillion(colMap.latestValuation);

    // Parse data rows
    const companies = [];
    const debugRows = []; // first 3 rows for debugging

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length < 2) continue;

      // Get company name
      const name = (row[colMap.name] !== undefined ? row[colMap.name] : '').toString().trim();
      if (!name || name === '0') continue;

      // Parse values
      let entryVal = colMap.entryValuation >= 0 && row[colMap.entryValuation] !== undefined ? toNum(row[colMap.entryValuation]) : 0;
      if (entryValMillion && entryVal > 0 && entryVal < 100000) {
        entryVal = Math.round(entryVal * 1000000);
      }

      let latestVal = colMap.latestValuation >= 0 && row[colMap.latestValuation] !== undefined ? toNum(row[colMap.latestValuation]) : 0;
      if (latestValMillion && latestVal > 0 && latestVal < 100000) {
        latestVal = Math.round(latestVal * 1000000);
      }

      let ownership = colMap.ownership >= 0 && row[colMap.ownership] !== undefined ? toNum(row[colMap.ownership]) : 0;
      // If ownership looks like a decimal (0.15 = 15%), convert
      if (ownership > 0 && ownership < 1) {
        ownership = ownership * 100;
      }

      let investmentAmount = colMap.totalInvested >= 0 && row[colMap.totalInvested] !== undefined ? toNum(row[colMap.totalInvested]) : 0;

      let netValue = colMap.netValue >= 0 && row[colMap.netValue] !== undefined ? toNum(row[colMap.netValue]) : 0;
      let moic = colMap.netROI >= 0 && row[colMap.netROI] !== undefined ? toMultiplier(row[colMap.netROI]) : 0;

      let investmentDate = colMap.investmentDate >= 0 && row[colMap.investmentDate] !== undefined
        ? (row[colMap.investmentDate] || '').toString().trim() : '';

      let investors = colMap.investors >= 0 && row[colMap.investors] !== undefined
        ? (row[colMap.investors] || '').toString().trim() : '';

      const company = {
        name,
        investors,
        investmentDate,
        investmentAmount,
        entryValuation: entryVal,
        ownership,
        currentValuation: latestVal,
        netValue,
        moic,
      };

      companies.push(company);

      // Save first 3 rows raw data for debugging
      if (debugRows.length < 3) {
        const rawRow = {};
        headers.forEach((h, idx) => {
          if (h && row[idx] !== undefined) {
            rawRow[`col${idx}_${h}`] = row[idx];
          }
        });
        debugRows.push({ parsed: company, raw: rawRow });
      }
    }

    return res.status(200).json({
      success: true,
      sheetName,
      totalDataRows: dataRows.length,
      companiesFound: companies.length,
      headers,
      colMap,
      entryValMillion,
      latestValMillion,
      debugRows,
      companies,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sheets sync error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
