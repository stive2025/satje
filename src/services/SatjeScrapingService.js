const fs = require('fs');
const os = require('os');
const path = require('path');
const browserService = require('./BrowserService');
const httpService = require('./SatjeHttpService');
const config = require('../config');
const logger = require('../utils/logger');
const { humanType, randomDelay } = require('../utils/helpers');

class SatjeScrapingService {
  async _obtenerCausas(searchParams) {
    logger.info(`Buscando causas vía HTTP: ${JSON.stringify(searchParams)}`);
    const [causas, total] = await Promise.all([
      httpService.buscarCausas(searchParams),
      httpService.contarCausas(searchParams),
    ]);
    return { causas: causas || [], total: total || 0 };
  }

  async _llenarCampoCedula(page, cedula) {
    logger.debug('Buscando campo de cédula del demandado...');
    // La SPA de SATJE usa Angular Material — los inputs son dinámicos
    // Selectores observados en las capturas de pantalla:
    const selectors = [
      'input[name="cedulaDemandado"]',
      'input[placeholder*="Cédula"]',
      'input[formcontrolname="cedulaDemandado"]',
      // Fallback por posición en el formulario
      'mat-form-field:nth-of-type(1) input',
    ];

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 30000 });
        await humanType(page, sel, cedula);
        logger.debug(`Campo cédula encontrado con selector: ${sel}`);
        return;
      } catch (_) {}
    }
    throw new Error('No se encontró el campo de cédula del demandado en la página');
  }

  async _llenarCampoNombre(page, nombre) {
    logger.debug('Buscando campo de nombre del demandado...');
    const selectors = [
      'input[name="nombreDemandado"]',
      'input[placeholder*="Nombre"]',
      'input[formcontrolname="nombreDemandado"]',
      'mat-form-field:nth-of-type(2) input',
    ];

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        await humanType(page, sel, nombre);
        logger.debug(`Campo nombre encontrado con selector: ${sel}`);
        return;
      } catch (_) {}
    }
    throw new Error('No se encontró el campo de nombre del demandado en la página');
  }

  async _clickBuscar(page) {
    logger.debug('Haciendo clic en Buscar...');
    const selectors = [
      'button[type="submit"]',
      'button.btn-buscar',
      'button:has-text("Buscar")',
      'button[color="primary"]',
    ];

    await randomDelay(400, 700);

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 30000 });
        await page.click(sel);
        logger.debug(`Botón Buscar clicado con selector: ${sel}`);
        return;
      } catch (_) {}
    }

    // Último recurso: buscar por texto del botón
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent.trim().toLowerCase().includes('buscar'));
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!clicked) throw new Error('No se encontró el botón Buscar');
  }

  async _resolverRecaptcha(page) {
    logger.info('Resolviendo reCAPTCHA...');

    // Esperar iframe — confirma que el widget renderizó correctamente
    try {
      await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 20000 });
      logger.info('Iframe reCAPTCHA detectado');
    } catch (_) {
      logger.warn('Iframe reCAPTCHA no detectado en 20s — CAPTCHA no presente, continuando');
      return;
    }

    // Pausa para que Angular termine de vincular los event listeners
    await randomDelay(1200, 1800);

    // ── Intento 1: buscar en TODOS los elementos Angular el método resolvedCapcha ──
    // El componente padre (no <re-captcha>) es quien tiene ese método.
    const viaParent = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const ctx = el.__ngContext__;
        if (!ctx) continue;
        const arr = Array.isArray(ctx) ? ctx : Object.values(ctx);
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          for (const m of ['resolvedCapcha', 'resolvedCaptcha']) {
            if (typeof item[m] === 'function') {
              try { item[m]('verdad'); return el.tagName.toLowerCase() + '.' + m; } catch (_) {}
            }
          }
        }
      }
      return null;
    });

    if (viaParent) {
      logger.info(`reCAPTCHA resuelto vía ${viaParent} ✓`);
      await randomDelay(500, 900);
      return;
    }

    // ── Intento 2: emitir en el EventEmitter de ReCaptchaComponent ──
    // El componente <re-captcha> tiene resolved:EventEmitter — emitir
    // dispara el binding (resolved)="resolvedCapcha($event)" del padre.
    const viaEmit = await page.evaluate(() => {
      const el = document.querySelector('re-captcha');
      if (!el || !el.__ngContext__) return null;
      const lview = el.__ngContext__;
      // CONTEXT está en índice 7 (Angular 13+) u 8 (versiones anteriores)
      for (const idx of [7, 8, 6, 9]) {
        const comp = Array.isArray(lview) ? lview[idx] : null;
        if (!comp || typeof comp !== 'object') continue;
        if (comp.resolved && typeof comp.resolved.emit === 'function') {
          try { comp.resolved.emit('verdad'); return 're-captcha.lview[' + idx + '].resolved.emit'; } catch (_) {}
        }
      }
      return null;
    });

    if (viaEmit) {
      logger.info(`reCAPTCHA resuelto vía ${viaEmit} ✓`);
      await randomDelay(500, 900);
      return;
    }

    // ── Intento 3: TODOS los callbacks en ___grecaptcha_cfg.clients ──
    // El callback de ng-recaptcha tiene "zone.run" o "emit" en su source.
    // Llamamos a TODOS los que encontremos para asegurar que el correcto dispare.
    const viaCfg = await page.evaluate(() => {
      const clients = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
      if (!clients) return null;

      const found = [];
      function collect(obj, path, depth) {
        if (depth > 5 || !obj || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
          try {
            const v = obj[k];
            if (k === 'callback' && typeof v === 'function') {
              found.push({ path: path + '.callback', fn: v });
            } else if (v && typeof v === 'object') {
              collect(v, path + '.' + k, depth + 1);
            }
          } catch (_) {}
        }
      }

      for (const [wid, client] of Object.entries(clients)) {
        collect(client, wid, 0);
      }

      // Guardar sources para diagnóstico
      window.__cbSources = found.map(f => ({ p: f.path, s: f.fn.toString().slice(0, 200) }));

      // Llamar a TODOS — el de ng-recaptcha tiene zone.run/emit; los demás son inocuos
      const called = [];
      for (const { path, fn } of found) {
        try { fn('verdad'); called.push(path); } catch (_) {}
      }
      return called.length ? called.join('|') : null;
    });

    if (viaCfg) logger.info(`cfg callbacks invocados: ${viaCfg}`);

    // Log sources para identificar cuál es el callback de Angular
    const cbSrc = await page.evaluate(() => JSON.stringify(window.__cbSources || []));
    logger.info(`cb_sources: ${cbSrc}`);

    // Esperar brevemente para dar tiempo a Angular a reaccionar
    await randomDelay(1500, 2000);

    // Diagnóstico de componentes Angular
    const diag = await page.evaluate(() => {
      let withCtx = 0;
      const methods = new Set();
      for (const el of document.querySelectorAll('*')) {
        const ctx = el.__ngContext__;
        if (!ctx) continue;
        withCtx++;
        const arr = Array.isArray(ctx) ? ctx : Object.values(ctx);
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          for (const k of Object.getOwnPropertyNames(item)) {
            if (typeof item[k] === 'function') methods.add(k);
          }
        }
      }
      return {
        hasEl: !!document.querySelector('re-captcha'),
        withCtx,
        methodSample: [...methods].slice(0, 30),
      };
    });
    logger.warn(`captcha_diag: ${JSON.stringify(diag)}`);
  }

  async _resolverConCapSolver(page) {
    const axios = require('axios');
    const apiKey = config.capsolver.apiKey;
    const pageUrl = page.url();

    // Obtener el sitekey del reCAPTCHA en la página
    const sitekey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]') ||
                 document.querySelector('iframe[src*="recaptcha"]');
      if (!el) return null;
      if (el.dataset?.sitekey) return el.dataset.sitekey;
      const m = (el.src || '').match(/[?&]k=([^&]+)/);
      return m ? m[1] : null;
    });

    if (!sitekey) throw new Error('No se encontró sitekey de reCAPTCHA en la página');
    logger.info(`CapSolver: sitekey=${sitekey}`);

    // Crear tarea en CapSolver
    const createRes = await axios.post('https://api.capsolver.com/createTask', {
      clientKey: apiKey,
      task: { type: 'ReCaptchaV2TaskProxyLess', websiteURL: pageUrl, websiteKey: sitekey },
    });

    if (createRes.data.errorId) {
      throw new Error(`CapSolver createTask error: ${createRes.data.errorDescription}`);
    }

    const taskId = createRes.data.taskId;
    logger.info(`CapSolver tarea creada: ${taskId}`);

    // Esperar solución (polling cada 3s, máx 2 minutos)
    let token = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await axios.post('https://api.capsolver.com/getTaskResult', {
        clientKey: apiKey,
        taskId,
      });
      if (pollRes.data.status === 'ready') {
        token = pollRes.data.solution?.gRecaptchaResponse;
        break;
      }
      logger.debug(`CapSolver: esperando solución... intento ${i + 1}`);
    }

    if (!token) throw new Error('CapSolver: timeout esperando solución del CAPTCHA');
    logger.info('CapSolver: token obtenido ✓ — inyectando en la página...');

    // Inyectar el token y disparar el callback de reCAPTCHA que Angular escucha
    await page.evaluate((t) => {
      // Poner el token en el textarea oculto que reCAPTCHA usa
      document.querySelectorAll('textarea[name="g-recaptcha-response"]')
        .forEach((el) => { el.value = t; });

      // Invocar el callback registrado en ___grecaptcha_cfg (usado por ng-recaptcha)
      const cfg = window.___grecaptcha_cfg;
      if (cfg && cfg.clients) {
        Object.values(cfg.clients).forEach((client) => {
          Object.values(client).forEach((widget) => {
            if (widget && typeof widget.callback === 'function') widget.callback(t);
            if (widget && widget.l && typeof widget.l.callback === 'function') widget.l.callback(t);
          });
        });
      }
    }, token);

    logger.info('Token inyectado — Angular debería habilitar Buscar y disparar buscarCausas.');
    await randomDelay(1000, 2000);
  }

  // ─────────────────────────────────────────────────────────────
  // API pública del servicio
  // ─────────────────────────────────────────────────────────────

  /**
   * Búsqueda completa: Nivel 1 (Puppeteer) → Niveles 2+3 (Axios).
   * Retorna el árbol completo de causas con sus movimientos y actuaciones.
   */
  async buscarCompleto(searchParams) {
    logger.info(`Iniciando búsqueda completa: ${JSON.stringify(searchParams)}`);

    // Fase 1: Obtener causas vía HTTP
    const { causas, total } = await this._obtenerCausas(searchParams);

    if (!causas || causas.length === 0) {
      logger.info('No se encontraron causas para los parámetros dados.');
      return { total: 0, causas: [] };
    }

    logger.info(`${total} causas encontradas. Profundizando con Axios...`);

    // Fase 2: Para cada causa, obtener niveles 2 y 3 en paralelo
    const causasCompletas = await Promise.allSettled(
      causas.map((causa) => this._enriquecerCausa(causa))
    );

    return {
      total,
      causas: causasCompletas.map((result, i) => {
        if (result.status === 'fulfilled') return result.value;
        logger.error(`Error enriqueciendo causa ${causas[i]?.idJuicio}: ${result.reason?.message}`);
        return { ...causas[i], error: result.reason?.message };
      }),
    };
  }

  async _enriquecerCausa(causa) {
    const idJuicio = causa.idJuicio || causa.numeroDemanda;
    if (!idJuicio) return causa;

    const [informacion, movimientos] = await Promise.allSettled([
      httpService.getInformacionJuicio(idJuicio),
      httpService.getAllActuacionesForJuicio(idJuicio),
    ]);

    return {
      ...causa,
      informacion: informacion.status === 'fulfilled' ? informacion.value : null,
      movimientos: movimientos.status === 'fulfilled' ? movimientos.value : [],
    };
  }

  /**
   * Consulta solo el Nivel 1 vía Puppeteer (causas sin detalles).
   */
  async buscarCausas(searchParams) {
    logger.info(`Búsqueda solo Nivel 1: ${JSON.stringify(searchParams)}`);
    const { causas, total } = await this._obtenerCausas(searchParams);
    return { total, causas: causas || [] };
  }

  /**
   * Consulta Niveles 2+3 para un idJuicio ya conocido (sin Puppeteer).
   */
  async getProceso(idJuicio) {
    logger.info(`getProceso idJuicio=${idJuicio}`);
    const [informacion, movimientos] = await Promise.allSettled([
      httpService.getInformacionJuicio(idJuicio),
      httpService.getAllActuacionesForJuicio(idJuicio),
    ]);

    return {
      idJuicio,
      informacion: informacion.status === 'fulfilled' ? informacion.value : null,
      movimientos: movimientos.status === 'fulfilled' ? movimientos.value : [],
    };
  }

  /**
   * Descarga el PDF generado por pdfmake en el cliente.
   * El botón "Exportar PDF" dispara una descarga de blob — no hay endpoint HTTP.
   * Se usa Puppeteer + CDP para capturar el archivo antes de que llegue al disco del usuario.
   *
   * @param {object} opts
   * @param {string} [opts.cedula]         - Cédula/RUC del demandado para re-buscar
   * @param {string} [opts.nombre]         - Nombre del demandado (alternativa a cedula)
   * @param {number} [opts.causaIndex=0]   - Índice de la causa en la tabla (0-based)
   * @param {number} [opts.incidenteIndex=0] - Índice del incidente en el panel (0-based)
   * @returns {Buffer} Buffer binario del PDF
   */
  async downloadPdf({ cedula, nombre, causaIndex = 0, incidenteIndex = 0 }) {
    logger.info(`downloadPdf cedula=${cedula || nombre} causaIdx=${causaIndex} incIdx=${incidenteIndex}`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satje-pdf-'));
    const page = await browserService.newPage();

    page.setDefaultTimeout(60000);

    try {
      // ── Escuchar buscarCausas ────────────────────────────────────
      let resultadosListos = false;
      page.on('response', (response) => {
        try {
          if (response.url().includes('buscarCausas') && response.request()?.method() === 'POST') {
            resultadosListos = true;
          }
        } catch (_) {}
      });

      // ── CDP para capturar la descarga ───────────────────────────
      const client = await page.createCDPSession();
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: tmpDir,
        eventsEnabled: true,
      });

      let downloadComplete = false;
      client.on('Browser.downloadProgress', (e) => {
        if (e.state === 'completed') downloadComplete = true;
      });

      // ── Nivel 1: Navegar, llenar y buscar ───────────────────────
      // domcontentloaded es suficiente: _llenarCampoCedula usa waitForSelector
      // para esperar a que Angular renderice el formulario completo.
      logger.info('PDF: navegando...');
      await page.goto(config.satje.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      if (cedula) await this._llenarCampoCedula(page, cedula);
      else if (nombre) await this._llenarCampoNombre(page, nombre);
      else throw new Error('Se requiere cedula o nombre para descargar el PDF');

      await this._clickBuscar(page);

      // El reCAPTCHA v2 aparece después del clic en Buscar — ahora sí está en el DOM
      await this._resolverRecaptcha(page);

      // Esperar confirmación de red (buscarCausas se dispara tras resolver el CAPTCHA)
      await new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (resultadosListos) { clearInterval(check); resolve(); }
        }, 300);
        setTimeout(() => { clearInterval(check); reject(new Error('Timeout esperando respuesta buscarCausas')); }, 45000);
      });
      await randomDelay(1200, 2000);

      try {
        // Verificar si la respuesta devolvió 0 resultados o si cargó la tabla
        logger.info('Verificando resultados en pantalla...');
        const bodyStr = await page.evaluate(() => document.body.innerText.toLowerCase());
        if (bodyStr.includes('no se encontraron') || bodyStr.includes('0 registros')) {
          throw new Error('La consulta finalizó pero no se encontraron procesos judiciales para este criterio (0 registros).');
        }

        logger.info(`PDF: abriendo causa índice ${causaIndex}...`);
        const rowSelectors = ['table tbody tr', 'mat-row', 'tr.mat-row', '[role="row"]:not([role="columnheader"])'];
        let rowSelector = null;
        for (const sel of rowSelectors) {
          try {
            await page.waitForSelector(sel, { timeout: 10000 });
            rowSelector = sel;
            break;
          } catch (_) {}
        }
        
        if (!rowSelector) throw new Error('No se encontró la tabla de resultados en la página a pesar de haber recibido respuesta');
        await randomDelay(500, 900);

        const carpetaClicada = await page.evaluate((idx, sel) => {
          const filas = Array.from(document.querySelectorAll(sel));
          if (idx >= filas.length) return false;
          const fila = filas[idx];
          const btn = fila.querySelector('button, [class*="folder"], mat-icon');
          if (btn) { btn.click(); return true; }
          return false;
        }, causaIndex, rowSelector);

        if (!carpetaClicada) throw new Error(`No se encontró el botón de carpeta en la causa índice ${causaIndex}`);
        await randomDelay(1500, 2500);

        // ── Nivel 2 → Nivel 3: Clic en sub-carpeta del incidente ────
        logger.info(`PDF: abriendo incidente índice ${incidenteIndex}...`);
        const subCarpetaClicada = await page.evaluate((idx) => {
          const candidatos = Array.from(document.querySelectorAll(
            'mat-expansion-panel button, [class*="incidente"] button, [class*="movimiento"] button, tr.detail-row button'
          ));
          if (idx >= candidatos.length) return false;
          candidatos[idx].click();
          return true;
        }, incidenteIndex);

        if (!subCarpetaClicada) {
          logger.warn('Sub-carpeta no encontrada con selectores primarios, intentando fallback...');
        }
        await randomDelay(1500, 2500);

        // ── Nivel 3: Clic en "Exportar PDF" ──────────────────────────
        logger.info('PDF: haciendo clic en Exportar PDF...');
        const exportado = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find((b) => {
            const txt = b.textContent.toLowerCase();
            return txt.includes('exportar') || txt.includes('pdf');
          });
          if (btn) { btn.click(); return true; }
          return false;
        });

        if (!exportado) throw new Error('No se encontró el botón "Exportar PDF" en Nivel 3');

      } catch (uiError) {
        // --- SCREENSHOT DE DEBUG EN CASO DE ERROR ---
        const errorImgPath = path.join(tmpDir, `error-ui-${Date.now()}.png`);
        await page.screenshot({ path: errorImgPath, fullPage: true });
        logger.error(`Error en la UI del SATJE. Screenshot guardado en: ${errorImgPath}`);
        throw uiError; 
      }

      // ── Esperar a que termine la descarga ─────────────────────────
      logger.info('PDF: esperando descarga del archivo...');
      await new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          if (downloadComplete) { clearInterval(poll); resolve(); }
        }, 300);
        setTimeout(() => { clearInterval(poll); reject(new Error('Timeout esperando descarga PDF')); }, 60000);
      });

      const archivos = fs.readdirSync(tmpDir).filter((f) => !f.endsWith('.crdownload'));
      if (!archivos.length) throw new Error('No se encontró el PDF en el directorio temporal');

      const buffer = fs.readFileSync(path.join(tmpDir, archivos[0]));
      logger.info(`PDF capturado: ${archivos[0]} (${buffer.length} bytes)`);
      return buffer;

    } finally {
      await browserService.closePage(page);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

module.exports = new SatjeScrapingService();
