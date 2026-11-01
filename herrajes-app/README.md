# Herrajes · App de depósito para el celular

App para una empresa de herrajes: el encargado carga **trabajos de cada cliente** y se los asigna a un empleado,
y cada empleado ve en su celular **qué casillero del pallet (3×3, como un tateti) tiene que agarrar**,
resaltado con el color del producto.

## Qué hace

**Administrador (vos)**
- 👷 **Empleados**: crear cuentas (usuario + contraseña), cambiar contraseñas, borrar cuentas.
- 🏢 **Clientes**: nombre, teléfono y dirección. Tocando un cliente ves todos sus trabajos.
- 🔩 **Productos por código**: cada producto tiene un **código único** (ej: `BIS-35`), nombre y color.
  Si el mismo producto viene en varios colores, cada color lleva su propio código.
  Se puede buscar por código o nombre.
- 🟫 **Pallets 3×3**: a cada pallet le ponés un nombre y **dónde está en el galpón**
  (ej: *Pasillo 2, a la derecha, al fondo*). Elegís un producto y una cantidad, y tocás los
  casilleros para cargarlos (o "Llenar todo el pallet"). Las filas son **A–C** y las columnas **1–3**.
  El stock de cada producto es la suma de sus casilleros.
- 📋 **Trabajos**: cada trabajo es **de un cliente**. Elegís el cliente (o lo creás ahí mismo),
  una referencia opcional (ej: *Pedido Nº 1002*), **qué empleado lo hace** y los productos:
  escribís el **código** y la cantidad (ej: `BIS-35` × 5). Si el código no existe, la app te avisa.
  Ves el avance de cada trabajo.

**Empleado**
- Ve solo **sus** trabajos, con el nombre del cliente, y le aparece un aviso (con vibración) cuando le llega uno nuevo.
- Abre el trabajo y ve **de qué cliente es** (con teléfono y dirección). En la misma pantalla, cada producto muestra:
  - el **código** del producto (ej: `COR-45`), el nombre y el color,
  - **cuánto** agarrar (ej: *5 unidades*),
  - **dónde está en el galpón** (ej: *📍 Pasillo 1, a la izquierda, al fondo · Pallet A*),
  - el pallet **3×3 como un tateti** con el casillero de ese color **resaltado y titilando**,
    y cuántas unidades sacar (ej: `A1 → 5 u.`).
- Toca **"Ya lo agarré"** en cada producto y el stock se descuenta solo. Cuando agarró todo,
  marca el trabajo como terminado.
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

Viene con datos de ejemplo (3 clientes, 9 productos con código, un pallet 3×3 con un color en cada casillero, el empleado `juan` / `1234` y un trabajo de *Carpintería López*).
Para empezar de cero, cerrá el servidor y borrá la carpeta `data/`.

El tamaño del pallet se cambia en `server.js` (`const GRID = 3`).

## Si ves una versión vieja (por ejemplo, el pallet de 9×9)

1. Cerrá **todas** las ventanas negras de la app (si hay una vieja abierta, sigue mostrando lo viejo).
2. Borrá las carpetas y los `.zip` viejos que bajaste, bajá el `.zip` de nuevo y extraelo.
3. Abrí `ABRIR-APP-HERRAJES.bat`. Abajo de la pantalla de ingreso tiene que decir **"Versión 3"**.

## Datos y respaldo

Todo se guarda en `data/db.json`. Copiá ese archivo para hacer un respaldo.

Para usarla desde fuera del local (con datos móviles) hay que subir el servidor a un hosting
(Render, Railway, un VPS, etc.) con HTTPS. Variables opcionales: `PORT` y `DATA_DIR`.

## Pruebas

```bash
node test.js
```
