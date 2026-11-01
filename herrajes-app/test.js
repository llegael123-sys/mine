// Prueba de punta a punta de la API. Uso: node test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'herrajes-test-'));
const { createServer, loadDb } = require('./server');

(async () => {
  loadDb();
  const server = createServer().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const stock = (d, productId) => d.pallets.flatMap((p) => p.cells).filter((c) => c.productId === productId).reduce((s, c) => s + c.qty, 0);

  try {
    assert.strictEqual((await call('POST', '/api/login', { username: 'admin', password: 'mal' })).status, 401);
    const admin = (await call('POST', '/api/login', { username: 'admin', password: 'admin123' })).body.token;
    let d = (await call('GET', '/api/data', null, admin)).body;
    assert.strictEqual(d.pallets[0].cells.length, 9);
    assert.strictEqual(d.tasks[0].status, 'disponible'); // el trabajo de ejemplo no es de nadie

    const ana = (await call('POST', '/api/users', { username: 'ana', name: 'Ana', password: 'clave1' }, admin)).body;
    const tokAna = (await call('POST', '/api/login', { username: 'ana', password: 'clave1' })).body.token;
    const tokJuan = (await call('POST', '/api/login', { username: 'juan', password: '1234' })).body.token;
    const prod = d.products[1];
    const cli = d.clients[0].id;
    const stockBefore = stock(d, prod.id);

    // --- Productos por código: obligatorio, único y en mayúsculas
    assert.strictEqual((await call('POST', '/api/products', { name: 'Sin código' }, admin)).status, 400);
    assert.strictEqual((await call('POST', '/api/products', { name: 'Repetido', code: prod.code.toLowerCase() }, admin)).status, 400);
    assert.strictEqual((await call('POST', '/api/products', { name: 'Tornillo', code: ' tor-440 ' }, admin)).body.code, 'TOR-440');
    assert.strictEqual((await call('POST', '/api/products', { name: 'x', code: 'X1' }, tokAna)).status, 403);

    // --- Cada trabajo es de un cliente y los productos se piden por código
    assert.strictEqual((await call('POST', '/api/tasks', { items: [{ code: prod.code, qty: 5 }] }, admin)).status, 400);
    const noCode = await call('POST', '/api/tasks', { clientId: cli, items: [{ code: 'NO-EXISTE', qty: 5 }] }, admin);
    assert.strictEqual(noCode.status, 400);
    assert.match(noCode.body.error, /NO-EXISTE/);
    const task = (await call('POST', '/api/tasks', { clientId: cli, title: 'Pedido test', items: [{ code: prod.code.toLowerCase(), qty: 5 }] }, admin)).body;
    assert.strictEqual(task.items[0].productId, prod.id);
    assert.strictEqual(task.status, 'disponible');
    assert.strictEqual(task.assignedTo, null);

    // --- Les aparece a todos los empleados
    for (const tok of [tokAna, tokJuan]) {
      d = (await call('GET', '/api/data', null, tok)).body;
      assert.ok(d.tasks.some((t) => t.id === task.id), 'todos ven el trabajo disponible');
    }
    // No se puede agarrar nada sin tomarlo
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, tokAna)).status, 400);

    // --- Ana lo toma: Juan ya no lo puede tomar ni lo ve
    const taken = (await call('POST', `/api/tasks/${task.id}/accept`, null, tokAna)).body;
    assert.strictEqual(taken.assignedTo, ana.id);
    assert.strictEqual(taken.status, 'en_curso');
    const juanTry = await call('POST', `/api/tasks/${task.id}/accept`, null, tokJuan);
    assert.strictEqual(juanTry.status, 409);
    assert.match(juanTry.body.error, /Ana/);
    d = (await call('GET', '/api/data', null, tokJuan)).body;
    assert.ok(!d.tasks.some((t) => t.id === task.id), 'Juan ya no lo ve');
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, tokJuan)).status, 403);

    // --- De a un trabajo por vez: Ana no puede tomar otro hasta terminar
    const otro = (await call('POST', '/api/tasks', { clientId: cli, items: [{ code: 'BIS-35', qty: 1 }] }, admin)).body;
    const second = await call('POST', `/api/tasks/${otro.id}/accept`, null, tokAna);
    assert.strictEqual(second.status, 400);
    assert.match(second.body.error, /terminá/);

    // --- El plan resalta el casillero correcto
    d = (await call('GET', '/api/data', null, tokAna)).body;
    const plan = d.tasks.find((t) => t.id === task.id).items[0].plan;
    assert.ok(plan.enough);
    assert.strictEqual(plan.picks.reduce((s, p) => s + p.qty, 0), 5);
    for (const pk of plan.picks) assert.strictEqual(d.pallets[0].cells[pk.cell].productId, prod.id);

    // --- Agarrar y terminar
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/complete`, null, tokAna)).status, 400);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, tokAna)).status, 200);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, tokAna)).status, 400);
    // Ya agarró algo: no lo puede soltar ella (sí el encargado)
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/release`, null, tokAna)).status, 400);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/complete`, null, tokAna)).body.status, 'completada');
    d = (await call('GET', '/api/data', null, admin)).body;
    assert.strictEqual(stock(d, prod.id), stockBefore - 5);

    // --- Terminado el anterior, ya puede tomar otro; y soltarlo si no agarró nada
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/accept`, null, tokAna)).status, 200);
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/release`, null, tokJuan)).status, 403);
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/release`, null, tokAna)).body.status, 'disponible');
    // Lo toma Juan, y el encargado lo libera
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/accept`, null, tokJuan)).status, 200);
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/release`, null, admin)).body.assignedTo, null);
    // Si se borra un empleado, su trabajo en curso vuelve a estar disponible
    assert.strictEqual((await call('POST', `/api/tasks/${otro.id}/accept`, null, tokAna)).status, 200);
    await call('DELETE', `/api/users/${ana.id}`, null, admin);
    d = (await call('GET', '/api/data', null, tokJuan)).body;
    assert.strictEqual(d.tasks.find((t) => t.id === otro.id).status, 'disponible');

    // --- Sin stock suficiente no deja agarrar
    const big = (await call('POST', '/api/tasks', { clientId: cli, items: [{ productId: prod.id, qty: 99999 }] }, admin)).body;
    assert.strictEqual((await call('POST', `/api/tasks/${big.id}/items/0/pick`, null, admin)).status, 400);

    // --- Mismo producto dos veces en un trabajo: no se superponen casilleros y se agarra lo que se mostró
    const pal = d.pallets[0];
    await call('PUT', `/api/pallets/${pal.id}`, { location: 'Pasillo 3', cells: [0, 1].map((index) => ({ index, productId: prod.id, qty: 4 })) }, admin);
    const dup = (await call('POST', '/api/tasks', { clientId: cli, items: [{ productId: prod.id, qty: 3 }, { productId: prod.id, qty: 3 }] }, admin)).body;
    assert.strictEqual((await call('POST', `/api/tasks/${dup.id}/accept`, null, tokJuan)).status, 200);
    d = (await call('GET', '/api/data', null, tokJuan)).body;
    assert.strictEqual(d.pallets[0].location, 'Pasillo 3');
    const [p1, p2] = d.tasks.find((t) => t.id === dup.id).items.map((i) => i.plan);
    assert.deepStrictEqual(p1.picks.map((x) => [x.cell, x.qty]), [[0, 3]]);
    assert.deepStrictEqual(p2.picks.map((x) => [x.cell, x.qty]), [[0, 1], [1, 2]]);
    const picked = (await call('POST', `/api/tasks/${dup.id}/items/1/pick`, null, tokJuan)).body; // fuera de orden
    assert.deepStrictEqual(picked.items[1].picks, p2.picks);
    d = (await call('GET', '/api/data', null, tokJuan)).body;
    assert.deepStrictEqual(d.tasks.find((t) => t.id === dup.id).items[0].plan.picks, p1.picks);

    // --- Clientes: no se puede borrar uno con trabajos sin terminar; sí uno sin trabajos
    assert.strictEqual((await call('DELETE', `/api/clients/${cli}`, null, admin)).status, 400);
    const nuevoCli = (await call('POST', '/api/clients', { name: 'Cliente Nuevo', phone: '123' }, admin)).body;
    assert.strictEqual((await call('POST', '/api/clients', { name: 'cliente nuevo' }, admin)).status, 400);
    assert.strictEqual((await call('POST', '/api/clients', { name: 'X' }, tokJuan)).status, 403);
    assert.strictEqual((await call('DELETE', `/api/clients/${nuevoCli.id}`, null, admin)).status, 200);

    console.log('OK: todas las pruebas pasaron');
  } finally {
    server.close();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
