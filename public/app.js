'use strict';
/* ---------- utilidades ---------- */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : (v === null || v === undefined || v === false) ? '' : esc(v);
const html = (strs, ...vs) => new Safe(strs.reduce((o, s, i) => o + s + (i < vs.length ? val(vs[i]) : ''), ''));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const cop = n => '$' + Math.round(n || 0).toLocaleString('es-CO');
const hoy = () => new Date().toLocaleDateString('en-CA');
const num = v => Number(v) || 0;
const ic = n => new Safe(`<svg class="ic"><use href="#i-${n}"/></svg>`);
const fotoHtml = (p, grande) => p.tiene_foto || p.foto ? html`<img class="thumb ${grande ? 'lg' : ''}" src="/api/productos/${p.id ?? p.producto_id}/foto" alt="" loading="lazy">` : html`<div class="thumb ph ${grande ? 'lg' : ''}">${ic('pill')}</div>`;
const semDot = c => html`<span class="sem ${c}" title="${c}"></span>`;
const semLote = e => e === 'vencido' || e === 'critico' ? 'rojo' : e === 'atencion' ? 'amarillo' : 'verde';
const ticketNo = id => 'VT-' + String(id).padStart(6, '0');

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3500);
}
async function api(method, url, body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (r.status === 401 && url !== '/login') { showLogin(); throw new Error('Sesión expirada'); }
  if (!r.ok) throw new Error(j?.error || 'Error ' + r.status);
  return j;
}
const GET = u => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b);
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

function modal(content) { $('#modalBody').innerHTML = content.s; const d = $('#modal'); if (!d.open) d.showModal(); return $('#modalBody'); }
const cerrar = () => $('#modal').close();
const formData = f => Object.fromEntries(new FormData(f).entries());

const stockTxt = (u, factor) => factor > 1 ? `${Math.floor(u / factor)} emp + ${u % factor} u` : `${u} u`;
const diasBadge = l => l.estado === 'vencido' ? html`<span class="badge red">Vencido hace ${-l.dias} d</span>`
  : html`<span class="badge ${l.estado === 'critico' ? 'red' : l.estado === 'atencion' ? 'amb' : 'grn'}">${l.dias} d</span>`;
const nivelBadge = n => html`<span class="badge ${n === 'agotado' ? 'red' : n === 'critico' ? 'amb' : 'grn'}">${n}</span>`;

/* ---------- estado y navegación ---------- */
const S = { user: null, cart: [], clienteId: '', receta: null };
const TODOS = ['admin', 'regente', 'cajero'], STAFF = ['admin', 'regente'];
const VISTAS = [
  ['inicio', 'home', 'Inicio', TODOS],
  ['pos', 'cart', 'Vender', TODOS],
  ['recetas', 'file', 'Recetas', TODOS],
  ['vencimientos', 'calendar', 'Vencimientos', TODOS],
  ['stock', 'trend', 'Pedidos y alertas', TODOS],
  ['inventario', 'package', 'Inventario', TODOS],
  ['qr', 'scan', 'Códigos QR', STAFF],
  ['compras', 'inbox', 'Compras', STAFF],
  ['proveedores', 'truck', 'Proveedores', STAFF],
  ['clientes', 'users', 'Clientes', TODOS],
  ['caja', 'cash', 'Caja', TODOS],
  ['reportes', 'chart', 'Reportes', STAFF],
  ['ayuda', 'help', 'Ayuda', TODOS],
  ['config', 'sliders', 'Configuración', ['admin']],
];
const V = {};

function showLogin() { S.user = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
async function entrar(user) {
  S.user = user; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#quien').textContent = `${user.nombre} · ${user.rol}`;
  const nav = $('#nav');
  nav.innerHTML = html`<div class="brand"><img src="logo-mark.svg" alt=""><div><b>Vital<i>Track</i></b><small>${user.negocio || ''}</small></div></div>${VISTAS.filter(v => v[3].includes(user.rol)).map(v => html`<a data-v="${v[0]}">${ic(v[1])} ${v[2]} ${v[0] === 'stock' ? html`<span class="badge amb hidden" id="navStock"></span>` : ''}</a>`)}
    <a data-v="__clave" style="margin-top:20px">${ic('user')} Mi contraseña</a><a data-v="__salir">${ic('logout')} Salir</a>`.s;
  go((location.hash || '#inicio').slice(1));
  refrescarBadge();
  if (window.initExtras) initExtras();
  const aviso = $('#avisoClave'); aviso.classList.toggle('hidden', !user.clave_demo); aviso.onclick = () => cambiarClave();
}
async function refrescarBadge() {
  try { const n = (await GET('/stock-critico')).length; const b = $('#navStock'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } } catch {}
}
async function go(v) {
  if (!VISTAS.some(x => x[0] === v && x[3].includes(S.user.rol))) v = 'inicio';
  location.hash = v; $('#nav').classList.remove('open');
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  $('#titulo').textContent = VISTAS.find(x => x[0] === v)[2];
  const main = $('#main'); main.innerHTML = '<p class="mut">Cargando…</p>';
  try { await V[v](main); } catch (e) { main.innerHTML = ''; toast(e.message, true); }
}
document.addEventListener('click', e => {
  const a = e.target.closest('#nav a'); if (!a) return;
  if (a.dataset.v === '__salir') POST('/logout').then(showLogin); else if (a.dataset.v === '__clave') cambiarClave(); else go(a.dataset.v);
});
$('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await POST('/login', formData(e.target)); entrar(await GET('/me')); e.target.reset(); } catch (er) { $('#loginErr').textContent = er.message; }
};
window.addEventListener('load', async () => { try { entrar(await GET('/me')); } catch { showLogin(); } });

function cambiarClave() {
  modal(html`<h3>${ic('user')} Cambiar mi contraseña</h3>
    <p class="mut" style="margin-top:-4px">Usa una contraseña que solo tú conozcas. Evita nombres, fechas o "123".</p>
    <form id="fClave"><label>Contraseña actual<input name="actual" type="password" autocomplete="current-password" required></label>
    <label>Nueva contraseña (mínimo 8 caracteres)<input name="nueva" type="password" autocomplete="new-password" minlength="8" required></label>
    <label>Repite la nueva contraseña<input name="repite" type="password" autocomplete="new-password" required></label>
    <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
  $('#fClave').onsubmit = guard(async e => {
    e.preventDefault(); const d = formData(e.target);
    if (d.nueva !== d.repite) return toast('Las contraseñas nuevas no coinciden', true);
    await POST('/clave', { actual: d.actual, nueva: d.nueva });
    cerrar(); $('#avisoClave').classList.add('hidden'); toast('Contraseña cambiada');
  });
}

/* ---------- Inicio ---------- */
V.inicio = async el => {
  const d = await GET('/dashboard');
  const max = Math.max(1, ...(d.ventas_7d || []).map(x => x.total));
  const hayRojo = d.lotes_vencidos > 0 || d.lotes_criticos > 0;
  el.innerHTML = html`
  <div class="grid cards4">
    <a class="card big" data-go="inventario"><div class="top"><span class="ico blue">${ic('package')}</span>Total de productos</div><div class="n">${d.total_productos}</div><div class="sub">en tu catálogo</div></a>
    <a class="card big alerta ${hayRojo ? 'rojo' : ''}" data-go="vencimientos"><div class="top"><span class="ico ${hayRojo ? 'red' : 'amb'}">${ic('alert')}</span>Por vencer</div><div class="n">${d.por_vencer}</div><div class="sub">${d.lotes_vencidos} vencidos · ${d.lotes_criticos} en 30 días · ${cop(d.valor_en_riesgo)} en riesgo</div></a>
    <a class="card big ${d.stock_bajo ? 'alerta' : ''}" data-go="stock"><div class="top"><span class="ico amb">${ic('trend')}</span>Stock bajo</div><div class="n">${d.stock_bajo}</div><div class="sub">${d.agotados} agotados · ${d.pedido_sugerido} por pedir</div></a>
    <a class="card big" data-go="reportes"><div class="top"><span class="ico green">${ic('cash')}</span>Ventas del día</div><div class="n">${cop(d.ventas_hoy)}</div><div class="sub">${d.num_ventas_hoy} ventas${d.utilidad_hoy != null ? ` · utilidad ${cop(d.utilidad_hoy)}` : ''}</div></a>
  </div>
  <button class="panic" id="panic">${ic('alert')} ¿Qué vence esta semana? <small>${d.vencen_semana ? d.vencen_semana + ' lote(s) requieren acción' : 'nada urgente'}</small></button>
  <div class="grid two">
    <div class="card"><h3>Vencimientos prioritarios</h3>
      <div class="tw"><table><tbody>${d.top_vencer.map(l => html`<tr><td>${semDot(semLote(l.estado))}</td><td><b>${l.nombre}</b><div class="mut">Lote ${l.lote} · ${l.cantidad} u</div></td><td>${diasBadge(l)}</td></tr>`)}
      ${d.top_vencer.length ? '' : html`<tr><td class="mut">${ic('check')} Todo en orden</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Qué pedir</h3>
      <div class="tw"><table><tbody>${d.top_stock.map(p => html`<tr><td><b>${p.nombre}</b><div class="mut">${p.sugerencia || p.motivo}</div></td><td>${urgBadge(p)}</td><td class="r"><b>${p.sugerido_empaques}</b> emp</td></tr>`)}
      ${d.top_stock.length ? '' : html`<tr><td class="mut">${ic('check')} Todo en orden</td></tr>`}</tbody></table></div></div>
    ${d.ventas_7d ? html`<div class="card"><h3>Ventas últimos 7 días</h3>
      ${d.ventas_7d.map(x => html`<div class="row" style="margin:8px 0"><span class="mut" style="width:56px">${x.dia.slice(5)}</span><div class="bar grow"><i style="width:${(x.total / max * 100).toFixed(0)}%"></i></div><b style="width:100px;text-align:right">${cop(x.total)}</b></div>`)}
      <p class="mut" style="margin-bottom:0">Cartera por cobrar: <b>${cop(d.cartera)}</b></p></div>` : ''}
  </div>`.s;
  $$('[data-go]').forEach(a => a.onclick = () => go(a.dataset.go));
  $('#panic').onclick = () => panico();
};
const urgBadge = p => p.nivel === 'agotado' ? html`<span class="badge red">Agotado</span>` : p.urgencia === 'hoy' ? html`<span class="badge red">Pide hoy</span>` : p.urgencia === 'manana' ? html`<span class="badge amb">Pide mañana</span>` : html`<span class="badge blu">Pronto</span>`;

/* ---------- Punto de venta ---------- */
const MEDIOS = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];
const unitPrice = l => l.modo === 'empaque' ? l.p.precio_empaque / l.p.factor : l.p.precio_unidad;
const unidades = l => l.cantidad * (l.modo === 'empaque' ? l.p.factor : 1);
const lineTotal = l => Math.round(unidades(l) * unitPrice(l) * (1 - l.pct / 100));

V.pos = async el => {
  const caja = await GET('/caja');
  if (!caja) {
    el.innerHTML = html`<div class="card" style="max-width:400px"><h3>Abrir caja</h3><p class="mut">Necesitas abrir caja para vender.</p>
      <form id="fAbrir"><label>Base en efectivo<input name="base" type="number" min="0" value="0"></label><button class="btn primary">Abrir caja</button></form></div>`.s;
    $('#fAbrir').onsubmit = guard(async e => { e.preventDefault(); await POST('/caja/abrir', { base: num(formData(e.target).base) }); toast('Caja abierta'); go('pos'); });
    return;
  }
  const clientes = await GET('/clientes');
  el.innerHTML = html`<div class="pos">
    <div class="card"><div class="row"><input id="q" class="grow" placeholder="Escribe &quot;acetam&quot; o escanea el código…" autocomplete="off" autofocus><button class="btn" id="cam" title="Escanear con la cámara del celular">${ic('camera')} Cámara</button></div><div id="res" class="res"></div></div>
    <div class="card"><h3>Venta</h3><div id="cart"></div>
      <div class="row" style="margin-top:12px"><label class="grow">Cliente<select id="cli"><option value="">Mostrador</option>${clientes.map(c => html`<option value="${c.id}" ${String(c.id) === String(S.clienteId) ? 'selected' : ''}>${c.nombre}${c.saldo ? ` (debe ${cop(c.saldo)})` : ''}</option>`)}</select></label>
      <label class="grow">Pago<select id="pago">${MEDIOS.map(m => html`<option>${m}</option>`)}</select></label></div>
      <div id="recetaBox"></div>
      <div class="row sp" style="margin-top:6px"><div><div class="mut" id="desc"></div><div class="tot" id="total">$0</div></div>
      <div class="row"><button class="btn" id="vaciar">Vaciar</button><button class="btn ok" id="cobrar">Cobrar (F9)</button></div></div>
    </div></div>`.s;

  const q = $('#q'); let timer;
  const buscar = async () => { const r = await GET('/pos/buscar?q=' + encodeURIComponent(q.value)); pintarRes(r); return r; };
  const pintarRes = r => {
    $('#res').innerHTML = html`${r.map((p, i) => html`<div class="it ${p.stock <= 0 ? 'sin' : ''}" data-i="${i}">
      ${fotoHtml(p)}${semDot(p.semaforo)}
      <div class="grow"><b>${p.nombre}</b> <span class="mut">${p.presentacion || ''}</span>
      <div>${p.requiere_formula ? html`<span class="badge pur">Fórmula</span> ` : ''}${p.control_especial ? html`<span class="badge red">Control especial</span> ` : ''}${p.promo_pct ? html`<span class="badge amb">Vence ${p.proximo_vence} · −${p.promo_pct}%</span> ` : ''}
      <span class="mut">${p.stock > 0 ? `Stock: ${stockTxt(p.stock, p.factor)} · sale primero lote ${p.proximo_lote} (vence ${p.proximo_vence})` : 'SIN existencias vendibles'}</span></div></div>
      <div style="text-align:right"><b>${cop(p.precio_empaque)}</b>${p.factor > 1 ? html`<div class="mut">${cop(p.precio_unidad)} c/u</div>` : ''}</div></div>`)}`.s;
    $$('#res .it').forEach(n => n.onclick = () => { agregar(r[n.dataset.i]); q.value = ''; $('#res').innerHTML = ''; q.focus(); });
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(guard(buscar), 180); };
  q.onkeydown = guard(async e => {
    if (e.key !== 'Enter' || !q.value.trim()) return;
    const r = await buscar();
    const exacto = r.find(p => p.codigo === q.value.trim());
    if (exacto || r.length === 1) { agregar(exacto || r[0]); q.value = ''; $('#res').innerHTML = ''; }
    else if (!r.length) toast('No se encontró el producto', true);
  });
  $('#cam').onclick = () => abrirEscaner({ titulo: 'Escanear producto', alLeer: guard(async texto => {
    const info = await GET('/escaneo?c=' + encodeURIComponent(texto));
    const [p] = await GET('/pos/buscar?q=' + encodeURIComponent(info.codigo));
    if (info.avisos.length) fichaProducto(info, { agregar: p && p.stock > 0 ? () => { agregar(p); cerrar(); } : null });
    else { cerrar(); if (p) agregar(p); }
  }) });

  function agregar(p) {
    if (p.stock <= 0) return toast(`BLOQUEADO: ${p.nombre} no tiene existencias vendibles (vencido o agotado)`, true);
    const ya = S.cart.find(l => l.p.id === p.id);
    if (ya) ya.cantidad++; else S.cart.push({ p, modo: p.factor > 1 ? 'unidad' : 'empaque', cantidad: 1, pct: p.promo_pct || 0 });
    toast(`${p.nombre} · lote ${p.proximo_lote} · vence ${p.proximo_vence}`);
    pintarCarrito();
  }
  // problemas de una línea con fórmula frente a la receta elegida
  const problemaRx = l => {
    if (!l.p.requiere_formula || !S.receta) return '';
    const it = S.receta.items.find(i => i.producto_id === l.p.id);
    if (!it) return 'No está en la receta';
    const total = S.cart.filter(x => x.p.id === l.p.id).reduce((s, x) => s + unidades(x), 0);
    return total > it.saldo ? `La receta solo permite ${it.saldo} u` : '';
  };
  function pintarCarrito() {
    const total = S.cart.reduce((s, l) => s + lineTotal(l), 0);
    const bruto = S.cart.reduce((s, l) => s + Math.round(unidades(l) * unitPrice(l)), 0);
    $('#cart').innerHTML = S.cart.length ? html`${S.cart.map((l, i) => html`<div class="linea">
      <div class="nom">${l.p.nombre}${l.p.requiere_formula ? html` <span class="badge pur">Rx</span>` : ''}${unidades(l) > l.p.stock ? html`<div class="error">Solo hay ${stockTxt(l.p.stock, l.p.factor)}</div>` : ''}${problemaRx(l) ? html`<div class="error">${problemaRx(l)}</div>` : ''}</div>
      <div class="ctl"><input class="q" type="number" min="1" value="${l.cantidad}" data-i="${i}" data-f="cantidad" aria-label="Cantidad">
        ${l.p.factor > 1 ? html`<select class="m" data-i="${i}" data-f="modo" aria-label="Unidad o empaque"><option value="unidad" ${l.modo === 'unidad' ? 'selected' : ''}>unidad</option><option value="empaque" ${l.modo === 'empaque' ? 'selected' : ''}>empaque</option></select>` : html`<span class="mut">unidad</span>`}
        <input class="d" type="number" min="0" max="100" value="${l.pct}" title="% de descuento" placeholder="%" data-i="${i}" data-f="pct" aria-label="Descuento en porcentaje">
        <b class="t">${cop(lineTotal(l))}</b><button class="btn ghost sm" data-del="${i}" aria-label="Quitar">${ic('x')}</button></div></div>`)}`.s : '<p class="mut">Agrega productos buscándolos o escaneándolos.</p>';
    $('#total').textContent = cop(total);
    $('#desc').textContent = bruto > total ? `Descuento: ${cop(bruto - total)}` : '';
    $$('#cart [data-f]').forEach(inp => inp.onchange = () => { const l = S.cart[inp.dataset.i]; l[inp.dataset.f] = inp.dataset.f === 'modo' ? inp.value : Math.max(0, num(inp.value)); if (l.cantidad < 1) l.cantidad = 1; setTimeout(pintarCarrito, 0); }); // diferido: redibujar dentro del evento 'change' provoca re-entrada
    $$('#cart [data-del]').forEach(b => b.onclick = () => { S.cart.splice(b.dataset.del, 1); pintarCarrito(); });
    pintarReceta();
  }
  function pintarReceta() {
    const rx = S.cart.filter(l => l.p.requiere_formula), box = $('#recetaBox');
    if (!rx.length) { S.receta = null; box.innerHTML = ''; return; }
    const r = S.receta;
    box.innerHTML = r ? html`<div class="alertbox ok"><div class="row sp"><b>${ic('file')} Receta de ${r.paciente}</b><button class="btn sm" id="selReceta">Cambiar</button></div>
      <div class="mut">Dr(a). ${r.medico} · RM ${r.registro_medico}${r.numero ? ' · N.º ' + r.numero : ''} · vigente hasta ${r.vence}</div>
      <table>${r.items.map(i => html`<tr><td>${i.nombre}</td><td class="r mut">recetado ${i.cantidad} u</td><td class="r"><b>saldo ${i.saldo} u</b></td></tr>`)}</table></div>`.s
      : html`<div class="alertbox"><b>${ic('file')} Medicamento con fórmula</b><p class="mut" style="margin:4px 0 10px">Sube o selecciona la receta: el sistema solo deja despachar lo recetado.</p><button class="btn primary" id="selReceta">Seleccionar o registrar receta</button></div>`.s;
    $('#selReceta').onclick = () => elegirReceta({
      items: rx.map(l => ({ p: l.p, cantidad: l.cantidad, modo: l.modo })),
      alElegir: r => { S.receta = r; pintarCarrito(); },
    });
  }
  pintarCarrito();
  $('#cli').onchange = e => { S.clienteId = e.target.value; };
  $('#vaciar').onclick = () => { S.cart = []; S.receta = null; pintarCarrito(); };
  const cobrar = guard(async () => {
    if (!S.cart.length) return toast('El carrito está vacío', true);
    if (S.cart.some(l => l.p.requiere_formula) && !S.receta) return toast('Falta la receta: selecciónala o regístrala', true);
    const v = await POST('/ventas', {
      items: S.cart.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad, modo: l.modo, descuento_pct: l.pct })),
      cliente_id: $('#cli').value ? num($('#cli').value) : null, medio_pago: $('#pago').value, receta_id: S.receta?.id,
    });
    S.cart = []; S.receta = null; refrescarBadge(); recibo(v); go('pos');
  });
  $('#cobrar').onclick = cobrar;
  document.onkeydown = e => { if (e.key === 'F9' && location.hash === '#pos') { e.preventDefault(); cobrar(); } };
  q.focus();
};

/* Ticket de venta con lote y vencimiento por línea; se imprime en rollo de 80 mm */
function recibo(v) {
  modal(html`<div class="ticket"><h3>${S.user.negocio || 'VitalTrack'}</h3>
    <div class="c">TICKET DE VENTA</div><div class="c"><b>${ticketNo(v.id)}</b></div>
    <div>${v.fecha.replace('T', ' ')}<br>Atendió: ${v.cajero}${v.cliente ? html`<br>Cliente: ${v.cliente}` : ''}</div><hr>
    ${v.items.map(i => html`<div class="row sp"><span>${i.cantidad} × ${i.nombre}</span><b>${cop(i.total)}</b></div><div class="l2">Lote ${i.lote} · Vence ${i.vence}${i.descuento_pct ? ` · −${i.descuento_pct}%` : ''}</div>`)}<hr>
    ${v.descuento ? html`<div class="row sp"><span>Descuento</span><span>-${cop(v.descuento)}</span></div>` : ''}
    <div class="row sp"><span>Subtotal</span><span>${cop(v.subtotal)}</span></div>
    <div class="row sp"><span>IVA incluido</span><span>${cop(v.iva)}</span></div>
    <div class="row sp"><b>TOTAL (${v.medio_pago})</b><b>${cop(v.total)}</b></div>
    ${v.formula ? html`<hr><div>Fórmula ${v.formula.numero || ''} · Paciente: ${v.formula.paciente}<br>Dr(a). ${v.formula.medico} · RM ${v.formula.registro_medico}</div>` : ''}
    <hr><p class="c mut" style="margin:6px 0">Verifique su producto y fecha de vencimiento.<br>Comprobante interno de venta (no es factura electrónica DIAN).</p></div>
    <div class="row noprint" style="justify-content:center;margin-top:14px"><button class="btn primary" onclick="window.print()">${ic('printer')} Imprimir ticket</button><button class="btn" onclick="cerrar()">Cerrar</button></div>`);
}

/* ---------- Vencimientos ---------- */
V.vencimientos = async el => {
  const todos = el.dataset.todos === '1';
  const data = await GET('/vencimientos' + (todos ? '?todos=1' : ''));
  const riesgo = data.reduce((s, l) => s + l.valor_riesgo, 0);
  const staff = S.user.rol !== 'cajero';
  el.innerHTML = html`<div class="row sp" style="margin-bottom:12px">
    <div class="row"><span class="badge red">${data.filter(l => l.estado === 'vencido').length} vencidos</span><span class="badge red">${data.filter(l => l.estado === 'critico').length} críticos</span><span class="badge amb">${data.filter(l => l.estado === 'atencion').length} atención</span><b>Dinero en riesgo: ${cop(riesgo)}</b></div>
    <label class="chk" style="margin:0"><input type="checkbox" id="todos" ${todos ? 'checked' : ''}> Ver todos los lotes</label></div>
    <div class="card tw"><table><thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Estado</th><th class="r">Cant.</th><th class="r">Rot./día</th><th class="r">En riesgo</th><th>Qué hacer</th><th></th></tr></thead><tbody>
    ${data.map(l => html`<tr><td><b>${l.nombre}</b><div class="mut">${l.presentacion || ''}</div></td><td>${l.lote}</td><td>${l.vence}</td><td>${diasBadge(l)}</td>
      <td class="r">${stockTxt(l.cantidad, l.factor)}</td><td class="r">${l.rotacion_dia}</td>
      <td class="r">${l.riesgo_unidades ? html`<b>${l.riesgo_unidades} u</b><div class="mut">${cop(l.valor_riesgo)}</div>` : '—'}</td><td>${l.accion}</td>
      <td>${staff ? html`<button class="btn sm danger" data-baja="${l.lote_id}" data-max="${l.cantidad}" data-n="${l.nombre} · ${l.lote}">Dar de baja</button>` : ''}</td></tr>`)}
    ${data.length ? '' : html`<tr><td colspan="9" class="mut">Sin lotes en alerta ${ic('check')}</td></tr>`}</tbody></table></div>
    <p class="mut">El sistema cruza la fecha de cada lote con lo que realmente rota ese producto (últimas semanas) y el orden FEFO, para estimar cuántas unidades no alcanzarán a venderse a tiempo y sugerir devolución, promoción o baja. En el punto de venta se aplica automáticamente el descuento sugerido (nunca por debajo del costo).</p>`.s;
  $('#todos').onchange = e => { el.dataset.todos = e.target.checked ? '1' : '0'; V.vencimientos(el); };
  $$('[data-baja]').forEach(b => b.onclick = () => {
    modal(html`<h3>Dar de baja</h3><p class="mut">${b.dataset.n}</p><form id="fBaja"><label>Unidades<input name="cantidad" type="number" min="1" max="${b.dataset.max}" value="${b.dataset.max}"></label>
      <label>Motivo<select name="motivo"><option>Vencido</option><option>Devolución a proveedor</option><option>Dañado / roto</option><option>Ajuste por conteo</option></select></label>
      <div class="row"><button class="btn danger">Confirmar baja</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fBaja').onsubmit = guard(async e => { e.preventDefault(); await POST(`/lotes/${b.dataset.baja}/baja`, formData(e.target)); cerrar(); toast('Baja registrada'); V.vencimientos(el); });
  });
};

/* ---------- Pedidos y alertas ---------- */
V.stock = async el => {
  const staff = S.user.rol !== 'cajero';
  const [st, pedidos, log, me, est] = await Promise.all([GET('/pedido-sugerido'), staff ? GET('/alertas/pedidos') : [], staff ? GET('/alertas/log') : [], GET('/me'), staff ? GET('/alertas/estado') : null]);
  el.innerHTML = html`
  <div class="card tw"><div class="row sp"><h3 style="margin:0">Sugerencia de pedido automática</h3>${staff ? html`<a class="btn sm" href="/api/exportar/pedido">${ic('download')} Excel</a>` : ''}</div><p class="mut" style="margin-top:6px">Calculada con lo que realmente vendes por día y lo que demora cada proveedor en entregar.</p>
  <table><thead><tr><th>Producto</th><th></th><th class="r">Existencia</th><th class="r">Ventas/día</th><th>Se agota</th><th>Qué hacer</th><th class="r">Pedir</th></tr></thead><tbody>
  ${st.map(p => html`<tr><td><b>${p.nombre}</b><div class="mut">${p.proveedor || 'Sin proveedor'} · entrega en ${p.entrega} d</div></td><td>${urgBadge(p)}</td><td class="r">${stockTxt(p.vendible, p.factor)}</td><td class="r">${p.rotacion_dia}</td>
    <td>${p.fecha_agota ? p.fecha_agota.slice(5) : '—'}</td><td>${p.sugerencia || p.motivo}</td><td class="r"><b>${p.sugerido_empaques}</b> emp</td></tr>`)}
  ${st.length ? '' : html`<tr><td colspan="7" class="mut">${ic('check')} Nada por pedir</td></tr>`}</tbody></table></div>
  ${staff ? html`
  <div class="grid two" style="margin-top:16px">
    <div class="card"><h3>Pedido por proveedor</h3>
      ${pedidos.map(g => html`<div class="bloque"><b>${g.proveedor}</b><pre class="msg">${g.texto}</pre>
        ${g.wa_link ? html`<a class="btn primary sm" target="_blank" rel="noopener" href="${g.wa_link}">${ic('chat')} Enviar pedido por WhatsApp</a>` : html`<span class="mut">Sin teléfono del proveedor</span>`}</div>`)}
      ${pedidos.length ? '' : html`<p class="mut">No hay nada que pedir.</p>`}</div>
    <div class="card"><h3>Alertas por WhatsApp</h3>
      <div class="alertbox ${est.listo ? 'ok' : ''}"><b>${est.listo ? 'WhatsApp listo para enviar' : est.proveedor === 'simulado' ? 'Modo de prueba: los avisos no se envían de verdad' : 'Falta configurar WhatsApp'}</b>
        <div class="mut" style="margin-top:4px">Proveedor: <b>${est.proveedor}</b> · Números destino: <b>${est.destinos}</b>${est.faltan.length ? html` · Faltan: <b>${est.faltan.join(', ')}</b>` : ''}${est.proveedor === 'meta' && !est.plantilla ? html`<br>Sin plantilla (WA_TEMPLATE): Meta solo entrega el mensaje si la persona te escribió en las últimas 24 h.` : ''}
        ${est.proveedor === 'simulado' ? html`<br>Para activarlo sigue la sección "Configurar WhatsApp" del README.` : ''}${!est.destinos ? html`<br>Agrega los números en <b>Configuración</b>.` : ''}</div></div>
      <p class="mut">Revisa cada 15 min, avisa cuando aparece un producto nuevo en crítico o un lote por vencer, y manda un resumen diario. No repite el mismo aviso el mismo día.</p>
      <div class="row"><button class="btn" id="prev">Vista previa</button><button class="btn" id="prueba">Mensaje de prueba</button><button class="btn primary" id="enviar">Enviar ahora</button></div><div id="prevOut"></div></div>
  </div>
  <div class="card tw" style="margin-top:16px"><h3>Historial de alertas enviadas</h3><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Destino</th><th>Estado</th><th>Mensaje</th></tr></thead><tbody>
  ${log.map(l => html`<tr><td>${l.fecha.replace('T', ' ')}</td><td>${l.tipo}</td><td>${l.destino}</td><td><span class="badge ${l.estado === 'enviado' ? 'grn' : l.estado === 'error' ? 'red' : 'amb'}" title="${l.detalle}">${l.estado}</span></td><td><pre class="msg" style="margin:0">${l.mensaje}</pre></td></tr>`)}
  ${log.length ? '' : html`<tr><td colspan="5" class="mut">Aún no hay alertas.</td></tr>`}</tbody></table></div>` : ''}`.s;
  if (!staff) return;
  $('#prev').onclick = guard(async () => { const p = await POST('/alertas/vista-previa'); $('#prevOut').innerHTML = html`${p.stock ? html`<pre class="msg">${p.stock}</pre>` : ''}${p.vencimiento ? html`<pre class="msg">${p.vencimiento}</pre>` : ''}${!p.stock && !p.vencimiento ? html`<p class="mut">Nada para avisar hoy.</p>` : ''}`.s; });
  $('#prueba').onclick = guard(async () => {
    const r = await POST('/alertas/prueba');
    if (r.sin_destinos) return toast('Primero agrega los números de WhatsApp en Configuración', true);
    $('#prevOut').innerHTML = html`${r.resultados.map(x => html`<div class="alertbox ${x.estado === 'error' ? 'rojo' : x.estado === 'enviado' ? 'ok' : ''}"><b>${x.destino}</b>: ${x.estado === 'enviado' ? 'enviado' : x.estado === 'simulado' ? 'simulado (no se envió de verdad)' : 'error'}<div class="mut">${x.detalle}</div></div>`)}`.s;
  });
  $('#enviar').onclick = guard(async () => {
    const r = await POST('/alertas/revisar', { force: true });
    if (r.sin_destinos) return toast('Configura los números de WhatsApp en Configuración', true);
    const err = r.enviadas.filter(x => x.estado === 'error');
    toast(err.length ? `Fallaron ${err.length}: ${err[0].detalle}` : `Alertas procesadas (${r.enviadas.length})`, !!err.length); V.stock(el);
  });
};

/* ---------- Inventario / productos ---------- */
V.inventario = async el => {
  const staff = S.user.rol !== 'cajero';
  const cargar = async (q = '') => {
    const prods = await GET('/productos?q=' + encodeURIComponent(q));
    $('#tabla').innerHTML = html`<table><thead><tr><th></th><th>Producto</th><th>Tipo</th><th class="r">Precio</th><th class="r">Existencia</th><th class="r">Mín.</th><th></th></tr></thead><tbody>
      ${prods.map(p => html`<tr><td>${fotoHtml(p)}</td><td><div class="row" style="gap:8px">${semDot(p.semaforo)}<b>${p.nombre}</b></div><div class="mut">${p.presentacion || ''} ${p.laboratorio ? '· ' + p.laboratorio : ''}${p.semaforo !== 'verde' ? html`<br><span class="${p.semaforo === 'rojo' ? 'badge red' : 'badge amb'}">${p.semaforo_motivo}</span>` : ''}</div></td>
        <td>${p.control_especial ? html`<span class="badge red">Control</span>` : p.requiere_formula ? html`<span class="badge pur">Fórmula</span>` : html`<span class="badge">Libre</span>`}</td>
        <td class="r">${cop(p.precio_venta)}</td><td class="r">${stockTxt(p.stock, p.factor)}</td><td class="r">${p.stock_min}</td>
        <td class="r"><button class="btn sm" data-ver="${p.id}">Ver</button> ${staff ? html`<button class="btn sm" data-edit="${p.id}">Editar</button>` : ''}</td></tr>`)}</tbody></table>`.s;
    $$('[data-ver]').forEach(b => b.onclick = guard(async () => fichaProducto(await GET('/escaneo?id=' + b.dataset.ver), { kardex: staff })));
    $$('[data-edit]').forEach(b => b.onclick = () => editar(prods.find(p => p.id == b.dataset.edit)));
  };
  el.innerHTML = html`<div class="row sp" style="margin-bottom:14px"><input id="busca" class="grow" placeholder="Buscar por nombre, código, principio activo o categoría…" style="max-width:460px">${staff ? html`<span class="row"><a class="btn" href="/api/exportar/inventario" title="Productos y lotes en Excel">${ic('download')} Exportar a Excel</a><button class="btn" id="importar">${ic('upload')} Importar de Excel</button><button class="btn primary" id="nuevo">${ic('plus')} Nuevo producto</button></span>` : ''}</div>
    <div class="row" style="margin-bottom:12px"><span class="mut">Semáforo:</span><span class="badge grn">${semDot('verde')} Bien</span><span class="badge amb">${semDot('amarillo')} Vence en ≤ 3 meses o se agota pronto</span><span class="badge red">${semDot('rojo')} Vence en ≤ 30 días, vencido o stock bajo</span></div>
    <div class="card tw" id="tabla"></div>`.s;
  let t; $('#busca').oninput = e => { clearTimeout(t); t = setTimeout(guard(() => cargar(e.target.value)), 200); };
  if (staff) { $('#nuevo').onclick = () => editar(null); $('#importar').onclick = () => importarProductos(() => cargar($('#busca').value)); }
  await cargar();

  async function editar(p) {
    const provs = await GET('/proveedores'); p = p || { factor: 1, iva: 0, precio_venta: 0, costo: 0, stock_min: 0 };
    const i = (n, l, extra = '') => html`<label>${l}<input name="${n}" value="${p[n] ?? ''}" ${new Safe(extra)}></label>`;
    modal(html`<h3>${p.id ? 'Editar' : 'Nuevo'} producto</h3><form id="fProd">
      <div class="row" style="margin-bottom:12px">${fotoHtml(p, true)}<label class="grow" style="margin:0">Foto de la caja<input type="file" id="fFoto" accept="image/*"></label></div>
      <div class="f2">
      ${i('codigo', 'Código de barras / QR')}${i('nombre', 'Nombre *', 'required')}${i('principio_activo', 'Principio activo')}${i('laboratorio', 'Laboratorio')}
      ${i('presentacion', 'Presentación (ej. Caja x 100 tabletas)')}${i('categoria', 'Categoría (ej. Antibiótico, Analgésico)')}${i('invima', 'Registro INVIMA')}
      <label>IVA %<select name="iva">${[0, 5, 19].map(v => html`<option ${p.iva == v ? 'selected' : ''}>${v}</option>`)}</select></label>
      ${i('factor', 'Unidades por empaque (para vender suelto)', 'type="number" min="1"')}${i('precio_venta', 'Precio de venta del empaque *', 'type="number" min="0" step="any" required')}
      ${i('precio_unidad', 'Precio por unidad suelta (vacío = automático)', 'type="number" min="0" step="any"')}${i('costo', 'Costo del empaque', 'type="number" min="0" step="any"')}
      ${i('stock_min', 'Stock mínimo (en empaques)', 'type="number" min="0" step="any"')}
      <label>Proveedor<select name="proveedor_id"><option value="">—</option>${provs.map(x => html`<option value="${x.id}" ${p.proveedor_id === x.id ? 'selected' : ''}>${x.nombre}</option>`)}</select></label></div>
      <label class="chk"><input type="checkbox" name="requiere_formula" ${p.requiere_formula ? 'checked' : ''}> Se vende solo con fórmula médica</label>
      <label class="chk"><input type="checkbox" name="control_especial" ${p.control_especial ? 'checked' : ''}> Medicamento de control especial (solo regente)</label>
      <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button>${p.id ? html`<button type="button" class="btn danger" id="elim" style="margin-left:auto">Eliminar</button>` : ''}</div></form>`);
    $('#fProd').onsubmit = guard(async e => {
      e.preventDefault(); const f = e.target, d = formData(f);
      d.requiere_formula = f.requiere_formula.checked; d.control_especial = f.control_especial.checked;
      const r = p.id ? await PUT('/productos/' + p.id, d) : await POST('/productos', d);
      const file = $('#fFoto').files[0];
      if (file) await PUT(`/productos/${p.id || r.id}/foto`, { imagen: await reducirImagen(file, 800) });
      cerrar(); toast('Producto guardado'); cargar($('#busca').value);
    });
    if (p.id) $('#elim').onclick = guard(async () => { if (confirm('¿Eliminar este producto?')) { await api('DELETE', '/productos/' + p.id); cerrar(); cargar(); } });
  }
};

/* ---------- Compras ---------- */
V.compras = async el => {
  const [provs, prods, hist] = await Promise.all([GET('/proveedores'), GET('/productos'), GET('/compras')]);
  let lineas = [{}];
  const pintar = () => {
    $('#lineas').innerHTML = html`<table><thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Cant. (emp.)</th><th>Costo/emp.</th><th></th></tr></thead><tbody>
      ${lineas.map((l, i) => html`<tr><td><select data-i="${i}" data-f="producto_id"><option value="">Elegir…</option>${prods.map(p => html`<option value="${p.id}" ${l.producto_id == p.id ? 'selected' : ''}>${p.nombre}</option>`)}</select></td>
        <td><input data-i="${i}" data-f="lote" value="${l.lote || ''}"></td><td><input type="date" data-i="${i}" data-f="vence" value="${l.vence || ''}"></td>
        <td><input type="number" min="0" step="any" data-i="${i}" data-f="cantidad" value="${l.cantidad || ''}"></td><td><input type="number" min="0" step="any" data-i="${i}" data-f="costo" value="${l.costo || ''}"></td>
        <td><button type="button" class="btn ghost sm" data-del="${i}">${ic('x')}</button></td></tr>`)}</tbody></table>`.s;
    $$('#lineas [data-f]').forEach(x => x.onchange = () => {
      lineas[x.dataset.i][x.dataset.f] = x.value;
      if (x.dataset.f === 'producto_id') { const p = prods.find(p => p.id == x.value); if (p && !lineas[x.dataset.i].costo) { lineas[x.dataset.i].costo = p.costo; pintar(); } }
    });
    $$('#lineas [data-del]').forEach(b => b.onclick = () => { lineas.splice(b.dataset.del, 1); if (!lineas.length) lineas = [{}]; pintar(); });
  };
  el.innerHTML = html`<div class="card"><h3>Ingreso de mercancía</h3><form id="fCompra"><div class="f2"><label>Proveedor<select name="proveedor_id"><option value="">—</option>${provs.map(p => html`<option value="${p.id}">${p.nombre}</option>`)}</select></label><label>N.º de factura<input name="factura"></label></div>
    <div id="lineas" class="tw"></div><div class="row"><button type="button" class="btn" id="mas">${ic('plus')} Línea</button><button class="btn primary">Registrar ingreso</button><button type="button" class="btn" id="nprov">${ic('plus')} Proveedor</button></div></form></div>
    <div class="card tw" style="margin-top:14px"><h3>Últimas compras</h3><table><thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th class="r">Total</th></tr></thead><tbody>${hist.map(c => html`<tr><td>${c.id}</td><td>${c.fecha.replace('T', ' ')}</td><td>${c.proveedor || ''}</td><td>${c.factura || ''}</td><td class="r">${cop(c.total)}</td></tr>`)}</tbody></table></div>`.s;
  pintar();
  $('#mas').onclick = () => { lineas.push({}); pintar(); };
  $('#fCompra').onsubmit = guard(async e => {
    e.preventDefault(); const d = formData(e.target);
    const items = lineas.filter(l => l.producto_id).map(l => ({ producto_id: num(l.producto_id), lote: l.lote, vence: l.vence, cantidad: num(l.cantidad), costo: num(l.costo) }));
    const r = await POST('/compras', { proveedor_id: d.proveedor_id ? num(d.proveedor_id) : null, factura: d.factura, items });
    toast('Mercancía ingresada' + (r.avisos?.length ? ` · se avisó por WhatsApp a ${r.avisos.length} cliente(s)` : '')); V.compras(el); refrescarBadge(); ofrecerEtiquetas(r.id);
  });
  $('#nprov').onclick = () => {
    modal(html`<h3>Nuevo proveedor</h3><form id="fProv"><label>Nombre *<input name="nombre" required></label><label>Teléfono WhatsApp (573001234567)<input name="telefono"></label><label>Contacto<input name="contacto"></label>
      <div class="f2"><label>Días que tarda en llegar el pedido<input name="dias_entrega" type="number" min="0" value="1"></label><label>Días antes de vencer en que aceptan canje<input name="dias_devolucion" type="number" value="60"></label></div><div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fProv').onsubmit = guard(async e => { e.preventDefault(); await POST('/proveedores', formData(e.target)); cerrar(); V.compras(el); });
  };
};

/* ---------- Clientes / CRM ---------- */
V.clientes = async el => {
  const [cl, av] = await Promise.all([GET('/clientes'), GET('/avisos/pendientes')]);
  el.innerHTML = html`<div class="row sp" style="margin-bottom:14px"><span class="mut">Cartera total: <b>${cop(cl.reduce((s, c) => s + c.saldo, 0))}</b></span><span class="row">${S.user.rol !== 'cajero' ? html`<a class="btn" href="/api/exportar/clientes">${ic('download')} Cartera a Excel</a>` : ''}<button class="btn primary" id="nc">${ic('plus')} Nuevo cliente</button></span></div>
    ${av.explicitos.length || av.habituales.length ? html`<div class="card" style="margin-bottom:16px"><h3>${ic('chat')} Avisos a clientes</h3>
      ${av.explicitos.map(a => html`<div class="alertbox ${a.disponible ? 'ok' : ''}"><div class="row sp"><span><b>${a.nombre}</b> pidió que le avisen cuando llegue <b>${a.producto}</b> ${a.disponible ? '(ya hay stock)' : html`<span class="mut">(aún sin stock)</span>`}</span>
        ${a.disponible ? html`<span class="row"><button class="btn ok sm" data-env="${a.id}">Enviar WhatsApp</button>${a.wa_link ? html`<a class="btn sm" target="_blank" rel="noopener" href="${a.wa_link}">Abrir chat</a>` : ''}</span>` : ''}</div></div>`)}
      ${av.habituales.map(a => html`<div class="alertbox"><div class="row sp"><span><b>${a.nombre}</b> compra <b>${a.producto}</b> seguido (${a.veces} veces) y acaba de llegar.</span><a class="btn sm" target="_blank" rel="noopener" href="${a.wa_link}">${ic('chat')} Avisarle</a></div></div>`)}</div>` : ''}
    <div class="card tw"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Teléfono</th><th class="r">Saldo</th><th></th></tr></thead><tbody>
    ${cl.map(c => html`<tr class="click" data-id="${c.id}"><td><b>${c.nombre}</b></td><td>${c.documento || ''}</td><td>${c.telefono || ''}</td><td class="r">${c.saldo > 0 ? html`<span class="badge amb">${cop(c.saldo)}</span>` : cop(c.saldo)}</td>
      <td class="r"><button class="btn sm" data-hist="${c.id}">Historial</button> ${c.saldo > 0 ? html`<button class="btn sm" data-ab="${c.id}" data-s="${c.saldo}" data-n="${c.nombre}">Abonar</button>` : ''}</td></tr>`)}</tbody></table></div>`.s;
  $('#nc').onclick = () => {
    modal(html`<h3>Nuevo cliente</h3><form id="fCli"><label>Nombre *<input name="nombre" required></label><label>Documento<input name="documento"></label><label>Teléfono WhatsApp (573001234567)<input name="telefono"></label><div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fCli').onsubmit = guard(async e => { e.preventDefault(); await POST('/clientes', formData(e.target)); cerrar(); V.clientes(el); });
  };
  $$('[data-env]').forEach(b => b.onclick = guard(async () => { const r = await POST(`/avisos/${b.dataset.env}/enviar`); toast(r.estado === 'error' ? r.detalle : `Aviso ${r.estado} a ${r.cliente}`, r.estado === 'error'); V.clientes(el); }));
  $$('[data-ab]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    modal(html`<h3>Abono de ${b.dataset.n}</h3><p class="mut">Saldo: ${cop(b.dataset.s)}</p><form id="fAb"><label>Valor<input name="valor" type="number" min="1" max="${b.dataset.s}" value="${b.dataset.s}"></label><label>Medio<select name="medio"><option>efectivo</option><option>transferencia</option><option>tarjeta</option></select></label>
      <div class="row"><button class="btn primary">Registrar abono</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fAb').onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); await POST(`/clientes/${b.dataset.ab}/abonos`, { valor: num(d.valor), medio: d.medio }); cerrar(); toast('Abono registrado'); V.clientes(el); });
  });
  $$('[data-hist]').forEach(b => b.onclick = e => { e.stopPropagation(); historialCliente(b.dataset.hist, () => V.clientes(el)); });
  $$('tr[data-id]').forEach(tr => tr.onclick = () => historialCliente(tr.dataset.id, () => V.clientes(el)));
};

/* ---------- Caja ---------- */
V.caja = async el => {
  const [c, ventas] = await Promise.all([GET('/caja'), GET('/ventas')]);
  const hist = S.user.rol !== 'cajero' ? await GET('/caja/historial') : [];
  el.innerHTML = html`<div class="grid two">
    <div class="card"><h3>Mi caja</h3>${c ? html`<p>Abierta desde ${c.abierta.replace('T', ' ')} · ${c.ventas} ventas</p>
      <table><tbody><tr><td>Base</td><td class="r">${cop(c.base)}</td></tr>${Object.entries(c.por_medio).map(([k, v]) => html`<tr><td>Ventas ${k}</td><td class="r">${cop(v)}</td></tr>`)}<tr><td>Abonos en efectivo</td><td class="r">${cop(c.abonos_efectivo)}</td></tr>
      <tr><td><b>Efectivo esperado</b></td><td class="r"><b>${cop(c.efectivo_esperado)}</b></td></tr></tbody></table>
      <form id="fCerrar" style="margin-top:12px"><label>Efectivo contado<input name="contado" type="number" min="0" required></label><button class="btn primary">Cerrar caja</button></form>`
      : html`<p class="mut">No tienes caja abierta.</p><form id="fAbrir"><label>Base en efectivo<input name="base" type="number" min="0" value="0"></label><button class="btn primary">Abrir caja</button></form>`}</div>
    <div class="card tw"><h3>Últimas ventas</h3><table><tbody>${ventas.slice(0, 12).map(v => html`<tr class="click" data-v="${v.id}"><td>#${v.id}</td><td>${v.fecha.slice(5, 16).replace('T', ' ')}</td><td>${v.medio_pago} ${v.con_formula ? html`<span class="badge pur">Rx</span>` : ''}</td><td class="r">${cop(v.total)}</td><td>${v.estado !== 'ok' ? html`<span class="badge red">${v.estado}</span>` : ''}</td></tr>`)}</tbody></table></div></div>
    ${hist.length ? html`<div class="card tw" style="margin-top:14px"><h3>Cierres de caja</h3><table><thead><tr><th>Cajero</th><th>Apertura</th><th>Estado</th><th class="r">Esperado</th><th class="r">Contado</th><th class="r">Diferencia</th></tr></thead><tbody>${hist.map(h => html`<tr><td>${h.cajero}</td><td>${h.abierta.replace('T', ' ')}</td><td>${h.estado}</td><td class="r">${cop(h.efectivo_esperado)}</td><td class="r">${h.efectivo_contado == null ? '—' : cop(h.efectivo_contado)}</td><td class="r">${h.diferencia == null ? '' : html`<span class="badge ${h.diferencia === 0 ? 'grn' : 'red'}">${cop(h.diferencia)}</span>`}</td></tr>`)}</tbody></table></div>` : ''}`.s;
  if (c) $('#fCerrar').onsubmit = guard(async e => { e.preventDefault(); if (!confirm('¿Cerrar caja?')) return; const r = await POST('/caja/cerrar', { contado: num(formData(e.target).contado) }); toast(`Caja cerrada. Diferencia: ${cop(r.diferencia)}`); V.caja(el); });
  else $('#fAbrir').onsubmit = guard(async e => { e.preventDefault(); await POST('/caja/abrir', { base: num(formData(e.target).base) }); V.caja(el); });
  $$('tr[data-v]').forEach(tr => tr.onclick = guard(async () => {
    const v = await GET('/ventas/' + tr.dataset.v); recibo(v);
    if (v.estado === 'ok' && S.user.rol !== 'cajero') {
      const b = document.createElement('button'); b.className = 'btn danger noprint'; b.textContent = 'Anular venta';
      b.onclick = guard(async () => { if (confirm('¿Anular la venta y devolver el stock?')) { await POST(`/ventas/${v.id}/anular`); cerrar(); toast('Venta anulada'); V.caja(el); } });
      $('#modalBody .row.noprint').append(b);
    }
  }));
};

/* ---------- Reportes ---------- */
V.reportes = async el => {
  const d = el.dataset.desde || hoy().slice(0, 8) + '01', h = el.dataset.hasta || hoy();
  const [r, libro, per] = await Promise.all([GET(`/reportes/ventas?desde=${d}&hasta=${h}`), GET(`/reportes/formulas?desde=${d}&hasta=${h}`), GET(`/reportes/perdidas?desde=${d}&hasta=${h}`)]);
  el.innerHTML = html`<form id="fRep" class="row" style="margin-bottom:12px"><label style="margin:0">Desde<input type="date" name="desde" value="${d}"></label><label style="margin:0">Hasta<input type="date" name="hasta" value="${h}"></label><button class="btn primary" style="align-self:end">Ver</button><a class="btn" style="align-self:end" href="/api/exportar/ventas?desde=${d}&hasta=${h}">${ic('download')} Ventas a Excel</a></form>
  <div class="grid kpis"><div class="card kpi grn"><div class="l">Ventas</div><div class="n">${cop(r.total)}</div><div class="l">${r.ventas} tickets</div></div><div class="card kpi"><div class="l">Utilidad bruta</div><div class="n">${cop(r.utilidad)}</div></div><div class="card kpi"><div class="l">Descuentos</div><div class="n">${cop(r.descuentos)}</div></div><div class="card kpi"><div class="l">IVA</div><div class="n">${cop(r.iva)}</div></div></div>
  <div class="grid two" style="margin-top:14px"><div class="card tw"><h3>Más vendidos</h3><table><tbody>${r.top.map(t => html`<tr><td>${t.nombre}</td><td class="r">${t.unidades} u</td><td class="r">${cop(t.total)}</td></tr>`)}</tbody></table></div>
  <div class="card"><h3>Por medio de pago</h3><table><tbody>${r.por_medio.map(m => html`<tr><td>${m.medio_pago}</td><td class="r">${cop(m.total)}</td></tr>`)}</tbody></table></div></div>
  <div class="card" style="margin-top:14px"><h3>Plata que se pierde</h3>
    <div class="grid kpis"><div class="card kpi"><div class="l">Dado de baja en el período</div><div class="n" style="color:${per.total ? 'var(--red)' : 'inherit'}">${cop(per.total)}</div><div class="l">${per.bajas} baja(s), a costo</div></div>
      <div class="card kpi"><div class="l">Vencido todavía en bodega</div><div class="n" style="color:${per.vencido_en_bodega ? 'var(--amb-d)' : 'inherit'}">${cop(per.vencido_en_bodega)}</div><div class="l">pendiente de dar de baja</div></div>
      <div class="card kpi"><div class="l">En riesgo de vencerse</div><div class="n">${cop(per.en_riesgo)}</div><div class="l">según tu rotación</div></div></div>
    ${per.por_motivo.length ? html`<h4>Por motivo</h4><table><tbody>${per.por_motivo.map(m => html`<tr><td>${m.motivo}</td><td class="mut">${m.bajas} baja(s) · ${m.unidades} u</td><td class="r"><b>${cop(m.valor)}</b></td></tr>`)}</tbody></table>` : html`<p class="mut" style="margin-bottom:0">No hay bajas en este período. Lo vencido se registra desde <b>Vencimientos → Dar de baja</b>.</p>`}</div>
  <div class="card tw" style="margin-top:14px"><div class="row sp"><h3>Libro de fórmulas dispensadas</h3><span><a class="btn sm" href="/api/reportes/formulas?desde=${d}&hasta=${h}&formato=csv">${ic('download')} CSV</a> <a class="btn sm" href="/api/reportes/formulas?desde=${d}&hasta=${h}&formato=csv&control=1">${ic('download')} CSV control especial</a></span></div>
  <table><thead><tr><th>Fecha</th><th>Fórmula</th><th>Paciente</th><th>Médico</th><th>Medicamentos</th><th>Despachó</th></tr></thead><tbody>${libro.map(f => html`<tr><td>${f.fecha.replace('T', ' ').slice(0, 16)}</td><td>${f.numero || ''} ${f.control ? html`<span class="badge red">Control</span>` : ''} ${f.estado !== 'ok' ? html`<span class="badge red">anulada</span>` : ''}</td><td>${f.paciente}<div class="mut">${f.documento_paciente || ''}</div></td><td>${f.medico}<div class="mut">RM ${f.registro_medico}</div></td><td>${f.medicamentos}</td><td>${f.despachado_por}</td></tr>`)}
  ${libro.length ? '' : html`<tr><td colspan="6" class="mut">Sin fórmulas en el período.</td></tr>`}</tbody></table></div>`.s;
  $('#fRep').onsubmit = e => { e.preventDefault(); const f = formData(e.target); el.dataset.desde = f.desde; el.dataset.hasta = f.hasta; V.reportes(el); };
};

/* ---------- Configuración ---------- */
V.config = async el => {
  const [c, us, resp] = await Promise.all([GET('/config'), GET('/usuarios'), GET('/respaldos')]);
  const f = (k, l, extra = '') => html`<label>${l}<input name="${k}" value="${c[k]}" ${new Safe(extra)}></label>`;
  el.innerHTML = html`<div class="grid two"><div class="card"><h3>Negocio y alertas</h3><form id="fCfg">${f('nombre_negocio', 'Nombre del negocio')}
    ${f('alerta_destinos', 'Números de WhatsApp para alertas (separados por coma, con indicativo: 573001234567)')}${f('alerta_hora', 'Hora del resumen diario', 'type="time"')}
    ${f('dias_reposicion', 'Días que tarda en llegar un pedido', 'type="number" min="1"')}${f('dias_vence_critico', 'Vencimiento crítico (días)', 'type="number"')}${f('dias_vence_atencion', 'Vencimiento en atención (días)', 'type="number"')}
    ${f('ventana_rotacion', 'Días de historia para medir rotación', 'type="number" min="7"')}${f('descuento_max_pct', 'Descuento máximo (%)', 'type="number" max="100"')}
    <label class="chk"><input type="checkbox" name="promo_auto" ${c.promo_auto === '1' ? 'checked' : ''}> Aplicar automáticamente en el POS el descuento sugerido por vencimiento</label>
    <label class="chk"><input type="checkbox" name="aviso_cierre" ${c.aviso_cierre === '1' ? 'checked' : ''}> Enviar por WhatsApp el resumen al cerrar la caja (ventas y diferencia)</label>
    <button class="btn primary">Guardar</button></form></div>
  <div class="card tw"><h3>Usuarios</h3><table><tbody>${us.map(u => html`<tr><td><b>${u.nombre}</b><div class="mut">${u.usuario}</div></td><td>${u.rol}</td><td>${u.activo ? '' : html`<span class="badge red">inactivo</span>`}</td><td class="r"><button class="btn sm" data-u="${u.id}">Editar</button></td></tr>`)}</tbody></table>
  <button class="btn primary" id="nu" style="margin-top:10px">${ic('plus')} Nuevo usuario</button></div>
  <div class="card tw"><h3>${ic('download')} Respaldos</h3>
    <p class="mut" style="margin-top:-4px">Se crea uno automático cada día y se guardan los últimos 14. Copia la carpeta <code>data</code> a una USB o a tu Drive de vez en cuando: si el computador se daña, ahí está todo.</p>
    <button class="btn primary" id="rb">${ic('plus')} Crear respaldo ahora</button>
    <table style="margin-top:10px"><tbody>${resp.slice(0, 8).map(r => html`<tr><td>${r.fecha.replace('T', ' ')}</td><td class="mut">${(r.bytes / 1024).toFixed(0)} KB</td><td class="r"><a class="btn sm" href="/api/respaldos/${r.nombre}">${ic('download')} Descargar</a></td></tr>`)}
    ${resp.length ? '' : html`<tr><td class="mut">Aún no hay respaldos. El primero se crea solo.</td></tr>`}</tbody></table></div></div>`.s;
  $('#rb').onclick = guard(async () => { await POST('/respaldos'); toast('Respaldo creado'); V.config(el); });
  $('#fCfg').onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); d.promo_auto = e.target.promo_auto.checked ? '1' : '0'; d.aviso_cierre = e.target.aviso_cierre.checked ? '1' : '0'; await PUT('/config', d); S.user.negocio = d.nombre_negocio; toast('Configuración guardada'); });
  const userForm = u => {
    modal(html`<h3>${u ? 'Editar' : 'Nuevo'} usuario</h3><form id="fU"><label>Nombre<input name="nombre" value="${u?.nombre || ''}" required></label>${u ? '' : html`<label>Usuario<input name="usuario" required></label>`}
      <label>${u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña (mín. 6)'}<input name="password" type="password" ${u ? '' : 'required'} autocomplete="new-password"></label>
      <label>Rol<select name="rol">${['cajero', 'regente', 'admin'].map(r => html`<option ${u?.rol === r ? 'selected' : ''}>${r}</option>`)}</select></label>
      ${u ? html`<label class="chk"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''}> Activo</label>` : ''}
      <div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fU').onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); if (u) { d.activo = e.target.activo.checked; await PUT('/usuarios/' + u.id, d); } else await POST('/usuarios', d); cerrar(); V.config(el); });
  };
  $('#nu').onclick = () => userForm(null);
  $$('[data-u]').forEach(b => b.onclick = () => userForm(us.find(u => u.id == b.dataset.u)));
};
