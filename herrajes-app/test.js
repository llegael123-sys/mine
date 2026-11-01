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

  try {
    assert.strictEqual((await call('POST', '/api/login', { username: 'admin', password: 'mal' })).status, 401);
    const admin = (await call('POST', '/api/login', { username: 'admin', password: 'admin123' })).body.token;
    let d = (await call('GET', '/api/data', null, admin)).body;
    assert.strictEqual(d.pallets[0].cells.length, 9);

    // El admin crea un empleado y le asigna un pedido de 5 unidades
    const emp = (await call('POST', '/api/users', { username: 'ana', name: 'Ana', password: 'clave1' }, admin)).body;
    const prod = d.products[1];
    const stockBefore = d.pallets[0].cells.filter((c) => c.productId === prod.id).reduce((s, c) => s + c.qty, 0);
    const task = (await call('POST', '/api/tasks', { title: 'Pedido test', assignedTo: emp.id, items: [{ productId: prod.id, qty: 5 }] }, admin)).body;

    // El empleado entra y solo ve su tarea
    const ana = (await call('POST', '/api/login', { username: 'ana', password: 'clave1' })).body.token;
    d = (await call('GET', '/api/data', null, ana)).body;
    assert.deepStrictEqual(d.tasks.map((t) => t.id), [task.id]);
    assert.strictEqual((await call('POST', '/api/products', { name: 'x' }, ana)).status, 403);

    // El pedido ya trae dónde está cada producto (casillero a resaltar)
    const plan = d.tasks[0].items[0].plan;
    assert.ok(plan.enough);
    assert.strictEqual(plan.picks.reduce((s, p) => s + p.qty, 0), 5);
    for (const pk of plan.picks) assert.strictEqual(d.pallets[0].cells[pk.cell].productId, prod.id);

    // No se puede terminar sin agarrar todo
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/complete`, null, ana)).status, 400);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, ana)).status, 200);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/items/0/pick`, null, ana)).status, 400);
    assert.strictEqual((await call('POST', `/api/tasks/${task.id}/complete`, null, ana)).body.status, 'completada');

    d = (await call('GET', '/api/data', null, admin)).body;
    const stockAfter = d.pallets[0].cells.filter((c) => c.productId === prod.id).reduce((s, c) => s + c.qty, 0);
    assert.strictEqual(stockAfter, stockBefore - 5);

    // Sin stock suficiente no deja agarrar
    const big = (await call('POST', '/api/tasks', { title: 'Grande', assignedTo: emp.id, items: [{ productId: prod.id, qty: 99999 }] }, admin)).body;
    assert.strictEqual((await call('POST', `/api/tasks/${big.id}/items/0/pick`, null, ana)).status, 400);

    // Otro empleado no puede tocar tareas ajenas
    const juan = (await call('POST', '/api/login', { username: 'juan', password: '1234' })).body.token;
    assert.strictEqual((await call('POST', `/api/tasks/${big.id}/start`, null, juan)).status, 403);

    // Mismo producto dos veces en un pedido: no se superponen casilleros y se agarra lo que se mostró
    const pal = d.pallets[0];
    await call('PUT', `/api/pallets/${pal.id}`, { location: 'Pasillo 3', cells: [0, 1].map((index) => ({ index, productId: prod.id, qty: 4 })) }, admin);
    const dup = (await call('POST', '/api/tasks', { title: 'Doble', assignedTo: emp.id, items: [{ productId: prod.id, qty: 3 }, { productId: prod.id, qty: 3 }] }, admin)).body;
    d = (await call('GET', '/api/data', null, ana)).body;
    assert.strictEqual(d.pallets[0].location, 'Pasillo 3');
    const [p1, p2] = d.tasks.find((t) => t.id === dup.id).items.map((i) => i.plan);
    assert.deepStrictEqual(p1.picks.map((x) => [x.cell, x.qty]), [[0, 3]]);
    assert.deepStrictEqual(p2.picks.map((x) => [x.cell, x.qty]), [[0, 1], [1, 2]]);
    const picked = (await call('POST', `/api/tasks/${dup.id}/items/1/pick`, null, ana)).body; // fuera de orden
    assert.deepStrictEqual(picked.items[1].picks, p2.picks);
    d = (await call('GET', '/api/data', null, ana)).body;
    assert.deepStrictEqual(d.tasks.find((t) => t.id === dup.id).items[0].plan.picks, p1.picks);

    console.log('OK: todas las pruebas pasaron');
  } finally {
    server.close();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
