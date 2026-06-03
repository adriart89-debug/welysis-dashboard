#!/usr/bin/env node
/**
 * hanson* · actualizador mensual Welysis Dashboard v6
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

const log = msg => console.log('[' + new Date().toISOString() + '] ' + msg);
function now()             { return new Date().toISOString().slice(0,10); }
function monthLabel()      { const d = new Date(); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function currentMonthIdx() { return new Date().getMonth(); }
// Mostrar el mes anterior (el informe se envía un mes después)
function reportMonthIdx()  { const i = currentMonthIdx(); return i === 0 ? 11 : i - 1; }
function reportMonthLabel(){ return MONTHS[reportMonthIdx()] + ' ' + CFG.period; }

function loadExisting() {
  try   { return JSON.parse(fs.readFileSync(CFG.outputJson, 'utf8')); }
  catch { return null; }
}

function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '\u2014') return null;
  const n = parseFloat(String(val).trim().replace(/\./g,'').replace(',','.'));
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
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
  });
  return res.data.values || [];
}

/* ══════════════════════════════════════════════════════════════════════════════
   LINKEDIN — filas 4-9, col A=KPI, B=Objetivo, C..N=Ene..Dic
   ══════════════════════════════════════════════════════════════════════════════ */
async function readLinkedin(sheets) {
  log('Leyendo LINKEDIN...');
  const rows = await readRange(sheets, 'LINKEDIN!A4:N9');

  const keys    = ['seguidores','impresiones','visitantes','visualizaciones','reacciones','comentarios'];
  const colors  = ['#f24b3b','#ece4d3','#c8e87a','#ffb84d','#f24b3b','#b8b3aa'];
  const targets = { seguidores:2000, impresiones:2500, visitantes:100, visualizaciones:100, reacciones:50, comentarios:10 };

  const goals = {}, metrics = {};
  keys.forEach((key, i) => {
    const row    = rows[i] || [];
    const values = [];
    for (let m = 0; m < 12; m++) values.push(parseNum(row[m + 2]));
    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;
    goals[key]   = { current: lastVal, target: targets[key] };
    metrics[key] = { values, color: colors[i] };
  });

  log('  -> LinkedIn OK');
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   SEO — filas 4-9, col A=KPI, B..M=Ene..Dic
   ══════════════════════════════════════════════════════════════════════════════ */
async function readSeo(sheets) {
  log('Leyendo SEO...');
  const rows = await readRange(sheets, 'SEO!A4:M9');

  const keys   = ['impresiones_organicas','clics_organicos','posicion_media','formularios','eventos','keywords_top10'];
  const colors = ['#c8e87a','#f24b3b','#ffb84d','#ece4d3','#7a9cc8','#ece4d3'];

  const goals = {}, metrics = {};
  keys.forEach((key, i) => {
    const row    = rows[i] || [];
    const values = [];
    for (let m = 0; m < 12; m++) values.push(parseNum(row[m + 1]));
    const lastVal = [...values].reverse().find(v => v !== null) ?? 0;
    goals[key]   = { current: lastVal };
    if (key === 'posicion_media') goals[key].invert = true;
    metrics[key] = { values, color: colors[i] };
    if (key === 'posicion_media') metrics[key].invert = true;
  });

  log('  -> SEO OK');
  return { goals, metrics };
}

/* ══════════════════════════════════════════════════════════════════════════════
   INFORMES — nueva estructura:
   Fila 1: cabecera (MES | INFORME_LINKEDIN | INFORME_SEO)
   Filas 2-13: Enero 2026 ... Diciembre 2026 (una por fila, sin combinar)
   ══════════════════════════════════════════════════════════════════════════════ */
async function readInformes(sheets, existing) {
  log('Leyendo INFORMES...');

  // Leer filas 2-13 (los 12 meses)
  const rows = await readRange(sheets, 'INFORMES!A2:C13');

  log('  -> Filas recibidas: ' + rows.length);

  const todos = {};
  rows.forEach((row, i) => {
    const mesCorto = MONTHS[i];
    const liText   = (row[1] || '').trim();
    const seoText  = (row[2] || '').trim();
    const mesCell  = (row[0] || '').trim();
    log('  Mes ' + mesCorto + ' (' + mesCell + '): LinkedIn=' + liText.length + ' chars, SEO=' + seoText.length + ' chars');
    todos[mesCorto] = { linkedin: liText, seo: seoText };
  });

  // Usar el mes anterior como mes de reporte
  const reportIdx   = reportMonthIdx();
  const reportMonth = MONTHS[reportIdx];
  let actual = todos[reportMonth] || { linkedin: '', seo: '' };

  // Fallback: último mes con texto
  if (!actual.linkedin && !actual.seo) {
    for (let i = reportIdx; i >= 0; i--) {
      const m = todos[MONTHS[i]];
      if (m && (m.linkedin || m.seo)) {
        actual = m;
        log('  -> Fallback al mes ' + MONTHS[i]);
        break;
      }
    }
  }

  // Fallback final: existing
  if (!actual.linkedin) actual.linkedin = existing?.informe_ia?.linkedin || '';
  if (!actual.seo)      actual.seo      = existing?.informe_ia?.seo      || '';

  log('  -> Informe de reporte (' + reportMonth + '): LinkedIn ' + actual.linkedin.length + ' chars, SEO ' + actual.seo.length + ' chars');
  return { actual, todos };
}

/* ══════════════════════════════════════════════════════════════════════════════
   HISTÓRICO MENSUAL
   ══════════════════════════════════════════════════════════════════════════════ */
function buildHistorico(linkedin, seo, informes) {
  const historico = {};

  MONTHS.forEach((mes, idx) => {
    const label = mes + ' ' + CFG.period;

    const tieneLinkedin = Object.values(linkedin.metrics).some(m => m.values[idx] !== null);
    const tieneSeo      = Object.values(seo.metrics).some(m => m.values[idx] !== null);
    if (!tieneLinkedin && !tieneSeo) return;

    const liGoals = {}, seoGoals = {}, liMetrics = {}, seoMetrics = {};

    Object.keys(linkedin.goals).forEach(key => {
      const val = linkedin.metrics[key]?.values[idx];
      liGoals[key]   = Object.assign({}, linkedin.goals[key], { current: val !== null && val !== undefined ? val : 0 });
      liMetrics[key] = Object.assign({}, linkedin.metrics[key]);
    });

    Object.keys(seo.goals).forEach(key => {
      const val = seo.metrics[key]?.values[idx];
      seoGoals[key]   = Object.assign({}, seo.goals[key], { current: val !== null && val !== undefined ? val : 0 });
      seoMetrics[key] = Object.assign({}, seo.metrics[key]);
    });

    const informe = informes.todos[mes] || { linkedin: '', seo: '' };

    historico[mes] = {
      label,
      linkedin:   { goals: liGoals,  metrics: liMetrics  },
      seo:        { goals: seoGoals, metrics: seoMetrics },
      informe_ia: { linkedin: informe.linkedin, seo: informe.seo, generado: now() },
    };
  });

  return historico;
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════════════════ */
async function main() {
  log('===========================================');
  log('hanson* · Actualizador Dashboard Welysis v6');
  log('===========================================');

  if (!CFG.spreadsheetId) { log('ERROR: falta SPREADSHEET_ID'); process.exit(1); }

  const existing = loadExisting();
  log('JSON existente: ' + (existing ? 'encontrado' : 'creando desde cero'));

  const sheets = await getSheets();

  const linkedin = await readLinkedin(sheets);
  const seo      = await readSeo(sheets);
  const informes = await readInformes(sheets, existing);

  const historico  = buildHistorico(linkedin, seo, informes);
  const reportMes  = MONTHS[reportMonthIdx()];

  const data = {
    meta: {
      client:           CFG.clientName,
      period:           CFG.period,
      updated:          now(),
      month_label:      reportMonthLabel(),
      month_current:    reportMes,
      tagline_linkedin: existing?.meta?.tagline_linkedin || 'los numeros no mienten, pero si se maquillan*',
      tagline_seo:      existing?.meta?.tagline_seo      || 'google nos quiere, pero hay que currarselo*',
      generated_by:     'hanson-updater v6',
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
      linkedin: informes.actual.linkedin,
      seo:      informes.actual.seo,
      generado: new Date().toISOString(),
    },
    historico,
    projects: [],
  };

  const output = JSON.stringify(data, null, 2);
  fs.writeFileSync(CFG.outputJson, output, 'utf8');
  log('OK: ' + CFG.outputJson + ' (' + (output.length/1024).toFixed(1) + ' KB)');
  log('Meses en historico: ' + Object.keys(historico).join(', '));
  log('Mes de reporte: ' + reportMes);
  log('Completado.');
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
