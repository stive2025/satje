require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3031,
    nodeEnv: process.env.NODE_ENV || 'development',
    apiKey: process.env.API_KEY || null,
  },
  satje: {
    pageUrl: process.env.SATJE_PAGE_URL || 'https://procesosjudiciales.funcionjudicial.gob.ec/busqueda-filtros',
    apiBase: process.env.SATJE_API_BASE || 'https://api.funcionjudicial.gob.ec',
    captchaTimeout: parseInt(process.env.CAPTCHA_TIMEOUT, 10) || 120000,
    defaultPageSize: 10,
  },
  browser: {
    maxConcurrentPages: parseInt(process.env.MAX_CONCURRENT_PAGES, 10) || 2,
    headless: process.env.HEADLESS !== 'false',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  },
  capsolver: {
    apiKey: process.env.CAPSOLVER_API_KEY || null,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/satje.log',
  },
};

module.exports = config;
