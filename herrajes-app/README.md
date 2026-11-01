# Herrajes · App de depósito para el celular

App para una empresa de herrajes: el encargado asigna **tareas / pedidos** a los empleados,
y cada empleado ve en su celular **qué casillero del pallet (3×3, como un tateti) tiene que agarrar**,
resaltado con el color del producto.

## Qué hace

**Administrador (vos)**
- 👷 **Empleados**: crear cuentas (usuario + contraseña), cambiar contraseñas, borrar cuentas.
- 🔩 **Productos**: nombre, código, nombre del color y color (ej: *Manija barral 128mm · Negro*).
  Cada producto + color es un producto distinto.
- 🟫 **Pallets 3×3**: a cada pallet le ponés un nombre y **dónde está en el galpón**
  (ej: *Pasillo 2, a la derecha, al fondo*). Elegís un producto y una cantidad, y tocás los
  casilleros para cargarlos (o "Llenar todo el pallet"). Las filas son **A–C** y las columnas **1–3**.
  El stock de cada producto es la suma de sus casilleros.
- 📋 **Tareas**: título, a quién se la asignás, indicaciones y la lista del pedido
  (ej: *5 unidades de Bisagra Níquel*). Ves el avance de cada tarea.

**Empleado**
- Ve solo **sus** tareas, y le aparece un aviso (con vibración) cuando le llega un pedido nuevo.
- Abre el pedido y, **en la misma pantalla**, cada producto muestra:
  - **cuánto** agarrar (ej: *5 unidades*),
  - **dónde está en el galpón** (ej: *📍 Pasillo 1, a la izquierda, al fondo · Pallet A*),
  - el pallet **3×3 como un tateti** con el casillero de ese color **resaltado y titilando**,
    y cuántas unidades sacar (ej: `A1 → 5 u.`).
- Toca **"Ya lo agarré"** en cada producto y el stock se descuenta solo. Cuando agarró todo,
  marca el pedido como terminado.
- Si no hay stock suficiente, la app le avisa y no lo deja continuar.

## Cómo usarla

Necesitás [Node.js](https://nodejs.org) 18 o más nuevo (no hace falta instalar nada más).

1. En la compu del local: doble clic en **`iniciar.bat`** (Windows), o en una terminal:
   ```bash
   node server.js
   ```
2. En la pantalla aparece una dirección tipo `http://192.168.0.15:3000` (**Red local**).
   Abrila en el navegador del celular (tiene que estar en el mismo WiFi).
3. Para tenerla como app: en el menú del navegador, **"Agregar a pantalla de inicio"**.
4. Entrá con **`admin` / `admin123`** y **cambiá la contraseña** desde ⚙︎ → Mi cuenta.

Viene con datos de ejemplo (9 productos, un pallet 3×3 con un color en cada casillero, el empleado `juan` / `1234` y un pedido).
Para empezar de cero, cerrá el servidor y borrá la carpeta `data/`.

El tamaño del pallet se cambia en `server.js` (`const GRID = 3`).

## Datos y respaldo

Todo se guarda en `data/db.json`. Copiá ese archivo para hacer un respaldo.

Para usarla desde fuera del local (con datos móviles) hay que subir el servidor a un hosting
(Render, Railway, un VPS, etc.) con HTTPS. Variables opcionales: `PORT` y `DATA_DIR`.

## Pruebas

```bash
node test.js
```
