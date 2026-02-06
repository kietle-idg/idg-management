const { google } = require('googleapis');

const SPREADSHEET_ID = '1F4R-jSZKpTO17KWuzsiM4Iqifc3Gpt4q';
const SHEET_GID = 531872804;

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

function parseNumber(val) {
  if (!val) return 0;
  const str = val.toString().replace(/[$,\s%]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseMultiplier(val) {
  if (!val) return 0;
  const str = val.toString().replace(/[,\s]/g, '');
  // Handle "1.00x" format
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

    // Read all data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:Z200`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.status(200).json({ success: true, companies: [], message: 'No data found in sheet' });
    }

    // Parse headers
    const headers = rows[0].map(h => (h || '').toString().trim());
    const headersLower = headers.map(h => h.toLowerCase());

    // Find column indices by header keywords
    const findCol = (...keywords) => {
      return headersLower.findIndex(h => keywords.every(k => h.includes(k.toLowerCase())));
    };

    const colMap = {
      name: findCol('portfolio'),
      investors: findCol('investors'),
      investmentDate: Math.max(findCol('investment', 'made'), findCol('investment', 'date')),
      totalInvested: findCol('total', 'invested'),
      entryValuation: findCol('valuation', 'investment'),
      ownership: findCol('ownership'),
      latestValuation: findCol('latest', 'valuation'),
      netValue: findCol('net', 'value'),
      netROI: findCol('net', 'roi'),
    };

    // If "portfolio" column not found, try column B (index 1)
    if (colMap.name < 0) colMap.name = 1;

    // Detect if entry valuation header mentions "million"
    const entryValHeader = colMap.entryValuation >= 0 ? headers[colMap.entryValuation] : '';
    const entryValInMillions = entryValHeader.toLowerCase().includes('million');

    const latestValHeader = colMap.latestValuation >= 0 ? headers[colMap.latestValuation] : '';
    const latestValInMillions = latestValHeader.toLowerCase().includes('million');

    // Find quarterly valuation columns (e.g., "Valuation (30.6.2025)")
    const quarterlyValCols = [];
    headersLower.forEach((h, i) => {
      if (h.includes('valuation') && /\d{1,2}\.\d{1,2}\.\d{4}/.test(h)) {
        if (i !== colMap.entryValuation && i !== colMap.latestValuation) {
          quarterlyValCols.push({ index: i, header: headers[i] });
        }
      }
    });

    // Parse data rows
    const companies = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;

      const name = (row[colMap.name] || '').toString().trim();
      if (!name) continue;

      // Parse entry valuation
      let entryVal = colMap.entryValuation >= 0 ? parseNumber(row[colMap.entryValuation]) : 0;
      if (entryValInMillions && entryVal > 0 && entryVal < 100000) {
        entryVal = entryVal * 1000000;
      }

      // Parse latest valuation
      let latestVal = colMap.latestValuation >= 0 ? parseNumber(row[colMap.latestValuation]) : 0;
      if (latestValInMillions && latestVal > 0 && latestVal < 100000) {
        latestVal = latestVal * 1000000;
      }

      // Parse ownership - could be percentage or decimal
      let ownership = colMap.ownership >= 0 ? parseNumber(row[colMap.ownership]) : 0;

      const company = {
        name,
        investors: colMap.investors >= 0 ? (row[colMap.investors] || '').toString().trim() : '',
        investmentDate: colMap.investmentDate >= 0 ? (row[colMap.investmentDate] || '').toString().trim() : '',
        investmentAmount: colMap.totalInvested >= 0 ? parseNumber(row[colMap.totalInvested]) : 0,
        entryValuation: entryVal,
        ownership: ownership,
        currentValuation: latestVal,
        netValue: colMap.netValue >= 0 ? parseNumber(row[colMap.netValue]) : 0,
        moic: colMap.netROI >= 0 ? parseMultiplier(row[colMap.netROI]) : 0,
      };

      // Add quarterly valuations
      for (const qCol of quarterlyValCols) {
        let qVal = parseNumber(row[qCol.index]);
        // Apply same million logic
        if (qCol.header.toLowerCase().includes('million') && qVal > 0 && qVal < 100000) {
          qVal = qVal * 1000000;
        }
        const dateMatch = qCol.header.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
        const key = dateMatch ? `valuation_${dateMatch[1].replace(/\./g, '_')}` : `valuation_col_${qCol.index}`;
        company[key] = qVal;
      }

      companies.push(company);
    }

    return res.status(200).json({
      success: true,
      sheetName,
      totalRows: rows.length - 1,
      companiesFound: companies.length,
      headers,
      colMap,
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
