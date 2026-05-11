const { Router } = require('express');
const satjeController = require('../controllers/SatjeController');
const systemController = require('../controllers/SystemController');

const router = Router();

// ── Sistema ──────────────────────────────────────
router.get('/ping', (req, res) => systemController.ping(req, res));
router.get('/health-check', (req, res) => systemController.healthCheck(req, res));
router.get('/system-status', (req, res) => systemController.systemStatus(req, res));

// ── SATJE ─────────────────────────────────────────
// Búsqueda completa niveles 1+2+3 via Puppeteer+Axios
router.get('/satje/buscar', (req, res) => satjeController.buscarCompleto(req, res));

// Solo Nivel 1 — causas sin profundizar (más rápido)
router.get('/satje/causas', (req, res) => satjeController.buscarCausas(req, res));

// Niveles 2+3 para un idJuicio conocido (solo Axios, sin Puppeteer)
router.get('/satje/proceso/:idJuicio', (req, res) => satjeController.getProceso(req, res));

// Descarga de PDF — generado client-side por pdfmake, capturado con Puppeteer+CDP
// ?cedula=X&causaIndex=0&incidenteIndex=0
router.get('/satje/pdf', (req, res) => satjeController.downloadPdf(req, res));

module.exports = router;
