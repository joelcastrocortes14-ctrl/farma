# VitalTrack — control inteligente de farmacia

Sistema web para droguerías de barrio: vencimientos inteligentes, venta con receta, escáner con el celular, pedidos automáticos, alertas por WhatsApp, proveedores, clientes, caja y reportes. Un solo proceso Node con una base SQLite (un archivo). Sin servicios externos obligatorios.

## Arranque rápido

Requiere Node 22.13 o superior.

```bash
npm install
npm run seed     # opcional: datos de demostración (admin/admin123, regente/regente123, cajero/cajero123; el sistema te avisa que las cambies)
npm start        # http://localhost:3000
```

Sin `seed`, el primer arranque crea el usuario `admin` y muestra su contraseña en consola (o usa `ADMIN_PASSWORD=...`). La base y las fotos quedan en `data/`. Cada día se crea un **respaldo automático** de la base en `data/respaldos` (se guardan los últimos 14; también se descargan desde *Configuración*). Copia la carpeta `data` a una USB o a tu Drive de vez en cuando.

**Windows (desarrollo):** doble clic en `dev.bat`. Trae los cambios de GitHub cada 15 s y reinicia el servidor solo. Abre http://localhost:3100 y pulsa F5 para ver los cambios.

Variables: `PORT`, `DB_FILE`, `TZ` (por defecto `America/Bogota`), `COOKIE_SECURE=1` con HTTPS, `HTTPS_KEY` + `HTTPS_CERT` para servir por HTTPS.

## Primer día

Al entrar, el inicio muestra **Primeros pasos** (contraseña, nombre del negocio, WhatsApp, proveedores, productos, primera venta) y se marcan solos. En el menú hay una **Ayuda** con las tareas del día a día, paso a paso, según el rol.

Si el administrador olvida su contraseña, se restablece desde el servidor:

```bash
npm run clave -- admin "NuevaClaveSegura9"
```

## Control inteligente

- **Semáforo por producto, automático:** verde (bien), amarillo (un lote vence en 90 días o menos, o el stock se agotará pronto), rojo (vencido, vence en 30 días o menos, o stock bajo). Cambia solo con las ventas y las fechas. Los umbrales se ajustan en *Configuración*.
- **Vencimiento inteligente:** cruza la fecha de cada lote con lo que realmente rota el producto y el orden FEFO, para estimar cuántas unidades no alcanzarán a venderse. Calcula el dinero en riesgo y sugiere baja, canje con el proveedor o un descuento que **nunca baja del costo + 2 %**.
- **Botón "¿Qué vence esta semana?"** en el inicio: lista lo vencido y lo que vence en 7 días, con la acción sugerida.
- **Sugerencia de pedido automática:** con lo que vendes por día y lo que demora cada proveedor en entregar. Con 20 u/día, 40 en stock y entrega en 1 día, dice *"Pide mañana o te quedas sin stock"*. Genera el pedido por proveedor con enlace de WhatsApp.

## Para no perder plata

- **FIFO/FEFO obligatorio:** el sistema descuenta siempre del lote que vence primero; no se elige a mano.
- **Vencidos bloqueados:** un lote vencido no se puede facturar. Si solo quedan unidades vencidas, el POS lo dice y bloquea.
- **Recetas:** se registra la fórmula (con foto) con lo que prescribió el médico. En el POS solo se despacha lo recetado y hasta el saldo de cada medicamento (sirve para despachos parciales). Los de **control especial** exigen documento del paciente y foto, y solo los despacha el regente. Queda un **libro de fórmulas** exportable a CSV.
- **Lote no registrado:** al escanear un QR de lote (`CODIGO|LOTE`), si ese lote no está en tus compras el sistema lo marca en rojo para que verifiques la procedencia y el registro INVIMA.

## Escáner con el celular

Botón **Escanear** (arriba) y **Cámara** (en el punto de venta). Lee códigos de barras y QR; muestra precio, lote que sale primero, vencimiento y proveedor. En el POS agrega el producto al carrito sin digitar. También funciona con un lector USB.

La **cámara en vivo** solo la permiten los navegadores con **HTTPS** o en `localhost`. Si abres el sistema desde el celular por `http://192.168.x.x:3100`, el sistema te pide **tomar una foto del código** y lo lee igual. Para cámara en vivo en el celular:

1. **Túnel HTTPS rápido:** `cloudflared tunnel --url http://localhost:3100` te da una dirección `https://…` temporal.
2. **HTTPS local:** crea un certificado con [mkcert](https://github.com/FiloSottile/mkcert) y arranca con `HTTPS_KEY=clave.pem HTTPS_CERT=cert.pem npm start`.

## Más módulos

| Módulo | Qué hace |
|---|---|
| **Vender (POS)** | Búsqueda inteligente (escribes "acetam" y aparece con su foto), venta por empaque o unidad suelta, descuentos topados, efectivo / tarjeta / transferencia / fiado. |
| **Ticket** | Con lote y vencimiento de cada línea, listo para rollo de 80 mm. Es un comprobante interno, **no** una factura electrónica DIAN. |
| **Proveedores** | Quién te vendió, a cuánto, en cuánto tiempo llega, variación de precios y comparación entre proveedores. |
| **Clientes (CRM)** | Historial, lo que compra seguido y cada cuánto, cartera. Pueden pedir que se les avise cuando llegue un producto: al ingresar la compra se envía el WhatsApp. Los clientes habituales de un producto que llegó se sugieren, pero **no se les escribe solos**. |
| **Asistente** | Chat que responde preguntas como *"¿qué antibióticos me quedan con stock bajo?"*, *"¿qué vence esta semana?"*, *"¿cuánto vendí hoy?"*. Funciona con reglas sobre tus propios datos: sin servicio externo ni costo. |
| **Alertas WhatsApp** | Stock crítico y vencimientos, sin repetir el mismo aviso en el día, más resumen diario. En *Pedidos y alertas* hay un panel que dice qué falta configurar y un botón **Mensaje de prueba**. |
| **Conteo físico** | En la ficha del producto (*Inventario → Ver*), botón **Contar** por lote: escribes lo que hay de verdad y el sistema ajusta la diferencia. Queda en el kardex; los faltantes cuentan como pérdida. |
| **Pérdidas** | En *Reportes*: plata dada de baja por motivo (vencido, dañado…), lo vencido que sigue en bodega y lo que está en riesgo. |
| **App en el celular** | Se puede instalar: en Chrome (Android) *Instalar app* / *Agregar a la pantalla de inicio*; en iPhone, Safari → Compartir → *Agregar a inicio*. Abre sin la barra del navegador. Necesita conexión: no funciona sin internet ni sin la red de la tienda. |
| **Etiquetas QR de lote** | Imprime etiquetas (hoja o rollo de 50 × 30 mm) con el QR `CODIGO|LOTE`, nombre, lote y vencimiento. Se ofrecen al ingresar una compra y desde la ficha del producto. Al escanearlas, el sistema verifica el lote al instante. |
| **Exportar a Excel** | Inventario con lotes, ventas con detalle y utilidad, pedido sugerido y cartera de clientes, en archivos `.xlsx` reales (con filtros y fechas). Solo regente y administrador. |
| **Compras, inventario, caja, reportes, usuarios** | Ingreso con lote y vencimiento, kardex, bajas, cierre de caja, ventas y utilidad, roles cajero / regente / admin. |
| **Modo oscuro** | Botón en la cabecera (turno nocturno). Recuerda tu elección. |

## Cargar tus productos reales (Excel o CSV)

En **Inventario → Importar de Excel**:

1. Descarga la plantilla (o usa tu propio archivo: se reconocen nombres de columna parecidos, como `producto`, `precio`, `vencimiento`).
2. Llena **una fila por lote**. Solo son obligatorios `nombre` y `precio_venta`. Para cargar existencias de un lote agrega `lote`, `vence` y `existencia` (en **cajas**, admite 1,5).
3. Sube el archivo (.xlsx o .csv). Verás una **vista previa exacta** de lo que pasará, fila por fila, sin guardar nada.
4. Confirma. Los productos y los lotes quedan cargados.

Entiende precios como `$ 24.500` o `12.500,50`, fechas como `2027-06-30`, `30/06/2027` o `06/2027` (último día del mes) y Sí/No en fórmula y control especial. Crea los proveedores que no existan. Si reimportas el mismo archivo no duplica lotes; con "Actualizar los productos que ya existen" cambia precios, costos y mínimos.

## Publicar en internet

Sirve para usar VitalTrack desde el celular o desde cualquier computador, sin dejar un PC encendido. Además da HTTPS, así que la **cámara en vivo** del escáner funciona en el celular. El repositorio ya trae `Dockerfile` y `render.yaml`.

**En Render (https://render.com):**

1. Crea una cuenta y conecta tu GitHub.
2. **New → Blueprint** y elige este repositorio. Render lee `render.yaml` y crea el servicio con un **disco persistente** (la base de datos es un archivo SQLite, así que el disco es obligatorio; ese plan tiene costo mensual, revisa el precio vigente).
3. Cuando termine, abre la dirección `https://….onrender.com`. En **Environment** verás `ADMIN_PASSWORD`: es la contraseña inicial del usuario `admin`. Entra y cámbiala.
4. Carga tu inventario con *Inventario → Importar de Excel*. No se cargan los datos de demostración.
5. Cada cambio que se suba a la rama configurada se publica solo.

Para WhatsApp, agrega las variables `WA_PROVIDER`, `WA_TOKEN` y `WA_PHONE_ID` en el panel (ver *Configurar WhatsApp*).

**Antes de publicar, revisa:**
- Cambia la contraseña de `admin` y crea tus usuarios reales. Ya no uses las de demostración.
- Los respaldos se guardan en el mismo disco: descarga uno de vez en cuando desde *Configuración*.
- Esto contiene datos de pacientes y recetas: usa solo HTTPS y no compartas el enlace con quien no deba entrar.

También funciona en Railway o Fly.io: cualquier servicio que ejecute el `Dockerfile` y monte un volumen en `/data`.

## Configurar WhatsApp

Por defecto el modo es `simulado`: los mensajes se registran pero no se envían. Para enviar de verdad:

**WhatsApp Cloud API (Meta)**
```bash
WA_PROVIDER=meta WA_TOKEN=<token> WA_PHONE_ID=<id del número> npm start
```
Meta exige una plantilla aprobada con **un parámetro `{{1}}`** para avisos automáticos: `WA_TEMPLATE=<nombre> WA_TEMPLATE_LANG=es`.

**Twilio**
```bash
WA_PROVIDER=twilio TWILIO_SID=... TWILIO_TOKEN=... TWILIO_FROM=573001234567 npm start
```

En **Configuración** escribe los números destino (con indicativo, sin `+`, separados por coma).

## Pruebas

```bash
npm test
```

## Límites (léelo)

- **No detecta medicamentos falsificados.** Lo que hace es marcar lotes que no aparecen en tus compras, productos sin registro INVIMA y lotes vencidos. La verificación real sigue siendo del regente y de las fuentes oficiales.
- **No emite factura electrónica DIAN.** Para eso hay que integrar un proveedor tecnológico autorizado.
- El asistente entiende un conjunto de preguntas frecuentes, no cualquier frase. Si no entiende, sugiere ejemplos.
- No trae catálogo de medicamentos ni fotos: las cargas tú desde *Inventario → Editar*.
- Confirma con tu regente de farmacia si los campos del libro de fórmulas y de control especial cumplen los formatos que te exigen.
- Una sola sede, una sola base de datos local.
- Los descuentos automáticos son una sugerencia calculada con tu historial; el criterio final es del regente.
