const { db, tx, cfgNum, hoy, ahora, fmt } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);
// Más allá de este horizonte no se proyecta riesgo (la rotación histórica deja de ser confiable)
const HORIZONTE_DIAS = 180;
const precioUnidad = p => p.precio_unidad ?? p.precio_venta / (p.factor || 1);
const fechaValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Unidades vendidas por día de cada producto en la ventana de rotación. */
function rotacion() {
  const dias = cfgNum('ventana_rotacion');
  const desde = fmt(new Date(Date.now() - dias * 86400000));
  const rows = db.prepare(`
    SELECT vi.producto_id, SUM(vi.cantidad) AS u
    FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
    WHERE v.estado = 'ok' AND v.fecha >= ? GROUP BY vi.producto_id`).all(desde);
  return new Map(rows.map(r => [r.producto_id, r.u / dias]));
}

/**
 * Vencimiento inteligente: para cada lote estima cuántas unidades NO alcanzarán a venderse
 * antes de vencer (según la rotación real y el orden FEFO) y sugiere qué hacer.
 */
function analisisVencimientos({ soloAlerta = false } = {}) {
  const hoyStr = hoy();
  const crit = cfgNum('dias_vence_critico');
  const aten = cfgNum('dias_vence_atencion');
  const maxDesc = cfgNum('descuento_max_pct');
  const vel = rotacion();

  const filas = db.prepare(`
    SELECT l.id AS lote_id, l.lote, l.vence, l.cantidad, l.costo_unidad,
           p.id AS producto_id, p.nombre, p.presentacion, p.factor, p.precio_venta, p.precio_unidad,
           pr.nombre AS proveedor, COALESCE(pr.dias_devolucion, 60) AS dias_devolucion
    FROM lotes l JOIN productos p ON p.id = l.producto_id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    WHERE l.cantidad > 0 AND p.activo = 1
    ORDER BY l.producto_id, l.vence, l.id`).all();

  const delante = new Map(); // unidades que se venderán antes (FEFO) por producto
  const out = [];
  for (const f of filas) {
    const dias = diasEntre(hoyStr, f.vence);
    const v = vel.get(f.producto_id) || 0;
    const previo = delante.get(f.producto_id) || 0;
    const vendible = v * Math.max(dias, 0);
    let riesgo = dias < 0 ? f.cantidad : Math.min(f.cantidad, Math.max(0, previo + f.cantidad - vendible));
    riesgo = dias > HORIZONTE_DIAS ? 0 : Math.ceil(riesgo - 1e-9);
    if (dias >= 0) delante.set(f.producto_id, previo + f.cantidad);

    let estado = 'ok';
    if (dias < 0) estado = 'vencido';
    else if (dias <= crit) estado = 'critico';
    else if (dias <= aten || riesgo > 0) estado = 'atencion';

    // descuento sugerido: escalonado por cercanía, sin vender por debajo de costo + 2%
    let promo = 0;
    if (dias >= 0 && riesgo > 0) {
      const base = dias <= 15 ? 40 : dias <= 30 ? 30 : dias <= 60 ? 20 : 10;
      const pu = precioUnidad(f);
      const tope = pu > 0 ? Math.floor((1 - (f.costo_unidad * 1.02) / pu) * 100) : 0;
      promo = Math.max(0, Math.min(base, tope, maxDesc));
    }

    let accion = '';
    if (estado === 'vencido') accion = 'Retirar de la venta y dar de baja (acta de destrucción)';
    else if (riesgo > 0 && dias <= f.dias_devolucion) accion = `Pedir canje/devolución a ${f.proveedor || 'proveedor'}${promo ? ` o vender con ${promo}% off` : ''}`;
    else if (riesgo > 0) accion = promo ? `Promocionar con ${promo}% de descuento` : 'Rotar: ubicar al frente / sugerir al cliente';
    else if (estado !== 'ok') accion = 'Vender primero (FEFO)';

    out.push({
      ...f, dias, estado, riesgo_unidades: riesgo, promo_pct: promo, accion,
      rotacion_dia: Number(v.toFixed(2)),
      valor_riesgo: Math.round(riesgo * f.costo_unidad),
    });
  }
  const orden = { vencido: 0, critico: 1, atencion: 2, ok: 3 };
  out.sort((a, b) => orden[a.estado] - orden[b.estado] || a.dias - b.dias);
  return soloAlerta ? out.filter(l => l.estado !== 'ok') : out;
}

const redondeo = n => Math.max(1, Math.round(n));
const ORDEN_NIVEL = { agotado: 0, critico: 1, pronto: 2, ok: 3 };

/**
 * Stock vendible (sin vencidos) vs. mínimo y vs. rotación real.
 * "margen" = días de cobertura menos los días que tarda el proveedor en entregar:
 * con 20 u/día, 40 en stock y entrega en 1 día, el margen es 1 -> "Pide mañana o te quedas sin stock".
 * Niveles: agotado, critico (bajo mínimo o se acaba antes de que llegue el pedido), pronto (margen <= 3 d), ok.
 */
function stockCritico({ todos = false, incluirPronto = false } = {}) {
  const hoyStr = hoy();
  const repos = cfgNum('dias_reposicion');
  const vel = rotacion();
  const rows = db.prepare(`
    SELECT p.id, p.codigo, p.nombre, p.presentacion, p.factor, p.stock_min, p.costo, p.categoria,
           pr.nombre AS proveedor, pr.telefono AS proveedor_tel, pr.dias_entrega AS entrega,
           COALESCE(SUM(CASE WHEN l.vence >= ? THEN l.cantidad ELSE 0 END), 0) AS vendible,
           COALESCE(SUM(CASE WHEN l.vence <  ? THEN l.cantidad ELSE 0 END), 0) AS vencido
    FROM productos p LEFT JOIN lotes l ON l.producto_id = p.id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    WHERE p.activo = 1 GROUP BY p.id ORDER BY p.nombre`).all(hoyStr, hoyStr);

  const out = [];
  for (const p of rows) {
    const v = vel.get(p.id) || 0;
    const minU = p.stock_min * p.factor;
    const lead = p.entrega ?? repos;
    const cobertura = v > 0 ? p.vendible / v : null;
    const margen = cobertura === null ? null : cobertura - lead;
    let nivel = 'ok', motivo = '', sugerencia = '', urgencia = null;

    if (p.vendible <= 0 && (minU > 0 || v > 0)) {
      nivel = 'agotado'; motivo = 'Sin existencias vendibles'; sugerencia = 'Agotado: pide hoy.'; urgencia = 'hoy';
    } else if (minU > 0 && p.vendible <= minU) {
      nivel = 'critico'; motivo = 'Por debajo del mínimo';
    } else if (margen !== null && margen <= 0) {
      nivel = 'critico'; motivo = `Se agota en ~${redondeo(cobertura)} d y el pedido tarda ${lead} d`;
    } else if (margen !== null && margen <= 3) {
      nivel = 'pronto'; motivo = `Se agota en ~${redondeo(cobertura)} d`;
    }
    if (nivel !== 'ok' && nivel !== 'agotado') {
      if (margen !== null && margen <= 0) { sugerencia = `Pide HOY: se agota en ~${redondeo(cobertura)} d y el pedido tarda ${lead} d.`; urgencia = 'hoy'; }
      else if (margen !== null && margen <= 1) { sugerencia = `Pide mañana o te quedas sin stock (se agota en ~${redondeo(cobertura)} d).`; urgencia = 'manana'; }
      else if (margen !== null) { sugerencia = `Pide en ${Math.floor(margen)} días (se agota en ~${redondeo(cobertura)} d).`; urgencia = 'pronto'; }
      else { sugerencia = 'Por debajo del mínimo: pídelo en tu próximo pedido.'; urgencia = 'pronto'; }
    }
    const objetivo = Math.max(v * (lead + 14), minU * 2);
    const sugerido = nivel === 'ok' ? 0 : Math.max(1, Math.ceil((objetivo - p.vendible) / p.factor));
    const agota = cobertura === null ? null : fmt(new Date(Date.now() + cobertura * 86400000)).slice(0, 10);
    out.push({ ...p, entrega: lead, rotacion_dia: Number(v.toFixed(2)), cobertura_dias: cobertura === null ? null : Number(cobertura.toFixed(1)),
      margen_dias: margen === null ? null : Number(margen.toFixed(1)), fecha_agota: agota, nivel, motivo, sugerencia, urgencia, sugerido_empaques: sugerido });
  }
  if (todos) return out;
  return out.filter(p => p.nivel !== 'ok' && (incluirPronto || p.nivel !== 'pronto'))
    .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || (a.margen_dias ?? 99) - (b.margen_dias ?? 99));
}

/** Lista de pedido: todo lo crítico más lo que se agotará en pocos días, con el texto "pide mañana…". */
const sugerenciasPedido = () => stockCritico({ incluirPronto: true });

/** Semáforo por producto: verde = bien, amarillo = vence en <= 90 d o stock en camino de agotarse, rojo = vencido / vence <= 30 d / stock bajo. */
function semaforoProductos() {
  const aten = cfgNum('dias_vence_atencion'), crit = cfgNum('dias_vence_critico');
  const m = new Map();
  const marca = (id, color, motivo) => {
    const prev = m.get(id);
    if (!prev || (color === 'rojo' && prev.color !== 'rojo')) m.set(id, { color, motivos: [...(prev?.motivos || []), motivo] });
    else prev.motivos.push(motivo);
  };
  for (const l of analisisVencimientos()) {
    if (l.dias < 0) marca(l.producto_id, 'rojo', `Lote ${l.lote} vencido`);
    else if (l.dias <= crit) marca(l.producto_id, 'rojo', `Lote ${l.lote} vence en ${l.dias} d`);
    else if (l.dias <= aten) marca(l.producto_id, 'amarillo', `Lote ${l.lote} vence en ${l.dias} d`);
  }
  for (const p of stockCritico({ incluirPronto: true })) {
    if (p.nivel === 'pronto') marca(p.id, 'amarillo', p.motivo);
    else marca(p.id, 'rojo', p.nivel === 'agotado' ? 'Agotado' : `Stock bajo: ${p.motivo.toLowerCase()}`);
  }
  return new Map([...m].map(([id, v]) => [id, { color: v.color, motivo: v.motivos.join(' · ') }]));
}

function stockDe(producto_id) {
  return db.prepare('SELECT COALESCE(SUM(cantidad),0) AS n FROM lotes WHERE producto_id = ? AND vence >= ?').get(producto_id, hoy()).n;
}

/** Ingreso de mercancía: crea lotes y actualiza costo del producto. Cantidades en empaques. */
function registrarCompra({ proveedor_id, factura, items, usuario_id }) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'La compra no tiene ítems');
  return tx(() => {
    const fecha = ahora();
    const compra = db.prepare('INSERT INTO compras(proveedor_id, factura, fecha, usuario_id) VALUES(?,?,?,?)')
      .run(proveedor_id || null, factura || null, fecha, usuario_id);
    let total = 0;
    for (const it of items) {
      const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(it.producto_id);
      if (!p) throw new HttpError(400, `Producto ${it.producto_id} no existe`);
      const emp = Number(it.cantidad);
      if (!(emp > 0)) throw new HttpError(400, `Cantidad inválida para ${p.nombre}`);
      if (!it.lote) throw new HttpError(400, `Falta el lote de ${p.nombre}`);
      if (!fechaValida(it.vence)) throw new HttpError(400, `Fecha de vencimiento inválida para ${p.nombre} (AAAA-MM-DD)`);
      if (it.vence < hoy()) throw new HttpError(400, `${p.nombre} lote ${it.lote} ya está vencido: no se puede ingresar`);
      const costoEmp = Number(it.costo) || 0;
      const unidades = Math.round(emp * p.factor);
      const costoU = costoEmp / p.factor;
      const lote = db.prepare('INSERT INTO lotes(producto_id, lote, vence, cantidad, costo_unidad, compra_id, creado) VALUES(?,?,?,?,?,?,?)')
        .run(p.id, String(it.lote).trim(), it.vence, unidades, costoU, compra.lastInsertRowid, fecha);
      db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,motivo,usuario_id,ref_id) VALUES(?,?,?,?,?,?,?,?)')
        .run(fecha, 'compra', p.id, lote.lastInsertRowid, unidades, factura || null, usuario_id, compra.lastInsertRowid);
      if (costoEmp > 0) db.prepare('UPDATE productos SET costo = ? WHERE id = ?').run(costoEmp, p.id);
      total += emp * costoEmp;
    }
    db.prepare('UPDATE compras SET total = ? WHERE id = ?').run(total, compra.lastInsertRowid);
    return { id: Number(compra.lastInsertRowid), total };
  });
}

/** Baja de inventario (vencido, daño, pérdida) o ajuste por conteo. cantidad en unidades. */
function ajustarLote({ lote_id, cantidad, motivo, usuario_id }) {
  const n = Math.round(Number(cantidad));
  if (!(n > 0)) throw new HttpError(400, 'Cantidad inválida');
  if (!motivo) throw new HttpError(400, 'Indica el motivo de la baja');
  return tx(() => {
    const l = db.prepare('SELECT * FROM lotes WHERE id = ?').get(lote_id);
    if (!l) throw new HttpError(404, 'Lote no existe');
    if (n > l.cantidad) throw new HttpError(400, `El lote solo tiene ${l.cantidad} unidades`);
    db.prepare('UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?').run(n, l.id);
    db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,motivo,usuario_id) VALUES(?,?,?,?,?,?,?)')
      .run(ahora(), 'baja', l.producto_id, l.id, -n, motivo, usuario_id);
    return { ok: true };
  });
}

/**
 * Ajuste por conteo físico: deja el lote con la cantidad real contada (en unidades).
 * Queda en el kardex como "ajuste"; si faltaba producto, cuenta como pérdida en el reporte.
 */
function contarLote({ lote_id, cantidad, modo, usuario_id }) {
  return tx(() => {
    const l = db.prepare('SELECT l.*, p.factor FROM lotes l JOIN productos p ON p.id = l.producto_id WHERE l.id = ?').get(lote_id);
    if (!l) throw new HttpError(404, 'Lote no existe');
    const n = Number(cantidad);
    if (!(n >= 0) || !Number.isFinite(n)) throw new HttpError(400, 'Escribe la cantidad contada (0 o más)');
    const real = Math.round(modo === 'empaque' ? n * l.factor : n);
    const diff = real - l.cantidad;
    if (diff === 0) throw new HttpError(400, 'La cantidad contada es igual a la del sistema: no hay nada que ajustar');
    db.prepare('UPDATE lotes SET cantidad = ? WHERE id = ?').run(real, l.id);
    db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,motivo,usuario_id) VALUES(?,?,?,?,?,?,?)')
      .run(ahora(), 'ajuste', l.producto_id, l.id, diff, `Conteo físico (sistema ${l.cantidad}, contado ${real})`, usuario_id);
    return { antes: l.cantidad, ahora: real, diferencia: diff };
  });
}

module.exports = { HttpError, diasEntre, precioUnidad, fechaValida, rotacion, analisisVencimientos, stockCritico, sugerenciasPedido, semaforoProductos, stockDe, registrarCompra, ajustarLote, contarLote };
