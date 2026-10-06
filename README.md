# Sistema de Inventario de Comunicaciones G4S

Aplicación Web Progresiva (PWA) para la gestión de inventario, equipos y accesorios.
Conectada a Google Sheets a través de Apps Script (API Universal).
**Autenticación local Bóveda Separada.**

## Características
* **Autenticación en Bóveda:** Validada contra un Excel secundario secreto, inalcanzable para usuarios regulares.
* **Cambio de Contraseña:** Los usuarios pueden cambiar su clave desde la app.
* **Escáner QR Integrado:** Lectura de SKU en tiempo real con la cámara del dispositivo.
* **Búsqueda Inteligente:** Catálogo sincronizado para búsqueda manual con autocompletado.
* **CRUD de Accesorios:** Creación de nuevos ítems directamente desde la aplicación.
* **PWA:** Instalable en iOS y Android, funcionando como aplicación nativa.

## Despliegue
Esta aplicación está diseñada para ser desplegada en **Netlify** con integración continua desde GitHub.
