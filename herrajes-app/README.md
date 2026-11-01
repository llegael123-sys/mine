# Herrajes · App de depósito para el celular

App para una empresa de herrajes: el encargado asigna **tareas / pedidos** a los empleados,
y cada empleado ve en su celular **qué casillero del pallet (9×9) tiene que agarrar**,
resaltado con el color del producto.

## Qué hace

**Administrador (vos)**
- 👷 **Empleados**: crear cuentas (usuario + contraseña), cambiar contraseñas, borrar cuentas.
- 🔩 **Productos**: nombre, código, nombre del color y color (ej: *Manija barral 128mm · Negro*).
  Cada producto + color es un producto distinto.
- 🟫 **Pallets 9×9**: elegís un producto y una cantidad, y tocás los casilleros para cargarlos
  (o "Llenar todo el pallet"). Las filas son **A–I** y las columnas **1–9**.
  El stock de cada producto es la suma de sus casilleros.
- 📋 **Tareas**: título, a quién se la asignás, indicaciones y la lista del pedido
  (ej: *5 unidades de Bisagra Níquel*). Ves el avance de cada tarea.

**Empleado**
- Ve solo **sus** tareas.
- Abre el pedido, toca un producto y la app le muestra el pallet con los casilleros a agarrar
  **resaltados y titilando**, con cuántas unidades sacar de cada uno (ej: `C1 → 20 u.`, `C2 → 10 u.`).
- Toca **"Ya lo agarré"** y el stock se descuenta solo. Cuando agarró todo, marca la tarea como terminada.
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

Viene con datos de ejemplo (9 productos, un pallet lleno, el empleado `juan` / `1234` y un pedido).
Para empezar de cero, cerrá el servidor y borrá la carpeta `data/`.

## Datos y respaldo

Todo se guarda en `data/db.json`. Copiá ese archivo para hacer un respaldo.

Para usarla desde fuera del local (con datos móviles) hay que subir el servidor a un hosting
(Render, Railway, un VPS, etc.) con HTTPS. Variables opcionales: `PORT` y `DATA_DIR`.

## Pruebas

```bash
node test.js
```
