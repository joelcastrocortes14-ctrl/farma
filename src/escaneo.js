const { db, cfgNum, hoy } = require('./db');
const { HttpError, diasEntre, precioUnidad, semaforoProductos } = require('./inventory');

/**
 * Consulta por código de barras o QR. El QR de un lote puede traer "CODIGO|LOTE"
 * para verificar además ese lote concreto.
 */
function consultar(texto) {
  const raw = String(texto || '').trim();
  if (!raw) throw new HttpError(400, 'Código vacío');
  const [codigo, loteQR] = raw.includes('|') ? raw.split('|').map(s => s.trim()) : [raw, null];
  const p = db.prepare(`SELECT p.*, pr.nombre AS proveedor, pr.telefono AS proveedor_tel, pr.dias_entrega
    FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id WHERE p.codigo = ? AND p.activo = 1`).get(codigo);
  if (!p) throw new HttpError(404, `El código ${codigo} no está registrado en tu inventario`);

  const crit = cfgNum('dias_vence_critico'), aten = cfgNum('dias_vence_atencion'), hoyStr = hoy();
  const lotes = db.prepare(`SELECT l.id, l.lote, l.vence, l.cantidad, l.costo_unidad, pr.nombre AS proveedor
    FROM lotes l LEFT JOIN compras c ON c.id = l.compra_id LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
    WHERE l.producto_id = ? AND l.cantidad > 0 ORDER BY l.vence, l.id`).all(p.id).map(l => {
    const dias = diasEntre(hoyStr, l.vence);
    return { ...l, dias, estado: dias < 0 ? 'vencido' : dias <= crit ? 'critico' : dias <= aten ? 'atencion' : 'ok', bloqueado: dias < 0 };
  });
  const fefo = lotes.find(l => !l.bloqueado) || null;
  const vendible = lotes.filter(l => !l.bloqueado).reduce((s, l) => s + l.cantidad, 0);

  const avisos = [];
  if (loteQR) {
    const conocido = db.prepare('SELECT * FROM lotes WHERE producto_id = ? AND lote = ?').get(p.id, loteQR);
    const enLista = lotes.find(l => l.lote === loteQR);
    if (!conocido) avisos.push({ nivel: 'rojo', texto: `El lote ${loteQR} NO aparece en tus compras. Verifica la procedencia y el registro INVIMA antes de venderlo.` });
    else if (enLista?.bloqueado) avisos.push({ nivel: 'rojo', texto: `El lote ${loteQR} está VENCIDO: no se puede vender.` });
    else if (enLista && fefo && enLista.id !== fefo.id) avisos.push({ nivel: 'amarillo', texto: `Sale primero el lote ${fefo.lote} (vence el ${fefo.vence}).` });
    else if (!enLista) avisos.push({ nivel: 'amarillo', texto: `El lote ${loteQR} ya no tiene existencias.` });
  }
  if (lotes.some(l => l.bloqueado)) avisos.push({ nivel: 'rojo', texto: 'Hay lotes vencidos de este producto: retíralos de la venta.' });
  if (!p.invima) avisos.push({ nivel: 'amarillo', texto: 'Este producto no tiene registro INVIMA cargado.' });
  if (!vendible) avisos.push({ nivel: 'rojo', texto: 'Sin existencias vendibles.' });

  const sem = semaforoProductos().get(p.id) || { color: 'verde', motivo: '' };
  return {
    id: p.id, codigo: p.codigo, nombre: p.nombre, presentacion: p.presentacion, principio_activo: p.principio_activo, laboratorio: p.laboratorio,
    invima: p.invima, requiere_formula: !!p.requiere_formula, control_especial: !!p.control_especial, foto: !!p.foto, factor: p.factor,
    precio_empaque: p.precio_venta, precio_unidad: precioUnidad(p), proveedor: p.proveedor, proveedor_tel: p.proveedor_tel, dias_entrega: p.dias_entrega,
    vendible, lotes, lote_fefo: fefo?.lote || null, lote_consultado: loteQR, avisos, semaforo: sem.color, semaforo_motivo: sem.motivo,
  };
}

module.exports = { consultar };
