#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  hanson* · actualizador mensual Welysis Dashboard   ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Qué hace este script:
 *  1. Lee KPIs desde Google Sheets
 *  2. Lee datos de Metricool (CSV exportado o JSON manual)
 *  3. Lee informe SEO (CSV del proveedor)
 *  4. Genera un informe descriptivo con la Claude API
 *  5. Escribe data.json actualizado
 *
 * Uso:
 *   node update.js
 *
 * Instalación de dependencias:
 *   npm install @anthropic-ai/sdk googleapis csv-parse dotenv
 *
 * Variables de entorno requeridas (archivo .env):
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json
 *   SPREADSHEET_ID=1VfG_84-P0XRmJF0cwwQIqQ_1vLlcUAad-HD5cjtlcBM
 *   METRICOOL_CSV=./data-sources/metricool-export.csv
 *   SEO_CSV=./data-sources/seo-report.csv
 *   OUTPUT_JSON=./data.json
 *
 * Cron mensual (ejecutar el primer día de cada mes a las 9:00):
 *   0 9 1 * * /usr/bin/node /var/www/dashboard/update.js >> /var/log/dashboard-update.log 2>&1
 */

'use strict';

require('dotenv').config();
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');
const { parse } = require('csv-parse/sync');

/* ══════════════════════════════════════════════
   CONFIG
   ══════════════════════════════════════════════ */
const CFG = {
  anthropicKey:    process.env.ANTHROPIC_API_KEY,
  serviceAccount:  process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json',
  spreadsheetId:   process.env.SPREADSHEET_ID,
  metricoolCsv:    process.env.METRICOOL_CSV || './data-sources/metricool-export.csv',
  seoCsv:          process.env.SEO_CSV       || './data-sources/seo-report.csv',
  outputJson:      process.env.OUTPUT_JSON   || './data.json',
  clientName:      process.env.CLIENT_NAME   || 'welysis',
  period:          process.env.YEAR          || new Date().getFullYear().toString(),
};

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

function now() {
  return new Date().toISOString().slice(0,10);
}

function monthLabel() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function currentMonthIndex() {
  return new Date().getMonth(); // 0–11
}

/** Lee el JSON existente o devuelve estructura vacía */
function loadExisting() {
  try {
    const raw = fs.readFileSync(CFG.outputJson, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Actualiza un array de 12 valores en el índice del mes actual */
function patchMonthly(arr, newValue) {
  const idx = currentMonthIndex();
  const out = arr ? [...arr] : new Array(12).fill(null);
  out[idx] = newValue;
  return out;
}

/* ══════════════════════════════════════════════
   1. GOOGLE SHEETS — leer KPIs
   ══════════════════════════════════════════════ */
async function readSheets() {
  log('Leyendo Google Sheets...');

  const auth = new google.auth.GoogleAuth({
    keyFile: CFG.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  /**
   * Estructura esperada de la hoja "KPIs":
   *
   * | Métrica           | Valor | Objetivo |
   * |-------------------|-------|----------|
   * | seguidores        | 1361  | 2500     |
   * | impresiones       | 1444  | 5000     |
   * | visitantes        | 48    | 200      |
   * | visualizaciones   | 109   | 500      |
   * | reacciones        | 28    | 120      |
   * | comentarios       | 1     | 25       |
   * | sesiones          | 478   | 2000     |
   * | posicion_media    | 31    | 10       |
   * | backlinks         | 24    | 80       |
   * | keywords_top10    | 11    | 50       |
   */
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.spreadsheetId,
    range: 'KPIs!A2:C20',
  });

  const rows = res.data.values || [];
  const parsed = {};
  rows.forEach(([metric, val, target]) => {
    if (!metric) return;
    const key = metric.toLowerCase().trim().replace(/\s+/g,'_');
    parsed[key] = {
      current: parseFloat(String(val).replace(',','.')) || 0,
      target:  parseFloat(String(target).replace(',','.')) || 0,
    };
  });

  log(`  → ${Object.keys(parsed).length} KPIs leídos`);
  return parsed;
}

/* ══════════════════════════════════════════════
   2. METRICOOL CSV — datos LinkedIn
   ══════════════════════════════════════════════ */
function readMetricool() {
  log('Leyendo CSV Metricool...');

  /**
   * Formato CSV Metricool (exportación estándar):
   * Date,Followers,Impressions,Profile Visits,Video Views,Reactions,Comments
   * 2026-03-01,1361,1444,48,109,28,1
   *
   * Solo usamos la fila del mes actual (o el acumulado si hay múltiples).
   */
  let raw;
  try {
    raw = fs.readFileSync(CFG.metricoolCsv, 'utf8');
  } catch {
    log('  ⚠ No se encontró metricool-export.csv — usando valores dummy');
    return null;
  }

  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  if (!rows.length) return null;

  // Tomar la última fila como dato del mes
  const row = rows[rows.length - 1];

  const result = {
    seguidores:      parseInt(row['Followers']     || row['seguidores']      || 0),
    impresiones:     parseInt(row['Impressions']   || row['impresiones']     || 0),
    visitantes:      parseInt(row['Profile Visits']|| row['visitantes']      || 0),
    visualizaciones: parseInt(row['Video Views']   || row['visualizaciones'] || 0),
    reacciones:      parseInt(row['Reactions']     || row['reacciones']      || 0),
    comentarios:     parseInt(row['Comments']      || row['comentarios']     || 0),
  };

  log(`  → seguidores: ${result.seguidores}, impresiones: ${result.impresiones}`);
  return result;
}

/* ══════════════════════════════════════════════
   3. SEO CSV — informe proveedor
   ══════════════════════════════════════════════ */
function readSeoReport() {
  log('Leyendo CSV SEO...');

  /**
   * Formato CSV del proveedor SEO:
   * Métrica,Valor
   * sesiones,478
   * posicion_media,31
   * backlinks,24
   * keywords_top10,11
   *
   * También puede incluir una sección de keywords:
   * keyword,position,volume
   * chlor-alkali plant modular,4,210
   */
  let raw;
  try {
    raw = fs.readFileSync(CFG.seoCsv, 'utf8');
  } catch {
    log('  ⚠ No se encontró seo-report.csv — usando valores del Sheets');
    return null;
  }

  const lines = raw.trim().split('\n');
  const metrics = {};
  const keywords = [];
  let inKeywords = false;

  lines.forEach(line => {
    if (line.toLowerCase().startsWith('keyword,')) { inKeywords = true; return; }
    if (inKeywords) {
      const [kw, pos, vol] = line.split(',').map(s => s.trim());
      if (kw) keywords.push({ keyword: kw, position: parseInt(pos)||0, volume: parseInt(vol)||0 });
    } else {
      const [metric, val] = line.split(',').map(s => s.trim());
      if (metric && val) metrics[metric.toLowerCase()] = parseFloat(val.replace(',','.'));
    }
  });

  log(`  → ${Object.keys(metrics).length} métricas SEO, ${keywords.length} keywords`);
  return { metrics, keywords };
}

/* ══════════════════════════════════════════════
   4. CLAUDE API — informe descriptivo
   ══════════════════════════════════════════════ */
async function generateInforme(data, area) {
  log(`Generando informe IA para ${area}...`);
  const client = new Anthropic({ apiKey: CFG.anthropicKey });

  const isRrss = area === 'linkedin';
  const metrics = isRrss ? data.linkedin : data.seo;
  const goals   = isRrss ? data.linkedin.goals : data.seo.goals;

  const prompt = isRrss
    ? `Actúas como social media manager senior especializado en LinkedIn B2B para clientes industriales.

Analiza los siguientes datos de LinkedIn para el cliente Welysis Industries (fabricante de plantas de electrólisis cloro-álcali modulares, modelos ONE/CORE/MAX):

MÉTRICAS DEL MES (${data.meta.month_label}):
- Seguidores: ${metrics.goals?.seguidores?.current} (objetivo: ${metrics.goals?.seguidores?.target})
- Impresiones: ${metrics.goals?.impresiones?.current} (objetivo: ${metrics.goals?.impresiones?.target})
- Visitantes al perfil: ${metrics.goals?.visitantes?.current} (objetivo: ${metrics.goals?.visitantes?.target})
- Visualizaciones de vídeo: ${metrics.goals?.visualizaciones?.current} (objetivo: ${metrics.goals?.visualizaciones?.target})
- Reacciones: ${metrics.goals?.reacciones?.current} (objetivo: ${metrics.goals?.reacciones?.target})
- Comentarios: ${metrics.goals?.comentarios?.current} (objetivo: ${metrics.goals?.comentarios?.target})

HISTÓRICO (últimos 3 meses con datos):
${Object.entries(metrics.metrics||{}).map(([k,m]) => {
  const vals = (m.values||[]).filter(v=>v!==null);
  return `- ${k}: ${vals.slice(-3).join(' → ')}`;
}).join('\n')}

Escribe un análisis conciso de 3 párrafos (sin títulos) en español, tono profesional B2B, sin emojis. Usa **negrita** solo para cifras o conclusiones clave. Incluye: qué ha ido bien, qué necesita atención, y una recomendación concreta para el siguiente mes.`
    : `Actúas como consultor SEO senior especializado en posicionamiento web para empresas B2B industriales.

Analiza los siguientes datos SEO para el cliente Welysis Industries (fabricante de plantas de electrólisis cloro-álcali modulares):

MÉTRICAS DEL MES (${data.meta.month_label}):
- Sesiones orgánicas: ${data.seo.goals?.sesiones?.current} (objetivo: ${data.seo.goals?.sesiones?.target})
- Posición media: ${data.seo.goals?.posicion_media?.current} (objetivo: ${data.seo.goals?.posicion_media?.target}, lower is better)
- Backlinks: ${data.seo.goals?.backlinks?.current} (objetivo: ${data.seo.goals?.backlinks?.target})
- Keywords top 10: ${data.seo.goals?.keywords_top10?.current} (objetivo: ${data.seo.goals?.keywords_top10?.target})

HISTÓRICO (últimos 3 meses con datos):
${Object.entries(data.seo.metrics||{}).map(([k,m]) => {
  const vals = (m.values||[]).filter(v=>v!==null);
  return `- ${k}: ${vals.slice(-3).join(' → ')}`;
}).join('\n')}

Escribe un análisis conciso de 3 párrafos (sin títulos) en español, tono profesional B2B, sin emojis. Usa **negrita** solo para cifras o conclusiones clave. Incluye: tendencias positivas, riesgos o cuellos de botella, y prioridad técnica para el siguiente mes.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0]?.text || '';
    log(`  → ${text.length} caracteres generados`);
    return text;
  } catch(e) {
    log(`  ⚠ Error en Claude API: ${e.message}`);
    return `Análisis no disponible. Error al conectar con la API. (${e.message})`;
  }
}

/* ══════════════════════════════════════════════
   5. ENSAMBLAR Y ESCRIBIR data.json
   ══════════════════════════════════════════════ */
async function main() {
  log('═══════════════════════════════════════════');
  log('hanson* · Actualizador Dashboard Welysis');
  log('═══════════════════════════════════════════');

  // Cargar JSON existente para mantener histórico
  const existing = loadExisting();
  log(`JSON existente: ${existing ? 'encontrado' : 'no encontrado — creando desde cero'}`);

  // Función helper para obtener array histórico existente
  const existingMetric = (area, key) =>
    existing?.[area]?.metrics?.[key]?.values || new Array(12).fill(null);

  // ── 1. Sheets
  let sheetsData = null;
  if (CFG.spreadsheetId && CFG.anthropicKey) {
    try { sheetsData = await readSheets(); }
    catch(e) { log(`⚠ Error leyendo Sheets: ${e.message}`); }
  } else {
    log('⚠ Sin SPREADSHEET_ID configurado — saltando Sheets');
  }

  // ── 2. Metricool
  const metricoolData = readMetricool();

  // ── 3. SEO
  const seoData = readSeoReport();

  // ── Construir goals LinkedIn
  const liGoals = {
    seguidores:      { current: metricoolData?.seguidores      ?? sheetsData?.seguidores?.current      ?? existing?.linkedin?.goals?.seguidores?.current      ?? 0, target: sheetsData?.seguidores?.target ?? existing?.linkedin?.goals?.seguidores?.target ?? 2500 },
    impresiones:     { current: metricoolData?.impresiones     ?? sheetsData?.impresiones?.current     ?? existing?.linkedin?.goals?.impresiones?.current     ?? 0, target: sheetsData?.impresiones?.target ?? existing?.linkedin?.goals?.impresiones?.target ?? 5000 },
    visitantes:      { current: metricoolData?.visitantes      ?? sheetsData?.visitantes?.current      ?? existing?.linkedin?.goals?.visitantes?.current      ?? 0, target: sheetsData?.visitantes?.target ?? existing?.linkedin?.goals?.visitantes?.target ?? 200 },
    visualizaciones: { current: metricoolData?.visualizaciones ?? sheetsData?.visualizaciones?.current ?? existing?.linkedin?.goals?.visualizaciones?.current ?? 0, target: sheetsData?.visualizaciones?.target ?? existing?.linkedin?.goals?.visualizaciones?.target ?? 500 },
    reacciones:      { current: metricoolData?.reacciones      ?? sheetsData?.reacciones?.current      ?? existing?.linkedin?.goals?.reacciones?.current      ?? 0, target: sheetsData?.reacciones?.target ?? existing?.linkedin?.goals?.reacciones?.target ?? 120 },
    comentarios:     { current: metricoolData?.comentarios     ?? sheetsData?.comentarios?.current     ?? existing?.linkedin?.goals?.comentarios?.current     ?? 0, target: sheetsData?.comentarios?.target ?? existing?.linkedin?.goals?.comentarios?.target ?? 25 },
  };

  // ── Construir goals SEO
  const seoGoals = {
    sesiones:       { current: seoData?.metrics?.sesiones       ?? sheetsData?.sesiones?.current       ?? existing?.seo?.goals?.sesiones?.current       ?? 0, target: sheetsData?.sesiones?.target ?? existing?.seo?.goals?.sesiones?.target ?? 2000 },
    posicion_media: { current: seoData?.metrics?.posicion_media ?? sheetsData?.posicion_media?.current ?? existing?.seo?.goals?.posicion_media?.current ?? 0, target: sheetsData?.posicion_media?.target ?? existing?.seo?.goals?.posicion_media?.target ?? 10, invert: true },
    backlinks:      { current: seoData?.metrics?.backlinks      ?? sheetsData?.backlinks?.current      ?? existing?.seo?.goals?.backlinks?.current      ?? 0, target: sheetsData?.backlinks?.target ?? existing?.seo?.goals?.backlinks?.target ?? 80 },
    keywords_top10: { current: seoData?.metrics?.keywords_top10 ?? sheetsData?.keywords_top10?.current ?? existing?.seo?.goals?.keywords_top10?.current ?? 0, target: sheetsData?.keywords_top10?.target ?? existing?.seo?.goals?.keywords_top10?.target ?? 50 },
  };

  // ── Actualizar métricas históricas (patchear mes actual)
  const liMetrics = {
    seguidores:      { values: patchMonthly(existingMetric('linkedin','seguidores'),      liGoals.seguidores.current),      color: '#f24b3b' },
    impresiones:     { values: patchMonthly(existingMetric('linkedin','impresiones'),     liGoals.impresiones.current),     color: '#ece4d3' },
    visitantes:      { values: patchMonthly(existingMetric('linkedin','visitantes'),      liGoals.visitantes.current),      color: '#c8e87a' },
    visualizaciones: { values: patchMonthly(existingMetric('linkedin','visualizaciones'), liGoals.visualizaciones.current), color: '#ffb84d' },
    reacciones:      { values: patchMonthly(existingMetric('linkedin','reacciones'),      liGoals.reacciones.current),      color: '#f24b3b' },
    comentarios:     { values: patchMonthly(existingMetric('linkedin','comentarios'),     liGoals.comentarios.current),     color: '#b8b3aa' },
  };

  const seoMetrics = {
    sesiones:       { values: patchMonthly(existingMetric('seo','sesiones'),       seoGoals.sesiones.current),       color: '#c8e87a' },
    posicion_media: { values: patchMonthly(existingMetric('seo','posicion_media'), seoGoals.posicion_media.current), color: '#ffb84d', invert: true },
    backlinks:      { values: patchMonthly(existingMetric('seo','backlinks'),      seoGoals.backlinks.current),      color: '#f24b3b' },
    keywords_top10: { values: patchMonthly(existingMetric('seo','keywords_top10'), seoGoals.keywords_top10.current), color: '#ece4d3' },
  };

  // ── Construir objeto de datos temporal (antes del informe)
  const dataTemp = {
    meta: { client: CFG.clientName, period: CFG.period, updated: now(), month_label: monthLabel(), generated_by: 'hanson-updater v1' },
    linkedin: { goals: liGoals, metrics: liMetrics, top_posts: existing?.linkedin?.top_posts || [] },
    seo: { goals: seoGoals, metrics: seoMetrics, top_keywords: seoData?.keywords || existing?.seo?.top_keywords || [] },
    informe_ia: existing?.informe_ia || { linkedin: '', seo: '', generado: '' },
    projects: existing?.projects || [],
  };

  // ── 4. Generar informes IA
  if (CFG.anthropicKey) {
    const [informeLi, informeSeo] = await Promise.all([
      generateInforme(dataTemp, 'linkedin'),
      generateInforme(dataTemp, 'seo'),
    ]);
    dataTemp.informe_ia = {
      linkedin: informeLi,
      seo:      informeSeo,
      generado: new Date().toISOString(),
    };
  } else {
    log('⚠ Sin ANTHROPIC_API_KEY — saltando generación de informes');
  }

  // ── 5. Escribir JSON final
  const output = JSON.stringify(dataTemp, null, 2);
  fs.writeFileSync(CFG.outputJson, output, 'utf8');
  log(`✓ ${CFG.outputJson} escrito (${(output.length/1024).toFixed(1)} KB)`);
  log('═══════════════════════════════════════════');
  log('Actualización completada');
}

main().catch(e => {
  console.error('[ERROR FATAL]', e);
  process.exit(1);
});
