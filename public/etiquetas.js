'use strict';
/* Etiquetas con QR de lote. El QR lleva "CODIGO|LOTE": el escáner lo reconoce y verifica ese lote.
   Depende de app.js (html, $, $$, GET, modal, cerrar, toast, guard, ic, S) y de vendor/qrcode.js. */

const qrSvg = texto => { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return new Safe(q.createSvgTag({ cellSize: 2, margin: 1, scalable: true })); };

/**
 * Ventana de impresión de etiquetas. Cada ítem: { qr, nombre, l1, l2 } (qr = texto que lleva el código).
 * `sinCodigo` lista los productos que no se pueden etiquetar por no tener código.
 */
function etiquetasGenericas(items, { titulo = 'Etiquetas QR', sinCodigo = [], copiasPor = 'etiqueta' } = {}) {
  const negocio = S.user.negocio || 'VitalTrack';
  const pintar = () => {
    const copias = Math.max(1, Math.min(50, Number($('#etCopias').value) || 1));
    const rollo = $('#etTam').value === 'rollo';
    $('#etLista').className = 'etiquetas' + (rollo ? ' rollo' : '');
    $('#etLista').innerHTML = html`${items.flatMap(l => Array.from({ length: copias }, () => html`<div class="etiq"><div class="qr">${qrSvg(l.qr)}</div>
      <div class="tx"><b>${l.nombre}</b>${l.l1 ? html`<span>${l.l1}</span>` : ''}${l.l2 ? html`<span>${l.l2}</span>` : ''}<small>${negocio}</small></div></div>`))}`.s;
    $('#etTotal').textContent = `${items.length * copias} etiqueta(s)`;
  };
  modal(html`<div class="row sp noprint"><h3>${ic('scan')} ${titulo}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    ${sinCodigo.length ? html`<div class="alertbox noprint"><b>Sin código de barras:</b> ${sinCodigo.slice(0, 8).join(', ')}${sinCodigo.length > 8 ? ` y ${sinCodigo.length - 8} más` : ''}. Asígnales un código en <b>Códigos QR</b> o en Inventario → Editar para poder imprimirles etiqueta.</div>` : ''}
    ${items.length ? html`<div class="row noprint" style="margin-bottom:12px"><label style="margin:0">Tamaño<select id="etTam"><option value="hoja">Hoja (varias por página)</option><option value="rollo">Rollo 50 × 30 mm (una por etiqueta)</option></select></label>
      <label style="margin:0">Copias por ${copiasPor}<input id="etCopias" type="number" min="1" max="50" value="1" style="width:90px"></label><span class="mut" id="etTotal"></span></div>
      <div id="etLista" class="etiquetas"></div>
      <div class="row noprint" style="margin-top:14px"><button class="btn primary" id="etImprimir">${ic('printer')} Imprimir</button><button class="btn" onclick="cerrar()">Cerrar</button></div>`
      : html`<p class="mut">No hay nada para etiquetar.</p><div class="row noprint"><button class="btn" onclick="cerrar()">Cerrar</button></div>`}`);
  if (!items.length) return;
  $('#etTam').onchange = pintar; $('#etCopias').oninput = pintar; pintar();
  $('#etImprimir').onclick = () => {
    // el tamaño de página se fija al imprimir: rollo = una etiqueta por página de 50 × 30 mm
    const est = document.createElement('style');
    est.textContent = $('#etTam').value === 'rollo' ? '@page{size:50mm 30mm;margin:0}' : '@page{size:auto;margin:8mm}';
    document.head.append(est);
    window.addEventListener('afterprint', () => est.remove(), { once: true });
    window.print();
  };
}

/** Etiquetas de lote: el QR lleva "CODIGO|LOTE" */
function etiquetasLotes(lotes, titulo = 'Etiquetas QR de lote') {
  etiquetasGenericas(lotes.filter(l => l.codigo).map(l => ({ qr: `${l.codigo}|${l.lote}`, nombre: l.nombre, l1: `Lote ${l.lote}`, l2: `Vence ${l.vence}` })),
    { titulo, sinCodigo: [...new Set(lotes.filter(l => !l.codigo).map(l => l.nombre))], copiasPor: 'lote' });
}

/** Etiquetas de medicamento (para el estante o la caja): el QR lleva el código del producto */
function etiquetasProductos(prods, titulo = 'Etiquetas QR de medicamentos') {
  etiquetasGenericas(prods.filter(p => p.codigo).map(p => ({ qr: p.codigo, nombre: p.nombre, l1: p.presentacion || '', l2: `${cop(p.precio_venta)}${p.codigo ? ' · ' + p.codigo : ''}` })),
    { titulo, sinCodigo: [...new Set(prods.filter(p => !p.codigo).map(p => p.nombre))], copiasPor: 'medicamento' });
}

/** Descarga el QR como imagen PNG con margen blanco (para compartirlo o imprimirlo desde otro programa) */
function descargarQR(texto, archivo = 'qr') {
  const svg = qrSvg(texto).s.replace('<svg ', '<svg width="600" height="600" ');
  const img = new Image();
  img.onload = () => {
    const c = Object.assign(document.createElement('canvas'), { width: 720, height: 720 }), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 720, 720); g.imageSmoothingEnabled = false; g.drawImage(img, 60, 60, 600, 600);
    c.toBlob(b => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: archivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') + '.png' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const etiquetasDe = guard(async (filtro, titulo) => etiquetasLotes(await GET('/etiquetas?' + new URLSearchParams(filtro)), titulo));

/** Tras ingresar mercancía: ofrece imprimir las etiquetas de esos lotes */
function ofrecerEtiquetas(compraId) {
  modal(html`<h3>${ic('check')} Mercancía ingresada</h3><p>¿Quieres imprimir las <b>etiquetas QR</b> de estos lotes? Pegadas en las cajas, el escáner verifica el lote y el vencimiento al instante.</p>
    <div class="row"><button class="btn primary" id="ofImp">${ic('printer')} Imprimir etiquetas</button><button class="btn" onclick="cerrar()">Ahora no</button></div>`);
  $('#ofImp').onclick = () => etiquetasDe({ compra_id: compraId }, 'Etiquetas del ingreso');
}
