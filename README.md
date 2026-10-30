# Sistema de Inventario de Comunicaciones G4S

Aplicación Web Progresiva (PWA) para administrar inventario, movimientos, solicitudes y reportes de Comunicaciones G4S. La interfaz se sirve como aplicación estática y se conecta a Google Sheets mediante un web app de Google Apps Script.

## Contenido

- [Requisitos y desarrollo local](#requisitos-y-desarrollo-local)
- [Arquitectura](#arquitectura)
- [Funciones de la aplicación](#funciones-de-la-aplicación)
- [Indicadores y reportes](#indicadores-y-reportes)
- [Accesibilidad y diseño adaptable](#accesibilidad-y-diseño-adaptable)
- [Seguridad y operación](#seguridad-y-operación)
- [Configuración de Apps Script](#apps-script)
- [Despliegue](#despliegue)

## Requisitos y desarrollo local

Requiere Node.js 20 o posterior y npm. Instala las dependencias fijadas por `package-lock.json` e inicia Vite:

```bash
npm ci
npm run dev
```

Antes de publicar, ejecuta las pruebas y genera la versión de producción:

```bash
npm test
npm run build
npm run preview
```

`npm run build` genera `dist/`, copia los recursos públicos y prepara el precache del service worker. Vite muestra una advertencia si algún paquete supera el umbral configurado de tamaño; comprueba el resultado del build antes de publicar.

## Arquitectura

* `index.html` define la estructura, navegación y pantallas de la aplicación.
* `src/main.js` gestiona sesión, eventos, estados de interfaz, solicitudes, reportes y exportaciones.
* `src/DashboardCharts.jsx` monta los gráficos del dashboard y de analítica con React y Recharts; la carga se mantiene separada del resto de la interfaz.
* `src/tailwind.css` contiene los estilos de Tailwind, los temas claro/oscuro, los estados de controles y los ajustes de Choices.js.
* `src/services/api.js` centraliza las solicitudes al web app de Apps Script.
* `apps-script/Code.gs` implementa las acciones, validaciones, permisos y reglas transaccionales del backend.
* `tests/apps-script-workflow.test.mjs` prueba los flujos del backend con hojas de cálculo simuladas.
* `package-lock.json` fija las versiones de las dependencias frontend.

## Funciones de la aplicación

* Inicio de sesión en bóveda separada, cambio de contraseña y cierre de sesión por inactividad.
* Búsqueda del catálogo con Choices.js, alta y edición de accesorios y lectura de códigos QR cuando el dispositivo permite el acceso a la cámara.
* Registro de movimientos con controles de stock y distribución de salidas por cliente, artículo, regional, cantidad y persona destinataria.
* Solicitudes con varias líneas y clientes para una regional y persona destinataria compartidas. También se admiten solicitudes de Comunicaciones y la preparación de correos dirigidos a `capmovil@gmail.com`.
* Dashboard resumido con existencias, alertas, solicitudes abiertas, tiempos de entrega y cuatro gráficas operativas.
* Gráficas interactivas del dashboard: flujo mensual de entradas y salidas (6 o 12 meses y series conmutables), solicitudes por estado, entregas por regional y accesorios más entregados por periodo.
* Historial de movimientos con filtros multiselección por fecha, artículo, tipo, cantidad, cliente/proveedor, regional, estado y usuario. Los filtros se combinan y la fecha permite alternar el orden.
* Preferencia de tema claro/oscuro persistida en el navegador. El encabezado principal conserva una superficie oscura en ambos temas.
* PWA instalable en dispositivos compatibles con iOS y Android.

## Indicadores y reportes

La pestaña **Reportes** contiene el análisis de **Cobertura, reposición y eficiencia**, separado del dashboard para mantener el resumen operativo enfocado. Los parámetros configurables se guardan en el navegador. Al abrir la pestaña se actualiza el análisis; el botón de descarga solicita datos nuevos para que el archivo refleje los parámetros actuales.

Desde Reportes se descargan libros Excel del inventario, movimientos, solicitudes, análisis de inventario o un libro completo. Las consultas de movimientos y solicitudes recorren la paginación del backend.

El reporte **Análisis de inventario** incluye hojas de resumen, cobertura y reposición, solicitudes abiertas, inventario inmovilizado, clasificación ABC, proveedores, tiempos mensuales, recepciones recientes y solicitudes de proveedor pendientes. Los reportes de datos operativos reflejan el catálogo y el historial consultados al momento de descargar.

### Cómo interpretar los indicadores

* Ajusta el consumo reciente, plazo del proveedor, stock de seguridad, meta de entrega y periodo sin salidas; pulsa **Actualizar análisis** para consultar los indicadores.
* La cobertura compara el stock disponible con las salidas confirmadas promedio del periodo. La reposición sugerida cubre `consumo diario × (plazo del proveedor + stock de seguridad)` y respeta el stock mínimo. Tómala como recomendación para revisión, no como una orden automática.
* La antigüedad y las metas se miden en días calendario desde el registro de la solicitud. El vencimiento aplica a solicitudes de cliente que superan la meta configurada. El cumplimiento se calcula con solicitudes de cliente entregadas en los últimos 90 días; mediana y P90 muestran el tiempo típico y la cola de entregas más demoradas.
* Un artículo inmovilizado conserva stock positivo y no tiene salidas en el periodo elegido. El ABC ordena el valor consumido con el costo actual del catálogo: A hasta aproximadamente 80% acumulado, B hasta 95% y C el resto. Artículos sin costo quedan fuera de la valorización y se contabilizan aparte.
* La gráfica de proveedor mide días calendario entre **Fecha solicitud proveedor** y **Fecha recepción**, muestra la tendencia mensual de los últimos 12 meses, el comparativo por proveedor, las fechas de las recepciones recientes y las solicitudes pendientes. Registra el proveedor al cambiar la solicitud a **Solicitada** y la recepción al marcarla **Recibida** o **Cerrada**; solicitudes anuladas, sin proveedor identificado o con fechas incoherentes no se mezclan en la medición.
* Los valores de consumo y reposición son estimados: los costos usan el valor actual del catálogo, no necesariamente el costo histórico de cada compra. Los parámetros configurados se guardan solo en ese navegador.

## Accesibilidad y diseño adaptable

La interfaz incluye navegación por pestañas compatible con teclado (flechas izquierda/derecha, Inicio y Fin), un enlace para saltar al contenido principal, nombres accesibles para controles de icono, estados anunciados con regiones `aria-live`, anillos de foco visibles y colores adaptados a los temas claro y oscuro. Las tablas y formularios conservan su estructura en pantallas pequeñas; las tablas anchas se consultan mediante desplazamiento horizontal y los controles se reorganizan con breakpoints.

Para validar cambios de interfaz, comprueba los dos temas y tamaños de escritorio, tableta y móvil, además de navegar sin ratón. El build y las pruebas automáticas no sustituyen una auditoría manual con lector de pantalla ni una medición WCAG en cada vista.

## Seguridad y operación
* La identidad guardada en el navegador solo mantiene la sesión de la pestaña; no reemplaza la autenticación del servidor.
* La aplicación cierra la sesión después de una hora sin interacción. Apps Script extiende el vencimiento del token con cada solicitud autenticada (hasta seis horas desde la última actividad), para evitar que una jornada activa pierda la sesión por el tiempo transcurrido desde el login.
* Tras un login correcto, Apps Script debe devolver un token corto en `token`. La aplicación lo envía dentro del JSON en las acciones autenticadas posteriores, compatible con las limitaciones de encabezados de Apps Script.
* Apps Script debe validar autenticación y permisos en cada acción. Nunca debe confiar en un usuario o rol enviado por el cliente.
* Las operaciones deben validar SKU, cantidades y existencias de forma atómica en el servidor.
* Los registros de movimientos incluyen una clave de idempotencia y la huella de la solicitud en las columnas O y P. Si el navegador reintenta tras un error de comunicación, la misma operación devuelve el resultado anterior en lugar de crear otro movimiento.
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
* `Registro de Movimientos`: usa A=ID_Transacción, B=Fecha_Hora, C=ID_Articulo, D=Tipo_Movimiento, E=Cantidad, F=Registrado_Por, G=Entregado_A_Usuario, H=Cliente_Proveedor, I=Regional, J=Estado, K=ID_Transacción_Relacionada, L=Motivo, M=Regional_Origen, N=Regional_Destino, O=Clave_Idempotencia, P=Huella_Solicitud y Q=Justificacion_Anulacion. La aplicación completa O, P y Q.
* `Solicitudes` se crea automáticamente al usar la función. Cada solicitud puede tener varios artículos y clientes, pero una sola regional y persona destinataria compartida. También admite el tipo `Comunicaciones`, que oculta el correo del solicitante y el enlace a hilos anteriores; el proveedor inicia en `CAPMOVIL` con la opción alternativa `Otro`. La plantilla abre un correo nuevo dirigido a `capmovil@gmail.com`, con copia a los contactos configurados en la aplicación.
* La hoja `Solicitudes` agrega X=`Fecha_Revision_Disponibilidad`, Y=`Justificacion_Anulacion` y Z=`Tipo_Solicitud`, sin desplazar las columnas existentes.
* El flujo para clientes es `Registrada` → `Revisión de disponibilidad`: con stock, la aplicación confirma el despacho y registra una `Salida`; sin stock, sigue `Solicitada` al proveedor → `Recibida` (`Entrada`) → `Entregada` (`Salida`). Comunicaciones sigue `Registrada` → `Solicitada` al proveedor → `Cerrada`; la recepción registra una `Entrada`, suma el stock y cierra la solicitud sin despacho. Cada transición valida el estado y se ejecuta bajo `LockService`.
* Los usuarios operativos pueden registrar `Entrada`, `Salida` y `Baja por daño`; `Devolucion` y los ajustes positivo/negativo quedan reservados a administradores. Solo administradores pueden anular movimientos o solicitudes, y la anulación requiere una justificación que queda en la hoja. Las anulaciones no crean movimientos inversos ni afectan el saldo.
* En Catálogo, `Auditar saldos y movimientos` compara las fórmulas con el saldo reconstruido e identifica la transacción que primero dejó un artículo negativo. Administradores pueden regenerar fórmulas; esto no modifica el historial. Los negativos contables deben corregirse anulando el movimiento incorrecto con justificación o registrando el ajuste aprobado, nunca cambiando el stock directamente.
* Después de desplegar el cambio de anulaciones, un administrador debe regenerar una vez las fórmulas desde Catálogo. Además de actualizar las fórmulas, esto marca como anulados los contramovimientos de anulaciones antiguas, evitando su efecto duplicado; las filas se conservan para auditoría.
* El gráfico de flujo mensual agrega cantidades por mes desde movimientos contabilizados; el gráfico circular distribuye las solicitudes por estado actual; el gráfico regional suma unidades de movimientos `Salida` confirmados; y el gráfico de accesorios compara entregas para el periodo elegido. Las anulaciones nuevas se excluyen del saldo y no crean movimientos adicionales. Los movimientos históricos con estado `Reversado` se conservan para que sus asientos existentes sigan equilibrando el saldo.
* `Tiempo promedio de entrega` mide desde el registro hasta la entrega de solicitudes completadas.
* Las salidas siempre se registran por distribución: cada fila contiene cliente, artículo, regional, cantidad y usuario destinatario. El registrador se toma de la sesión autenticada.
* Las entradas no usan distribución: requieren proveedor, el destino se registra automáticamente como `Comunicaciones` en `Bogota` y el registrador también se toma de la sesión.
* Los tipos disponibles son `Entrada`, `Salida`, `Devolucion`, `Ajuste positivo`, `Ajuste negativo` y `Baja por daño`. Una `Devolucion` representa un artículo que se devuelve al proveedor por garantía, daño o entrega incorrecta, y descuenta stock de Comunicaciones. Un ajuste positivo corrige faltantes a favor del inventario; uno negativo corrige sobrantes registrados y resta stock. La única acción de corrección disponible en el historial es `Anular`: marca el movimiento original como `Anulado`, lo excluye de saldos y reportes y no crea una transacción inversa. El registro original se conserva para auditoría.
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
