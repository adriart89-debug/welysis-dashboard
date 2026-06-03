#!/usr/bin/env node
/**
 * hanson* · actualizador mensual Welysis Dashboard v4
 * Lee histórico completo desde Google Sheets y genera data.json
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
function now()            { return new Date().toISOString().slice(0,10); }
function monthLabel()     { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function currentMonthIdx(){ return new Date().getMonth(); }

function loadExisting() {
  try   { return JSON.parse(fs.readFileSync(CFG.outputJson, 'utf8')); }
  catch { return null; }
}

function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '—') return null;
  const s = String(val).trim();
  // Formato español: 1.036 = mil, 1,5 = decimal
  const n = parseFloat(s.replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? null : n;
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
   LINKEDIN — lee filas 4-9, columnas A-N
   Col 0=KPI, Col 1=Objetivo, Col 2..13=Ene..Dic
   ══════════════════════════════════════════════════════════════════════════════ */
async function readLinkedin(sheets) {
  log('Leyendo LINKEDIN...');
  const rows = await readRange(sheets, 'LINKEDIN!A4:N9');

  const keys    = ['seguidores','impresiones','visitantes','visualizaciones','reacciones','comentarios'];
  const colors  = ['#f24b3b','#ece4d3','#c8e87a','#ffb84d','#f24b3b','#b8b3aa'];
  const targets = { seguidores:2000, impresiones:2500, visitantes:100, visualizaciones:100, reacciones:50, comentarios:10 };

  const goals   = {};
  const metrics = {};

  keys.forEach((key, i) => {
    const row    = rows[i] || [];
    const values = [];
    for (let m = 0; m < 12; m++) {
      values.push(parseNum(row[m + 2]));
    }
    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;
    goals[key]   = { current: lastVal, target: targets[key] };
    metrics[key] = { values, color: colors[i] };
  });

  log('  → LinkedIn OK');
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   SEO — lee filas 4-9, columnas A-M
   Col 0=KPI, Col 1..12=Ene..Dic
   ══════════════════════════════════════════════════════════════════════════════ */
async function readSeo(sheets) {
  log('Leyendo SEO...');
  const rows = await readRange(sheets, 'SEO!A4:M9');

  const keys   = ['impresiones_organicas','clics_organicos','posicion_media','formularios','eventos','keywords_top10'];
  const colors = ['#c8e87a','#f24b3b','#ffb84d','#ece4d3','#7a9cc8','#ece4d3'];

  const goals   = {};
  const metrics = {};

  keys.forEach((key, i) => {
    const row    = rows[i] || [];
    const values = [];
    for (let m = 0; m < 12; m++) {
      values.push(parseNum(row[m + 1]));
    }
    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;
    goals[key]   = { current: lastVal };
    if (key === 'posicion_media') { goals[key].invert = true; }
    metrics[key] = { values, color: colors[i] };
    if (key === 'posicion_media') { metrics[key].invert = true; }
  });

  log('  → SEO OK');
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   INFORMES — lee filas 6-17 (Enero..Diciembre)
   Col 0=MES, Col 1=INFORME_LINKEDIN, Col 2=INFORME_SEO
   ══════════════════════════════════════════════════════════════════════════════ */
async function readInformes(sheets, existing) {
  log('Leyendo INFORMES...');
  const rows = await readRange(sheets, 'INFORMES!A6:C17');

  // Construir objeto con todos los meses: { "Enero 2026": { linkedin, seo }, ... }
  const todos = {};
  rows.forEach(row => {
    const mes = (row[0] || '').trim();
    if (!mes) return;
    todos[mes] = {
      linkedin: (row[1] || '').trim(),
      seo:      (row[2] || '').trim(),
    };
  });

  // Informe del mes actual
  const mesActual = `${MONTH_FULL[currentMonthIdx()]} ${CFG.period}`;
  const actual = todos[mesActual] || { linkedin: '', seo: '' };

  // Fallback: último mes con texto si el actual está vacío
  if (!actual.linkedin && !actual.seo) {
    for (const mes of Object.keys(todos).reverse()) {
      if (todos[mes].linkedin || todos[mes].seo) {
        actual.linkedin = todos[mes].linkedin;
        actual.seo      = todos[mes].seo;
        break;
      }
    }
  }

  // Fallback final: usar existing
  if (!actual.linkedin) actual.linkedin = existing?.informe_ia?.linkedin || '';
  if (!actual.seo)      actual.seo      = existing?.informe_ia?.seo      || '';

  log(`  → ${Object.keys(todos).length} meses en INFORMES`);
  log(`  → Mes actual (${mesActual}): LinkedIn ${actual.linkedin.length} chars, SEO ${actual.seo.length} chars`);

  return { actual, todos };
}

/* ══════════════════════════════════════════════════════════════════════════════
   CONSTRUIR HISTÓRICO MENSUAL
   Para cada mes con datos, construir el snapshot completo
   ══════════════════════════════════════════════════════════════════════════════ */
function buildHistorico(linkedin, seo, informes) {
  const historico = {};

  MONTHS.forEach((mes, idx) => {
    const label = `${mes} ${CFG.period}`;
    const labelFull = `${MONTH_FULL[idx]} ${CFG.period}`;

    // Comprobar si hay algún dato para este mes
    const tieneLinkedin = Object.values(linkedin.metrics).some(m => m.values[idx] !== null);
    const tieneSeo      = Object.values(seo.metrics).some(m => m.values[idx] !== null);

    if (!tieneLinkedin && !tieneSeo) return; // mes sin datos, no incluir

    // Snapshot de goals para este mes
    const liGoals   = {};
    const seoGoals  = {};
    const liMetrics = {};
    const seoMetrics= {};

    Object.keys(linkedin.goals).forEach(key => {
      const val = linkedin.metrics[key]?.values[idx];
      liGoals[key]   = { ...linkedin.goals[key], current: val !== null ? val : 0 };
      liMetrics[key] = { ...linkedin.metrics[key] };
    });

    Object.keys(seo.goals).forEach(key => {
      const val = seo.metrics[key]?.values[idx];
      seoGoals[key]   = { ...seo.goals[key], current: val !== null ? val : 0 };
      seoMetrics[key] = { ...seo.metrics[key] };
    });

    const informe = informes.todos[labelFull] || { linkedin: '', seo: '' };

    historico[mes] = {
      label,
      linkedin: { goals: liGoals, metrics: liMetrics },
      seo:      { goals: seoGoals, metrics: seoMetrics },
      informe_ia: {
        linkedin: informe.linkedin,
        seo:      informe.seo,
        generado: now(),
      },
    };
  });

  return historico;
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════════════════ */
async function main() {
  log('═══════════════════════════════════════════');
  log('hanson* · Actualizador Dashboard Welysis v4');
  log('═══════════════════════════════════════════');

  if (!CFG.spreadsheetId) { log('ERROR: falta SPREADSHEET_ID'); process.exit(1); }

  const existing = loadExisting();
  log(`JSON existente: ${existing ? 'encontrado' : 'creando desde cero'}`);

  const sheets = await getSheets();
  const [linkedin, seo, informes] = await Promise.all([
    readLinkedin(sheets),
    readSeo(sheets),
    readInformes(sheets, existing),
  ]);

  const historico = buildHistorico(linkedin, seo, informes);
  const mesActual = MONTHS[currentMonthIdx()];

  const data = {
    meta: {
      client:           CFG.clientName,
      period:           CFG.period,
      updated:          now(),
      month_label:      monthLabel(),
      month_current:    mesActual,
      tagline_linkedin: existing?.meta?.tagline_linkedin || 'los números no mienten, pero sí se maquillan*',
      tagline_seo:      existing?.meta?.tagline_seo      || 'google nos quiere, pero hay que currárselo*',
      generated_by:     'hanson-updater v4',
    },
    // Datos del mes actual (compatibilidad con el dashboard)
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
      linkedin: informes.actual.linkedin,
      seo:      informes.actual.seo,
      generado: new Date().toISOString(),
    },
    // Histórico completo por mes
    historico,
    projects: [],
  };

  const output = JSON.stringify(data, null, 2);
  fs.writeFileSync(CFG.outputJson, output, 'utf8');
  log(`✓ ${CFG.outputJson} actualizado (${(output.length/1024).toFixed(1)} KB)`);
  log(`  → ${Object.keys(historico).length} meses en histórico`);
  log('Completado.');
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
