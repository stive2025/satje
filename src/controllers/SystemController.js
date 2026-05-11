const os = require('os');
const config = require('../config');

class SystemController {
  ping(req, res) {
    res.json({ status: 'ok', service: 'satje-scraper' });
  }

  healthCheck(req, res) {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      env: config.server.nodeEnv,
      satjeApiBase: config.satje.apiBase,
    });
  }

  systemStatus(req, res) {
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      },
      os: {
        platform: os.platform(),
        cpus: os.cpus().length,
        freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      },
      config: {
        port: config.server.port,
        satjePageUrl: config.satje.pageUrl,
        captchaTimeout: config.satje.captchaTimeout,
        maxConcurrentPages: config.browser.maxConcurrentPages,
      },
    });
  }
}

module.exports = new SystemController();
