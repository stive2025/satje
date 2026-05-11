const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randomDelay = (min, max) => delay(min + Math.random() * (max - min));

const humanDelay = () => randomDelay(60, 120);

async function humanType(page, selector, text) {
  await page.click(selector);
  await randomDelay(200, 400);
  for (const char of text) {
    await page.keyboard.type(char, { delay: 60 + Math.random() * 30 });
  }
}

function buildSearchPayload({ cedula = '', nombre = '', numeroCausa = '', provincia = '', page = 1, pageSize = 10 }) {
  return {
    numeroCausa,
    actor: { cedulaActor: '', nombreActor: '' },
    demandado: {
      cedulaDemandado: cedula,
      nombreDemandado: nombre,
    },
    provincia,
    numeroFiscalia: '',
    recaptcha: 'verdad',
    first: page,
    pageSize,
  };
}

module.exports = { delay, randomDelay, humanDelay, humanType, buildSearchPayload };
