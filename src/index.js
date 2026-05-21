require('dotenv').config();
const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.server.port, '0.0.0.0', () => {
  logger.info(`satje-scraper iniciado en puerto ${config.server.port} [${config.server.nodeEnv}]`);
  logger.info(`API SATJE base: ${config.satje.apiBase}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido — cerrando servidor...');
  server.close(() => {
    logger.info('Servidor cerrado.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recibido — cerrando servidor...');
  server.close(() => {
    logger.info('Servidor cerrado.');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Promesa rechazada no manejada: ${reason}`);
});
