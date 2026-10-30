'use strict';
/* Guía rápida dentro del sistema: las tareas del día a día, paso a paso. */

const AYUDA = [
  ['Mi primer día', 'admin', [
    'Entra como <b>admin</b> y cambia la contraseña (menú → <b>Mi contraseña</b>).',
    'En <b>Configuración</b> escribe el nombre de la droguería y los números de WhatsApp que recibirán las alertas (con indicativo, sin +: 573001234567).',
    'Crea los usuarios: un <b>regente</b> (control especial, anulaciones, compras) y un <b>cajero</b> por cada persona que venda.',
    'Registra tus <b>proveedores</b> con su teléfono y los días que tardan en entregar.',
    'En <b>Inventario → Importar de Excel</b> carga tus productos y lotes. Descarga la plantilla si no sabes cómo armar el archivo.',
    'Haz una venta de prueba y revisa el ticket.']],
  ['Vender', 'todos', [
    'Abre <b>Vender</b>. La primera vez te pide abrir caja: escribe cuánto efectivo hay en el cajón.',
    'Busca el producto escribiendo parte del nombre (por ejemplo "acetam") o escanea el código de barras con el lector o con el botón <b>Cámara</b>.',
    'En cada línea elige si vendes por <b>unidad</b> (tableta suelta) o por <b>empaque</b> (caja) y la cantidad.',
    'Elige el cliente (si es fiado es obligatorio) y el medio de pago. Pulsa <b>Cobrar</b> o <b>F9</b>.',
    'El sistema descarga siempre el lote que <b>vence primero</b>. Un lote vencido nunca se vende: aparece como "BLOQUEADO".',
    'Si hay un descuento por vencimiento cercano, se aplica solo y nunca deja el producto por debajo del costo.',
    'Imprime el ticket: trae el lote y el vencimiento de cada producto.']],
  ['Vender con fórmula médica', 'todos', [
    'Cuando el carrito tiene un medicamento "con fórmula" aparece un recuadro pidiendo la receta.',
    'Pulsa <b>Seleccionar o registrar receta</b>. Si el paciente ya trajo una, búscala por nombre, documento o número.',
    'Si es nueva: llena paciente, médico y registro médico, <b>toma una foto de la fórmula</b> y agrega los medicamentos y cantidades que recetó el médico.',
    'Solo se puede despachar <b>lo recetado y hasta el saldo</b>. Si el paciente se lleva una parte hoy, el resto queda disponible para otra visita.',
    'Los medicamentos de <b>control especial</b> los despacha el regente y exigen documento del paciente y foto de la fórmula.',
    'Todo queda en <b>Reportes → Libro de fórmulas</b>, que se puede exportar a CSV.']],
  ['Recibir mercancía', 'staff', [
    'Entra a <b>Compras</b>, elige el proveedor y escribe el número de factura.',
    'Por cada producto escribe el <b>lote</b>, la <b>fecha de vencimiento</b>, la <b>cantidad en cajas</b> y el costo de la caja. No se pueden ingresar lotes ya vencidos.',
    'Pulsa <b>Registrar ingreso</b>. El sistema te ofrece imprimir las <b>etiquetas QR</b> de esos lotes: pégalas en las cajas.',
    'Si algún cliente había pedido que le avisaran de ese producto, se le escribe por WhatsApp automáticamente.']],
  ['Vencimientos y bajas', 'todos', [
    'Cada producto tiene un semáforo: <b>verde</b> bien, <b>amarillo</b> vence en 3 meses o menos, <b>rojo</b> vence en 30 días, ya venció o hay poco stock.',
    'En <b>Vencimientos</b> ves qué hacer con cada lote: vender primero, pedir canje al proveedor, ofrecer descuento o dar de baja.',
    'El botón rojo del inicio <b>¿Qué vence esta semana?</b> es la lista de emergencia.',
    'Para sacar un lote vencido o dañado, el regente pulsa <b>Dar de baja</b> y elige el motivo. Queda registrado y se suma en <b>Reportes → Plata que se pierde</b>.']],
  ['Qué pedir', 'todos', [
    'En <b>Pedidos y alertas</b> el sistema calcula, con lo que realmente vendes por día y lo que demora cada proveedor, cuándo se te acaba cada producto.',
    'Dice cosas como <b>"Pide mañana o te quedas sin stock"</b> y cuántas cajas pedir.',
    'Más abajo está el pedido armado por proveedor: el botón <b>Enviar pedido por WhatsApp</b> abre el chat con el mensaje listo.',
    'También puedes bajar todo a Excel.']],
  ['Escáner y etiquetas QR', 'todos', [
    'El botón <b>Escanear</b> (arriba) lee un código de barras o un QR y muestra precio, lote que sale primero, vencimiento y proveedor.',
    'En el celular, si el navegador no deja abrir la cámara en vivo, toma una <b>foto del código</b> y se lee igual.',
    'Las etiquetas QR de lote llevan <b>CODIGO|LOTE</b>. Si escaneas una y ese lote no está en tus compras, aparece en <b>rojo</b>: revisa la procedencia y el registro INVIMA antes de venderlo.']],
  ['Clientes y fiado', 'todos', [
    'En <b>Clientes</b> registras a quien compra fiado. Cada compra fiada suma a su saldo; los abonos lo bajan.',
    'Al abrir un cliente ves lo que compra seguido y cada cuánto. Puedes pedir que se le avise cuando llegue un producto agotado.',
    'El botón <b>Recordar</b> abre un chat de WhatsApp con el cobro ya escrito.']],
  ['Cerrar la caja', 'todos', [
    'Al terminar el turno entra a <b>Caja</b>, cuenta el efectivo y escríbelo.',
    'El sistema compara con lo que debería haber (base + ventas en efectivo + abonos) y muestra la <b>diferencia</b>.']],
  ['Preguntarle al asistente', 'todos', [
    'El botón azul y verde de abajo a la derecha abre el asistente. Prueba con: <i>¿qué antibióticos me quedan con stock bajo?</i>, <i>¿qué vence esta semana?</i>, <i>¿qué debo pedir?</i>, <i>¿cuánto acetaminofén tengo?</i>.',
    'Las preguntas sobre ventas, más vendidos y cartera solo las responde al regente y al administrador.']],
  ['Respaldos y seguridad', 'admin', [
    'Cada día se crea un <b>respaldo automático</b> de la base de datos (se guardan los últimos 14). Descárgalos desde <b>Configuración → Respaldos</b>.',
    'Copia de vez en cuando la carpeta <code>data</code> completa (trae las fotos de las recetas) a una USB o a tu Drive.',
    'Cada persona debe tener su propio usuario y su propia contraseña. No compartas la del administrador.',
    'Si olvidas la contraseña de un usuario, el administrador le asigna una nueva en <b>Configuración → Usuarios → Editar</b>. Si es el administrador quien la olvidó, en el servidor se ejecuta <code>npm run clave -- admin "NuevaClave9"</code>.']],
  ['Me equivoqué, ¿qué hago?', 'todos', [
    '<b>Una venta mal hecha:</b> el regente la anula desde <b>Caja → Últimas ventas</b>; el stock vuelve al lote y, si era con fórmula, el saldo de la receta también.',
    '<b>Un producto no aparece al vender:</b> revisa en <b>Inventario</b> si tiene existencias vendibles. Si solo quedan lotes vencidos, el sistema lo bloquea.',
    '<b>El stock no coincide con el conteo:</b> abre el producto (Inventario → Ver), pulsa <b>Contar</b> en el lote y escribe lo que hay de verdad. El sistema ajusta la diferencia; si faltaba, cuenta como pérdida.']],
];

V.ayuda = async el => {
  const rol = S.user.rol;
  const visible = AYUDA.filter(([, para]) => para === 'todos' || (para === 'staff' && rol !== 'cajero') || (para === 'admin' && rol === 'admin'));
  el.innerHTML = html`<p class="mut" style="margin-top:0;max-width:70ch">Las tareas del día a día, paso a paso. Toca un tema para abrirlo.</p>
    <div class="grid" style="max-width:860px">${visible.map(([titulo, , pasos], i) => html`<details class="card" ${i === 0 ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;font-size:17px">${titulo}</summary>
      <ol style="margin:12px 0 0;padding-left:22px;display:grid;gap:8px">${pasos.map(p => html`<li>${new Safe(p)}</li>`)}</ol></details>`)}</div>`.s;
};
