// Datos de demostración: node src/seed.js  (borra y recrea los datos de la base configurada)
process.env.TZ = process.env.TZ || 'America/Bogota';
const { db, setCfg, hoy, fmt } = require('./db');
const { hashPassword } = require('./auth');

const sumarDias = n => fmt(new Date(Date.now() + n * 86400000)).slice(0, 10);

for (const t of ['alertas_log', 'formulas', 'venta_items', 'ventas', 'pagos_cliente', 'cajas', 'movimientos', 'lotes', 'compras', 'productos', 'proveedores', 'clientes', 'sesiones', 'usuarios', 'config']) db.exec(`DELETE FROM ${t}`);

const u = db.prepare('INSERT INTO usuarios(nombre,usuario,hash,rol) VALUES(?,?,?,?)');
u.run('Administrador', 'admin', hashPassword('admin123'), 'admin');
u.run('Regente de Farmacia', 'regente', hashPassword('regente123'), 'regente');
u.run('Cajero', 'cajero', hashPassword('cajero123'), 'cajero');

setCfg.run('nombre_negocio', 'Droguería La Esquina');
setCfg.run('alerta_destinos', '573001234567');

const prov = db.prepare('INSERT INTO proveedores(nombre,telefono,contacto,dias_devolucion) VALUES(?,?,?,?)');
const cop = Number(prov.run('Coopidrogas', '573101112233', 'Asesor Marta', 90).lastInsertRowid);
const dist = Number(prov.run('Distribuidora Medicol', '573204445566', 'Jorge', 60).lastInsertRowid);

// [codigo, nombre, principio, presentacion, formula, control, factor, precioEmpaque, costoEmpaque, stockMinEmpaques, proveedor, iva]
const catalogo = [
  ['7701001', 'Acetaminofén 500 mg', 'Acetaminofén', 'Caja x 100 tabletas', 0, 0, 100, 9000, 5200, 3, cop, 0],
  ['7701002', 'Ibuprofeno 400 mg', 'Ibuprofeno', 'Caja x 50 tabletas', 0, 0, 50, 12500, 7000, 2, cop, 0],
  ['7701003', 'Loratadina 10 mg', 'Loratadina', 'Caja x 100 tabletas', 0, 0, 100, 14000, 7800, 2, cop, 0],
  ['7701004', 'Diclofenaco 50 mg', 'Diclofenaco', 'Caja x 100 tabletas', 0, 0, 100, 11000, 6000, 2, dist, 0],
  ['7701005', 'Omeprazol 20 mg', 'Omeprazol', 'Caja x 28 cápsulas', 0, 0, 28, 9800, 5000, 3, dist, 0],
  ['7701006', 'Amoxicilina 500 mg', 'Amoxicilina', 'Caja x 50 cápsulas', 1, 0, 50, 21000, 12000, 2, cop, 0],
  ['7701007', 'Losartán 50 mg', 'Losartán', 'Caja x 30 tabletas', 1, 0, 30, 8500, 4200, 3, cop, 0],
  ['7701008', 'Metformina 850 mg', 'Metformina', 'Caja x 60 tabletas', 1, 0, 60, 10500, 5500, 3, dist, 0],
  ['7701009', 'Clonazepam 2 mg', 'Clonazepam', 'Caja x 30 tabletas', 1, 1, 30, 16000, 9000, 1, dist, 0],
  ['7701010', 'Tramadol 50 mg', 'Tramadol', 'Caja x 20 cápsulas', 1, 1, 20, 15500, 8800, 1, dist, 0],
  ['7701011', 'Suero oral sabor frutas', 'Electrolitos', 'Sobre / frasco 500 ml', 0, 0, 1, 3800, 2300, 12, cop, 19],
  ['7701012', 'Alcohol antiséptico 350 ml', 'Alcohol etílico', 'Frasco 350 ml', 0, 0, 1, 6500, 3800, 6, cop, 19],
  ['7701013', 'Vitamina C 500 mg', 'Ácido ascórbico', 'Frasco x 100 tabletas', 0, 0, 100, 18000, 10500, 1, dist, 19],
  ['7701014', 'Dolex Gripa', 'Acetaminofén + fenilefrina', 'Caja x 48 tabletas', 0, 0, 48, 26000, 17000, 2, cop, 0],
];
const insP = db.prepare(`INSERT INTO productos(codigo,nombre,principio_activo,presentacion,requiere_formula,control_especial,factor,precio_venta,costo,stock_min,proveedor_id,iva)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
const ids = {};
for (const [cod, nom, pa, pres, f, c, fac, pv, co, min, pr, iva] of catalogo) ids[cod] = Number(insP.run(cod, nom, pa, pres, f, c, fac, pv, co, min, pr, iva).lastInsertRowid);

// [codigo, lote, díasParaVencer, empaques(float), ]
const lotes = [
  ['7701001', 'AC2401', 400, 4], ['7701001', 'AC2305', 75, 1.5],        // dos lotes: FEFO
  ['7701002', 'IB2402', 28, 3],                                           // vence pronto y rota lento → riesgo
  ['7701003', 'LO2403', 220, 2.5],
  ['7701004', 'DI2310', -12, 1],                                          // VENCIDO
  ['7701004', 'DI2404', 300, 1],
  ['7701005', 'OM2405', 160, 4],
  ['7701006', 'AM2406', 50, 2],
  ['7701007', 'LS2407', 365, 1],                                          // stock bajo mínimo (3)
  ['7701008', 'ME2408', 18, 2],
  ['7701009', 'CL2401', 500, 1], ['7701010', 'TR2402', 420, 2],
  ['7701011', 'SU2409', 250, 5],                                          // bajo mínimo 12
  ['7701012', 'AL2403', 90, 8],
  ['7701014', 'DG2404', 200, 3],
  // Vitamina C (7701013) sin lotes → agotado
];
const insL = db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)');
const prods = Object.fromEntries(catalogo.map(c => [c[0], c]));
for (const [cod, lote, dias, emp] of lotes) {
  const p = prods[cod];
  insL.run(ids[cod], lote, sumarDias(dias), Math.round(emp * p[6]), p[8] / p[6], fmt(new Date()));
}

// Historial de ventas de los últimos 30 días para que el sistema calcule rotación.
// [codigo, unidades por día aprox]
const rot = { 7701001: 14, 7701002: 1.5, 7701003: 6, 7701004: 3, 7701005: 5, 7701006: 2, 7701007: 2, 7701008: 4, 7701011: 2.5, 7701012: 1, 7701013: 3, 7701014: 4 };
const adminId = db.prepare("SELECT id FROM usuarios WHERE usuario='admin'").get().id;
const caja = Number(db.prepare('INSERT INTO cajas(usuario_id,abierta,base,estado,cerrada,efectivo_contado) VALUES(?,?,?,?,?,?)').run(adminId, fmt(new Date(Date.now() - 31 * 864e5)), 0, 'cerrada', fmt(new Date(Date.now() - 30 * 864e5)), 0).lastInsertRowid);
const insV = db.prepare('INSERT INTO ventas(fecha,usuario_id,caja_id,subtotal,descuento,iva,total,medio_pago) VALUES(?,?,?,?,?,?,?,?)');
const insVI = db.prepare('INSERT INTO venta_items(venta_id,producto_id,lote_id,cantidad,precio_unit,iva,total,costo_unit) VALUES(?,?,?,?,?,?,?,?)');
db.exec('BEGIN');
for (let d = 30; d >= 1; d--) {
  const fecha = fmt(new Date(Date.now() - d * 864e5));
  for (const [cod, porDia] of Object.entries(rot)) {
    const cant = Math.round(porDia * (0.6 + Math.random() * 0.8));
    if (!cant) continue;
    const p = prods[cod], pu = p[7] / p[6];
    const total = Math.round(cant * pu);
    const lote = db.prepare('SELECT id FROM lotes WHERE producto_id=? ORDER BY vence LIMIT 1').get(ids[cod])?.id;
    if (!lote) continue;
    const v = Number(insV.run(fecha, adminId, caja, total, 0, 0, total, 'efectivo').lastInsertRowid);
    insVI.run(v, ids[cod], lote, cant, pu, 0, total, p[8] / p[6]);
  }
}
db.exec('COMMIT');

db.prepare('INSERT INTO clientes(nombre,documento,telefono,saldo) VALUES(?,?,?,?)').run('Doña Rosa Pérez', '41234567', '573115556677', 0);
db.prepare('INSERT INTO clientes(nombre,documento,telefono,saldo) VALUES(?,?,?,?)').run('Carlos Gómez', '79876543', '573128889900', 0);

console.log('Datos de demostración creados.');
console.log('Usuarios: admin/admin123 · regente/regente123 · cajero/cajero123');
console.log('Hoy:', hoy());
