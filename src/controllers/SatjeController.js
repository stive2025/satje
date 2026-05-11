const scrapingService = require('../services/SatjeScrapingService');
const logger = require('../utils/logger');

class SatjeController {
  /**
   * GET /satje/buscar?cedula=X  o  ?nombre=X
   * Búsqueda completa (Nivel 1 Puppeteer + Niveles 2/3 Axios).
   */
  async buscarCompleto(req, res) {
    const { cedula, nombre, provincia, numeroCausa } = req.query;

    if (!cedula && !nombre) {
      return res.status(400).json({ error: 'Se requiere el parámetro ?cedula= o ?nombre=' });
    }

    try {
      const resultado = await scrapingService.buscarCompleto({
        cedula: cedula?.trim() || '',
        nombre: nombre?.trim() || '',
        provincia: provincia?.trim() || '',
        numeroCausa: numeroCausa?.trim() || '',
      });
      return res.json(resultado);
    } catch (err) {
      logger.error(`buscarCompleto error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /satje/causas?cedula=X
   * Solo Nivel 1 — lista de causas sin profundizar (más rápido).
   */
  async buscarCausas(req, res) {
    const { cedula, nombre, provincia, numeroCausa } = req.query;

    if (!cedula && !nombre) {
      return res.status(400).json({ error: 'Se requiere el parámetro ?cedula= o ?nombre=' });
    }

    try {
      const resultado = await scrapingService.buscarCausas({
        cedula: cedula?.trim() || '',
        nombre: nombre?.trim() || '',
        provincia: provincia?.trim() || '',
        numeroCausa: numeroCausa?.trim() || '',
      });
      return res.json(resultado);
    } catch (err) {
      logger.error(`buscarCausas error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /satje/proceso/:idJuicio
   * Niveles 2+3 para un juicio ya conocido (sin Puppeteer, solo Axios).
   */
  async getProceso(req, res) {
    const { idJuicio } = req.params;
    if (!idJuicio) {
      return res.status(400).json({ error: 'Se requiere idJuicio' });
    }

    try {
      const resultado = await scrapingService.getProceso(idJuicio);
      return res.json(resultado);
    } catch (err) {
      logger.error(`getProceso error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * GET /satje/pdf?cedula=X&causaIndex=0&incidenteIndex=0
   *
   * El PDF se genera en el cliente con pdfmake (no hay endpoint HTTP).
   * Puppeteer navega el flujo completo y captura el archivo descargado via CDP.
   *
   * Query params:
   *   cedula | nombre       - criterio de búsqueda (requerido)
   *   causaIndex            - índice 0-based de la causa en la tabla (default: 0)
   *   incidenteIndex        - índice 0-based del incidente en el panel (default: 0)
   */
  async downloadPdf(req, res) {
    const { cedula, nombre, causaIndex, incidenteIndex } = req.query;

    if (!cedula && !nombre) {
      return res.status(400).json({ error: 'Se requiere ?cedula= o ?nombre=' });
    }

    try {
      const pdfBuffer = await scrapingService.downloadPdf({
        cedula: cedula?.trim() || '',
        nombre: nombre?.trim() || '',
        causaIndex: parseInt(causaIndex, 10) || 0,
        incidenteIndex: parseInt(incidenteIndex, 10) || 0,
      });

      const filename = `proceso_${(cedula || nombre).replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length,
      });
      return res.send(pdfBuffer);
    } catch (err) {
      logger.error(`downloadPdf error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new SatjeController();
