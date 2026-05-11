# Scraping Service — Guía de Arquitectura y Configuración

## ¿Qué hace este proyecto?

Es un servicio que entra automáticamente a un sitio web externo, se autentica, y consulta datos de personas por número de cédula. Los datos los devuelve en formato JSON para que otras aplicaciones los consuman.

No es un scraping visual — después del login, todas las consultas van directo a la API interna del sitio web objetivo, lo que lo hace más rápido y estable.

---

## Lenguaje y tecnologías

| Componente | Tecnología |
|-----------|-----------|
| Lenguaje | Node.js 18+ |
| Framework servidor | Express 4 |
| Automatización browser | Puppeteer 22 + puppeteer-extra-plugin-stealth |
| Llamadas HTTP | Axios |
| Logs | Winston |
| Variables de entorno | dotenv |
| Contenedor | Docker + Alpine Linux |

---

## Estructura de archivos

```
scraping_datadiverservice/
├── src/
│   ├── index.js                     # Punto de entrada — arranca la app
│   ├── app.js                       # Configura Express, servicios y rutas
│   ├── config/
│   │   └── index.js                 # Lee todas las variables del .env
│   ├── routes/
│   │   └── index.js                 # Define las URLs del servidor (endpoints)
│   ├── controllers/
│   │   ├── ScrapingController.js    # Recibe peticiones de cédula y responde
│   │   ├── FamilyController.js      # Endpoints de depuración de familia
│   │   └── SystemController.js     # Estado del sistema, health check, etc.
│   ├── services/
│   │   ├── BrowserService.js        # Maneja el navegador Chromium (Puppeteer)
│   │   ├── AuthService.js           # Login en el sitio externo, gestión del token
│   │   ├── HttpService.js           # Llamadas HTTP a la API externa con el token
│   │   ├── ScrapingService.js       # Orquesta consultas, caché y deduplicación
│   │   ├── FamilyService.js         # Consultas adicionales de datos de familia
│   │   ├── DataTransformService.js  # Convierte la respuesta al formato final
│   │   └── KeepAliveService.js      # Renueva el token antes de que expire
│   └── utils/
│       ├── logger.js                # Configuración de Winston
│       └── helpers.js               # Funciones auxiliares (delay, fechas, etc.)
├── .env                             # Variables de configuración (no subir a git)
├── Dockerfile                       # Imagen Docker basada en Node 18 Alpine
├── docker-compose.yml               # Orquestación del contenedor
└── package.json
```

---

## Cómo funciona por dentro

### Flujo completo de una consulta

```
Cliente externo
    │
    │  GET /title/1004431019
    ▼
ScrapingController
    │
    │  ¿Está en caché?  →  SÍ  →  devuelve resultado directo
    │         NO
    ▼
ScrapingService
    │
    ├── HttpService.fetchAll(dni)         ← consulta 9 endpoints en paralelo
    └── FamilyService.tryMultiple(dni)    ← consulta endpoints de familia
    │
    ▼
DataTransformService.transform(rawData)  ← convierte al formato JSON final
    │
    ▼
Respuesta JSON al cliente
```

### Flujo del login (solo ocurre 1 vez cada ~5 horas)

```
AuthService.performLogin()
    │
    ├── Abre página de login con Puppeteer (navegador real Chromium)
    ├── Rellena usuario y contraseña con delays aleatorios humanos
    ├── Hace clic en "Iniciar sesión"
    ├── Intercepta la respuesta POST /login
    └── Extrae el Bearer token JWT de la respuesta
    │
    ▼
Token guardado en memoria → usado en todas las llamadas HTTP siguientes
```

---

## La función anti-CAPTCHA ("No soy un robot")

El sitio externo tiene un reCAPTCHA en el formulario de login. El servicio lo resuelve usando un **navegador real Chromium** (no un scraper headless básico), lo que hace que el reCAPTCHA lo detecte como humano.

### Técnicas aplicadas para pasar el CAPTCHA

**1. Navegador real con stealth plugin**
Se usa `puppeteer-extra-plugin-stealth`, que elimina más de 20 señales que delatan a un bot:
- Oculta `navigator.webdriver = true` (la señal más básica de detección)
- Elimina diferencias en el motor V8 entre Chrome normal y headless
- Corrige el objeto `window.chrome` que está ausente en headless puro

**2. Plugins de navegador simulados**
Los navegadores reales tienen plugins instalados. El código simula tres plugins reales de Chrome:
```js
{ name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer' }
{ name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' }
{ name: 'Native Client',      filename: 'internal-nacl-plugin' }
```

**3. Hardware simulado**
```js
navigator.hardwareConcurrency = 4   // núcleos del procesador
navigator.deviceMemory = 8          // GB de RAM
```

**4. Escritura humana con delays aleatorios**
El servicio no escribe las credenciales de golpe — las escribe carácter por carácter con pausas aleatorias, igual que un humano:
```js
// Entre cada carácter: 60ms + hasta 30ms aleatorio
await page.type('input#usuario', username, { delay: 60 + Math.random() * 30 });

// Pausa antes del clic en "Iniciar sesión"
await delay(400 + Math.random() * 200);
```

**5. User-Agent de Chrome real**
El mismo User-Agent en el navegador y en todas las llamadas HTTP:
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
```

**6. Headers HTTP idénticos a Chrome real**
```
Sec-Ch-Ua: "Not-A.Brand";v="99", "Google Chrome";v="124", "Chromium";v="124"
Sec-Ch-Ua-Mobile: ?0
Sec-Ch-Ua-Platform: "Windows"
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: same-site
```

---

## Adaptando el proyecto a otro sitio web

Para apuntar este servicio a un sitio diferente hay que tocar principalmente estos puntos:

### 1. Credenciales y URL — `src/config/index.js`

```js
datadiverservice: {
    username: process.env.NUEVO_SITIO_USER || 'tu_usuario',
    password: process.env.NUEVO_SITIO_PASS || 'tu_password',
    baseUrl: 'https://nuevo-sitio.com',        // URL del sitio web
    apiUrl:  'https://api.nuevo-sitio.com'     // URL de la API interna (si existe)
}
```

### 2. Formulario de login — `src/services/AuthService.js`

Cambiar los selectores CSS del formulario:
```js
// Selector del campo de usuario
await page.waitForSelector('input#mat-input-0', { timeout: 8000 });
await page.click('input#mat-input-0');

// Selector del campo de contraseña
await page.click('input#mat-input-1');

// Selector del botón de enviar
await page.click('button#kt_login_signin_submit');
```
Inspecciona el HTML del formulario del nuevo sitio con las DevTools del navegador (F12) para encontrar los selectores correctos.

### 3. Cómo captura el token — `src/services/AuthService.js`

El servicio intercepta la respuesta del POST de login y busca `accessToken`:
```js
loginPage.on('response', async (response) => {
    if (response.url().includes('/login') && response.request().method() === 'POST') {
        const data = await response.json();
        if (data.accessToken) {      // ← cambiar según la clave del nuevo sitio
            tokenResolve(data.accessToken);
        }
    }
});
```
Si el nuevo sitio usa `token`, `jwt`, `auth_token`, etc., cambiar `data.accessToken` por la clave correcta.

### 4. Endpoints de datos — `src/services/HttpService.js`

Cambiar la URL base y los endpoints que se consultan:
```js
this._baseUrl = `${config.datadiverservice.apiUrl}/ruta/de/la/api`;

// Modificar fetchAll() con los endpoints del nuevo sitio
const [datos1, datos2] = await Promise.allSettled([
    this._get('endpoint1', { id: dni }),
    this._get('endpoint2', { id: dni })
]);
```

### 5. Transformación de datos — `src/services/DataTransformService.js`

Mapear los campos del nuevo sitio al formato que necesita tu aplicación.

---

## Variables de entorno (.env)

```env
# Credenciales del sitio a scrapear
DATADIVERSERVICE_USER=usuario_real
DATADIVERSERVICE_PASS=contraseña_real

# Puerto del servidor
PORT=3030
NODE_ENV=production

# Puppeteer
MAX_CONCURRENT_PAGES=2
PAGE_POOL_SIZE=2
QUEUE_TIMEOUT=90000

# Sesión
TOKEN_REFRESH_INTERVAL=480000    # cada 8 minutos verifica si el token sigue válido
HEARTBEAT_INTERVAL=45000         # pulso de vida cada 45 segundos

# Seguridad (opcional)
API_KEY=clave-secreta-para-proteger-tu-servidor

# Logs
LOG_LEVEL=info
LOG_FILE=logs/scraper.log
```

---

## Endpoints disponibles

| Método | URL | Descripción |
|--------|-----|-------------|
| GET | `/title/:cedula` | Consulta datos completos de una cédula |
| GET | `/client/:cedula` | Igual que /title, formato estructurado |
| GET | `/ping` | Comprueba si el servidor está vivo |
| GET | `/health-check` | Estado del token y la sesión |
| GET | `/system-status` | Estadísticas completas del sistema |
| GET | `/sessions` | Estado de las sesiones activas |
| POST | `/refresh-token` | Fuerza renovación del token manualmente |

---

## Despliegue con Docker

```bash
# Construir la imagen
docker build -t scraping-service .

# Levantar con docker-compose
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f

# Reiniciar
docker-compose restart
```

El contenedor se reinicia automáticamente si se cae (`restart: unless-stopped`). Tiene un health check cada 30 segundos que verifica que el puerto 3030 responde.

---

## Consideraciones importantes

- El login ocurre **una sola vez** al arrancar y luego cada ~5 horas cuando expira el token
- Las consultas van por HTTP directo (sin browser), lo que las hace muy rápidas
- El caché guarda resultados 15 minutos para no repetir consultas idénticas
- El sistema tolera hasta 60 peticiones por minuto por IP antes de rechazar
- El servidor necesita al menos **2 GB de RAM** (1 GB para Node.js + 1 GB para Chromium)
