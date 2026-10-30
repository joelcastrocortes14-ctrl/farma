'use strict';
/* Etiquetas con QR de lote. El QR lleva "CODIGO|LOTE": el escáner lo reconoce y verifica ese lote.
   Depende de app.js (html, $, $$, GET, modal, cerrar, toast, guard, ic, S) y de vendor/qrcode.js. */

const qrSvg = texto => { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return new Safe(q.createSvgTag({ cellSize: 2, margin: 1, scalable: true })); };

function etiquetasLotes(lotes, titulo = 'Etiquetas QR de lote') {
  const utiles = lotes.filter(l => l.codigo), sinCodigo = [...new Set(lotes.filter(l => !l.codigo).map(l => l.nombre))];
  const negocio = S.user.negocio || 'VitalTrack';
  const pintar = () => {
    const copias = Math.max(1, Math.min(50, Number($('#etCopias').value) || 1));
    const rollo = $('#etTam').value === 'rollo';
    $('#etLista').className = 'etiquetas' + (rollo ? ' rollo' : '');
    $('#etLista').innerHTML = html`${utiles.flatMap(l => Array.from({ length: copias }, () => html`<div class="etiq"><div class="qr">${qrSvg(`${l.codigo}|${l.lote}`)}</div>
      <div class="tx"><b>${l.nombre}</b><span>Lote ${l.lote}</span><span>Vence ${l.vence}</span><small>${negocio}</small></div></div>`))}`.s;
    $('#etTotal').textContent = `${utiles.length * copias} etiqueta(s)`;
  };
  modal(html`<div class="row sp noprint"><h3>${ic('scan')} ${titulo}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    ${sinCodigo.length ? html`<div class="alertbox noprint"><b>Sin código de barras:</b> ${sinCodigo.join(', ')}. Agrégalo en Inventario → Editar para poder imprimir su etiqueta.</div>` : ''}
    ${utiles.length ? html`<div class="row noprint" style="margin-bottom:12px"><label style="margin:0">Tamaño<select id="etTam"><option value="hoja">Hoja (varias por página)</option><option value="rollo">Rollo 50 × 30 mm (una por etiqueta)</option></select></label>
      <label style="margin:0">Copias por lote<input id="etCopias" type="number" min="1" max="50" value="1" style="width:90px"></label><span class="mut" id="etTotal"></span></div>
      <div id="etLista" class="etiquetas"></div>
      <div class="row noprint" style="margin-top:14px"><button class="btn primary" id="etImprimir">${ic('printer')} Imprimir</button><button class="btn" onclick="cerrar()">Cerrar</button></div>`
      : html`<p class="mut">No hay lotes con código para etiquetar.</p><div class="row noprint"><button class="btn" onclick="cerrar()">Cerrar</button></div>`}`);
  if (!utiles.length) return;
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

const etiquetasDe = guard(async (filtro, titulo) => etiquetasLotes(await GET('/etiquetas?' + new URLSearchParams(filtro)), titulo));

/** Tras ingresar mercancía: ofrece imprimir las etiquetas de esos lotes */
function ofrecerEtiquetas(compraId) {
  modal(html`<h3>${ic('check')} Mercancía ingresada</h3><p>¿Quieres imprimir las <b>etiquetas QR</b> de estos lotes? Pegadas en las cajas, el escáner verifica el lote y el vencimiento al instante.</p>
    <div class="row"><button class="btn primary" id="ofImp">${ic('printer')} Imprimir etiquetas</button><button class="btn" onclick="cerrar()">Ahora no</button></div>`);
  $('#ofImp').onclick = () => etiquetasDe({ compra_id: compraId }, 'Etiquetas del ingreso');
}
