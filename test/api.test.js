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
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), raw: u => fetch(base + '/api' + u, { headers: { cookie } }) };
}

test.before(async () => {
  asegurarAdmin();
  db.prepare("INSERT INTO usuarios(nombre,usuario,hash,rol) VALUES('Reg','regente',?,'regente'),('Caj','cajero',?,'cajero')").run(hashPassword('regente1'), hashPassword('cajero1'));
  server = crearApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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

test('receta: solo se despacha lo recetado y hasta el saldo', async () => {
  const venta = (n, receta_id, producto = P.amox) => ({ items: [{ producto_id: producto, cantidad: n, modo: 'unidad' }], medio_pago: 'efectivo', receta_id });
  const base = { paciente: 'Ana Ruiz', medico: 'Dr. Pérez', registro_medico: 'RM-123', numero: 'F-9', items: [{ producto_id: P.amox, cantidad: 6, modo: 'unidad' }] };
  assert.equal((await cajero.post('/ventas', venta(1))).status, 400);                          // sin receta
  assert.equal((await cajero.post('/recetas', { ...base, paciente: '' })).status, 400);        // receta incompleta
  assert.equal((await cajero.post('/recetas', { ...base, fecha_formula: '2020-01-01' })).status, 400); // fórmula vencida
  const rc = await cajero.post('/recetas', base);
  assert.equal(rc.status, 200);
  P.receta = rc.body.id;
  // otro medicamento con fórmula que NO fue recetado
  P.otroRx = (await admin.post('/productos', { codigo: 'A9', nombre: 'Losartán', factor: 30, precio_venta: 8000, costo: 4000, requiere_formula: 1 })).body.id;
  db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(P.otroRx, 'LS', dia(300), 60, 130, 'x');
  assert.equal((await cajero.post('/ventas', venta(1, P.receta, P.otroRx))).status, 403);      // no está en la fórmula
  assert.equal((await cajero.post('/ventas', venta(7, P.receta))).status, 409);                // más que lo recetado
  const v1 = await cajero.post('/ventas', venta(4, P.receta));
  assert.equal(v1.status, 200);
  assert.equal(v1.body.formula.medico, 'Dr. Pérez');
  assert.equal((await cajero.get('/recetas/' + P.receta)).body.items[0].saldo, 2);
  assert.equal((await cajero.post('/ventas', venta(3, P.receta))).status, 409);                // solo quedan 2
  const v2 = await cajero.post('/ventas', venta(2, P.receta));
  assert.equal(v2.status, 200);
  assert.equal((await cajero.get('/recetas?q=Ana')).body.length, 0);                           // receta completa: ya no se ofrece
  assert.equal((await regente.post(`/ventas/${v2.body.id}/anular`)).status, 200);
  assert.equal((await cajero.get('/recetas?q=Ana')).body[0].items[0].saldo, 2);                // anular devuelve el saldo
});

test('control especial: la receta exige documento y foto; solo el regente despacha', async () => {
  const items = [{ producto_id: P.clon, cantidad: 1, modo: 'empaque' }];
  const f = { paciente: 'Luis', medico: 'Dra. Gil', registro_medico: 'RM-5', items };
  assert.equal((await regente.post('/recetas', f)).status, 400);                               // sin documento
  assert.equal((await regente.post('/recetas', { ...f, documento_paciente: '123' })).status, 400); // sin foto
  assert.equal((await regente.post('/recetas', { ...f, documento_paciente: '123', imagen: 'data:text/html;base64,AAAA' })).status, 400);
  const rc = await regente.post('/recetas', { ...f, documento_paciente: '123', imagen: PNG });
  assert.equal(rc.status, 200);
  assert.equal((await regente.raw(`/recetas/${rc.body.id}/imagen`)).status, 200);
  const venta = { items, medio_pago: 'efectivo', receta_id: rc.body.id };
  assert.equal((await cajero.post('/ventas', venta)).status, 403);
  assert.equal((await regente.post('/ventas', venta)).status, 200);
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

test('pedido inteligente: 20 por día, quedan 40 y el proveedor tarda 1 día -> "Pide mañana"', async () => {
  const prov = (await admin.post('/proveedores', { nombre: 'Droga Rápida', telefono: '573105550000', dias_entrega: 1 })).body.id;
  P.rapido = (await admin.post('/productos', { codigo: 'RP', nombre: 'Acetaminofén Rápido', factor: 1, precio_venta: 500, costo: 300, stock_min: 0, proveedor_id: prov })).body.id;
  const lote = db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(P.rapido, 'R1', dia(300), 40, 300, 'x').lastInsertRowid;
  const v = db.prepare("INSERT INTO ventas(fecha,usuario_id,total,subtotal,medio_pago) VALUES(?,1,10000,10000,'efectivo')");
  for (let i = 1; i <= 60; i++) {
    const id = v.run(fmt(new Date(Date.now() - i * 864e5))).lastInsertRowid;
    db.prepare('INSERT INTO venta_items(venta_id,producto_id,lote_id,cantidad,precio_unit,total) VALUES(?,?,?,20,500,10000)').run(id, P.rapido, lote);
  }
  const it = (await admin.get('/pedido-sugerido')).body.find(x => x.id === P.rapido);
  assert.equal(it.urgencia, 'manana');
  assert.match(it.sugerencia, /Pide mañana o te quedas sin stock/);
  assert.equal(it.nivel, 'pronto');
  assert.ok(!(await admin.get('/stock-critico')).body.some(x => x.id === P.rapido), 'aún no es crítico para alertas');
  db.prepare('UPDATE lotes SET cantidad = 15 WHERE id = ?').run(lote);                         // ahora 0,75 días de stock
  assert.match((await admin.get('/pedido-sugerido')).body.find(x => x.id === P.rapido).sugerencia, /Pide HOY/);
  db.prepare('UPDATE lotes SET cantidad = 40 WHERE id = ?').run(lote);
});

test('semáforo por producto cambia solo', async () => {
  const sem = (await admin.get('/productos?q=')).body;
  const c = n => sem.find(p => p.nombre === n).semaforo;
  assert.equal(c('Acetaminofén Rápido'), 'amarillo'); // se agota en pocos días
  assert.equal(c('Lento'), 'rojo');                   // lote vence en 30 días
  assert.equal(c('Acetaminofén'), 'rojo');            // stock bajo el mínimo
  db.prepare("UPDATE lotes SET vence = ? WHERE lote = 'L'").run(dia(80));
  assert.equal((await admin.get('/productos?q=Lento')).body[0].semaforo, 'amarillo');          // vence en 3 meses
  db.prepare("UPDATE lotes SET vence = ? WHERE lote = 'L'").run(dia(200));
  assert.equal((await admin.get('/productos?q=Lento')).body[0].semaforo, 'verde');
});

test('escáner: datos del producto y alertas de lote', async () => {
  const r = (await cajero.get('/escaneo?c=A1')).body;
  assert.equal(r.nombre, 'Acetaminofén');
  assert.equal(r.precio_empaque, 10000);
  assert.ok(r.lotes.length >= 1 && r.lote_fefo);
  assert.equal((await cajero.get('/escaneo?c=ZZZ')).status, 404);
  assert.ok((await cajero.get('/escaneo?c=A1|FALSO')).body.avisos.some(a => /NO aparece en tus compras/.test(a.texto)));
  db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(P.para, 'OLD', dia(-3), 5, 60, 'x');
  assert.ok((await cajero.get('/escaneo?c=A1|OLD')).body.avisos.some(a => /VENCIDO/.test(a.texto)));
  const sale = (await cajero.get('/escaneo?c=A1|NUEVO')).body;
  assert.ok(sale.avisos.some(a => /Sale primero el lote/.test(a.texto)) || sale.lote_fefo === 'NUEVO');
});

test('bloqueo de vencidos y vista "¿qué vence esta semana?"', async () => {
  db.prepare("UPDATE lotes SET cantidad = 0 WHERE producto_id = ? AND lote != 'OLD'").run(P.para);
  const r = await cajero.post('/ventas', { items: [{ producto_id: P.para, cantidad: 1, modo: 'unidad' }], medio_pago: 'efectivo' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /BLOQUEADO.*VENCIDAS/);
  const semana = (await admin.get('/vencimientos?dias=7')).body;
  assert.ok(semana.some(l => l.lote === 'OLD' && l.estado === 'vencido'));
  assert.ok(semana.every(l => l.dias <= 7));
  db.prepare("UPDATE lotes SET cantidad = 40 WHERE producto_id = ? AND lote = 'NUEVO'").run(P.para);
});

test('proveedores: historial de compras y comparación de precios', async () => {
  const a = (await admin.post('/proveedores', { nombre: 'Prov A', dias_entrega: 2 })).body.id;
  const b = (await admin.post('/proveedores', { nombre: 'Prov B', dias_entrega: 3 })).body.id;
  const compra = (prov, costo) => admin.post('/compras', { proveedor_id: prov, factura: 'X', items: [{ producto_id: P.vit, lote: 'PV' + costo, vence: dia(300), cantidad: 10, costo }] });
  assert.equal((await compra(b, 3000)).status, 200);
  assert.equal((await compra(a, 3500)).status, 200);
  const d = (await admin.get(`/proveedores/${a}/detalle`)).body;
  assert.equal(d.proveedor.dias_entrega, 2);
  assert.equal(d.num_compras, 1);
  const vit = d.productos.find(p => p.nombre === 'Vitamina');
  assert.equal(vit.ultimo_costo, 3500);
  assert.equal(vit.mejor_otro.proveedor, 'Prov B');
  assert.equal(vit.mejor_otro.costo, 3000);
  assert.equal((await cajero.get(`/proveedores/${a}/detalle`)).status, 403);
});

test('CRM: historial del cliente y aviso por WhatsApp cuando llega el producto', async () => {
  const maria = (await cajero.post('/clientes', { nombre: 'María López', documento: '555', telefono: '573001112233' })).body.id;
  for (let i = 0; i < 2; i++) assert.equal((await cajero.post('/ventas', { items: [{ producto_id: P.vit, cantidad: 1, modo: 'unidad' }], medio_pago: 'efectivo', cliente_id: maria })).status, 200);
  const h = (await cajero.get(`/clientes/${maria}/historial`)).body;
  assert.equal(h.compras, 2);
  assert.equal(h.frecuentes[0].nombre, 'Vitamina');
  assert.equal(h.frecuentes[0].veces, 2);
  // Clonazepam está agotado: María pide que le avisen
  assert.equal((await cajero.post(`/clientes/${maria}/avisos`, { producto_id: P.clon })).status, 200);
  assert.equal((await cajero.post(`/clientes/${maria}/avisos`, { producto_id: P.clon })).body.repetido, true);
  assert.equal((await cajero.get('/avisos/pendientes')).body.explicitos.length, 1);
  const c = await admin.post('/compras', { items: [{ producto_id: P.clon, lote: 'CLN', vence: dia(300), cantidad: 1, costo: 9000 }] });
  assert.equal(c.body.avisos.length, 1);
  assert.equal(c.body.avisos[0].estado, 'simulado');
  assert.equal((await cajero.get('/avisos/pendientes')).body.explicitos.length, 0);
  const hab = (await cajero.get('/avisos/pendientes')).body.habituales;                         // compró Vitamina 2 veces y llegó mercancía
  assert.ok(hab.some(x => x.nombre === 'María López' && x.producto === 'Vitamina' && /wa\.me/.test(x.wa_link)));
});

test('asistente: responde preguntas en lenguaje natural', async () => {
  const az = (await admin.post('/productos', { codigo: 'AZ', nombre: 'Azitromicina 500 mg', categoria: 'Antibiótico', factor: 6, precio_venta: 18000, costo: 9000, stock_min: 2, requiere_formula: 1 })).body.id;
  db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(az, 'AZ1', dia(300), 6, 1500, 'x');
  const ask = async q => (await cajero.post('/asistente', { pregunta: q })).body;
  const a = await ask('¿Qué antibióticos me quedan con stock bajo?');
  assert.ok(a.items.some(i => i.titulo.includes('Azitromicina')));
  assert.ok(!a.items.some(i => i.titulo.includes('Acetaminofén')));
  assert.ok((await ask('que vence esta semana')).items.some(i => i.titulo.includes('OLD')));
  const askReg = async q => (await regente.post('/asistente', { pregunta: q })).body;
  assert.match((await askReg('¿Cuánto vendí hoy?')).respuesta, /Vendiste \$/);
  assert.match((await ask('¿Cuánto vendí hoy?')).respuesta, /solo para el regente/);                 // el cajero no ve ventas ni utilidad
  assert.match((await ask('¿quién me debe?')).respuesta, /solo para el regente/);
  assert.match((await ask('cuáles son los más vendidos')).respuesta, /solo para el regente/);
  assert.ok((await ask('¿qué debo pedir?')).items.some(i => i.titulo.includes('Rápido')));
  assert.match((await ask('cuanta azitromicina tengo')).respuesta, /Encontré 1/);
  assert.match((await ask('asdfghj')).respuesta, /No encontré/);
  assert.ok((await ask('hola')).ejemplos.length > 3);
});

test('foto del producto: solo imágenes válidas y solo staff', async () => {
  assert.equal((await cajero.put(`/productos/${P.para}/foto`, { imagen: PNG })).status, 403);
  assert.equal((await admin.put(`/productos/${P.para}/foto`, { imagen: 'data:text/plain;base64,QUJD' })).status, 400);
  assert.equal((await admin.put(`/productos/${P.para}/foto`, { imagen: PNG })).status, 200);
  const r = await cajero.raw(`/productos/${P.para}/foto`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await cajero.get('/productos?q=Acetaminofén')).body.find(p => p.id === P.para).tiene_foto, true);
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

test('importar: vista previa no guarda, aplicar crea productos, lotes y proveedores', async () => {
  const fila = (n, datos) => ({ fila: n, datos });
  const filas = [
    fila(2, { 'Código': 'IM1', Producto: 'Importado Uno', Fórmula: 'No', 'Unidades por empaque': 100, 'Precio de venta': '12.500', Costo: '$ 7.000,50', 'Stock mínimo': 2, Proveedor: 'Proveedor Nuevo SAS', Lote: 'L-A', Vencimiento: '03/2031', Existencia: 2 }),
    fila(3, { 'Código': 'IM1', Producto: 'Importado Uno', Lote: 'L-B', Vencimiento: '15/08/2030', Existencia: '1,5' }),              // otro lote del mismo producto
    fila(4, { 'Código': 'IM2', Producto: 'Importado Rx', Fórmula: 'Sí', Control: 'Sí', 'Precio de venta': 20000, Lote: 'R1', Vencimiento: 47500, Existencia: 1 }), // serie de Excel
    fila(5, { Producto: 'Sin precio' }),                                                                                           // error
    fila(6, { 'Código': 'IM3', Producto: 'Fecha mala', 'Precio de venta': 5000, Lote: 'X', Vencimiento: '31/02/2030', Existencia: 1 }), // aviso: producto sí, lote no
    fila(7, { 'Código': 'IM4', Producto: 'Lote vencido', 'Precio de venta': 5000, Lote: 'V', Vencimiento: '2020-01-01', Existencia: 2 }),
    fila(8, {}),                                                                                                                    // vacía
  ];
  const antes = db.prepare('SELECT COUNT(*) n FROM productos').get().n;
  assert.equal((await cajero.post('/importar', { filas })).status, 403);
  const prev = (await regente.post('/importar', { filas, aplicar: false })).body;
  assert.equal(prev.aplicado, false);
  assert.equal(prev.productos_nuevos, 4);
  assert.equal(prev.filas_error, 1);
  assert.equal(prev.lotes, 4);                                                                        // L-A, L-B, R1, V (X no)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM productos').get().n, antes, 'la vista previa no guarda nada');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM proveedores WHERE nombre = 'Proveedor Nuevo SAS'").get().n, 0);

  const r = (await regente.post('/importar', { filas, aplicar: true })).body;
  assert.equal(r.aplicado, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM productos').get().n, antes + 4);
  const p1 = db.prepare("SELECT * FROM productos WHERE codigo = 'IM1'").get();
  assert.equal(p1.precio_venta, 12500);
  assert.equal(p1.costo, 7000.5);
  assert.equal(p1.factor, 100);
  assert.equal(db.prepare('SELECT nombre FROM proveedores WHERE id = ?').get(p1.proveedor_id).nombre, 'Proveedor Nuevo SAS');
  const lotes = db.prepare('SELECT lote, vence, cantidad FROM lotes WHERE producto_id = ? ORDER BY lote').all(p1.id);
  assert.deepEqual(lotes.map(l => [l.lote, l.vence, l.cantidad]), [['L-A', '2031-03-31', 200], ['L-B', '2030-08-15', 150]]);   // MM/AAAA -> fin de mes; 1,5 empaques = 150 u
  const rx = db.prepare("SELECT * FROM productos WHERE codigo = 'IM2'").get();
  assert.equal(rx.control_especial, 1);
  assert.equal(rx.requiere_formula, 1);
  assert.match(db.prepare('SELECT vence FROM lotes WHERE producto_id = ?').get(rx.id).vence, /^2030-0\d-\d\d$/);                  // serie 47500
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lotes WHERE lote = 'X'").get().n, 0);
  const malaFecha = r.filas.find(f => f.fila === 6);
  assert.equal(malaFecha.estado, 'aviso');
  assert.match(malaFecha.mensajes.join(' '), /no se entiende/);
  assert.match(r.filas.find(f => f.fila === 7).mensajes.join(' '), /ya está vencido/);
  assert.match(r.filas.find(f => f.fila === 5).mensajes.join(' '), /Falta el precio/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos WHERE tipo = 'inventario_inicial'").get().n, 4);
});

test('importar: reimportar no duplica lotes y "actualizar" cambia precios', async () => {
  const filas = [{ fila: 2, datos: { Código: 'IM1', Producto: 'Importado Uno', Precio: 13000, Lote: 'L-A', Vencimiento: '03/2031', Existencia: 2 } }];
  const sin = (await regente.post('/importar', { filas, aplicar: true })).body;
  assert.equal(sin.lotes, 0);
  assert.match(sin.filas[0].mensajes.join(' '), /ya existe/);
  assert.equal(db.prepare("SELECT precio_venta FROM productos WHERE codigo = 'IM1'").get().precio_venta, 12500);   // no se pisa sin pedirlo
  const con = (await regente.post('/importar', { filas, actualizar: true, aplicar: true })).body;
  assert.equal(con.productos_actualizados, 1);
  assert.equal(db.prepare("SELECT precio_venta FROM productos WHERE codigo = 'IM1'").get().precio_venta, 13000);
  assert.equal((await regente.post('/importar', { filas: [] })).status, 400);
  assert.equal((await regente.post('/importar', { filas: [{ fila: 2, datos: { Cosa: 'x' } }] })).status, 400);
});

test('respaldo: crea copia consistente, lista, descarga y solo el admin', async () => {
  assert.equal((await regente.post('/respaldos')).status, 403);
  const r = await admin.post('/respaldos');
  assert.equal(r.status, 200);
  assert.match(r.body.nombre, /^vitaltrack-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/);
  assert.ok(r.body.bytes > 10000);
  assert.ok((await admin.get('/respaldos')).body.some(x => x.nombre === r.body.nombre));
  const d = await admin.raw('/respaldos/' + r.body.nombre);
  assert.equal(d.status, 200);
  assert.equal(Buffer.from(await d.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');   // es una base SQLite válida
  assert.equal((await admin.raw('/respaldos/../../etc/passwd')).status, 404);
  assert.equal((await admin.raw('/respaldos/archivo-malo.db')).status, 404);
});

test('contraseñas de demostración: se avisa y se puede cambiar con reglas', async () => {
  assert.equal((await admin.get('/me')).body.clave_demo, true);          // admin123 en este entorno
  assert.equal((await cajero.get('/me')).body.clave_demo, false);        // cajero1 no es de demostración
  assert.equal((await admin.post('/clave', { actual: 'incorrecta', nueva: 'Una-Buena-Clave-9' })).status, 400);
  assert.equal((await admin.post('/clave', { actual: 'admin123', nueva: 'corta' })).status, 400);
  assert.equal((await admin.post('/clave', { actual: 'admin123', nueva: 'admin123' })).status, 400);
  assert.equal((await admin.post('/clave', { actual: 'admin123', nueva: 'Una-Buena-Clave-9' })).status, 200);
  assert.equal((await admin.get('/me')).body.clave_demo, false);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'admin', password: 'Una-Buena-Clave-9' }) });
  assert.equal(login.status, 200);
  const vieja = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'admin', password: 'admin123' }) });
  assert.equal(vieja.status, 401);
});

test('chequeo de salud público y sin datos sensibles', async () => {
  const r = await fetch(base + '/api/salud');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

// Lee las hojas de un .xlsx generado: zip -> XML (suficiente para comprobar contenido)
function leerXlsx(buf) {
  const zlib = require('node:zlib');
  const archivos = {};
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(fin + 16);
  for (let i = 0, n = buf.readUInt16LE(fin + 10); i < n; i++) {
    const comp = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nl);
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    archivos[nombre] = zlib.inflateRawSync(buf.subarray(ini, ini + comp)).toString('utf8');
    p += 46 + nl + el + cl;
  }
  return archivos;
}

test('exportar a Excel: inventario, ventas, pedido y clientes; solo staff', async () => {
  assert.equal((await cajero.raw('/exportar/inventario')).status, 403);
  assert.equal((await regente.raw('/exportar/nada')).status, 404);
  assert.equal((await regente.raw('/exportar/ventas?desde=2026-12-31&hasta=2026-01-01')).status, 400);
  const bajar = async url => { const r = await regente.raw(url); assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment; filename="vitaltrack-.*\.xlsx"/); return leerXlsx(Buffer.from(await r.arrayBuffer())); };
  const inv = await bajar('/exportar/inventario');
  assert.match(inv['xl/workbook.xml'], /Productos/);
  assert.match(inv['xl/workbook.xml'], /Lotes/);
  assert.match(inv['xl/worksheets/sheet1.xml'], /Acetaminofén Rápido/);                    // tildes intactas
  assert.match(inv['xl/worksheets/sheet2.xml'], /OLD/);                                    // lote vencido listado
  const ven = await bajar('/exportar/ventas');
  assert.match(ven['xl/worksheets/sheet1.xml'], /VT-0000\d\d/);
  assert.match(ven['xl/worksheets/sheet2.xml'], /Utilidad/);
  assert.match((await bajar('/exportar/pedido'))['xl/worksheets/sheet1.xml'], /Pide|Pronto|Agotado/);
  assert.match((await bajar('/exportar/clientes'))['xl/worksheets/sheet1.xml'], /María López/);
});

test('etiquetas QR: lotes por producto, compra o lote; exige un filtro y rol staff', async () => {
  assert.equal((await cajero.get('/etiquetas?producto_id=1')).status, 403);
  assert.equal((await regente.get('/etiquetas')).status, 400);
  const porProducto = (await regente.get(`/etiquetas?producto_id=${P.vit}`)).body;
  assert.ok(porProducto.length >= 1);
  assert.ok(porProducto.every(l => l.codigo === 'A4' && l.cantidad > 0));
  const compra = (await admin.post('/compras', { items: [{ producto_id: P.rapido, lote: 'ETQ1', vence: dia(300), cantidad: 1, costo: 300 }] })).body.id;
  const deCompra = (await regente.get('/etiquetas?compra_id=' + compra)).body;
  assert.equal(deCompra.length, 1);
  assert.equal(deCompra[0].lote, 'ETQ1');
  assert.equal((await regente.get('/etiquetas?lote_id=' + deCompra[0].lote_id)).body[0].codigo, 'RP');
});

test('app instalable: manifest válido e íconos disponibles sin iniciar sesión', async () => {
  const m = await fetch(base + '/manifest.webmanifest');
  assert.equal(m.status, 200);
  const j = await m.json();
  assert.equal(j.name, 'VitalTrack');
  assert.equal(j.display, 'standalone');
  assert.ok(j.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of j.icons) {
    const r = await fetch(base + '/' + i.src);
    assert.equal(r.status, 200, i.src);
    assert.equal(r.headers.get('content-type'), 'image/png');
  }
  assert.equal((await fetch(base + '/apple-touch-icon.png')).status, 200);
});

test('pérdidas: las bajas se valoran a costo y se separan por motivo', async () => {
  const lote = db.prepare("SELECT id, costo_unidad, cantidad FROM lotes WHERE lote = 'OLD'").get();
  assert.equal((await regente.get('/reportes/perdidas')).body.total, 0);
  assert.equal((await cajero.get('/reportes/perdidas')).status, 403);
  assert.equal((await regente.post(`/lotes/${lote.id}/baja`, { cantidad: 3, motivo: 'Vencido' })).status, 200);
  assert.equal((await regente.post(`/lotes/${lote.id}/baja`, { cantidad: 1, motivo: 'Dañado / roto' })).status, 200);
  const r = (await regente.get('/reportes/perdidas')).body;
  assert.equal(r.bajas, 2);
  assert.equal(r.total, Math.round(3 * lote.costo_unidad) + Math.round(1 * lote.costo_unidad));
  assert.deepEqual(r.por_motivo.map(m => m.motivo).sort(), ['Dañado / roto', 'Vencido']);
  assert.equal(r.vencido_en_bodega, Math.round((lote.cantidad - 4) * lote.costo_unidad));            // queda 1 u vencida en bodega
  assert.ok(r.en_riesgo >= 0);
});

test('WhatsApp: estado de configuración sin secretos y mensaje de prueba', async () => {
  assert.equal((await cajero.get('/alertas/estado')).status, 403);
  const e = (await regente.get('/alertas/estado')).body;
  assert.equal(e.proveedor, 'simulado');
  assert.equal(e.listo, false);
  assert.equal(e.destinos, 2);
  assert.ok(!JSON.stringify(e).includes(process.env.WA_TOKEN || 'TOKEN-INEXISTENTE'));
  const p = (await regente.post('/alertas/prueba')).body;
  assert.equal(p.resultados.length, 2);
  assert.ok(p.resultados.every(r => r.estado === 'simulado'));
  assert.ok((await regente.get('/alertas/log')).body.some(l => l.tipo === 'prueba'));
  setCfg.run('alerta_destinos', '');
  assert.equal((await regente.post('/alertas/prueba')).body.sin_destinos, true);
});

test('el cajero no ve utilidad, cartera ni tendencia en el inicio', async () => {
  const c = (await cajero.get('/dashboard')).body;
  assert.equal(c.utilidad_hoy, null);
  assert.equal(c.cartera, null);
  assert.equal(c.ventas_7d, null);
  assert.equal(typeof c.ventas_hoy, 'number');                       // lo operativo sí
  const r = (await regente.get('/dashboard')).body;
  assert.equal(typeof r.utilidad_hoy, 'number');
  assert.ok(Array.isArray(r.ventas_7d));
});
