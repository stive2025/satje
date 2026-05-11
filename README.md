# SATJE Scraper

API REST que expone los procesos judiciales del [Sistema SATJE](https://procesosjudiciales.funcionjudicial.gob.ec) (Función Judicial del Ecuador). Obtiene causas, movimientos y actuaciones judiciales mediante llamadas HTTP directas a la API del SATJE, y descarga PDFs generados por el sitio mediante Puppeteer.

## Arquitectura

```
Cliente HTTP
    │
    ▼
Express (puerto 3030)
    │
    ├── Niveles 1+2+3 (buscar, causas, proceso)
    │       └── SatjeHttpService  ──► api.funcionjudicial.gob.ec  (Axios)
    │
    └── Descarga de PDF
            └── SatjeScrapingService ──► Puppeteer + CDP
```

- **Niveles 1, 2 y 3** (búsqueda, información de juicio, actuaciones) se resuelven completamente con Axios — sin navegador.
- **Descarga de PDF** usa Puppeteer para navegar la SPA Angular y capturar el archivo generado client-side por pdfmake.

## Requisitos

- Node.js ≥ 18
- (Producción) Docker

## Instalación local

```bash
npm install
cp .env.example .env   # ajustar variables si es necesario
npm start
```

## Docker

```bash
docker build -t satje-scraper .
docker run -p 3030:3030 --env-file .env satje-scraper
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3030` | Puerto del servidor Express |
| `NODE_ENV` | `production` | Entorno |
| `API_KEY` | *(vacío)* | Clave para proteger los endpoints. Si se define, todos los requests (excepto `/ping`) deben incluir el header `x-api-key` o el query param `?api_key=` |
| `HEADLESS` | `true` | `false` para abrir ventana visible de Chromium (solo en entornos con display) |
| `MAX_CONCURRENT_PAGES` | `2` | Páginas Puppeteer simultáneas |
| `CAPTCHA_TIMEOUT` | `120000` | Timeout en ms para el flujo de descarga de PDF |
| `SATJE_PAGE_URL` | `https://procesosjudiciales.funcionjudicial.gob.ec/busqueda-filtros` | URL de la SPA del SATJE |
| `SATJE_API_BASE` | `https://api.funcionjudicial.gob.ec` | Base URL de la API del SATJE |
| `LOG_LEVEL` | `info` | Nivel de logging (`debug`, `info`, `warn`, `error`) |
| `LOG_FILE` | `logs/satje.log` | Ruta del archivo de log |

## Endpoints

### Sistema

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/ping` | Health check mínimo |
| GET | `/health-check` | Uptime y configuración activa |
| GET | `/system-status` | Memoria, CPU y configuración detallada |

### SATJE

#### `GET /satje/buscar`

Búsqueda completa (Niveles 1 + 2 + 3): lista de causas con información del juicio y todas sus actuaciones.

**Query params** (al menos uno requerido):

| Param | Descripción |
|---|---|
| `cedula` | Cédula/RUC del demandado |
| `nombre` | Nombre del demandado (alternativa a cédula) |
| `provincia` | Código de provincia (opcional) |
| `numeroCausa` | Número de causa (opcional) |

```bash
GET /satje/buscar?cedula=1600216913
```

```json
{
  "total": 3,
  "causas": [
    {
      "idJuicio": "...",
      "numeroDemanda": "...",
      "informacion": { ... },
      "movimientos": [ ... ]
    }
  ]
}
```

---

#### `GET /satje/causas`

Solo Nivel 1: lista de causas sin profundizar en movimientos ni actuaciones. Más rápido.

```bash
GET /satje/causas?cedula=1600216913
```

---

#### `GET /satje/proceso/:idJuicio`

Niveles 2 + 3 para un `idJuicio` ya conocido: información del juicio y todas sus actuaciones, sin repetir la búsqueda inicial.

```bash
GET /satje/proceso/17230202301234
```

---

#### `GET /satje/pdf`

Descarga el PDF de un proceso generado por el sitio oficial. Abre Puppeteer, navega hasta el nivel de detalle indicado y captura el archivo via CDP antes de que llegue al disco del usuario.

**Query params:**

| Param | Default | Descripción |
|---|---|---|
| `cedula` | — | Cédula del demandado (requerido si no se usa `nombre`) |
| `nombre` | — | Nombre del demandado |
| `causaIndex` | `0` | Índice 0-based de la causa en la tabla de resultados |
| `incidenteIndex` | `0` | Índice 0-based del incidente dentro de la causa |

```bash
GET /satje/pdf?cedula=1600216913&causaIndex=0&incidenteIndex=0
```

Devuelve el archivo con `Content-Type: application/pdf`.

## Seguridad

Si se define `API_KEY` en `.env`, todos los endpoints (excepto `/ping`) requieren autenticación:

```bash
# Header
curl -H "x-api-key: mi_clave" http://localhost:3030/satje/buscar?cedula=...

# Query param
curl http://localhost:3030/satje/buscar?cedula=...&api_key=mi_clave
```

## Logs

Los logs se escriben en consola y en el archivo definido por `LOG_FILE`. Formato JSON con niveles Winston.

```
logs/satje.log
```
