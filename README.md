# Sistema de Inventario de Comunicaciones G4S

Aplicación Web Progresiva (PWA) para la gestión de inventario, equipos y accesorios.
Conectada a Google Sheets a través de Apps Script (API Universal).

## Desarrollo y arquitectura
* `index.html` contiene la estructura de la aplicación.
* `src/main.js` inicia la interfaz y carga las dependencias frontend.
* `src/tailwind.css` define las capas base y componentes de Tailwind; los ajustes específicos de Choices.js permanecen en esta hoja.
* `src/services/api.js` centraliza las solicitudes autenticadas a Apps Script.
* `apps-script/Code.gs` conserva el backend y sus reglas de negocio.
* Vite genera el sitio en `dist/`; el paso posterior copia assets, manifiesto y service worker y añade los archivos compilados al precache.
* `npm test` valida las transiciones de inventario y los permisos del backend con hojas de cálculo simuladas.

Requiere Node.js 20 o posterior. Para trabajar localmente:

```bash
npm install
npm run dev
```

Para generar y revisar el sitio de producción:

```bash
npm run build
npm run preview
```

GitHub Pages publica `dist/` automáticamente al hacer push a `main`, mediante [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml). Netlify también puede publicar `dist/` con [`.netlify.toml`](./.netlify.toml). El build usa rutas relativas para soportar el subdirectorio de Pages.

Para habilitar Pages por primera vez, abre **Settings → Pages** en GitHub y selecciona **GitHub Actions** como fuente. El workflow ejecuta `npm ci`, `npm test`, `npm run build` y publica el resultado. La URL aparecerá en **Settings → Pages** y en el deployment del workflow.

El endpoint activo está en `src/services/api.js`. Si necesitas configurarlo distinto en GitHub, agrega una variable de Actions llamada `VITE_API_URL`; localmente puedes definirla en `.env.local` usando [.env.example](./.env.example). No pongas tokens de sesión ni contraseñas en variables públicas de Vite.

## Características
* Autenticación en bóveda separada.
* Cambio de contraseña.
* Escáner QR integrado.
* Búsqueda inteligente del catálogo.
* Creación de accesorios.
* Dashboard con existencias, alertas de stock, solicitudes abiertas, promedio de entrega y compras al proveedor.
* Solicitudes por artículo, cliente, regional y destinatario, con seguimiento de proveedor hasta la entrega.
* PWA instalable en iOS y Android.

## Seguridad y operación
* La identidad guardada en el navegador solo mantiene la sesión de la pestaña; no reemplaza la autenticación del servidor.
* Tras un login correcto, Apps Script debe devolver un token corto en `token`. La aplicación lo envía dentro del JSON en las acciones autenticadas posteriores, compatible con las limitaciones de encabezados de Apps Script.
* Apps Script debe validar autenticación y permisos en cada acción. Nunca debe confiar en un usuario o rol enviado por el cliente.
* Las operaciones deben validar SKU, cantidades y existencias de forma atómica en el servidor.
* Antes de registrar salidas, reversos o entregas de solicitudes, el backend calcula el saldo desde el stock inicial y los movimientos confirmados bajo `LockService`; las fórmulas visibles de la hoja no autorizan cambios de stock.
* Las dependencias frontend se fijan mediante `package-lock.json` y se empaquetan localmente durante el build.

## Logo personalizado
La ruta configurable está en [src/main.js](./src/main.js), en la constante `LOGO_URL`:

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
* El catálogo usa J=Activo y K=Costo_Unitario_COP. El costo se captura una vez por accesorio desde alta/edición y se puede actualizar cuando cambia el precio base.
* Al crear una solicitud se copia el costo actual como referencia; al marcarla `Solicitada` se toma una nueva copia del precio vigente para congelar el valor de esa compra. Cambios futuros al catálogo no alteran el gasto histórico del KPI.
* Los accesorios existentes empiezan sin costo conocido; carga su valor una sola vez en Catálogo → Editar catálogo. El KPI de gasto los considera cuando tengan costo y se soliciten al proveedor.
* Los artículos inactivos se conservan para historial, pero no se ofrecen en nuevos movimientos.
* Las imágenes del catálogo se cargan localmente desde `assets/accesorios/` usando el SKU como nombre (`FOR-G06.png`, `VID-G22.jpg`, etc.). La aplicación busca `.png`, `.jpg`, `.jpeg` y `.webp` automáticamente.
* `Registro de Movimientos`: usa A=ID_Transacción, B=Fecha_Hora, C=ID_Articulo, D=Tipo_Movimiento, E=Cantidad, F=Registrado_Por, G=Entregado_A_Usuario, H=Cliente_Proveedor, I=Regional, J=Estado, K=ID_Transacción_Relacionada, L=Motivo, M=Regional_Origen y N=Regional_Destino.
* `Solicitudes` se crea automáticamente al usar la función. Una solicitud puede tener varias líneas para distintos artículos, clientes y destinatarios; todos comparten el mismo estado.
* El flujo es `Registrada` → `Solicitada` → `Recibida` → `Entregada`. Las solicitudes se pueden anular desde `Registrada` o `Solicitada`, antes de recibir artículos; la anulación es terminal, queda auditada y no crea movimientos de inventario. Registrar o solicitar al proveedor no cambia existencias; recibir crea movimientos `Entrada`, y entregar crea movimientos `Salida` por destinatario. Cada transición valida el estado y se ejecuta bajo `LockService`.
* En Catálogo, `Auditar saldos y movimientos` compara las fórmulas con el saldo reconstruido e identifica la transacción que primero dejó un artículo negativo. Administradores pueden regenerar fórmulas; esto no modifica el historial. Los negativos contables deben corregirse revirtiendo el movimiento incorrecto o registrando el ajuste aprobado, nunca cambiando el stock directamente.
* El dashboard calcula compras del mes con la cantidad solicitada y la copia del costo unitario del catálogo. Los históricos sin costo aparecen como datos no disponibles, no como gasto cero.
* `Tiempo promedio de entrega` mide desde el registro hasta la entrega de solicitudes completadas. `Compras al proveedor / mes` promedia durante los últimos seis meses calendario las solicitudes marcadas como compradas.
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
CATALOG_EDITOR_USERS=usuario3,usuario4
```

Los administradores definidos por el rol `admin` o `ADMIN_USERS` conservan acceso al catálogo. `CATALOG_EDITOR_USERS` agrega usuarios específicos con permiso de creación y edición; las acciones se validan en Apps Script y no solo en la interfaz.

Para elegir usuarios:

1. Abre el proyecto de Apps Script asociado a la URL configurada.
2. En **Configuración del proyecto** → **Propiedades del script**, agrega `CATALOG_EDITOR_USERS`.
3. Como valor, escribe los usuarios exactamente como aparecen en la columna A de la bóveda, separados por comas. Ejemplo: `jperez,mlopez`.
4. Guarda y vuelve a desplegar el web app con una versión nueva de `Code.gs`.

Los usuarios que no estén en esa lista pueden consultar el catálogo, pero no crear, editar ni subir fotografías. `ADMIN_USERS` sigue habilitando estas acciones a los administradores actuales.

`SPREADSHEET_ID` es opcional cuando el Apps Script está vinculado al Sheet principal. Si es un proyecto independiente, también debes configurarlo.

El backend registra un mismo lote para varios clientes mediante varias filas con el mismo `ID_Transacción`, validando que la suma por artículo coincida con el carrito. Además usa `LockService` para evitar que dos salidas descuenten el mismo stock simultáneamente.

El frontend envía el token en el JSON porque los web apps de Apps Script no exponen siempre los encabezados HTTP al evento `doPost`.

### Procesamiento manual de solicitudes por correo

El trabajador de correo corre en Apps Script; no agrega credenciales al frontend ni requiere un servidor Node adicional. No hay un activador periódico: un administrador inicia cada lectura con **Leer correo** desde la pestaña **Solicitudes**. De esta manera, el trabajador no consulta Gmail ni solicita extracciones a Gemini hasta que alguien pulsa el botón. La cuenta configurada para ejecutar el web app debe tener acceso a la bandeja de Gmail. El trabajador busca mensajes no leídos y acepta el cuerpo de texto plano, con una conversión sencilla desde HTML como alternativa.

En **Configuración del proyecto → Propiedades del script**, define:

```text
GEMINI_API_KEY=clave_de_Google_AI_Studio
GEMINI_MODEL=gemini-3.8-flash
INVENTORY_EMAIL_ACCOUNT=sol.comunicaciones.g4s@gmail.com
```

`GEMINI_MODEL` es opcional. Crea la clave en Google AI Studio y guárdala únicamente como propiedad privada del script; nunca uses una variable `VITE_*`. La disponibilidad y cuota gratuita dependen de las condiciones vigentes de Google. El trabajador exige que la cuenta efectiva que ejecuta Apps Script coincida con `INVENTORY_EMAIL_ACCOUNT` y busca únicamente no leídos de la bandeja de entrada de esa cuenta (`in:inbox is:unread`). El web app debe ejecutarse como esa cuenta; si no coincide, se detiene sin consultar Gmail. El catálogo activo se incluye en el prompt; Gemini debe elegir el SKU exacto. Si no hay coincidencia clara, el correo se envía a revisión en lugar de inventar un producto.

En **Solicitudes**, los administradores usan **Leer correo** para iniciar el proceso. El web app debe estar desplegado para ejecutarse como la cuenta indicada por `INVENTORY_EMAIL_ACCOUNT`, con permisos concedidos para Gmail, hojas de cálculo y solicitudes externas. La página muestra cuántos mensajes sin leer encontró y, si hay errores, el ID del mensaje, el motivo y si quedó etiquetado para revisión o pendiente de reintento. Un resultado de cero revisados significa que no encontró correos no leídos; los errores definitivos de extracción se marcan como leídos, se etiquetan `Inventario/Error de procesamiento` y no se reintentan hasta que alguien los marque de nuevo como no leídos en Gmail. Los errores de acceso a Gemini (401/403) detienen el lote y dejan los correos sin leer y sin etiqueta, para no ocultarlos ni seguir llamando al servicio; verifica el proyecto asociado a `GEMINI_API_KEY`, el acceso al modelo y las restricciones de la clave. Los registros correctos quedan en `Solicitudes` con estado `Registrada`, visible en Seguimiento. Cada mensaje usa un ID determinista para evitar duplicados si la ejecución se interrumpe antes de marcarlo leído. Los errores temporales de Gemini (5xx o fallo de red) se reintentan hasta tres veces en el mismo clic; si persisten, el correo queda sin leer para el próximo intento manual. Si Gemini indica que se agotó la cuota (429), el sistema respeta el tiempo de reintento indicado por Google (o espera 24 horas si no lo informa), no vuelve a llamar durante ese periodo y deja el correo sin leer.

Para detener el activador de cinco minutos instalado anteriormente, elimínalo desde **Activadores** en Apps Script o ejecuta una vez `desactivarProcesamientoAutomaticoCorreos` desde el editor. La función anterior `configurarProcesamientoCorreos` se conserva por compatibilidad y ahora también elimina activadores, sin crear nuevos. Después de actualizar `apps-script/Code.gs`, publica una nueva versión del web app para habilitar el botón manual.

## Despliegue
El despliegue principal es GitHub Pages mediante el workflow que publica `dist/` al hacer push a `main`. Netlify continúa disponible como alternativa y también publica `dist/`.

La URL activa está definida en `src/services/api.js` y `.env.example`. Al actualizar el backend, publica una nueva versión del web app de Apps Script usando `apps-script/Code.gs` y configura `CATALOG_EDITOR_USERS` en las propiedades del script. La pestaña `Solicitudes` y sus encabezados se crean automáticamente en la hoja principal.
