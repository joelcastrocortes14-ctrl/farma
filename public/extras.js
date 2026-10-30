'use strict';
/* VitalTrack — módulos de interfaz: escáner, ficha de producto, pánico, recetas, proveedores, CRM, buscador, tema y asistente.
   Depende de las utilidades de app.js (html, $, GET/POST, modal, toast, V, S, …). */

/* ---------- imágenes: se reducen en el navegador antes de subirlas ---------- */
function reducirImagen(file, max = 1280, calidad = 0.82) {
  return new Promise((ok, fail) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No pude leer esa imagen')); };
    img.src = url;
  });
}

/* ---------- escáner de código de barras / QR (cámara del celular o foto) ---------- */
let escanerActivo = null;
async function detenerEscaner() {
  const e = escanerActivo; escanerActivo = null;
  if (!e) return;
  try { await e.stop(); } catch {}
  try { e.clear(); } catch {}
}
$('#modal').addEventListener('close', detenerEscaner);

function abrirEscaner({ titulo = 'Escanear', alLeer }) {
  // La cámara en vivo exige HTTPS o localhost; si no, se usa la foto del código
  const camara = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.Html5Qrcode;
  modal(html`<div class="row sp"><h3>${ic('scan')} ${titulo}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    ${camara ? html`<div id="qr-reader"></div><p class="mut">Apunta al código de barras o al QR del empaque.</p>`
      : html`<div class="alertbox"><b>Cámara en vivo no disponible</b><p class="mut" style="margin:4px 0 0">El navegador solo la permite con HTTPS o en localhost. Toma una foto del código y el sistema lo lee.</p></div>`}
    <label style="margin-top:10px">Foto del código<input type="file" id="qrFile" accept="image/*" capture="environment"></label>
    <form id="qrManual" class="row"><input id="qrTxt" class="grow" placeholder="…o escribe el código / usa el lector USB aquí" autocomplete="off"><button class="btn primary">Buscar</button></form>
    <div id="qrErr" class="error"></div><div id="qr-tmp" style="display:none"></div>`);
  let hasta = 0;
  const lee = texto => { if (Date.now() < hasta || !texto) return; hasta = Date.now() + 2500; alLeer(String(texto).trim()); };
  if (camara) {
    escanerActivo = new Html5Qrcode('qr-reader', { verbose: false });
    escanerActivo.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 160 } }, lee, () => {})
      .catch(e => { escanerActivo = null; const r = $('#qr-reader'); if (r) r.outerHTML = html`<div class="alertbox rojo">No pude abrir la cámara: ${e.message || e}. Revisa el permiso del navegador o usa la foto.</div>`.s; });
  }
  $('#qrFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $('#qrErr').textContent = '';
    try { const t = new Html5Qrcode('qr-tmp'); const txt = await t.scanFile(file, false); try { t.clear(); } catch {} hasta = 0; lee(txt); }
    catch { $('#qrErr').textContent = 'No pude leer el código en la foto. Acércate y que se vea nítido.'; }
  };
  $('#qrManual').onsubmit = e => { e.preventDefault(); hasta = 0; lee($('#qrTxt').value); };
  setTimeout(() => $('#qrTxt')?.focus(), 50);
}

/* ---------- ficha de producto: precio, lote, vencimiento, proveedor ---------- */
async function fichaProducto(i, op = {}) {
  await detenerEscaner();
  const lotesTabla = i.lotes.map(l => html`<tr><td>${l.lote} ${l.lote === i.lote_fefo ? html`<span class="badge blu">Sale primero</span>` : ''}${l.lote === i.lote_consultado ? html`<span class="badge">Escaneado</span>` : ''}</td>
    <td>${l.vence}</td><td>${l.bloqueado ? html`<span class="badge red">VENCIDO · bloqueado</span>` : html`<span class="badge ${l.estado === 'critico' ? 'red' : l.estado === 'atencion' ? 'amb' : 'grn'}">${l.dias} d</span>`}</td>
    <td class="r">${stockTxt(l.cantidad, i.factor)}</td><td class="mut">${l.proveedor || ''}</td></tr>`);
  const fefo = i.lotes.find(l => l.lote === i.lote_fefo);
  modal(html`<div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">${fotoHtml({ id: i.id, tiene_foto: i.foto }, true)}
    <div class="grow"><div class="row" style="gap:10px">${semDot(i.semaforo)}<h3 style="margin:0">${i.nombre}</h3></div>
      <div class="mut">${i.presentacion || ''}${i.laboratorio ? ' · ' + i.laboratorio : ''}</div>
      <div class="row" style="margin-top:6px;gap:6px">${i.requiere_formula ? html`<span class="badge pur">Fórmula</span>` : ''}${i.control_especial ? html`<span class="badge red">Control especial</span>` : ''}${i.invima ? html`<span class="badge">${i.invima}</span>` : ''}</div>
      ${i.semaforo !== 'verde' ? html`<div class="mut" style="margin-top:6px">${i.semaforo_motivo}</div>` : ''}</div>
    <button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    ${i.avisos.map(a => html`<div class="alertbox ${a.nivel === 'rojo' ? 'rojo' : ''}">${ic('alert')} ${a.texto}</div>`)}
    <div class="grid kpis" style="margin:14px 0">
      <div class="card kpi"><div class="l">Precio</div><div class="n">${cop(i.precio_empaque)}</div><div class="l">${i.factor > 1 ? cop(i.precio_unidad) + ' c/u' : 'por unidad'}</div></div>
      <div class="card kpi"><div class="l">Lote que sale primero</div><div class="n" style="font-size:21px">${i.lote_fefo || '—'}</div><div class="l">${fefo ? 'vence ' + fefo.vence : 'sin lotes vendibles'}</div></div>
      <div class="card kpi"><div class="l">Existencia vendible</div><div class="n" style="font-size:21px">${stockTxt(i.vendible, i.factor)}</div></div>
      <div class="card kpi"><div class="l">Proveedor</div><div class="n" style="font-size:18px">${i.proveedor || '—'}</div><div class="l">${i.dias_entrega != null ? 'entrega en ' + i.dias_entrega + ' d' : ''}</div></div></div>
    <div class="tw"><table><thead><tr><th>Lote</th><th>Vence</th><th>Estado</th><th class="r">Cantidad</th><th>Comprado a</th></tr></thead><tbody>${lotesTabla}${i.lotes.length ? '' : html`<tr><td colspan="5" class="mut">Sin lotes con existencia</td></tr>`}</tbody></table></div>
    <div class="row" style="margin-top:16px">${op.agregar ? html`<button class="btn ok" id="fpAgregar">${ic('cart')} Agregar a la venta</button>` : ''}
      ${op.kardex ? html`<button class="btn" id="fpKardex">Kardex</button>` : ''}<button class="btn" onclick="cerrar()">Cerrar</button></div>`);
  if (op.agregar) $('#fpAgregar').onclick = op.agregar;
  if (op.kardex) $('#fpKardex').onclick = guard(async () => verKardex(i));
}
async function verKardex(i) {
  const k = await GET('/kardex/' + i.id);
  modal(html`<h3>Kardex · ${i.nombre}</h3><div class="tw"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Lote</th><th class="r">Cantidad</th><th>Detalle</th></tr></thead><tbody>
    ${k.map(m => html`<tr><td>${m.fecha.replace('T', ' ')}</td><td>${m.tipo}</td><td>${m.lote || ''}</td><td class="r">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td class="mut">${m.motivo || m.usuario || ''}</td></tr>`)}</tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn" onclick="cerrar()">Cerrar</button></div>`);
}

/* ---------- botón de pánico ---------- */
async function panico() {
  const l = await GET('/vencimientos?dias=7');
  const riesgo = l.reduce((s, x) => s + x.cantidad * x.costo_unidad, 0);
  modal(html`<div class="row sp"><h3>${ic('alert')} ¿Qué vence esta semana?</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    ${l.length ? html`<p>Hay <b>${l.length}</b> lote(s) vencidos o que vencen en 7 días. Dinero en juego: <b>${cop(riesgo)}</b>.</p>
      <div class="tw"><table><tbody>${l.map(x => html`<tr><td>${semDot(semLote(x.estado))}</td><td><b>${x.nombre}</b><div class="mut">Lote ${x.lote} · ${stockTxt(x.cantidad, x.factor)}</div></td>
        <td>${x.dias < 0 ? html`<span class="badge red">Vencido hace ${-x.dias} d</span>` : x.dias === 0 ? html`<span class="badge red">Vence HOY</span>` : html`<span class="badge amb">Vence en ${x.dias} d</span>`}<div class="mut">${x.vence}</div></td>
        <td>${x.accion || 'Vender primero'}</td></tr>`)}</tbody></table></div>`
      : html`<div class="alertbox ok" style="font-size:17px">${ic('check')} Nada vence esta semana. Todo en orden.</div>`}
    <div class="row noprint" style="margin-top:14px">${l.length ? html`<button class="btn" onclick="window.print()">${ic('printer')} Imprimir lista</button>` : ''}<button class="btn primary" id="pnTodo">Ver todos los vencimientos</button></div>`);
  $('#pnTodo').onclick = () => { cerrar(); go('vencimientos'); };
}

/* ---------- recetas: fórmula médica con foto; solo se despacha lo recetado ---------- */
function formReceta({ items = [], alGuardar }) {
  let lineas = items.map(i => ({ p: i.p, cantidad: i.cantidad, modo: i.modo })), imagen = null;
  const pintarLineas = () => {
    $('#rcItems').innerHTML = lineas.length ? html`<table><thead><tr><th>Medicamento recetado</th><th style="width:80px">Cant.</th><th style="width:110px"></th><th></th></tr></thead><tbody>${lineas.map((l, i) => html`<tr><td>${l.p.nombre}${l.p.control_especial ? html` <span class="badge red">Control</span>` : ''}</td>
      <td><input type="number" min="1" value="${l.cantidad}" data-i="${i}" data-f="cantidad"></td>
      <td>${l.p.factor > 1 ? html`<select data-i="${i}" data-f="modo"><option value="unidad" ${l.modo === 'unidad' ? 'selected' : ''}>unidades</option><option value="empaque" ${l.modo === 'empaque' ? 'selected' : ''}>empaques</option></select>` : 'unidades'}</td>
      <td><button type="button" class="btn ghost sm" data-del="${i}">${ic('x')}</button></td></tr>`)}</tbody></table>`.s : '<p class="mut">Agrega los medicamentos que el médico recetó.</p>';
    $$('#rcItems [data-f]').forEach(x => x.onchange = () => { lineas[x.dataset.i][x.dataset.f] = x.dataset.f === 'modo' ? x.value : Math.max(1, num(x.value)); });
    $$('#rcItems [data-del]').forEach(b => b.onclick = () => { lineas.splice(b.dataset.del, 1); pintarLineas(); });
  };
  modal(html`<div class="row sp"><h3>${ic('file')} Registrar receta</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    <form id="fRc"><div class="f2"><label>Paciente *<input name="paciente" required></label><label>Documento del paciente<input name="documento_paciente"></label>
    <label>Médico *<input name="medico" required></label><label>Registro médico *<input name="registro_medico" required></label>
    <label>N.º de fórmula<input name="numero"></label><label>Fecha de la fórmula<input name="fecha_formula" type="date" value="${hoy()}" max="${hoy()}"></label>
    <label>Institución<input name="institucion"></label>
    <label>Foto de la fórmula<input type="file" id="rcFoto" accept="image/*" capture="environment"></label></div>
    <div id="rcPrev"></div>
    <h4>Medicamentos recetados</h4><div id="rcItems"></div>
    <label style="margin-top:10px">Agregar medicamento<input id="rcBusca" placeholder="Escribe el nombre…" autocomplete="off"></label><div id="rcRes" class="res" style="max-height:200px"></div>
    <div class="row" style="margin-top:12px"><button class="btn primary">Guardar receta</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
  pintarLineas();
  let t; $('#rcBusca').oninput = e => { clearTimeout(t); t = setTimeout(guard(async () => {
    const r = e.target.value.trim() ? await GET('/pos/buscar?q=' + encodeURIComponent(e.target.value)) : [];
    $('#rcRes').innerHTML = html`${r.map((p, i) => html`<div class="it" data-i="${i}">${fotoHtml(p)}<div class="grow"><b>${p.nombre}</b> <span class="mut">${p.presentacion || ''}</span>${p.requiere_formula ? html` <span class="badge pur">Fórmula</span>` : ''}</div></div>`)}`.s;
    $$('#rcRes .it').forEach(n => n.onclick = () => { const p = r[n.dataset.i]; if (!lineas.some(l => l.p.id === p.id)) lineas.push({ p, cantidad: 1, modo: p.factor > 1 ? 'unidad' : 'empaque' }); $('#rcBusca').value = ''; $('#rcRes').innerHTML = ''; pintarLineas(); });
  }), 180); };
  $('#rcFoto').onchange = guard(async e => {
    const f = e.target.files[0]; if (!f) return;
    imagen = await reducirImagen(f, 1400);
    $('#rcPrev').innerHTML = html`<img src="${imagen}" alt="Fórmula" style="max-height:170px;border-radius:14px;border:1px solid var(--line);margin:4px 0">`.s;
  });
  $('#fRc').onsubmit = guard(async e => {
    e.preventDefault();
    if (!lineas.length) return toast('Agrega al menos un medicamento recetado', true);
    const r = await POST('/recetas', { ...formData(e.target), imagen, items: lineas.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad, modo: l.modo })) });
    toast('Receta registrada'); alGuardar(r);
  });
}

function elegirReceta({ items = [], alElegir }) {
  modal(html`<div class="row sp"><h3>${ic('file')} Receta del paciente</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
    <div class="row"><input id="rcQ" class="grow" placeholder="Buscar por paciente, documento o n.º de fórmula" autocomplete="off"><button class="btn primary" id="rcNueva">${ic('plus')} Registrar nueva</button></div><div id="rcLista" style="margin-top:12px"></div>`);
  const cargar = guard(async () => {
    const rs = await GET('/recetas?q=' + encodeURIComponent($('#rcQ').value));
    $('#rcLista').innerHTML = rs.length ? html`${rs.map((r, i) => html`<div class="alertbox ok"><div class="row sp"><span><b>${r.paciente}</b> <span class="mut">${r.documento_paciente || ''}</span><br><span class="mut">Dr(a). ${r.medico} · ${r.numero ? 'N.º ' + r.numero + ' · ' : ''}vigente hasta ${r.vence}</span></span>
      <span class="row">${r.tiene_imagen ? html`<a class="btn sm" target="_blank" rel="noopener" href="/api/recetas/${r.id}/imagen">${ic('image')} Ver foto</a>` : ''}<button class="btn primary sm" data-i="${i}">Usar esta</button></span></div>
      <div class="mut" style="margin-top:6px">${r.items.map(x => `${x.nombre}: saldo ${x.saldo} de ${x.cantidad} u`).join(' · ')}</div></div>`)}`.s
      : '<p class="mut">No hay recetas vigentes con saldo. Registra una nueva.</p>';
    $$('#rcLista [data-i]').forEach(b => b.onclick = () => { cerrar(); alElegir(rs[b.dataset.i]); });
  });
  let t; $('#rcQ').oninput = () => { clearTimeout(t); t = setTimeout(cargar, 200); };
  $('#rcNueva').onclick = () => formReceta({ items, alGuardar: r => { cerrar(); alElegir(r); } });
  cargar();
}

V.recetas = async el => {
  const q = el.dataset.q || '';
  const rs = await GET('/recetas?todas=1&q=' + encodeURIComponent(q));
  el.innerHTML = html`<div class="row sp" style="margin-bottom:14px"><input id="rq" class="grow" style="max-width:420px" placeholder="Buscar por paciente, documento, médico o n.º" value="${q}"><button class="btn primary" id="rNueva">${ic('plus')} Nueva receta</button></div>
    <div class="card tw"><table><thead><tr><th>Fecha</th><th>Paciente</th><th>Médico</th><th>Medicamentos (saldo por despachar)</th><th>Estado</th><th></th></tr></thead><tbody>
    ${rs.map(r => html`<tr><td>${r.fecha_formula}<div class="mut">${r.numero ? 'N.º ' + r.numero : ''}</div></td><td><b>${r.paciente}</b><div class="mut">${r.documento_paciente || ''}</div></td><td>${r.medico}<div class="mut">RM ${r.registro_medico}</div></td>
      <td>${r.items.map(i => html`<div>${i.nombre}${i.control_especial ? html` <span class="badge red">Control</span>` : ''} <span class="mut">— saldo ${i.saldo} de ${i.cantidad} u</span></div>`)}</td>
      <td>${r.completa ? html`<span class="badge grn">Despachada</span>` : r.vigente ? html`<span class="badge blu">Vigente hasta ${r.vence}</span>` : html`<span class="badge red">Vencida</span>`}</td>
      <td>${r.tiene_imagen ? html`<a class="btn sm" target="_blank" rel="noopener" href="/api/recetas/${r.id}/imagen">${ic('image')} Foto</a>` : ''}</td></tr>`)}
    ${rs.length ? '' : html`<tr><td colspan="6" class="mut">Aún no hay recetas registradas.</td></tr>`}</tbody></table></div>`.s;
  let t; $('#rq').oninput = e => { clearTimeout(t); t = setTimeout(() => { el.dataset.q = e.target.value; V.recetas(el); }, 300); };
  $('#rNueva').onclick = () => formReceta({ alGuardar: () => { cerrar(); V.recetas(el); } });
};

/* ---------- proveedores: quién te vendió, a cuánto y en cuánto tiempo llega ---------- */
V.proveedores = async el => {
  const provs = await GET('/proveedores');
  el.innerHTML = html`<div class="row sp" style="margin-bottom:14px"><span class="mut">${provs.length} proveedor(es)</span><button class="btn primary" id="pNuevo">${ic('plus')} Nuevo proveedor</button></div>
    <div class="grid two">${provs.map(p => html`<div class="card"><div class="row sp"><h3 style="margin:0">${p.nombre}</h3><span class="badge blu">${ic('truck')} entrega en ${p.dias_entrega} d</span></div>
      <p class="mut" style="margin:6px 0 14px">${p.contacto || 'Sin contacto'} · ${p.telefono || 'sin teléfono'}<br>Aceptan canje hasta ${p.dias_devolucion} días antes de vencer</p>
      <div class="row"><button class="btn primary sm" data-det="${p.id}">Compras y precios</button><button class="btn sm" data-edit="${p.id}">${ic('edit')} Editar</button>
      ${p.telefono ? html`<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${p.telefono.replace(/\D/g, '')}">${ic('chat')} WhatsApp</a>` : ''}</div></div>`)}</div>`.s;
  const form = p => {
    modal(html`<h3>${p ? 'Editar' : 'Nuevo'} proveedor</h3><form id="fProv"><label>Nombre *<input name="nombre" value="${p?.nombre || ''}" required></label>
      <div class="f2"><label>Teléfono WhatsApp (573001234567)<input name="telefono" value="${p?.telefono || ''}"></label><label>Contacto<input name="contacto" value="${p?.contacto || ''}"></label>
      <label>Días que tarda en llegar el pedido<input name="dias_entrega" type="number" min="0" value="${p?.dias_entrega ?? 1}"></label><label>Días antes de vencer en que aceptan canje<input name="dias_devolucion" type="number" value="${p?.dias_devolucion ?? 60}"></label></div>
      <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fProv').onsubmit = guard(async e => { e.preventDefault(); p ? await PUT('/proveedores/' + p.id, formData(e.target)) : await POST('/proveedores', formData(e.target)); cerrar(); V.proveedores(el); });
  };
  $('#pNuevo').onclick = () => form(null);
  $$('[data-edit]').forEach(b => b.onclick = () => form(provs.find(p => p.id == b.dataset.edit)));
  $$('[data-det]').forEach(b => b.onclick = guard(async () => {
    const d = await GET(`/proveedores/${b.dataset.det}/detalle`);
    modal(html`<div class="row sp"><h3>${d.proveedor.nombre}</h3><button class="btn ghost sm" onclick="cerrar()">${ic('x')}</button></div>
      <div class="grid kpis"><div class="card kpi"><div class="l">Compras</div><div class="n">${d.num_compras}</div></div><div class="card kpi"><div class="l">Total comprado</div><div class="n">${cop(d.total_comprado)}</div></div><div class="card kpi"><div class="l">Tiempo de entrega</div><div class="n">${d.proveedor.dias_entrega} d</div></div></div>
      <h4>Qué te ha vendido y a cuánto (por empaque)</h4><div class="tw"><table><thead><tr><th>Producto</th><th class="r">Último costo</th><th class="r">Cambio</th><th>Comparación</th><th>Fecha</th></tr></thead><tbody>
      ${d.productos.map(p => html`<tr><td>${p.nombre}</td><td class="r"><b>${cop(p.ultimo_costo)}</b></td><td class="r">${p.variacion_pct == null ? '—' : html`<span class="badge ${p.variacion_pct > 0 ? 'red' : 'grn'}">${p.variacion_pct > 0 ? '+' : ''}${p.variacion_pct}%</span>`}</td>
        <td>${p.mejor_otro ? html`<span class="badge amb">${p.mejor_otro.proveedor} lo vendió a ${cop(p.mejor_otro.costo)}</span>` : html`<span class="mut">Mejor precio</span>`}</td><td class="mut">${p.fecha}</td></tr>`)}
      ${d.productos.length ? '' : html`<tr><td colspan="5" class="mut">Aún no le has comprado.</td></tr>`}</tbody></table></div>
      <h4>Últimas compras</h4><div class="tw"><table><tbody>${d.compras.map(c => html`<tr><td>${c.fecha.replace('T', ' ')}</td><td>${c.factura || ''}</td><td class="r">${cop(c.total)}</td></tr>`)}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn" onclick="cerrar()">Cerrar</button></div>`);
  }));
};

/* ---------- CRM ligero: historial del cliente ---------- */
async function historialCliente(id, alCerrar) {
  const h = await GET(`/clientes/${id}/historial`), c = h.cliente;
  modal(html`<div class="row sp"><div><h3 style="margin:0">${c.nombre}</h3><div class="mut">${c.documento || ''} ${c.telefono ? '· ' + c.telefono : ''}</div></div>
    <span class="row">${c.telefono ? html`<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${c.telefono.replace(/\D/g, '')}">${ic('chat')} WhatsApp</a>` : ''}<button class="btn ghost sm" id="hcX">${ic('x')}</button></span></div>
    <div class="grid kpis" style="margin:14px 0"><div class="card kpi"><div class="l">Compras</div><div class="n">${h.compras}</div></div><div class="card kpi"><div class="l">Ha gastado</div><div class="n">${cop(h.gastado)}</div></div>
      <div class="card kpi"><div class="l">Última compra</div><div class="n" style="font-size:19px">${h.ultima_compra || '—'}</div></div><div class="card kpi"><div class="l">Debe</div><div class="n" style="color:${c.saldo > 0 ? 'var(--amb-d)' : 'inherit'}">${cop(c.saldo)}</div></div></div>
    <h4>Lo que compra seguido</h4><div class="tw"><table><tbody>${h.frecuentes.map(f => html`<tr><td><b>${f.nombre}</b></td><td>${f.veces} compra(s)</td><td class="mut">${f.cada_dias ? 'cada ~' + f.cada_dias + ' días' : ''}</td><td class="mut">última: ${f.ultima}</td></tr>`)}
      ${h.frecuentes.length ? '' : html`<tr><td class="mut">Aún no hay compras asociadas a este cliente. Elígelo en el campo "Cliente" al vender.</td></tr>`}</tbody></table></div>
    <h4>Avisarle cuando llegue un producto</h4>
    <input id="avQ" placeholder="Buscar producto…" autocomplete="off"><div id="avRes" class="res" style="max-height:170px"></div>
    <div style="margin-top:8px">${h.avisos.map(a => html`<span class="badge ${a.avisado ? 'grn' : 'amb'}" style="margin:2px">${a.nombre} · ${a.avisado ? 'avisado' : 'pendiente'}</span>`)}</div>
    <div class="row" style="margin-top:14px"><button class="btn" id="hcCerrar">Cerrar</button></div>`);
  const fin = () => { cerrar(); alCerrar && alCerrar(); };
  $('#hcX').onclick = fin; $('#hcCerrar').onclick = fin;
  let t; $('#avQ').oninput = e => { clearTimeout(t); t = setTimeout(guard(async () => {
    const r = e.target.value.trim() ? await GET('/productos?limit=6&q=' + encodeURIComponent(e.target.value)) : [];
    $('#avRes').innerHTML = html`${r.map((p, i) => html`<div class="it" data-i="${i}">${fotoHtml(p)}<div class="grow"><b>${p.nombre}</b><div class="mut">${p.stock > 0 ? 'Hay stock' : 'Sin stock'}</div></div><button class="btn sm">Avisar</button></div>`)}`.s;
    $$('#avRes .it').forEach(n => n.onclick = guard(async () => { await POST(`/clientes/${id}/avisos`, { producto_id: r[n.dataset.i].id }); toast('Listo: se le avisará por WhatsApp cuando llegue'); historialCliente(id, alCerrar); }));
  }), 180); };
}

/* ---------- asistente (chat) ---------- */
function initBot() {
  const panel = $('#botPanel');
  panel.innerHTML = html`<div class="hd">${ic('bot')} Asistente VitalTrack<button id="botX" aria-label="Cerrar">${ic('x')}</button></div><div class="msgs" id="botMsgs"></div>
    <form id="botForm"><input id="botIn" placeholder="Pregunta algo… ej. ¿qué antibióticos tengo en stock bajo?" autocomplete="off"><button class="btn primary icon" aria-label="Enviar">${ic('send')}</button></form>`.s;
  const msgs = $('#botMsgs');
  const TONO = { rojo: 'red', ambar: 'amb', verde: 'grn', azul: 'blu' };
  const burbuja = (cuerpo, yo) => { const d = document.createElement('div'); d.className = 'm' + (yo ? ' yo' : ''); d.innerHTML = cuerpo.s; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const responder = r => {
    const d = burbuja(html`<div>${r.respuesta}</div>${(r.items || []).map(i => html`<div class="li"><div>${i.titulo}<small>${i.detalle}</small></div><span class="badge ${TONO[i.tono] || ''}">${i.etiqueta}</span></div>`)}
      ${r.ejemplos ? html`<div class="chips">${r.ejemplos.map(e => html`<button type="button" class="chip">${e}</button>`)}</div>` : ''}`);
    $$('.chip', d).forEach(c => c.onclick = () => preguntar(c.textContent));
  };
  const preguntar = guard(async texto => {
    if (!texto.trim()) return;
    burbuja(html`${texto}`, true);
    const pensando = burbuja(html`<span class="mut">Pensando…</span>`);
    try { const r = await POST('/asistente', { pregunta: texto }); pensando.remove(); responder(r); } catch (e) { pensando.remove(); throw e; }
  });
  $('#botForm').onsubmit = e => { e.preventDefault(); const i = $('#botIn'); const t = i.value; i.value = ''; preguntar(t); };
  $('#botX').onclick = () => panel.classList.add('hidden');
  $('#botBtn').onclick = guard(async () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) { $('#botIn').focus(); if (!msgs.children.length) responder(await POST('/asistente', { pregunta: 'hola' })); }
  });
}

/* ---------- buscador global, tema y botones de cabecera ---------- */
function initExtras() {
  if (initExtras.hecho) return; initExtras.hecho = true;
  const inp = $('#gsearch'), res = $('#gres'); let t;
  const staff = () => S.user.rol !== 'cajero';
  inp.oninput = () => { clearTimeout(t); t = setTimeout(guard(async () => {
    const q = inp.value.trim();
    if (q.length < 2) return res.classList.add('hidden');
    const r = await GET('/productos?limit=8&q=' + encodeURIComponent(q));
    res.classList.remove('hidden');
    res.innerHTML = html`${r.map((p, i) => html`<div class="it" data-i="${i}">${fotoHtml(p)}${semDot(p.semaforo)}<div class="grow"><b>${p.nombre}</b><div class="mut">${p.presentacion || ''} · ${p.stock > 0 ? stockTxt(p.stock, p.factor) : 'sin stock'}</div></div><b>${cop(p.precio_venta)}</b></div>`)}${r.length ? '' : html`<div class="mut" style="padding:12px">Sin resultados para "${q}"</div>`}`.s;
    $$('.it', res).forEach(n => n.onclick = guard(async () => { res.classList.add('hidden'); inp.value = ''; fichaProducto(await GET('/escaneo?id=' + r[n.dataset.i].id), { kardex: staff() }); }));
  }), 180); };
  document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) res.classList.add('hidden'); });
  inp.onkeydown = e => { if (e.key === 'Escape') { res.classList.add('hidden'); inp.blur(); } };

  $('#btnScan').onclick = () => abrirEscaner({ titulo: 'Consultar producto', alLeer: guard(async texto => fichaProducto(await GET('/escaneo?c=' + encodeURIComponent(texto)), { kardex: staff() })) });

  const tema = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const pintarTema = () => { $('#btnTema use').setAttribute('href', tema() === 'dark' ? '#i-sun' : '#i-moon'); };
  $('#btnTema').onclick = () => {
    const n = tema() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = n;
    try { localStorage.setItem('vt-tema', n); } catch {}
    pintarTema();
  };
  pintarTema();
  initBot();
}
