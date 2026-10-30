# FarmaBarrio — sistema de gestión para droguerías de barrio

Sistema web para una droguería: punto de venta con fórmula médica, control de vencimientos inteligente, alertas de stock crítico por WhatsApp, compras, fiado, caja y reportes. Un solo proceso Node + base SQLite (un archivo), sin servicios externos obligatorios.

## Arranque rápido

Requiere Node 22.13 o superior.

```bash
npm install
npm run seed     # opcional: datos de demostración (usuarios admin/admin123, regente/regente123, cajero/cajero123)
npm start        # http://localhost:3000
```

Sin `seed`, el primer arranque crea el usuario `admin` y muestra su contraseña en consola (o usa `ADMIN_PASSWORD=...`). La base queda en `data/drogueria.db`: **haz copia de ese archivo a diario**.

Variables útiles: `PORT`, `DB_FILE`, `TZ` (por defecto `America/Bogota`), `COOKIE_SECURE=1` si lo sirves por HTTPS.

## Desarrollo en Windows

Doble clic en `dev.bat`: instala dependencias, carga datos demo la primera vez, trae cada 15 s los cambios de GitHub (`git pull`) y reinicia el servidor solo. Abre http://localhost:3100 y pulsa F5 para ver los cambios.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Vencimiento inteligente** | Control por lote. Cruza la fecha de cada lote con la **rotación real** del producto (ventas de las últimas semanas) y el orden FEFO para estimar cuántas unidades *no alcanzarán a venderse*. Clasifica (vencido / crítico / atención), calcula el **dinero en riesgo** y sugiere la acción: baja, canje con el proveedor (según los días de devolución de cada uno) o promoción con descuento escalonado que **nunca baja del costo + 2 %**. |
| **POS** | Búsqueda por código de barras / nombre / principio activo, venta por **empaque o por unidad suelta** (tabletas), descuentos topados, IVA incluido, efectivo / tarjeta / transferencia / fiado, recibo imprimible. Descuenta siempre del lote que vence primero (FEFO) y **nunca vende lotes vencidos**. Aplica automáticamente el descuento sugerido por vencimiento. |
| **Venta con fórmula** | Los productos marcados "con fórmula" exigen paciente, médico y registro médico. Los de **control especial** además exigen documento del paciente y solo los despacha el regente/admin. Todo queda en el **libro de fórmulas** (exportable a CSV, con filtro de control especial). |
| **Stock crítico + WhatsApp** | Alerta si hay menos que el mínimo **o** si, por la rotación, se agotará antes de que llegue un pedido. Calcula cuánto pedir. Manda un mensaje resumen por WhatsApp solo cuando hay novedades (no repite el mismo aviso en el día) más un resumen diario. También arma el **pedido por proveedor** con enlace `wa.me` listo para enviar. |
| **Compras** | Ingreso de mercancía con lote y vencimiento; rechaza lotes ya vencidos. Actualiza costos. |
| **Inventario** | Catálogo, lotes, kardex de movimientos, bajas con motivo. |
| **Clientes / fiado** | Cartera, abonos y recordatorio de cobro por WhatsApp. |
| **Caja** | Apertura, cierre, efectivo esperado vs. contado, anulación de ventas (regente) que devuelve el stock. |
| **Reportes** | Ventas, utilidad bruta, más vendidos, medios de pago, libro de fórmulas. |
| **Usuarios y roles** | `cajero` (vende), `regente` (control especial, anulaciones, compras, bajas), `admin` (todo + configuración). |

## Configurar WhatsApp

Por defecto el modo es `simulado`: los mensajes se registran en *Stock y alertas → Historial* pero no se envían. Para enviar de verdad elige un proveedor:

**WhatsApp Cloud API (Meta)**
```bash
WA_PROVIDER=meta WA_TOKEN=<token permanente> WA_PHONE_ID=<id del número> npm start
```
Meta solo permite escribir libremente dentro de las 24 h posteriores a un mensaje del usuario. Para avisos automáticos crea una plantilla con **un solo parámetro `{{1}}`** en el cuerpo, apruébala y agrega `WA_TEMPLATE=<nombre> WA_TEMPLATE_LANG=es`. Los avisos llegan al propietario como texto en una sola línea separada por ` | `.

**Twilio**
```bash
WA_PROVIDER=twilio TWILIO_SID=... TWILIO_TOKEN=... TWILIO_FROM=573001234567 npm start
```

Luego, en **Configuración**, escribe los números destino (con indicativo, sin `+`, separados por coma) y la hora del resumen diario.

## Pruebas

```bash
npm test
```
Cubren login y roles, FEFO, venta fraccionada, rechazo de lotes vencidos y de stock insuficiente, fórmula y control especial, descuentos, fiado y anulación, el cálculo de riesgo de vencimiento, stock crítico, deduplicación de alertas y cierre de caja.

## Despliegue

Corre bien en un PC de la tienda o un VPS pequeño. Pon un proxy con HTTPS (Caddy/Nginx) delante y arranca con `COOKIE_SECURE=1`. Para mantenerlo vivo: `systemd` o `pm2`.

## Alcance y límites (léelo)

- **No emite factura electrónica DIAN** ni se integra con SIIGO/Alegra; el recibo es un comprobante interno. Si necesitas facturar electrónicamente, hay que integrar un proveedor tecnológico autorizado.
- **No trae catálogo de medicamentos ni valida registros INVIMA ni médicos**: los datos los carga la droguería.
- Los campos del libro de fórmulas y de control especial son una base útil, pero **confirma con tu regente de farmacia / secretaría de salud** si cumplen exactamente los formatos que te exigen (en Colombia, por ejemplo, los libros oficiales de control especial).
- Una sola sede y una sola base de datos local. No hay sincronización entre sucursales.
- Los descuentos automáticos por vencimiento son una **sugerencia** calculada con tu historial de ventas; el criterio final (y la devolución al proveedor) sigue siendo del regente.
