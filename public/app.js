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
const S = { user: null, cart: [], clienteId: '' };
const VISTAS = [
  ['inicio', 'home', 'Inicio', ['admin', 'regente', 'cajero']],
  ['pos', 'cart', 'Punto de venta', ['admin', 'regente', 'cajero']],
  ['vencimientos', 'calendar', 'Vencimientos', ['admin', 'regente', 'cajero']],
  ['stock', 'trend', 'Stock y alertas', ['admin', 'regente', 'cajero']],
  ['inventario', 'package', 'Inventario', ['admin', 'regente', 'cajero']],
  ['compras', 'truck', 'Compras', ['admin', 'regente']],
  ['clientes', 'users', 'Clientes / fiado', ['admin', 'regente', 'cajero']],
  ['caja', 'cash', 'Caja', ['admin', 'regente', 'cajero']],
  ['reportes', 'chart', 'Reportes', ['admin', 'regente']],
  ['config', 'sliders', 'Configuración', ['admin']],
];
const V = {};

function showLogin() { S.user = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
async function entrar(user) {
  S.user = user; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#quien').textContent = `${user.nombre} · ${user.rol}`;
  const nav = $('#nav');
  nav.innerHTML = html`<div class="brand"><img src="logo-mark.svg" alt=""><span>${user.negocio || 'FarmaBarrio'}</span></div>${VISTAS.filter(v => v[3].includes(user.rol)).map(v => html`<a data-v="${v[0]}">${ic(v[1])} ${v[2]} ${v[0] === 'stock' ? html`<span class="badge amb hidden" id="navStock"></span>` : ''}</a>`)}
    <a data-v="__salir" style="margin-top:20px">${ic('logout')} Salir</a>`.s;
  go((location.hash || '#inicio').slice(1));
  refrescarBadge();
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
  if (a.dataset.v === '__salir') POST('/logout').then(showLogin); else go(a.dataset.v);
});
$('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await POST('/login', formData(e.target)); entrar(await GET('/me')); e.target.reset(); } catch (er) { $('#loginErr').textContent = er.message; }
};
window.addEventListener('load', async () => { try { entrar(await GET('/me')); } catch { showLogin(); } });

/* ---------- Inicio ---------- */
V.inicio = async el => {
  const d = await GET('/dashboard');
  const max = Math.max(1, ...d.ventas_7d.map(x => x.total));
  el.innerHTML = html`
  <div class="grid kpis">
    <div class="card kpi grn"><div class="l">Ventas de hoy</div><div class="n">${cop(d.ventas_hoy)}</div><div class="l">${d.num_ventas_hoy} ventas</div></div>
    <div class="card kpi"><div class="l">Utilidad de hoy</div><div class="n">${cop(d.utilidad_hoy)}</div></div>
    <div class="card kpi red"><div class="l">Lotes vencidos en bodega</div><div class="n">${d.lotes_vencidos}</div></div>
    <div class="card kpi amb"><div class="l">Lotes por vencer (≤ 30 d)</div><div class="n">${d.lotes_criticos}</div></div>
    <div class="card kpi red"><div class="l">Dinero en riesgo por vencimiento</div><div class="n">${cop(d.valor_en_riesgo)}</div></div>
    <div class="card kpi amb"><div class="l">Stock crítico</div><div class="n">${d.stock_critico}</div><div class="l">${d.agotados} agotados</div></div>
    <div class="card kpi"><div class="l">Cartera (fiado)</div><div class="n">${cop(d.cartera)}</div></div>
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h3>Vencimientos prioritarios</h3>
      <div class="tw"><table><tbody>${d.top_vencer.map(l => html`<tr><td>${l.nombre}<div class="mut">Lote ${l.lote} · ${l.cantidad} u</div></td><td>${diasBadge(l)}</td><td class="mut">${l.accion}</td></tr>`)}
      ${d.top_vencer.length ? '' : html`<tr><td class="mut">Todo en orden ${ic('check')}</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Stock crítico</h3>
      <div class="tw"><table><tbody>${d.top_stock.map(p => html`<tr><td>${p.nombre}<div class="mut">${p.motivo}</div></td><td>${nivelBadge(p.nivel)}</td><td class="r">pedir ${p.sugerido_empaques}</td></tr>`)}
      ${d.top_stock.length ? '' : html`<tr><td class="mut">Todo en orden ${ic('check')}</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Ventas últimos 7 días</h3>
      ${d.ventas_7d.map(x => html`<div class="row" style="margin:6px 0"><span class="mut" style="width:78px">${x.dia.slice(5)}</span><div class="bar grow"><i style="width:${(x.total / max * 100).toFixed(0)}%"></i></div><b style="width:96px;text-align:right">${cop(x.total)}</b></div>`)}</div>
  </div>`.s;
};

/* ---------- Punto de venta ---------- */
const MEDIOS = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];
const unitPrice = l => l.modo === 'empaque' ? l.p.precio_empaque / l.p.factor : l.p.precio_unidad;
const unidades = l => l.cantidad * (l.modo === 'empaque' ? l.p.factor : 1);
const lineTotal = l => Math.round(unidades(l) * unitPrice(l) * (1 - l.pct / 100));

V.pos = async el => {
  const caja = await GET('/caja');
  if (!caja) {
    el.innerHTML = html`<div class="card" style="max-width:380px"><h3>Abrir caja</h3><p class="mut">Necesitas abrir caja para vender.</p>
      <form id="fAbrir"><label>Base en efectivo<input name="base" type="number" min="0" value="0"></label><button class="btn primary">Abrir caja</button></form></div>`.s;
    $('#fAbrir').onsubmit = guard(async e => { e.preventDefault(); await POST('/caja/abrir', { base: num(formData(e.target).base) }); toast('Caja abierta'); go('pos'); });
    return;
  }
  const clientes = await GET('/clientes');
  el.innerHTML = html`<div class="pos">
    <div class="card"><input id="q" placeholder="Escanea el código o escribe nombre / principio activo…" autocomplete="off" autofocus><div id="res" class="res"></div></div>
    <div class="card"><h3>Venta</h3><div id="cart"></div>
      <div class="row" style="margin-top:10px"><label class="grow">Cliente<select id="cli"><option value="">Mostrador</option>${clientes.map(c => html`<option value="${c.id}" ${String(c.id) === String(S.clienteId) ? 'selected' : ''}>${c.nombre}${c.saldo ? ` (debe ${cop(c.saldo)})` : ''}</option>`)}</select></label>
      <label class="grow">Pago<select id="pago">${MEDIOS.map(m => html`<option>${m}</option>`)}</select></label></div>
      <div id="formula"></div>
      <div class="row sp" style="margin-top:6px"><div><div class="mut" id="desc"></div><div class="tot" id="total">$0</div></div>
      <div class="row"><button class="btn" id="vaciar">Vaciar</button><button class="btn primary" id="cobrar">Cobrar (F9)</button></div></div>
    </div></div>`.s;

  const q = $('#q'); let timer;
  const buscar = async () => { const r = await GET('/pos/buscar?q=' + encodeURIComponent(q.value)); pintarRes(r); return r; };
  const pintarRes = r => {
    $('#res').innerHTML = html`${r.map((p, i) => html`<div class="it ${p.stock <= 0 ? 'sin' : ''}" data-i="${i}">
      <div class="grow"><b>${p.nombre}</b> <span class="mut">${p.presentacion || ''}</span>
      <div>${p.requiere_formula ? html`<span class="badge pur">Fórmula</span> ` : ''}${p.control_especial ? html`<span class="badge red">Control especial</span> ` : ''}${p.promo_pct ? html`<span class="badge amb">Vence ${p.proximo_vence} · −${p.promo_pct}%</span> ` : ''}
      <span class="mut">Stock: ${stockTxt(p.stock, p.factor)}</span></div></div>
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

  function agregar(p) {
    if (p.stock <= 0) return toast(`${p.nombre}: sin existencias vendibles`, true);
    const ya = S.cart.find(l => l.p.id === p.id);
    if (ya) ya.cantidad++; else S.cart.push({ p, modo: p.factor > 1 ? 'unidad' : 'empaque', cantidad: 1, pct: p.promo_pct || 0 });
    pintarCarrito();
  }
  function pintarCarrito() {
    const total = S.cart.reduce((s, l) => s + lineTotal(l), 0);
    const bruto = S.cart.reduce((s, l) => s + Math.round(unidades(l) * unitPrice(l)), 0);
    $('#cart').innerHTML = S.cart.length ? html`<div class="tw"><table class="cart"><tbody>${S.cart.map((l, i) => html`<tr>
      <td>${l.p.nombre}${l.p.requiere_formula ? html` <span class="badge pur">Rx</span>` : ''}${unidades(l) > l.p.stock ? html`<div class="error">Solo hay ${stockTxt(l.p.stock, l.p.factor)}</div>` : ''}</td>
      <td style="width:62px"><input type="number" min="1" value="${l.cantidad}" data-i="${i}" data-f="cantidad"></td>
      <td style="width:104px">${l.p.factor > 1 ? html`<select data-i="${i}" data-f="modo"><option value="unidad" ${l.modo === 'unidad' ? 'selected' : ''}>unidad</option><option value="empaque" ${l.modo === 'empaque' ? 'selected' : ''}>empaque</option></select>` : 'unidad'}</td>
      <td style="width:66px"><input type="number" min="0" max="100" value="${l.pct}" title="% descuento" data-i="${i}" data-f="pct"></td>
      <td class="r" style="width:84px"><b>${cop(lineTotal(l))}</b></td>
      <td style="width:28px"><button class="btn ghost sm" data-del="${i}">${ic('x')}</button></td></tr>`)}</tbody></table></div>`.s : '<p class="mut">Agrega productos buscándolos o escaneándolos.</p>';
    $('#total').textContent = cop(total);
    $('#desc').textContent = bruto > total ? `Descuento: ${cop(bruto - total)}` : '';
    $$('#cart [data-f]').forEach(inp => inp.onchange = () => { const l = S.cart[inp.dataset.i]; l[inp.dataset.f] = inp.dataset.f === 'modo' ? inp.value : Math.max(0, num(inp.value)); if (l.cantidad < 1) l.cantidad = 1; pintarCarrito(); });
    $$('#cart [data-del]').forEach(b => b.onclick = () => { S.cart.splice(b.dataset.del, 1); pintarCarrito(); });
    pintarFormula();
  }
  function pintarFormula() {
    const rx = S.cart.some(l => l.p.requiere_formula), ctrl = S.cart.some(l => l.p.control_especial);
    const prev = $('#formula form') ? formData($('#formula form')) : {};
    $('#formula').innerHTML = rx ? html`<form class="alertbox"><b>${ic('pill')} Venta con fórmula médica${ctrl ? ' — control especial' : ''}</b>
      <div class="f2" style="margin-top:8px"><label>Paciente *<input name="paciente" value="${prev.paciente || ''}"></label><label>Documento paciente${ctrl ? ' *' : ''}<input name="documento_paciente" value="${prev.documento_paciente || ''}"></label>
      <label>Médico *<input name="medico" value="${prev.medico || ''}"></label><label>Registro médico *<input name="registro_medico" value="${prev.registro_medico || ''}"></label>
      <label>N.º de fórmula<input name="numero" value="${prev.numero || ''}"></label><label>Fecha de la fórmula<input name="fecha_formula" type="date" value="${prev.fecha_formula || ''}"></label>
      <label>Institución<input name="institucion" value="${prev.institucion || ''}"></label></div>${ctrl && S.user.rol === 'cajero' ? html`<div class="error">Control especial: lo debe despachar el regente.</div>` : ''}</form>`.s : '';
  }
  pintarCarrito();
  $('#cli').onchange = e => { S.clienteId = e.target.value; };
  $('#vaciar').onclick = () => { S.cart = []; pintarCarrito(); };
  const cobrar = guard(async () => {
    if (!S.cart.length) return toast('El carrito está vacío', true);
    const rx = S.cart.some(l => l.p.requiere_formula);
    const v = await POST('/ventas', {
      items: S.cart.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad, modo: l.modo, descuento_pct: l.pct })),
      cliente_id: $('#cli').value ? num($('#cli').value) : null, medio_pago: $('#pago').value,
      formula: rx ? formData($('#formula form')) : undefined,
    });
    S.cart = []; refrescarBadge(); recibo(v); go('pos');
  });
  $('#cobrar').onclick = cobrar;
  document.onkeydown = e => { if (e.key === 'F9' && location.hash === '#pos') { e.preventDefault(); cobrar(); } };
  q.focus();
};

function recibo(v) {
  modal(html`<div class="recibo"><h3 style="text-align:center">${(S.user.negocio) || 'Droguería'}</h3>
    <div>Venta #${v.id} · ${v.fecha.replace('T', ' ')}<br>Atendió: ${v.cajero}${v.cliente ? html`<br>Cliente: ${v.cliente}` : ''}</div><hr>
    ${v.items.map(i => html`<div class="row sp"><span>${i.cantidad} × ${i.nombre} <span class="mut">(lote ${i.lote})</span></span><b>${cop(i.total)}</b></div>`)}<hr>
    ${v.descuento ? html`<div class="row sp"><span>Descuento</span><span>-${cop(v.descuento)}</span></div>` : ''}
    <div class="row sp"><span>IVA incluido</span><span>${cop(v.iva)}</span></div>
    <div class="row sp"><b>TOTAL (${v.medio_pago})</b><b>${cop(v.total)}</b></div>
    ${v.formula ? html`<hr><div>Fórmula ${v.formula.numero || ''} · Paciente: ${v.formula.paciente}<br>Dr(a). ${v.formula.medico} · RM ${v.formula.registro_medico}</div>` : ''}
    <p style="text-align:center" class="mut">¡Gracias por su compra!</p></div>
    <div class="row noprint"><button class="btn primary" onclick="window.print()">${ic('printer')} Imprimir</button><button class="btn" onclick="cerrar()">Cerrar</button></div>`);
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

/* ---------- Stock y alertas ---------- */
V.stock = async el => {
  const staff = S.user.rol !== 'cajero';
  const [st, pedidos, log, me] = await Promise.all([GET('/stock-critico'), staff ? GET('/alertas/pedidos') : [], staff ? GET('/alertas/log') : [], GET('/me')]);
  el.innerHTML = html`
  <div class="card tw"><h3>Stock crítico</h3><table><thead><tr><th>Producto</th><th>Nivel</th><th class="r">Existencia</th><th class="r">Mín.</th><th class="r">Rot./día</th><th class="r">Cobertura</th><th>Motivo</th><th class="r">Pedir</th></tr></thead><tbody>
  ${st.map(p => html`<tr><td><b>${p.nombre}</b><div class="mut">${p.proveedor || 'Sin proveedor'}</div></td><td>${nivelBadge(p.nivel)}</td><td class="r">${stockTxt(p.vendible, p.factor)}</td><td class="r">${p.stock_min}</td>
    <td class="r">${p.rotacion_dia}</td><td class="r">${p.cobertura_dias === null ? '—' : p.cobertura_dias + ' d'}</td><td>${p.motivo}</td><td class="r"><b>${p.sugerido_empaques}</b> emp</td></tr>`)}
  ${st.length ? '' : html`<tr><td colspan="8" class="mut">Nada crítico ${ic('check')}</td></tr>`}</tbody></table></div>
  ${staff ? html`
  <div class="grid two" style="margin-top:14px">
    <div class="card"><h3>Pedido sugerido por proveedor</h3>
      ${pedidos.map(g => html`<div class="alertbox"><b>${g.proveedor}</b><pre class="msg">${g.texto}</pre>
        ${g.wa_link ? html`<a class="btn primary sm" target="_blank" rel="noopener" href="${g.wa_link}">${ic('chat')} Enviar pedido por WhatsApp</a>` : html`<span class="mut">Sin teléfono del proveedor</span>`}</div>`)}
      ${pedidos.length ? '' : html`<p class="mut">No hay nada que pedir.</p>`}</div>
    <div class="card"><h3>Alertas por WhatsApp</h3>
      <p>Proveedor: <span class="badge ${me.whatsapp === 'simulado' ? 'amb' : 'grn'}">${me.whatsapp}</span> ${me.whatsapp === 'simulado' ? html`<span class="mut">— no se envía de verdad; configura WA_PROVIDER (ver README)</span>` : ''}</p>
      <p class="mut">Revisa solo cada 15 min, avisa cuando aparece un producto nuevo en crítico o un lote por vencer, y manda un resumen diario. No repite el mismo aviso el mismo día.</p>
      <div class="row"><button class="btn" id="prev">Vista previa</button><button class="btn primary" id="enviar">Enviar ahora</button></div><div id="prevOut"></div></div>
  </div>
  <div class="card tw" style="margin-top:14px"><h3>Historial de alertas enviadas</h3><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Destino</th><th>Estado</th><th>Mensaje</th></tr></thead><tbody>
  ${log.map(l => html`<tr><td>${l.fecha.replace('T', ' ')}</td><td>${l.tipo}</td><td>${l.destino}</td><td><span class="badge ${l.estado === 'enviado' ? 'grn' : l.estado === 'error' ? 'red' : 'amb'}" title="${l.detalle}">${l.estado}</span></td><td><pre class="msg" style="margin:0">${l.mensaje}</pre></td></tr>`)}
  ${log.length ? '' : html`<tr><td colspan="5" class="mut">Aún no hay alertas.</td></tr>`}</tbody></table></div>` : ''}`.s;
  if (!staff) return;
  $('#prev').onclick = guard(async () => { const p = await POST('/alertas/vista-previa'); $('#prevOut').innerHTML = html`${p.stock ? html`<pre class="msg">${p.stock}</pre>` : ''}${p.vencimiento ? html`<pre class="msg">${p.vencimiento}</pre>` : ''}${!p.stock && !p.vencimiento ? html`<p class="mut">Nada para avisar hoy.</p>` : ''}`.s; });
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
    $('#tabla').innerHTML = html`<table><thead><tr><th>Código</th><th>Producto</th><th>Tipo</th><th class="r">Precio</th><th class="r">Costo</th><th class="r">Existencia</th><th class="r">Mín.</th><th></th></tr></thead><tbody>
      ${prods.map(p => html`<tr><td>${p.codigo || ''}</td><td><b>${p.nombre}</b><div class="mut">${p.presentacion || ''} ${p.laboratorio ? '· ' + p.laboratorio : ''}</div></td>
        <td>${p.control_especial ? html`<span class="badge red">Control</span>` : p.requiere_formula ? html`<span class="badge pur">Fórmula</span>` : html`<span class="badge">Libre</span>`}</td>
        <td class="r">${cop(p.precio_venta)}</td><td class="r">${cop(p.costo)}</td><td class="r">${stockTxt(p.stock, p.factor)}</td><td class="r">${p.stock_min}</td>
        <td class="r"><button class="btn sm" data-lotes="${p.id}">Lotes</button> ${staff ? html`<button class="btn sm" data-edit="${p.id}">Editar</button>` : ''}</td></tr>`)}</tbody></table>`.s;
    $$('[data-lotes]').forEach(b => b.onclick = guard(() => verLotes(prods.find(p => p.id == b.dataset.lotes))));
    $$('[data-edit]').forEach(b => b.onclick = () => editar(prods.find(p => p.id == b.dataset.edit)));
  };
  el.innerHTML = html`<div class="row sp" style="margin-bottom:12px"><input id="busca" class="grow" placeholder="Buscar por nombre, código o principio activo…" style="max-width:420px">${staff ? html`<button class="btn primary" id="nuevo">+ Nuevo producto</button>` : ''}</div><div class="card tw" id="tabla"></div>`.s;
  let t; $('#busca').oninput = e => { clearTimeout(t); t = setTimeout(guard(() => cargar(e.target.value)), 200); };
  if (staff) $('#nuevo').onclick = () => editar(null);
  await cargar();

  async function editar(p) {
    const provs = await GET('/proveedores'); p = p || { factor: 1, iva: 0, precio_venta: 0, costo: 0, stock_min: 0 };
    const i = (n, l, extra = '') => html`<label>${l}<input name="${n}" value="${p[n] ?? ''}" ${new Safe(extra)}></label>`;
    modal(html`<h3>${p.id ? 'Editar' : 'Nuevo'} producto</h3><form id="fProd"><div class="f2">
      ${i('codigo', 'Código de barras')}${i('nombre', 'Nombre *', 'required')}${i('principio_activo', 'Principio activo')}${i('laboratorio', 'Laboratorio')}
      ${i('presentacion', 'Presentación (ej. Caja x 100 tabletas)')}${i('categoria', 'Categoría')}${i('invima', 'Registro INVIMA')}
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
      p.id ? await PUT('/productos/' + p.id, d) : await POST('/productos', d);
      cerrar(); toast('Producto guardado'); cargar($('#busca').value);
    });
    if (p.id) $('#elim').onclick = guard(async () => { if (confirm('¿Eliminar este producto?')) { await api('DELETE', '/productos/' + p.id); cerrar(); cargar(); } });
  }
  async function verLotes(p) {
    const [lotes, kardex] = await Promise.all([GET(`/productos/${p.id}/lotes`), staff ? GET('/kardex/' + p.id) : []]);
    const hoyS = hoy();
    modal(html`<h3>${p.nombre}</h3><h4>Lotes con existencia (orden FEFO)</h4><table><thead><tr><th>Lote</th><th>Vence</th><th class="r">Cantidad</th></tr></thead><tbody>
      ${lotes.map(l => html`<tr><td>${l.lote}</td><td>${l.vence} ${l.vence < hoyS ? html`<span class="badge red">vencido</span>` : ''}</td><td class="r">${stockTxt(l.cantidad, p.factor)}</td></tr>`)}${lotes.length ? '' : html`<tr><td colspan="3" class="mut">Sin lotes</td></tr>`}</tbody></table>
      ${staff ? html`<h4>Kardex (últimos movimientos)</h4><div class="tw" style="max-height:240px"><table><tbody>${kardex.map(m => html`<tr><td>${m.fecha.replace('T', ' ')}</td><td>${m.tipo}</td><td>${m.lote || ''}</td><td class="r">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td class="mut">${m.motivo || m.usuario || ''}</td></tr>`)}</tbody></table></div>` : ''}
      <div class="row"><button class="btn" onclick="cerrar()">Cerrar</button></div>`);
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
    <div id="lineas" class="tw"></div><div class="row"><button type="button" class="btn" id="mas">+ Línea</button><button class="btn primary">Registrar ingreso</button><button type="button" class="btn" id="nprov">+ Proveedor</button></div></form></div>
    <div class="card tw" style="margin-top:14px"><h3>Últimas compras</h3><table><thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th class="r">Total</th></tr></thead><tbody>${hist.map(c => html`<tr><td>${c.id}</td><td>${c.fecha.replace('T', ' ')}</td><td>${c.proveedor || ''}</td><td>${c.factura || ''}</td><td class="r">${cop(c.total)}</td></tr>`)}</tbody></table></div>`.s;
  pintar();
  $('#mas').onclick = () => { lineas.push({}); pintar(); };
  $('#fCompra').onsubmit = guard(async e => {
    e.preventDefault(); const d = formData(e.target);
    const items = lineas.filter(l => l.producto_id).map(l => ({ producto_id: num(l.producto_id), lote: l.lote, vence: l.vence, cantidad: num(l.cantidad), costo: num(l.costo) }));
    await POST('/compras', { proveedor_id: d.proveedor_id ? num(d.proveedor_id) : null, factura: d.factura, items });
    toast('Mercancía ingresada'); V.compras(el); refrescarBadge();
  });
  $('#nprov').onclick = () => {
    modal(html`<h3>Nuevo proveedor</h3><form id="fProv"><label>Nombre *<input name="nombre" required></label><label>Teléfono WhatsApp (573001234567)<input name="telefono"></label><label>Contacto<input name="contacto"></label>
      <label>Días antes del vencimiento en que aceptan devolución/canje<input name="dias_devolucion" type="number" value="60"></label><div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fProv').onsubmit = guard(async e => { e.preventDefault(); await POST('/proveedores', formData(e.target)); cerrar(); V.compras(el); });
  };
};

/* ---------- Clientes / fiado ---------- */
V.clientes = async el => {
  const cl = await GET('/clientes');
  el.innerHTML = html`<div class="row sp" style="margin-bottom:12px"><span class="mut">Cartera total: <b>${cop(cl.reduce((s, c) => s + c.saldo, 0))}</b></span><button class="btn primary" id="nc">+ Nuevo cliente</button></div>
    <div class="card tw"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Teléfono</th><th class="r">Saldo</th><th></th></tr></thead><tbody>
    ${cl.map(c => html`<tr><td><b>${c.nombre}</b></td><td>${c.documento || ''}</td><td>${c.telefono || ''}</td><td class="r">${c.saldo > 0 ? html`<span class="badge amb">${cop(c.saldo)}</span>` : cop(c.saldo)}</td>
      <td class="r">${c.saldo > 0 ? html`<button class="btn sm" data-ab="${c.id}" data-s="${c.saldo}" data-n="${c.nombre}">Abonar</button> ` : ''}${c.saldo > 0 && c.telefono ? html`<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${c.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${c.nombre}, le recordamos su saldo pendiente de ${cop(c.saldo)}. ¡Gracias!`)}">Recordar</a>` : ''}</td></tr>`)}</tbody></table></div>`.s;
  $('#nc').onclick = () => {
    modal(html`<h3>Nuevo cliente</h3><form id="fCli"><label>Nombre *<input name="nombre" required></label><label>Documento<input name="documento"></label><label>Teléfono WhatsApp<input name="telefono"></label><div class="row"><button class="btn primary">Guardar</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fCli').onsubmit = guard(async e => { e.preventDefault(); await POST('/clientes', formData(e.target)); cerrar(); V.clientes(el); });
  };
  $$('[data-ab]').forEach(b => b.onclick = () => {
    modal(html`<h3>Abono de ${b.dataset.n}</h3><p class="mut">Saldo: ${cop(b.dataset.s)}</p><form id="fAb"><label>Valor<input name="valor" type="number" min="1" max="${b.dataset.s}" value="${b.dataset.s}"></label><label>Medio<select name="medio"><option>efectivo</option><option>transferencia</option><option>tarjeta</option></select></label>
      <div class="row"><button class="btn primary">Registrar abono</button><button type="button" class="btn" onclick="cerrar()">Cancelar</button></div></form>`);
    $('#fAb').onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); await POST(`/clientes/${b.dataset.ab}/abonos`, { valor: num(d.valor), medio: d.medio }); cerrar(); toast('Abono registrado'); V.clientes(el); });
  });
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
  const [r, libro] = await Promise.all([GET(`/reportes/ventas?desde=${d}&hasta=${h}`), GET(`/reportes/formulas?desde=${d}&hasta=${h}`)]);
  el.innerHTML = html`<form id="fRep" class="row" style="margin-bottom:12px"><label style="margin:0">Desde<input type="date" name="desde" value="${d}"></label><label style="margin:0">Hasta<input type="date" name="hasta" value="${h}"></label><button class="btn primary" style="align-self:end">Ver</button></form>
  <div class="grid kpis"><div class="card kpi grn"><div class="l">Ventas</div><div class="n">${cop(r.total)}</div><div class="l">${r.ventas} tickets</div></div><div class="card kpi"><div class="l">Utilidad bruta</div><div class="n">${cop(r.utilidad)}</div></div><div class="card kpi"><div class="l">Descuentos</div><div class="n">${cop(r.descuentos)}</div></div><div class="card kpi"><div class="l">IVA</div><div class="n">${cop(r.iva)}</div></div></div>
  <div class="grid two" style="margin-top:14px"><div class="card tw"><h3>Más vendidos</h3><table><tbody>${r.top.map(t => html`<tr><td>${t.nombre}</td><td class="r">${t.unidades} u</td><td class="r">${cop(t.total)}</td></tr>`)}</tbody></table></div>
  <div class="card"><h3>Por medio de pago</h3><table><tbody>${r.por_medio.map(m => html`<tr><td>${m.medio_pago}</td><td class="r">${cop(m.total)}</td></tr>`)}</tbody></table></div></div>
  <div class="card tw" style="margin-top:14px"><div class="row sp"><h3>Libro de fórmulas dispensadas</h3><span><a class="btn sm" href="/api/reportes/formulas?desde=${d}&hasta=${h}&formato=csv">${ic('download')} CSV</a> <a class="btn sm" href="/api/reportes/formulas?desde=${d}&hasta=${h}&formato=csv&control=1">${ic('download')} CSV control especial</a></span></div>
  <table><thead><tr><th>Fecha</th><th>Fórmula</th><th>Paciente</th><th>Médico</th><th>Medicamentos</th><th>Despachó</th></tr></thead><tbody>${libro.map(f => html`<tr><td>${f.fecha.replace('T', ' ').slice(0, 16)}</td><td>${f.numero || ''} ${f.control ? html`<span class="badge red">Control</span>` : ''} ${f.estado !== 'ok' ? html`<span class="badge red">anulada</span>` : ''}</td><td>${f.paciente}<div class="mut">${f.documento_paciente || ''}</div></td><td>${f.medico}<div class="mut">RM ${f.registro_medico}</div></td><td>${f.medicamentos}</td><td>${f.despachado_por}</td></tr>`)}
  ${libro.length ? '' : html`<tr><td colspan="6" class="mut">Sin fórmulas en el período.</td></tr>`}</tbody></table></div>`.s;
  $('#fRep').onsubmit = e => { e.preventDefault(); const f = formData(e.target); el.dataset.desde = f.desde; el.dataset.hasta = f.hasta; V.reportes(el); };
};

/* ---------- Configuración ---------- */
V.config = async el => {
  const [c, us] = await Promise.all([GET('/config'), GET('/usuarios')]);
  const f = (k, l, extra = '') => html`<label>${l}<input name="${k}" value="${c[k]}" ${new Safe(extra)}></label>`;
  el.innerHTML = html`<div class="grid two"><div class="card"><h3>Negocio y alertas</h3><form id="fCfg">${f('nombre_negocio', 'Nombre del negocio')}
    ${f('alerta_destinos', 'Números de WhatsApp para alertas (separados por coma, con indicativo: 573001234567)')}${f('alerta_hora', 'Hora del resumen diario', 'type="time"')}
    ${f('dias_reposicion', 'Días que tarda en llegar un pedido', 'type="number" min="1"')}${f('dias_vence_critico', 'Vencimiento crítico (días)', 'type="number"')}${f('dias_vence_atencion', 'Vencimiento en atención (días)', 'type="number"')}
    ${f('ventana_rotacion', 'Días de historia para medir rotación', 'type="number" min="7"')}${f('descuento_max_pct', 'Descuento máximo (%)', 'type="number" max="100"')}
    <label class="chk"><input type="checkbox" name="promo_auto" ${c.promo_auto === '1' ? 'checked' : ''}> Aplicar automáticamente en el POS el descuento sugerido por vencimiento</label>
    <button class="btn primary">Guardar</button></form></div>
  <div class="card tw"><h3>Usuarios</h3><table><tbody>${us.map(u => html`<tr><td><b>${u.nombre}</b><div class="mut">${u.usuario}</div></td><td>${u.rol}</td><td>${u.activo ? '' : html`<span class="badge red">inactivo</span>`}</td><td class="r"><button class="btn sm" data-u="${u.id}">Editar</button></td></tr>`)}</tbody></table>
  <button class="btn primary" id="nu" style="margin-top:10px">+ Nuevo usuario</button></div></div>`.s;
  $('#fCfg').onsubmit = guard(async e => { e.preventDefault(); const d = formData(e.target); d.promo_auto = e.target.promo_auto.checked ? '1' : '0'; await PUT('/config', d); S.user.negocio = d.nombre_negocio; toast('Configuración guardada'); });
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
