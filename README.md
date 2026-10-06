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
El código base está en [apps-script/Code.gs](./apps-script/Code.gs).

1. Crea las hojas `Usuarios`, `Catalogo` y `Movimientos`.
2. Configura la propiedad de proyecto `SPREADSHEET_ID`.
3. Usa los encabezados indicados al inicio de `Code.gs`.
4. Genera las contraseñas como SHA-256; nunca las guardes en texto plano.
5. Despliega como aplicación web ejecutada por tu cuenta.
6. Restringe quién puede acceder y valida el token en cada acción.

El frontend envía el token en el JSON porque los web apps de Apps Script no exponen siempre los encabezados HTTP al evento `doPost`.

## Despliegue
Esta aplicación está diseñada para desplegarse en Netlify con integración continua desde GitHub.
