const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'drogueria.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL, rol TEXT NOT NULL CHECK (rol IN ('admin','regente','cajero')),
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), creada TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, contacto TEXT,
  dias_devolucion INTEGER NOT NULL DEFAULT 60, activo INTEGER NOT NULL DEFAULT 1
);
-- El stock se guarda en unidad mínima (tableta, ml, sobre). "factor" = unidades por empaque.
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE, nombre TEXT NOT NULL, principio_activo TEXT,
  laboratorio TEXT, presentacion TEXT, categoria TEXT,
  requiere_formula INTEGER NOT NULL DEFAULT 0, control_especial INTEGER NOT NULL DEFAULT 0,
  invima TEXT, iva REAL NOT NULL DEFAULT 0,
  factor INTEGER NOT NULL DEFAULT 1, precio_venta REAL NOT NULL DEFAULT 0, precio_unidad REAL,
  costo REAL NOT NULL DEFAULT 0, stock_min REAL NOT NULL DEFAULT 0,
  proveedor_id INTEGER REFERENCES proveedores(id), activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL REFERENCES productos(id),
  lote TEXT NOT NULL, vence TEXT NOT NULL, cantidad INTEGER NOT NULL DEFAULT 0,
  costo_unidad REAL NOT NULL DEFAULT 0, compra_id INTEGER, creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lotes_prod ON lotes(producto_id, vence);
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, proveedor_id INTEGER REFERENCES proveedores(id), factura TEXT,
  fecha TEXT NOT NULL, total REAL NOT NULL DEFAULT 0, usuario_id INTEGER
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, documento TEXT UNIQUE, telefono TEXT,
  saldo REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pagos_cliente (
  id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL, valor REAL NOT NULL, medio TEXT NOT NULL, usuario_id INTEGER, caja_id INTEGER
);
CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, abierta TEXT NOT NULL, cerrada TEXT,
  base REAL NOT NULL DEFAULT 0, efectivo_contado REAL, estado TEXT NOT NULL DEFAULT 'abierta'
);
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, usuario_id INTEGER NOT NULL, caja_id INTEGER,
  cliente_id INTEGER REFERENCES clientes(id), subtotal REAL NOT NULL, descuento REAL NOT NULL DEFAULT 0,
  iva REAL NOT NULL DEFAULT 0, total REAL NOT NULL, medio_pago TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ok'
);
CREATE TABLE IF NOT EXISTS venta_items (
  id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL REFERENCES ventas(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id), lote_id INTEGER NOT NULL REFERENCES lotes(id),
  cantidad INTEGER NOT NULL, precio_unit REAL NOT NULL, descuento_pct REAL NOT NULL DEFAULT 0,
  iva REAL NOT NULL DEFAULT 0, total REAL NOT NULL, costo_unit REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS formulas (
  id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL REFERENCES ventas(id),
  numero TEXT, fecha_formula TEXT, paciente TEXT NOT NULL, documento_paciente TEXT,
  medico TEXT NOT NULL, registro_medico TEXT NOT NULL, institucion TEXT, observaciones TEXT
);
-- Kardex: todo movimiento de inventario
CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, tipo TEXT NOT NULL, producto_id INTEGER NOT NULL,
  lote_id INTEGER, cantidad INTEGER NOT NULL, motivo TEXT, usuario_id INTEGER, ref_id INTEGER
);
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alertas_log (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, tipo TEXT NOT NULL, destino TEXT NOT NULL,
  mensaje TEXT NOT NULL, estado TEXT NOT NULL, detalle TEXT, firma TEXT
);
`);

const DEFAULTS = {
  nombre_negocio: 'Droguería',
  alerta_destinos: '',            // números WhatsApp separados por coma, formato 573001234567
  alerta_hora: '07:30',           // resumen diario
  dias_reposicion: '5',           // días que tarda en llegar un pedido
  dias_vence_critico: '30',
  dias_vence_atencion: '90',
  ventana_rotacion: '60',         // días de historia para calcular rotación
  promo_auto: '1',                // aplicar descuento sugerido por vencimiento en el POS
  descuento_max_pct: '40',
};
const getCfg = db.prepare('SELECT valor FROM config WHERE clave = ?');
const setCfg = db.prepare('INSERT INTO config(clave,valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor');

function cfg(clave) {
  const r = getCfg.get(clave);
  return r ? r.valor : DEFAULTS[clave];
}
function cfgNum(clave) { return Number(cfg(clave)); }
function allCfg() { return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, cfg(k)])); }

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Fechas en hora local (TZ del servidor, por defecto America/Bogota) para que "el día" coincida con el de la tienda
const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
const hoy = () => fmt(new Date()).slice(0, 10);
const ahora = () => fmt(new Date());

module.exports = { db, tx, cfg, cfgNum, allCfg, setCfg, DEFAULTS, hoy, ahora, fmt };
