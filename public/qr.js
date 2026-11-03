'use strict';
/* Códigos QR: cada medicamento (QR = su código) y cada lote (QR = CODIGO|LOTE), listos para ver, descargar e imprimir.
   Depende de app.js y etiquetas.js (html, $, GET, POST, modal, cerrar, toast, guard, ic, V, qrSvg, etiquetas*, descargarQR). */

const QR_SEL = new Set();          // elementos marcados para imprimir (se conservan al buscar o cambiar de pestaña)

const textoQR = (p, l) => l ? `${p.codigo}|${l.lote}` : p.codigo;

V.qr = async el => {
  const q = el.dataset.qrq || '', modo = el.dataset.qrmodo === 'lotes' ? 'lotes' : 'med';
  const lista = await GET('/qr?q=' + encodeURIComponent(q));
  const sin = lista.filter(p => !p.codigo);
  const items = modo === 'med' ? lista.map(p => ({ key: 'p' + p.id, p })) : lista.flatMap(p => p.lotes.map(l => ({ key: 'l' + l.id, p, l })));
  const nSel = items.filter(i => QR_SEL.has(i.key)).length;

  el.innerHTML = html`<div class="row sp" style="margin-bottom:14px"><div class="row" style="gap:10px;flex:1">
      <input id="qrBusca" class="grow" style="max-width:380px" placeholder="Buscar por nombre o por código…" value="${q}" autocomplete="off">
      <div class="seg"><button data-modo="med" class="${modo === 'med' ? 'on' : ''}">Medicamentos</button><button data-modo="lotes" class="${modo === 'lotes' ? 'on' : ''}">Lotes</button></div></div>
    <button class="btn primary" id="qrImprimir" ${items.some(i => i.p.codigo) ? '' : 'disabled'}>${ic('printer')} ${nSel ? `Imprimir ${nSel} marcado(s)` : `Imprimir todos (${items.filter(i => i.p.codigo).length})`}</button></div>
    ${sin.length ? html`<div class="alertbox"><div class="row sp"><span><b>${sin.length} medicamento(s) no tienen código de barras</b>, por eso no tienen QR. Con un <b>código interno</b> (por ejemplo VT000012) ya se pueden etiquetar y escanear.</span><button class="btn sm" id="qrAsignarTodos">Asignar códigos internos</button></div></div>` : ''}
    <p class="mut" style="margin:0 0 12px">${modo === 'med' ? 'El QR de cada medicamento lleva su código: al escanearlo aparece el precio, el lote que sale primero y el proveedor.' : 'El QR de cada lote lleva el código y el lote (CODIGO|LOTE): al escanearlo el sistema verifica ese lote y su vencimiento.'}</p>
    <div class="qrs">${items.map(({ key, p, l }) => html`<div class="qrcard ${QR_SEL.has(key) ? 'sel' : ''}">
      ${p.codigo ? html`<label class="qrsel" title="Marcar para imprimir"><input type="checkbox" data-sel="${key}" ${QR_SEL.has(key) ? 'checked' : ''}></label>` : ''}
      <div class="q">${p.codigo ? qrSvg(textoQR(p, l)) : html`<div class="noqr">${ic('x')}<span>Sin código</span></div>`}</div>
      <b>${p.nombre}</b><span class="mut">${l ? `Lote ${l.lote} · vence ${l.vence}` : (p.presentacion || ' ')}</span>
      <code>${p.codigo ? textoQR(p, l) : 'sin código'}</code>
      <div class="row" style="gap:6px;margin-top:2px">${p.codigo ? html`<button class="btn sm" data-ver="${key}">Ver</button>` : html`<button class="btn sm primary" data-asig="${p.id}">Asignar código</button>`}</div></div>`)}
      ${items.length ? '' : html`<p class="mut">${modo === 'lotes' ? 'No hay lotes con existencia que coincidan.' : 'No hay medicamentos que coincidan.'}</p>`}</div>
    <div class="card" style="margin-top:20px;max-width:640px"><h3>Generar el QR de un código</h3>
      <p class="mut" style="margin-top:-6px">Escribe o pega cualquier código (de barras, interno o de lote) y obtén su QR.</p>
      <div class="row" style="align-items:flex-start;gap:18px"><div style="flex:1;min-width:220px"><input id="qrCodigo" placeholder="Ej. 7701234567890 o VT000012|LOTE1" maxlength="200" autocomplete="off">
        <div class="row" style="margin-top:10px"><button class="btn" id="qrGenPng" disabled>${ic('download')} Descargar PNG</button><button class="btn" id="qrGenImp" disabled>${ic('printer')} Imprimir</button></div></div>
        <div class="qrbig" id="qrGenVista" style="width:150px;height:150px"><div class="noqr"><span>Vista previa</span></div></div></div></div>`.s;

  // búsqueda y pestañas
  let t; $('#qrBusca').oninput = e => { clearTimeout(t); t = setTimeout(() => { el.dataset.qrq = e.target.value; V.qr(el).then(() => { const i = $('#qrBusca'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
  $$('[data-modo]', el).forEach(b => b.onclick = () => { el.dataset.qrmodo = b.dataset.modo; V.qr(el); });
  // marcar para imprimir
  $$('[data-sel]', el).forEach(c => c.onchange = () => { c.checked ? QR_SEL.add(c.dataset.sel) : QR_SEL.delete(c.dataset.sel); V.qr(el); });
  const elegidos = () => { const m = items.filter(i => i.p.codigo && QR_SEL.has(i.key)); return m.length ? m : items.filter(i => i.p.codigo); };
  $('#qrImprimir').onclick = () => {
    const e = elegidos();
    if (modo === 'med') etiquetasProductos(e.map(i => i.p));
    else etiquetasLotes(e.map(i => ({ codigo: i.p.codigo, nombre: i.p.nombre, lote: i.l.lote, vence: i.l.vence })));
  };
  // códigos internos
  const asignar = guard(async id => { const r = await POST('/productos/codigo-interno', id ? { producto_id: id } : {}); toast(`Código interno asignado a ${r.asignados} medicamento(s)`); V.qr(el); });
  $$('[data-asig]', el).forEach(b => b.onclick = () => asignar(Number(b.dataset.asig)));
  if ($('#qrAsignarTodos')) $('#qrAsignarTodos').onclick = () => asignar(null);
  // ver en grande
  $$('[data-ver]', el).forEach(b => b.onclick = () => {
    const { p, l } = items.find(i => i.key === b.dataset.ver), texto = textoQR(p, l);
    modal(html`<div class="row sp"><h3>${ic('scan')} ${p.nombre}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
      <p class="mut" style="margin-top:-4px">${l ? `Lote ${l.lote} · vence ${l.vence}` : (p.presentacion || '')}</p>
      <div class="qrbig" style="width:min(300px,100%);height:auto;aspect-ratio:1;margin:0 auto">${qrSvg(texto)}</div>
      <p style="text-align:center;margin:10px 0 0"><code>${texto}</code></p>
      <div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="qrPng">${ic('download')} Descargar PNG</button><button class="btn primary" id="qrEtq">${ic('printer')} Imprimir etiqueta</button></div>`);
    $('#qrPng').onclick = () => descargarQR(texto, `qr-${p.nombre}${l ? '-' + l.lote : ''}`);
    $('#qrEtq').onclick = () => l ? etiquetasLotes([{ codigo: p.codigo, nombre: p.nombre, lote: l.lote, vence: l.vence }]) : etiquetasProductos([p]);
  });
  // generador libre
  $('#qrCodigo').oninput = e => {
    const v = e.target.value.trim(), box = $('#qrGenVista');
    $('#qrGenPng').disabled = $('#qrGenImp').disabled = !v;
    try { box.innerHTML = v ? qrSvg(v).s : '<div class="noqr"><span>Vista previa</span></div>'; } catch { box.innerHTML = '<div class="noqr"><span>Código demasiado largo</span></div>'; $('#qrGenPng').disabled = $('#qrGenImp').disabled = true; }
  };
  $('#qrGenPng').onclick = () => descargarQR($('#qrCodigo').value.trim(), 'qr-' + $('#qrCodigo').value.trim());
  $('#qrGenImp').onclick = () => { const v = $('#qrCodigo').value.trim(); etiquetasGenericas([{ qr: v, nombre: v, l1: '', l2: '' }], { titulo: 'Etiqueta QR' }); };
};
