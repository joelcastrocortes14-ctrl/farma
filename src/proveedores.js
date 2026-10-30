const { db } = require('./db');
const { HttpError } = require('./inventory');

/** Quién te vendió, a cuánto y en cuánto tiempo llega; con comparación de precios entre proveedores. */
function detalle(id) {
  const prov = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  if (!prov) throw new HttpError(404, 'Proveedor no existe');
  const compras = db.prepare('SELECT id, fecha, factura, total FROM compras WHERE proveedor_id = ? ORDER BY id DESC LIMIT 20').all(id);

  // costo por empaque de cada lote comprado, del más reciente al más antiguo
  const filas = db.prepare(`SELECT p.id AS producto_id, p.nombre, c.proveedor_id, c.fecha, ROUND(l.costo_unidad * p.factor) AS costo
    FROM lotes l JOIN compras c ON c.id = l.compra_id JOIN productos p ON p.id = l.producto_id
    WHERE l.costo_unidad > 0 ORDER BY c.id DESC, l.id DESC`).all();
  const porProd = new Map();
  for (const f of filas) {
    if (!porProd.has(f.producto_id)) porProd.set(f.producto_id, []);
    porProd.get(f.producto_id).push(f);
  }
  const productos = [];
  for (const [pid, lista] of porProd) {
    const mios = lista.filter(f => f.proveedor_id === id);
    if (!mios.length) continue;
    const ultimo = mios[0], anterior = mios.find(f => f.costo !== ultimo.costo && f.fecha <= ultimo.fecha);
    // mejor precio reciente entre los OTROS proveedores
    const otros = new Map();
    for (const f of lista) if (f.proveedor_id !== id && f.proveedor_id && !otros.has(f.proveedor_id)) otros.set(f.proveedor_id, f);
    const mejor = [...otros.values()].sort((a, b) => a.costo - b.costo)[0];
    productos.push({
      producto_id: pid, nombre: ultimo.nombre, ultimo_costo: ultimo.costo, fecha: ultimo.fecha.slice(0, 10),
      variacion_pct: anterior ? Math.round((ultimo.costo - anterior.costo) / anterior.costo * 100) : null,
      mejor_otro: mejor && mejor.costo < ultimo.costo ? { proveedor: db.prepare('SELECT nombre FROM proveedores WHERE id = ?').get(mejor.proveedor_id)?.nombre, costo: mejor.costo } : null,
    });
  }
  productos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const total = db.prepare('SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM compras WHERE proveedor_id = ?').get(id);
  return { proveedor: prov, compras, productos, total_comprado: total.t, num_compras: total.n };
}

module.exports = { detalle };
