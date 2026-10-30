const { db, cfg, ahora, fmt } = require('./db');
const { HttpError, stockDe } = require('./inventory');
const { enviarWhatsApp, limpiar } = require('./whatsapp');

const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');

/** CRM ligero: qué compra el cliente, cada cuánto y cuánto debe. */
function historial(id) {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Cliente no existe');
  const ventas = db.prepare("SELECT id, fecha, total, medio_pago FROM ventas WHERE cliente_id = ? AND estado = 'ok' ORDER BY id DESC LIMIT 15").all(id);
  const frecuentes = db.prepare(`SELECT p.id AS producto_id, p.nombre, SUM(vi.cantidad) AS unidades, COUNT(DISTINCT v.id) AS veces, MAX(v.fecha) AS ultima, MIN(v.fecha) AS primera
    FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.id = vi.producto_id
    WHERE v.cliente_id = ? AND v.estado = 'ok' GROUP BY p.id ORDER BY veces DESC, unidades DESC LIMIT 10`).all(id).map(f => ({
    ...f, ultima: f.ultima.slice(0, 10),
    cada_dias: f.veces > 1 ? Math.round((Date.parse(f.ultima) - Date.parse(f.primera)) / 86400000 / (f.veces - 1)) : null,
  }));
  const resumen = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) t, MAX(fecha) u FROM ventas WHERE cliente_id = ? AND estado = 'ok'").get(id);
  const avisos = db.prepare(`SELECT a.id, a.creado, a.avisado, p.nombre FROM avisos a JOIN productos p ON p.id = a.producto_id WHERE a.cliente_id = ? ORDER BY a.id DESC LIMIT 20`).all(id);
  return { cliente: c, ventas, frecuentes, avisos, compras: resumen.n, gastado: resumen.t, ultima_compra: resumen.u ? resumen.u.slice(0, 10) : null };
}

function crearAviso(clienteId, productoId) {
  if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(clienteId)) throw new HttpError(404, 'Cliente no existe');
  if (!db.prepare('SELECT 1 FROM productos WHERE id = ? AND activo = 1').get(productoId)) throw new HttpError(404, 'Producto no existe');
  const ya = db.prepare('SELECT id FROM avisos WHERE cliente_id = ? AND producto_id = ? AND avisado IS NULL').get(clienteId, productoId);
  if (ya) return { id: ya.id, repetido: true };
  return { id: Number(db.prepare('INSERT INTO avisos(cliente_id, producto_id, creado) VALUES(?,?,?)').run(clienteId, productoId, ahora()).lastInsertRowid) };
}

const mensaje = (nombre, producto) => `Hola ${nombre.split(' ')[0]}, le informamos que ya llegó ${producto} a ${cfg('nombre_negocio')}. Lo esperamos.`;

async function enviarAviso(a) {
  const r = a.telefono ? await enviarWhatsApp(a.telefono, a.mensaje) : { estado: 'error', detalle: 'El cliente no tiene teléfono' };
  db.prepare('INSERT INTO alertas_log(fecha,tipo,destino,mensaje,estado,detalle) VALUES(?,?,?,?,?,?)').run(ahora(), 'cliente', limpiar(a.telefono || '-'), a.mensaje, r.estado, r.detalle);
  if (r.estado !== 'error') db.prepare('UPDATE avisos SET avisado = ? WHERE id = ?').run(ahora(), a.id);
  return { id: a.id, cliente: a.nombre, producto: a.producto, estado: r.estado, detalle: r.detalle };
}

const pendientesBase = () => db.prepare(`SELECT a.id, a.producto_id, c.nombre, c.telefono, p.nombre AS producto FROM avisos a
  JOIN clientes c ON c.id = a.cliente_id JOIN productos p ON p.id = a.producto_id WHERE a.avisado IS NULL`).all()
  .map(a => ({ ...a, mensaje: mensaje(a.nombre, a.producto), disponible: stockDe(a.producto_id) > 0 }));

/** Al ingresar mercancía: avisa por WhatsApp a quienes pidieron que se les avisara. */
async function avisarLlegada(productoIds) {
  const set = new Set(productoIds);
  const out = [];
  for (const a of pendientesBase()) if (set.has(a.producto_id) && a.disponible) out.push(await enviarAviso(a));
  return out;
}

/**
 * Para el panel: avisos pedidos por clientes y, aparte, clientes habituales (2+ compras en 120 días)
 * de productos que llegaron esta semana. Los habituales NO se avisan solos: los decide la droguería.
 */
function pendientes() {
  const explicitos = pendientesBase().map(a => ({ ...a, wa_link: a.telefono ? `https://wa.me/${limpiar(a.telefono)}?text=${encodeURIComponent(a.mensaje)}` : null }));
  const desde = fmt(new Date(Date.now() - 7 * 86400000));
  const hace120 = fmt(new Date(Date.now() - 120 * 86400000));
  const nuevos = db.prepare('SELECT DISTINCT producto_id FROM lotes WHERE creado >= ? AND cantidad > 0').all(desde).map(r => r.producto_id);
  const habituales = [];
  for (const pid of nuevos) {
    const prod = db.prepare('SELECT nombre FROM productos WHERE id = ?').get(pid);
    const filas = db.prepare(`SELECT c.id, c.nombre, c.telefono, COUNT(DISTINCT v.id) AS veces FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN clientes c ON c.id = v.cliente_id
      WHERE vi.producto_id = ? AND v.estado = 'ok' AND v.fecha >= ? GROUP BY c.id HAVING veces >= 2 AND c.telefono IS NOT NULL`).all(pid, hace120);
    for (const f of filas) {
      const m = mensaje(f.nombre, prod.nombre);
      habituales.push({ cliente_id: f.id, nombre: f.nombre, telefono: f.telefono, producto_id: pid, producto: prod.nombre, veces: f.veces, mensaje: m, wa_link: `https://wa.me/${limpiar(f.telefono)}?text=${encodeURIComponent(m)}` });
    }
  }
  return { explicitos, habituales };
}

async function enviarAvisoId(id) {
  const a = pendientesBase().find(x => x.id === Number(id));
  if (!a) throw new HttpError(404, 'Aviso no encontrado o ya enviado');
  return enviarAviso(a);
}

module.exports = { historial, crearAviso, avisarLlegada, pendientes, enviarAvisoId, pesos };
