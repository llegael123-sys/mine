'use strict';
// App de Herrajes: interfaz para el celular. Habla con server.js por /api.

const $app = document.getElementById('app');
const ROWS = 'ABCDEFGHI';
const APP_VERSION = '5';
const STATUS = { disponible: 'Disponible', en_curso: 'En curso', completada: 'Terminado', pendiente: 'Pendiente' };

let token = localStorage.getItem('token');
let data = null; // lo que devuelve /api/data
let pollTimer = null;
let brush = { productId: '', qty: 20 }; // pincel del editor de pallets
let draftItems = []; // productos del trabajo que se está creando: [{productId, qty}]

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const N = () => data?.grid || 3; // tamaño del pallet: N x N (3x3, como un tateti)
const cellName = (i) => `${ROWS[Math.floor(i / N())]}${(i % N()) + 1}`;
const product = (id) => data.products.find((p) => p.id === id);
const palletById = (id) => data.pallets.find((p) => p.id === id);
const userName = (id) => data.users.find((u) => u.id === id)?.name || '—';
const isAdmin = () => data?.me.role === 'admin';
const fmtDate = (iso) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function productLabel(p) {
  return p ? `${p.code} · ${p.name}${p.colorName ? ' · ' + p.colorName : ''}` : 'Producto borrado';
}

// Busca un producto por su código, sin importar mayúsculas o espacios ("bis-35 " encuentra "BIS-35").
function findByCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return c ? data.products.find((p) => p.code === c) : undefined;
}

const clientById = (id) => data.clients.find((c) => c.id === id);
const clientName = (t) => clientById(t.clientId)?.name || t.clientName || t.title || 'Sin cliente';
const byCode = (a, b) => a.code.localeCompare(b.code, 'es', { numeric: true });
// Quién tiene el trabajo, en una línea corta
function whoText(t) {
  if (t.status === 'disponible') return '🙋 Disponible para cualquiera';
  if (t.status === 'completada') return `✅ Lo hizo ${userName(t.assignedTo)}`;
  return `👷 Lo está haciendo ${userName(t.assignedTo)}`;
}
const myActive = () => data.tasks.filter((t) => t.assignedTo === data.me.id && t.status === 'en_curso');
const canTakeMore = () => myActive().length < (data.maxActive || 1);

function stockOf(productId) {
  let n = 0;
  for (const pal of data.pallets) for (const c of pal.cells) if (c.productId === productId) n += c.qty;
  return n;
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 2600);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { logout(true); throw new Error(json.error || 'Sesión vencida'); }
  if (!res.ok) throw new Error(json.error || 'Error de conexión');
  return json;
}

async function refresh() {
  data = await api('GET', '/api/data');
}

// Ejecuta una acción, muestra el error si falla, y vuelve a dibujar.
// Si fn devuelve {goTo: '#/...'}, navega ahí recién cuando los datos están actualizados.
async function act(fn, okMsg) {
  try {
    const r = await fn();
    await refresh();
    if (okMsg) toast(okMsg);
    if (r && r.goTo && location.hash !== r.goTo) return go(r.goTo); // hashchange dibuja
    render();
  } catch (e) {
    toast(e.message, true);
  }
}

function go(hash) { location.hash = hash; }

// ---------- layout ----------
function shell({ title, back, body, tab }) {
  const tabs = isAdmin()
    ? [['#/tareas', '📋', 'Trabajos'], ['#/clientes', '🏢', 'Clientes'], ['#/productos', '🔩', 'Productos'], ['#/pallets', '🟫', 'Pallets'], ['#/empleados', '👷', 'Empleados']]
    : [['#/tareas', '📋', 'Mis trabajos'], ['#/pallets', '🟫', 'Pallets'], ['#/cuenta', '👤', 'Cuenta']];
  $app.innerHTML = `
    <header class="topbar">
      ${back ? `<button class="back" onclick="go('${back}')" aria-label="Volver">‹</button>` : ''}
      <h1>${esc(title)}</h1>
      ${!back ? `<span class="who">${esc(data.me.name)}</span><button class="iconbtn" onclick="go('#/cuenta')" aria-label="Cuenta">⚙︎</button>` : ''}
    </header>
    <main>${body}</main>
    <nav class="tabs">${tabs.map(([h, i, l]) => `<a href="${h}" class="${tab === h ? 'on' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>`;
}

// Dibuja un pallet N x N (3x3). opts.take: Map(cellIndex -> cantidad a agarrar). opts.onCell: nombre de función global.
function palletGrid(pal, opts = {}) {
  const take = opts.take;
  const n = N();
  let html = `<div class="pallet ${take ? 'picking' : ''}" style="--n:${n}"><div></div>`;
  for (let c = 1; c <= n; c++) html += `<div class="lbl">${c}</div>`;
  pal.cells.forEach((cell, i) => {
    if (i % n === 0) html += `<div class="lbl">${ROWS[i / n]}</div>`;
    const p = cell.productId && product(cell.productId);
    const hl = take && take.has(i);
    const style = p ? `background:${p.color};color:${textOn(p.color)}` : '';
    const title = p ? `${cellName(i)}: ${productLabel(p)} (${cell.qty} u.)` : `${cellName(i)}: vacío`;
    const label = hl ? '' : opts.showQty && p ? `<span class="cname">${esc(p.colorName || p.name)}</span><span class="cqty">${cell.qty}</span>` : '';
    html += `<button class="cell ${p ? '' : 'empty'} ${hl ? 'hl' : ''}" style="${style}" title="${esc(title)}" aria-label="${esc(title)}"
      ${hl ? `data-take="${take.get(i)} u."` : ''} ${opts.onCell ? `onclick="${opts.onCell}('${pal.id}', ${i})"` : ''}>${label}</button>`;
  });
  return html + '</div>';
}

function palletLegend(pal) {
  const totals = new Map();
  for (const c of pal.cells) if (c.productId) totals.set(c.productId, (totals.get(c.productId) || 0) + c.qty);
  if (!totals.size) return '<p class="muted center">Pallet vacío</p>';
  return `<div class="legend">${[...totals].map(([id, q]) => {
    const p = product(id);
    return `<div><span class="swatch" style="background:${p.color}"></span>${esc(productLabel(p))}: <b>${q}</b></div>`;
  }).join('')}</div>`;
}

// ---------- pantallas ----------
function viewLogin() {
  $app.innerHTML = `
    <div class="login">
      <img src="icon.svg" class="logo" alt="">
      <h1>Herrajes</h1>
      <p class="muted center">Ingresá con tu usuario</p>
      <form id="f" class="card">
        <label class="field"><span>Usuario</span><input name="username" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn block big">Entrar</button>
      </form>
      <div id="phone"></div>
      <p class="muted small center">Versión ${APP_VERSION}</p>
    </div>`;
  if (onThisComputer()) phoneCard();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      token = r.token;
      localStorage.setItem('token', token);
      await refresh();
      startPolling();
      go('#/tareas');
      render();
    } catch (err) { toast(err.message, true); }
  };
}

function viewTasks() {
  if (!isAdmin()) return viewWorkerTasks();
  const filter = sessionStorage.getItem('taskFilter') || 'activas';
  let tasks = data.tasks;
  if (filter === 'activas') tasks = tasks.filter((t) => t.status !== 'completada');
  if (filter === 'completadas') tasks = tasks.filter((t) => t.status === 'completada');

  const chips = [['activas', 'Activos'], ['completadas', 'Terminados'], ['todas', 'Todos']]
    .map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" onclick="sessionStorage.setItem('taskFilter','${k}');render()">${l}</button>`).join('');

  shell({
    title: 'Trabajos',
    tab: '#/tareas',
    body: `
      <a class="btn block" href="#/nueva-tarea" style="margin-bottom:12px">＋ Nuevo trabajo para un cliente</a>
      <div class="chips">${chips}</div>
      <div class="card">${tasks.map((t) => taskRow(t)).join('') || '<div class="empty"><div class="ico">✅</div>No hay trabajos acá.</div>'}</div>`,
  });
}

function taskRow(t, { takeButton = false } = {}) {
  const done = t.items.filter((i) => i.picked).length;
  const pct = t.items.length ? Math.round((done / t.items.length) * 100) : 0;
  return `<div class="list-item" onclick="go('#/tarea/${t.id}')">
    <div class="grow">
      <div class="row"><span class="title grow">🏢 ${esc(clientName(t))}</span><span class="badge ${t.status}">${STATUS[t.status]}</span></div>
      <div class="muted small">${t.title ? esc(t.title) + ' · ' : ''}${t.items.length} producto(s) · ${fmtDate(t.createdAt)}</div>
      ${isAdmin() ? `<div class="small">${esc(whoText(t))}</div>` : ''}
      ${t.status === 'en_curso' ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
    </div>
    ${takeButton ? `<button class="btn ok small" ${canTakeMore() ? '' : 'disabled'} onclick="event.stopPropagation();acceptTask('${t.id}')">✋ Tomar</button>` : '<span class="chev">›</span>'}
  </div>`;
}

// Empleado: arriba su trabajo actual; abajo los disponibles para tomar.
function viewWorkerTasks() {
  const filter = sessionStorage.getItem('taskFilterEmp') || 'disponibles';
  const mine = myActive();
  const available = data.tasks.filter((t) => t.status === 'disponible');
  const done = data.tasks.filter((t) => t.assignedTo === data.me.id && t.status === 'completada');

  const current = mine.map((t) => {
    const picked = t.items.filter((i) => i.picked).length;
    return `<div class="card current" onclick="go('#/tarea/${t.id}')">
      <div class="muted small" style="font-weight:700;color:var(--ok)">🟢 TU TRABAJO</div>
      <div class="client-name">🏢 ${esc(clientName(t))}</div>
      <div class="muted small">${t.title ? esc(t.title) + ' · ' : ''}${picked} de ${t.items.length} productos agarrados</div>
      <div class="progress"><div style="width:${t.items.length ? Math.round((picked / t.items.length) * 100) : 0}%"></div></div>
      <button class="btn ok block" style="margin-top:10px">Seguir armando ›</button>
    </div>`;
  }).join('');

  const chips = [['disponibles', `Disponibles (${available.length})`], ['terminados', `Mis terminados (${done.length})`]]
    .map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" onclick="sessionStorage.setItem('taskFilterEmp','${k}');render()">${l}</button>`).join('');

  const list = filter === 'disponibles'
    ? `${!canTakeMore() && available.length ? '<p class="muted small" style="margin:0 0 8px">Terminá tu trabajo para poder tomar otro.</p>' : ''}
       ${available.map((t) => taskRow(t, { takeButton: true })).join('')
         || '<div class="empty"><div class="ico">☕</div>No hay trabajos disponibles ahora.<br>Cuando el encargado cargue uno, te va a aparecer acá.</div>'}`
    : done.map((t) => taskRow(t)).join('') || '<div class="empty">Todavía no terminaste trabajos.</div>';

  shell({
    title: 'Trabajos',
    tab: '#/tareas',
    body: `${current}<div class="chips">${chips}</div><div class="card">${list}</div>`,
  });
}

// Pantalla del trabajo: de qué cliente es, quién lo hace, y sus productos.
function viewTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) {
    toast('Ese trabajo ya no está disponible (lo tomó otro empleado o se borró)', true);
    return go('#/tareas');
  }
  const c = clientById(t.clientId);
  const mine = t.assignedTo === data.me.id;
  const canWork = t.status !== 'disponible' && (mine || isAdmin());
  const allPicked = t.items.every((i) => i.picked);
  const pending = t.items.filter((i) => !i.picked).length;

  const header = `
    <div class="card">
      <div class="row"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="grow"></span><span class="muted small">${fmtDate(t.createdAt)}</span></div>
      <div class="client-box">
        <div class="client-name">🏢 ${esc(clientName(t))}</div>
        ${t.title ? `<div class="muted">${esc(t.title)}</div>` : ''}
        ${c?.phone ? `<div class="small">📞 <a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">${esc(c.phone)}</a></div>` : ''}
        ${c?.address ? `<div class="small">🏠 ${esc(c.address)}</div>` : ''}
      </div>
      <div class="small">${esc(mine && t.status === 'en_curso' ? '👷 Lo estás haciendo vos' : whoText(t))}</div>
      ${t.notes ? `<p style="margin:10px 0 0;white-space:pre-wrap">📝 ${esc(t.notes)}</p>` : ''}
      ${canWork && t.status === 'en_curso' ? `<p class="muted small" style="margin:10px 0 0">${pending ? `Faltan <b>${pending}</b> de ${t.items.length} productos` : 'Agarraste todos los productos ✔'}</p>` : ''}
    </div>`;

  let body;
  if (t.status === 'disponible') {
    // Todavía no es de nadie: se muestra qué lleva, y el botón para tomarlo
    body = `
      <div class="card"><h2>Productos (${t.items.length})</h2>${t.items.map(itemSummary).join('')}</div>
      ${isAdmin()
        ? '<p class="muted center">Esperando que un empleado lo tome.</p>'
        : `<button class="btn ok block big" ${canTakeMore() ? '' : 'disabled'} onclick="acceptTask('${t.id}')">✋ Tomar este trabajo</button>
           ${canTakeMore() ? '<p class="muted small center">Cuando lo tomás, desaparece de la lista de los demás.</p>' : '<p class="muted small center">Primero terminá el trabajo que ya tomaste.</p>'}`}`;
  } else {
    body = `
      ${t.items.map((it, idx) => itemCard(t, it, idx, canWork)).join('')}
      ${t.status !== 'completada' && canWork ? `<button class="btn ok block big" ${allPicked ? '' : 'disabled'} onclick="completeTask('${t.id}')">✔ Marcar trabajo como terminado</button>
        ${!allPicked ? '<p class="muted small center">Se habilita cuando agarres todos los productos.</p>' : ''}` : ''}
      ${t.status === 'completada' ? `<p class="center muted">Terminado ${t.completedAt ? fmtDate(t.completedAt) : ''}</p>` : ''}
      ${t.status === 'en_curso' && mine && !isAdmin() && !t.items.some((i) => i.picked)
        ? `<button class="btn secondary block" style="margin-top:14px" onclick="releaseTask('${t.id}')">Dejar este trabajo (vuelve a disponibles)</button>` : ''}
      ${t.status === 'en_curso' && isAdmin()
        ? `<button class="btn secondary block" style="margin-top:14px" onclick="releaseTask('${t.id}')">Liberar trabajo (vuelve a disponibles)</button>` : ''}`;
  }

  shell({
    title: clientName(t),
    back: '#/tareas',
    tab: '#/tareas',
    body: `${header}${body}
      ${isAdmin() ? `<button class="btn danger block" style="margin-top:20px" onclick="deleteTask('${t.id}')">Borrar trabajo</button>` : ''}`,
  });
}

// Renglón compacto de un producto (para ver un trabajo antes de tomarlo)
function itemSummary(it) {
  const p = product(it.productId) || { code: '¿?', name: 'Producto borrado', color: '#ccc', colorName: '' };
  const lacking = it.plan && !it.plan.enough;
  return `<div class="list-item">
    <span class="swatch lg" style="background:${p.color}"></span>
    <div class="grow"><span class="code">${esc(p.code)}</span>
      <div class="title">${esc(p.name)}</div>
      <div class="muted small">${esc(p.colorName || '')}${lacking ? ' · <b style="color:var(--bad)">⚠ falta stock</b>' : ''}</div></div>
    <div class="center"><div style="font-size:24px;font-weight:800">${it.qty}</div><div class="muted small">u.</div></div>
  </div>`;
}

function itemCard(t, it, idx, canWork = true) {
  const p = product(it.productId) || { code: '¿?', name: 'Producto borrado', color: '#ccc', colorName: '' };
  const head = `
    <div class="pick-target">
      <span class="swatch lg" style="background:${p.color}"></span>
      <div class="grow"><div class="code big">${esc(p.code)}</div>
        <div class="title" style="font-weight:700">${esc(p.name)}</div>
        <div class="muted small">Color: <b>${esc(p.colorName || '—')}</b></div></div>
      <div class="center"><div class="pick-qty">${it.qty}</div><div class="muted small">unidades</div></div>
    </div>`;

  if (it.picked) {
    const from = it.picks.map((pk) => `${esc(palletById(pk.palletId)?.name || 'Pallet')} ${cellName(pk.cell)} (${pk.qty})`).join(', ');
    return `<div class="card item done">${head}<p class="small" style="margin:8px 0 0;color:var(--ok);font-weight:600">✅ Agarrado de ${from}</p></div>`;
  }

  const plan = it.plan;
  if (!plan || !plan.enough) {
    return `<div class="card item">${head}
      <p style="color:var(--bad);font-weight:600;margin-bottom:0">⚠ No hay stock suficiente: hay ${plan ? plan.available : 0} y se piden ${it.qty}. Avisale al encargado.</p></div>`;
  }

  // Un bloque por pallet: dónde está en el galpón, qué casilleros, y el pallet resaltado
  const byPallet = new Map();
  for (const pk of plan.picks) {
    if (!byPallet.has(pk.palletId)) byPallet.set(pk.palletId, new Map());
    byPallet.get(pk.palletId).set(pk.cell, pk.qty);
  }
  const blocks = [...byPallet].map(([pid, take]) => {
    const pal = palletById(pid);
    const cells = [...take].map(([c, q]) => `<span class="pos">${cellName(c)}</span> <b>${q} u.</b>`).join('&nbsp;&nbsp; ');
    return `
      <div class="where-box">
        <div>📍 <b>${esc(pal.location || 'Ubicación sin cargar')}</b></div>
        <div class="muted small">${esc(pal.name)} · casillero: ${cells}</div>
      </div>
      <div class="pallet-wrap">${palletGrid(pal, { take })}</div>`;
  }).join('');

  return `<div class="card item">${head}${blocks}
    ${canWork ? `<button class="btn ok block big" style="margin-top:12px" ${t.status === 'completada' ? 'disabled' : ''} onclick="confirmPick('${t.id}', ${idx})">✔ Ya lo agarré</button>` : ''}</div>`;
}

function viewNewTask() {
  if (!isAdmin()) return go('#/tareas');
  const saved = JSON.parse(sessionStorage.getItem('draftForm') || '{}');
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const codes = [...data.products].sort(byCode)
    .map((p) => `<option value="${esc(p.code)}">${esc(p.name)}${p.colorName ? ' · ' + esc(p.colorName) : ''}</option>`).join('');
  const rows = draftItems.map((it, i) => {
    const p = product(it.productId);
    return `<div class="list-item">
      <span class="swatch" style="background:${p.color}"></span>
      <div class="grow"><div><span class="code">${esc(p.code)}</span> <b>${esc(p.name)}</b></div>
        <div class="muted small">${esc(p.colorName || '')} · stock ${stockOf(p.id)}</div></div>
      <input type="number" min="1" inputmode="numeric" value="${it.qty}" style="width:72px" onchange="draftItems[${i}].qty=Number(this.value)" aria-label="Cantidad">
      <button class="btn danger small" onclick="removeDraftItem(${i})" aria-label="Quitar">✕</button>
    </div>`;
  }).join('');

  shell({
    title: 'Nuevo trabajo',
    back: '#/tareas',
    tab: '#/tareas',
    body: `
      <form id="f" class="card" onsubmit="return false">
        <div class="field"><span>Cliente</span>
          <div class="row">
            <select name="clientId" class="grow"><option value="">Elegí un cliente…</option>${clients}</select>
            <button type="button" class="btn secondary small" onclick="newClientFromTask()">＋ Nuevo</button>
          </div>
        </div>
        <label class="field"><span>Referencia (opcional)</span><input name="title" placeholder="Ej: Pedido Nº 1002" value="${esc(saved.title || '')}"></label>
        <label class="field"><span>Indicaciones (opcional)</span><textarea name="notes" placeholder="Ej: dejar en la mesa de despacho">${esc(saved.notes || '')}</textarea></label>
      </form>
      <div class="card">
        <h2>Productos</h2>
        ${rows || '<p class="muted" style="margin-top:0">Escribí el código de cada producto y la cantidad.</p>'}
        <div class="row" style="margin-top:10px">
          <input id="code" class="grow" list="codes" placeholder="Código (ej: BIS-35)" autocapitalize="characters" autocomplete="off" oninput="previewCode()"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addDraftItem()}" aria-label="Código del producto">
          <input id="qty" type="number" min="1" inputmode="numeric" value="5" style="width:72px" aria-label="Cantidad"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addDraftItem()}">
        </div>
        <div id="codePreview" class="small" style="min-height:22px;margin:6px 0"></div>
        <button class="btn secondary block" onclick="addDraftItem()">＋ Agregar producto</button>
        <datalist id="codes">${codes}</datalist>
      </div>
      <button class="btn block big" onclick="createTask()">📢 Publicar trabajo</button>
      <p class="muted small center">Les aparece a todos los empleados y lo hace el primero que lo tome.</p>`,
  });
  if (saved.clientId) document.getElementById('f').clientId.value = saved.clientId;
}

function viewPallets(selectedId) {
  const pal = data.pallets.find((p) => p.id === selectedId) || data.pallets[0];
  const chips = data.pallets.map((p) => `<button class="chip ${p === pal ? 'on' : ''}" onclick="go('#/pallets/${p.id}')">${esc(p.name)}</button>`).join('');
  const admin = isAdmin();

  let editor = '';
  if (admin && pal) {
    const opts = data.products.map((p) => `<option value="${p.id}" ${brush.productId === p.id ? 'selected' : ''}>${esc(productLabel(p))}</option>`).join('');
    const bp = product(brush.productId);
    editor = `
      <div class="card">
        <h2>Cargar casilleros</h2>
        <p class="muted small" style="margin-top:0">Elegí producto y cantidad, después tocá los casilleros del pallet para llenarlos.</p>
        <div class="row">
          <span class="swatch" style="background:${bp ? bp.color : 'repeating-linear-gradient(45deg,#78350f 0 4px,#92400e 4px 8px)'}"></span>
          <select class="grow" onchange="brush.productId=this.value;render()"><option value="">🧹 Vaciar casillero</option>${opts}</select>
          <input type="number" min="0" inputmode="numeric" value="${brush.qty}" style="width:80px" ${brush.productId ? '' : 'disabled'} onchange="brush.qty=Number(this.value)" aria-label="Cantidad por casillero">
        </div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn secondary small" onclick="fillPallet('${pal.id}')">Llenar todo el pallet</button>
          <button class="btn secondary small" onclick="editPallet('${pal.id}')">Nombre y ubicación</button>
          <button class="btn danger small" onclick="deletePallet('${pal.id}')">Borrar pallet</button>
        </div>
      </div>`;
  }

  shell({
    title: 'Pallets',
    tab: '#/pallets',
    body: `
      <div class="chips">${chips}${admin ? `<button class="chip" onclick="editPallet()">＋ Nuevo</button>` : ''}</div>
      ${pal ? `<div class="card"><h2>${esc(pal.name)} <span class="muted small">(${N()}×${N()})</span></h2>
        <p class="muted" style="margin:-4px 0 10px">📍 ${esc(pal.location || 'Sin ubicación en el galpón')}</p>
        <div class="pallet-wrap">${palletGrid(pal, { showQty: true, onCell: admin ? 'paintCell' : 'showCell' })}</div>
        ${palletLegend(pal)}</div>${editor}`
        : `<div class="card empty"><div class="ico">🟫</div>No hay pallets cargados.</div>`}`,
  });
}

function viewProducts() {
  if (!isAdmin()) return go('#/tareas');
  const list = [...data.products].sort(byCode).map((p) => `
    <div class="list-item prod" data-search="${esc((p.code + ' ' + p.name + ' ' + p.colorName).toLowerCase())}" onclick="editProduct('${p.id}')">
      <span class="swatch lg" style="background:${p.color}"></span>
      <div class="grow"><div class="code">${esc(p.code)}</div><div class="title">${esc(p.name)}</div><div class="muted small">${esc(p.colorName || 'Sin color')}</div></div>
      <div class="center"><div style="font-weight:800">${stockOf(p.id)}</div><div class="muted small">stock</div></div>
    </div>`).join('');
  shell({
    title: 'Productos',
    tab: '#/productos',
    body: `
      <button class="btn block" style="margin-bottom:12px" onclick="editProduct()">＋ Nuevo producto</button>
      <input type="search" placeholder="🔍 Buscar por código o nombre" oninput="filterList(this.value, '.prod')" style="margin-bottom:12px">
      <div class="card">${list || '<div class="empty">Todavía no cargaste productos.</div>'}</div>
      <p class="muted small center">Cada producto tiene un código único. Si el mismo producto viene en varios colores, cada color lleva su propio código. El stock es la suma de sus casilleros en los pallets.</p>`,
  });
}

// Filtra una lista en pantalla sin volver a dibujarla (así no se cierra el teclado).
function filterList(q, selector) {
  const words = q.toLowerCase().trim().split(/\s+/);
  document.querySelectorAll(selector).forEach((el) => {
    el.style.display = words.every((w) => el.dataset.search.includes(w)) ? '' : 'none';
  });
}

// ---------- clientes ----------
function viewClients() {
  if (!isAdmin()) return go('#/tareas');
  const list = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((c) => {
    const mine = data.tasks.filter((t) => t.clientId === c.id);
    const active = mine.filter((t) => t.status !== 'completada').length;
    return `<div class="list-item cli" data-search="${esc((c.name + ' ' + c.phone + ' ' + c.address).toLowerCase())}" onclick="editClient('${c.id}')">
      <span class="swatch lg" style="background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:22px">🏢</span>
      <div class="grow"><div class="title">${esc(c.name)}</div><div class="muted small">${esc([c.phone, c.address].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</div></div>
      <div class="center"><div style="font-weight:800">${active}</div><div class="muted small">activos</div></div>
    </div>`;
  }).join('');
  shell({
    title: 'Clientes',
    tab: '#/clientes',
    body: `
      <button class="btn block" style="margin-bottom:12px" onclick="editClient()">＋ Nuevo cliente</button>
      <input type="search" placeholder="🔍 Buscar cliente" oninput="filterList(this.value, '.cli')" style="margin-bottom:12px">
      <div class="card">${list || '<div class="empty"><div class="ico">🏢</div>Todavía no cargaste clientes.</div>'}</div>`,
  });
}

function viewEmployees() {
  if (!isAdmin()) return go('#/tareas');
  const list = data.users.map((u) => {
    const active = data.tasks.filter((t) => t.assignedTo === u.id && t.status === 'en_curso').length;
    return `<div class="list-item" onclick="editUser('${u.id}')">
      <span class="swatch lg center" style="background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:22px">${u.role === 'admin' ? '🧑‍💼' : '👷'}</span>
      <div class="grow"><div class="title">${esc(u.name)} ${u.role === 'admin' ? '<span class="badge admin">admin</span>' : ''}</div><div class="muted small">usuario: ${esc(u.username)}</div></div>
      <div class="center"><div style="font-weight:800">${active}</div><div class="muted small">en curso</div></div>
    </div>`;
  }).join('');
  shell({
    title: 'Empleados',
    tab: '#/empleados',
    body: `
      <button class="btn block" style="margin-bottom:12px" onclick="editUser()">＋ Nueva cuenta de empleado</button>
      <div class="card">${list}</div>`,
  });
}

function viewAccount() {
  shell({
    title: 'Mi cuenta',
    back: isAdmin() ? '#/tareas' : null,
    tab: '#/cuenta',
    body: `
      <div class="card"><div class="title" style="font-weight:700">${esc(data.me.name)}</div><div class="muted">usuario: ${esc(data.me.username)} · ${data.me.role}</div></div>
      <form class="card" id="pw">
        <h2>Cambiar contraseña</h2>
        <label class="field"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>Nueva contraseña</span><input type="password" name="next" autocomplete="new-password" minlength="4" required></label>
        <button class="btn block">Guardar</button>
      </form>
      <div id="phone"></div>
      <button class="btn secondary block" onclick="logout()">Cerrar sesión</button>
      <p class="muted small center">Versión ${APP_VERSION}</p>`,
  });
  phoneCard();
  document.getElementById('pw').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(() => api('POST', '/api/me/password', { current: f.get('current'), next: f.get('next') }), 'Contraseña cambiada');
  };
}

// ---------- entrar desde el celular ----------
const onThisComputer = () => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);

// Muestra la dirección para el celular y un QR para escanear con la cámara.
async function phoneCard() {
  let urls = [];
  try { urls = (await (await fetch('/api/info')).json()).urls || []; } catch { /* sin conexión */ }
  const el = document.getElementById('phone');
  if (!el) return;
  // Si ya estamos en un celular, la dirección que funciona es la que está usando.
  if (!onThisComputer()) urls = [location.origin, ...urls.filter((u) => u !== location.origin)];
  if (!urls.length) {
    el.innerHTML = `<div class="card"><h2>📱 Entrar desde el celular</h2>
      <p class="muted" style="margin:0">Esta compu no está conectada a ninguna red. Conectala al WiFi y volvé a abrir la app.</p></div>`;
    return;
  }
  const [main, ...others] = urls;
  el.innerHTML = `
    <div class="card center phone-card">
      <h2>📱 ${onThisComputer() ? 'Entrar desde el celular' : 'Para que otro entre desde su celular'}</h2>
      <p class="muted small" style="margin-top:0">El celular tiene que estar conectado <b>al mismo WiFi</b> que la compu.</p>
      <div class="qr">${QR.svg(main)}</div>
      <p class="small" style="margin-bottom:4px">Apuntá la <b>cámara del celular</b> al código y tocá el link que aparece.<br>O escribí esto en Chrome:</p>
      <div class="url">${esc(main)}</div>
      ${others.length ? `<p class="muted small">Si no abre, probá con: ${others.map(esc).join(' · ')}</p>` : ''}
    </div>`;
}

// ---------- modales ----------
function modal(html) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };
  document.body.appendChild(bg);
  return bg.querySelector('.modal');
}
function closeModal() { document.querySelector('.modal-bg')?.remove(); }

function editProduct(id) {
  const p = id ? product(id) : { name: '', code: '', colorName: '', color: '#9ca3af' };
  const m = modal(`
    <h2>${id ? 'Editar producto' : 'Nuevo producto'}</h2>
    <form id="pf">
      <label class="field"><span>Código (único, es como se pide el producto)</span><input name="code" value="${esc(p.code)}" placeholder="Ej: BIS-35" autocapitalize="characters" autocomplete="off" required style="text-transform:uppercase;font-weight:700"></label>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(p.name)}" placeholder="Ej: Bisagra cazoleta 35mm" required></label>
      <div class="row">
        <label class="field grow"><span>Nombre del color</span><input name="colorName" value="${esc(p.colorName)}" placeholder="Ej: Negro"></label>
        <label class="field" style="width:90px"><span>Color</span><input type="color" name="color" value="${p.color}"></label>
      </div>
      <button class="btn block">Guardar</button>
      ${id ? `<button type="button" class="btn danger block" style="margin-top:10px" id="del">Borrar producto</button>` : ''}
    </form>`);
  m.querySelector('#pf').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    closeModal();
    act(() => (id ? api('PUT', '/api/products/' + id, body) : api('POST', '/api/products', body)), 'Producto guardado');
  };
  m.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm('¿Borrar este producto? También se vacían sus casilleros.')) return;
    closeModal();
    act(() => api('DELETE', '/api/products/' + id), 'Producto borrado');
  });
}

function editUser(id) {
  const u = id ? data.users.find((x) => x.id === id) : null;
  const m = modal(`
    <h2>${u ? 'Editar cuenta' : 'Nueva cuenta'}</h2>
    <form id="uf">
      <label class="field"><span>Nombre y apellido</span><input name="name" value="${esc(u?.name || '')}" required></label>
      ${u ? `<p class="muted">Usuario: <b>${esc(u.username)}</b></p>` : `
        <label class="field"><span>Usuario (para entrar)</span><input name="username" autocapitalize="none" placeholder="Ej: juan" required></label>
        <label class="field"><span>Rol</span><select name="role"><option value="empleado">Empleado</option><option value="admin">Administrador</option></select></label>`}
      <label class="field"><span>${u ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña'}</span><input name="password" type="text" autocomplete="off" ${u ? '' : 'required'} minlength="4"></label>
      <button class="btn block">Guardar</button>
      ${u && u.id !== data.me.id ? `<button type="button" class="btn danger block" style="margin-top:10px" id="del">Borrar cuenta</button>` : ''}
    </form>`);
  m.querySelector('#uf').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    closeModal();
    act(() => (u ? api('PUT', '/api/users/' + id, body) : api('POST', '/api/users', body)), 'Cuenta guardada');
  };
  m.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm(`¿Borrar la cuenta de ${u.name}?`)) return;
    closeModal();
    act(() => api('DELETE', '/api/users/' + id), 'Cuenta borrada');
  });
}

// Crear o editar un cliente. onCreated(cliente) se llama al crear uno nuevo.
function editClient(id, onCreated) {
  const c = id ? clientById(id) : { name: '', phone: '', address: '' };
  const jobs = id ? data.tasks.filter((t) => t.clientId === id) : [];
  const m = modal(`
    <h2>${id ? 'Cliente' : 'Nuevo cliente'}</h2>
    <form id="cf">
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c.name)}" placeholder="Ej: Carpintería López" required></label>
      <label class="field"><span>Teléfono (opcional)</span><input name="phone" type="tel" value="${esc(c.phone)}"></label>
      <label class="field"><span>Dirección (opcional)</span><input name="address" value="${esc(c.address)}"></label>
      <button class="btn block">Guardar</button>
    </form>
    ${id ? `<h2 style="margin-top:18px">Trabajos de este cliente</h2>
      ${jobs.map((t) => `<a class="list-item" href="#/tarea/${t.id}"><div class="grow"><b>${esc(t.title || 'Trabajo')}</b>
        <div class="muted small">${esc(whoText(t))} · ${t.items.length} producto(s) · ${fmtDate(t.createdAt)}</div></div>
        <span class="badge ${t.status}">${STATUS[t.status]}</span></a>`).join('') || '<p class="muted">Todavía no tiene trabajos.</p>'}
      <button type="button" class="btn danger block" style="margin-top:14px" id="del">Borrar cliente</button>` : ''}`);
  m.querySelector('#cf').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    closeModal();
    act(async () => {
      if (id) return void (await api('PUT', '/api/clients/' + id, body));
      const created = await api('POST', '/api/clients', body);
      if (onCreated) onCreated(created);
    }, 'Cliente guardado');
  };
  m.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm(`¿Borrar el cliente ${c.name}?`)) return;
    closeModal();
    act(() => api('DELETE', '/api/clients/' + id), 'Cliente borrado');
  });
}

function showCell(palletId, i) {
  const cell = data.pallets.find((p) => p.id === palletId).cells[i];
  const p = cell.productId && product(cell.productId);
  toast(p ? `${cellName(i)}: ${productLabel(p)} — ${cell.qty} u.` : `${cellName(i)}: vacío`);
}

// ---------- acciones ----------
function saveDraftForm() {
  const f = document.getElementById('f');
  if (f) sessionStorage.setItem('draftForm', JSON.stringify(Object.fromEntries(new FormData(f))));
}

// Muestra abajo del campo a qué producto corresponde el código que se está escribiendo.
function previewCode() {
  const el = document.getElementById('codePreview');
  const code = document.getElementById('code').value;
  const p = findByCode(code);
  if (!code.trim()) el.innerHTML = '';
  else if (p) el.innerHTML = `<span class="swatch" style="background:${p.color};width:14px;height:14px;display:inline-block;vertical-align:middle"></span> <b>${esc(p.name)}</b> · ${esc(p.colorName || '')} · stock ${stockOf(p.id)}`;
  else el.innerHTML = '<span style="color:var(--bad)">No existe ningún producto con ese código</span>';
}

function addDraftItem() {
  const code = document.getElementById('code').value;
  const qty = Number(document.getElementById('qty').value);
  const p = findByCode(code);
  if (!p) return toast(code.trim() ? `No existe el código ${code.trim().toUpperCase()}` : 'Escribí el código del producto', true);
  if (!(qty > 0)) return toast('Poné una cantidad', true);
  saveDraftForm();
  const existing = draftItems.find((i) => i.productId === p.id);
  if (existing) existing.qty += qty;
  else draftItems.push({ productId: p.id, qty });
  render();
  document.getElementById('code').focus();
}

function removeDraftItem(i) {
  saveDraftForm();
  draftItems.splice(i, 1);
  render();
}

function newClientFromTask() {
  saveDraftForm();
  editClient(null, (c) => {
    const saved = JSON.parse(sessionStorage.getItem('draftForm') || '{}');
    sessionStorage.setItem('draftForm', JSON.stringify({ ...saved, clientId: c.id }));
  });
}

function createTask() {
  const body = Object.fromEntries(new FormData(document.getElementById('f')));
  if (!body.clientId) return toast('Elegí de qué cliente es el trabajo', true);
  if (!draftItems.length) return toast('Agregá al menos un producto', true);
  body.items = draftItems.map((i) => ({ code: product(i.productId).code, qty: i.qty }));
  act(async () => {
    const t = await api('POST', '/api/tasks', body);
    draftItems = [];
    sessionStorage.removeItem('draftForm');
    return { goTo: '#/tarea/' + t.id };
  }, 'Trabajo publicado: ya les aparece a los empleados');
}

// Tomar un trabajo. Si otro lo tomó antes, avisa y actualiza la lista.
async function acceptTask(id) {
  try {
    await api('POST', `/api/tasks/${id}/accept`);
    await refresh();
    toast('✋ ¡Trabajo tomado! Ahora es tuyo');
    if (location.hash !== '#/tarea/' + id) go('#/tarea/' + id); else render();
  } catch (e) {
    toast(e.message, true);
    try { await refresh(); } catch { /* sin conexión */ }
    render();
  }
}

function releaseTask(id) {
  const msg = isAdmin() ? '¿Liberar este trabajo? Vuelve a aparecerles a todos los empleados.' : '¿Dejar este trabajo? Vuelve a aparecerles a todos.';
  if (!confirm(msg)) return;
  act(async () => { await api('POST', `/api/tasks/${id}/release`); return { goTo: isAdmin() ? '#/tarea/' + id : '#/tareas' }; }, 'Trabajo liberado');
}

function deleteTask(id) {
  if (!confirm('¿Borrar este trabajo? (el stock ya descontado no vuelve)')) return;
  act(async () => { await api('DELETE', '/api/tasks/' + id); return { goTo: '#/tareas' }; }, 'Trabajo borrado');
}

function confirmPick(taskId, idx) {
  act(() => api('POST', `/api/tasks/${taskId}/items/${idx}/pick`), '¡Listo! Stock descontado');
}

function completeTask(id) {
  act(() => api('POST', `/api/tasks/${id}/complete`), '¡Trabajo terminado! 🎉');
}

function paintCell(palletId, i) {
  const cell = brush.productId ? { index: i, productId: brush.productId, qty: brush.qty } : { index: i, productId: null, qty: 0 };
  act(() => api('PUT', '/api/pallets/' + palletId, { cells: [cell] }));
}

function fillPallet(palletId) {
  const msg = brush.productId ? `¿Llenar los ${N() * N()} casilleros con ${productLabel(product(brush.productId))} (${brush.qty} c/u)?` : '¿Vaciar todo el pallet?';
  if (!confirm(msg)) return;
  const cells = Array.from({ length: N() * N() }, (_, index) => ({ index, productId: brush.productId || null, qty: brush.qty }));
  act(() => api('PUT', '/api/pallets/' + palletId, { cells }), 'Pallet actualizado');
}

// Crear o editar un pallet: nombre y dónde está en el galpón.
function editPallet(id) {
  const pal = id ? palletById(id) : { name: `Pallet ${String.fromCharCode(65 + data.pallets.length)}`, location: '' };
  const m = modal(`
    <h2>${id ? 'Editar pallet' : 'Nuevo pallet'}</h2>
    <form id="palf">
      <label class="field"><span>Nombre</span><input name="name" value="${esc(pal.name)}" required></label>
      <label class="field"><span>¿Dónde está en el galpón?</span><input name="location" value="${esc(pal.location || '')}" placeholder="Ej: Pasillo 2, a la derecha, al fondo"></label>
      <button class="btn block">Guardar</button>
    </form>`);
  m.querySelector('#palf').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    closeModal();
    act(async () => {
      if (id) return void (await api('PUT', '/api/pallets/' + id, body));
      const p = await api('POST', '/api/pallets', body);
      return { goTo: '#/pallets/' + p.id };
    }, 'Pallet guardado');
  };
}

function deletePallet(id) {
  if (!confirm('¿Borrar este pallet y todo su stock?')) return;
  act(async () => { await api('DELETE', '/api/pallets/' + id); return { goTo: '#/pallets' }; }, 'Pallet borrado');
}

function logout(silent) {
  if (!silent && token) api('POST', '/api/logout').catch(() => {});
  token = null;
  data = null;
  localStorage.removeItem('token');
  clearInterval(pollTimer);
  closeModal();
  document.getElementById('toast').className = '';
  viewLogin();
}

// Actualiza los datos cada 5 s para ver trabajos nuevos (y los que tomaron otros), sin molestar si estás escribiendo.
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!token || document.hidden || document.querySelector('.modal-bg')) return;
    const h = location.hash;
    if (h.startsWith('#/nueva-tarea') || h.startsWith('#/cuenta')) return;
    const before = JSON.stringify(data);
    const known = new Set(data.tasks.map((t) => t.id));
    try { await refresh(); } catch { return; }
    // Aviso cuando le llega un pedido nuevo al empleado
    const nuevas = isAdmin() ? [] : data.tasks.filter((t) => !known.has(t.id) && t.status === 'disponible');
    if (nuevas.length) {
      toast(nuevas.length === 1 ? `📦 Hay un trabajo nuevo: ${clientName(nuevas[0])}` : `📦 Hay ${nuevas.length} trabajos nuevos`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    if (JSON.stringify(data) !== before) render();
  }, 5000);
}

// ---------- router ----------
function render() {
  if (!token || !data) return viewLogin();
  const parts = (location.hash || '#/tareas').slice(2).split('/');
  closeModal();
  switch (parts[0]) {
    case 'tarea': return viewTask(parts[1]);
    case 'nueva-tarea': return viewNewTask();
    case 'pallets': return viewPallets(parts[1]);
    case 'productos': return viewProducts();
    case 'clientes': return viewClients();
    case 'empleados': return viewEmployees();
    case 'cuenta': return viewAccount();
    default: return viewTasks();
  }
}

window.addEventListener('hashchange', () => {
  if (location.hash !== '#/nueva-tarea') { draftItems = []; sessionStorage.removeItem('draftForm'); }
  render();
});

(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (token) {
    try { await refresh(); startPolling(); } catch { /* token vencido: muestra login */ }
  }
  render();
})();
