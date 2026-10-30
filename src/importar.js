/**
 * Importación masiva de productos e inventario inicial desde Excel/CSV.
 * Una fila por lote: si un producto tiene 3 lotes, aparece en 3 filas. El navegador lee el archivo
 * y envía las filas; aquí se validan, se aplican y se informa fila por fila.
 * La vista previa ejecuta exactamente el mismo código dentro de una transacción que se revierte.
 */
const { db, hoy, ahora } = require('./db');
const { HttpError, fechaValida } = require('./inventory');

const MAX_FILAS = 5000;

// Nombre de columna (como lo escriba la persona) -> campo canónico
const ALIAS = {
  codigo: ['codigo', 'cod', 'codigo_de_barras', 'codigo_barras', 'barras', 'ean', 'sku', 'referencia'],
  nombre: ['nombre', 'producto', 'descripcion', 'nombre_producto', 'articulo', 'medicamento'],
  principio_activo: ['principio_activo', 'principio', 'activo', 'generico', 'molecula'],
  laboratorio: ['laboratorio', 'lab', 'marca', 'fabricante'],
  presentacion: ['presentacion', 'presentacion_comercial'],
  categoria: ['categoria', 'grupo', 'linea', 'clasificacion'],
  requiere_formula: ['requiere_formula', 'formula', 'con_formula', 'rx', 'venta_con_formula', 'bajo_formula'],
  control_especial: ['control_especial', 'control', 'controlado', 'medicamento_controlado'],
  invima: ['invima', 'registro_invima', 'registro_sanitario', 'reg_invima'],
  iva: ['iva', 'impuesto'],
  factor: ['unidades_por_empaque', 'unidades_empaque', 'factor', 'unidades_caja', 'und_caja', 'contenido', 'unidades_por_caja'],
  precio_venta: ['precio_venta', 'precio', 'pvp', 'precio_de_venta', 'valor_venta', 'precio_caja', 'precio_publico'],
  precio_unidad: ['precio_unidad', 'precio_suelto', 'precio_por_unidad', 'precio_tableta', 'precio_unitario'],
  costo: ['costo', 'precio_compra', 'costo_empaque', 'valor_compra', 'precio_costo'],
  stock_min: ['stock_min', 'stock_minimo', 'minimo', 'min', 'existencia_minima'],
  proveedor: ['proveedor', 'distribuidor', 'mayorista'],
  lote: ['lote', 'numero_lote', 'no_lote'],
  vence: ['vence', 'vencimiento', 'fecha_vencimiento', 'fecha_vence', 'f_vencimiento', 'fecha_de_vencimiento', 'expira'],
  existencia: ['existencia', 'cantidad', 'stock', 'stock_actual', 'existencias', 'cantidad_empaques'],
};
const CAMPO_DE = Object.fromEntries(Object.entries(ALIAS).flatMap(([campo, lista]) => lista.map(a => [a, campo])));

const sinTildes = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = h => sinTildes(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const texto = v => (v === null || v === undefined ? '' : String(v).trim());

/** Acepta 12500, "12.500", "$ 12.500,50", "12,5", "1,234.50". Devuelve null si no es un número. */
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = texto(v).replace(/[$\s%]/g, '');
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  const punto = s.includes('.'), coma = s.includes(',');
  if (punto && coma) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (coma) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (punto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SI = new Set(['si', 's', '1', 'x', 'true', 'yes', 'y', 'verdadero']);
const NO = new Set(['no', 'n', '0', 'false', 'falso', '']);
function booleano(v) {
  const s = sinTildes(texto(v)).toLowerCase();
  if (SI.has(s)) return true;
  if (NO.has(s)) return false;
  return null;
}

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => {
  const f = `${y}-${pad(m)}-${pad(d)}`;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && !Number.isNaN(Date.parse(f)) && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d ? f : null;
};
/** AAAA-MM-DD, DD/MM/AAAA, DD-MM-AA, MM/AAAA (= último día del mes) o número de serie de Excel. */
function fecha(v) {
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = texto(v);
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[-/.](\d{2,4})$/.exec(s))) {          // vencimiento por mes: 06/2027
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    return iso(y, +m[1], new Date(Date.UTC(y, +m[1], 0)).getUTCDate());
  }
  if (/^\d{5}$/.test(s)) return fecha(Number(s));
  return null;
}

function aCampos(datos) {
  const out = {};
  for (const [h, v] of Object.entries(datos || {})) {
    const campo = CAMPO_DE[clave(h)];
    if (campo && (out[campo] === undefined || texto(out[campo]) === '')) out[campo] = v;
  }
  return out;
}

function buscarProveedor(nombre, creados) {
  const n = texto(nombre);
  if (!n) return null;
  const hallado = db.prepare('SELECT id FROM proveedores WHERE lower(nombre) = lower(?) AND activo = 1').get(n);
  if (hallado) return hallado.id;
  creados.add(n);
  return Number(db.prepare('INSERT INTO proveedores(nombre) VALUES(?)').run(n).lastInsertRowid);
}

function procesar(filas, { actualizar }, usuario) {
  const informe = [];
  const proveedoresCreados = new Set();
  const productos = new Map();              // clave de producto -> { id, factor, costo, ... } ya resuelto en este archivo
  const r = { productos_nuevos: 0, productos_actualizados: 0, productos_existentes: 0, lotes: 0, unidades: 0, filas_error: 0, filas_aviso: 0 };
  const fecha_ing = ahora();

  for (const { fila, datos } of filas) {
    const f = aCampos(datos);
    if (!Object.values(f).some(v => texto(v) !== '')) continue;      // fila vacía
    const msgs = [], avisos = [];
    const linea = { fila, nombre: texto(f.nombre), estado: 'ok', accion: '', mensajes: msgs };
    const falla = m => { msgs.push(m); linea.estado = 'error'; };
    const aviso = m => { msgs.push(m); if (linea.estado === 'ok') linea.estado = 'aviso'; };

    const nombre = texto(f.nombre), codigo = texto(f.codigo) || null;
    if (!nombre) { falla('Falta el nombre del producto'); }
    const clavePro = codigo ? 'c:' + codigo.toLowerCase() : 'n:' + sinTildes(nombre).toLowerCase();

    // ¿ya existe en la base o ya apareció antes en este archivo?
    let existente = productos.get(clavePro) || null;
    let esNuevoEnArchivo = false;
    if (!existente && nombre) {
      const fila_db = (codigo && db.prepare('SELECT * FROM productos WHERE codigo = ?').get(codigo))
        || db.prepare('SELECT * FROM productos WHERE lower(nombre) = lower(?) AND activo = 1').get(nombre);
      if (fila_db) {
        existente = { ...fila_db, deDb: true };
        if (!fila_db.activo) { db.prepare('UPDATE productos SET activo = 1 WHERE id = ?').run(fila_db.id); aviso('El producto estaba eliminado: se reactivó'); }
      }
    }

    const num = (campo, etiqueta, { min = 0 } = {}) => {
      if (texto(f[campo]) === '') return undefined;
      const n = numero(f[campo]);
      if (n === null || n < min) { falla(`${etiqueta} no es un número válido: "${texto(f[campo])}"`); return undefined; }
      return n;
    };
    const factorArch = num('factor', 'Unidades por empaque', { min: 1 });
    const precio = num('precio_venta', 'Precio de venta');
    const precioU = num('precio_unidad', 'Precio por unidad');
    const costo = num('costo', 'Costo');
    const stockMin = num('stock_min', 'Stock mínimo');
    const exist = num('existencia', 'Existencia');
    let iva = num('iva', 'IVA');
    if (iva !== undefined && iva > 0 && iva < 1) iva = Math.round(iva * 100);
    if (iva !== undefined && ![0, 5, 19].includes(iva)) { aviso(`IVA ${iva}% no es 0, 5 ni 19: se usó 0%`); iva = 0; }
    const formula = booleano(f.requiere_formula), control = booleano(f.control_especial);
    if (texto(f.requiere_formula) !== '' && formula === null) aviso(`"${texto(f.requiere_formula)}" no se entendió como Sí/No en fórmula: se dejó en No`);
    if (texto(f.control_especial) !== '' && control === null) aviso(`"${texto(f.control_especial)}" no se entendió como Sí/No en control especial: se dejó en No`);

    if (!existente && nombre && precio === undefined && linea.estado !== 'error') falla('Falta el precio de venta (producto nuevo)');

    if (linea.estado === 'error') { r.filas_error++; informe.push(linea); continue; }

    // ---- producto ----
    let p = existente;
    if (!p) {
      const provId = buscarProveedor(f.proveedor, proveedoresCreados);
      const factor = factorArch || 1;
      const ins = db.prepare(`INSERT INTO productos(codigo,nombre,principio_activo,laboratorio,presentacion,categoria,requiere_formula,control_especial,invima,iva,factor,precio_venta,precio_unidad,costo,stock_min,proveedor_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(codigo, nombre, texto(f.principio_activo) || null, texto(f.laboratorio) || null, texto(f.presentacion) || null, texto(f.categoria) || null,
        (formula || control) ? 1 : 0, control ? 1 : 0, texto(f.invima) || null, iva ?? 0, factor, precio, precioU ?? null, costo ?? 0, stockMin ?? 0, provId);
      p = db.prepare('SELECT * FROM productos WHERE id = ?').get(ins.lastInsertRowid);
      r.productos_nuevos++; linea.accion = 'Producto nuevo'; esNuevoEnArchivo = true;
    } else if (actualizar && p.deDb) {
      const sets = [], vals = [];
      const poner = (col, v) => { if (v !== undefined && v !== null && v !== '') { sets.push(`${col} = ?`); vals.push(v); } };
      poner('principio_activo', texto(f.principio_activo)); poner('laboratorio', texto(f.laboratorio)); poner('presentacion', texto(f.presentacion));
      poner('categoria', texto(f.categoria)); poner('invima', texto(f.invima)); poner('iva', iva); poner('factor', factorArch); poner('precio_venta', precio);
      poner('precio_unidad', precioU); poner('costo', costo); poner('stock_min', stockMin);
      if (texto(f.requiere_formula) !== '' && formula !== null) poner('requiere_formula', formula ? 1 : 0);
      if (texto(f.control_especial) !== '' && control !== null) { poner('control_especial', control ? 1 : 0); if (control) poner('requiere_formula', 1); }
      if (texto(f.proveedor)) poner('proveedor_id', buscarProveedor(f.proveedor, proveedoresCreados));
      if (codigo && !p.codigo) poner('codigo', codigo);
      if (sets.length) db.prepare(`UPDATE productos SET ${sets.join(', ')} WHERE id = ?`).run(...vals, p.id);
      p = db.prepare('SELECT * FROM productos WHERE id = ?').get(p.id);
      r.productos_actualizados++; linea.accion = 'Producto actualizado';
    } else if (p.deDb) {
      r.productos_existentes++; linea.accion = 'Ya existía (sin cambios)';
    } else {
      linea.accion = 'Otro lote del mismo producto';
    }
    if (!productos.has(clavePro)) productos.set(clavePro, { ...p, deDb: false });
    else Object.assign(productos.get(clavePro), p, { deDb: false });
    const prod = productos.get(clavePro);

    // ---- lote / inventario inicial ----
    const lote = texto(f.lote), tieneVence = texto(f.vence) !== '', tieneExist = exist !== undefined && exist > 0;
    if (lote || tieneVence || tieneExist) {
      if (!(lote && tieneVence && tieneExist)) {
        aviso(`Inventario no cargado: para ingresar existencias se necesita ${[!lote && 'lote', !tieneVence && 'vencimiento', !tieneExist && 'existencia'].filter(Boolean).join(', ')}`);
      } else {
        const vence = fecha(f.vence);
        if (!vence) aviso(`Inventario no cargado: la fecha de vencimiento "${texto(f.vence)}" no se entiende (usa AAAA-MM-DD, DD/MM/AAAA o MM/AAAA)`);
        else if (db.prepare('SELECT 1 FROM lotes WHERE producto_id = ? AND lote = ?').get(prod.id, lote)) aviso(`El lote ${lote} ya existe: no se duplicó`);
        else {
          const unidades = Math.round(exist * prod.factor);
          const costoEmp = costo ?? prod.costo ?? 0;
          const ins = db.prepare('INSERT INTO lotes(producto_id,lote,vence,cantidad,costo_unidad,creado) VALUES(?,?,?,?,?,?)').run(prod.id, lote, vence, unidades, costoEmp / prod.factor, fecha_ing);
          db.prepare('INSERT INTO movimientos(fecha,tipo,producto_id,lote_id,cantidad,motivo,usuario_id) VALUES(?,?,?,?,?,?,?)')
            .run(fecha_ing, 'inventario_inicial', prod.id, ins.lastInsertRowid, unidades, 'Importación', usuario.id);
          r.lotes++; r.unidades += unidades;
          if (vence < hoy()) aviso(`El lote ${lote} ya está vencido (${vence}): quedó bloqueado para la venta; dalo de baja en Vencimientos`);
          linea.accion = (esNuevoEnArchivo ? 'Producto nuevo' : linea.accion || 'Lote') + ` + lote ${lote}`;
        }
      }
    }
    if (linea.estado === 'aviso') r.filas_aviso++;
    informe.push(linea);
  }
  return { ...r, proveedores_nuevos: [...proveedoresCreados], filas: informe };
}

/**
 * @param aplicar false = solo vista previa (se revierte todo); true = guarda los cambios.
 */
function importar({ filas, actualizar = false, aplicar = false }, usuario) {
  if (!Array.isArray(filas) || !filas.length) throw new HttpError(400, 'El archivo no tiene filas');
  if (filas.length > MAX_FILAS) throw new HttpError(413, `El archivo tiene ${filas.length} filas; el máximo es ${MAX_FILAS}. Divídelo en partes.`);
  const limpias = filas.map((x, i) => ({ fila: Number(x.fila) || i + 2, datos: x.datos && typeof x.datos === 'object' ? x.datos : {} }));
  db.exec('BEGIN IMMEDIATE');
  try {
    const informe = procesar(limpias, { actualizar: !!actualizar }, usuario);
    db.exec(aplicar ? 'COMMIT' : 'ROLLBACK');
    const total = informe.filas.length;
    if (!total) throw new HttpError(400, 'No se encontraron filas con datos. Revisa que la primera fila tenga los nombres de las columnas.');
    return { aplicado: !!aplicar, total_filas: total, ...informe };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

module.exports = { importar, numero, fecha, booleano, clave };
