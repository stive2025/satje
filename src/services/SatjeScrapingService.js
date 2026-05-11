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
    logger.info('Esperando iframe de reCAPTCHA...');
    try {
      // Esperar a que aparezca el iframe de reCAPTCHA
      await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 30000 });
      logger.info('reCAPTCHA detectado — haciendo clic en checkbox...');

      await randomDelay(800, 1500);

      // Obtener el frame del reCAPTCHA y hacer clic en el checkbox
      const frames = page.frames();
      const recaptchaFrame = frames.find((f) => f.url().includes('recaptcha'));

      if (recaptchaFrame) {
        await recaptchaFrame.waitForSelector('#recaptcha-anchor', { timeout: 8000 });
        await recaptchaFrame.click('#recaptcha-anchor');
        logger.info('Checkbox reCAPTCHA clicado. Esperando verificación...');

        try {
          // Esperar a que el checkbox muestre aria-checked="true" (resuelto sin desafío)
          await recaptchaFrame.waitForSelector('#recaptcha-anchor[aria-checked="true"]', { timeout: 10000 });
          logger.info('reCAPTCHA resuelto automáticamente (checkbox checked) ✓');
          await randomDelay(500, 1000);
        } catch (_) {
          // El desafío de imagen apareció — esperar más tiempo para resolución manual o servicio
          logger.warn('reCAPTCHA requiere desafío de imagen. Esperando resolución (hasta 60s)...');
          await randomDelay(55000, 60000);
        }
      } else {
        // Intentar clic directo en el área visible del captcha
        await page.click('iframe[src*="recaptcha"]');
        logger.warn('Frame reCAPTCHA no accesible directamente, se hizo clic en el iframe.');
        await randomDelay(3000, 5000);
      }

    } catch (err) {
      logger.warn(`reCAPTCHA no apareció o ya fue resuelto: ${err.message}`);
      // En algunos flujos el captcha no aparece — continuar esperando la interceptación
    }
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
      // Configurar CDP para capturar la descarga en tmpDir
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

      // ── Nivel 1: Buscar y pasar captcha ──────────────────────────
      logger.info('PDF: navegando y buscando...');
      await page.goto(config.satje.pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });

      if (cedula) await this._llenarCampoCedula(page, cedula);
      else if (nombre) await this._llenarCampoNombre(page, nombre);
      else throw new Error('Se requiere cedula o nombre para descargar el PDF');

      // Escuchar buscarCausas ANTES de resolver el captcha
      let resultadosListos = false;
      page.on('response', (response) => {
        try {
          if (response.url().includes('buscarCausas') && response.request()?.method() === 'POST') {
            resultadosListos = true;
          }
        } catch (_) {}
      });

      await this._clickBuscar(page);
      await this._resolverRecaptcha(page);

      // Esperar confirmación de red antes de tocar el DOM
      await new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (resultadosListos) { clearInterval(check); resolve(); }
        }, 300);
        setTimeout(() => { clearInterval(check); reject(new Error('Timeout esperando respuesta buscarCausas')); }, 45000);
      });
      await randomDelay(1200, 2000); // Dar tiempo a Angular para renderizar

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
