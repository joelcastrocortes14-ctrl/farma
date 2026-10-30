/** Reportes a Excel (.xlsx): inventario con lotes, ventas con detalle, pedido sugerido y cartera de clientes. */
const { db, hoy, cfg } = require('./db');
const { HttpError, fechaValida, analisisVencimientos, stockCritico, sugerenciasPedido, semaforoProductos } = require('./inventory');
const { construirXlsx } = require('./xlsx');

const ticket = id => 'VT-' + String(id).padStart(6, '0');
const redondeo = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function inventario() {
  const sem = semaforoProductos(), hoyStr = hoy();
  const rot = new Map(stockCritico({ todos: true }).map(p => [p.id, p]));
  const prods = db.prepare(`SELECT p.*, pr.nombre AS proveedor,
      COALESCE((SELECT SUM(cantidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence >= ?), 0) AS vendible,
      COALESCE((SELECT SUM(cantidad * costo_unidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence >= ?), 0) AS valor,
      COALESCE((SELECT SUM(cantidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence < ?), 0) AS vencido,
      COALESCE((SELECT SUM(cantidad * costo_unidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence < ?), 0) AS valor_vencido
    FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id WHERE p.activo = 1 ORDER BY p.nombre`).all(hoyStr, hoyStr, hoyStr, hoyStr);
  const filasP = prods.map(p => [
    p.codigo, p.nombre, p.presentacion, p.categoria, p.proveedor, p.control_especial ? 'Control especial' : p.requiere_formula ? 'Con fórmula' : 'Libre',
    p.factor, p.precio_venta, p.costo, redondeo(p.vendible / p.factor, 2), p.vendible, p.stock_min, Math.round(p.valor), p.vencido, Math.round(p.valor_vencido),
    rot.get(p.id)?.rotacion_dia ?? 0, sem.get(p.id)?.color || 'verde', sem.get(p.id)?.motivo || '', p.invima,
  ]);
  const filasL = analisisVencimientos().map(l => [
    l.nombre, l.lote, l.vence, l.dias, l.estado, redondeo(l.cantidad / l.factor, 2), l.cantidad, redondeo(l.costo_unidad * l.factor, 0),
    Math.round(l.cantidad * l.costo_unidad), l.riesgo_unidades, l.valor_riesgo, l.accion, l.rotacion_dia, l.proveedor,
  ]);
  return {
    nombre: 'inventario',
    hojas: [
      { nombre: 'Productos', columnas: [
        { titulo: 'Código', ancho: 16 }, { titulo: 'Producto', ancho: 34 }, { titulo: 'Presentación', ancho: 26 }, { titulo: 'Categoría', ancho: 16 }, { titulo: 'Proveedor', ancho: 22 }, { titulo: 'Tipo', ancho: 15 },
        { titulo: 'Unidades por empaque', tipo: 'entero', ancho: 12 }, { titulo: 'Precio de venta (empaque)', tipo: 'dinero', ancho: 16 }, { titulo: 'Costo (empaque)', tipo: 'dinero', ancho: 14 },
        { titulo: 'Existencia vendible (empaques)', tipo: 'decimal', ancho: 16 }, { titulo: 'Existencia vendible (unidades)', tipo: 'entero', ancho: 16 }, { titulo: 'Stock mínimo (empaques)', tipo: 'decimal', ancho: 14 },
        { titulo: 'Valor a costo', tipo: 'dinero', ancho: 14 }, { titulo: 'Unidades vencidas', tipo: 'entero', ancho: 12 }, { titulo: 'Valor vencido a costo', tipo: 'dinero', ancho: 14 },
        { titulo: 'Ventas por día (u)', tipo: 'decimal', ancho: 12 }, { titulo: 'Semáforo', ancho: 11 }, { titulo: 'Motivo del semáforo', ancho: 40 }, { titulo: 'INVIMA', ancho: 22 }], filas: filasP },
      { nombre: 'Lotes', columnas: [
        { titulo: 'Producto', ancho: 34 }, { titulo: 'Lote', ancho: 14 }, { titulo: 'Vence', tipo: 'fecha', ancho: 12 }, { titulo: 'Días para vencer', tipo: 'entero', ancho: 12 }, { titulo: 'Estado', ancho: 11 },
        { titulo: 'Cantidad (empaques)', tipo: 'decimal', ancho: 13 }, { titulo: 'Cantidad (unidades)', tipo: 'entero', ancho: 13 }, { titulo: 'Costo (empaque)', tipo: 'dinero', ancho: 13 },
        { titulo: 'Valor a costo', tipo: 'dinero', ancho: 13 }, { titulo: 'Unidades en riesgo', tipo: 'entero', ancho: 12 }, { titulo: 'Dinero en riesgo', tipo: 'dinero', ancho: 13 },
        { titulo: 'Qué hacer', ancho: 46 }, { titulo: 'Ventas por día (u)', tipo: 'decimal', ancho: 12 }, { titulo: 'Proveedor', ancho: 22 }], filas: filasL },
    ],
  };
}

function ventas({ desde, hasta }) {
  const d = fechaValida(desde || '') ? desde : hoy().slice(0, 8) + '01';
  const h = fechaValida(hasta || '') ? hasta : hoy();
  if (d > h) throw new HttpError(400, 'La fecha "desde" es posterior a "hasta"');
  const vs = db.prepare(`SELECT v.*, u.nombre AS cajero, c.nombre AS cliente FROM ventas v JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE substr(v.fecha, 1, 10) BETWEEN ? AND ? ORDER BY v.id`).all(d, h);
  const det = db.prepare(`SELECT vi.*, v.fecha, v.estado, p.nombre, l.lote, l.vence FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
    JOIN productos p ON p.id = vi.producto_id JOIN lotes l ON l.id = vi.lote_id WHERE substr(v.fecha, 1, 10) BETWEEN ? AND ? ORDER BY vi.venta_id, vi.id`).all(d, h);
  return {
    nombre: `ventas-${d}-a-${h}`,
    hojas: [
      { nombre: 'Ventas', columnas: [
        { titulo: 'Ticket', ancho: 11 }, { titulo: 'Fecha', tipo: 'fechahora', ancho: 17 }, { titulo: 'Cajero', ancho: 18 }, { titulo: 'Cliente', ancho: 22 }, { titulo: 'Medio de pago', ancho: 14 },
        { titulo: 'Subtotal', tipo: 'dinero', ancho: 12 }, { titulo: 'Descuento', tipo: 'dinero', ancho: 12 }, { titulo: 'IVA', tipo: 'dinero', ancho: 10 }, { titulo: 'Total', tipo: 'dinero', ancho: 12 },
        { titulo: 'Estado', ancho: 10 }, { titulo: 'Con fórmula', ancho: 11 }],
        filas: vs.map(v => [ticket(v.id), v.fecha, v.cajero, v.cliente, v.medio_pago, v.subtotal, v.descuento, v.iva, v.total, v.estado === 'ok' ? 'Válida' : 'Anulada', v.receta_id ? 'Sí' : 'No']) },
      { nombre: 'Detalle', columnas: [
        { titulo: 'Ticket', ancho: 11 }, { titulo: 'Fecha', tipo: 'fechahora', ancho: 17 }, { titulo: 'Producto', ancho: 34 }, { titulo: 'Lote', ancho: 14 }, { titulo: 'Vence', tipo: 'fecha', ancho: 12 },
        { titulo: 'Cantidad (unidades)', tipo: 'entero', ancho: 13 }, { titulo: 'Precio por unidad', tipo: 'decimal', ancho: 13 }, { titulo: 'Descuento %', tipo: 'decimal', ancho: 11 },
        { titulo: 'Total', tipo: 'dinero', ancho: 12 }, { titulo: 'Costo', tipo: 'dinero', ancho: 12 }, { titulo: 'Utilidad', tipo: 'dinero', ancho: 12 }, { titulo: 'Estado', ancho: 10 }],
        filas: det.map(x => [ticket(x.venta_id), x.fecha, x.nombre, x.lote, x.vence, x.cantidad, x.precio_unit, x.descuento_pct, x.total, Math.round(x.cantidad * x.costo_unit), Math.round(x.total - x.iva - x.cantidad * x.costo_unit), x.estado === 'ok' ? 'Válida' : 'Anulada']) },
    ],
  };
}

function pedido() {
  const filas = sugerenciasPedido().map(p => [
    p.nombre, p.proveedor || 'Sin proveedor', p.proveedor_tel, p.entrega, redondeo(p.vendible / p.factor, 2), p.rotacion_dia, p.fecha_agota,
    p.nivel === 'agotado' ? 'Agotado' : p.urgencia === 'hoy' ? 'Pide hoy' : p.urgencia === 'manana' ? 'Pide mañana' : 'Pronto', p.sugerencia || p.motivo, p.sugerido_empaques, p.costo, Math.round(p.sugerido_empaques * p.costo),
  ]);
  return {
    nombre: 'pedido-sugerido',
    hojas: [{ nombre: 'Pedido sugerido', columnas: [
      { titulo: 'Producto', ancho: 34 }, { titulo: 'Proveedor', ancho: 24 }, { titulo: 'Teléfono proveedor', ancho: 16 }, { titulo: 'Entrega (días)', tipo: 'entero', ancho: 10 },
      { titulo: 'Existencia (empaques)', tipo: 'decimal', ancho: 13 }, { titulo: 'Ventas por día (u)', tipo: 'decimal', ancho: 12 }, { titulo: 'Se agota', tipo: 'fecha', ancho: 12 }, { titulo: 'Urgencia', ancho: 13 },
      { titulo: 'Qué hacer', ancho: 56 }, { titulo: 'Pedir (empaques)', tipo: 'entero', ancho: 12 }, { titulo: 'Costo (empaque)', tipo: 'dinero', ancho: 13 }, { titulo: 'Costo estimado', tipo: 'dinero', ancho: 14 }], filas }],
  };
}

function clientes() {
  const cs = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'ok') AS compras,
      (SELECT COALESCE(SUM(total), 0) FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'ok') AS gastado,
      (SELECT MAX(fecha) FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'ok') AS ultima FROM clientes c ORDER BY c.saldo DESC, c.nombre`).all();
  return {
    nombre: 'clientes',
    hojas: [{ nombre: 'Clientes', columnas: [
      { titulo: 'Cliente', ancho: 28 }, { titulo: 'Documento', ancho: 14 }, { titulo: 'Teléfono', ancho: 16 }, { titulo: 'Saldo (fiado)', tipo: 'dinero', ancho: 14 },
      { titulo: 'Compras', tipo: 'entero', ancho: 10 }, { titulo: 'Total comprado', tipo: 'dinero', ancho: 14 }, { titulo: 'Última compra', tipo: 'fecha', ancho: 14 }],
      filas: cs.map(c => [c.nombre, c.documento, c.telefono, c.saldo, c.compras, c.gastado, c.ultima ? c.ultima.slice(0, 10) : null]) }],
  };
}

const TIPOS = { inventario, ventas, pedido, clientes };

function generar(tipo, query) {
  const f = TIPOS[tipo];
  if (!f) throw new HttpError(404, 'Reporte no existe');
  const r = f(query || {});
  return { archivo: `vitaltrack-${r.nombre}.xlsx`, buffer: construirXlsx(r.hojas) };
}

module.exports = { generar, TIPOS };
