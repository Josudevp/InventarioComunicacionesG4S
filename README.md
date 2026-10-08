# Sistema de Inventario de Comunicaciones G4S

Aplicación Web Progresiva (PWA) para la gestión de inventario, equipos y accesorios.
Conectada a Google Sheets a través de Apps Script (API Universal).

## Características
* Autenticación en bóveda separada.
* Cambio de contraseña.
* Escáner QR integrado.
* Búsqueda inteligente del catálogo.
* Creación de accesorios.
* PWA instalable en iOS y Android.

## Seguridad y operación
* La identidad guardada en el navegador solo mantiene la sesión de la pestaña; no reemplaza la autenticación del servidor.
* Tras un login correcto, Apps Script debe devolver un token corto en `token`. La aplicación lo envía como `Authorization: Bearer <token>` y dentro del JSON en las acciones posteriores.
* Apps Script debe validar autenticación y permisos en cada acción (`obtener_catalogo`, `registrar_movimiento`, `crear_accesorio` y `cambiar_clave`). Nunca debe confiar en un usuario o rol enviado por el cliente.
* Las operaciones deben validar SKU, cantidades y existencias de forma atómica en el servidor.
* Las dependencias externas deben fijarse a versiones verificadas y servirse con Subresource Integrity o alojarse localmente.

## Logo personalizado
La ruta configurable está en [index.html](./index.html), en la constante `LOGO_URL`:

```js
const LOGO_URL = "assets/mi-logo-g4s.png";
```

También puede ser una URL HTTPS pública:

```js
const LOGO_URL = "https://tu-dominio.example/logo-g4s.png";
```

Para una PWA instalada conviene usar una imagen local PNG de 180x180 o mayor.

## Apps Script
El código actualizado está en [apps-script/Code.gs](./apps-script/Code.gs) y conserva tus hojas actuales:

* `Maestro de inventario`: usa A=ID, B=Categoría, C=Descripción, D=Stock inicial, E=Entradas, F=Salidas, G=Stock_Actual, H=Stock_Minimo_Alerta e I=Foto_URL.
* `Registro de Movimientos`: usa A=ID_Transacción, B=Fecha_Hora, C=ID_Articulo, D=Tipo_Movimiento, E=Cantidad, F=Entregado_Por_Tecnico, G=Entregado_A_Usuario, H=Cliente e I=Regional.
* La bóveda de usuarios conserva el ID configurado en `ID_BOVEDA_USUARIOS`.

Configura en Propiedades del proyecto:

```text
PHOTOS_FOLDER_ID=ID_DE_LA_CARPETA_DE_DRIVE
ADMIN_USERS=usuario1,usuario2
```

`SPREADSHEET_ID` es opcional cuando el Apps Script está vinculado al Sheet principal. Si es un proyecto independiente, también debes configurarlo.

El backend registra un mismo lote para varios clientes mediante varias filas con el mismo `ID_Transacción`, validando que la suma por artículo coincida con el carrito. Además usa `LockService` para evitar que dos salidas descuenten el mismo stock simultáneamente.

El frontend envía el token en el JSON porque los web apps de Apps Script no exponen siempre los encabezados HTTP al evento `doPost`.

## Despliegue
Esta aplicación está diseñada para desplegarse en Netlify con integración continua desde GitHub.
