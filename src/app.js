const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes/satje.routes');

function createApp() {
  const app = express();

  app.use(cors({
    origin: 'http://172.20.1.105',
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Cabeceras de seguridad mínimas
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // Middleware de API Key opcional
  if (config.server.apiKey) {
    app.use((req, res, next) => {
      const key = req.headers['x-api-key'] || req.query.api_key;
      if (req.path === '/ping') return next();
      if (key !== config.server.apiKey) {
        return res.status(401).json({ error: 'API key inválida o ausente' });
      }
      next();
    });
  }

  app.use('/', routes);

  // Manejador global de errores
  app.use((err, req, res, next) => {
    logger.error(`Error no controlado: ${err.stack}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = createApp;
