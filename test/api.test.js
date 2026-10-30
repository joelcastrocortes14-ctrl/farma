process.env.DB_FILE = ':memory:';
process.env.TZ = 'America/Bogota';
process.env.ADMIN_PASSWORD = 'admin123';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, setCfg, fmt } = require('../src/db');
const { crearApp, asegurarAdmin } = require('../src/app');
const { hashPassword } = require('../src/auth');

const dia = n => fmt(new Date(Date.now() + n * 864e5)).slice(0, 10);
let base, server;

async function sesion(usuario, password) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body) => {
    const res = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b) };
}

test.before(async () => {
  asegurarAdmin();
  db.prepare("INSERT INTO usuarios(nombre,usuario,hash,rol) VALUES('Reg','regente',?,'regente'),('Caj','cajero',?,'cajero')").run(hashPassword('regente1'), hashPassword('cajero1'));
  server = crearApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

let admin, regente, cajero, P = {};

test('login y permisos por rol', async () => {
  admin = await sesion('admin', 'admin123');
  regente = await sesion('regente', 'regente1');
  cajero = await sesion('cajero', 'cajero1');
  assert.equal((await fetch(base + '/api/dashboard')).status, 401);
  const r = await cajero.post('/productos', { nombre: 'X', precio_venta: 1 });
  assert.equal(r.status, 403);
  const bad = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'admin', password: 'mal' }) });
  assert.equal(bad.status, 401);
});

test('catálogo y compra crean lotes en unidades', async () => {
  const mk = async (b) => (await admin.post('/productos', b)).body.id;
  P.para = await mk({ codigo: 'A1', nombre: 'Acetaminofén', factor: 100, precio_venta: 10000, costo: 6000, stock_min: 2 });
  P.amox = await mk({ codigo: 'A2', nombre: 'Amoxicilina', factor: 10, precio_venta: 20000, costo: 10000, requiere_formula: 1, stock_min: 1 });
  P.clon = await mk({ codigo: 'A3', nombre: 'Clonazepam', factor: 30, precio_venta: 15000, costo: 9000, control_especial: 1 });
  P.vit = await mk({ codigo: 'A4', nombre: 'Vitamina', factor: 1, precio_venta: 5000, costo: 3000, stock_min: 5 });
  assert.equal((await admin.post('/productos', { codigo: 'A1', nombre: 'dup', precio_venta: 1 })).status, 409);

  const c = await admin.post('/compras', { factura: 'F1', items: [
    { producto_id: P.para, lote: 'NUEVO', vence: dia(400), cantidad: 2, costo: 6000 },
    { producto_id: P.para, lote: 'VIEJO', vence: dia(40), cantidad: 1, costo: 6000 },
    { producto_id: P.amox, lote: 'L1', vence: dia(200), cantidad: 3, costo: 10000 },
    { producto_id: P.clon, lote: 'L1', vence: dia(200), cantidad: 1, costo: 9000 },
  ] });
  assert.equal(c.status, 200);
  const vencido = await admin.post('/compras', { items: [{ producto_id: P.para, lote: 'X', vence: dia(-1), cantidad: 1, costo: 1 }] });
  assert.equal(vencido.status, 400);
  const fecha = await admin.post('/compras', { items: [{ producto_id: P.para, lote: 'X', vence: '31/12/2030', cantidad: 1, costo: 1 }] });
  assert.equal(fecha.status, 400);
});

test('no se puede vender sin caja abierta', async () => {
  const r = await cajero.post('/ventas', { items: [{ producto_id: P.para, cantidad: 1, modo: 'unidad' }], medio_pago: 'efectivo' });
  assert.equal(r.status, 409);
  for (const s of [admin, regente, cajero]) assert.equal((await s.post('/caja/abrir', { base: 50000 })).status, 200);
});

test('venta fraccionada descuenta FEFO (lote que vence primero)', async () => {
  const r = await cajero.post('/ventas', { items: [{ producto_id: P.para, cantidad: 150, modo: 'unidad' }], medio_pago: 'efectivo' });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 15000); // 150 × (10000/100)
  const lotes = r.body.items.map(i => i.lote);
  assert.deepEqual(lotes, ['VIEJO', 'NUEVO']); // primero VIEJO (100 u), luego 50 de NUEVO
  assert.equal(r.body.items[0].cantidad, 100);
  assert.equal(r.body.items[1].cantidad, 50);
});

test('stock insuficiente se rechaza sin tocar inventario', async () => {
  const antes = db.prepare('SELECT SUM(cantidad) n FROM lotes WHERE producto_id=?').get(P.para).n;
  const r = await cajero.post('/ventas', { items: [{ producto_id: P.para, cantidad: 9999, modo: 'unidad' }], medio_pago: 'efectivo' });
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT SUM(cantidad) n FROM lotes WHERE producto_id=?').get(P.para).n, antes);
});

test('lote vencido nunca se vende', async () => {
  db.prepare("UPDATE lotes SET vence=? WHERE lote='NUEVO'").run(dia(-2)); // vencido después del ingreso
  const r = await cajero.post('/ventas', { items: [{ producto_id: P.para, cantidad: 100, modo: 'unidad' }], medio_pago: 'efectivo' });
  assert.equal(r.status, 409);
  db.prepare("UPDATE lotes SET vence=? WHERE lote='NUEVO'").run(dia(400));
});

test('medicamento con fórmula exige datos de fórmula y la registra', async () => {
  const item = [{ producto_id: P.amox, cantidad: 1, modo: 'empaque' }];
  assert.equal((await cajero.post('/ventas', { items: item, medio_pago: 'efectivo' })).status, 400);
  assert.equal((await cajero.post('/ventas', { items: item, medio_pago: 'efectivo', formula: { paciente: 'Ana' } })).status, 400);
  const ok = await cajero.post('/ventas', { items: item, medio_pago: 'efectivo', formula: { paciente: 'Ana Ruiz', medico: 'Dr. Pérez', registro_medico: 'RM-123', numero: 'F-9' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.total, 20000);
  assert.equal(ok.body.formula.medico, 'Dr. Pérez');
});

test('control especial: solo regente y con documento del paciente', async () => {
  const f = { paciente: 'Luis', medico: 'Dra. Gil', registro_medico: 'RM-5' };
  const item = [{ producto_id: P.clon, cantidad: 1, modo: 'empaque' }];
  assert.equal((await cajero.post('/ventas', { items: item, medio_pago: 'efectivo', formula: { ...f, documento_paciente: '123' } })).status, 403);
  assert.equal((await regente.post('/ventas', { items: item, medio_pago: 'efectivo', formula: f })).status, 400);
  assert.equal((await regente.post('/ventas', { items: item, medio_pago: 'efectivo', formula: { ...f, documento_paciente: '123' } })).status, 200);
  const libro = await regente.get('/reportes/formulas?control=1&desde=2000-01-01&hasta=2999-12-31');
  assert.equal(libro.body.length, 1);
  assert.match(libro.body[0].medicamentos, /Clonazepam/);
  assert.equal((await cajero.get('/reportes/formulas')).status, 403);
});

test('descuento bajo costo requiere regente; tope de descuento', async () => {
  const item = d => [{ producto_id: P.vit, cantidad: 1, modo: 'unidad', descuento_pct: d }];
  db.prepare('UPDATE productos SET costo = 4000 WHERE id = ?').run(P.vit); // 40 % off (3000) queda bajo el costo
  db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(P.vit, 'V1', dia(300), 20, 3000, 'x');
  assert.equal((await cajero.post('/ventas', { items: item(40), medio_pago: 'efectivo' })).status, 403);
  const r = await regente.post('/ventas', { items: item(90), medio_pago: 'efectivo' });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 3000); // topado al 40 % (descuento_max_pct)
});

test('fiado suma a la cartera y el abono la reduce; anular revierte', async () => {
  const cli = (await cajero.post('/clientes', { nombre: 'Rosa', documento: '1' })).body.id;
  assert.equal((await cajero.post('/ventas', { items: [{ producto_id: P.vit, cantidad: 2, modo: 'unidad' }], medio_pago: 'fiado' })).status, 400);
  const v = await cajero.post('/ventas', { items: [{ producto_id: P.vit, cantidad: 2, modo: 'unidad' }], medio_pago: 'fiado', cliente_id: cli });
  assert.equal(v.status, 200);
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id=?').get(cli).saldo, 10000);
  assert.equal((await cajero.post(`/clientes/${cli}/abonos`, { valor: 4000, medio: 'efectivo' })).status, 200);
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id=?').get(cli).saldo, 6000);
  assert.equal((await cajero.post(`/ventas/${v.body.id}/anular`)).status, 403);
  const stock = () => db.prepare('SELECT SUM(cantidad) n FROM lotes WHERE producto_id=?').get(P.vit).n;
  const antes = stock();
  assert.equal((await regente.post(`/ventas/${v.body.id}/anular`)).status, 200);
  assert.equal(stock(), antes + 2);
  assert.equal(db.prepare('SELECT saldo FROM clientes WHERE id=?').get(cli).saldo, -4000);
  assert.equal((await regente.post(`/ventas/${v.body.id}/anular`)).status, 409);
});

test('vencimiento inteligente: riesgo según rotación y descuento sugerido sin perder dinero', async () => {
  const hace = n => fmt(new Date(Date.now() - n * 864e5));
  const prod = (await admin.post('/productos', { codigo: 'R1', nombre: 'Lento', factor: 1, precio_venta: 1000, costo: 700, stock_min: 0 })).body.id;
  const lote = db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(prod, 'L', dia(30), 100, 700, 'x').lastInsertRowid;
  // vende 1 u/día los últimos 60 días → en 30 días se venden ~30 de 100
  const v = db.prepare("INSERT INTO ventas(fecha,usuario_id,total,subtotal,medio_pago) VALUES(?,1,1000,1000,'efectivo')");
  for (let i = 1; i <= 60; i++) {
    const id = v.run(hace(i)).lastInsertRowid;
    db.prepare('INSERT INTO venta_items(venta_id,producto_id,lote_id,cantidad,precio_unit,total) VALUES(?,?,?,1,1000,1000)').run(id, prod, lote);
  }
  const l = (await admin.get('/vencimientos')).body.find(x => x.producto_id === prod);
  assert.equal(l.estado, 'critico');
  assert.ok(l.riesgo_unidades >= 69 && l.riesgo_unidades <= 71, `riesgo ${l.riesgo_unidades}`);
  // precio 1000, costo 700*1.02 → tope 28 %; base por cercanía 30 % → 28
  assert.equal(l.promo_pct, 28);
  const pos = (await cajero.get('/pos/buscar?q=Lento')).body[0];
  assert.equal(pos.promo_pct, 28);
});

test('stock crítico: agotado, bajo mínimo y cobertura menor al tiempo de reposición', async () => {
  const sc = (await admin.get('/stock-critico')).body;
  const by = id => sc.find(p => p.id === id);
  assert.equal(by(P.para).nivel, 'critico');  // quedan 1,5 empaques y el mínimo es 2
  assert.equal(by(P.clon).nivel, 'agotado');  // se vendió el único empaque
  assert.equal(by(P.amox), undefined);        // 2 empaques sobre mínimo 1: no alerta
  assert.ok(by(P.para).sugerido_empaques >= 1);
});

test('alertas WhatsApp: se envían una vez por novedad (simulado) y no se repiten', async () => {
  setCfg.run('alerta_destinos', '573001234567, 573109998877');
  const a = await admin.post('/alertas/revisar');
  assert.equal(a.status, 200);
  const env1 = a.body.enviadas.filter(e => e.estado === 'simulado');
  assert.ok(env1.length >= 2, 'envía a ambos destinos');
  const b = await admin.post('/alertas/revisar');
  assert.ok(b.body.enviadas.every(e => e.estado === 'omitido'), 'segunda revisión no repite');
  const c = await admin.post('/alertas/revisar', { force: true });
  assert.ok(c.body.enviadas.some(e => e.estado === 'simulado'), 'force reenvía');
  const log = (await admin.get('/alertas/log')).body;
  assert.ok(log.some(l => l.tipo === 'stock' && /Stock crítico/.test(l.mensaje)));
  assert.ok(log.some(l => l.tipo === 'vencimiento' && /Vencimientos/.test(l.mensaje)));
  const pedidos = (await admin.get('/alertas/pedidos')).body;
  assert.ok(pedidos.length && pedidos[0].texto.includes('pedido'));
});

test('cierre de caja calcula efectivo esperado y diferencia', async () => {
  const antes = (await cajero.get('/caja')).body;
  const cierre = await cajero.post('/caja/cerrar', { contado: antes.efectivo_esperado - 1000 });
  assert.equal(cierre.body.diferencia, -1000);
  assert.equal(cierre.body.estado, 'cerrada');
});
