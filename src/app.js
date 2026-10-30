const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, cfg, allCfg, setCfg, DEFAULTS, hoy, fmt } = require('./db');
const inv = require('./inventory');
const sales = require('./sales');
const alerts = require('./alerts');
const auth = require('./auth');
const { proveedor: waProveedor } = require('./whatsapp');
const recetas = require('./recetas');
const escaneo = require('./escaneo');
const proveedores = require('./proveedores');
const clientes = require('./clientes');
const asistente = require('./asistente');
const importador = require('./importar');
const respaldo = require('./respaldo');
const exportador = require('./exportar');
const { guardarImagen, rutaImagen } = require('./archivos');

const { HttpError } = inv;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).then(r => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);
const staff = auth.roles('admin', 'regente');
const admin = auth.roles('admin');
const num = v => (v === '' || v == null ? null : Number(v));
const bool = v => (v ? 1 : 0);

/** Lista de primeros pasos para dejar la droguería lista; se marca sola según los datos. */
function pasosIniciales(user) {
  const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const esAdmin = user.rol === 'admin';
  const claveDemo = !!db.prepare('SELECT clave_demo FROM usuarios WHERE id = ?').get(user.id).clave_demo;
  return [
    { id: 'clave', titulo: 'Cambia tu contraseña', detalle: 'Estás usando una contraseña de demostración o muy fácil de adivinar.', hecho: !claveDemo, ir: 'clave' },
    { id: 'negocio', titulo: 'Pon el nombre de tu droguería', detalle: esAdmin ? 'Aparece en los tickets y en los avisos. Está en Configuración.' : 'Aparece en los tickets y en los avisos. Pídeselo al administrador.', hecho: cfg('nombre_negocio') !== 'Mi Droguería', ir: esAdmin ? 'config' : null },
    { id: 'whatsapp', titulo: 'Agrega el WhatsApp para las alertas', detalle: esAdmin ? 'Para recibir los avisos de stock y vencimientos. Está en Configuración.' : 'Para recibir los avisos de stock y vencimientos. Pídeselo al administrador.', hecho: cfg('alerta_destinos').trim() !== '', ir: esAdmin ? 'config' : null },
    { id: 'proveedores', titulo: 'Registra tus proveedores', detalle: 'Con su teléfono y sus días de entrega, el pedido sugerido es más exacto.', hecho: n('proveedores') > 0, ir: 'proveedores' },
    { id: 'productos', titulo: 'Carga tus productos y lotes', detalle: 'Sube tu Excel desde Inventario → Importar de Excel.', hecho: n('productos') > 0 && n('lotes') > 0, ir: 'inventario' },
    { id: 'venta', titulo: 'Haz tu primera venta', detalle: 'Abre caja y vende algo para probar el punto de venta.', hecho: n('ventas') > 0, ir: 'pos' },
  ];
}

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de un proxy (Render, Railway, Fly…) la IP real viene en X-Forwarded-For; sin esto el límite de intentos de login vería una sola IP
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.get('/api/salud', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });   // chequeo de salud para la plataforma
  app.use(express.json({ limit: '4mb' }));
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' }); next(); });

  // ---------- Auth ----------
  app.post('/api/login', wrap((req, res) => {
    const { token, usuario } = auth.login(req.body.usuario, req.body.password, req.ip);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'strict', maxAge: 12 * 3600 * 1000, secure: process.env.COOKIE_SECURE === '1' });
    return usuario;
  }));
  app.post('/api/logout', wrap((req, res) => { auth.logout(req); res.clearCookie('sid'); return { ok: true }; }));
  app.get('/api/me', auth.requireAuth, (req, res) => res.json({ ...req.user, clave_demo: !!db.prepare('SELECT clave_demo FROM usuarios WHERE id = ?').get(req.user.id).clave_demo, caja: sales.cajaActual(req.user) ? true : false, negocio: cfg('nombre_negocio'), whatsapp: waProveedor() }));

  const api = express.Router();
  api.use(auth.requireAuth);
  app.use('/api', api);

  // ---------- Dashboard ----------
  api.get('/dashboard', wrap(req => {
    const venc = inv.analisisVencimientos();
    const stock = inv.stockCritico();
    const hoyR = sales.reporteVentas({});
    const d = {
      total_productos: db.prepare('SELECT COUNT(*) n FROM productos WHERE activo = 1').get().n,
      por_vencer: venc.filter(l => l.dias <= 90).length, vencen_semana: venc.filter(l => l.dias <= 7).length,
      stock_bajo: stock.length, pedido_sugerido: inv.sugerenciasPedido().length,
      ventas_hoy: hoyR.total, num_ventas_hoy: hoyR.ventas, utilidad_hoy: hoyR.utilidad,
      lotes_vencidos: venc.filter(l => l.estado === 'vencido').length,
      lotes_criticos: venc.filter(l => l.estado === 'critico').length,
      valor_en_riesgo: venc.reduce((s, l) => s + l.valor_riesgo, 0),
      stock_critico: stock.length, agotados: stock.filter(p => p.nivel === 'agotado').length,
      cartera: db.prepare('SELECT COALESCE(SUM(saldo),0) s FROM clientes').get().s,
      top_vencer: venc.filter(l => l.estado !== 'ok').slice(0, 5),
      top_stock: inv.sugerenciasPedido().slice(0, 5),
      ventas_7d: sales.reporteVentas({ desde: fmt(new Date(Date.now() - 6 * 864e5)).slice(0, 10), hasta: hoy() }).por_dia,
    };
    // el cajero ve lo operativo del día; la utilidad, la cartera y la tendencia son del regente y el administrador
    if (req.user.rol === 'cajero') Object.assign(d, { utilidad_hoy: null, cartera: null, ventas_7d: null });
    else d.pasos = pasosIniciales(req.user);
    return d;
  }));

  // ---------- Productos ----------
  api.get('/productos', wrap(req => {
    const q = `%${req.query.q || ''}%`;
    const sem = inv.semaforoProductos();
    return db.prepare(`SELECT p.*, pr.nombre AS proveedor,
        COALESCE((SELECT SUM(cantidad) FROM lotes l WHERE l.producto_id = p.id AND l.vence >= ?),0) AS stock
      FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      WHERE p.activo = 1 AND (p.nombre LIKE ? OR p.codigo LIKE ? OR p.principio_activo LIKE ? OR p.categoria LIKE ?) ORDER BY p.nombre LIMIT ?`)
      .all(hoy(), q, q, q, q, Math.min(Number(req.query.limit) || 300, 300))
      .map(p => ({ ...p, tiene_foto: !!p.foto, semaforo: sem.get(p.id)?.color || 'verde', semaforo_motivo: sem.get(p.id)?.motivo || '' }));
  }));
  api.put('/productos/:id/foto', staff, wrap(req => {
    if (!db.prepare('SELECT 1 FROM productos WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'Producto no existe');
    db.prepare('UPDATE productos SET foto = ? WHERE id = ?').run(guardarImagen('fotos', Number(req.params.id), req.body.imagen), req.params.id);
    return { ok: true };
  }));
  api.get('/productos/:id/foto', (req, res, next) => {
    const f = rutaImagen('fotos', req.params.id, db.prepare('SELECT foto FROM productos WHERE id = ?').get(req.params.id)?.foto);
    if (!f) return next(new HttpError(404, 'Sin foto'));
    res.set('Cache-Control', 'private, max-age=300').type(f.mime).sendFile(f.file);
  });
  const camposProducto = b => {
    if (!b.nombre?.trim()) throw new HttpError(400, 'El nombre es obligatorio');
    const factor = Math.max(1, Math.round(Number(b.factor) || 1));
    if (!(Number(b.precio_venta) >= 0)) throw new HttpError(400, 'Precio inválido');
    return [b.codigo?.trim() || null, b.nombre.trim(), b.principio_activo || null, b.laboratorio || null, b.presentacion || null, b.categoria || null,
      bool(b.requiere_formula || b.control_especial), bool(b.control_especial), b.invima || null, Number(b.iva) || 0, factor,
      Number(b.precio_venta), num(b.precio_unidad), Number(b.costo) || 0, Number(b.stock_min) || 0, num(b.proveedor_id)];
  };
  const COLS = 'codigo,nombre,principio_activo,laboratorio,presentacion,categoria,requiere_formula,control_especial,invima,iva,factor,precio_venta,precio_unidad,costo,stock_min,proveedor_id';
  const dup = e => { throw /UNIQUE/.test(e.message) ? new HttpError(409, 'Ya existe un producto con ese código de barras') : e; };
  api.post('/productos', staff, wrap(req => {
    try { return { id: Number(db.prepare(`INSERT INTO productos(${COLS}) VALUES(${COLS.split(',').map(() => '?').join(',')})`).run(...camposProducto(req.body)).lastInsertRowid) }; } catch (e) { dup(e); }
  }));
  api.put('/productos/:id', staff, wrap(req => {
    try { db.prepare(`UPDATE productos SET ${COLS.split(',').map(c => c + '=?').join(',')} WHERE id=?`).run(...camposProducto(req.body), req.params.id); } catch (e) { dup(e); }
    return { ok: true };
  }));
  api.delete('/productos/:id', staff, wrap(req => { db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(req.params.id); return { ok: true }; }));

  api.get('/exportar/:tipo', staff, wrap((req, res) => {
    const { archivo, buffer } = exportador.generar(req.params.tipo, req.query);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${archivo}"` }).send(buffer);
  }));
  api.post('/clave', wrap(req => { auth.cambiarClave(req.user.id, req.body.actual, req.body.nueva); return { ok: true }; }));
  api.get('/respaldos', admin, wrap(() => respaldo.listar()));
  api.post('/respaldos', admin, wrap(() => respaldo.crear()));
  api.get('/respaldos/:nombre', admin, (req, res, next) => { try { res.download(respaldo.rutaDe(req.params.nombre)); } catch (e) { next(e); } });
  api.post('/importar', staff, wrap(req => importador.importar(req.body, req.user)));

  // ---------- Proveedores ----------
  api.get('/proveedores', wrap(() => db.prepare('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre').all()));
  api.post('/proveedores', staff, wrap(req => {
    if (!req.body.nombre?.trim()) throw new HttpError(400, 'Nombre obligatorio');
    return { id: Number(db.prepare('INSERT INTO proveedores(nombre,telefono,contacto,dias_devolucion,dias_entrega) VALUES(?,?,?,?,?)').run(req.body.nombre.trim(), req.body.telefono || null, req.body.contacto || null, Number(req.body.dias_devolucion) || 60, Math.max(0, Number(req.body.dias_entrega) || 1)).lastInsertRowid) };
  }));
  api.put('/proveedores/:id', staff, wrap(req => {
    db.prepare('UPDATE proveedores SET nombre=?,telefono=?,contacto=?,dias_devolucion=?,dias_entrega=? WHERE id=?').run(req.body.nombre, req.body.telefono || null, req.body.contacto || null, Number(req.body.dias_devolucion) || 60, Math.max(0, Number(req.body.dias_entrega) || 1), req.params.id);
    return { ok: true };
  }));

  api.get('/proveedores/:id/detalle', staff, wrap(req => proveedores.detalle(Number(req.params.id))));

  // ---------- Recetas ----------
  api.get('/recetas', wrap(req => recetas.buscarRecetas(req.query.q, { todas: req.query.todas === '1' })));
  api.post('/recetas', wrap(req => recetas.crearReceta(req.body, req.user)));
  api.get('/recetas/:id', wrap(req => recetas.getReceta(Number(req.params.id))));
  api.get('/recetas/:id/imagen', (req, res, next) => {
    const f = rutaImagen('recetas', req.params.id, db.prepare('SELECT imagen FROM recetas WHERE id = ?').get(req.params.id)?.imagen);
    if (!f) return next(new HttpError(404, 'La receta no tiene imagen'));
    res.set('Cache-Control', 'private, max-age=300').type(f.mime).sendFile(f.file);
  });

  // ---------- Escáner, asistente, avisos ----------
  api.get('/escaneo', wrap(req => escaneo.consultar(req.query.c, req.query.id)));
  api.post('/asistente', wrap(req => asistente.preguntar(req.body.pregunta, req.user.rol)));
  api.get('/clientes/:id/historial', wrap(req => clientes.historial(Number(req.params.id))));
  api.post('/clientes/:id/avisos', wrap(req => clientes.crearAviso(Number(req.params.id), Number(req.body.producto_id))));
  api.get('/avisos/pendientes', wrap(() => clientes.pendientes()));
  api.post('/avisos/:id/enviar', staff, wrap(req => clientes.enviarAvisoId(req.params.id)));

  // ---------- Inventario / vencimientos ----------
  api.get('/vencimientos', wrap(req => {
    const l = inv.analisisVencimientos({ soloAlerta: req.query.todos !== '1' && req.query.dias === undefined });
    return req.query.dias === undefined ? l : l.filter(x => x.dias <= Number(req.query.dias));
  }));
  api.get('/stock-critico', wrap(req => inv.stockCritico({ todos: req.query.todos === '1' })));
  api.get('/pedido-sugerido', wrap(() => inv.sugerenciasPedido()));
  api.get('/productos/:id/lotes', wrap(req => db.prepare('SELECT * FROM lotes WHERE producto_id = ? AND cantidad > 0 ORDER BY vence').all(req.params.id)));
  api.post('/lotes/:id/baja', staff, wrap(req => inv.ajustarLote({ lote_id: Number(req.params.id), cantidad: req.body.cantidad, motivo: req.body.motivo, usuario_id: req.user.id })));
  api.get('/etiquetas', staff, wrap(req => {
    const filtros = { producto_id: 'l.producto_id', compra_id: 'l.compra_id', lote_id: 'l.id' };
    const usados = Object.keys(filtros).filter(k => req.query[k] !== undefined);
    if (!usados.length) throw new HttpError(400, 'Indica producto_id, compra_id o lote_id');
    return db.prepare(`SELECT l.id AS lote_id, l.lote, l.vence, l.cantidad, p.id AS producto_id, p.nombre, p.presentacion, p.codigo, p.factor
      FROM lotes l JOIN productos p ON p.id = l.producto_id WHERE l.cantidad > 0 AND ${usados.map(k => filtros[k] + ' = ?').join(' AND ')} ORDER BY p.nombre, l.vence LIMIT 500`)
      .all(...usados.map(k => Number(req.query[k])));
  }));
  api.post('/lotes/:id/conteo', staff, wrap(req => inv.contarLote({ lote_id: Number(req.params.id), cantidad: req.body.cantidad, modo: req.body.modo, usuario_id: req.user.id })));
  api.get('/kardex/:productoId', staff, wrap(req => db.prepare(`SELECT m.*, l.lote, u.nombre AS usuario FROM movimientos m LEFT JOIN lotes l ON l.id = m.lote_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.producto_id = ? ORDER BY m.id DESC LIMIT 200`).all(req.params.productoId)));

  // ---------- Compras ----------
  api.post('/compras', staff, wrap(async req => {
    const r = inv.registrarCompra({ ...req.body, usuario_id: req.user.id });
    const avisos = await clientes.avisarLlegada(req.body.items.map(i => Number(i.producto_id))).catch(() => []);
    return { ...r, avisos };
  }));
  api.get('/compras', staff, wrap(() => db.prepare(`SELECT c.*, p.nombre AS proveedor FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id ORDER BY c.id DESC LIMIT 50`).all()));

  // ---------- POS ----------
  api.get('/pos/buscar', wrap(req => sales.buscarPOS(req.query.q)));
  api.post('/ventas', wrap(req => {
    const v = sales.crearVenta(req.body, req.user);
    setImmediate(() => alerts.revisarAlertas().catch(e => console.error('[alertas]', e.message))); // la venta pudo dejar productos en crítico
    return v;
  }));
  api.get('/ventas', wrap(() => db.prepare(`SELECT v.id, v.fecha, v.total, v.medio_pago, v.estado, u.nombre AS cajero, c.nombre AS cliente,
      EXISTS(SELECT 1 FROM formulas f WHERE f.venta_id = v.id) AS con_formula FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN clientes c ON c.id = v.cliente_id ORDER BY v.id DESC LIMIT 50`).all()));
  api.get('/ventas/:id', wrap(req => sales.getVenta(req.params.id)));
  api.post('/ventas/:id/anular', wrap(req => sales.anularVenta(Number(req.params.id), req.user)));

  // ---------- Caja ----------
  api.get('/caja', wrap(req => { const c = sales.cajaActual(req.user); return c ? sales.resumenCaja(c.id) : null; }));
  api.post('/caja/abrir', wrap(req => sales.abrirCaja(req.body.base, req.user)));
  api.post('/caja/cerrar', wrap(req => sales.cerrarCaja(req.body.contado, req.user)));
  api.get('/caja/historial', staff, wrap(() => db.prepare('SELECT id FROM cajas ORDER BY id DESC LIMIT 20').all().map(r => sales.resumenCaja(r.id))));

  // ---------- Clientes / fiado ----------
  api.get('/clientes', wrap(req => { const q = `%${req.query.q || ''}%`; return db.prepare('SELECT * FROM clientes WHERE nombre LIKE ? OR documento LIKE ? OR telefono LIKE ? ORDER BY nombre LIMIT 100').all(q, q, q); }));
  api.post('/clientes', wrap(req => {
    if (!req.body.nombre?.trim()) throw new HttpError(400, 'Nombre obligatorio');
    try { return { id: Number(db.prepare('INSERT INTO clientes(nombre,documento,telefono) VALUES(?,?,?)').run(req.body.nombre.trim(), req.body.documento?.trim() || null, req.body.telefono || null).lastInsertRowid) }; }
    catch (e) { throw /UNIQUE/.test(e.message) ? new HttpError(409, 'Ya existe un cliente con ese documento') : e; }
  }));
  api.post('/clientes/:id/abonos', wrap(req => sales.abonar({ cliente_id: Number(req.params.id), ...req.body }, req.user)));

  // ---------- Alertas WhatsApp ----------
  api.get('/alertas/pedidos', staff, wrap(() => alerts.pedidosSugeridos()));
  api.get('/alertas/log', staff, wrap(() => db.prepare('SELECT * FROM alertas_log ORDER BY id DESC LIMIT 50').all()));
  api.get('/alertas/estado', staff, wrap(() => alerts.estadoWhatsApp()));
  api.post('/alertas/prueba', staff, wrap(() => alerts.mensajePrueba()));
  api.post('/alertas/revisar', staff, wrap(req => alerts.revisarAlertas({ force: !!req.body.force })));
  api.post('/alertas/vista-previa', staff, wrap(() => ({
    stock: inv.stockCritico().length ? alerts.mensajeStock(inv.stockCritico()) : null,
    vencimiento: (() => { const l = inv.analisisVencimientos({ soloAlerta: true }); return l.length ? alerts.mensajeVence(l) : null; })(),
  })));

  // ---------- Reportes ----------
  api.get('/reportes/perdidas', staff, wrap(req => sales.reportePerdidas(req.query)));
  api.get('/reportes/ventas', staff, wrap(req => sales.reporteVentas(req.query)));
  api.get('/reportes/formulas', staff, wrap((req, res) => {
    const filas = sales.libroFormulas({ desde: req.query.desde, hasta: req.query.hasta, soloControl: req.query.control === '1' });
    if (req.query.formato !== 'csv') return filas;
    const cols = ['fecha', 'numero', 'paciente', 'documento_paciente', 'medico', 'registro_medico', 'institucion', 'medicamentos', 'despachado_por', 'estado'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.type('text/csv').attachment('libro-formulas.csv').send('﻿' + [cols.join(','), ...filas.map(f => cols.map(c => esc(f[c])).join(','))].join('\n'));
  }));

  // ---------- Configuración y usuarios ----------
  api.get('/config', admin, wrap(() => ({ ...allCfg(), _whatsapp_proveedor: waProveedor() })));
  api.put('/config', admin, wrap(req => {
    for (const k of Object.keys(DEFAULTS)) if (req.body[k] !== undefined) setCfg.run(k, String(req.body[k]));
    return allCfg();
  }));
  api.get('/usuarios', admin, wrap(() => db.prepare('SELECT id,nombre,usuario,rol,activo FROM usuarios ORDER BY nombre').all()));
  api.post('/usuarios', admin, wrap(req => {
    const { nombre, usuario, password, rol } = req.body;
    if (!nombre || !usuario || !(password?.length >= 6) || !['admin', 'regente', 'cajero'].includes(rol)) throw new HttpError(400, 'Datos inválidos (contraseña mínimo 6 caracteres)');
    try { return { id: Number(db.prepare('INSERT INTO usuarios(nombre,usuario,hash,rol,clave_demo) VALUES(?,?,?,?,?)').run(nombre, usuario.trim(), auth.hashPassword(password), rol, auth.claveFacil(usuario.trim(), password) ? 1 : 0).lastInsertRowid) }; }
    catch (e) { throw /UNIQUE/.test(e.message) ? new HttpError(409, 'Ese usuario ya existe') : e; }
  }));
  api.put('/usuarios/:id', admin, wrap(req => {
    const { nombre, rol, activo, password } = req.body;
    if (Number(req.params.id) === req.user.id && (activo === false || rol !== 'admin')) throw new HttpError(400, 'No puedes quitarte tu propio acceso de administrador');
    db.prepare('UPDATE usuarios SET nombre=?, rol=?, activo=? WHERE id=?').run(nombre, rol, activo === false ? 0 : 1, req.params.id);
    if (password) { if (password.length < 6) throw new HttpError(400, 'Contraseña mínimo 6 caracteres'); db.prepare('UPDATE usuarios SET hash=?, clave_demo=? WHERE id=?').run(auth.hashPassword(password), auth.claveFacil(req.body.usuario || db.prepare('SELECT usuario FROM usuarios WHERE id=?').get(req.params.id).usuario, password) ? 1 : 0, req.params.id); }
    return { ok: true };
  }));

  // ---------- Estáticos y errores ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use((err, _req, res, _next) => {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
  });
  return app;
}

/** Crea el administrador inicial si la base está vacía. */
function asegurarAdmin() {
  auth.marcarClavesDemo();
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n) return;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
  db.prepare("INSERT INTO usuarios(nombre,usuario,hash,rol,clave_demo) VALUES('Administrador','admin',?,'admin',?)").run(auth.hashPassword(pw), auth.claveFacil('admin', pw) ? 1 : 0);
  // Solo se muestra si la generó el sistema; una contraseña definida por ti no se escribe en los registros
  console.log(process.env.ADMIN_PASSWORD ? '\n  Usuario inicial creado: admin (con la contraseña de ADMIN_PASSWORD)\n' : `\n  Usuario inicial -> admin / ${pw}   (cámbiala en Configuración → Usuarios)\n`);
}

module.exports = { crearApp, asegurarAdmin };
