/**
 * Envío de WhatsApp. Proveedor según WA_PROVIDER:
 *   meta     -> WhatsApp Cloud API (WA_TOKEN, WA_PHONE_ID, opcional WA_TEMPLATE + WA_TEMPLATE_LANG)
 *   twilio   -> Twilio (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM)
 *   simulado -> (por defecto) no envía, solo registra: útil para probar sin cuenta.
 */
const proveedor = () => (process.env.WA_PROVIDER || 'simulado').toLowerCase();

const limpiar = n => String(n).replace(/\D/g, '');

async function enviarMeta(to, texto) {
  const { WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE, WA_TEMPLATE_LANG } = process.env;
  if (!WA_TOKEN || !WA_PHONE_ID) throw new Error('Faltan WA_TOKEN o WA_PHONE_ID');
  // Fuera de la ventana de 24 h Meta exige plantilla aprobada: se envía el texto como parámetro {{1}}.
  const body = WA_TEMPLATE
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: WA_TEMPLATE, language: { code: WA_TEMPLATE_LANG || 'es' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: texto.replace(/\s*\n\s*/g, ' | ').slice(0, 1024) }] }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } };
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Meta HTTP ${r.status}`);
  return j.messages?.[0]?.id || 'ok';
}

async function enviarTwilio(to, texto) {
  const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM } = process.env;
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) throw new Error('Faltan credenciales de Twilio');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: `whatsapp:+${limpiar(TWILIO_FROM)}`, To: `whatsapp:+${to}`, Body: texto }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Twilio HTTP ${r.status}`);
  return j.sid;
}

/** @returns {{estado:'enviado'|'simulado'|'error', detalle:string}} */
async function enviarWhatsApp(numero, texto) {
  const to = limpiar(numero);
  if (to.length < 10) return { estado: 'error', detalle: `Número inválido: ${numero}` };
  const p = proveedor();
  try {
    if (p === 'meta') return { estado: 'enviado', detalle: await enviarMeta(to, texto) };
    if (p === 'twilio') return { estado: 'enviado', detalle: await enviarTwilio(to, texto) };
    return { estado: 'simulado', detalle: 'WA_PROVIDER=simulado (no se envió realmente)' };
  } catch (e) {
    return { estado: 'error', detalle: e.message };
  }
}

module.exports = { enviarWhatsApp, proveedor, limpiar };
