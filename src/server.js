process.env.TZ = process.env.TZ || 'America/Bogota';
const { crearApp, asegurarAdmin } = require('./app');
const { iniciarPlanificador } = require('./alerts');

asegurarAdmin();
iniciarPlanificador();
const port = Number(process.env.PORT) || 3000;
crearApp().listen(port, () => console.log(`Droguería lista en http://localhost:${port}`));
