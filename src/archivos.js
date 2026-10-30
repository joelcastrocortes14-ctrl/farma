const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./db');
const { HttpError } = require('./inventory');

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_BYTES = 2.5 * 1024 * 1024;

/** Guarda una imagen enviada como data URL (el navegador ya la reduce). Devuelve la extensión. */
function guardarImagen(subcarpeta, id, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'La imagen debe ser JPG, PNG o WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'La imagen pesa más de 2,5 MB');
  const ext = TIPOS[m[1]];
  const dir = path.join(dataDir, subcarpeta);
  fs.mkdirSync(dir, { recursive: true });
  for (const e of Object.values(TIPOS)) fs.rmSync(path.join(dir, `${id}.${e}`), { force: true }); // una sola imagen por id
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
  return ext;
}

function rutaImagen(subcarpeta, id, ext) {
  if (!ext || !MIME[ext]) return null;
  const f = path.join(dataDir, subcarpeta, `${Number(id)}.${ext}`);
  return fs.existsSync(f) ? { file: f, mime: MIME[ext] } : null;
}

module.exports = { guardarImagen, rutaImagen };
