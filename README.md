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
* El catálogo agrega J=Activo; los artículos inactivos se conservan para historial, pero no se ofrecen en nuevos movimientos.
* Las imágenes del catálogo se cargan localmente desde `assets/accesorios/` usando el SKU como nombre (`FOR-G06.png`, `VID-G22.jpg`, etc.). La aplicación busca `.png`, `.jpg`, `.jpeg` y `.webp` automáticamente.
* `Registro de Movimientos`: usa A=ID_Transacción, B=Fecha_Hora, C=ID_Articulo, D=Tipo_Movimiento, E=Cantidad, F=Registrado_Por, G=Entregado_A_Usuario, H=Cliente_Proveedor, I=Regional, J=Estado, K=ID_Transacción_Relacionada, L=Motivo, M=Regional_Origen y N=Regional_Destino.
* Las salidas siempre se registran por distribución: cada fila contiene cliente, artículo, regional, cantidad y usuario destinatario. El registrador se toma de la sesión autenticada.
* Las entradas no usan distribución: requieren proveedor, el destino se registra automáticamente como `Comunicaciones` en `Bogota` y el registrador también se toma de la sesión.
* Los tipos disponibles son `Entrada`, `Salida`, `Devolucion`, `Ajuste positivo`, `Ajuste negativo` y `Baja por daño`. Una `Devolucion` representa un artículo que se devuelve al proveedor por garantía, daño o entrega incorrecta, y descuenta stock de Comunicaciones. Un ajuste positivo corrige faltantes a favor del inventario; uno negativo corrige sobrantes registrados y resta stock. Las correcciones se realizan con `reversar_movimiento` o `anular_movimiento`, nunca borrando filas.
* El catálogo permite editar descripción, stock mínimo y estado activo/inactivo. Los artículos inactivos no aparecen para nuevos movimientos.
* La bóveda de usuarios conserva el ID configurado en `ID_BOVEDA_USUARIOS`.
* La bóveda de usuarios usa A=Usuario, B=Clave protegida, C=Rol, D=Activo, E=Intentos_Fallidos, F=Bloqueado_Hasta y G=Ultimo_Acceso. Las claves antiguas se migran a hash con salt al iniciar sesión correctamente.
* Después de cinco intentos fallidos, la cuenta se bloquea durante 15 minutos. Las nuevas claves y los cambios de contraseña se guardan siempre como hash, nunca en texto plano.

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
