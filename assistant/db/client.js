/**
 * Google Sheets client for the CEO HQ database.
 * Authenticates with a service account (GOOGLE_CREDENTIALS_PATH, default ./credentials.json).
 * Each table lives in its own spreadsheet; file IDs come from assistant/config/database.json.
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { TABLES } = require('./schema');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'database.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function getCredentialsPath() {
  const p = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
  return path.isAbsolute(p) ? p : path.join(__dirname, '..', '..', p);
}

async function getSheets() {
  const keyFile = getCredentialsPath();
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Service account credentials not found at ${keyFile}. ` +
      'See assistant/SETUP.he.md — create a service account, save credentials.json, ' +
      'and share the "CEO HQ" Drive folder with the service account email (Editor).'
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function tableInfo(table) {
  const schema = TABLES[table];
  const config = loadConfig();
  const entry = config.tables[table];
  if (!schema || !entry) {
    throw new Error(`Unknown table "${table}". Available: ${Object.keys(TABLES).join(', ')}`);
  }
  return { schema, fileId: entry.fileId };
}

async function firstSheetName(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  return meta.data.sheets[0].properties.title;
}

function rowsToObjects(columns, rows) {
  return rows.map((row, i) => {
    const obj = { _row: i + 2 }; // 1-based, +1 for header
    columns.forEach((col, j) => { obj[col] = row[j] !== undefined ? row[j] : ''; });
    return obj;
  });
}

async function readTable(table) {
  const { schema, fileId } = tableInfo(table);
  const sheets = await getSheets();
  const sheetName = await firstSheetName(sheets, fileId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: fileId,
    range: `'${sheetName}'`,
  });
  const rows = res.data.values || [];
  return rowsToObjects(schema.columns, rows.slice(1));
}

function nextId(schema, records) {
  let max = 0;
  for (const r of records) {
    const m = /^[A-Z]+-(\d+)$/.exec(r.ID || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${schema.prefix}-${String(max + 1).padStart(4, '0')}`;
}

async function addRecord(table, data) {
  const { schema, fileId } = tableInfo(table);
  const sheets = await getSheets();
  const sheetName = await firstSheetName(sheets, fileId);
  const existing = await readTable(table);
  const id = data.ID || nextId(schema, existing);
  const record = { ...data, ID: id };
  if (schema.columns.includes('Date') && !record.Date) {
    record.Date = new Date().toISOString().slice(0, 10);
  }
  const row = schema.columns.map((col) => record[col] !== undefined ? String(record[col]) : '');
  await sheets.spreadsheets.values.append({
    spreadsheetId: fileId,
    range: `'${sheetName}'`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return record;
}

async function updateRecord(table, id, patch) {
  const { schema, fileId } = tableInfo(table);
  const records = await readTable(table);
  const rec = records.find((r) => r.ID === id);
  if (!rec) throw new Error(`Record ${id} not found in table "${table}"`);
  const updated = { ...rec, ...patch, ID: id };
  const sheets = await getSheets();
  const sheetName = await firstSheetName(sheets, fileId);
  const row = schema.columns.map((col) => updated[col] !== undefined ? String(updated[col]) : '');
  await sheets.spreadsheets.values.update({
    spreadsheetId: fileId,
    range: `'${sheetName}'!A${rec._row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  return updated;
}

function filterRecords(records, filters) {
  return records.filter((r) =>
    Object.entries(filters).every(([k, v]) =>
      String(r[k] || '').toLowerCase().includes(String(v).toLowerCase())
    )
  );
}

function searchRecords(records, text) {
  const needle = text.toLowerCase();
  return records.filter((r) =>
    Object.entries(r).some(([k, v]) => k !== '_row' && String(v).toLowerCase().includes(needle))
  );
}

module.exports = { loadConfig, readTable, addRecord, updateRecord, filterRecords, searchRecords, TABLES };
