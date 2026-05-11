const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class BrowserService {
  constructor() {
    this._browser = null;
  }

  async getBrowser() {
    if (this._browser && this._browser.connected) {
      return this._browser;
    }
    logger.info('Lanzando navegador Chromium con stealth...');
    this._browser = await puppeteer.launch({
      headless: config.browser.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1366,768',
        '--lang=es-419,es',
        '--disable-dev-shm-usage', 
        '--disable-gpu'
      ],
      defaultViewport: { width: 1366, height: 768 },
    });
    logger.info('Navegador lanzado correctamente.');
    return this._browser;
  }

  async newPage() {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(config.browser.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-419,es;q=0.9',
      'sec-ch-ua': '"Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });

    // Simula hardware real para evitar detección
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ],
      });
    });

    return page;
  }

  async closePage(page) {
    try {
      if (page && !page.isClosed()) await page.close();
    } catch (e) {
      logger.warn(`Error cerrando página: ${e.message}`);
    }
  }

  async closeBrowser() {
    try {
      if (this._browser) {
        await this._browser.close();
        this._browser = null;
        logger.info('Navegador cerrado.');
      }
    } catch (e) {
      logger.warn(`Error cerrando navegador: ${e.message}`);
    }
  }
}

module.exports = new BrowserService();
