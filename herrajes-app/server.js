// Servidor de la app de Herrajes. Sin dependencias: solo Node.js (>= 18).
// Guarda todo en data/db.json y sirve la app web (PWA) desde public/.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GRID = 3; // pallets de 3x3 (como un tateti)
const VERSION = '2';
const CELLS = GRID * GRID;

// ---------- utilidades ----------
const newId = () => crypto.randomBytes(6).toString('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function emptyCells() {
  return Array.from({ length: CELLS }, () => ({ productId: null, qty: 0 }));
}

// ---------- base de datos (archivo JSON) ----------
let db;

function seed() {
  const mk = (username, name, role, password) => ({ id: newId(), username, name, role, ...hashPassword(password) });
  const admin = mk('admin', 'Administrador', 'admin', 'admin123');
  const juan = mk('juan', 'Juan Pérez', 'empleado', '1234');

  const products = [
    ['Bisagra cazoleta 35mm', 'BIS-35', 'Níquel', '#9ca3af'],
    ['Manija barral 128mm', 'MAN-128', 'Negro', '#111827'],
    ['Tirador botón', 'TIR-BOT', 'Dorado', '#d4a017'],
    ['Corredera telescópica 45cm', 'COR-45', 'Zincada', '#60a5fa'],
    ['Pasador de embutir', 'PAS-EMB', 'Bronce', '#b45309'],
    ['Manija barral 128mm', 'MAN-128-B', 'Blanco', '#f9fafb'],
    ['Escuadra reforzada', 'ESC-REF', 'Rojo', '#dc2626'],
    ['Pistón a gas 100N', 'PIS-100', 'Verde', '#16a34a'],
    ['Cerradura de mueble', 'CER-MUE', 'Violeta', '#7c3aed'],
  ].map(([name, code, colorName, color]) => ({ id: newId(), name, code, colorName, color }));

  // Pallet de ejemplo: cada casillero tiene un producto/color distinto, 50 unidades cada uno.
  const pallet = { id: newId(), name: 'Pallet A', location: 'Pasillo 1, a la izquierda, al fondo', cells: emptyCells() };
  products.forEach((p, i) => { pallet.cells[i] = { productId: p.id, qty: 50 }; });

  const task = {
    id: newId(),
    title: 'Pedido de ejemplo - Carpintería López',
    notes: 'Armar y dejar en la mesa de despacho.',
    assignedTo: juan.id,
    createdAt: new Date().toISOString(),
    status: 'pendiente',
    items: [
      { productId: products[0].id, qty: 5, picked: false, picks: [] },
      { productId: products[2].id, qty: 12, picked: false, picks: [] },
      { productId: products[6].id, qty: 5, picked: false, picks: [] },
    ],
  };

  return { users: [admin, juan], products, pallets: [pallet], tasks: [task] };
}

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Si los pallets se guardaron con otro tamaño, los adapta al actual (conserva la esquina superior izquierda).
    for (const p of db.pallets) {
      const old = Math.round(Math.sqrt(p.cells.length));
      if (old === GRID) continue;
      const cells = emptyCells();
      for (let r = 0; r < Math.min(old, GRID); r++) {
        for (let c = 0; c < Math.min(old, GRID); c++) cells[r * GRID + c] = p.cells[r * old + c];
      }
      p.cells = cells;
    }
  } else {
    db = seed();
    saveDb();
  }
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // escritura atómica: no se corrompe si se corta la luz
}

// ---------- sesiones ----------
const sessions = new Map(); // token -> userId

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

// ---------- lógica de pedidos ----------
// Decide de qué casilleros sacar `qty` unidades de un producto.
// Recorre los pallets en orden y cada pallet de A1 a I9, así el empleado vacía de a un casillero.
// `reserved` (Map "palletId:cell" -> unidades) descuenta lo que ya se separó para otro ítem.
function planPick(productId, qty, reserved = new Map()) {
  const picks = [];
  let available = 0;
  let left = qty;
  for (const p of db.pallets) {
    p.cells.forEach((cell, index) => {
      if (cell.productId !== productId) return;
      const key = `${p.id}:${index}`;
      const have = cell.qty - (reserved.get(key) || 0);
      if (have <= 0) return;
      available += have;
      if (left <= 0) return;
      const take = Math.min(left, have);
      picks.push({ palletId: p.id, cell: index, qty: take });
      left -= take;
    });
  }
  return { picks, available, enough: left <= 0 };
}

// Plan de cada ítem pendiente de una tarea (null para los ya agarrados).
// Si un producto aparece dos veces en el pedido, el segundo no usa lo reservado por el primero.
function planTask(task) {
  const reserved = new Map();
  return task.items.map((item) => {
    if (item.picked) return null;
    const plan = planPick(item.productId, item.qty, reserved);
    if (plan.enough) {
      for (const pk of plan.picks) {
        const key = `${pk.palletId}:${pk.cell}`;
        reserved.set(key, (reserved.get(key) || 0) + pk.qty);
      }
    }
    return plan;
  });
}

// ---------- HTTP ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(new HttpError(413, 'Demasiados datos')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = sessions.get(token);
  const user = userId && db.users.find((u) => u.id === userId);
  if (!user) throw new HttpError(401, 'Sesión vencida, volvé a ingresar');
  return user;
}

function requireAdmin(user) {
  if (user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto');
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

function findOr404(list, id, what) {
  const item = list.find((x) => x.id === id);
  if (!item) throw new HttpError(404, `${what} no encontrado`);
  return item;
}

function snapshot(user) {
  const tasks = (user.role === 'admin' ? db.tasks : db.tasks.filter((t) => t.assignedTo === user.id)).map((t) => {
    if (t.status === 'completada') return t;
    const plans = planTask(t);
    return { ...t, items: t.items.map((it, i) => (plans[i] ? { ...it, plan: plans[i] } : it)) };
  });
  return {
    me: publicUser(user),
    users: db.users.map(publicUser),
    products: db.products,
    pallets: db.pallets,
    tasks,
    grid: GRID,
    version: VERSION,
  };
}

// Rutas de la API: [método, patrón, handler(req, user, params, body)]
const routes = [
  ['POST', /^\/api\/login$/, async (req, _u, _p, body) => {
    const user = db.users.find((u) => u.username.toLowerCase() === str(body.username).toLowerCase());
    if (!user || !checkPassword(user, body.password ?? '')) throw new HttpError(401, 'Usuario o contraseña incorrectos');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    return { token };
  }, { public: true }],

  ['POST', /^\/api\/logout$/, async (req) => {
    sessions.delete((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    return { ok: true };
  }],

  ['GET', /^\/api\/data$/, async (req, user) => snapshot(user)],

  ['POST', /^\/api\/me\/password$/, async (req, user, _p, body) => {
    if (!checkPassword(user, body.current ?? '')) throw new HttpError(400, 'La contraseña actual no es correcta');
    if (str(body.next).length < 4) throw new HttpError(400, 'La nueva contraseña debe tener al menos 4 caracteres');
    Object.assign(user, hashPassword(str(body.next)));
    return { ok: true };
  }],

  // --- empleados ---
  ['POST', /^\/api\/users$/, async (req, user, _p, body) => {
    requireAdmin(user);
    const username = str(body.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new HttpError(400, 'Usuario inválido (letras, números, punto o guion)');
    if (db.users.some((u) => u.username === username)) throw new HttpError(400, 'Ese usuario ya existe');
    if (str(body.password).length < 4) throw new HttpError(400, 'La contraseña debe tener al menos 4 caracteres');
    const role = body.role === 'admin' ? 'admin' : 'empleado';
    const u = { id: newId(), username, name: str(body.name, 80) || username, role, ...hashPassword(str(body.password)) };
    db.users.push(u);
    return publicUser(u);
  }],

  ['PUT', /^\/api\/users\/(\w+)$/, async (req, user, [id], body) => {
    requireAdmin(user);
    const u = findOr404(db.users, id, 'Empleado');
    if (body.name !== undefined) u.name = str(body.name, 80) || u.username;
    if (body.password) {
      if (str(body.password).length < 4) throw new HttpError(400, 'La contraseña debe tener al menos 4 caracteres');
      Object.assign(u, hashPassword(str(body.password)));
    }
    return publicUser(u);
  }],

  ['DELETE', /^\/api\/users\/(\w+)$/, async (req, user, [id]) => {
    requireAdmin(user);
    if (id === user.id) throw new HttpError(400, 'No podés borrar tu propia cuenta');
    findOr404(db.users, id, 'Empleado');
    db.users = db.users.filter((u) => u.id !== id);
    for (const [t, uid] of sessions) if (uid === id) sessions.delete(t);
    return { ok: true };
  }],

  // --- productos ---
  ['POST', /^\/api\/products$/, async (req, user, _p, body) => {
    requireAdmin(user);
    const name = str(body.name, 80);
    if (!name) throw new HttpError(400, 'Poné un nombre al producto');
    const color = /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#9ca3af';
    const p = { id: newId(), name, code: str(body.code, 30), colorName: str(body.colorName, 30), color };
    db.products.push(p);
    return p;
  }],

  ['PUT', /^\/api\/products\/(\w+)$/, async (req, user, [id], body) => {
    requireAdmin(user);
    const p = findOr404(db.products, id, 'Producto');
    if (body.name !== undefined) p.name = str(body.name, 80) || p.name;
    if (body.code !== undefined) p.code = str(body.code, 30);
    if (body.colorName !== undefined) p.colorName = str(body.colorName, 30);
    if (/^#[0-9a-f]{6}$/i.test(body.color)) p.color = body.color;
    return p;
  }],

  ['DELETE', /^\/api\/products\/(\w+)$/, async (req, user, [id]) => {
    requireAdmin(user);
    findOr404(db.products, id, 'Producto');
    const used = db.tasks.some((t) => t.status !== 'completada' && t.items.some((i) => i.productId === id));
    if (used) throw new HttpError(400, 'Ese producto está en una tarea sin terminar');
    db.products = db.products.filter((p) => p.id !== id);
    for (const pal of db.pallets) for (const c of pal.cells) if (c.productId === id) { c.productId = null; c.qty = 0; }
    return { ok: true };
  }],

  // --- pallets ---
  ['POST', /^\/api\/pallets$/, async (req, user, _p, body) => {
    requireAdmin(user);
    const p = { id: newId(), name: str(body.name, 40) || `Pallet ${db.pallets.length + 1}`, location: str(body.location, 120), cells: emptyCells() };
    db.pallets.push(p);
    return p;
  }],

  ['PUT', /^\/api\/pallets\/(\w+)$/, async (req, user, [id], body) => {
    requireAdmin(user);
    const p = findOr404(db.pallets, id, 'Pallet');
    if (body.name !== undefined) p.name = str(body.name, 40) || p.name;
    if (body.location !== undefined) p.location = str(body.location, 120);
    // body.cells: [{index, productId|null, qty}]
    if (Array.isArray(body.cells)) {
      for (const c of body.cells) {
        const index = int(c.index);
        if (index >= CELLS) continue;
        const productId = c.productId && db.products.some((x) => x.id === c.productId) ? c.productId : null;
        p.cells[index] = { productId, qty: productId ? int(c.qty) : 0 };
      }
    }
    return p;
  }],

  ['DELETE', /^\/api\/pallets\/(\w+)$/, async (req, user, [id]) => {
    requireAdmin(user);
    findOr404(db.pallets, id, 'Pallet');
    db.pallets = db.pallets.filter((p) => p.id !== id);
    return { ok: true };
  }],

  // --- tareas / pedidos ---
  ['POST', /^\/api\/tasks$/, async (req, user, _p, body) => {
    requireAdmin(user);
    const title = str(body.title, 120);
    if (!title) throw new HttpError(400, 'Poné un título a la tarea');
    const assignee = db.users.find((u) => u.id === body.assignedTo);
    if (!assignee) throw new HttpError(400, 'Elegí a quién se la asignás');
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ productId: i.productId, qty: int(i.qty), picked: false, picks: [] }))
      .filter((i) => i.qty > 0 && db.products.some((p) => p.id === i.productId));
    const t = {
      id: newId(), title, notes: str(body.notes, 1000), assignedTo: assignee.id,
      createdAt: new Date().toISOString(), status: 'pendiente', items,
    };
    db.tasks.unshift(t);
    return t;
  }],

  ['DELETE', /^\/api\/tasks\/(\w+)$/, async (req, user, [id]) => {
    requireAdmin(user);
    findOr404(db.tasks, id, 'Tarea');
    db.tasks = db.tasks.filter((t) => t.id !== id);
    return { ok: true };
  }],

  ['POST', /^\/api\/tasks\/(\w+)\/items\/(\d+)\/pick$/, async (req, user, [id, idx]) => {
    const t = taskFor(user, id);
    if (t.status === 'completada') throw new HttpError(400, 'La tarea ya está completada');
    const item = t.items[Number(idx)];
    if (!item) throw new HttpError(404, 'Ítem no encontrado');
    if (item.picked) throw new HttpError(400, 'Ese producto ya fue agarrado');
    const plan = planTask(t)[Number(idx)];
    if (!plan.enough) throw new HttpError(400, `No hay stock suficiente: hay ${plan.available} y se piden ${item.qty}`);
    for (const pk of plan.picks) {
      const cell = db.pallets.find((p) => p.id === pk.palletId).cells[pk.cell];
      cell.qty -= pk.qty;
      if (cell.qty <= 0) { cell.qty = 0; cell.productId = null; }
    }
    item.picked = true;
    item.picks = plan.picks;
    item.pickedAt = new Date().toISOString();
    item.pickedBy = user.id;
    if (t.status === 'pendiente') t.status = 'en_curso';
    return t;
  }],

  ['POST', /^\/api\/tasks\/(\w+)\/complete$/, async (req, user, [id]) => {
    const t = taskFor(user, id);
    if (t.items.some((i) => !i.picked)) throw new HttpError(400, 'Faltan productos por agarrar');
    t.status = 'completada';
    t.completedAt = new Date().toISOString();
    return t;
  }],

  ['POST', /^\/api\/tasks\/(\w+)\/start$/, async (req, user, [id]) => {
    const t = taskFor(user, id);
    if (t.status === 'pendiente') t.status = 'en_curso';
    return t;
  }],
];

function taskFor(user, id) {
  const t = findOr404(db.tasks, id, 'Tarea');
  if (user.role !== 'admin' && t.assignedTo !== user.id) throw new HttpError(403, 'Esta tarea no es tuya');
  return t;
}

async function handleApi(req, res, pathname) {
  try {
    for (const [method, pattern, handler, opts = {}] of routes) {
      const m = pathname.match(pattern);
      if (!m || req.method !== method) continue;
      const user = opts.public ? null : auth(req);
      const body = method === 'GET' ? {} : await readBody(req);
      const result = await handler(req, user, m.slice(1), body);
      if (method !== 'GET') saveDb();
      return send(res, 200, result);
    }
    throw new HttpError(404, 'Ruta no encontrada');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Error interno del servidor' });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(res, pathname);
  });
}

module.exports = { createServer, loadDb, planPick, planTask };

if (require.main === module) {
  loadDb();
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ATENCION: la app ya esta abierta en otra ventana negra (puerto ${PORT}).`);
      console.error('  Cerra TODAS las ventanas negras de la app y volve a abrir ABRIR-APP-HERRAJES.bat.\n');
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`\nApp de Herrajes funcionando (version ${VERSION}, pallets ${GRID}x${GRID}).`);
    console.log(`  En esta compu:  http://localhost:${PORT}`);
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  Red local:      http://${n.address}:${PORT}  (abrilo en el celular)`);
      }
    }
    console.log(`\nUsuario inicial: admin / admin123  (cambiá la contraseña al entrar)\n`);
    if (process.argv.includes('--abrir')) openBrowser(`http://localhost:${PORT}`);
  });
}

// Abre el navegador de la compu (solo cuando se inicia con --abrir, desde el .bat).
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
