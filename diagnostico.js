#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs         = require('fs');
const { google } = require('googleapis');

const CFG = {
  serviceAccount: process.env.GOOGLE_CREDENTIALS || './service-account.json',
  spreadsheetId:  process.env.SPREADSHEET_ID,
};

async function main() {
  const credentials = JSON.parse(fs.readFileSync(CFG.serviceAccount, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Listar todas las hojas
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CFG.spreadsheetId });
  console.log('=== HOJAS DISPONIBLES ===');
  meta.data.sheets.forEach(s => {
    console.log('  ID:', s.properties.sheetId, '| Nombre:', s.properties.title, '| Filas:', s.properties.gridProperties.rowCount);
  });

  // 2. Leer hoja INFORMES completa filas 1-20
  console.log('\n=== CONTENIDO HOJA INFORMES (filas 1-20) ===');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.spreadsheetId,
    range: 'INFORMES!A1:C20',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  console.log('Total filas con datos:', rows.length);
  rows.forEach((row, i) => {
    console.log('  Fila ' + (i+1) + ': A="' + (row[0]||'').slice(0,30) + '" B=' + (row[1]||'').length + 'chars C=' + (row[2]||'').length + 'chars');
  });
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
