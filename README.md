# Sistema de Inventario de Comunicaciones G4S

Aplicación Web Progresiva (PWA) para la gestión de inventario, equipos y accesorios.
Conectada a Google Sheets a través de Apps Script (API Universal) y autenticada mediante Google Firebase (SSO).

## Características
* **Autenticación SSO:** Acceso restringido a usuarios del dominio autorizado.
* **Escáner QR Integrado:** Lectura de SKU en tiempo real con la cámara del dispositivo.
* **Búsqueda Inteligente:** Catálogo sincronizado para búsqueda manual con autocompletado.
* **CRUD de Accesorios:** Creación de nuevos ítems directamente desde la aplicación.
* **PWA:** Instalable en iOS y Android, funcionando como aplicación nativa.
* **Base de Datos:** Google Sheets como backend con recálculo automático de stock.

## Despliegue
Esta aplicación está diseñada para ser desplegada en **Netlify** con integración continua desde la rama `main` o `master`.

**Configuración de Firebase:**
Asegúrese de agregar el dominio de producción (ej. `tu-app.netlify.app`) a los dominios autorizados en la consola de Firebase Authentication.
