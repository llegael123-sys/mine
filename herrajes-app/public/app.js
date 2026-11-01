'use strict';
// App de Herrajes: interfaz para el celular. Habla con server.js por /api.

const $app = document.getElementById('app');
const ROWS = 'ABCDEFGHI';
const STATUS = { pendiente: 'Pendiente', en_curso: 'En curso', completada: 'Completada' };

let token = localStorage.getItem('token');
let data = null; // lo que devuelve /api/data
let pollTimer = null;
let brush = { productId: '', qty: 20 }; // pincel del editor de pallets
let draftItems = []; // ítems de la tarea que se está creando

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cellName = (i) => `${ROWS[Math.floor(i / 9)]}${(i % 9) + 1}`;
const product = (id) => data.products.find((p) => p.id === id);
const userName = (id) => data.users.find((u) => u.id === id)?.name || '—';
const isAdmin = () => data?.me.role === 'admin';
const fmtDate = (iso) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

function productLabel(p) {
  return p ? `${p.name}${p.colorName ? ' · ' + p.colorName : ''}` : 'Producto borrado';
}

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
    ? [['#/tareas', '📋', 'Tareas'], ['#/pallets', '🟫', 'Pallets'], ['#/productos', '🔩', 'Productos'], ['#/empleados', '👷', 'Empleados']]
    : [['#/tareas', '📋', 'Mis tareas'], ['#/pallets', '🟫', 'Pallets'], ['#/cuenta', '👤', 'Cuenta']];
  $app.innerHTML = `
    <header class="topbar">
      ${back ? `<button class="back" onclick="go('${back}')" aria-label="Volver">‹</button>` : ''}
      <h1>${esc(title)}</h1>
      ${!back ? `<span class="who">${esc(data.me.name)}</span><button class="iconbtn" onclick="go('#/cuenta')" aria-label="Cuenta">⚙︎</button>` : ''}
    </header>
    <main>${body}</main>
    <nav class="tabs">${tabs.map(([h, i, l]) => `<a href="${h}" class="${tab === h ? 'on' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>`;
}

// Dibuja un pallet 9x9. opts.take: Map(cellIndex -> cantidad a agarrar). opts.onCell: nombre de función global.
function palletGrid(pal, opts = {}) {
  const take = opts.take;
  let html = `<div class="pallet ${take ? 'picking' : ''}"><div></div>`;
  for (let c = 1; c <= 9; c++) html += `<div class="lbl">${c}</div>`;
  pal.cells.forEach((cell, i) => {
    if (i % 9 === 0) html += `<div class="lbl">${ROWS[i / 9]}</div>`;
    const p = cell.productId && product(cell.productId);
    const hl = take && take.has(i);
    const style = p ? `background:${p.color};color:${textOn(p.color)}` : '';
    const title = p ? `${cellName(i)}: ${productLabel(p)} (${cell.qty} u.)` : `${cellName(i)}: vacío`;
    const label = hl ? '' : opts.showQty && p ? cell.qty : '';
    html += `<button class="cell ${p ? '' : 'empty'} ${hl ? 'hl' : ''}" style="${style}" title="${esc(title)}" aria-label="${esc(title)}"
      ${hl ? `data-take="${take.get(i)}"` : ''} ${opts.onCell ? `onclick="${opts.onCell}('${pal.id}', ${i})"` : ''}>${label}</button>`;
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
    </div>`;
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
  const filter = sessionStorage.getItem('taskFilter') || 'activas';
  let tasks = data.tasks;
  if (filter === 'activas') tasks = tasks.filter((t) => t.status !== 'completada');
  if (filter === 'completadas') tasks = tasks.filter((t) => t.status === 'completada');

  const chips = [['activas', 'Activas'], ['completadas', 'Completadas'], ['todas', 'Todas']]
    .map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" onclick="sessionStorage.setItem('taskFilter','${k}');render()">${l}</button>`).join('');

  const list = tasks.map((t) => {
    const done = t.items.filter((i) => i.picked).length;
    const pct = t.items.length ? Math.round((done / t.items.length) * 100) : 0;
    return `<a class="list-item" href="#/tarea/${t.id}">
      <div class="grow">
        <div class="row"><span class="title grow">${esc(t.title)}</span><span class="badge ${t.status}">${STATUS[t.status]}</span></div>
        <div class="muted small">${isAdmin() ? '👷 ' + esc(userName(t.assignedTo)) + ' · ' : ''}${t.items.length} producto(s) · ${fmtDate(t.createdAt)}</div>
        ${t.items.length ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
      </div><span class="chev">›</span></a>`;
  }).join('');

  shell({
    title: isAdmin() ? 'Tareas' : 'Mis tareas',
    tab: '#/tareas',
    body: `
      ${isAdmin() ? `<a class="btn block" href="#/nueva-tarea" style="margin-bottom:12px">＋ Nueva tarea / pedido</a>` : ''}
      <div class="chips">${chips}</div>
      <div class="card">${list || `<div class="empty"><div class="ico">✅</div>${isAdmin() ? 'No hay tareas acá.' : 'No tenés tareas asignadas.'}</div>`}</div>`,
  });
}

function viewTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return go('#/tareas');
  const allPicked = t.items.every((i) => i.picked);

  const items = t.items.map((it, idx) => {
    const p = product(it.productId);
    const where = it.picked ? it.picks.map((pk) => `${esc(data.pallets.find((x) => x.id === pk.palletId)?.name || 'Pallet')} ${cellName(pk.cell)} (${pk.qty})`).join(', ') : '';
    return `<a class="list-item" ${it.picked ? '' : `href="#/tarea/${t.id}/item/${idx}"`}>
      <span class="swatch lg" style="background:${p?.color || '#ccc'}"></span>
      <div class="grow">
        <div class="title">${esc(productLabel(p))}</div>
        <div class="muted small">${p?.code ? esc(p.code) + ' · ' : ''}${it.picked ? '✔ Agarrado de ' + where : 'Stock: ' + (p ? stockOf(p.id) : 0)}</div>
      </div>
      <div class="center"><div style="font-size:22px;font-weight:800">${it.qty}</div><div class="muted small">u.</div></div>
      <span class="chev">${it.picked ? '✅' : '›'}</span></a>`;
  }).join('');

  shell({
    title: t.title,
    back: '#/tareas',
    tab: '#/tareas',
    body: `
      <div class="card">
        <div class="row"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="muted small grow">👷 ${esc(userName(t.assignedTo))}</span><span class="muted small">${fmtDate(t.createdAt)}</span></div>
        ${t.notes ? `<p style="margin:10px 0 0;white-space:pre-wrap">${esc(t.notes)}</p>` : ''}
      </div>
      ${t.items.length ? `<div class="card"><h2>Pedido para armar</h2><p class="muted small" style="margin-top:0">Tocá cada producto para ver en qué casillero del pallet está.</p>${items}</div>` : ''}
      ${t.status !== 'completada' ? `<button class="btn ok block big" ${allPicked ? '' : 'disabled'} onclick="completeTask('${t.id}')">✔ Marcar tarea como terminada</button>
        ${!allPicked ? '<p class="muted small center">Se habilita cuando agarres todos los productos.</p>' : ''}` : `<p class="center muted">Terminada ${t.completedAt ? fmtDate(t.completedAt) : ''}</p>`}
      ${isAdmin() ? `<button class="btn danger block" style="margin-top:20px" onclick="deleteTask('${t.id}')">Borrar tarea</button>` : ''}`,
  });
}

async function viewPick(taskId, idx) {
  const t = data.tasks.find((x) => x.id === taskId);
  const it = t?.items[idx];
  if (!it) return go('#/tareas');
  if (it.picked) return go('#/tarea/' + taskId);
  const p = product(it.productId);

  let plan;
  try { plan = await api('GET', `/api/tasks/${taskId}/items/${idx}/plan`); }
  catch (e) { toast(e.message, true); return; }
  if (location.hash !== `#/tarea/${taskId}/item/${idx}`) return; // el usuario ya se fue

  // Agrupar por pallet
  const byPallet = new Map();
  for (const pk of plan.picks) {
    if (!byPallet.has(pk.palletId)) byPallet.set(pk.palletId, new Map());
    byPallet.get(pk.palletId).set(pk.cell, pk.qty);
  }
  const pallets = [...byPallet].map(([pid, take]) => {
    const pal = data.pallets.find((x) => x.id === pid);
    return `<div class="card"><h2>📦 ${esc(pal.name)}</h2><div class="pallet-wrap">${palletGrid(pal, { take })}</div></div>`;
  }).join('');

  const where = plan.picks.map((pk) => {
    const pal = data.pallets.find((x) => x.id === pk.palletId);
    return `<span class="pos">${cellName(pk.cell)}</span><span>${esc(pal.name)} · fila ${ROWS[Math.floor(pk.cell / 9)]}, columna ${(pk.cell % 9) + 1}</span><b>${pk.qty} u.</b>`;
  }).join('');

  shell({
    title: 'Agarrar producto',
    back: '#/tarea/' + taskId,
    tab: '#/tareas',
    body: `
      <div class="card">
        <div class="pick-target">
          <span class="swatch lg" style="background:${p.color};width:60px;height:60px"></span>
          <div class="grow"><div class="title" style="font-weight:700">${esc(p.name)}</div>
            <div class="muted">Color: <b>${esc(p.colorName || '—')}</b>${p.code ? ' · ' + esc(p.code) : ''}</div></div>
          <div class="center"><div class="pick-qty">${it.qty}</div><div class="muted small">unidades</div></div>
        </div>
        ${plan.enough ? `<div class="where">${where}</div>`
          : `<p style="color:var(--bad);font-weight:600">⚠ No hay stock suficiente: hay ${plan.available} y se piden ${it.qty}. Avisale al encargado.</p>`}
      </div>
      ${plan.enough ? pallets : ''}
      <button class="btn ok block big" ${plan.enough ? '' : 'disabled'} onclick="confirmPick('${taskId}', ${idx})">✔ Ya lo agarré</button>`,
  });
}

function viewNewTask() {
  if (!isAdmin()) return go('#/tareas');
  const people = data.users.map((u) => `<option value="${u.id}">${esc(u.name)}${u.role === 'admin' ? ' (admin)' : ''}</option>`).join('');
  const prodOpts = (sel) => data.products.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(productLabel(p))} — stock ${stockOf(p.id)}</option>`).join('');
  const rows = draftItems.map((it, i) => `
    <div class="row" style="margin-bottom:8px">
      <span class="swatch" style="background:${product(it.productId)?.color || '#ccc'}"></span>
      <select class="grow" onchange="draftItems[${i}].productId=this.value;saveDraftForm();render()">${prodOpts(it.productId)}</select>
      <input type="number" min="1" inputmode="numeric" value="${it.qty}" style="width:76px" onchange="draftItems[${i}].qty=Number(this.value)">
      <button class="btn danger small" onclick="draftItems.splice(${i},1);saveDraftForm();render()" aria-label="Quitar">✕</button>
    </div>`).join('');
  const saved = JSON.parse(sessionStorage.getItem('draftForm') || '{}');

  shell({
    title: 'Nueva tarea',
    back: '#/tareas',
    tab: '#/tareas',
    body: `
      <form id="f" class="card" onsubmit="return false">
        <label class="field"><span>Título</span><input name="title" placeholder="Ej: Pedido Carpintería López" value="${esc(saved.title || '')}" required></label>
        <label class="field"><span>Asignar a</span><select name="assignedTo">${people}</select></label>
        <label class="field"><span>Indicaciones (opcional)</span><textarea name="notes" placeholder="Ej: dejar en la mesa de despacho">${esc(saved.notes || '')}</textarea></label>
      </form>
      <div class="card">
        <h2>Productos del pedido</h2>
        ${rows || '<p class="muted">Sin productos. Podés crear una tarea sin pedido o agregar productos.</p>'}
        ${data.products.length ? `<button class="btn secondary block" onclick="addDraftItem()">＋ Agregar producto</button>` : '<p class="muted">Primero cargá productos en la pestaña Productos.</p>'}
      </div>
      <button class="btn block big" onclick="createTask()">Asignar tarea</button>`,
  });
  if (saved.assignedTo) document.querySelector('[name=assignedTo]').value = saved.assignedTo;
  else {
    const firstEmp = data.users.find((u) => u.role === 'empleado');
    if (firstEmp) document.querySelector('[name=assignedTo]').value = firstEmp.id;
  }
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
          <button class="btn secondary small" onclick="renamePallet('${pal.id}')">Renombrar</button>
          <button class="btn danger small" onclick="deletePallet('${pal.id}')">Borrar pallet</button>
        </div>
      </div>`;
  }

  shell({
    title: 'Pallets',
    tab: '#/pallets',
    body: `
      <div class="chips">${chips}${admin ? `<button class="chip" onclick="addPallet()">＋ Nuevo</button>` : ''}</div>
      ${pal ? `<div class="card"><h2>${esc(pal.name)} <span class="muted small">(9×9)</span></h2>
        <div class="pallet-wrap">${palletGrid(pal, { showQty: true, onCell: admin ? 'paintCell' : 'showCell' })}</div>
        ${palletLegend(pal)}</div>${editor}`
        : `<div class="card empty"><div class="ico">🟫</div>No hay pallets cargados.</div>`}`,
  });
}

function viewProducts() {
  if (!isAdmin()) return go('#/tareas');
  const list = data.products.map((p) => `
    <div class="list-item" onclick="editProduct('${p.id}')">
      <span class="swatch lg" style="background:${p.color}"></span>
      <div class="grow"><div class="title">${esc(p.name)}</div><div class="muted small">${esc(p.colorName || 'Sin color')}${p.code ? ' · ' + esc(p.code) : ''}</div></div>
      <div class="center"><div style="font-weight:800">${stockOf(p.id)}</div><div class="muted small">stock</div></div>
    </div>`).join('');
  shell({
    title: 'Productos',
    tab: '#/productos',
    body: `
      <button class="btn block" style="margin-bottom:12px" onclick="editProduct()">＋ Nuevo producto</button>
      <div class="card">${list || '<div class="empty">Todavía no cargaste productos.</div>'}</div>
      <p class="muted small center">Cada combinación de producto + color es un producto distinto. El stock se calcula sumando los casilleros de los pallets.</p>`,
  });
}

function viewEmployees() {
  if (!isAdmin()) return go('#/tareas');
  const list = data.users.map((u) => {
    const active = data.tasks.filter((t) => t.assignedTo === u.id && t.status !== 'completada').length;
    return `<div class="list-item" onclick="editUser('${u.id}')">
      <span class="swatch lg center" style="background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:22px">${u.role === 'admin' ? '🧑‍💼' : '👷'}</span>
      <div class="grow"><div class="title">${esc(u.name)} ${u.role === 'admin' ? '<span class="badge admin">admin</span>' : ''}</div><div class="muted small">usuario: ${esc(u.username)}</div></div>
      <div class="center"><div style="font-weight:800">${active}</div><div class="muted small">tareas</div></div>
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
      <button class="btn secondary block" onclick="logout()">Cerrar sesión</button>`,
  });
  document.getElementById('pw').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(() => api('POST', '/api/me/password', { current: f.get('current'), next: f.get('next') }), 'Contraseña cambiada');
  };
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
      <label class="field"><span>Nombre</span><input name="name" value="${esc(p.name)}" placeholder="Ej: Bisagra cazoleta 35mm" required></label>
      <label class="field"><span>Código (opcional)</span><input name="code" value="${esc(p.code)}" placeholder="Ej: BIS-35"></label>
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

function addDraftItem() {
  saveDraftForm();
  draftItems.push({ productId: data.products[0].id, qty: 5 });
  render();
}

function createTask() {
  const f = document.getElementById('f');
  const body = Object.fromEntries(new FormData(f));
  body.items = draftItems;
  act(async () => {
    const t = await api('POST', '/api/tasks', body);
    draftItems = [];
    sessionStorage.removeItem('draftForm');
    return { goTo: '#/tarea/' + t.id };
  }, 'Tarea asignada');
}

function deleteTask(id) {
  if (!confirm('¿Borrar esta tarea? (el stock ya descontado no vuelve)')) return;
  act(async () => { await api('DELETE', '/api/tasks/' + id); return { goTo: '#/tareas' }; }, 'Tarea borrada');
}

function confirmPick(taskId, idx) {
  act(async () => { await api('POST', `/api/tasks/${taskId}/items/${idx}/pick`); return { goTo: '#/tarea/' + taskId }; }, '¡Listo! Stock descontado');
}

function completeTask(id) {
  act(() => api('POST', `/api/tasks/${id}/complete`), '¡Tarea terminada! 🎉');
}

function paintCell(palletId, i) {
  const cell = brush.productId ? { index: i, productId: brush.productId, qty: brush.qty } : { index: i, productId: null, qty: 0 };
  act(() => api('PUT', '/api/pallets/' + palletId, { cells: [cell] }));
}

function fillPallet(palletId) {
  const msg = brush.productId ? `¿Llenar los 81 casilleros con ${productLabel(product(brush.productId))} (${brush.qty} c/u)?` : '¿Vaciar todo el pallet?';
  if (!confirm(msg)) return;
  const cells = Array.from({ length: 81 }, (_, index) => ({ index, productId: brush.productId || null, qty: brush.qty }));
  act(() => api('PUT', '/api/pallets/' + palletId, { cells }), 'Pallet actualizado');
}

function addPallet() {
  const name = prompt('Nombre del pallet', `Pallet ${String.fromCharCode(65 + data.pallets.length)}`);
  if (name === null) return;
  act(async () => { const p = await api('POST', '/api/pallets', { name }); return { goTo: '#/pallets/' + p.id }; }, 'Pallet creado');
}

function renamePallet(id) {
  const pal = data.pallets.find((p) => p.id === id);
  const name = prompt('Nuevo nombre', pal.name);
  if (name) act(() => api('PUT', '/api/pallets/' + id, { name }));
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
  viewLogin();
}

// Actualiza los datos cada 10 s para ver tareas nuevas, sin molestar si estás escribiendo.
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!token || document.hidden || document.querySelector('.modal-bg')) return;
    const h = location.hash;
    if (h.startsWith('#/nueva-tarea') || h.startsWith('#/cuenta') || /\/item\//.test(h)) return;
    const before = JSON.stringify(data);
    try { await refresh(); } catch { return; }
    if (JSON.stringify(data) !== before) render();
  }, 10000);
}

// ---------- router ----------
function render() {
  if (!token || !data) return viewLogin();
  const parts = (location.hash || '#/tareas').slice(2).split('/');
  closeModal();
  switch (parts[0]) {
    case 'tarea': return parts[2] === 'item' ? viewPick(parts[1], Number(parts[3])) : viewTask(parts[1]);
    case 'nueva-tarea': return viewNewTask();
    case 'pallets': return viewPallets(parts[1]);
    case 'productos': return viewProducts();
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
