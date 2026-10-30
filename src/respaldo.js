/**
 * Respaldo automático de la base de datos: una copia consistente por día en data/respaldos,
 * conservando las últimas 14. Las fotos y recetas escaneadas quedan en data/fotos y data/recetas.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, dataDir, hoy, fmt } = require('./db');
const { HttpError } = require('./inventory');

const dir = () => path.join(dataDir, 'respaldos');
const PATRON = /^vitaltrack-\d{4}-\d{2}-\d{2}(-\d{2}-\d{2}-\d{2})?\.db$/;
const CONSERVAR = 14;

function listar() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir()).filter(n => PATRON.test(n)).map(nombre => {
    const st = fs.statSync(path.join(dir(), nombre));
    return { nombre, bytes: st.size, fecha: fmt(st.mtime) };
  }).sort((a, b) => b.nombre.localeCompare(a.nombre));
}

function limpiar() {
  for (const r of listar().slice(CONSERVAR)) fs.rmSync(path.join(dir(), r.nombre), { force: true });
}

/** VACUUM INTO produce una copia consistente aunque haya ventas en curso. */
function crear() {
  fs.mkdirSync(dir(), { recursive: true });
  const nombre = `vitaltrack-${fmt(new Date()).replace(/[T:]/g, '-')}.db`;
  const destino = path.join(dir(), nombre);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  limpiar();
  return listar().find(r => r.nombre === nombre);
}

const hayDeHoy = () => listar().some(r => r.nombre.startsWith('vitaltrack-' + hoy()));

function rutaDe(nombre) {
  if (!PATRON.test(nombre) || !listar().some(r => r.nombre === nombre)) throw new HttpError(404, 'Respaldo no encontrado');
  return path.join(dir(), nombre);
}

/** Al arrancar y cada hora: si todavía no hay respaldo de hoy, lo crea. */
function programar() {
  const tick = () => { try { if (!hayDeHoy()) crear(); } catch (e) { console.error('[respaldo]', e.message); } };
  setTimeout(tick, 15000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { crear, listar, rutaDe, programar, hayDeHoy };
