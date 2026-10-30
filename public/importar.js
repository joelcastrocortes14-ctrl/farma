'use strict';
/* Importar productos e inventario inicial desde Excel (.xlsx) o CSV.
   El archivo se lee en el navegador (sin librerías externas) y el servidor valida y guarda.
   Depende de app.js: html, $, $$, GET/POST, modal, cerrar, toast, guard, ic, formData. */

/* ---------- lectura de archivos ---------- */
function leerTexto(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }          // CSV guardado por Excel en Windows
}

function parsearCSV(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const sep = [';', ',', '\t'].map(c => [c, primera.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.map((f, i) => ({ n: i + 1, celdas: f }));
}

/* .xlsx = zip de XML: se lee el directorio del zip y se descomprime con DecompressionStream */
async function leerZip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un Excel (.xlsx) válido');
  const total = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
  const entradas = {};
  for (let i = 0; i < total; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    entradas[nombre] = { metodo, datos: u8.subarray(ini, ini + comp) };
    p += 46 + nl + el + cl;
  }
  const leer = async nombre => {
    const e = entradas[nombre]; if (!e) return null;
    if (e.metodo === 0) return new TextDecoder().decode(e.datos);
    if (e.metodo !== 8) throw new Error('Compresión de Excel no soportada');
    const flujo = new Blob([e.datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(flujo).arrayBuffer());
  };
  return { leer, nombres: Object.keys(entradas) };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const porTag = (nodo, tag) => [...nodo.getElementsByTagNameNS('*', tag)];
const colIndice = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function parsearXLSX(buf) {
  const zip = await leerZip(buf);
  const libro = xml(await zip.leer('xl/workbook.xml') || '');
  const rels = xml(await zip.leer('xl/_rels/workbook.xml.rels') || '');
  const hoja1 = porTag(libro, 'sheet')[0];
  if (!hoja1) throw new Error('El Excel no tiene hojas');
  const rid = hoja1.getAttribute('r:id') || hoja1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rel = porTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
  let ruta = rel ? rel.getAttribute('Target') : 'worksheets/sheet1.xml';
  ruta = ruta.startsWith('/') ? ruta.slice(1) : 'xl/' + ruta;
  const textos = await zip.leer('xl/sharedStrings.xml');
  const compartidos = textos ? porTag(xml(textos), 'si').map(si => porTag(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('')) : [];
  const hoja = xml(await zip.leer(ruta) || '');
  const filas = [];
  for (const row of porTag(hoja, 'row')) {
    const celdas = [];
    for (const c of porTag(row, 'c')) {
      const t = c.getAttribute('t'), vNodo = porTag(c, 'v')[0], v = vNodo ? vNodo.textContent : '';
      let val;
      if (t === 's') val = compartidos[Number(v)] ?? '';
      else if (t === 'inlineStr') val = porTag(c, 't').map(x => x.textContent).join('');
      else if (t === 'b') val = v === '1' ? 'Sí' : 'No';
      else if (t === 'str' || t === 'e') val = v;
      else val = v === '' ? '' : Number(v);
      celdas[colIndice(c.getAttribute('r') || 'A1')] = val;
    }
    filas.push({ n: Number(row.getAttribute('r')) || filas.length + 1, celdas });
  }
  return filas;
}

/** Devuelve [{ fila, datos: { encabezado: valor } }] a partir de un archivo .xlsx / .csv */
async function leerArchivo(file) {
  const buf = await file.arrayBuffer();
  const esXlsx = new Uint8Array(buf, 0, 2).join() === '80,75';          // "PK"
  const filas = esXlsx ? await parsearXLSX(buf) : parsearCSV(leerTexto(buf));
  const iEnc = filas.findIndex(f => f.celdas.some(c => String(c ?? '').trim() !== ''));
  if (iEnc < 0) throw new Error('El archivo está vacío');
  const enc = filas[iEnc].celdas.map(c => String(c ?? '').trim());
  const out = [];
  for (const f of filas.slice(iEnc + 1)) {
    const datos = {};
    enc.forEach((h, i) => { if (h && f.celdas[i] !== undefined && String(f.celdas[i]).trim() !== '') datos[h] = f.celdas[i]; });
    if (Object.keys(datos).length) out.push({ fila: f.n, datos });
  }
  if (!out.length) throw new Error('No encontré filas con datos debajo de los encabezados');
  return out;
}

/* ---------- plantilla ---------- */
const COLUMNAS = [
  ['codigo', 'Código de barras o QR del producto', '7701234567890'],
  ['nombre', 'Nombre del producto (obligatorio)', 'Acetaminofén 500 mg'],
  ['principio_activo', 'Principio activo', 'Acetaminofén'],
  ['laboratorio', 'Laboratorio', 'MK'],
  ['presentacion', 'Presentación', 'Caja x 100 tabletas'],
  ['categoria', 'Categoría (sirve para las preguntas al asistente)', 'Analgésico'],
  ['requiere_formula', 'Se vende solo con fórmula: Sí / No', 'No'],
  ['control_especial', 'Medicamento de control especial: Sí / No', 'No'],
  ['invima', 'Registro INVIMA', 'INVIMA 2019M-0012345'],
  ['iva', 'IVA: 0, 5 o 19', '0'],
  ['unidades_por_empaque', 'Unidades por caja (tabletas, ml…) para vender suelto', '100'],
  ['precio_venta', 'Precio de venta de la caja (obligatorio en productos nuevos)', '9000'],
  ['precio_unidad', 'Precio por unidad suelta (vacío = automático)', '100'],
  ['costo', 'Costo de la caja', '5200'],
  ['stock_min', 'Stock mínimo, en cajas', '3'],
  ['proveedor', 'Proveedor (se crea si no existe)', 'Coopidrogas'],
  ['lote', 'Lote', 'AC2401'],
  ['vence', 'Vencimiento: 2027-06-30, 30/06/2027 o 06/2027', '06/2027'],
  ['existencia', 'Cuántas CAJAS hay de ese lote (admite 1,5)', '4'],
];
function descargarPlantilla() {
  const csv = '﻿' + COLUMNAS.map(c => c[0]).join(';') + '\r\n';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'plantilla-productos.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- ventana de importación ---------- */
function importarProductos(alTerminar) {
  let filas = null, nombreArchivo = '';
  const paso1 = () => {
    filas = null;
    modal(html`<div class="row sp"><h3>${ic('upload')} Importar productos e inventario</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
      <p class="mut" style="margin-top:-4px">Carga tu catálogo y tus existencias de una vez desde un archivo de <b>Excel (.xlsx)</b> o <b>CSV</b>. Si un producto tiene varios lotes, escribe <b>una fila por lote</b>.</p>
      <div class="alertbox ok"><b>Cómo hacerlo</b><ol style="margin:6px 0 0;padding-left:20px">
        <li>Descarga la plantilla y ábrela en Excel (o usa tu propio archivo: se reconocen nombres de columna parecidos).</li>
        <li>Llena una fila por cada lote. Solo son obligatorios <b>nombre</b> y <b>precio_venta</b>.</li>
        <li>Para cargar existencias de un lote escribe también <b>lote</b>, <b>vence</b> y <b>existencia</b> (en cajas).</li></ol></div>
      <div class="row" style="margin:12px 0"><button class="btn" id="imPlantilla">${ic('download')} Descargar plantilla</button></div>
      <label>Archivo (.xlsx o .csv)<input type="file" id="imArchivo" accept=".xlsx,.csv,.txt"></label><div id="imErr" class="error"></div>
      <details><summary class="mut" style="cursor:pointer">Ver todas las columnas</summary><div class="tw" style="margin-top:8px"><table><thead><tr><th>Columna</th><th>Qué va</th><th>Ejemplo</th></tr></thead><tbody>
        ${COLUMNAS.map(c => html`<tr><td><code>${c[0]}</code></td><td>${c[1]}</td><td class="mut">${c[2]}</td></tr>`)}</tbody></table></div></details>`);
    $('#imPlantilla').onclick = descargarPlantilla;
    $('#imArchivo').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#imErr').textContent = '';
      try { filas = await leerArchivo(f); nombreArchivo = f.name; await paso2(false); }
      catch (er) { $('#imErr').textContent = er.message; }
    };
  };

  const paso2 = async actualizar => {
    const r = await POST('/importar', { filas, actualizar, aplicar: false });
    const problemas = r.filas.filter(f => f.estado !== 'ok'), ok = r.filas.filter(f => f.estado === 'ok');
    const mostrar = [...problemas, ...ok].slice(0, 300);
    const hayAlgo = r.productos_nuevos + r.productos_actualizados + r.lotes > 0;
    modal(html`<div class="row sp"><h3>${ic('file')} Vista previa · ${nombreArchivo}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
      <p class="mut" style="margin-top:-4px">Todavía no se guardó nada. Revisa y confirma.</p>
      <div class="grid kpis" style="margin:12px 0">
        <div class="card kpi"><div class="l">Filas leídas</div><div class="n">${r.total_filas}</div></div>
        <div class="card kpi"><div class="l">Productos nuevos</div><div class="n" style="color:var(--green-d)">${r.productos_nuevos}</div>${r.productos_actualizados ? html`<div class="l">${r.productos_actualizados} se actualizan</div>` : r.productos_existentes ? html`<div class="l">${r.productos_existentes} ya existían</div>` : ''}</div>
        <div class="card kpi"><div class="l">Lotes a ingresar</div><div class="n">${r.lotes}</div><div class="l">${r.unidades.toLocaleString('es-CO')} unidades</div></div>
        <div class="card kpi"><div class="l">Con error</div><div class="n" style="color:${r.filas_error ? 'var(--red)' : 'inherit'}">${r.filas_error}</div><div class="l">${r.filas_aviso} con aviso</div></div></div>
      ${r.proveedores_nuevos.length ? html`<p class="mut">Se crearán estos proveedores: <b>${r.proveedores_nuevos.join(', ')}</b></p>` : ''}
      <label class="chk"><input type="checkbox" id="imAct" ${actualizar ? 'checked' : ''}> Actualizar los productos que ya existen (precio, costo, mínimo…)</label>
      ${r.filas_error ? html`<div class="alertbox rojo">${r.filas_error} fila(s) tienen errores y <b>no se importarán</b>. Corrige el archivo y súbelo de nuevo, o sigue con las demás filas.</div>` : ''}
      <div class="tw" style="max-height:300px"><table><thead><tr><th>Fila</th><th>Producto</th><th>Qué pasará</th><th>Detalle</th></tr></thead><tbody>
        ${mostrar.map(f => html`<tr><td>${f.fila}</td><td>${f.nombre || '—'}</td><td>${f.estado === 'error' ? html`<span class="badge red">Error</span>` : html`<span class="badge ${f.estado === 'aviso' ? 'amb' : 'grn'}">${f.accion || 'OK'}</span>`}</td><td class="mut">${f.mensajes.join(' · ')}</td></tr>`)}</tbody></table></div>
      ${r.filas.length > mostrar.length ? html`<p class="mut">Se muestran ${mostrar.length} de ${r.filas.length} filas (primero las que tienen problemas).</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn ok" id="imAplicar" ${hayAlgo ? '' : 'disabled'}>Importar ahora</button><button class="btn" id="imOtro">Elegir otro archivo</button><button class="btn ghost" onclick="cerrar()">Cancelar</button></div>`);
    $('#imAct').onchange = guard(async e => paso2(e.target.checked));
    $('#imOtro').onclick = paso1;
    $('#imAplicar').onclick = guard(async () => {
      $('#imAplicar').disabled = true;
      const fin = await POST('/importar', { filas, actualizar: $('#imAct').checked, aplicar: true });
      modal(html`<h3>${ic('check')} Importación lista</h3>
        <div class="alertbox ok"><b>${fin.productos_nuevos}</b> producto(s) nuevo(s)${fin.productos_actualizados ? html`, <b>${fin.productos_actualizados}</b> actualizado(s)` : ''}; <b>${fin.lotes}</b> lote(s) con <b>${fin.unidades.toLocaleString('es-CO')}</b> unidades ingresadas.</div>
        ${fin.filas_error ? html`<p class="mut">${fin.filas_error} fila(s) con error no se importaron.</p>` : ''}
        <p class="mut">Revisa el inventario, el semáforo y los pedidos sugeridos: ya trabajan con tus datos.</p>
        <div class="row"><button class="btn primary" onclick="cerrar()">Listo</button></div>`);
      toast('Importación terminada'); if (alTerminar) alTerminar();
    });
  };
  paso1();
}
