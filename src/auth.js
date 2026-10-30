const crypto = require('node:crypto');
const { db, ahora } = require('./db');
const { HttpError } = require('./inventory');

const SESION_HORAS = 12;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Límite simple contra fuerza bruta: 8 fallos por IP cada 15 min
const fallos = new Map();
function limiteLogin(ip) {
  const f = fallos.get(ip);
  if (f && f.n >= 8 && Date.now() - f.t < 15 * 60000) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
}

function login(usuario, password, ip) {
  limiteLogin(ip);
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(String(usuario || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.hash)) {
    const f = fallos.get(ip);
    fallos.set(ip, { n: (f && Date.now() - f.t < 15 * 60000 ? f.n : 0) + 1, t: Date.now() });
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  fallos.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones(token, usuario_id, creada) VALUES(?,?,?)').run(token, u.id, ahora());
  return { token, usuario: publico(u) };
}

const publico = u => ({ id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol });

const clavesFaciles = usuario => [`${usuario}123`, 'admin123', 'regente123', 'cajero123', '12345678', '123456', 'password', usuario];

/** ¿Sigue usando una contraseña de demostración o evidente? */
const esClaveDemo = (usuario, hash) => clavesFaciles(usuario).some(c => verifyPassword(c, hash));

function cambiarClave(usuarioId, actual, nueva) {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  nueva = String(nueva || '');
  if (!verifyPassword(String(actual || ''), u.hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
  if (nueva.length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  if (clavesFaciles(u.usuario).includes(nueva.toLowerCase())) throw new HttpError(400, 'Esa contraseña es demasiado fácil de adivinar. Elige otra.');
  db.prepare('UPDATE usuarios SET hash = ? WHERE id = ?').run(hashPassword(nueva), usuarioId);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]));
}

function requireAuth(req, _res, next) {
  const token = cookies(req).sid;
  const s = token && db.prepare('SELECT s.creada, u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND u.activo = 1').get(token);
  if (!s || Date.now() - Date.parse(s.creada) > SESION_HORAS * 3600000) {
    if (token) db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    return next(new HttpError(401, 'Sesión expirada'));
  }
  req.user = publico(s);
  next();
}

const roles = (...permitidos) => (req, _res, next) =>
  permitidos.includes(req.user.rol) ? next() : next(new HttpError(403, 'No tienes permiso para esta acción'));

function logout(req) {
  const t = cookies(req).sid;
  if (t) db.prepare('DELETE FROM sesiones WHERE token = ?').run(t);
}

module.exports = { esClaveDemo, cambiarClave, hashPassword, verifyPassword, login, logout, requireAuth, roles, publico };
