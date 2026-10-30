const crypto = require('node:crypto');
const { db, cfg, setCfg, hoy, ahora } = require('./db');
const { analisisVencimientos, stockCritico, sugerenciasPedido } = require('./inventory');
const { enviarWhatsApp, limpiar, proveedor } = require('./whatsapp');

const MAX_LINEAS = 15;
const destinos = () => cfg('alerta_destinos').split(',').map(s => s.trim()).filter(Boolean);
const firma = ids => crypto.createHash('sha1').update([...ids].sort().join(',')).digest('hex').slice(0, 12);
const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');

function listar(lineas) {
  const extra = lineas.length - MAX_LINEAS;
  return lineas.slice(0, MAX_LINEAS).join('\n') + (extra > 0 ? `\n… y ${extra} más (ver el sistema)` : '');
}

function mensajeStock(items) {
  const negocio = cfg('nombre_negocio');
  const lineas = items.map(p => {
    const emp = (p.vendible / p.factor).toFixed(p.factor > 1 ? 1 : 0).replace('.0', '');
    const ped = p.sugerido_empaques ? ` → pedir ${p.sugerido_empaques}${p.urgencia === 'hoy' ? ' HOY' : p.urgencia === 'manana' ? ' mañana' : ''}` : '';
    return `${p.nivel === 'agotado' ? '[AGOTADO]' : '[CRÍTICO]'} ${p.nombre}: ${emp} en stock (mín ${p.stock_min})${ped}`;
  });
  return `*${negocio} – ALERTA: Stock crítico* (${items.length})\n${listar(lineas)}`;
}

function mensajeVence(items) {
  const negocio = cfg('nombre_negocio');
  const lineas = items.map(l => {
    const cuando = l.dias < 0 ? `VENCIDO hace ${-l.dias} d` : `vence en ${l.dias} d`;
    return `${l.estado === 'vencido' ? '[VENCIDO]' : '[POR VENCER]'} ${l.nombre} lote ${l.lote}: ${l.cantidad} u, ${cuando}${l.promo_pct ? ` (sug. ${l.promo_pct}% off)` : ''}`;
  });
  const riesgo = items.reduce((s, l) => s + l.valor_riesgo, 0);
  return `*${negocio} – ALERTA: Vencimientos* (${items.length} lotes, ${pesos(riesgo)} en riesgo)\n${listar(lineas)}`;
}

function ultimaFirma(tipo, destino) {
  return db.prepare("SELECT firma, fecha FROM alertas_log WHERE tipo = ? AND destino = ? AND estado != 'error' ORDER BY id DESC LIMIT 1").get(tipo, destino);
}

async function despachar(tipo, mensaje, f, force) {
  const res = [];
  for (const d of destinos()) {
    const prev = ultimaFirma(tipo, d);
    // No repetir la misma alerta el mismo día; si cambia el conjunto de productos o es otro día, sí
    if (!force && prev && prev.firma === f && prev.fecha.slice(0, 10) === hoy()) { res.push({ destino: d, tipo, estado: 'omitido' }); continue; }
    const r = await enviarWhatsApp(d, mensaje);
    db.prepare('INSERT INTO alertas_log(fecha,tipo,destino,mensaje,estado,detalle,firma) VALUES(?,?,?,?,?,?,?)')
      .run(ahora(), tipo, limpiar(d), mensaje, r.estado, r.detalle, f);
    res.push({ destino: d, tipo, estado: r.estado, detalle: r.detalle });
  }
  return res;
}

/** Revisa stock crítico y vencimientos y avisa por WhatsApp solo si hay novedades. */
let enCurso = false;
async function revisarAlertas({ force = false } = {}) {
  if (enCurso) return { enviadas: [], pendiente: true };
  enCurso = true;
  try {
    const stock = stockCritico();
    const vence = analisisVencimientos({ soloAlerta: true }).filter(l => l.estado === 'vencido' || l.estado === 'critico' || l.riesgo_unidades > 0);
    const out = [];
    if (destinos().length) {
      if (stock.length) out.push(...await despachar('stock', mensajeStock(stock), firma(stock.map(p => `${p.id}:${p.nivel}`)), force));
      if (vence.length) out.push(...await despachar('vencimiento', mensajeVence(vence), firma(vence.map(l => `${l.lote_id}:${l.estado}`)), force));
    }
    return { stock_critico: stock.length, lotes_alerta: vence.length, sin_destinos: !destinos().length, enviadas: out };
  } finally { enCurso = false; }
}

/** Pedido sugerido agrupado por proveedor, con texto listo para enviar por WhatsApp. */
function pedidosSugeridos() {
  const grupos = new Map();
  for (const p of sugerenciasPedido()) {
    const k = p.proveedor || 'Sin proveedor';
    if (!grupos.has(k)) grupos.set(k, { proveedor: k, telefono: p.proveedor_tel || null, items: [] });
    grupos.get(k).items.push({ producto_id: p.id, nombre: p.nombre, empaques: p.sugerido_empaques, nivel: p.nivel });
  }
  return [...grupos.values()].map(g => {
    const texto = `Hola, necesito el siguiente pedido para ${cfg('nombre_negocio')}:\n` + g.items.map(i => `• ${i.nombre} x ${i.empaques}`).join('\n') + '\nGracias.';
    const wa = g.telefono ? `https://wa.me/${limpiar(g.telefono)}?text=${encodeURIComponent(texto)}` : null;
    return { ...g, texto, wa_link: wa };
  });
}

/** Tarea periódica: revisa cada 15 min (con deduplicación) y fuerza un resumen diario a la hora configurada. */
function iniciarPlanificador() {
  const tick = async () => {
    try {
      const [h, m] = cfg('alerta_hora').split(':').map(Number);
      const d = new Date();
      const esHora = d.getHours() > h || (d.getHours() === h && d.getMinutes() >= m);
      const yaHoy = db.prepare("SELECT valor FROM config WHERE clave = 'ultimo_resumen'").get()?.valor === hoy();
      const diario = esHora && !yaHoy;
      if (diario) setCfg.run('ultimo_resumen', hoy());
      await revisarAlertas({ force: diario });
    } catch (e) { console.error('[alertas]', e.message); }
  };
  const t = setInterval(tick, 15 * 60 * 1000);
  t.unref();
  setTimeout(tick, 5000).unref();
  return t;
}

/** Al cerrar una caja avisa a los números configurados: ventas, efectivo y diferencia. */
async function avisarCierre(c) {
  if (cfg('aviso_cierre') !== '1' || !destinos().length) return [];
  const total = Object.values(c.por_medio).reduce((s, v) => s + v, 0);
  const dif = c.diferencia ?? 0;
  const mensaje = `*${cfg('nombre_negocio')}* - Cierre de caja\nCajero: ${c.cajero}\nVentas: ${c.ventas} por ${pesos(total)}\n` +
    Object.entries(c.por_medio).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${pesos(v)}`).join('\n') +
    `\nEfectivo esperado: ${pesos(c.efectivo_esperado)} / contado: ${pesos(c.efectivo_contado)}\n` +
    (dif === 0 ? 'Caja cuadrada.' : `*DIFERENCIA: ${dif > 0 ? 'sobran' : 'faltan'} ${pesos(Math.abs(dif))}*`);
  const out = [];
  for (const d of destinos()) {
    const r = await enviarWhatsApp(d, mensaje);
    db.prepare('INSERT INTO alertas_log(fecha,tipo,destino,mensaje,estado,detalle) VALUES(?,?,?,?,?,?)').run(ahora(), 'cierre', limpiar(d), mensaje, r.estado, r.detalle);
    out.push({ destino: d, estado: r.estado });
  }
  return out;
}

/** Qué falta para que WhatsApp envíe de verdad (sin revelar los secretos). */
function estadoWhatsApp() {
  const p = proveedor(), faltan = [];
  if (p === 'meta') { if (!process.env.WA_TOKEN) faltan.push('WA_TOKEN'); if (!process.env.WA_PHONE_ID) faltan.push('WA_PHONE_ID'); }
  else if (p === 'twilio') for (const v of ['TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM']) if (!process.env[v]) faltan.push(v);
  return { proveedor: p, listo: p !== 'simulado' && !faltan.length, faltan, destinos: destinos().length, plantilla: !!process.env.WA_TEMPLATE };
}

/** Envía un mensaje corto a los números configurados para comprobar que todo funciona. */
async function mensajePrueba() {
  const lista = destinos();
  if (!lista.length) return { sin_destinos: true, resultados: [] };
  const mensaje = `*${cfg('nombre_negocio')}*: mensaje de prueba de VitalTrack. Si lo ves, las alertas por WhatsApp funcionan.`;
  const resultados = [];
  for (const d of lista) {
    const r = await enviarWhatsApp(d, mensaje);
    db.prepare('INSERT INTO alertas_log(fecha,tipo,destino,mensaje,estado,detalle) VALUES(?,?,?,?,?,?)').run(ahora(), 'prueba', limpiar(d), mensaje, r.estado, r.detalle);
    resultados.push({ destino: d, estado: r.estado, detalle: r.detalle });
  }
  return { sin_destinos: false, resultados };
}

module.exports = { avisarCierre, estadoWhatsApp, mensajePrueba, revisarAlertas, pedidosSugeridos, iniciarPlanificador, mensajeStock, mensajeVence };
