const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const BASE = config.satje.apiBase;

const PATHS = {
  buscarCausas: '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/buscarCausas',
  contarCausas: '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/contarCausas',
  getInformacionJuicio: '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/getInformacionJuicio',
  actuacionesJudiciales: '/EXPEL-CONSULTA-CAUSAS-SERVICE/api/consulta-causas/informacion/actuacionesJudiciales',
  getIncidenteJudicatura: '/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/getIncidenteJudicatura',
  existeIngresoDirecto: '/EXPEL-CONSULTA-CAUSAS-CLEX-SERVICE/api/consulta-causas-clex/informacion/existeIngresoDirecto',
};

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://procesosjudiciales.funcionjudicial.gob.ec',
  Referer: 'https://procesosjudiciales.funcionjudicial.gob.ec/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Sec-GPC': '1',
  'User-Agent': config.browser.userAgent,
  'sec-ch-ua': '"Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const http = axios.create({ baseURL: BASE, headers: COMMON_HEADERS, timeout: 20000 });

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const status = err.response?.status || 'SIN_RESPUESTA';
    logger.error(`HTTP ${status} en ${url}: ${err.message}`);
    return Promise.reject(err);
  }
);

class SatjeHttpService {
  _buildPayload(searchParams, page = 1, pageSize = 10) {
    const { cedula = '', nombre = '', provincia = '', numeroCausa = '', numeroFiscalia = '' } = searchParams;
    return {
      numeroCausa,
      actor: { cedulaActor: '', nombreActor: '' },
      demandado: { cedulaDemandado: cedula, nombreDemandado: nombre },
      first: page,
      numeroFiscalia,
      pageSize,
      provincia,
      recaptcha: 'verdad',
    };
  }

  async buscarCausas(searchParams, page = 1, pageSize = 10) {
    logger.debug(`buscarCausas page=${page} size=${pageSize}`);
    const { data } = await http.post(
      `${PATHS.buscarCausas}?page=${page}&size=${pageSize}`,
      this._buildPayload(searchParams, page, pageSize)
    );
    return data;
  }

  async contarCausas(searchParams) {
    logger.debug('contarCausas');
    const { data } = await http.post(PATHS.contarCausas, this._buildPayload(searchParams));
    return data;
  }

  async getInformacionJuicio(idJuicio) {
    logger.debug(`getInformacionJuicio idJuicio=${idJuicio}`);
    const { data } = await http.get(`${PATHS.getInformacionJuicio}/${idJuicio}`);
    return data;
  }

  async getIncidenteJudicatura(idJuicio) {
    logger.debug(`getIncidenteJudicatura idJuicio=${idJuicio}`);
    const { data } = await http.get(`${PATHS.getIncidenteJudicatura}/${idJuicio}`);
    return data;
  }

  async actuacionesJudiciales({ idMovimientoJuicioIncidente, idJuicio, idJudicatura, idIncidenteJudicatura, nombreJudicatura, incidente }) {
    logger.debug(`actuacionesJudiciales idJuicio=${idJuicio} incidente=${incidente}`);
    const { data } = await http.post(PATHS.actuacionesJudiciales, {
      idMovimientoJuicioIncidente,
      idJuicio,
      idJudicatura,
      idIncidenteJudicatura,
      aplicativo: 'web',
      nombreJudicatura,
      incidente,
    });
    return data;
  }

  async existeIngresoDirecto(idJuicio, idMovimientoJuicioIncidente) {
    logger.debug(`existeIngresoDirecto idJuicio=${idJuicio}`);
    const { data } = await http.post(PATHS.existeIngresoDirecto, {
      idJuicio,
      idMovimientoJuicioIncidente,
    });
    return data;
  }

  /**
   * Obtiene todas las actuaciones para todos los incidentes de un juicio.
   * Itera sobre la estructura devuelta por getIncidenteJudicatura.
   */
  async getAllActuacionesForJuicio(idJuicio) {
    const incidentes = await this.getIncidenteJudicatura(idJuicio);
    const results = [];

    for (const judicatura of incidentes) {
      for (const inc of judicatura.lstIncidenteJudicatura || []) {
        const actuaciones = await this.actuacionesJudiciales({
          idMovimientoJuicioIncidente: inc.idMovimientoJuicioIncidente,
          idJuicio,
          idJudicatura: judicatura.idJudicatura,
          idIncidenteJudicatura: inc.idIncidenteJudicatura,
          nombreJudicatura: judicatura.nombreJudicatura,
          incidente: inc.incidente,
        });
        results.push({
          idJudicatura: judicatura.idJudicatura,
          nombreJudicatura: judicatura.nombreJudicatura,
          incidente: inc.incidente,
          litigantesActor: inc.lstLitiganteActor,
          litigantesDemandado: inc.lstLitiganteDemandado,
          actuaciones,
        });
      }
    }

    return results;
  }
}

module.exports = new SatjeHttpService();
