# hanson* · Dashboard Welysis — guía de despliegue

## Estructura de archivos

```
welysis-dashboard/
├── index.html          ← el dashboard (va al subdominio)
├── data.json           ← datos del mes (actualizado por el script)
├── update.js           ← script de actualización mensual (va al servidor)
├── .env                ← variables de entorno (NO subir a git)
├── .env.example        ← plantilla de variables
├── data-sources/       ← carpeta donde dejas los archivos del mes
│   ├── metricool-export.csv
│   └── seo-report.csv
└── package.json
```

---

## Despliegue inicial

### 1. Subir archivos al servidor

```bash
# Subir el dashboard al subdominio
scp index.html usuario@servidor:/var/www/welysis.hansonagency.com/
scp data.json   usuario@servidor:/var/www/welysis.hansonagency.com/

# Subir el script de actualización (puede ir en otro directorio)
scp update.js   usuario@servidor:/var/scripts/welysis/
```

### 2. Configurar el subdominio en Nginx

```nginx
server {
    listen 80;
    server_name welysis.hansonagency.com;
    root /var/www/welysis.hansonagency.com;
    index index.html;

    # Opcional: protección básica con contraseña
    # auth_basic "Welysis Dashboard";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        try_files $uri $uri/ =404;
        add_header Cache-Control "no-cache";
    }
}
```

### 3. Instalar dependencias del script

```bash
cd /var/scripts/welysis
npm install @anthropic-ai/sdk googleapis csv-parse dotenv
```

### 4. Crear archivo .env

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json
SPREADSHEET_ID=1VfG_84-P0XRmJF0cwwQIqQ_1vLlcUAad-HD5cjtlcBM
METRICOOL_CSV=./data-sources/metricool-export.csv
SEO_CSV=./data-sources/seo-report.csv
OUTPUT_JSON=/var/www/welysis.hansonagency.com/data.json
CLIENT_NAME=welysis
YEAR=2026
```

### 5. Configurar cron mensual

```bash
crontab -e

# Ejecutar el 1 de cada mes a las 9:00 AM
0 9 1 * * /usr/bin/node /var/scripts/welysis/update.js >> /var/log/welysis-update.log 2>&1
```

---

## Google Sheets: estructura esperada

La hoja se llama **KPIs** y tiene este formato:

| Métrica         | Valor | Objetivo |
|-----------------|-------|----------|
| seguidores      | 1361  | 2500     |
| impresiones     | 1444  | 5000     |
| visitantes      | 48    | 200      |
| visualizaciones | 109   | 500      |
| reacciones      | 28    | 120      |
| comentarios     | 1     | 25       |
| sesiones        | 478   | 2000     |
| posicion_media  | 31    | 10       |
| backlinks       | 24    | 80       |
| keywords_top10  | 11    | 50       |

**Quién lo actualiza:** cada proveedor (equipo LinkedIn, proveedor SEO) mete sus datos en esta hoja una vez al mes. El script lo lee automáticamente.

---

## Metricool CSV

Metricool exporta automáticamente un CSV con este formato (columnas mínimas requeridas):

```
Date,Followers,Impressions,Profile Visits,Video Views,Reactions,Comments
2026-03-01,1361,1444,48,109,28,1
```

**Configuración en Metricool:** Reports → Scheduled Reports → CSV mensual → enviado a la carpeta del servidor o por email. Si se recibe por email, configurar un filtro para guardarlo automáticamente en `data-sources/metricool-export.csv`.

---

## Informe SEO (proveedor externo)

El proveedor manda un CSV con este formato:

```
Métrica,Valor
sesiones,478
posicion_media,31
backlinks,24
keywords_top10,11
keyword,position,volume
chlor-alkali plant modular,4,210
electrolysis industrial scale,7,880
welysis ONE CORE MAX,1,40
```

Se guarda manualmente en `data-sources/seo-report.csv` y el script lo procesa.

---

## Flujo mensual completo

```
Día 1 del mes:
  09:00 → cron dispara update.js
    └── Lee Google Sheets (KPIs actualizados por el equipo)
    └── Lee metricool-export.csv (exportación automática)
    └── Lee seo-report.csv (subido manualmente el día antes)
    └── Llama a Claude API → genera informe LinkedIn + SEO
    └── Escribe data.json actualizado
    └── El dashboard muestra los nuevos datos al instante
```

---

## Ejecución manual

```bash
# Ejecutar una vez para probar
node /var/scripts/welysis/update.js

# Ver el log
tail -f /var/log/welysis-update.log
```

---

## Personalización del informe IA

El prompt de Claude está en `update.js`, funciones `generateInforme()`. Para ajustar el tono o el enfoque del análisis, edita directamente esas cadenas de texto. El modelo usado es `claude-sonnet-4-6`.

---

## Troubleshooting

**El dashboard muestra "no se pudo cargar data.json"**
→ El archivo data.json no existe o hay un error de CORS. En local, abre index.html desde un servidor (no file://). En producción, verificar que el archivo está en la misma carpeta que index.html.

**El script falla con error de Google Sheets**
→ Verificar que la cuenta de servicio tiene acceso a la hoja de cálculo (compartir con el email de la service account).

**El informe IA no se genera**
→ Verificar ANTHROPIC_API_KEY en .env. El dashboard funciona sin informe IA, simplemente mostrará el último texto generado.
