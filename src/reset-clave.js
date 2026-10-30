// Restablece la contraseña de un usuario desde la terminal (por si el administrador la olvida):
//   npm run clave -- admin "NuevaClaveSegura9"
// Con la base en otra ruta: DB_FILE=/data/drogueria.db npm run clave -- admin "NuevaClaveSegura9"
const { db } = require('./db');
const { hashPassword, claveFacil } = require('./auth');

const [usuario, clave] = process.argv.slice(2);
if (!usuario || !clave) { console.error('Uso: npm run clave -- <usuario> "<nueva contraseña>"'); process.exit(1); }
if (clave.length < 8) { console.error('La contraseña debe tener al menos 8 caracteres.'); process.exit(1); }
if (claveFacil(usuario, clave)) { console.error('Esa contraseña es demasiado fácil de adivinar. Elige otra.'); process.exit(1); }
const r = db.prepare('UPDATE usuarios SET hash = ?, clave_demo = 0, activo = 1 WHERE usuario = ?').run(hashPassword(clave), usuario);
if (!r.changes) { console.error(`No existe el usuario "${usuario}".`); process.exit(1); }
db.prepare('DELETE FROM sesiones WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = ?)').run(usuario);
console.log(`Contraseña de "${usuario}" restablecida. Se cerraron sus sesiones abiertas.`);
