const { db, tx, cfgNum, hoy, ahora, fmt } = require('./db');
const { HttpError, fechaValida } = require('./inventory');
const { guardarImagen } = require('./archivos');

const sumarDias = (fecha, n) => fmt(new Date(Date.parse(fecha + 'T12:00:00') + n * 86400000)).slice(0, 10);

/**
 * Registra una fórmula médica con lo que prescribió el médico (productos y cantidades, en unidades).
 * El POS solo deja despachar contra el saldo de cada ítem.
 */
function crearReceta(b, usuario) {
  const req = (v, msg) => { if (!String(v || '').trim()) throw new HttpError(400, msg); };
  req(b.paciente, 'Falta el nombre del paciente'); req(b.medico, 'Falta el nombre del médico'); req(b.registro_medico, 'Falta el registro médico');
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'La receta no tiene medicamentos');
  const fecha = b.fecha_formula || hoy();
  if (!fechaValida(fecha)) throw new HttpError(400, 'Fecha de la fórmula inválida');
  if (fecha > hoy()) throw new HttpError(400, 'La fecha de la fórmula no puede ser futura');
  const vence = sumarDias(fecha, cfgNum('receta_vigencia_dias'));
  if (vence < hoy()) throw new HttpError(400, `La fórmula está vencida (vigencia ${cfgNum('receta_vigencia_dias')} días desde ${fecha})`);

  return tx(() => {
    let control = false;
    const items = [];
    for (const it of b.items) {
      const p = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(it.producto_id);
      if (!p) throw new HttpError(400, `Producto ${it.producto_id} no existe`);
      const unidades = Math.round(Number(it.cantidad) * (it.modo === 'empaque' ? p.factor : 1));
      if (!(unidades > 0)) throw new HttpError(400, `Cantidad inválida para ${p.nombre}`);
      if (p.control_especial) control = true;
      items.push({ producto_id: p.id, unidades });
    }
    if (control && !String(b.documento_paciente || '').trim()) throw new HttpError(400, 'Hay medicamentos de control especial: falta el documento del paciente');
    if (control && !b.imagen) throw new HttpError(400, 'Medicamentos de control especial: debes adjuntar la foto de la fórmula');
    const r = db.prepare(`INSERT INTO recetas(numero,fecha_formula,vence,paciente,documento_paciente,medico,registro_medico,institucion,creada,usuario_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.numero || null, fecha, vence, b.paciente.trim(), b.documento_paciente || null, b.medico.trim(), b.registro_medico.trim(), b.institucion || null, ahora(), usuario.id);
    const id = Number(r.lastInsertRowid);
    if (b.imagen) db.prepare('UPDATE recetas SET imagen = ? WHERE id = ?').run(guardarImagen('recetas', id, b.imagen), id);
    for (const it of items) db.prepare('INSERT INTO receta_items(receta_id,producto_id,cantidad) VALUES(?,?,?)').run(id, it.producto_id, it.unidades);
    return getReceta(id);
  });
}

function getReceta(id) {
  const r = db.prepare('SELECT * FROM recetas WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Receta no existe');
  r.items = db.prepare(`SELECT ri.*, p.nombre, p.presentacion, p.factor, p.control_especial, (ri.cantidad - ri.dispensado) AS saldo
    FROM receta_items ri JOIN productos p ON p.id = ri.producto_id WHERE ri.receta_id = ?`).all(id);
  r.vigente = r.vence >= hoy();
  r.completa = r.items.every(i => i.saldo <= 0);
  r.tiene_imagen = !!r.imagen;
  return r;
}

/** Recetas vigentes con saldo pendiente, por paciente, documento o número. */
function buscarRecetas(q, { todas = false } = {}) {
  const like = `%${String(q || '').trim()}%`;
  const ids = db.prepare(`SELECT id FROM recetas WHERE (paciente LIKE ? OR documento_paciente LIKE ? OR numero LIKE ? OR medico LIKE ?)
    ${todas ? '' : 'AND vence >= ?'} ORDER BY id DESC LIMIT 30`).all(...[like, like, like, like, ...(todas ? [] : [hoy()])]);
  const recetas = ids.map(r => getReceta(r.id));
  return todas ? recetas : recetas.filter(r => !r.completa);
}

module.exports = { crearReceta, getReceta, buscarRecetas };
