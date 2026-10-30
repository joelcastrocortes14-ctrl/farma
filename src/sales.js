const { db, tx, cfg, cfgNum, hoy, ahora } = require('./db');
const { HttpError, precioUnidad, analisisVencimientos, semaforoProductos } = require('./inventory');
const { getReceta } = require('./recetas');

const MEDIOS = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];
const esRegente = u => u.rol === 'admin' || u.rol === 'regente';

function buscarPOS(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  const prods = db.prepare(`
    SELECT * FROM productos WHERE activo = 1 AND (codigo = ? OR nombre LIKE ? OR principio_activo LIKE ?)
    ORDER BY (codigo = ?) DESC, nombre LIMIT 25`).all(q, like, like, q);
  if (!prods.length) return [];
  const promos = new Map();
  if (cfg('promo_auto') === '1') {
    for (const l of analisisVencimientos()) {
      if (l.estado !== 'vencido' && l.promo_pct > 0 && !promos.has(l.producto_id)) promos.set(l.producto_id, l);
    }
  }
  const hoyStr = hoy();
  const sem = semaforoProductos();
  return prods.map(p => {
    const lotes = db.prepare('SELECT id, lote, vence, cantidad FROM lotes WHERE producto_id = ? AND cantidad > 0 AND vence >= ? ORDER BY vence, id').all(p.id, hoyStr);
    const stock = lotes.reduce((s, l) => s + l.cantidad, 0);
    const promo = promos.get(p.id);
    return {
      id: p.id, codigo: p.codigo, nombre: p.nombre, presentacion: p.presentacion, principio_activo: p.principio_activo,
      requiere_formula: !!p.requiere_formula, control_especial: !!p.control_especial,
      factor: p.factor, precio_empaque: p.precio_venta, precio_unidad: precioUnidad(p),
      stock, proximo_vence: lotes[0]?.vence || null, proximo_lote: lotes[0]?.lote || null, promo_pct: promo?.promo_pct || 0,
      foto: !!p.foto, semaforo: sem.get(p.id)?.color || 'verde',
    };
  });
}

function crearVenta({ items, cliente_id, medio_pago, receta_id }, usuario) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'El carrito está vacío');
  if (!MEDIOS.includes(medio_pago)) throw new HttpError(400, 'Medio de pago inválido');
  const caja = db.prepare("SELECT * FROM cajas WHERE usuario_id = ? AND estado = 'abierta'").get(usuario.id);
  if (!caja) throw new HttpError(409, 'Debes abrir caja antes de vender');
  if (medio_pago === 'fiado' && !cliente_id) throw new HttpError(400, 'El fiado requiere un cliente');
  const maxDesc = cfgNum('descuento_max_pct');

  return tx(() => {
    const hoyStr = hoy();
    let necesitaFormula = false, hayControl = false;
    const lineas = [];
    const rx = new Map(); // unidades de medicamentos con fórmula pedidas por producto

    for (const it of items) {
      const p = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(it.producto_id);
      if (!p) throw new HttpError(400, `Producto ${it.producto_id} no existe`);
      const n = Number(it.cantidad);
      if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Cantidad inválida para ${p.nombre}`);
      const porEmpaque = it.modo === 'empaque';
      let unidades = porEmpaque ? n * p.factor : n;
      const pedidas = unidades;
      if (p.control_especial) { hayControl = true; if (!esRegente(usuario)) throw new HttpError(403, `${p.nombre} es de control especial: lo debe despachar el regente de farmacia`); }
      if (p.requiere_formula) { necesitaFormula = true; rx.set(p.id, { p, unidades: (rx.get(p.id)?.unidades || 0) + pedidas }); }

      let pct = Math.max(0, Math.min(Number(it.descuento_pct) || 0, maxDesc));
      const pu = porEmpaque ? p.precio_venta / p.factor : precioUnidad(p);
      const costoU = p.costo / p.factor;
      if (pct > 0 && pu * (1 - pct / 100) < costoU && !esRegente(usuario)) throw new HttpError(403, `Descuento por debajo del costo en ${p.nombre}: requiere regente`);

      // FEFO: primero lo que vence antes; nunca lotes vencidos
      const lotes = db.prepare('SELECT * FROM lotes WHERE producto_id = ? AND cantidad > 0 AND vence >= ? ORDER BY vence, id').all(p.id, hoyStr);
      const disponible = lotes.reduce((s, l) => s + l.cantidad, 0);
      if (unidades > disponible) {
        const vencidas = db.prepare('SELECT COALESCE(SUM(cantidad),0) n FROM lotes WHERE producto_id = ? AND vence < ?').get(p.id, hoyStr).n;
        throw new HttpError(409, vencidas && disponible === 0
          ? `BLOQUEADO: ${p.nombre} solo tiene unidades VENCIDAS (${vencidas} u). No se puede facturar.`
          : `Stock insuficiente de ${p.nombre}: hay ${disponible} unidades vendibles${vencidas ? ` (y ${vencidas} vencidas bloqueadas)` : ''}`);
      }
      for (const l of lotes) {
        if (unidades <= 0) break;
        const toma = Math.min(l.cantidad, unidades);
        unidades -= toma;
        lineas.push({ p, lote: l, cantidad: toma, pu, pct, costoU: l.costo_unidad || costoU });
      }
    }

    // Medicamentos con fórmula: solo se despacha lo recetado y hasta el saldo de la receta
    let receta = null;
    if (necesitaFormula) {
      if (!receta_id) throw new HttpError(400, 'Esta venta incluye medicamentos con fórmula: selecciona o registra la receta');
      receta = getReceta(receta_id);
      if (!receta.vigente) throw new HttpError(409, `La fórmula venció el ${receta.vence}`);
      if (hayControl && !receta.documento_paciente) throw new HttpError(400, 'Medicamento de control especial: la receta no tiene documento del paciente');
      for (const { p, unidades } of rx.values()) {
        const it = receta.items.find(i => i.producto_id === p.id);
        if (!it) throw new HttpError(403, `${p.nombre} NO está en la fórmula de ${receta.paciente}: no se puede despachar`);
        if (unidades > it.saldo) throw new HttpError(409, `${p.nombre}: la fórmula solo permite ${it.saldo} unidades más (pediste ${unidades})`);
      }
    }

    let subtotal = 0, descuento = 0, ivaTotal = 0, total = 0;
    for (const l of lineas) {
      const bruto = l.cantidad * l.pu;
      const neto = Math.round(bruto * (1 - l.pct / 100));
      l.total = neto;
      l.iva = Math.round(neto - neto / (1 + l.p.iva / 100)); // precios con IVA incluido
      descuento += Math.round(bruto) - neto;
      ivaTotal += l.iva; total += neto; subtotal += neto - l.iva;
    }

    if (cliente_id && !db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(cliente_id)) throw new HttpError(400, 'Cliente no existe');
    const fecha = ahora();
    const v = db.prepare('INSERT INTO ventas(fecha,usuario_id,caja_id,cliente_id,subtotal,descuento,iva,total,medio_pago) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(fecha, usuario.id, caja.id, cliente_id || null, subtotal, descuento, ivaTotal, total, medio_pago);
    const ventaId = Number(v.lastInsertRowid);

    for (const l of lineas) {
      db.prepare('INSERT INTO venta_items(venta_id,producto_id,lote_id,cantidad,precio_unit,descuento_pct,iva,total,costo_unit) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(ventaId, l.p.id, l.lote.id, l.cantidad, l.pu, l.pct, l.iva, l.total, l.costoU);
      db.prepare('UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?').run(l.cantidad, l.lote.id);
      db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,usuario_id,ref_id) VALUES(?,?,?,?,?,?,?)')
        .run(fecha, 'venta', l.p.id, l.lote.id, -l.cantidad, usuario.id, ventaId);
    }
    if (receta) {
      db.prepare('UPDATE ventas SET receta_id = ? WHERE id = ?').run(receta.id, ventaId);
      for (const { p, unidades } of rx.values()) db.prepare('UPDATE receta_items SET dispensado = dispensado + ? WHERE receta_id = ? AND producto_id = ?').run(unidades, receta.id, p.id);
      db.prepare('INSERT INTO formulas(venta_id,numero,fecha_formula,paciente,documento_paciente,medico,registro_medico,institucion) VALUES(?,?,?,?,?,?,?,?)')
        .run(ventaId, receta.numero, receta.fecha_formula, receta.paciente, receta.documento_paciente, receta.medico, receta.registro_medico, receta.institucion);
    }
    if (medio_pago === 'fiado') db.prepare('UPDATE clientes SET saldo = saldo + ? WHERE id = ?').run(total, cliente_id);
    return getVenta(ventaId);
  });
}

function getVenta(id) {
  const v = db.prepare(`SELECT v.*, u.nombre AS cajero, c.nombre AS cliente FROM ventas v
    JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`).get(id);
  if (!v) throw new HttpError(404, 'Venta no existe');
  v.items = db.prepare(`SELECT vi.*, p.nombre, p.presentacion, l.lote, l.vence FROM venta_items vi
    JOIN productos p ON p.id = vi.producto_id JOIN lotes l ON l.id = vi.lote_id WHERE vi.venta_id = ?`).all(id);
  v.formula = db.prepare('SELECT * FROM formulas WHERE venta_id = ?').get(id) || null;
  return v;
}

function anularVenta(id, usuario) {
  if (!esRegente(usuario)) throw new HttpError(403, 'Solo regente o administrador puede anular ventas');
  return tx(() => {
    const v = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
    if (!v) throw new HttpError(404, 'Venta no existe');
    if (v.estado !== 'ok') throw new HttpError(409, 'La venta ya está anulada');
    for (const it of db.prepare('SELECT * FROM venta_items WHERE venta_id = ?').all(id)) {
      db.prepare('UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?').run(it.cantidad, it.lote_id);
      db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,motivo,usuario_id,ref_id) VALUES(?,?,?,?,?,?,?,?)')
        .run(ahora(), 'anulacion', it.producto_id, it.lote_id, it.cantidad, `Anulación venta ${id}`, usuario.id, id);
    }
    if (v.receta_id) {
      for (const it of db.prepare('SELECT vi.producto_id, SUM(vi.cantidad) n FROM venta_items vi JOIN productos p ON p.id = vi.producto_id WHERE vi.venta_id = ? AND p.requiere_formula = 1 GROUP BY vi.producto_id').all(id))
        db.prepare('UPDATE receta_items SET dispensado = MAX(0, dispensado - ?) WHERE receta_id = ? AND producto_id = ?').run(it.n, v.receta_id, it.producto_id);
    }
    if (v.medio_pago === 'fiado') db.prepare('UPDATE clientes SET saldo = saldo - ? WHERE id = ?').run(v.total, v.cliente_id);
    db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(id);
    return { ok: true };
  });
}

// ---- Caja ----
function cajaActual(usuario) {
  return db.prepare("SELECT * FROM cajas WHERE usuario_id = ? AND estado = 'abierta'").get(usuario.id) || null;
}
function abrirCaja(base, usuario) {
  if (cajaActual(usuario)) throw new HttpError(409, 'Ya tienes una caja abierta');
  const r = db.prepare('INSERT INTO cajas(usuario_id, abierta, base) VALUES(?,?,?)').run(usuario.id, ahora(), Number(base) || 0);
  return resumenCaja(Number(r.lastInsertRowid));
}
function resumenCaja(id) {
  const c = db.prepare('SELECT c.*, u.nombre AS cajero FROM cajas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?').get(id);
  if (!c) throw new HttpError(404, 'Caja no existe');
  const porMedio = Object.fromEntries(MEDIOS.map(m => [m, 0]));
  for (const r of db.prepare("SELECT medio_pago, SUM(total) t, COUNT(*) n FROM ventas WHERE caja_id = ? AND estado='ok' GROUP BY medio_pago").all(id)) porMedio[r.medio_pago] = r.t;
  const nVentas = db.prepare("SELECT COUNT(*) n FROM ventas WHERE caja_id = ? AND estado='ok'").get(id).n;
  const abonosEf = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM pagos_cliente WHERE caja_id = ? AND medio='efectivo'").get(id).t;
  const esperado = c.base + porMedio.efectivo + abonosEf;
  return { ...c, ventas: nVentas, por_medio: porMedio, abonos_efectivo: abonosEf, efectivo_esperado: esperado,
    diferencia: c.efectivo_contado == null ? null : c.efectivo_contado - esperado };
}
function cerrarCaja(contado, usuario) {
  const c = cajaActual(usuario);
  if (!c) throw new HttpError(409, 'No tienes caja abierta');
  db.prepare("UPDATE cajas SET estado='cerrada', cerrada=?, efectivo_contado=? WHERE id=?").run(ahora(), Number(contado) || 0, c.id);
  return resumenCaja(c.id);
}

// ---- Fiado ----
function abonar({ cliente_id, valor, medio }, usuario) {
  const v = Number(valor);
  if (!(v > 0)) throw new HttpError(400, 'Valor inválido');
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(medio)) throw new HttpError(400, 'Medio inválido');
  const caja = cajaActual(usuario);
  return tx(() => {
    const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id);
    if (!c) throw new HttpError(404, 'Cliente no existe');
    if (v > c.saldo) throw new HttpError(400, `El abono supera el saldo (${c.saldo})`);
    db.prepare('INSERT INTO pagos_cliente(cliente_id,fecha,valor,medio,usuario_id,caja_id) VALUES(?,?,?,?,?,?)').run(cliente_id, ahora(), v, medio, usuario.id, caja?.id || null);
    db.prepare('UPDATE clientes SET saldo = saldo - ? WHERE id = ?').run(v, cliente_id);
    return { saldo: c.saldo - v };
  });
}

// ---- Reportes ----
function libroFormulas({ desde, hasta, soloControl }) {
  return db.prepare(`
    SELECT f.*, v.fecha, v.estado, u.nombre AS despachado_por,
      (SELECT group_concat(p.nombre || ' x' || vi.cantidad, '; ') FROM venta_items vi JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = v.id AND p.requiere_formula = 1) AS medicamentos,
      (SELECT MAX(p.control_especial) FROM venta_items vi JOIN productos p ON p.id = vi.producto_id WHERE vi.venta_id = v.id) AS control
    FROM formulas f JOIN ventas v ON v.id = f.venta_id JOIN usuarios u ON u.id = v.usuario_id
    WHERE substr(v.fecha,1,10) BETWEEN ? AND ?
    ${soloControl ? 'AND control = 1' : ''} ORDER BY v.fecha DESC`).all(desde || '0000-01-01', hasta || '9999-12-31');
}

function reporteVentas({ desde, hasta }) {
  const d = desde || hoy(), h = hasta || hoy();
  const resumen = db.prepare(`SELECT COUNT(*) ventas, COALESCE(SUM(total),0) total, COALESCE(SUM(descuento),0) descuentos, COALESCE(SUM(iva),0) iva
    FROM ventas WHERE estado='ok' AND substr(fecha,1,10) BETWEEN ? AND ?`).get(d, h);
  const utilidad = db.prepare(`SELECT COALESCE(SUM(vi.total - vi.iva - vi.cantidad*vi.costo_unit),0) u FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
    WHERE v.estado='ok' AND substr(v.fecha,1,10) BETWEEN ? AND ?`).get(d, h).u;
  const top = db.prepare(`SELECT p.nombre, SUM(vi.cantidad) unidades, SUM(vi.total) total FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id
    JOIN productos p ON p.id=vi.producto_id WHERE v.estado='ok' AND substr(v.fecha,1,10) BETWEEN ? AND ? GROUP BY p.id ORDER BY total DESC LIMIT 10`).all(d, h);
  const porDia = db.prepare(`SELECT substr(fecha,1,10) dia, SUM(total) total FROM ventas WHERE estado='ok' AND substr(fecha,1,10) BETWEEN ? AND ? GROUP BY dia ORDER BY dia`).all(d, h);
  const porMedio = db.prepare(`SELECT medio_pago, SUM(total) total FROM ventas WHERE estado='ok' AND substr(fecha,1,10) BETWEEN ? AND ? GROUP BY medio_pago`).all(d, h);
  return { desde: d, hasta: h, ...resumen, utilidad: Math.round(utilidad), top, por_dia: porDia, por_medio: porMedio };
}

/** Plata perdida por bajas de inventario (vencido, dañado, devolución…), más lo vencido que sigue en bodega y lo que está en riesgo. */
function reportePerdidas({ desde, hasta }) {
  const d = desde || hoy().slice(0, 8) + '01', h = hasta || hoy();
  const filas = db.prepare(`SELECT m.fecha, m.motivo, -m.cantidad AS unidades, p.nombre, l.lote, ROUND(-m.cantidad * l.costo_unidad) AS valor
    FROM movimientos m JOIN productos p ON p.id = m.producto_id JOIN lotes l ON l.id = m.lote_id
    WHERE m.tipo = 'baja' AND substr(m.fecha, 1, 10) BETWEEN ? AND ? ORDER BY m.id DESC`).all(d, h);
  const por = new Map();
  for (const f of filas) { const k = f.motivo || 'Sin motivo'; const x = por.get(k) || { motivo: k, unidades: 0, valor: 0, bajas: 0 }; x.unidades += f.unidades; x.valor += f.valor; x.bajas++; por.set(k, x); }
  const venc = analisisVencimientos();
  return {
    desde: d, hasta: h, total: filas.reduce((s, f) => s + f.valor, 0), bajas: filas.length,
    por_motivo: [...por.values()].sort((a, b) => b.valor - a.valor),
    vencido_en_bodega: Math.round(venc.filter(l => l.estado === 'vencido').reduce((s, l) => s + l.cantidad * l.costo_unidad, 0)),
    en_riesgo: venc.reduce((s, l) => s + l.valor_riesgo, 0),
    detalle: filas.slice(0, 100),
  };
}

module.exports = { reportePerdidas, MEDIOS, buscarPOS, crearVenta, getVenta, anularVenta, cajaActual, abrirCaja, resumenCaja, cerrarCaja, abonar, libroFormulas, reporteVentas };
