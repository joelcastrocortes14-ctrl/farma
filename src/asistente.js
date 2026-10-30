/**
 * Asistente de preguntas en lenguaje natural sobre el inventario y las ventas.
 * Funciona con reglas (sin servicio externo ni costo): detecta la intención y filtra por
 * categoría, principio activo o nombre. Responde con texto y, cuando aplica, una lista.
 */
const { db, cfg, hoy, fmt } = require('./db');
const { analisisVencimientos, stockCritico, sugerenciasPedido } = require('./inventory');
const { reporteVentas } = require('./sales');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');

// Palabras de una pregunta -> términos que se buscan en nombre, principio activo y categoría
const SINONIMOS = {
  antibiotico: ['antibiotico', 'amoxicilina', 'azitromicina', 'cefalexina', 'ciprofloxacino', 'claritromicina', 'doxiciclina', 'penicilina', 'dicloxacilina', 'metronidazol'],
  analgesico: ['analgesico', 'acetaminofen', 'ibuprofeno', 'diclofenaco', 'naproxeno', 'tramadol', 'dolex'],
  dolor: ['analgesico', 'acetaminofen', 'ibuprofeno', 'diclofenaco', 'naproxeno', 'tramadol', 'dolex'],
  alergia: ['antihistaminico', 'loratadina', 'cetirizina', 'clorfeniramina'],
  antihistaminico: ['antihistaminico', 'loratadina', 'cetirizina', 'clorfeniramina'],
  presion: ['antihipertensivo', 'losartan', 'enalapril', 'amlodipino', 'captopril'],
  hipertension: ['antihipertensivo', 'losartan', 'enalapril', 'amlodipino', 'captopril'],
  antihipertensivo: ['antihipertensivo', 'losartan', 'enalapril', 'amlodipino', 'captopril'],
  diabetes: ['antidiabetico', 'metformina', 'glibenclamida'],
  antidiabetico: ['antidiabetico', 'metformina', 'glibenclamida'],
  gripa: ['gripa', 'dolex', 'antigripal', 'loratadina', 'acetaminofen'],
  estomago: ['gastrico', 'omeprazol', 'ranitidina', 'antiacido'],
  gastrico: ['gastrico', 'omeprazol', 'ranitidina', 'antiacido'],
  control: ['control especial'],
};
const STOP = new Set(('que cuales cual cuantos cuantas cuanta cuanto me mi mis quedan queda con de del la el los las hay tengo tienes tiene tenemos stock bajo poco baja esta este esa semana mes hoy ayer ' +
  'venc vence vencen vencer vencimiento vencimientos vencido vencidos por para en un una y o a al se acaba acabando acabar productos producto medicamentos medicamento lotes lote ' +
  'dias dia proximos proximas siguientes precio precios cuesta vale cuestan pedir pedido pedidos pide agotado agotados critico criticos criticas necesito debo comprar reponer ' +
  'muestrame dame dime listame lista ver mostrar quiero saber hay algun alguna todos todas estan estoy ventas vendi vendido vendidos vendo mas menos top').split(' '));

const singular = t => t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;

function terminos(q) {
  return norm(q).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)).map(singular);
}
function expandir(ts) {
  return ts.map(t => [...new Set([t, ...(SINONIMOS[t] || SINONIMOS[Object.keys(SINONIMOS).find(k => k.startsWith(t) || t.startsWith(k)) || ''] || [])])]);
}
/** Todos los términos de la pregunta deben encontrarse (alguno de sus sinónimos) en el producto. */
function filtro(q) {
  const grupos = expandir(terminos(q));
  if (!grupos.length) return { activo: false, coincide: () => true, texto: '' };
  const mapa = new Map(db.prepare('SELECT id, nombre, principio_activo, categoria, control_especial, requiere_formula FROM productos WHERE activo = 1').all()
    .map(p => [p.id, norm(`${p.nombre} ${p.principio_activo || ''} ${p.categoria || ''} ${p.control_especial ? 'control especial' : ''}`)]));
  return { activo: true, texto: terminos(q).join(' '), coincide: id => grupos.every(g => g.some(t => (mapa.get(id) || '').includes(t))) };
}

const stockTxt = (u, f) => f > 1 ? `${Math.floor(u / f)} emp + ${u % f} u` : `${u} u`;

function ayuda() {
  return { respuesta: 'Puedes preguntarme, por ejemplo:', ejemplos: [
    '¿Qué antibióticos me quedan con stock bajo?', '¿Qué vence esta semana?', '¿Qué debo pedir?', '¿Cuánto vendí hoy?',
    '¿Cuánto acetaminofén tengo?', '¿Cuáles son los más vendidos?', '¿Quién me debe?', 'Productos de control especial con poco stock'] };
}

const RESERVADO = { respuesta: 'Esa información (ventas, utilidad y cartera) es solo para el regente o el administrador.', items: [] };

function preguntar(pregunta, rol) {
  const q = norm(pregunta).trim();
  if (!q) return ayuda();
  const f = filtro(pregunta);
  const sin = (algo) => ({ respuesta: f.activo ? `No encontré ${algo} que coincidan con "${f.texto}".` : `No hay ${algo}.`, items: [] });

  if (/^(hola|buenas|ayuda|help|que puedes|como funciona)/.test(q)) return ayuda();

  // Ventas
  if (/vend|ventas|factur/.test(q) && !/mas vendido|top|mejor/.test(q) && !/vence|stock/.test(q)) {
    if (rol === 'cajero') return RESERVADO;
    const dias = /ayer/.test(q) ? 1 : /semana/.test(q) ? 7 : /mes/.test(q) ? 30 : 0;
    const desde = fmt(new Date(Date.now() - dias * 86400000)).slice(0, 10);
    const hasta = /ayer/.test(q) ? desde : hoy();
    const r = reporteVentas({ desde, hasta });
    const cuando = /ayer/.test(q) ? 'ayer' : /semana/.test(q) ? 'en los últimos 7 días' : /mes/.test(q) ? 'en los últimos 30 días' : 'hoy';
    return { respuesta: `Vendiste ${pesos(r.total)} ${cuando} (${r.ventas} ventas). Utilidad bruta: ${pesos(r.utilidad)}.`,
      items: r.top.slice(0, 5).map(t => ({ titulo: t.nombre, detalle: `${t.unidades} u`, etiqueta: pesos(t.total), tono: 'azul' })) };
  }
  if (/mas vendido|top|mejor|rotan|rotacion/.test(q)) {
    if (rol === 'cajero') return RESERVADO;
    const r = reporteVentas({ desde: fmt(new Date(Date.now() - 30 * 86400000)).slice(0, 10), hasta: hoy() });
    return { respuesta: 'Los más vendidos de los últimos 30 días:', items: r.top.map(t => ({ titulo: t.nombre, detalle: `${t.unidades} u`, etiqueta: pesos(t.total), tono: 'azul' })) };
  }
  // Cartera
  if (/\b(me )?deben?\b|quien(es)? (me )?debe|fiado|cartera|por cobrar|me adeuda/.test(q) && !/pedir|pedido|pide/.test(q)) {
    if (rol === 'cajero') return RESERVADO;
    const cl = db.prepare('SELECT nombre, saldo FROM clientes WHERE saldo > 0 ORDER BY saldo DESC LIMIT 15').all();
    if (!cl.length) return { respuesta: 'Nadie te debe nada.', items: [] };
    return { respuesta: `Te deben ${pesos(cl.reduce((s, c) => s + c.saldo, 0))} en total:`, items: cl.map(c => ({ titulo: c.nombre, detalle: '', etiqueta: pesos(c.saldo), tono: 'ambar' })) };
  }
  // Vencimientos
  if (/venc|caduc|expira/.test(q)) {
    const m = q.match(/(\d+)\s*d/); const mes = q.match(/(\d+)\s*mes/);
    const dias = /hoy/.test(q) ? 0 : /semana/.test(q) ? 7 : mes ? Number(mes[1]) * 30 : /mes/.test(q) ? 30 : m ? Number(m[1]) : /vencido/.test(q) ? -1 : 30;
    const lotes = analisisVencimientos().filter(l => l.dias <= dias && f.coincide(l.producto_id));
    const cuando = dias === -1 ? 'ya vencidos' : dias === 0 ? 'que vencen hoy o ya vencieron' : `que vencen en ${dias} días o menos`;
    if (!lotes.length) return sin(`lotes ${cuando}`);
    return { respuesta: `${lotes.length} lote(s) ${cuando}${f.activo ? ` (${f.texto})` : ''}. Dinero en riesgo: ${pesos(lotes.reduce((s, l) => s + l.valor_riesgo, 0))}.`,
      items: lotes.slice(0, 20).map(l => ({ titulo: `${l.nombre} · lote ${l.lote}`, detalle: `${stockTxt(l.cantidad, l.factor)} · vence ${l.vence}${l.accion ? ' · ' + l.accion : ''}`,
        etiqueta: l.dias < 0 ? `vencido ${-l.dias} d` : `${l.dias} d`, tono: l.dias <= 30 ? 'rojo' : 'ambar' })) };
  }
  // Pedido sugerido
  if (/pedir|pedido|comprar|reponer|surtir|pide/.test(q)) {
    const ps = sugerenciasPedido().filter(p => f.coincide(p.id));
    if (!ps.length) return sin('productos por pedir');
    return { respuesta: `Te sugiero pedir ${ps.length} producto(s):`, items: ps.slice(0, 20).map(p => ({ titulo: p.nombre, detalle: p.sugerencia, etiqueta: `${p.sugerido_empaques} emp`, tono: p.urgencia === 'pronto' ? 'ambar' : 'rojo' })) };
  }
  // Stock bajo / agotado
  if (/stock|agota|acab|quedan|queda|poco|bajo|critic|minimo/.test(q) && !/cuant[oa]s?\b/.test(q)) {
    const ps = stockCritico({ incluirPronto: true }).filter(p => f.coincide(p.id));
    if (!ps.length) return sin('productos con stock bajo');
    return { respuesta: `${ps.length} producto(s) con stock bajo${f.activo ? ` (${f.texto})` : ''}:`, items: ps.slice(0, 25).map(p => ({
      titulo: p.nombre, detalle: `${stockTxt(p.vendible, p.factor)} · mínimo ${p.stock_min} emp · ${p.sugerencia || p.motivo}`, etiqueta: p.nivel, tono: p.nivel === 'pronto' ? 'ambar' : 'rojo' })) };
  }
  // Existencias / precio de un producto
  const prods = db.prepare(`SELECT p.*, COALESCE((SELECT SUM(cantidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence >= ?),0) AS stock
    FROM productos p WHERE p.activo = 1 ORDER BY p.nombre`).all(hoy()).filter(p => f.coincide(p.id));
  if (f.activo && prods.length) {
    return { respuesta: `Encontré ${prods.length} producto(s):`, items: prods.slice(0, 20).map(p => ({ titulo: p.nombre, detalle: `${p.presentacion || ''} · ${stockTxt(p.stock, p.factor)} en stock`,
      etiqueta: pesos(p.precio_venta), tono: p.stock ? 'verde' : 'rojo' })) };
  }
  if (f.activo) return sin('productos');
  return ayuda();
}

module.exports = { preguntar };
