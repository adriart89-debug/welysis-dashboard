#!/usr/bin/env node
/**
 * hanson* · actualizador mensual Welysis Dashboard v3
 * Lee desde Google Sheets y genera data.json
 */
'use strict';

require('dotenv').config();
const fs         = require('fs');
const { google } = require('googleapis');

const CFG = {
  serviceAccount: process.env.GOOGLE_CREDENTIALS || './service-account.json',
  spreadsheetId:  process.env.SPREADSHEET_ID,
  outputJson:     process.env.OUTPUT_JSON        || './data.json',
  clientName:     process.env.CLIENT_NAME        || 'welysis',
  period:         process.env.YEAR               || new Date().getFullYear().toString(),
};

const MONTHS     = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTH_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);
function now()             { return new Date().toISOString().slice(0,10); }
function monthLabel()      { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function monthFullLabel()  { const d = new Date(); return `${MONTH_FULL[d.getMonth()]} ${d.getFullYear()}`; }
function currentMonthIdx() { return new Date().getMonth(); }

function loadExisting() {
  try   { return JSON.parse(fs.readFileSync(CFG.outputJson, 'utf8')); }
  catch { return null; }
}

function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '—') return null;
  const n = parseFloat(String(val).replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? null : n;
}

function mergeHistory(newVals, existing) {
  const out = existing ? [...existing] : new Array(12).fill(null);
  newVals.forEach((v, i) => { if (v !== null) out[i] = v; });
  return out;
}

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

/* ══════════════════════════════════════════════════════════════════════════════
   LINKEDIN
   Estructura real del Sheets (hoja LINKEDIN):
   Fila 1: título
   Fila 2: separador rojo
   Fila 3: cabecera (KPI | OBJETIVO | Ene | Feb | ... | Dic | MEDIA | VS OBJ)
   Fila 4: Seguidores
   Fila 5: Impresiones
   Fila 6: Visitantes
   Fila 7: Visualizaciones
   Fila 8: Reacciones
   Fila 9: Comentarios
   ══════════════════════════════════════════════════════════════════════════════ */
async function readLinkedin(sheets, existing) {
  log('Leyendo LINKEDIN...');

  // Leemos filas 4-9, columnas A-N (KPI, Objetivo, Ene..Dic, Media, VsObj)
  const rows = await readRange(sheets, 'LINKEDIN!A4:N9');

  const keys    = ['seguidores','impresiones','visitantes','visualizaciones','reacciones','comentarios'];
  const colors  = ['#f24b3b','#ece4d3','#c8e87a','#ffb84d','#f24b3b','#b8b3aa'];
  const targets = { seguidores:2000, impresiones:2500, visitantes:100, visualizaciones:100, reacciones:50, comentarios:10 };
  const types   = { seguidores:'anual', impresiones:'mensual', visitantes:'mensual', visualizaciones:'mensual', reacciones:'mensual', comentarios:'mensual' };

  const goals   = {};
  const metrics = {};

  keys.forEach((key, i) => {
    const row = rows[i] || [];
    // col 0 = nombre KPI, col 1 = objetivo, col 2..13 = Ene..Dic
    const values = [];
    for (let m = 0; m < 12; m++) {
      values.push(parseNum(row[m + 2]));
    }

    const merged  = mergeHistory(values, existing?.linkedin?.metrics?.[key]?.values);
    const lastVal = [...merged].reverse().find(v => v !== null) ?? 0;

    goals[key]   = { current: lastVal, target: targets[key] };
    if (types[key] === 'anual') goals[key].tipo = 'anual';
    metrics[key] = { values: merged, color: colors[i] };
  });

  log(`  → LinkedIn OK`);
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   SEO
   Estructura real del Sheets (hoja SEO):
   Fila 1: título
   Fila 2: separador rojo
   Fila 3: cabecera (KPI | Ene | Feb | ... | Dic | MEDIA | TENDENCIA)
   Fila 4: Impresiones orgánicas
   Fila 5: Clics orgánicos
   Fila 6: Posición media
   Fila 7: Formularios enviados
   Fila 8: Eventos interacción
   Fila 9: KW en top 10
   ══════════════════════════════════════════════════════════════════════════════ */
async function readSeo(sheets, existing) {
  log('Leyendo SEO...');

  // Filas 4-9, columnas A-M (KPI, Ene..Dic, Media, Tendencia)
  const rows = await readRange(sheets, 'SEO!A4:M9');

  const keys   = ['impresiones_organicas','clics_organicos','posicion_media','formularios','eventos','keywords_top10'];
  const colors = ['#c8e87a','#f24b3b','#ffb84d','#ece4d3','#7a9cc8','#ece4d3'];
  const pretty = {
    impresiones_organicas: 'impresiones orgánicas',
    clics_organicos:       'clics orgánicos',
    posicion_media:        'posición media',
    formularios:           'formularios',
    eventos:               'eventos interacción',
    keywords_top10:        'keywords top 10',
  };

  const goals   = {};
  const metrics = {};

  keys.forEach((key, i) => {
    const row = rows[i] || [];
    // col 0 = nombre KPI, col 1..12 = Ene..Dic
    const values = [];
    for (let m = 0; m < 12; m++) {
      values.push(parseNum(row[m + 1]));
    }

    const merged  = mergeHistory(values, existing?.seo?.metrics?.[key]?.values);
    const lastVal = [...merged].reverse().find(v => v !== null) ?? 0;

    // SEO no tiene targets
    goals[key]   = { current: lastVal };
    if (key === 'posicion_media') goals[key].invert = true;
    metrics[key] = { values: merged, color: colors[i] };
    if (key === 'posicion_media') metrics[key].invert = true;
  });

  log(`  → SEO OK`);
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   INFORMES
   Estructura real del Sheets (hoja INFORMES):
   Fila 1: título
   Fila 2: separador
   Fila 3: instrucciones
   Fila 4: separador
   Fila 5: cabecera (MES | INFORME_LINKEDIN | INFORME_SEO)
   Filas 6-17: Enero 2026 ... Diciembre 2026
   ══════════════════════════════════════════════════════════════════════════════ */
async function readInformes(sheets, existing) {
  log('Leyendo INFORMES...');

  const rows = await readRange(sheets, 'INFORMES!A6:C17');
  const mesActual = `${MONTH_FULL[new Date().getMonth()]} ${CFG.period}`;

  let linkedin = '';
  let seo      = '';

  for (const row of rows) {
    const mes = (row[0] || '').trim();
    if (mes.toLowerCase() === mesActual.toLowerCase()) {
      linkedin = (row[1] || '').trim();
      seo      = (row[2] || '').trim();
      break;
    }
  }

  // Si no hay informe para este mes, usar el último disponible
  if (!linkedin && !seo) {
    log(`  ⚠ Sin informe para ${mesActual}, usando el último disponible`);
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.[1] || rows[i]?.[2]) {
        linkedin = (rows[i][1] || '').trim();
        seo      = (rows[i][2] || '').trim();
        break;
      }
    }
  }

  // Fallback: usar los del data.json existente
  if (!linkedin) linkedin = existing?.informe_ia?.linkedin || '';
  if (!seo)      seo      = existing?.informe_ia?.seo      || '';

  log(`  → LinkedIn: ${linkedin.length} chars, SEO: ${seo.length} chars`);
  return { linkedin, seo };
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════════════════ */
async function main() {
  log('═══════════════════════════════════════════');
  log('hanson* · Actualizador Dashboard Welysis v3');
  log('═══════════════════════════════════════════');

  if (!CFG.spreadsheetId) { log('ERROR: falta SPREADSHEET_ID'); process.exit(1); }

  const existing = loadExisting();
  log(`JSON existente: ${existing ? 'encontrado' : 'creando desde cero'}`);

  const sheets = await getSheets();
  const [linkedin, seo, informes] = await Promise.all([
    readLinkedin(sheets, existing),
    readSeo(sheets, existing),
    readInformes(sheets, existing),
  ]);

  const data = {
    meta: {
      client:           CFG.clientName,
      period:           CFG.period,
      updated:          now(),
      month_label:      monthLabel(),
      tagline_linkedin: existing?.meta?.tagline_linkedin || 'los números no mienten, pero sí se maquillan*',
      tagline_seo:      existing?.meta?.tagline_seo      || 'google nos quiere, pero hay que currárselo*',
      generated_by:     'hanson-updater v3',
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
    projects: [],
  };

  const output = JSON.stringify(data, null, 2);
  fs.writeFileSync(CFG.outputJson, output, 'utf8');
  log(`✓ ${CFG.outputJson} actualizado (${(output.length/1024).toFixed(1)} KB)`);
  log('Completado.');
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
