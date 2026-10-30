process.env.TZ = process.env.TZ || 'America/Bogota';
const fs = require('node:fs');
const { crearApp, asegurarAdmin } = require('./app');
const { iniciarPlanificador } = require('./alerts');
const { programar: programarRespaldo } = require('./respaldo');

asegurarAdmin();
iniciarPlanificador();
programarRespaldo();
const port = Number(process.env.PORT) || 3000;
const app = crearApp();

// HTTPS opcional: la cámara en vivo del celular solo funciona con HTTPS (o localhost). Ver README.
if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
  require('node:https').createServer({ key: fs.readFileSync(process.env.HTTPS_KEY), cert: fs.readFileSync(process.env.HTTPS_CERT) }, app)
    .listen(port, () => console.log(`VitalTrack lista en https://localhost:${port}`));
} else {
  app.listen(port, () => console.log(`VitalTrack lista en http://localhost:${port}`));
}
