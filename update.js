#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  hanson* · actualizador mensual Welysis Dashboard   ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Qué hace:
 *  1. Lee KPIs de LinkedIn desde la hoja LINKEDIN del Sheets
 *  2. Lee KPIs de SEO desde la hoja SEO del Sheets
 *  3. Lee informes de texto desde la hoja INFORMES del Sheets
 *  4. Escribe data.json actualizado
 *
 * Instalación:
 *   npm install googleapis dotenv
 *
 * Variables de entorno (.env):
 *   GOOGLE_CREDENTIALS=./service-account.json
 *   SPREADSHEET_ID=1uMnbtZ5c-Ek66zBXX33BwmGDZzee-l7H_V9H2wl7cCI
 *   OUTPUT_JSON=./data.json
 *
 * Cron mensual (día 1 de cada mes a las 9:00):
 *   0 9 1 * * /usr/bin/node /var/scripts/welysis/update.js >> /var/log/welysis.log 2>&1
 */

'use strict';

require('dotenv').config();
const fs         = require('fs');
const { google } = require('googleapis');

const CFG = {
  serviceAccount: process.env.GOOGLE_CREDENTIALS  || './service-account.json',
  spreadsheetId:  process.env.SPREADSHEET_ID,
  outputJson:     process.env.OUTPUT_JSON          || './data.json',
  clientName:     process.env.CLIENT_NAME          || 'welysis',
  period:         process.env.YEAR                 || new Date().getFullYear().toString(),
};

const MONTHS     = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTH_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

function now()        { return new Date().toISOString().slice(0,10); }
function monthLabel() { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function monthFull()  { const d = new Date(); return `${MONTH_FULL[d.getMonth()]} ${d.getFullYear()}`; }
function currentMonthIndex() { return new Date().getMonth(); }

function loadExisting() {
  try   { return JSON.parse(fs.readFileSync(CFG.outputJson, 'utf8')); }
  catch { return null; }
}

function patchMonthly(arr, newValue) {
  const idx = currentMonthIndex();
  const out = arr ? [...arr] : new Array(12).fill(null);
  if (newValue !== null && newValue !== undefined && newValue !== '') {
    out[idx] = typeof newValue === 'string' ? parseFloat(newValue.replace(',','.')) || 0 : newValue;
  }
  return out;
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(',','.'));
  return isNaN(n) ? null : n;
}

/* ══════════════════════════════════════════════════════════════════════════════
   GOOGLE SHEETS
   ══════════════════════════════════════════════════════════════════════════════ */
async function getSheets() {
  const credentials = JSON.parse(fs.readFileSync(CFG.serviceAccount, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readRange(sheets, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.spreadsheetId,
    range,
  });
  return res.data.values || [];
}

/* ── LINKEDIN ────────────────────────────────────────────────────────────────
   Estructura hoja LINKEDIN:
   Fila 1: cabecera (,Ene,Feb,Mar,Abr,May,Jun,Jul,Ago,Sep,Oct,Nov,Dic)
   Fila 2: Seguidores
   Fila 3: Impresiones
   Fila 4: Visitantes
   Fila 5: Visualizaciones
   Fila 6: Reacciones
   Fila 7: Comentarios
*/
async function readLinkedin(sheets, existing) {
  log('Leyendo hoja LINKEDIN...');
  const rows = await readRange(sheets, 'LINKEDIN!A1:M7');

  const kpiNames = ['seguidores','impresiones','visitantes','visualizaciones','reacciones','comentarios'];
  const colors   = ['#f24b3b','#ece4d3','#c8e87a','#ffb84d','#f24b3b','#b8b3aa'];
  const targets  = { seguidores:2000, impresiones:2500, visitantes:100, visualizaciones:100, reacciones:50, comentarios:10 };
  const types    = { seguidores:'anual', impresiones:'mensual', visitantes:'mensual', visualizaciones:'mensual', reacciones:'mensual', comentarios:'mensual' };

  const goals   = {};
  const metrics = {};

  kpiNames.forEach((key, i) => {
    const row = rows[i + 1] || []; // +1 para saltar la cabecera
    const values = new Array(12).fill(null);

    // Columnas 1-12 (índice 0 = nombre KPI, 1-12 = meses)
    for (let m = 0; m < 12; m++) {
      const val = parseNum(row[m + 1]);
      if (val !== null) values[m] = val;
    }

    // Preservar histórico si el Sheets no tiene dato
    const existingVals = existing?.linkedin?.metrics?.[key]?.values || new Array(12).fill(null);
    for (let m = 0; m < 12; m++) {
      if (values[m] === null && existingVals[m] !== null) values[m] = existingVals[m];
    }

    // Último valor disponible = current
    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;

    goals[key]   = { current: lastVal, target: targets[key] };
    if (key === 'posicion_media') goals[key].invert = true;
    metrics[key] = { values, color: colors[i] };
  });

  log(`  → ${kpiNames.length} KPIs de LinkedIn leídos`);
  return { goals, metrics };
}

/* ── SEO ─────────────────────────────────────────────────────────────────────
   Estructura hoja SEO:
   Fila 1: cabecera
   Fila 2: Impresiones orgánicas
   Fila 3: Clics orgánicos
   Fila 4: Posición media
   Fila 5: Formularios enviados
   Fila 6: Eventos interacción
   Fila 7: KW en top 10
*/
async function readSeo(sheets, existing) {
  log('Leyendo hoja SEO...');
  const rows = await readRange(sheets, 'SEO!A1:M7');

  const kpiNames = ['sesiones','clics_organicos','posicion_media','formularios','eventos','keywords_top10'];
  const colors   = ['#c8e87a','#f24b3b','#ffb84d','#ece4d3','#7a9cc8','#ece4d3'];

  const goals   = {};
  const metrics = {};

  kpiNames.forEach((key, i) => {
    const row = rows[i + 1] || [];
    const values = new Array(12).fill(null);

    for (let m = 0; m < 12; m++) {
      const val = parseNum(row[m + 1]);
      if (val !== null) values[m] = val;
    }

    const existingVals = existing?.seo?.metrics?.[key]?.values || new Array(12).fill(null);
    for (let m = 0; m < 12; m++) {
      if (values[m] === null && existingVals[m] !== null) values[m] = existingVals[m];
    }

    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;
    goals[key]   = { current: lastVal };
    if (key === 'posicion_media') goals[key].invert = true;
    metrics[key] = { values, color: colors[i] };
    if (key === 'posicion_media') metrics[key].invert = true;
  });

  log(`  → ${kpiNames.length} KPIs de SEO leídos`);
  return { goals, metrics };
}

/* ── INFORMES ────────────────────────────────────────────────────────────────
   Estructura hoja INFORMES:
   Fila 1: cabecera (MES | INFORME_LINKEDIN | INFORME_SEO)
   Fila 2: vacía/separador
   Fila 3: instrucciones
   Fila 4: separador
   Fila 5: cabecera columnas
   Filas 6-17: un mes por fila (Enero 2026 ... Diciembre 2026)
*/
async function readInformes(sheets) {
  log('Leyendo hoja INFORMES...');
  const rows = await readRange(sheets, 'INFORMES!A6:C17');

  const mesActual = monthFull() + ' ' + CFG.period;
  let linkedin = '';
  let seo = '';

  rows.forEach(row => {
    const mes = (row[0] || '').trim();
    if (mes.toLowerCase() === mesActual.toLowerCase()) {
      linkedin = (row[1] || '').trim();
      seo      = (row[2] || '').trim();
    }
  });

  if (!linkedin && !seo) {
    log('  ⚠ No se encontró informe para ' + mesActual + ' — usando el último disponible');
    // Usar el último que tenga texto
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][1] || rows[i][2]) {
        linkedin = (rows[i][1] || '').trim();
        seo      = (rows[i][2] || '').trim();
        break;
      }
    }
  }

  log(`  → Informe LinkedIn: ${linkedin.length} chars, SEO: ${seo.length} chars`);
  return { linkedin, seo };
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════════════════ */
async function main() {
  log('═══════════════════════════════════════════');
  log('hanson* · Actualizador Dashboard Welysis');
  log('═══════════════════════════════════════════');

  if (!CFG.spreadsheetId) {
    log('ERROR: falta SPREADSHEET_ID en .env');
    process.exit(1);
  }

  const existing = loadExisting();
  log(`JSON existente: ${existing ? 'encontrado' : 'creando desde cero'}`);

  const sheets = await getSheets();

  const [linkedin, seo, informes] = await Promise.all([
    readLinkedin(sheets, existing),
    readSeo(sheets, existing),
    readInformes(sheets),
  ]);

  const data = {
    meta: {
      client:           CFG.clientName,
      period:           CFG.period,
      updated:          now(),
      month_label:      monthLabel(),
      tagline_linkedin: existing?.meta?.tagline_linkedin || 'los números no mienten, pero sí se maquillan*',
      tagline_seo:      existing?.meta?.tagline_seo      || 'google nos quiere, pero hay que currárselo*',
      generated_by:     'hanson-updater v2',
    },
    linkedin: {
      goals:     linkedin.goals,
      metrics:   linkedin.metrics,
      top_posts: existing?.linkedin?.top_posts || [],
    },
    seo: {
      goals:        seo.goals,
      metrics:      seo.metrics,
      top_keywords: existing?.seo?.top_keywords || [],
    },
    informe_ia: {
      linkedin: informes.linkedin,
      seo:      informes.seo,
      generado: new Date().toISOString(),
    },
    projects: existing?.projects || [],
  };

  const output = JSON.stringify(data, null, 2);
  fs.writeFileSync(CFG.outputJson, output, 'utf8');
  log(`✓ ${CFG.outputJson} escrito (${(output.length/1024).toFixed(1)} KB)`);
  log('═══════════════════════════════════════════');
  log('Actualización completada');
}

main().catch(e => {
  console.error('[ERROR FATAL]', e);
  process.exit(1);
});
