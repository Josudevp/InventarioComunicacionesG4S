import Choices from "choices.js";
import "@fortawesome/fontawesome-free/css/fontawesome.css";
import "@fortawesome/fontawesome-free/css/solid.css";
import "choices.js/public/assets/styles/choices.min.css";
import "./tailwind.css";
import { apiRequest } from "./services/api.js";

        const LOGO_URL = "assets/LOGO.png";
        const THEME_STORAGE_KEY = 'g4sTheme';
        const themeToggleButtons = document.querySelectorAll('[data-theme-toggle]');

        function setColorTheme(theme) {
            const isDark = theme === 'dark';
            document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
            document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
            localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
            themeToggleButtons.forEach(button => {
                const icon = button.querySelector('i');
                const label = button.querySelector('[data-theme-label]');
                button.setAttribute('aria-pressed', String(isDark));
                button.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
                button.title = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
                icon.classList.toggle('fa-moon', !isDark);
                icon.classList.toggle('fa-sun', isDark);
                label.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
            });
        }

        setColorTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light');
        themeToggleButtons.forEach(button => {
            button.addEventListener('click', () => {
                setColorTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
            });
        });

        if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').then(() => console.log("PWA SW Registrado v11")); }

        const loginScreen = document.getElementById('login-screen');
        loginScreen.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse') return;
            loginScreen.style.setProperty('--pointer-x', `${event.clientX}px`);
            loginScreen.style.setProperty('--pointer-y', `${event.clientY}px`);
            loginScreen.classList.add('pointer-active');
        });
        loginScreen.addEventListener('pointerleave', () => {
            loginScreen.classList.remove('pointer-active');
        });

            let choicesInstance = null;
            let editChoicesInstance = null;
            let requestChoiceInstances = [];
            let distributionChoiceInstances = [];
        let Html5QrcodeScanner = null;
        let carrito = [];
        let html5QrcodeScanner = null;
        let catalogoActual = [];
        let distributionRows = [];
        let distributionConfirmed = false;
        let canManageCatalog = false;
        let canReconcileInventory = false;
        let requestDraft = [];
        let alertTimer = null;
        let catalogRequest = null;
        let historyMovementRows = [];
        let historyDateSortDirection = -1;
        let historyFilters = {
            fecha: [], articulo: [], tipo: [], cantidad: [],
            cliente: [], regional: [], estado: [], usuario: []
        };
        let activeHistoryFilter = '';
        let activeHistoryFilterTrigger = null;
        const historyFilterColumns = [
            { key: 'fecha', label: 'Fecha', emptyLabel: 'Sin fechas disponibles', value: row => {
                const date = new Date(row.fechaHora);
                if (Number.isNaN(date.getTime())) return null;
                return {
                    value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
                    label: date.toLocaleDateString('es-CO')
                };
            } },
            { key: 'articulo', label: 'Artículo', emptyLabel: 'Sin artículos disponibles', value: row => ({ value: String(row.idArticulo || ''), label: `${window.nombreArticulo(row.idArticulo)} (${row.idArticulo || ''})` }) },
            { key: 'tipo', label: 'Tipo', emptyLabel: 'Sin tipos disponibles', value: row => ({ value: String(row.tipoMovimiento || ''), label: String(row.tipoMovimiento || '') }) },
            { key: 'cantidad', label: 'Cantidad', emptyLabel: 'Sin cantidades disponibles', value: row => ({ value: String(Number(row.cantidad) || 0), label: `${Number(row.cantidad) || 0} unidades` }) },
            { key: 'cliente', label: 'Cliente/Proveedor', emptyLabel: 'Sin clientes o proveedores disponibles', value: row => {
                const value = row.clienteProveedor || row.entregadoA || '—';
                return { value: String(value), label: String(value) };
            } },
            { key: 'regional', label: 'Regional', emptyLabel: 'Sin regionales disponibles', value: row => {
                const value = row.regional || row.regionalOrigen || row.regionalDestino || '—';
                return { value: String(value), label: String(value) };
            } },
            { key: 'estado', label: 'Estado', emptyLabel: 'Sin estados disponibles', value: row => ({ value: String(row.estado || 'Confirmado'), label: String(row.estado || 'Confirmado') }) },
            { key: 'usuario', label: 'Usuario', emptyLabel: 'Sin usuarios disponibles', value: row => ({ value: String(row.registradoPor || ''), label: String(row.registradoPor || '') }) }
        ];
        let dashboardChartData = null;
        let dashboardRequestStates = {};
        let dashboardRegionalData = [];
        let dashboardAccessoryData = [];
        let dashboardAccessoryPeriods = {};
        let dashboardAccessoryPeriod = 'historico';
        let dashboardChartMonths = 6;
        let dashboardVisibleSeries = { entradas: true, salidas: true };
        let dashboardSelectedRequestState = '';
        let dashboardSelectedRegional = '';
        let dashboardSelectedAccessory = '';
        let dashboardChartsModulePromise = null;
        let inactivityTimer = null;
        const storedUserActivity = sessionStorage.getItem("g4sLastActivity");
        let lastUserActivity = storedUserActivity ? Number(storedUserActivity) : Date.now();
        const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

        function renderDashboardChart(renderer, element, props) {
            dashboardChartsModulePromise ||= import('./DashboardCharts.jsx');
            void dashboardChartsModulePromise
                .then(charts => {
                    const render = charts[renderer];
                    if (!render) throw new Error(`Renderizador de gráfica no reconocido: ${renderer}`);
                    render(element, props);
                })
                .catch(error => {
                    console.error('No se pudo cargar una gráfica del dashboard:', error);
                    const feedback = document.getElementById(
                        renderer === 'renderSupplierLeadChart' ? 'supplier-lead-feedback' : 'dashboard-feedback'
                    );
                    feedback.textContent = `No se pudieron cargar las gráficas: ${error.message}`;
                    feedback.hidden = false;
                    feedback.classList.add('is-error');
                });
        }

        function resetInactivityTimer() {
            if (!sessionStorage.getItem("g4sSessionToken")) return;
            lastUserActivity = Date.now();
            sessionStorage.setItem("g4sLastActivity", String(lastUserActivity));
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastUserActivity);
                if (remaining > 0) {
                    inactivityTimer = setTimeout(window.verificarInactividad, remaining);
                    return;
                }
                window.cerrarSesion();
                window.mostrarAlerta("La sesión se cerró por una hora de inactividad. Inicia sesión para continuar.", "info");
            }, INACTIVITY_TIMEOUT_MS);
        }

        window.verificarInactividad = function() {
            const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastUserActivity);
            if (remaining <= 0) {
                window.cerrarSesion();
                window.mostrarAlerta("La sesión se cerró por una hora de inactividad. Inicia sesión para continuar.", "info");
            } else {
                clearTimeout(inactivityTimer);
                inactivityTimer = setTimeout(window.verificarInactividad, remaining);
            }
        };

        ["pointerdown", "keydown", "touchstart", "input"].forEach(eventName => {
            document.addEventListener(eventName, resetInactivityTimer, { passive: true });
        });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) window.verificarInactividad();
        });

        document.querySelectorAll('[data-app-logo]').forEach(image => {
            image.src = LOGO_URL;
            image.addEventListener('error', () => {
                image.src = 'assets/g4s-logo-.svg';
            }, { once: true });
        });

        window.escapeHtml = function(value) {
            return String(value).replace(/[&<>"']/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
            }[character]));
        };

        window.mostrarAlerta = function(texto, tipo) {
            const alertBox = document.getElementById('alert-box');
            if (!alertBox) return;
            const variants = {
                success: { title: 'Listo', icon: 'fa-circle-check', role: 'status' },
                error: { title: 'No se pudo completar', icon: 'fa-circle-xmark', role: 'alert' },
                warning: { title: 'Atención', icon: 'fa-triangle-exclamation', role: 'alert' },
                info: { title: 'Información', icon: 'fa-circle-info', role: 'status' }
            };
            const variant = variants[tipo] || variants.info;
            document.getElementById('alert-title').textContent = variant.title;
            document.getElementById('alert-message').textContent = texto;
            document.getElementById('alert-icon').innerHTML = `<i class="fa-solid ${variant.icon}"></i>`;
            alertBox.className = `alert-box alert-${tipo in variants ? tipo : 'info'} is-visible`;
            alertBox.setAttribute('role', variant.role);
            alertBox.hidden = false;
            clearTimeout(alertTimer);
            alertTimer = setTimeout(window.ocultarAlerta, 5500);
        };

        window.ocultarAlerta = function() {
            clearTimeout(alertTimer);
            const alertBox = document.getElementById('alert-box');
            alertBox.classList.remove('is-visible');
            alertBox.hidden = true;
        };

        document.getElementById('alert-dismiss').addEventListener('click', window.ocultarAlerta);

        window.confirmarAccion = function(mensaje, opciones = {}) {
            const modal = document.getElementById('confirm-dialog');
            const panel = modal.querySelector('.confirm-panel');
            const cancel = document.getElementById('confirm-cancel');
            const accept = document.getElementById('confirm-accept');
            const reasonField = document.getElementById('confirm-reason-field');
            const reasonInput = document.getElementById('confirm-reason');
            const reasonError = document.getElementById('confirm-reason-error');
            const previousFocus = document.activeElement;
            const requiresReason = Boolean(opciones.requireReason);
            reasonField.hidden = !requiresReason;
            reasonInput.value = '';
            reasonError.hidden = true;
            document.getElementById('confirm-title').textContent = opciones.titulo || 'Confirmar acción';
            document.getElementById('confirm-message').textContent = mensaje;
            panel.classList.toggle('is-danger', Boolean(opciones.danger));
            accept.textContent = opciones.confirmLabel || 'Confirmar';
            accept.classList.toggle('btn-danger', Boolean(opciones.danger));
            accept.classList.toggle('btn-primary', !opciones.danger);
            modal.hidden = false;

            return new Promise(resolve => {
                const finish = confirmed => {
                    if (confirmed && requiresReason && !reasonInput.value.trim()) {
                        reasonError.hidden = false;
                        reasonInput.focus();
                        return;
                    }
                    modal.hidden = true;
                    modal.onclick = null;
                    modal.onkeydown = null;
                    cancel.onclick = null;
                    accept.onclick = null;
                    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
                    resolve(confirmed ? (requiresReason ? reasonInput.value.trim() : true) : false);
                };
                cancel.onclick = () => finish(false);
                accept.onclick = () => finish(true);
                modal.onclick = event => { if (event.target === modal) finish(false); };
                modal.onkeydown = event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finish(false);
                    }
                    if (event.key === 'Tab') {
                        const focusable = requiresReason
                            ? [reasonInput, cancel, accept]
                            : [cancel, accept];
                        const currentIndex = focusable.indexOf(document.activeElement);
                        const nextIndex = event.shiftKey
                            ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                            : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
                        event.preventDefault();
                        focusable[nextIndex].focus();
                    }
                };
                if (requiresReason) reasonInput.focus();
                else panel.focus();
            });
        };

        window.onload = function() {
            // Do not persist an authenticated identity beyond the current tab.
            let loggedUser = sessionStorage.getItem("g4sLoggedUser");
            let sessionToken = sessionStorage.getItem("g4sSessionToken");
            if (loggedUser && sessionToken) {
                if (Date.now() - lastUserActivity >= INACTIVITY_TIMEOUT_MS) {
                    window.cerrarSesion();
                    window.mostrarAlerta("La sesión se cerró por una hora de inactividad. Inicia sesión para continuar.", "info");
                    return;
                }
                window.mostrarApp(loggedUser);
            } else {
                sessionStorage.removeItem("g4sLoggedUser");
                sessionStorage.removeItem("g4sSessionToken");
                sessionStorage.removeItem("g4sLastActivity");
                document.getElementById('login-screen').style.display = 'flex';
            }
        };

        window.mostrarPantallaCambioClave = function() {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('change-pass-screen').style.display = 'flex';
        }

        window.volverLogin = function() {
            document.getElementById('change-pass-screen').style.display = 'none';
            document.getElementById('login-screen').style.display = 'flex';
        }

        // REDIRECCION AUTOMÁTICA EN ERROR CORS
        window.iniciarSesion = function() {
            let user = document.getElementById('login-user').value.trim();
            let pass = document.getElementById('login-pass').value.trim();
            if(!user || !pass) { window.mostrarAlerta("Completa usuario y contraseña", "error"); return; }

            let btn = document.getElementById('btn-login');
            let originalTxt = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validando...';
            btn.disabled = true;

            // En lugar de fetch CORS directo, usamos un jsonp trick si falla o fetch simple
            apiRequest({ action: "login", usuario: user, clave: pass }, { authenticated: false })
            .then(res => res.json()).then(data => {
                if(data.status === "success") {
                    sessionStorage.setItem("g4sLoggedUser", data.usuario);
                    if (data.token) sessionStorage.setItem("g4sSessionToken", data.token);
                    canManageCatalog = Boolean(data.permissions && data.permissions.canManageCatalog);
                    canReconcileInventory = Boolean(data.permissions && data.permissions.canReconcileInventory);
                    window.mostrarApp(data.usuario);
                } else {
                    window.mostrarAlerta("❌ Usuario o contraseña incorrectos", "error");
                    btn.innerHTML = originalTxt; btn.disabled = false;
                }
            }).catch(e => {
                console.error("CORS Error detectado:", e);
                // Si hay error CORS, intentamos método alternativo JSONP o notificamos
                window.mostrarAlerta("❌ Error de comunicación con Excel. Revisa el Script.", "error");
                btn.innerHTML = originalTxt; btn.disabled = false;
            });
        };

        document.getElementById('login-form').addEventListener('submit', event => {
            event.preventDefault();
            window.iniciarSesion();
        });

        window.cambiarClave = function() {
            let user = document.getElementById('cp-user').value.trim();
            let oldP = document.getElementById('cp-old').value.trim();
            let newP = document.getElementById('cp-new').value.trim();

            if(!user || !oldP || !newP) { window.mostrarAlerta("Completa todos los campos", "error"); return; }
            if(newP.length < 8) { window.mostrarAlerta("La nueva clave debe tener al menos 8 caracteres", "error"); return; }

            let btn = document.getElementById('btn-change-pass');
            let originalTxt = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
            btn.disabled = true;

            apiRequest({ action: "cambiar_clave", usuario: user, claveAntigua: oldP, claveNueva: newP })
            .then(res => res.json()).then(data => {
                if(data.status === "success") {
                    window.mostrarAlerta("✅ Contraseña actualizada correctamente", "success");
                    document.getElementById('cp-user').value = ""; document.getElementById('cp-old').value = ""; document.getElementById('cp-new').value = "";
                    setTimeout(window.volverLogin, 1500);
                } else {
                    window.mostrarAlerta("❌ " + data.message, "error");
                }
                btn.innerHTML = originalTxt; btn.disabled = false;
            }).catch(e => {
                window.mostrarAlerta("❌ Error de red", "error");
                btn.innerHTML = originalTxt; btn.disabled = false;
            });
        }

        window.cerrarSesion = function() {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
            sessionStorage.removeItem("g4sLoggedUser");
            sessionStorage.removeItem("g4sSessionToken");
            canManageCatalog = false;
            canReconcileInventory = false;
            carrito = [];
            requestDraft = [];
            if (choicesInstance) {
                choicesInstance.destroy();
                choicesInstance = null;
            }
            [editChoicesInstance, ...requestChoiceInstances, ...distributionChoiceInstances].forEach(instance => {
                if (instance) instance.destroy();
            });
            editChoicesInstance = null;
            requestChoiceInstances = [];
            distributionChoiceInstances = [];
            if (html5QrcodeScanner) {
                html5QrcodeScanner.clear().catch(error => console.warn('No se pudo detener el escáner:', error));
                html5QrcodeScanner = null;
            }
            document.getElementById('items-list').innerHTML = '<li class="empty-cart-state" aria-live="polite">No hay ítems seleccionados</li>';
            document.querySelectorAll('#app-screen input[type="text"], #app-screen input[type="number"]').forEach(input => { input.value = ''; });
            document.getElementById('app-screen').style.display = 'none';
            document.getElementById('login-pass').value = '';
            document.getElementById('request-type').value = 'Cliente';
            document.getElementById('request-regional').value = 'Bogota';
            document.getElementById('request-recipient-field').hidden = false;
            document.getElementById('request-regional-field').hidden = false;
            document.getElementById('request-email-fields').hidden = false;
            document.getElementById('request-communications-flow').hidden = true;
            document.getElementById('request-form-guidance').textContent =
                'Todas las líneas comparten una regional y una persona destinataria.';
            window.actualizarPermisosCatalogo();

            let btn = document.getElementById('btn-login');
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> INGRESAR';
            btn.disabled = false;

            document.getElementById('login-screen').style.display = 'flex';
        };

        window.mostrarApp = function(nombreUsuario) {
            resetInactivityTimer();
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('change-pass-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            document.getElementById('user-email').innerText = "Usuario: " + nombreUsuario;
            window.actualizarPermisosCatalogo();
            if (!requestDraft.length) window.agregarLineaSolicitud();
            window.cargarCatalogo();
            window.cargarDashboard();
        }

        window.cargarCatalogo = function() {
            if (catalogRequest) return catalogRequest;
            if (!sessionStorage.getItem("g4sSessionToken")) {
                window.mostrarAlerta("La sesión anterior caducó. Inicia sesión nuevamente.", "error");
                window.cerrarSesion();
                return;
            }
                const syncButton = document.getElementById('btn-sync-catalog');
                if (syncButton) syncButton.disabled = true;
                catalogRequest = apiRequest({ action: "obtener_catalogo" })
            .then(res => res.json()).then(data => {
                if(data.status === "success") {
                    if (data.permissions) canManageCatalog = Boolean(data.permissions.canManageCatalog);
                    if (data.permissions) canReconcileInventory = Boolean(data.permissions.canReconcileInventory);
                    window.actualizarPermisosCatalogo();
                    catalogoActual = Array.isArray(data.data) ? data.data : [];
                    window.inicializarBuscador(catalogoActual);
                    window.renderizarCatalogo();
                    window.renderizarSolicitudBorrador();
                } else {
                    window.mostrarEstadoBuscador(data.message || 'No se pudo cargar el catálogo');
                    window.mostrarAlerta("❌ " + (data.message || "No se pudo cargar el catálogo"), "error");
                }
            }).catch(e => {
                console.error("Error catálogo:", e);
                window.mostrarEstadoBuscador('No se pudo conectar con el catálogo. Intenta sincronizar de nuevo.');
                window.mostrarAlerta("❌ No se pudo consultar Apps Script. Verifica el despliegue y vuelve a iniciar sesión.", "error");
            }).finally(() => {
                catalogRequest = null;
                if (syncButton) syncButton.disabled = false;
            });
            return catalogRequest;
        }

        window.mostrarEstadoBuscador = function(message) {
            if (choicesInstance) {
                choicesInstance.destroy();
                choicesInstance = null;
            }
            const select = document.getElementById('smart-search');
            select.replaceChildren(new Option(message, ''));
        };

        window.inicializarBuscador = function(datosCatalogo) {
            const select = document.getElementById('smart-search');
            if (choicesInstance) choicesInstance.destroy();
            if (!Array.isArray(datosCatalogo)) {
                window.mostrarAlerta("El catálogo recibido no tiene un formato válido", "error");
                return;
            }
            const opciones = datosCatalogo
                .filter(item => item && item.idArticulo && item.activo !== false)
                .map(item => {
                    const status = window.stockStatus(item);
                    return {
                        value: String(item.idArticulo),
                        label: String(item.descripcion || 'Sin descripción'),
                        customProperties: { stock: Number(item.stockActual) || 0, stockStatus: status.key }
                    };
                });
            select.replaceChildren();
            choicesInstance = new Choices(select, {
                searchEnabled: true,
                searchPlaceholderValue: 'Buscar coincidencias...',
                itemSelectText: '',
                shouldSort: false,
                fuseOptions: { threshold: 0, distance: 0, ignoreLocation: true },
                callbackOnCreateTemplates: template => ({
                    choice: (config, data, selectText) => {
                        const classNames = config.classNames;
                        const classes = [...classNames.item, ...classNames.itemChoice];
                        if (data.value === '') {
                            return template(`<div class="${[...classes, ...classNames.itemDisabled].join(' ')} choices__placeholder" role="option" aria-disabled="true" data-choice data-choice-disabled data-id="${data.id}" data-value="">${window.escapeHtml(data.label)}</div>`);
                        }
                        const stock = data.customProperties || {};
                        const stockClass = stock.stockStatus === 'low' ? ' low' : stock.stockStatus === 'empty' ? ' empty' : '';
                        const unavailable = stock.stockStatus === 'empty';
                        const stateClasses = unavailable ? classNames.itemDisabled : classNames.itemSelectable;
                        const unavailableClass = unavailable ? ' is-unavailable' : '';
                        const selectAttribute = unavailable ? 'data-choice-disabled aria-disabled="true"' : 'data-choice-selectable';
                        return template(`<div class="${[...classes, ...stateClasses].join(' ')}${unavailableClass}" role="option" data-select-text="${window.escapeHtml(selectText || '')}" data-choice data-id="${data.id}" data-value="${window.escapeHtml(data.value)}" ${selectAttribute}><div class="choice-with-stock"><span class="choice-description">${window.escapeHtml(data.label)}</span><span class="choice-stock${stockClass}">${Number(stock.stock) || 0} u.</span></div></div>`);
                    },
                    item: (config, data) => {
                        const stock = data.customProperties || {};
                        return template(`<div class="${config.classNames.item.join(' ')}" data-item data-id="${data.id}" data-value="${window.escapeHtml(data.value)}"><div class="choice-with-stock"><span class="choice-description">${window.escapeHtml(data.label)}</span><span class="choice-stock">${Number(stock.stock) || 0} u.</span></div></div>`);
                    }
                })
            });
            choicesInstance.setChoices([
                { value: '', label: 'Selecciona o busca un accesorio...', disabled: true },
                ...opciones
            ], 'value', 'label', true);
            window.renderizarDistribucion();
        }

        window.compatibilityNote = function(idArticulo) {
            const id = String(idArticulo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            return ['G14', 'G22', 'G24'].includes(id) ? ' · Vidrio compatible G14/G22/G24' : '';
        };

        window.stockStatus = function(item) {
            const stock = Number(item.stockActual) || 0;
            const minimum = Number(item.stockMinimo) || 0;
            if (stock <= 0) return { key: 'empty', label: 'Agotado', className: 'stock-empty' };
            if (stock <= minimum) return { key: 'low', label: 'Stock bajo', className: 'stock-low' };
            return { key: 'ok', label: 'Disponible', className: 'stock-ok' };
        };

        window.nombreArticulo = function(idArticulo) {
            const item = catalogoActual.find(entry => String(entry.idArticulo) === String(idArticulo));
            return item && item.descripcion ? String(item.descripcion) : 'Artículo no identificado';
        };

        window.safeImageUrl = function(value) {
            const url = String(value || '').trim();
            if (!url) return '';
            if (url.startsWith('assets/') || url.startsWith('https://')) return url;
            return '';
        };

        window.accessoryImageCandidates = function(idArticulo) {
            const id = String(idArticulo || '').trim();
            const names = [...new Set([id, id.replace(/-/g, '_'), id.replace(/_/g, '-')])];
            return names.flatMap(name => ['png', 'jpg', 'jpeg', 'webp'].map(extension => `assets/accesorios/${encodeURIComponent(name)}.${extension}`));
        };

        window.fallbackAccessoryImage = function(image) {
            const candidates = window.accessoryImageCandidates(image.dataset.articleId);
            const current = Number(image.dataset.candidateIndex || 0) + 1;
            if (current < candidates.length) {
                image.dataset.candidateIndex = String(current);
                image.src = candidates[current];
                return;
            }
            image.hidden = true;
            image.nextElementSibling.hidden = false;
        };

        window.cargarImagenArticulo = function(image, idArticulo) {
            const candidates = window.accessoryImageCandidates(idArticulo);
            image.dataset.articleId = String(idArticulo);
            image.dataset.candidateIndex = '0';
            image.src = candidates[0];
            image.onerror = () => window.fallbackAccessoryImage(image);
        };

        window.verImagenArticulo = function(idArticulo) {
            const modal = document.getElementById('image-modal');
            const preview = document.getElementById('image-modal-preview');
            const catalogItem = catalogoActual.find(item => String(item.idArticulo) === String(idArticulo));
            const descripcion = catalogItem ? catalogItem.descripcion : idArticulo;
            preview.alt = `Imagen ampliada de ${descripcion || idArticulo}`;
            preview.hidden = false;
            preview.dataset.articleId = String(idArticulo);
            preview.dataset.candidateIndex = '0';
            preview.onerror = () => {
                const candidates = window.accessoryImageCandidates(idArticulo);
                const current = Number(preview.dataset.candidateIndex || 0) + 1;
                if (current < candidates.length) {
                    preview.dataset.candidateIndex = String(current);
                    preview.src = candidates[current];
                } else {
                    window.cerrarImagenArticulo();
                }
            };
            preview.src = window.accessoryImageCandidates(idArticulo)[0];
            modal.hidden = false;
            modal.classList.add('visible');
        };

        window.cerrarImagenArticulo = function() {
            const modal = document.getElementById('image-modal');
            modal.classList.remove('visible');
            modal.hidden = true;
        };

        window.actualizarPermisosCatalogo = function() {
            document.querySelectorAll('[data-catalog-editor]').forEach(panel => {
                panel.hidden = !canManageCatalog;
            });
            document.querySelectorAll('[data-admin-only]').forEach(control => {
                control.hidden = !canReconcileInventory;
                control.disabled = !canReconcileInventory;
            });
            const movementType = document.getElementById('tipoMov');
            if (movementType && movementType.selectedOptions[0]?.disabled) {
                movementType.value = 'Salida';
                window.cambiarMovimientoUI('Salida');
            }
        };

        window.renderizarCatalogo = function() {
            const body = document.getElementById('catalog-table-body');
            const filter = document.getElementById('catalog-filter').value.trim().toLowerCase();
            const statusFilter = document.getElementById('catalog-stock-filter').value;
            const items = catalogoActual.filter(item => {
                const status = window.stockStatus(item);
                const text = `${item.idArticulo || ''} ${item.descripcion || ''}`.toLowerCase();
                return text.includes(filter) && (statusFilter === 'all' || status.key === statusFilter);
            }).sort((first, second) => {
                const stockDifference = (Number(first.stockActual) || 0) - (Number(second.stockActual) || 0);
                return stockDifference || String(first.descripcion || '').localeCompare(String(second.descripcion || ''), 'es');
            });
            if (!items.length) {
                body.innerHTML = '<tr><td colspan="9">No hay artículos que coincidan con el filtro.</td></tr>';
                return;
            }
            body.innerHTML = items.map(item => {
                const status = window.stockStatus(item);
                const compatibility = window.compatibilityNote(item.idArticulo);
                return `<tr>
                    <td><div class="catalog-image-wrap"><button type="button" class="catalog-image-button" onclick="window.verImagenArticulo('${window.escapeHtml(item.idArticulo)}')" aria-label="Ver imagen ampliada"><img class="catalog-photo" src="${window.accessoryImageCandidates(item.idArticulo)[0]}" data-article-id="${window.escapeHtml(item.idArticulo)}" data-candidate-index="0" alt="Imagen de ${window.escapeHtml(item.descripcion || item.idArticulo)}" onerror="window.fallbackAccessoryImage(this)"><span class="catalog-image-placeholder" hidden aria-label="Sin imagen">📷</span></button></div></td>
                    <td><strong>${window.escapeHtml(item.idArticulo)}</strong></td>
                    <td>${window.escapeHtml(item.descripcion || 'Sin descripción')}${compatibility ? `<div class="helper-text">${window.escapeHtml(compatibility.replace(' · ', ''))}</div>` : ''}</td>
                    <td>${Number(item.stockActual) || 0}</td>
                    <td>${Number(item.costoUnitario) > 0 ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(item.costoUnitario)) : 'Sin costo'}</td>
                    <td>${Number(item.stockMinimo) || 0}</td>
                    <td><span class="${status.className}">${status.label}</span></td>
                    <td>${item.activo === false ? 'Inactivo' : 'Activo'}</td>
                    <td>${canManageCatalog ? `<button type="button" class="btn-secondary photo-button" onclick="window.seleccionarEdicion('${window.escapeHtml(item.idArticulo)}')"><i class="fa-solid fa-pen"></i> Editar</button>` : '<span class="read-only-label">Consulta</span>'}</td>
                </tr>`;
            }).join('');
            window.renderizarSelectorEdicion();
        };

        window.renderizarSelectorEdicion = function() {
            const select = document.getElementById('edit-sku');
            const current = select.value;
            if (editChoicesInstance) {
                editChoicesInstance.destroy();
                editChoicesInstance = null;
            }
            select.replaceChildren();
            select.innerHTML = '<option value="">Selecciona un artículo</option>' + catalogoActual.map(item => `<option value="${window.escapeHtml(item.idArticulo)}">${window.escapeHtml(item.descripcion || item.idArticulo)}</option>`).join('');
            if (current) select.value = current;
            editChoicesInstance = new Choices(select, {
                searchEnabled: true,
                searchPlaceholderValue: 'Buscar artículo...',
                itemSelectText: '',
                shouldSort: false
            });
        };

        window.seleccionarEdicion = function(idArticulo) {
            const item = catalogoActual.find(entry => String(entry.idArticulo) === String(idArticulo));
            if (!item) return;
            document.getElementById('edit-sku').value = item.idArticulo;
            document.getElementById('edit-desc').value = item.descripcion || '';
            document.getElementById('edit-min').value = Number(item.stockMinimo) || 0;
            document.getElementById('edit-cost').value = Number(item.costoUnitario) || 0;
            document.getElementById('edit-active').checked = item.activo !== false;
            document.getElementById('edit-sku').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        document.getElementById('edit-sku').addEventListener('change', () => window.seleccionarEdicion(document.getElementById('edit-sku').value));
        document.getElementById('btn-editar-acc').addEventListener('click', () => {
            const idArticulo = document.getElementById('edit-sku').value;
            if (!idArticulo) {
                window.mostrarAlerta('Selecciona un artículo para editar', 'error');
                return;
            }
            const minimum = Number(document.getElementById('edit-min').value);
            if (!Number.isInteger(minimum) || minimum < 0) {
                window.mostrarAlerta('El stock mínimo debe ser un número entero igual o mayor que cero', 'error');
                return;
            }
            const button = document.getElementById('btn-editar-acc');
            button.disabled = true;
            apiRequest({
                action: 'actualizar_accesorio', idArticulo,
                descripcion: document.getElementById('edit-desc').value,
                stockMinimo: minimum,
                costoUnitario: document.getElementById('edit-cost').value,
                activo: document.getElementById('edit-active').checked
            }).then(response => response.json()).then(result => {
                if (result.status !== 'success') throw new Error(result.message || 'No se pudo actualizar el artículo');
                window.mostrarAlerta('Artículo actualizado', 'success');
                window.cargarCatalogo();
            }).catch(error => window.mostrarAlerta(error.message, 'error')).finally(() => { button.disabled = false; });
        });

        ['catalog-filter', 'catalog-stock-filter'].forEach(id => document.getElementById(id).addEventListener('input', window.renderizarCatalogo));

        window.actualizarSkuGenerado = function() {
            const category = document.getElementById('new-cat');
            const selected = category.options[category.selectedIndex];
            const prefix = selected ? selected.dataset.prefix || '' : '';
            const model = document.getElementById('new-model').value.trim().toUpperCase().replace(/\s+/g, '-');
            document.getElementById('new-sku').value = model ? prefix + model : '';
        };

        document.getElementById('new-cat').addEventListener('change', window.actualizarSkuGenerado);
        document.getElementById('new-model').addEventListener('input', window.actualizarSkuGenerado);
        window.actualizarSkuGenerado();

        window.subirFotografia = function(idArticulo, input) {
            const file = input.files && input.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                window.mostrarAlerta("La fotografía no puede superar 5 MB", "error");
                input.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = String(reader.result).split(',')[1];
                apiRequest({ action: 'subir_fotografia', idArticulo, fileName: file.name, mimeType: file.type, content: base64 }).then(res => res.json()).then(data => {
                    if (data.status !== 'success') throw new Error(data.message || 'No se pudo subir la fotografía');
                    const item = catalogoActual.find(row => String(row.idArticulo) === String(idArticulo));
                    if (item) item.fotoUrl = data.fotoUrl;
                    window.renderizarCatalogo();
                    window.mostrarAlerta("✅ Fotografía guardada en Drive", "success");
                }).catch(error => window.mostrarAlerta("❌ " + error.message, "error"));
            };
            reader.readAsDataURL(file);
        };

        window.renderizarDistribucion = function() {
            const container = document.getElementById('distribution-rows');
            distributionChoiceInstances.forEach(instance => instance.destroy());
            distributionChoiceInstances = [];
            const options = carrito.map(item => `<option value="${window.escapeHtml(item.idArticulo)}">${window.escapeHtml(window.nombreArticulo(item.idArticulo))}</option>`).join('');
            container.innerHTML = distributionRows.map((row, index) => `<div class="distribution-row">
                <input type="text" value="${window.escapeHtml(row.cliente)}" placeholder="Cliente" onchange="window.actualizarDistribucion(${index}, 'cliente', this.value)">
                <select class="distribution-product-label" onchange="window.actualizarDistribucion(${index}, 'idArticulo', this.value)">${options}</select>
                <select class="distribution-regional" onchange="window.actualizarDistribucion(${index}, 'regional', this.value)">
                    <option value="Bogota">Bogotá</option><option value="Eje Cafetero">Eje Cafetero</option><option value="Noroccidente">Noroccidente</option><option value="Sabana">Sabana</option><option value="Cordoba">Córdoba</option><option value="Costa">Costa</option><option value="Suroccidente">Suroccidente</option><option value="Santanderes">Santanderes</option>
                </select>
                <div><input type="text" value="${window.escapeHtml(row.usuario)}" placeholder="Usuario" onchange="window.actualizarDistribucion(${index}, 'usuario', this.value)"></div>
                <input type="number" min="${window.maxDistribucion(index) > 0 ? 1 : 0}" max="${window.maxDistribucion(index)}" value="${Math.min(row.cantidad || 1, window.maxDistribucion(index))}" aria-label="Cantidad" ${window.maxDistribucion(index) === 0 ? 'disabled' : ''} onchange="window.actualizarDistribucion(${index}, 'cantidad', this.value)">
                <button type="button" class="btn-danger" aria-label="Eliminar cliente" onclick="window.eliminarDistribucion(${index})"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');
            distributionRows.forEach((row, index) => {
                const rowElement = container.querySelectorAll('.distribution-row')[index];
                const select = rowElement && rowElement.querySelector('.distribution-product-label');
                if (select) select.value = row.idArticulo || (carrito[0] && carrito[0].idArticulo) || '';
                const regional = rowElement && rowElement.querySelector('.distribution-regional');
                if (regional) regional.value = row.regional || 'Bogota';
                rowElement.querySelectorAll('select').forEach(selectElement => {
                    const instance = new Choices(selectElement, {
                        searchEnabled: true,
                        searchPlaceholderValue: 'Buscar coincidencias...',
                        itemSelectText: '',
                        shouldSort: false,
                        searchResultLimit: 12
                    });
                    distributionChoiceInstances.push(instance);
                });
            });
            const totals = {};
            distributionRows.forEach(row => { totals[row.idArticulo] = (totals[row.idArticulo] || 0) + (Number(row.cantidad) || 0); });
            const summary = carrito.map(item => `${window.nombreArticulo(item.idArticulo)}: ${totals[item.idArticulo] || 0}/${item.cantidad}`).join(' · ');
            document.getElementById('distribution-summary').textContent = summary || 'Sin distribución agregada.';
        };

        window.maxDistribucion = function(index) {
            const row = distributionRows[index];
            if (!row || !row.idArticulo) return 1;
            const item = carrito.find(entry => entry.idArticulo === row.idArticulo);
            const assignedElsewhere = distributionRows.reduce((total, entry, entryIndex) => {
                return total + (entryIndex !== index && entry.idArticulo === row.idArticulo ? Number(entry.cantidad) || 0 : 0);
            }, 0);
            return Math.max(0, (item ? Number(item.cantidad) : 0) - assignedElsewhere);
        };

        window.actualizarDistribucion = function(index, field, value) {
            if (field === 'cantidad') {
                const maximum = window.maxDistribucion(index);
                distributionRows[index][field] = maximum > 0 ? Math.min(maximum, Math.max(1, Number(value) || 1)) : 0;
            } else {
                distributionRows[index][field] = value;
                if (field === 'idArticulo') {
                    const maximum = window.maxDistribucion(index);
                    distributionRows[index].cantidad = maximum > 0 ? Math.min(Number(distributionRows[index].cantidad) || 1, maximum) : 0;
                }
            }
            distributionConfirmed = false;
            document.getElementById('distribution-review').style.display = 'none';
            window.renderizarDistribucion();
        };
        window.eliminarDistribucion = function(index) {
            distributionRows.splice(index, 1);
            distributionConfirmed = false;
            window.renderizarDistribucion();
        };
        document.getElementById('btn-add-distribution').addEventListener('click', () => {
            const available = carrito.some(item => {
                const assigned = distributionRows.filter(row => row.idArticulo === item.idArticulo).reduce((sum, row) => sum + (Number(row.cantidad) || 0), 0);
                return assigned < Number(item.cantidad);
            });
            if (!available) {
                window.mostrarAlerta('Ya distribuiste toda la cantidad de los accesorios agregados', 'error');
                return;
            }
            distributionRows.push({ cliente: '', idArticulo: carrito[0]?.idArticulo || '', regional: 'Bogota', usuario: '', cantidad: 1 });
            distributionConfirmed = false;
            window.renderizarDistribucion();
        });
        document.getElementById('btn-add-search').addEventListener('click', () => {
            const selected = document.getElementById('smart-search').value;
            if (!selected) {
                window.mostrarAlerta('Selecciona un accesorio para agregarlo', 'error');
                return;
            }
            const selectedItem = catalogoActual.find(item => String(item.idArticulo) === String(selected));
            const isSalida = window.tipoMovimientoActual() === 'Salida';
            if (!selectedItem || (isSalida && Number(selectedItem.stockActual) <= 0)) {
                window.mostrarAlerta('Este accesorio no tiene stock disponible', 'error');
                return;
            }
            window.agregarAlCarrito(selected);
            if (choicesInstance) choicesInstance.removeActiveItems();
        });
        document.getElementById('btn-save-distribution').addEventListener('click', () => {
            const totals = {};
            const validRows = distributionRows.filter(row => row.cliente.trim() && row.idArticulo && row.usuario.trim() && row.regional && Number.isInteger(Number(row.cantidad)) && Number(row.cantidad) > 0);
            validRows.forEach(row => { totals[row.idArticulo] = (totals[row.idArticulo] || 0) + Number(row.cantidad); });
            const matches = carrito.length > 0 && carrito.every(item => totals[item.idArticulo] === Number(item.cantidad)) && validRows.length === distributionRows.length;
            if (!matches) {
                window.mostrarAlerta('Completa cada fila y verifica que la suma coincida con los accesorios agregados', 'error');
                return;
            }
            distributionConfirmed = true;
            const review = document.getElementById('distribution-review');
            review.innerHTML = '<strong>Distribución lista para registrar</strong>' + validRows.map(row => `<p class="helper-text">${window.escapeHtml(row.cliente)} · ${window.escapeHtml(window.nombreArticulo(row.idArticulo))} · ${row.cantidad} · ${window.escapeHtml(row.regional)} · ${window.escapeHtml(row.usuario)}</p>`).join('');
            review.style.display = 'block';
            document.getElementById('items-card').style.display = 'block';
            window.renderizarCarrito();
        });

        document.getElementById('btn-camera').addEventListener('click', async () => {
            const reader = document.getElementById('reader');
            if(reader.style.display === "block") { if(html5QrcodeScanner) html5QrcodeScanner.clear(); reader.style.display = "none"; return; }
            reader.style.display = "block";
            const cameraButton = document.getElementById('btn-camera');
            cameraButton.disabled = true;
            const originalLabel = cameraButton.innerHTML;
            cameraButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                if (!Html5QrcodeScanner) ({ Html5QrcodeScanner } = await import('html5-qrcode'));
            } catch (error) {
                reader.style.display = "none";
                window.mostrarAlerta("El escáner no está disponible. Usa la búsqueda manual.", "error");
                return;
            } finally {
                cameraButton.disabled = false;
                cameraButton.innerHTML = originalLabel;
            }
            html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
            html5QrcodeScanner.render((decodedText) => { window.agregarAlCarrito(decodedText); html5QrcodeScanner.clear(); reader.style.display = "none"; try { navigator.vibrate(200); } catch(e) {} }, (err) => {});
        });

        window.agregarAlCarrito = function(codigo) {
            const catalogItem = catalogoActual.find(item => String(item.idArticulo) === String(codigo));
            const isSalida = window.tipoMovimientoActual() === 'Salida';
            if (!catalogItem || (isSalida && Number(catalogItem.stockActual) <= 0)) {
                window.mostrarAlerta('No se puede agregar un accesorio sin stock disponible', 'error');
                return;
            }
            let existe = carrito.find(item => item.idArticulo === codigo);
            const stockDisponible = Number(catalogItem.stockActual) || 0;
            if (isSalida && existe && existe.cantidad >= stockDisponible) {
                window.mostrarAlerta(`No puedes agregar más de ${stockDisponible} unidades disponibles`, 'error');
                return;
            }
            if(existe) existe.cantidad += 1; else carrito.push({ idArticulo: codigo, cantidad: 1 });
            const row = distributionRows.find(item => item.idArticulo === codigo);
            if (row) row.cantidad += 1;
            else distributionRows.push({ cliente: '', idArticulo: codigo, regional: 'Bogota', usuario: '', cantidad: 1 });
            distributionConfirmed = false;
            document.getElementById('distribution-review').style.display = 'none';
            window.renderizarCarrito();
            window.mostrarAlerta("➕ " + codigo + " añadido", "success");
        }

        window.actualizarCant = function(index, valor) {
            let nuevaCant = parseInt(valor);
            const catalogItem = catalogoActual.find(item => String(item.idArticulo) === String(carrito[index].idArticulo));
            const isSalida = window.tipoMovimientoActual() === 'Salida';
            const maximum = isSalida && catalogItem ? Number(catalogItem.stockActual) || 0 : 9999;
            carrito[index].cantidad = Math.min(maximum, (isNaN(nuevaCant) || nuevaCant <= 0) ? 1 : nuevaCant);
            if (isSalida && maximum === 0) {
                carrito.splice(index, 1);
                window.mostrarAlerta('No se puede agregar un accesorio sin stock disponible', 'error');
                window.renderizarCarrito();
                return;
            }
            const distributionTotal = distributionRows.filter(row => row.idArticulo === carrito[index].idArticulo).reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
            if (distributionRows.length === carrito.length && distributionRows[index] && distributionTotal === Number(carrito[index].cantidad)) distributionRows[index].cantidad = carrito[index].cantidad;
            distributionConfirmed = false;
            window.renderizarCarrito();
        }

        window.eliminarItem = function(index) { carrito.splice(index, 1); distributionRows = distributionRows.filter(row => carrito.some(item => item.idArticulo === row.idArticulo)); distributionConfirmed = false; window.renderizarCarrito(); }

        window.renderizarCarrito = function() {
            const list = document.getElementById('items-list');
            const btnSubmit = document.getElementById('btn-submit');
            if(carrito.length === 0) {
                list.innerHTML = '<li class="empty-cart-state" aria-live="polite">No hay ítems seleccionados</li>';
                btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> REGISTRAR MOVIMIENTO';
            } else {
                document.getElementById('items-card').style.display = 'block';
                let html = '';
                carrito.forEach((item, idx) => {
                    const catalogItem = catalogoActual.find(entry => String(entry.idArticulo) === String(item.idArticulo));
                    const status = catalogItem ? window.stockStatus(catalogItem) : null;
                    const warningText = status && status.key === 'empty' ? 'Agotado: no hay unidades disponibles.' : 'Stock bajo: las existencias están en el mínimo configurado.';
                    const stockWarning = status && status.key !== 'ok' ? `<span class="stock-warning ${status.key === 'empty' ? 'empty' : ''}" title="${window.escapeHtml(warningText)}" aria-label="${window.escapeHtml(warningText)}">&#9888;</span>` : '';
                    const maxQuantity = window.tipoMovimientoActual() === 'Salida' && catalogItem ? Number(catalogItem.stockActual) || 0 : 9999;
                    html += `<li class="item-row">
                            <div class="item-info">🏷️ ${window.escapeHtml(window.nombreArticulo(item.idArticulo))}</div>
                        ${stockWarning}
                            <input type="number" min="1" max="${maxQuantity}" class="qty-input" value="${Math.min(item.cantidad, maxQuantity)}" onchange="window.actualizarCant(${idx}, this.value)" aria-label="Cantidad de ${window.escapeHtml(item.idArticulo)}">
                            <button type="button" class="btn-del" onclick="window.eliminarItem(${idx})" aria-label="Eliminar ${window.escapeHtml(item.idArticulo)}"><i class="fa-solid fa-trash-can"></i></button>
                    </li>`;
                });
                list.innerHTML = html; btnSubmit.disabled = window.tipoMovimientoActual() === 'Salida' && !distributionConfirmed; btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i> REGISTRAR MOVIMIENTO`;
            }
            window.renderizarDistribucion();
        }

        document.getElementById('btn-submit').addEventListener('click', () => {
            let tipoMov = window.tipoMovimientoActual();
            let cliente = tipoMov === 'Salida' ? distributionRows[0]?.cliente.trim() || '' : 'Comunicaciones';
            const providerRequired = ['Entrada', 'Devolucion'].includes(tipoMov);
            const provider = providerRequired ? document.getElementById('proveedor').value.trim() : '';
            const reasonRequired = ['Ajuste positivo', 'Ajuste negativo', 'Baja por daño'].includes(tipoMov);
            const reason = reasonRequired ? document.getElementById('motivo').value.trim() : '';
            if ((tipoMov === 'Salida' && !cliente) || (providerRequired && !provider) || (reasonRequired && !reason) || carrito.length === 0) {
                window.mostrarAlerta(providerRequired ? "Indica el proveedor y agrega artículos" : reasonRequired ? "Indica el motivo y agrega artículos" : "Completa la distribución y agrega artículos", "error");
                return;
            }
            let distribution = [];
            if (tipoMov === 'Salida') {
                if (!distributionConfirmed) {
                    window.mostrarAlerta("Guarda la distribución y revisa el resumen antes de registrar", "error");
                    return;
                }
                distribution = distributionRows.map(row => ({ cliente: row.cliente.trim(), idArticulo: row.idArticulo, regional: row.regional, usuario: row.usuario.trim(), cantidad: Number(row.cantidad) }));
            }
            let btn = document.getElementById('btn-submit');
            if (btn.disabled) return;
            let payload = { action: "registrar_movimiento", tipoMovimiento: tipoMov, cliente, proveedor: provider, motivo: reason, items: carrito, distribution: tipoMov === 'Salida' ? distribution : null };
            const fingerprint = JSON.stringify({
                usuario: sessionStorage.getItem("g4sLoggedUser"),
                payload
            });
            const savedFingerprint = sessionStorage.getItem("g4sPendingMovementFingerprint");
            let idempotencyKey = sessionStorage.getItem("g4sPendingMovementKey");
            if (!idempotencyKey || savedFingerprint !== fingerprint) {
                idempotencyKey = window.crypto && typeof window.crypto.randomUUID === 'function'
                    ? window.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                sessionStorage.setItem("g4sPendingMovementFingerprint", fingerprint);
                sessionStorage.setItem("g4sPendingMovementKey", idempotencyKey);
            }
            payload.claveIdempotencia = idempotencyKey;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            btn.disabled = true;

            apiRequest(payload)
            .then(res => res.json()).then(res => {
                if(res.status === "success") {
                    window.mostrarAlerta("🎉 Movimiento guardado con éxito", "success");
                    sessionStorage.removeItem("g4sPendingMovementFingerprint");
                    sessionStorage.removeItem("g4sPendingMovementKey");
                    carrito = [];
                    distributionRows = [];
                    distributionConfirmed = false;
                    document.getElementById('distribution-review').style.display = 'none';
                    document.getElementById('items-card').style.display = 'none';
                    document.getElementById('proveedor').value = '';
                    document.getElementById('motivo').value = '';
                    window.renderizarCarrito();
                    window.cargarCatalogo();
                    window.cargarDashboard();
                }
                else {
                    window.mostrarAlerta("❌ " + res.message, "error");
                    btn.innerHTML = 'Reintentar';
                    btn.disabled = false;
                }
            }).catch(e => {
                window.mostrarAlerta("❌ Error de conexión al servidor", "error");
                btn.innerHTML = 'Reintentar';
                btn.disabled = false;
            });
        });

        document.getElementById('btn-crear-acc').addEventListener('click', () => {
            let payload = { action: "crear_accesorio", idArticulo: document.getElementById('new-sku').value, categoria: document.getElementById('new-cat').value, descripcion: document.getElementById('new-desc').value, stockMinimo: document.getElementById('new-min').value, costoUnitario: document.getElementById('new-cost').value };
            if(!payload.idArticulo || !document.getElementById('new-model').value.trim() || !payload.descripcion) { window.mostrarAlerta("Selecciona la categoría, escribe el modelo y completa la descripción", "error"); return; }
            const minimum = Number(payload.stockMinimo);
            if (!Number.isInteger(minimum) || minimum < 1) { window.mostrarAlerta("El stock mínimo debe ser un número entero mayor que cero", "error"); return; }
            let btn = document.getElementById('btn-crear-acc');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
            btn.disabled = true;

            apiRequest(payload)
            .then(res => res.json()).then(res => {
                if(res.status === "success") {
                    window.mostrarAlerta("✅ Accesorio creado en Excel", "success");
                    document.getElementById('new-sku').value = "";
                    document.getElementById('new-model').value = "";
                    document.getElementById('new-desc').value = "";
                    document.getElementById('new-cost').value = "0";
                    window.cargarCatalogo();
                }
                else { window.mostrarAlerta("❌ " + res.message, "error"); }
                btn.innerHTML = '<i class="fa-solid fa-save"></i> CREAR ACCESORIO EN EXCEL';
                btn.disabled = false;
            }).catch(e => {
                window.mostrarAlerta("❌ Error de red", "error");
                btn.innerHTML = '<i class="fa-solid fa-save"></i> CREAR ACCESORIO EN EXCEL';
                btn.disabled = false;
            });
        });

        window.agregarLineaSolicitud = function() {
            const firstItem = catalogoActual.find(item => item && item.activo !== false);
            requestDraft.push({ idArticulo: firstItem ? firstItem.idArticulo : '', cliente: '', cantidad: 1 });
            window.renderizarSolicitudBorrador();
        };

        window.renderizarSolicitudBorrador = function() {
            const container = document.getElementById('request-draft-rows');
            requestChoiceInstances.forEach(instance => instance.destroy());
            requestChoiceInstances = [];
            const items = catalogoActual.filter(item => item && item.activo !== false);
            if (!requestDraft.length) {
                container.innerHTML = '<p class="empty-state">Agrega una línea para iniciar.</p>';
                document.getElementById('btn-save-request').disabled = true;
                return;
            }
            const itemOptions = items.map(item => `<option value="${window.escapeHtml(item.idArticulo)}">${window.escapeHtml(item.descripcion || item.idArticulo)}</option>`).join('');
            requestDraft.forEach(line => {
                if (!line.idArticulo && items.length) line.idArticulo = items[0].idArticulo;
            });
            const requestType = document.getElementById('request-type').value;
            container.innerHTML = requestDraft.map((line, index) => `<div class="request-draft-row">
                <div class="request-field"><label for="request-article-${index}">Artículo</label><select id="request-article-${index}" aria-label="Artículo de la línea ${index + 1}" onchange="window.actualizarLineaSolicitud(${index}, 'idArticulo', this.value)"><option value="">Selecciona artículo</option>${itemOptions}</select></div>
                ${requestType === 'Cliente' ? `<label>Cliente<input type="text" value="${window.escapeHtml(line.cliente)}" placeholder="Cliente" maxlength="150" onchange="window.actualizarLineaSolicitud(${index}, 'cliente', this.value)"></label>` : '<span class="request-communications-label"><span class="request-communications-icon"><i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i></span><strong>Comunicaciones</strong><small>Solicitud interna</small></span>'}
                <label class="request-quantity">Cantidad<input type="number" min="1" max="9999" value="${line.cantidad}" aria-label="Cantidad de la línea ${index + 1}" onchange="window.actualizarLineaSolicitud(${index}, 'cantidad', this.value)"></label>
                <button type="button" class="btn-danger request-remove" aria-label="Eliminar línea ${index + 1}" onclick="window.eliminarLineaSolicitud(${index})"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');
            requestDraft.forEach((line, index) => {
                const select = container.querySelector(`#request-article-${index}`);
                if (select) select.value = line.idArticulo;
                const row = container.querySelectorAll('.request-draft-row')[index];
                row.querySelectorAll('select').forEach(selectElement => {
                    const instance = new Choices(selectElement, {
                        searchEnabled: true,
                        searchPlaceholderValue: 'Buscar coincidencias...',
                        itemSelectText: '',
                        shouldSort: false,
                        searchResultLimit: 12
                    });
                    requestChoiceInstances.push(instance);
                });
            });
            document.getElementById('btn-save-request').disabled = !items.length;
        };

        window.actualizarLineaSolicitud = function(index, field, value) {
            if (!requestDraft[index]) return;
            if (field === 'cantidad') {
                const quantity = Math.max(1, Math.min(9999, Number(value) || 1));
                requestDraft[index][field] = quantity;
                const input = document.querySelectorAll('.request-draft-row')[index]?.querySelector('input[type="number"]');
                if (input) input.value = String(quantity);
                return;
            }
            requestDraft[index][field] = value;
        };

        window.eliminarLineaSolicitud = function(index) {
            requestDraft.splice(index, 1);
            window.renderizarSolicitudBorrador();
        };

        window.guardarSolicitud = function() {
            const correoSolicitante = document.getElementById('requester-email').value.trim();
            const gmailThreadUrl = document.getElementById('request-thread-url').value.trim();
            const tipoSolicitud = document.getElementById('request-type').value;
            const regional = tipoSolicitud === 'Comunicaciones'
                ? 'Comunicaciones'
                : document.getElementById('request-regional').value;
            const entregadoA = tipoSolicitud === 'Comunicaciones'
                ? 'Comunicaciones'
                : document.getElementById('request-recipient').value.trim();
            const items = requestDraft.map(line => ({
                idArticulo: line.idArticulo,
                cliente: tipoSolicitud === 'Comunicaciones' ? 'Comunicaciones' : line.cliente.trim(),
                cantidad: Number(line.cantidad)
            }));
            if (!items.length || !regional || !entregadoA ||
                items.some(line => !line.idArticulo || (tipoSolicitud === 'Cliente' && !line.cliente) || !Number.isInteger(line.cantidad) || line.cantidad < 1)) {
                window.mostrarAlerta('Completa artículo, regional, destinatario común, cantidad y cliente en cada línea', 'error');
                return;
            }
            if (correoSolicitante && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoSolicitante)) {
                window.mostrarAlerta('Ingresa un correo válido para preparar el aviso de entrega', 'error');
                return;
            }
            const button = document.getElementById('btn-save-request');
            button.disabled = true;
            apiRequest({ action: 'crear_solicitud', tipoSolicitud, regional, entregadoA, correoSolicitante, gmailThreadUrl, items })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo registrar la solicitud');
                    window.mostrarAlerta(`Solicitud ${result.idSolicitud.slice(0, 8)} registrada`, 'success');
                    requestDraft = [];
                    document.getElementById('requester-email').value = '';
                    document.getElementById('request-thread-url').value = '';
                    document.getElementById('request-recipient').value = '';
                    document.getElementById('request-type').value = 'Cliente';
                    document.getElementById('request-recipient-field').hidden = false;
                    document.getElementById('request-regional-field').hidden = false;
                    document.getElementById('request-email-fields').hidden = false;
                    document.getElementById('request-communications-flow').hidden = true;
                    document.getElementById('request-form-guidance').textContent =
                        'Todas las líneas comparten una regional y una persona destinataria.';
                    window.renderizarSolicitudBorrador();
                    window.agregarLineaSolicitud();
                    window.cargarSolicitudes();
                    window.cargarDashboard();
                }).catch(error => window.mostrarAlerta(error.message, 'error'))
                .finally(() => { button.disabled = false; });
        };

        document.getElementById('request-type').addEventListener('change', event => {
            const isClientRequest = event.target.value === 'Cliente';
            document.getElementById('request-recipient-field').hidden = !isClientRequest;
            document.getElementById('request-regional-field').hidden = !isClientRequest;
            const emailFields = document.getElementById('request-email-fields');
            const communicationsFlow = document.getElementById('request-communications-flow');
            emailFields.hidden = !isClientRequest;
            communicationsFlow.hidden = isClientRequest;
            document.getElementById('request-form-guidance').textContent = isClientRequest
                ? 'Todas las líneas comparten una regional y una persona destinataria.'
                : 'La solicitud se tramita con proveedor y se cierra al recepcionar el stock.';
            if (!isClientRequest) {
                document.getElementById('requester-email').value = '';
                document.getElementById('request-thread-url').value = '';
            }
            window.renderizarSolicitudBorrador();
        });

        window.cargarSolicitudes = function() {
            const list = document.getElementById('requests-list');
            list.innerHTML = '<p class="empty-state">Cargando solicitudes...</p>';
            apiRequest({ action: 'obtener_solicitudes', estado: document.getElementById('request-status-filter').value })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudieron cargar las solicitudes');
                    window.renderizarSolicitudes(Array.isArray(result.data) ? result.data : []);
                }).catch(error => { list.innerHTML = `<p class="empty-state">${window.escapeHtml(error.message)}</p>`; });
        };

        window.renderizarSolicitudes = function(requests) {
            const list = document.getElementById('requests-list');
            if (!requests.length) {
                list.innerHTML = '<p class="empty-state">No hay solicitudes para este filtro.</p>';
                return;
            }
            list.onclick = event => {
                const toggle = event.target.closest('[data-request-toggle]');
                if (!toggle || !list.contains(toggle)) return;
                const details = document.getElementById(toggle.getAttribute('aria-controls'));
                if (!details) return;
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!expanded));
                details.hidden = expanded;
            };
            list.innerHTML = requests.map(request => {
                const safeId = request.idSolicitud.replace(/[^A-Za-z0-9_-]/g, '');
                const detailsId = `request-details-${safeId}`;
                const shortId = window.escapeHtml(request.idSolicitud.slice(0, 8).toUpperCase());
                const requestStatusClass = request.estado.normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const date = request.fechaRegistro ? new Date(request.fechaRegistro).toLocaleDateString('es-CO') : '';
                const total = request.items.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
                const accessoryTotals = Array.isArray(request.resumenAccesorios) ? request.resumenAccesorios : [];
                const clients = [...new Set(request.items.map(item => String(item.cliente || '').trim()).filter(Boolean))];
                const regions = [...new Set(request.items.map(item => String(item.regional || '').trim()).filter(Boolean))];
                const deliverySubject = `Confirmación de entrega SOL-${shortId}`;
                const deliveryBody = [
                    'Buen día,',
                    '',
                    'Cordial saludo.',
                    '',
                    'Se confirma el despacho de los siguientes accesorios:',
                    '',
                    ...request.items.map(item => `- ${item.descripcion || item.idArticulo}: ${Number(item.cantidad)} unidades`),
                    '',
                    'Quedo atento a sus comentarios,',
                    '',
                    'Muchas gracias.'
                ].join('\n');
                const deliveryMailto = request.correoSolicitante
                    ? `mailto:${encodeURIComponent(request.correoSolicitante)}?subject=${encodeURIComponent(deliverySubject)}&body=${encodeURIComponent(deliveryBody)}`
                    : '';
                const communicationSubject = `Solicitud de accesorios para Comunicaciones SOL-${shortId}`;
                const communicationBody = [
                    'Buen día,',
                    '',
                    'Solicito gestionar los siguientes accesorios para Comunicaciones:',
                    '',
                    ...request.items.map(item => `- ${item.descripcion || item.idArticulo}: ${Number(item.cantidad)} unidades`),
                    '',
                    '+luis Espinoza Psi',
                    '',
                    'Quedo atento a la confirmación.',
                    '',
                    'Muchas gracias.'
                ].join('\n');
                const communicationCc = [
                    'juan.quiroga@co.g4s.com',
                    'josue.perez@co.g4s.com',
                    'piedrahita.nataly@co.g4s.com',
                    'maria.reyes@co.g4s.com',
                    'luis.espinoza@co.g4s.com'
                ].join(',');
                const communicationMailto = request.tipoSolicitud === 'Comunicaciones'
                    ? `mailto:capmovil@gmail.com?cc=${encodeURIComponent(communicationCc)}&subject=${encodeURIComponent(communicationSubject)}&body=${encodeURIComponent(communicationBody)}`
                    : '';
                const accessorySummary = accessoryTotals.length
                    ? `<section class="request-accessory-summary" aria-label="Totales por accesorio"><strong>Totales por accesorio</strong><div>${accessoryTotals.map(item => `<span><b>${window.escapeHtml(item.nombre)}</b><small>${Number(item.cantidad).toLocaleString('es-CO')} u.</small></span>`).join('')}</div></section>`
                    : '';
                const lines = request.items.map((item, index) => {
                    const cost = Number(item.costoUnitario) || 0;
                    const itemCost = cost > 0 ? `<small>Costo base: ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cost)}</small>` : '';
                    return `<div class="request-item-line"><span><strong>${window.escapeHtml(item.descripcion || item.idArticulo)}</strong><small>${window.escapeHtml(item.idArticulo)} · ${window.escapeHtml(item.cliente)} · ${window.escapeHtml(item.regional)} · ${window.escapeHtml(item.entregadoA)}</small>${itemCost}</span><b>${Number(item.cantidad)} u.</b></div>`;
                }).join('');
                let action = '';
                if (request.estado === 'Registrada') {
                    action = request.tipoSolicitud === 'Comunicaciones'
                        ? `<label class="request-provider-field">Proveedor<select data-provider-for="${safeId}" onchange="window.alternarProveedorSolicitud('${safeId}', this.value)"><option value="CAPMOVIL" selected>CAPMOVIL</option><option value="Otro">Otro…</option></select><input type="text" data-provider-other-for="${safeId}" placeholder="Nombre del proveedor" maxlength="150" hidden></label><button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Solicitada', this)">Solicitar al proveedor</button>`
                        : `<button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Revisión de disponibilidad', this)">Iniciar revisión de disponibilidad</button>`;
                } else if (request.estado === 'Revisión de disponibilidad') {
                    action = `<button type="button" class="btn-primary request-transition" onclick="window.verificarYDespacharSolicitud('${safeId}', this)">Despachar directamente</button><label class="request-provider-field">Proveedor (si no hay disponibilidad)<select data-provider-for="${safeId}" onchange="window.alternarProveedorSolicitud('${safeId}', this.value)"><option value="CAPMOVIL" selected>CAPMOVIL</option><option value="Otro">Otro…</option></select><input type="text" data-provider-other-for="${safeId}" placeholder="Nombre del proveedor" maxlength="150" hidden></label><button type="button" class="btn-secondary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Solicitada', this)">Sin disponibilidad: solicitar al proveedor</button>`;
                } else if (request.estado === 'Solicitada') {
                    action = request.tipoSolicitud === 'Comunicaciones'
                        ? `<button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Cerrada', this)">Recepcionar</button>`
                        : `<button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Recibida', this)">Registrar recepción</button>`;
                } else if (request.estado === 'Recibida') {
                    action = '<button type="button" class="btn-black request-transition" onclick="window.actualizarEstadoSolicitud(\'' + safeId + '\', \'Entregada\', this)">Marcar entregada</button>';
                } else if (request.estado === 'Anulada') {
                    action = '<span class="request-cancelled"><i class="fa-solid fa-ban"></i> Solicitud anulada</span>';
                } else if (request.estado === 'Entregada') {
                    const composeButton = request.gmailThreadUrl
                        ? `<a class="request-gmail-link" href="${window.escapeHtml(request.gmailThreadUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-envelope-open-text" aria-hidden="true"></i><span>Abrir hilo de Gmail</span></a>`
                        : deliveryMailto
                        ? `<a class="btn-secondary request-transition" href="${window.escapeHtml(deliveryMailto)}"><i class="fa-solid fa-envelope"></i> Redactar aviso de entrega</a>`
                        : '<span class="request-no-email">Sin correo o hilo vinculado</span>';
                    const copyResponseButton = `<button type="button" class="btn-secondary request-transition" data-delivery-response="${window.escapeHtml(deliveryBody)}" onclick="window.copiarRespuestaEntrega(this)"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copiar respuesta</button>`;
                    const linkThreadControl = request.tipoSolicitud !== 'Comunicaciones' && !request.gmailThreadUrl
                        ? `<label class="request-thread-link-field">Enlace del hilo<input type="url" data-thread-url-for="${safeId}" placeholder="Pega aquí la URL de Gmail" maxlength="500"></label><button type="button" class="btn-secondary request-transition" onclick="window.vincularHiloSolicitud('${safeId}', this)">Vincular hilo</button>`
                        : '';
                    action = `<span class="request-complete"><i class="fa-solid fa-circle-check"></i> Entregada</span>${composeButton}${copyResponseButton}${linkThreadControl}`;
                } else if (request.estado === 'Cerrada') {
                    action = '<span class="request-complete"><i class="fa-solid fa-circle-check"></i> Recepción registrada · solicitud cerrada</span>';
                } else {
                    action = '<span class="request-complete"><i class="fa-solid fa-circle-check"></i> Entregada</span>';
                }
                if (request.estado !== 'Anulada' && canReconcileInventory &&
                    ['Registrada', 'Revisión de disponibilidad', 'Solicitada'].includes(request.estado)) {
                    action += `<button type="button" class="btn-secondary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Anulada', this)">Anular solicitud</button>`;
                }
                if (communicationMailto && request.estado !== 'Anulada') {
                    action += `<a class="btn-secondary request-transition" href="${window.escapeHtml(communicationMailto)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-envelope"></i> Redactar correo a Comunicaciones</a>`;
                }
                return `<article class="request-card">
                    <button type="button" class="request-card-toggle" data-request-toggle aria-expanded="false" aria-controls="${detailsId}">
                        <span class="request-card-toggle-main">
                            <span class="request-card-identity"><strong class="request-reference">SOL-${shortId}</strong><small>${window.escapeHtml(date)} · ${window.escapeHtml(request.registradoPor)}</small></span>
                            <span class="request-status status-${requestStatusClass}">${window.escapeHtml(request.estado)}</span>
                        </span>
                        <span class="request-card-parties">
                            <span><small>${request.tipoSolicitud === 'Comunicaciones' ? 'Solicitud' : 'Cliente'}</small><strong>${window.escapeHtml(request.tipoSolicitud === 'Comunicaciones' ? 'Comunicaciones' : clients.join(', ') || 'Sin cliente')}</strong></span>
                            <span><small>Regional</small><strong>${window.escapeHtml(regions.join(', ') || 'Sin regional')}</strong></span>
                            <i class="fa-solid fa-chevron-down request-card-chevron" aria-hidden="true"></i>
                        </span>
                    </button>
                    <div class="request-card-details" id="${detailsId}" hidden>
                        <div class="request-card-summary"><span>${request.items.length} líneas</span><strong>${total} unidades</strong>${request.proveedor ? `<span>Proveedor: ${window.escapeHtml(request.proveedor)}</span>` : ''}${request.correoSolicitante ? `<span>Correo: ${window.escapeHtml(request.correoSolicitante)}</span>` : ''}</div>
                        ${accessorySummary}
                        <div class="request-item-list">${lines}</div>
                        <footer class="request-card-actions">${action}</footer>
                    </div>
                </article>`;
            }).join('');
        };

        window.vincularHiloSolicitud = async function(idSolicitud, button) {
            const field = document.querySelector(`[data-thread-url-for="${idSolicitud}"]`);
            const gmailThreadUrl = field ? field.value.trim() : '';
            if (!gmailThreadUrl) {
                window.mostrarAlerta('Pega el enlace del hilo de Gmail', 'error');
                return;
            }
            button.disabled = true;
            try {
                const response = await apiRequest({ action: 'vincular_hilo_solicitud', idSolicitud, gmailThreadUrl });
                const result = await response.json();
                if (result.status !== 'success') throw new Error(result.message || 'No se pudo vincular el hilo');
                window.mostrarAlerta('Hilo de Gmail vinculado a la solicitud', 'success');
                window.cargarSolicitudes();
            } catch (error) {
                window.mostrarAlerta(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        };

        window.copiarRespuestaEntrega = async function(button) {
            const responseText = button.dataset.deliveryResponse || '';
            if (!responseText) return;
            try {
                await navigator.clipboard.writeText(responseText);
                window.mostrarAlerta('Respuesta copiada. Abre el hilo y pégala en “Responder a todos”.', 'success');
            } catch (error) {
                window.prompt('Copia este texto y pégalo en la respuesta del hilo:', responseText);
            }
        };

        window.alternarProveedorSolicitud = function(idSolicitud, provider) {
            const otherField = document.querySelector(`[data-provider-other-for="${idSolicitud}"]`);
            if (otherField) {
                otherField.hidden = provider !== 'Otro';
                if (provider !== 'Otro') otherField.value = '';
                else otherField.focus();
            }
        };

        window.actualizarEstadoSolicitud = async function(idSolicitud, estado, button, availabilityConfirmed = false) {
            let justificacion = '';
            if (estado === 'Anulada') {
                if (!canReconcileInventory) {
                    window.mostrarAlerta('Solo un administrador puede anular solicitudes', 'error');
                    return;
                }
            }
            const confirmation = estado === 'Recibida' || estado === 'Cerrada'
                ? 'La recepción sumará las unidades al inventario. ¿Confirmar?'
                : estado === 'Entregada'
                    ? 'La entrega descontará las unidades del inventario. ¿Confirmar?'
                    : '';
            if (estado === 'Anulada') {
                justificacion = await window.confirmarAccion(
                        'La solicitud se anulará y no podrá avanzar a recepción o entrega.',
                        { titulo: 'Anular solicitud', danger: true, confirmLabel: 'Anular solicitud', requireReason: true }
                );
                if (!justificacion) return;
            } else if (confirmation && !availabilityConfirmed && !(await window.confirmarAccion(
                estado === 'Cerrada'
                    ? 'Al recepcionar, se sumarán las unidades al inventario y la solicitud de Comunicaciones quedará cerrada.'
                    : confirmation,
                {
                titulo: estado === 'Cerrada' || estado === 'Recibida' ? 'Confirmar recepción' : 'Confirmar entrega'
            }))) return;
            let proveedor = '';
            if (estado === 'Solicitada' && document.querySelector(`[data-provider-for="${idSolicitud}"]`)) {
                const field = document.querySelector(`[data-provider-for="${idSolicitud}"]`);
                if (field && field.tagName === 'SELECT') {
                    proveedor = field.value === 'Otro'
                        ? document.querySelector(`[data-provider-other-for="${idSolicitud}"]`)?.value.trim() || ''
                        : field.value.trim();
                } else {
                    proveedor = field ? field.value.trim() : '';
                }
                if (!proveedor) {
                    window.mostrarAlerta('Indica el proveedor para avanzar la solicitud', 'error');
                    return;
                }
            }
            button.disabled = true;
            try {
                const response = await apiRequest({ action: 'actualizar_estado_solicitud', idSolicitud, estado, proveedor, justificacion });
                const result = await response.json();
                if (result.status !== 'success') throw new Error(result.message || 'No se pudo actualizar la solicitud');
                window.mostrarAlerta(`Solicitud actualizada: ${result.estado}`, 'success');
                window.cargarSolicitudes();
                window.cargarDashboard();
                if (estado === 'Recibida' || estado === 'Entregada' || estado === 'Cerrada') window.cargarCatalogo();
            } catch (error) {
                window.mostrarAlerta(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        };

        window.verificarYDespacharSolicitud = async function(idSolicitud, button) {
            button.disabled = true;
            try {
                const response = await apiRequest({ action: 'revisar_disponibilidad_solicitud', idSolicitud });
                const result = await response.json();
                if (result.status !== 'success') throw new Error(result.message || 'No se pudo verificar la disponibilidad');
                if (!result.disponible) {
                    window.mostrarAlerta('No hay stock suficiente para esta solicitud. Indica un proveedor y selecciona “Sin disponibilidad: solicitar al proveedor”.', 'warning');
                    return;
                }
                const accepted = await window.confirmarAccion(
                    'Hay stock suficiente. Si continúas, la solicitud cambiará a Entregada y se registrará una salida que descontará estas unidades del inventario.',
                    { titulo: 'Confirmar disponibilidad y despacho', confirmLabel: 'Despachar y descontar stock' }
                );
                if (accepted) await window.actualizarEstadoSolicitud(idSolicitud, 'Entregada', button, true);
            } catch (error) {
                window.mostrarAlerta(error.message, 'error');
            } finally {
                button.disabled = false;
            }
        };

        window.renderizarGraficoUnidades = function() {
            const container = document.getElementById('dashboard-movement-chart');
            if (!container || !dashboardChartData) return;
            renderDashboardChart('renderMovementChart', container, {
                rows: dashboardChartData,
                months: dashboardChartMonths,
                visibleSeries: dashboardVisibleSeries
            });
        };

        window.seleccionarEstadoDashboard = function(state) {
            const states = dashboardRequestStates;
            if (!states || !Object.prototype.hasOwnProperty.call(states, state)) return;
            dashboardSelectedRequestState = state;
            const label = {
                Registrada: 'Registradas',
                'Revisión de disponibilidad': 'En revisión de disponibilidad',
                Solicitada: 'Solicitadas',
                Recibida: 'Recibidas',
                Entregada: 'Entregadas',
                Cerrada: 'Cerradas',
                Anulada: 'Anuladas'
            }[state];
            document.getElementById('dashboard-request-detail').textContent =
                `${label}: ${Number(states[state] || 0).toLocaleString('es-CO')} solicitudes`;
            document.querySelectorAll('[data-request-state]').forEach(button => {
                button.setAttribute('aria-pressed', String(button.dataset.requestState === state));
                button.classList.toggle('is-selected', button.dataset.requestState === state);
            });
            document.querySelectorAll('[data-request-state-segment]').forEach(segment => {
                segment.classList.toggle('is-selected', segment.dataset.requestStateSegment === state);
            });
            window.renderizarGraficoSolicitudes(states);
        };

        window.renderizarGraficoSolicitudes = function(states) {
            const chart = document.getElementById('dashboard-request-chart');
            const legend = document.getElementById('dashboard-request-states');
            if (!chart || !legend) return;
            renderDashboardChart('renderRequestDonut', chart, {
                states,
                selectedState: dashboardSelectedRequestState,
                onSelect: window.seleccionarEstadoDashboard
            });
            renderDashboardChart('renderRequestLegend', legend, {
                states,
                selectedState: dashboardSelectedRequestState,
                onSelect: window.seleccionarEstadoDashboard
            });
        };

        window.seleccionarRegionalDashboard = function(index) {
            const item = dashboardRegionalData[index];
            if (!item) return;
            dashboardSelectedRegional = item.regional;
            document.getElementById('dashboard-regional-detail').textContent =
                `${item.regional}: ${Number(item.unidades || 0).toLocaleString('es-CO')} unidades entregadas`;
            window.renderizarGraficoRegional(dashboardRegionalData);
        };

        window.renderizarGraficoRegional = function(regionalData) {
            const container = document.getElementById('dashboard-regional-chart');
            if (!container) return;
            dashboardRegionalData = Array.isArray(regionalData)
                ? regionalData.filter(item => item && item.regional)
                : [];
            if (!dashboardRegionalData.length) {
                renderDashboardChart('renderRegionalChart', container, {
                    rows: dashboardRegionalData,
                    selectedRegional: dashboardSelectedRegional,
                    onSelect: window.seleccionarRegionalDashboard
                });
                document.getElementById('dashboard-regional-detail').textContent =
                    'No hay unidades entregadas por regional para mostrar.';
                return;
            }
            if (dashboardSelectedRegional && !dashboardRegionalData.some(item => item.regional === dashboardSelectedRegional)) {
                dashboardSelectedRegional = '';
            }
            renderDashboardChart('renderRegionalChart', container, {
                rows: dashboardRegionalData,
                selectedRegional: dashboardSelectedRegional,
                onSelect: window.seleccionarRegionalDashboard
            });
            const selectedIndex = dashboardRegionalData.findIndex(item => item.regional === dashboardSelectedRegional);
            if (selectedIndex >= 0) {
                const item = dashboardRegionalData[selectedIndex];
                document.getElementById('dashboard-regional-detail').textContent =
                    `${item.regional}: ${Number(item.unidades || 0).toLocaleString('es-CO')} unidades entregadas`;
            } else document.getElementById('dashboard-regional-detail').textContent =
                'Selecciona una regional para ver el detalle.';
        };

        window.seleccionarAccesorioDashboard = function(index) {
            const item = dashboardAccessoryData[index];
            if (!item) return;
            dashboardSelectedAccessory = item.idArticulo;
            const periodLabels = {
                dias7: 'Últimos 7 días',
                dias30: 'Últimos 30 días',
                dias90: 'Últimos 90 días',
                historico: 'Histórico'
            };
            document.getElementById('dashboard-accessories-detail').textContent =
                `${item.accesorio} · ${periodLabels[dashboardAccessoryPeriod]}: ${Number(item.unidades || 0).toLocaleString('es-CO')} unidades entregadas`;
            window.renderizarGraficoAccesorios();
        };

                window.seleccionarPeriodoAccesorios = function(period) {
                    if (!['dias7', 'dias30', 'dias90', 'historico'].includes(period)) return;
                    dashboardAccessoryPeriod = period;
                    document.querySelectorAll('[data-accessory-period]').forEach(button => {
                        const active = button.dataset.accessoryPeriod === period;
                        button.classList.toggle('is-active', active);
                        button.setAttribute('aria-pressed', String(active));
                    });
                    window.renderizarGraficoAccesorios();
                };

                window.renderizarGraficoAccesorios = function(periodData, historicalData) {
                    if (periodData) {
                        dashboardAccessoryPeriods = Object.assign({}, periodData);
                        if (Array.isArray(historicalData)) dashboardAccessoryPeriods.historico = historicalData;
                    }
            const container = document.getElementById('dashboard-accessories-chart');
            if (!container) return;
                    const selectedPeriodData = dashboardAccessoryPeriods[dashboardAccessoryPeriod];
                    dashboardAccessoryData = Array.isArray(selectedPeriodData)
                        ? selectedPeriodData.filter(item => item && item.idArticulo && item.accesorio)
                    .slice()
                    .sort((first, second) => Number(second.unidades) - Number(first.unidades) || first.accesorio.localeCompare(second.accesorio))
                    .slice(0, 8)
                : [];
            if (!dashboardAccessoryData.length) {
                renderDashboardChart('renderAccessoriesChart', container, {
                    rows: dashboardAccessoryData,
                    selectedAccessory: dashboardSelectedAccessory,
                    onSelect: window.seleccionarAccesorioDashboard
                });
                document.getElementById('dashboard-accessories-detail').textContent =
                            'No hay accesorios entregados para mostrar en este periodo.';
                return;
            }
            if (!dashboardAccessoryData.some(item => item.idArticulo === dashboardSelectedAccessory)) {
                dashboardSelectedAccessory = '';
            }
            renderDashboardChart('renderAccessoriesChart', container, {
                rows: dashboardAccessoryData,
                selectedAccessory: dashboardSelectedAccessory,
                onSelect: window.seleccionarAccesorioDashboard
            });
            const selectedIndex = dashboardAccessoryData.findIndex(item => item.idArticulo === dashboardSelectedAccessory);
            if (selectedIndex >= 0) {
                const item = dashboardAccessoryData[selectedIndex];
                const periodLabels = {
                    dias7: 'Últimos 7 días',
                    dias30: 'Últimos 30 días',
                    dias90: 'Últimos 90 días',
                    historico: 'Histórico'
                };
                document.getElementById('dashboard-accessories-detail').textContent =
                    `${item.accesorio} · ${periodLabels[dashboardAccessoryPeriod]}: ${Number(item.unidades || 0).toLocaleString('es-CO')} unidades entregadas`;
            } else document.getElementById('dashboard-accessories-detail').textContent =
                'Selecciona un accesorio para ver las unidades entregadas.';
        };

        window.cargarDashboard = function() {
            const feedback = document.getElementById('dashboard-feedback');
            feedback.hidden = true;
            feedback.textContent = '';
            apiRequest({ action: 'obtener_dashboard' })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudieron cargar los indicadores');
                    const data = result.data || {};
                    document.getElementById('kpi-unidades').textContent = Number(data.unidades || 0).toLocaleString('es-CO');
                    document.getElementById('kpi-articulos').textContent = Number(data.articulos || 0).toLocaleString('es-CO');
                    document.getElementById('kpi-stock-bajo').textContent = Number(data.stockBajo || 0).toLocaleString('es-CO');
                    document.getElementById('kpi-agotados').textContent = Number(data.agotados || 0).toLocaleString('es-CO');
                    document.getElementById('kpi-solicitudes').textContent = Number(data.solicitudesPendientes || 0).toLocaleString('es-CO');
                    document.getElementById('kpi-movimientos').textContent = Number(data.movimientosMes || 0).toLocaleString('es-CO');
                    const averageHours = data.tiempoPromedioEntregaHoras;
                    const averageDelivery = averageHours == null
                        ? 'Sin datos'
                        : averageHours >= 24 ? `${(averageHours / 24).toFixed(1)} días` : `${averageHours.toLocaleString('es-CO', { maximumFractionDigits: 1 })} h`;
                    document.getElementById('kpi-entrega-promedio').textContent = averageDelivery;
                    document.getElementById('kpi-entregadas-mes').textContent = Number(data.solicitudesEntregadasMes || 0).toLocaleString('es-CO');
                    const states = data.solicitudesPorEstado || {};
                    dashboardChartData = Array.isArray(data.unidadesPorMes) ? data.unidadesPorMes : [];
                    dashboardRequestStates = states;
                    window.renderizarGraficoUnidades();
                    window.renderizarGraficoSolicitudes(states);
                    window.renderizarGraficoRegional(data.entregasPorRegional);
                    window.renderizarGraficoAccesorios(data.accesoriosMasEntregadosPorPeriodo, data.accesoriosMasEntregados);
                    feedback.hidden = true;
                }).catch(error => {
                    console.error('Dashboard no disponible:', error);
                    feedback.textContent = `No se pudieron cargar los indicadores: ${error.message}. Verifica que Apps Script tenga desplegada la acción obtener_dashboard.`;
                    feedback.hidden = false;
                    feedback.classList.add('is-error');
                });
        };

        window.auditarInventario = function() {
            const resultPanel = document.getElementById('inventory-audit-result');
            resultPanel.hidden = false;
            resultPanel.innerHTML = '<p class="empty-state">Comparando saldos con el libro de movimientos...</p>';
            apiRequest({ action: 'auditar_inventario' })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo auditar el inventario');
                    window.renderizarAuditoriaInventario(result.data);
                }).catch(error => {
                    resultPanel.innerHTML = `<p class="audit-error">${window.escapeHtml(error.message)}</p>`;
                });
        };

        window.renderizarAuditoriaInventario = function(audit) {
            const panel = document.getElementById('inventory-audit-result');
            const issues = Array.isArray(audit.inconsistencias) ? audit.inconsistencias : [];
            if (!issues.length) {
                panel.innerHTML = `<p class="audit-ok"><i class="fa-solid fa-circle-check"></i> ${Number(audit.articulosRevisados) || 0} artículos revisados. Saldos y movimientos coinciden.</p>`;
                return;
            }
            const rows = issues.map(item => {
                const first = item.primerMovimientoNegativo;
                const firstMovement = first
                    ? `<div class="audit-detail">Primer saldo negativo: ${window.escapeHtml(first.idTransaccion)} · ${window.escapeHtml(first.tipoMovimiento)} de ${Number(first.cantidad)} u. (${Number(first.saldoAntes)} → ${Number(first.saldoDespues)})</div>`
                    : '';
                const flags = [item.stockNegativo ? 'Saldo contable negativo' : '', item.movimientosInvalidos ? 'Movimiento inválido' : '', Math.abs(Number(item.diferencia)) > 0.0001 ? 'Fórmula/hoja desactualizada' : ''].filter(Boolean).join(' · ');
                return `<article class="audit-item"><div><strong>${window.escapeHtml(item.idArticulo)}</strong><span>${window.escapeHtml(item.descripcion)}</span></div><div class="audit-balances"><span>Hoja: <b>${Number(item.stockEnHoja)}</b></span><span>Movimientos: <b>${Number(item.stockSegunMovimientos)}</b></span><span class="audit-flags">${window.escapeHtml(flags)}</span></div>${firstMovement}</article>`;
            }).join('');
            panel.innerHTML = `<p class="audit-warning">${issues.length} inconsistencias detectadas de ${Number(audit.articulosRevisados) || 0} artículos. Los saldos de movimientos confirmados son la fuente contable.</p>${rows}`;
        };

        window.repararFormulasInventario = async function() {
            const accepted = await window.confirmarAccion('Esto solo vuelve a generar las fórmulas de entradas, salidas y stock. No modifica ni elimina movimientos. ¿Continuar?', { titulo: 'Reparar fórmulas', confirmLabel: 'Reparar' });
            if (!accepted) return;
            const button = document.getElementById('btn-repair-inventory-formulas');
            button.disabled = true;
            apiRequest({ action: 'reparar_formulas_inventario' })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudieron reparar las fórmulas');
                    window.renderizarAuditoriaInventario(result.data);
                    window.mostrarAlerta('Fórmulas reconstruidas; revisa los saldos contables detectados', 'success');
                    window.cargarCatalogo();
                }).catch(error => window.mostrarAlerta(error.message, 'error'))
                .finally(() => { button.disabled = false; });
        };

        window.procesarCorreosInventario = function() {
            const button = document.getElementById('btn-process-email-requests');
            const resultPanel = document.getElementById('email-processing-result');
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Leyendo correos...';
            apiRequest({ action: 'procesar_correos_inventario' })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudieron procesar los correos');
                    const stats = result.data || {};
                    const reviewed = Number(stats.correosRevisados) || 0;
                    const failures = Array.isArray(stats.detalleErrores) ? stats.detalleErrores : [];
                    const summary = reviewed
                        ? `Correos revisados: ${reviewed}; procesados: ${Number(stats.procesados) || 0}; errores: ${Number(stats.errores) || 0}; reintentos pendientes: ${Number(stats.reintentosPendientes) || 0}; sin procesar: ${Number(stats.correosSinProcesar) || 0}.`
                        : 'No se encontraron correos sin leer en la bandeja de entrada.';
                    const failureDetails = failures.length
                        ? `<ul>${failures.map(failure => `<li><strong>${window.escapeHtml(failure.id)}</strong>: ${window.escapeHtml(failure.mensaje)}${failure.errorServicio ? ' (lectura detenida; este correo y los pendientes quedan sin leer. Revisa el acceso del proyecto a Gemini.)' : failure.reintentoPendiente ? ' (queda sin leer para reintentar)' : failure.etiquetadoParaRevision ? ' (se marcó como leído y se etiquetó para revisión)' : ''}${failure.errorAlEtiquetar ? ` (también falló el etiquetado: ${window.escapeHtml(failure.errorAlEtiquetar)})` : ''}</li>`).join('')}</ul>`
                        : '';
                    const alreadyTaggedNote = !reviewed && !failures.length
                        ? '<p>Los mensajes etiquetados en una lectura anterior pueden estar marcados como leídos y por eso no se vuelven a procesar. Para reintentarlos, márcalos como no leídos en Gmail y pulsa de nuevo.</p>'
                        : '';
                    resultPanel.innerHTML = `<strong>${window.escapeHtml(summary)}</strong>${failureDetails}${alreadyTaggedNote}`;
                    resultPanel.classList.toggle('has-errors', failures.length > 0);
                    resultPanel.hidden = false;
                    window.mostrarAlerta(summary, failures.length ? 'error' : reviewed ? 'success' : 'info');
                    if (stats.procesados) window.cargarSolicitudes();
                })
                .catch(error => {
                    resultPanel.textContent = error.message;
                    resultPanel.classList.add('has-errors');
                    resultPanel.hidden = false;
                    window.mostrarAlerta(error.message, 'error');
                })
                .finally(() => {
                    button.innerHTML = '<i class="fa-solid fa-envelope-open-text"></i> Leer correo';
                    button.disabled = false;
                });
        };

        document.getElementById('btn-add-request-line').addEventListener('click', window.agregarLineaSolicitud);
        document.getElementById('btn-save-request').addEventListener('click', window.guardarSolicitud);
        document.getElementById('request-status-filter').addEventListener('change', window.cargarSolicitudes);
        document.getElementById('btn-dashboard-refresh').addEventListener('click', window.cargarDashboard);
        document.querySelectorAll('[data-dashboard-months]').forEach(button => {
            button.addEventListener('click', () => {
                dashboardChartMonths = Number(button.dataset.dashboardMonths) === 12 ? 12 : 6;
                document.querySelectorAll('[data-dashboard-months]').forEach(option => {
                    const active = option === button;
                    option.classList.toggle('is-active', active);
                    option.setAttribute('aria-pressed', String(active));
                });
                window.renderizarGraficoUnidades();
            });
        });
        document.querySelectorAll('[data-accessory-period]').forEach(button => {
            button.addEventListener('click', () => {
                window.seleccionarPeriodoAccesorios(button.dataset.accessoryPeriod);
            });
        });
        document.querySelectorAll('[data-dashboard-series]').forEach(button => {
            button.addEventListener('click', () => {
                const series = button.dataset.dashboardSeries;
                if (!Object.prototype.hasOwnProperty.call(dashboardVisibleSeries, series)) return;
                dashboardVisibleSeries[series] = !dashboardVisibleSeries[series];
                button.setAttribute('aria-pressed', String(dashboardVisibleSeries[series]));
                button.classList.toggle('is-muted', !dashboardVisibleSeries[series]);
                window.renderizarGraficoUnidades();
            });
        });
        document.getElementById('btn-process-email-requests').addEventListener('click', window.procesarCorreosInventario);
    document.getElementById('btn-audit-inventory').addEventListener('click', window.auditarInventario);
    document.getElementById('btn-repair-inventory-formulas').addEventListener('click', window.repararFormulasInventario);

        let XLSX;
        const reportColumns = {
            inventario: [
                { header: 'SKU', value: item => item.idArticulo },
                { header: 'Categoría', value: item => item.categoria },
                { header: 'Descripción', value: item => item.descripcion },
                { header: 'Stock actual', value: item => Number(item.stockActual) || 0 },
                { header: 'Stock mínimo', value: item => Number(item.stockMinimo) || 0 },
                { header: 'Estado', value: item => reportStockStatus(item) },
                { header: 'Costo unitario (COP)', value: item => Number(item.costoUnitario) > 0 ? Number(item.costoUnitario) : '' },
                { header: 'Valor del stock (COP)', value: item => Number(item.costoUnitario) > 0 ? (Number(item.stockActual) || 0) * Number(item.costoUnitario) : '' },
                { header: 'Activo', value: item => item.activo === false ? 'No' : 'Sí' }
            ],
            movimientos: [
                { header: 'ID transacción', value: item => item.idTransaccion },
                { header: 'Fecha y hora', value: item => reportDate(item.fechaHora) },
                { header: 'SKU', value: item => item.idArticulo },
                { header: 'Descripción', value: item => reportCatalog.get(item.idArticulo)?.descripcion || '' },
                { header: 'Tipo', value: item => item.tipoMovimiento },
                { header: 'Cantidad', value: item => Number(item.cantidad) || 0 },
                { header: 'Registrado por', value: item => item.registradoPor },
                { header: 'Entregado a', value: item => item.entregadoA },
                { header: 'Cliente / proveedor', value: item => item.clienteProveedor },
                { header: 'Regional', value: item => item.regional },
                { header: 'Estado', value: item => item.estado },
                { header: 'ID relacionado', value: item => item.relacionada },
                { header: 'Motivo', value: item => item.motivo },
                { header: 'Regional origen', value: item => item.regionalOrigen },
                { header: 'Regional destino', value: item => item.regionalDestino },
                { header: 'Justificación de anulación', value: item => item.justificacionAnulacion }
            ],
            solicitudes: [
                { header: 'ID solicitud', value: ({ solicitud }) => solicitud.idSolicitud },
                { header: 'Fecha de registro', value: ({ solicitud }) => reportDate(solicitud.fechaRegistro) },
                { header: 'Tipo', value: ({ solicitud }) => solicitud.tipoSolicitud },
                { header: 'Estado', value: ({ solicitud }) => solicitud.estado },
                { header: 'Registrado por', value: ({ solicitud }) => solicitud.registradoPor },
                { header: 'Proveedor', value: ({ solicitud }) => solicitud.proveedor },
                { header: 'SKU', value: ({ item }) => item.idArticulo },
                { header: 'Descripción', value: ({ item }) => item.descripcion },
                { header: 'Cantidad', value: ({ item }) => Number(item.cantidad) || 0 },
                { header: 'Costo unitario (COP)', value: ({ item }) => Number(item.costoUnitario) > 0 ? Number(item.costoUnitario) : '' },
                { header: 'Total línea (COP)', value: ({ item }) => Number(item.costoUnitario) > 0 ? (Number(item.cantidad) || 0) * Number(item.costoUnitario) : '' },
                { header: 'Cliente', value: ({ item }) => item.cliente },
                { header: 'Regional', value: ({ item }) => item.regional },
                { header: 'Entregado a', value: ({ item }) => item.entregadoA },
                { header: 'Fecha solicitud proveedor', value: ({ solicitud }) => reportDate(solicitud.fechaSolicitudProveedor) },
                { header: 'Fecha recepción', value: ({ solicitud }) => reportDate(solicitud.fechaRecepcion) },
                { header: 'Fecha entrega', value: ({ solicitud }) => reportDate(solicitud.fechaEntrega) },
                { header: 'Observaciones', value: ({ solicitud }) => solicitud.observaciones },
                { header: 'Justificación de anulación', value: ({ solicitud }) => solicitud.justificacionAnulacion }
            ]
        };
        let reportCatalog = new Map();
        const reportStockStatus = item => {
            const stock = Number(item.stockActual) || 0;
            if (stock < 0) return 'Saldo negativo';
            if (stock === 0) return 'Agotado';
            if (stock <= (Number(item.stockMinimo) || 0)) return 'Stock bajo';
            return 'Disponible';
        };
        const reportDate = value => {
            if (!value) return '';
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? String(value) : `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')} UTC`;
        };
        const fetchReportPage = async (action, offset, limit) => {
            const response = await apiRequest({ action, offset, limite: limit });
            const result = await response.json();
            if (result.status !== 'success') throw new Error(result.message || 'No se pudieron consultar los datos del reporte');
            return {
                rows: Array.isArray(result.data) ? result.data : [],
                pagination: result.pagination
            };
        };
        const fetchAllReportPages = async action => {
            const pageSize = action === 'obtener_solicitudes' ? 300 : 500;
            const rows = [];
            const seenIds = new Set();
            for (let offset = 0; ; offset += pageSize) {
                const result = await fetchReportPage(action, offset, pageSize);
                const page = result.rows;
                for (const row of page) {
                    const id = row.idTransaccion || row.idSolicitud;
                    if (offset > 0 && id && seenIds.has(id)) {
                        throw new Error('El backend de reportes no admite paginación. Actualiza y despliega apps-script/Code.gs.');
                    }
                    if (id) seenIds.add(id);
                }
                rows.push(...page);
                if (page.length < pageSize || result.pagination?.hasMore === false) return rows;
            }
        };
        const fetchReportData = async kinds => {
            const tasks = [];
            if (kinds.includes('inventario') || kinds.includes('movimientos')) tasks.push(
                apiRequest({ action: 'obtener_catalogo' }).then(async response => {
                    const result = await response.json();
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo consultar el inventario');
                    return ['inventario', Array.isArray(result.data) ? result.data : []];
                })
            );
            if (kinds.includes('movimientos')) tasks.push(fetchAllReportPages('obtener_movimientos').then(data => ['movimientos', data]));
            if (kinds.includes('solicitudes')) tasks.push(fetchAllReportPages('obtener_solicitudes').then(data => ['solicitudes', data]));
            return Object.fromEntries(await Promise.all(tasks));
        };
        const reportSheets = {
            inventario: { name: 'Inventario', columns: reportColumns.inventario },
            movimientos: { name: 'Movimientos', columns: reportColumns.movimientos },
            solicitudes: { name: 'Solicitudes', columns: reportColumns.solicitudes }
        };
        const appendReportSheet = (workbook, { name, columns }, rows) => {
            const sheetRows = rows.map(row => columns.map(column => column.value(row)));
            const worksheet = XLSX.utils.aoa_to_sheet([columns.map(column => column.header), ...sheetRows]);
            worksheet['!cols'] = columns.map(column => ({ wch: Math.min(34, Math.max(14, column.header.length + 2)) }));
            if (worksheet['!ref']) worksheet['!autofilter'] = { ref: worksheet['!ref'] };
            XLSX.utils.book_append_sheet(workbook, worksheet, name);
        };
        const appendInsightReportSheets = (workbook, data) => {
            const columnsFor = headers => headers.map(header => ({ header, value: row => row[header] ?? '' }));
            const appendRows = (name, headers, rows) =>
                appendReportSheet(workbook, { name, columns: columnsFor(headers) }, rows);
            const parameters = data.parametros || {};
            const requests = data.solicitudesAbiertas || {};
            const delivery = data.cumplimientoEntrega || {};
            const supplier = data.tiempoEntregaProveedor || {};

            appendRows('Resumen analítico', ['Indicador', 'Valor'], [
                { Indicador: 'Generado', Valor: new Date().toLocaleString('es-CO') },
                { Indicador: 'Consumo reciente (días)', Valor: parameters.consumoDias ?? '' },
                { Indicador: 'Plazo proveedor (días)', Valor: parameters.plazoProveedorDias ?? '' },
                { Indicador: 'Stock de seguridad (días)', Valor: parameters.stockSeguridadDias ?? '' },
                { Indicador: 'Meta de entrega (días)', Valor: parameters.metaEntregaDias ?? '' },
                { Indicador: 'Sin salidas (días)', Valor: parameters.sinMovimientoDias ?? '' },
                { Indicador: 'Artículos bajo cobertura objetivo', Valor: data.articulosPorDebajoCobertura ?? 0 },
                { Indicador: 'Unidades sugeridas para reposición', Valor: data.cantidadTotalSugerida ?? 0 },
                { Indicador: 'Solicitudes abiertas', Valor: requests.total ?? 0 },
                { Indicador: 'Solicitudes vencidas', Valor: requests.vencidas ?? 0 },
                { Indicador: 'Entregas dentro de meta (%)', Valor: delivery.porcentaje ?? '' },
                { Indicador: 'Valor inmovilizado conocido (COP)', Valor: data.valorInventarioInmovilizadoConCosto ?? '' },
                { Indicador: 'Solicitudes proveedor recibidas (12 meses)', Valor: supplier.recibidas ?? 0 },
                { Indicador: 'Proveedores sin identificar', Valor: supplier.proveedoresSinNombre ?? 0 }
            ]);

            const coverage = new Map((data.cobertura || []).map(item => [item.idArticulo, item]));
            (data.reposicion || []).forEach(item => {
                coverage.set(item.idArticulo, { ...coverage.get(item.idArticulo), ...item });
            });
            appendRows('Cobertura y reposición',
                ['SKU', 'Descripción', 'Stock actual', 'Consumo diario', 'Cobertura (días)', 'Cantidad sugerida', 'Reposición estimada (COP)'],
                [...coverage.values()].map(item => ({
                    SKU: item.idArticulo || '',
                    Descripción: item.descripcion || '',
                    'Stock actual': Number(item.stockActual) || 0,
                    'Consumo diario': Number(item.consumoDiario) || 0,
                    'Cobertura (días)': item.coberturaDias ?? '',
                    'Cantidad sugerida': Number(item.cantidadSugerida) || 0,
                    'Reposición estimada (COP)': item.valorReposicionEstimado ?? ''
                }))
            );
            appendRows('Solicitudes abiertas',
                ['ID solicitud', 'Estado', 'Tipo', 'Regional', 'Antigüedad (días)'],
                (requests.masAntiguas || []).map(item => ({
                    'ID solicitud': item.idSolicitud || '',
                    Estado: item.estado || '',
                    Tipo: item.tipoSolicitud || '',
                    Regional: item.regional || '',
                    'Antigüedad (días)': Number(item.edadDias) || 0
                }))
            );
            appendRows('Inventario inmovilizado',
                ['SKU', 'Descripción', 'Stock actual', 'Última salida', 'Días sin salida', 'Valor estimado (COP)'],
                (data.articulosSinMovimiento || []).map(item => ({
                    SKU: item.idArticulo || '',
                    Descripción: item.descripcion || '',
                    'Stock actual': Number(item.stockActual) || 0,
                    'Última salida': reportDate(item.ultimaSalida),
                    'Días sin salida': item.diasSinSalida ?? '',
                    'Valor estimado (COP)': item.valorEstimado ?? ''
                }))
            );
            appendRows('Clasificación ABC',
                ['Clase', 'SKU', 'Descripción', 'Consumo valorizado (COP)', 'Acumulado (%)'],
                (data.abc || []).map(item => ({
                    Clase: item.clasificacion || '',
                    SKU: item.idArticulo || '',
                    Descripción: item.descripcion || '',
                    'Consumo valorizado (COP)': item.valorConsumo ?? '',
                    'Acumulado (%)': item.acumulado ?? ''
                }))
            );
            appendRows('Proveedores',
                ['Proveedor', 'Recibidas', 'Promedio (días)', 'Mediana (días)', 'P90 (días)', 'Abiertas'],
                (supplier.proveedores || []).map(item => ({
                    Proveedor: item.proveedor || '',
                    Recibidas: Number(item.recibidas) || 0,
                    'Promedio (días)': item.promedioDias ?? '',
                    'Mediana (días)': item.medianaDias ?? '',
                    'P90 (días)': item.percentil90Dias ?? '',
                    Abiertas: Number(item.abiertas) || 0
                }))
            );
            appendRows('Tiempos mensuales',
                ['Mes', 'Proveedor', 'Recibidas', 'Promedio (días)'],
                (supplier.meses || []).flatMap(month => month.proveedores?.length
                    ? month.proveedores.map(item => ({
                        Mes: month.mes || '',
                        Proveedor: item.proveedor || '',
                        Recibidas: Number(item.recibidas) || 0,
                        'Promedio (días)': item.promedioDias ?? ''
                    }))
                    : [{
                        Mes: month.mes || '',
                        Proveedor: 'Todos',
                        Recibidas: Number(month.recibidas) || 0,
                        'Promedio (días)': month.promedioDias ?? ''
                    }]
                )
            );
            appendRows('Recepciones recientes',
                ['ID solicitud', 'Proveedor', 'Fecha solicitud', 'Fecha recepción', 'Demora (días)'],
                (supplier.recepcionesRecientes || []).map(item => ({
                    'ID solicitud': item.idSolicitud || '',
                    Proveedor: item.proveedor || '',
                    'Fecha solicitud': reportDate(item.fechaSolicitud),
                    'Fecha recepción': reportDate(item.fechaRecepcion),
                    'Demora (días)': item.diasEntrega ?? ''
                }))
            );
            appendRows('En espera proveedor',
                ['ID solicitud', 'Proveedor', 'Fecha solicitud', 'Espera (días)'],
                (supplier.solicitudesEnEspera || []).map(item => ({
                    'ID solicitud': item.idSolicitud || '',
                    Proveedor: item.proveedor || '',
                    'Fecha solicitud': reportDate(item.fechaSolicitud),
                    'Espera (días)': item.diasEspera ?? ''
                }))
            );
        };
        const reportFileDate = () => {
            const date = new Date();
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        };
        const createReportWorkbook = (kind, data) => {
            const workbook = XLSX.utils.book_new();
            reportCatalog = new Map((data.inventario || []).map(item => [item.idArticulo, item]));
            if (kind === 'completo') {
                const inventory = data.inventario || [];
                const movements = data.movimientos || [];
                const requests = data.solicitudes || [];
                const alertInventory = inventory.filter(item => reportStockStatus(item) !== 'Disponible');
                const knownValue = inventory.reduce((total, item) => {
                    const stock = Number(item.stockActual) || 0;
                    const cost = Number(item.costoUnitario) || 0;
                    return total + (stock >= 0 && cost > 0 ? stock * cost : 0);
                }, 0);
                const summary = [
                    ['Generado', new Date().toLocaleString('es-CO')],
                    ['Referencias en catálogo', inventory.length],
                    ['Referencias activas', inventory.filter(item => item.activo !== false).length],
                    ['Unidades disponibles', inventory.reduce((total, item) => total + (Number(item.stockActual) || 0), 0)],
                    ['Valor estimado (costos registrados, COP)', knownValue],
                    ['Referencias con alerta de stock', alertInventory.length],
                    ['Movimientos incluidos', movements.length],
                    ['Solicitudes incluidas', requests.length],
                    ['Líneas de solicitud', requests.reduce((total, request) => total + (Array.isArray(request.items) ? request.items.length : 0), 0)]
                ];
                const worksheet = XLSX.utils.aoa_to_sheet([['Indicador', 'Valor'], ...summary]);
                worksheet['!cols'] = [{ wch: 44 }, { wch: 30 }];
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumen');
                appendReportSheet(workbook, reportSheets.inventario, inventory);
                appendReportSheet(workbook, {
                    name: 'Alertas de stock',
                    columns: reportColumns.inventario.filter(column => column.header !== 'Activo')
                }, alertInventory);
                appendReportSheet(workbook, reportSheets.movimientos, movements);
                appendReportSheet(workbook, reportSheets.solicitudes, requests.flatMap(solicitud =>
                    (solicitud.items || []).map(item => ({ solicitud, item }))
                ));
            } else if (kind === 'solicitudes') {
                appendReportSheet(workbook, reportSheets.solicitudes, (data.solicitudes || []).flatMap(solicitud =>
                    (solicitud.items || []).map(item => ({ solicitud, item }))
                ));
            } else if (kind === 'analitica') {
                appendInsightReportSheets(workbook, data.analitica || {});
            } else {
                appendReportSheet(workbook, reportSheets[kind], data[kind] || []);
            }
            return workbook;
        };
        document.querySelectorAll('[data-report-download]').forEach(button => {
            button.addEventListener('click', async () => {
                if (button.disabled) return;
                const kind = button.dataset.reportDownload;
                const feedback = document.getElementById('reports-feedback');
                const buttons = [...document.querySelectorAll('[data-report-download]')];
                buttons.forEach(item => { item.disabled = true; });
                feedback.textContent = 'Consultando datos y preparando el archivo Excel...';
                try {
                    XLSX ||= (await import('xlsx/dist/xlsx.core.min.js')).default;
                    const kinds = kind === 'completo'
                        ? ['inventario', 'movimientos', 'solicitudes']
                        : kind === 'analitica' ? [] : [kind];
                    const data = await fetchReportData(kinds);
                    if (kind === 'analitica') {
                        data.analitica = await window.cargarAnaliticaInventario();
                        if (!data.analitica) throw new Error('No se pudo consultar la analítica para generar el reporte.');
                    }
                    const workbook = createReportWorkbook(kind, data);
                    const reportName = kind === 'completo' ? 'Reporte_completo' : `Reporte_${kind}`;
                    XLSX.writeFile(workbook, `${reportName}_${reportFileDate()}.xlsx`, { compression: true });
                    feedback.textContent = 'El archivo Excel se descargó correctamente.';
                } catch (error) {
                    console.error('Error al generar el reporte:', error);
                    feedback.textContent = `No se pudo generar el reporte: ${error.message}`;
                    window.mostrarAlerta(error.message, 'error');
                } finally {
                    buttons.forEach(item => { item.disabled = false; });
                }
            });
        });

        const insightSettingFields = {
            consumoDias: { id: 'insight-consumption-days', minimum: 30, maximum: 365 },
            plazoProveedorDias: { id: 'insight-lead-days', minimum: 1, maximum: 365 },
            stockSeguridadDias: { id: 'insight-safety-days', minimum: 0, maximum: 180 },
            metaEntregaDias: { id: 'insight-sla-days', minimum: 1, maximum: 365 },
            sinMovimientoDias: { id: 'insight-stagnant-days', minimum: 30, maximum: 730 }
        };
        let supplierLeadTimeData = null;
        try {
            const savedSettings = JSON.parse(localStorage.getItem('g4sInventoryInsightSettings') || '{}');
            Object.entries(insightSettingFields).forEach(([key, field]) => {
                const value = Number(savedSettings[key]);
                if (Number.isInteger(value) && value >= field.minimum && value <= field.maximum) {
                    document.getElementById(field.id).value = String(value);
                }
            });
        } catch (error) {
            console.warn('No se pudieron leer los parámetros guardados del análisis:', error);
        }

        const insightNumber = value => Number(value || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
        const insightCurrency = value => value == null
            ? 'Sin costo'
            : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
        const insightDate = value => {
            if (!value) return 'Sin salidas registradas';
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleDateString('es-CO');
        };
        const insightArticle = item =>
            `<strong>${window.escapeHtml(item.idArticulo || '')}</strong><small>${window.escapeHtml(item.descripcion || '')}</small>`;
        const insightEmptyRow = (columns, message) =>
            `<tr><td colspan="${columns}" class="insight-empty">${window.escapeHtml(message)}</td></tr>`;

        function renderSupplierLeadChart(series, provider) {
            const chartElement = document.getElementById('supplier-lead-chart');
            const chartStatus = document.getElementById('supplier-lead-chart-status');
            const validValues = series.filter(item => item.average != null);
            const chartTitle = provider
                ? `Promedio mensual de días de entrega para ${provider}`
                : 'Promedio mensual de días de entrega para todos los proveedores';
            chartElement.setAttribute('aria-label', chartTitle);
            chartStatus.classList.remove('is-error');
            if (!validValues.length) {
                chartElement.classList.add('is-empty');
                chartStatus.textContent = '';
            } else {
                chartElement.classList.remove('is-empty');
                chartStatus.textContent = 'Pasa el cursor sobre el área para ver el promedio y las recepciones del mes.';
            }
            renderDashboardChart('renderSupplierLeadChart', chartElement, {
                series,
                onFormatNumber: insightNumber
            });
        }

        window.renderizarTiempoEntregaProveedor = function(data) {
            supplierLeadTimeData = data || null;
            const select = document.getElementById('supplier-lead-filter');
            const selectedProvider = select.value;
            const providers = Array.isArray(data?.proveedores) ? data.proveedores : [];
            select.replaceChildren(
                new Option('Todos los proveedores', ''),
                ...providers.map(item => new Option(item.proveedor, item.proveedor))
            );
            if (providers.some(item => item.proveedor === selectedProvider)) select.value = selectedProvider;
            const provider = select.value;
            const selectedStats = providers.find(item => item.proveedor === provider);
            const summary = provider ? selectedStats : data;
            const formatDays = value => value == null ? 'Sin datos' : `${insightNumber(value)} días`;
            document.getElementById('supplier-lead-chart-title').textContent =
                provider ? `Tiempo promedio · ${provider}` : 'Promedio mensual · todos los proveedores';
            document.getElementById('supplier-lead-average').textContent = formatDays(summary?.promedioDias);
            document.getElementById('supplier-lead-median').textContent = formatDays(summary?.medianaDias);
            document.getElementById('supplier-lead-p90').textContent = formatDays(summary?.percentil90Dias);
            const waiting = Array.isArray(data?.solicitudesEnEspera) ? data.solicitudesEnEspera : [];
            const filteredWaiting = provider ? waiting.filter(item => item.proveedor === provider) : waiting;
            const receipts = Array.isArray(data?.recepcionesRecientes) ? data.recepcionesRecientes : [];
            const filteredReceipts = provider ? receipts.filter(item => item.proveedor === provider) : receipts;
            document.getElementById('supplier-lead-open').textContent =
                insightNumber(provider ? selectedStats?.abiertas : data?.abiertas);
            document.getElementById('supplier-lead-wait').textContent = provider
                ? `Espera promedio ${formatDays(selectedStats?.esperaPromedioDias)} · máxima ${formatDays(selectedStats?.esperaMaximaDias)}`
                : `Espera promedio ${formatDays(data?.esperaPromedioDias)} · máxima ${formatDays(data?.esperaMaximaDias)}`;

            const monthlyRows = Array.isArray(data?.meses) ? data.meses : [];
            const series = monthlyRows.map(month => {
                const supplierMonth = provider
                    ? month.proveedores?.find(item => item.proveedor === provider)
                    : null;
                return {
                    month: month.mes,
                    average: provider ? supplierMonth?.promedioDias ?? null : month.promedioDias,
                    count: provider ? supplierMonth?.recibidas ?? 0 : month.recibidas
                };
            });
            renderSupplierLeadChart(series, provider);

            const providerBody = document.getElementById('supplier-lead-providers');
            providerBody.innerHTML = providers.length
                ? providers.slice(0, 20).map(item => `<tr>
                    <td>${window.escapeHtml(item.proveedor)}</td>
                    <td>${insightNumber(item.recibidas)}</td>
                    <td>${formatDays(item.promedioDias)}</td>
                    <td>${formatDays(item.percentil90Dias)}</td>
                    <td>${insightNumber(item.abiertas)}</td>
                </tr>`).join('')
                : insightEmptyRow(5, 'No hay recepciones de proveedor registradas en los últimos 12 meses.');

            const waitingBody = document.getElementById('supplier-lead-waiting-list');
            waitingBody.innerHTML = filteredWaiting.length
                ? filteredWaiting.slice(0, 10).map(item => `<tr>
                    <td>${window.escapeHtml(String(item.idSolicitud || '').slice(0, 8).toUpperCase())}</td>
                    <td>${window.escapeHtml(item.proveedor || 'Sin proveedor')}</td>
                    <td>${insightDate(item.fechaSolicitud)}</td>
                    <td><strong>${insightNumber(item.diasEspera)} días</strong></td>
                </tr>`).join('')
                : insightEmptyRow(4, provider
                    ? 'Este proveedor no tiene solicitudes pendientes de recepción.'
                    : 'No hay solicitudes pendientes de recepción.');
            const receiptsBody = document.getElementById('supplier-lead-receipts-list');
            receiptsBody.innerHTML = filteredReceipts.length
                ? filteredReceipts.slice(0, 10).map(item => `<tr>
                    <td>${window.escapeHtml(String(item.idSolicitud || '').slice(0, 8).toUpperCase())}</td>
                    <td>${window.escapeHtml(item.proveedor || 'Sin proveedor')}</td>
                    <td>${insightDate(item.fechaSolicitud)}</td>
                    <td>${insightDate(item.fechaRecepcion)}</td>
                    <td><strong>${insightNumber(item.diasEntrega)} días</strong></td>
                </tr>`).join('')
                : insightEmptyRow(5, provider
                    ? 'No hay recepciones recientes de este proveedor.'
                    : 'No hay recepciones registradas en los últimos 12 meses.');
            const feedback = document.getElementById('supplier-lead-feedback');
            feedback.classList.remove('is-error');
            feedback.textContent =
                `${insightNumber(data?.recibidas)} solicitudes recibidas medidas en los últimos 12 meses · ${insightNumber(data?.proveedoresSinNombre)} solicitudes sin proveedor identificado.`;
        };
        document.getElementById('supplier-lead-filter').addEventListener('change', () => {
            if (supplierLeadTimeData) window.renderizarTiempoEntregaProveedor(supplierLeadTimeData);
        });

        window.renderizarAnaliticaInventario = function(data) {
            const parameters = data.parametros || {};
            const targetCoverageDays = Number(parameters.plazoProveedorDias) + Number(parameters.stockSeguridadDias);
            document.getElementById('insight-low-coverage').textContent =
                insightNumber(data.articulosPorDebajoCobertura);
            document.getElementById('insight-overdue-requests').textContent =
                insightNumber(data.solicitudesAbiertas?.vencidas);
            const delivery = data.cumplimientoEntrega || {};
            document.getElementById('insight-on-time-rate').textContent =
                delivery.porcentaje == null ? 'Sin datos' : `${insightNumber(delivery.porcentaje)}%`;
            const deliveryDetail = delivery.entregadas
                ? `${insightNumber(delivery.aTiempo)}/${insightNumber(delivery.entregadas)} a tiempo · mediana ${insightNumber(delivery.medianaDias)} días · P90 ${insightNumber(delivery.percentil90Dias)} días`
                : 'Sin solicitudes de cliente entregadas en los últimos 90 días';
            document.getElementById('insight-on-time-detail').textContent =
                `${deliveryDetail} · meta ${parameters.metaEntregaDias} días`;
            document.getElementById('insight-stagnant-value').textContent =
                insightCurrency(data.valorInventarioInmovilizadoConCosto);
            document.getElementById('insight-stagnant-detail').textContent =
                `${insightNumber(data.articulosSinMovimientoTotal)} referencias sin salidas en ${parameters.sinMovimientoDias} días · ${insightNumber(data.articulosSinMovimientoSinCosto)} de ellas sin costo`;

            const replenishmentRows = Array.isArray(data.reposicion) ? data.reposicion : [];
            const coverageRows = Array.isArray(data.cobertura) ? data.cobertura : [];
            const allCoverageRows = new Map(coverageRows.map(item => [item.idArticulo, item]));
            replenishmentRows.forEach(item => allCoverageRows.set(item.idArticulo, item));
            const coverageSorted = [...allCoverageRows.values()].sort((first, second) => {
                if (first.cantidadSugerida > 0 && second.cantidadSugerida <= 0) return -1;
                if (second.cantidadSugerida > 0 && first.cantidadSugerida <= 0) return 1;
                return (first.coberturaDias ?? Infinity) - (second.coberturaDias ?? Infinity);
            }).slice(0, 25);
            document.getElementById('insight-replenishment-body').innerHTML = coverageSorted.length
                ? coverageSorted.map(item => `<tr>
                    <td>${insightArticle(item)}</td>
                    <td>${insightNumber(item.stockActual)}</td>
                    <td>${insightNumber(item.consumoDiario)} u.</td>
                    <td>${item.coberturaDias == null ? 'Sin consumo' : `${insightNumber(item.coberturaDias)} días`}</td>
                    <td>${Number(item.cantidadSugerida) > 0
                        ? `<strong>${insightNumber(item.cantidadSugerida)} u.</strong>${item.valorReposicionEstimado == null ? '' : `<small>${insightCurrency(item.valorReposicionEstimado)}</small>`}`
                        : '—'}</td>
                </tr>`).join('')
                : insightEmptyRow(5, 'No hay artículos con consumo o reposición pendiente.');
            const coveragePanelHelp = document.querySelector('#insight-replenishment-body')
                ?.closest('.dashboard-panel')?.querySelector('.insight-panel-help');
            if (coveragePanelHelp) {
                coveragePanelHelp.textContent =
                    `${insightNumber(data.articulosQueRequierenReposicion)} artículos requieren reposición · ${insightNumber(data.cantidadTotalSugerida)} unidades sugeridas · objetivo ${insightNumber(targetCoverageDays)} días.`;
            }

            const openRequests = data.solicitudesAbiertas || {};
            document.getElementById('insight-request-aging-summary').textContent =
                `${insightNumber(openRequests.total)} abiertas · 0–7 días: ${insightNumber(openRequests.hasta7Dias)} · 8–14: ${insightNumber(openRequests.de8a14Dias)} · 15+: ${insightNumber(openRequests.masDe14Dias)} · vencidas: ${insightNumber(openRequests.vencidas)}.`;
            const oldestRequests = Array.isArray(openRequests.masAntiguas) ? openRequests.masAntiguas : [];
            document.getElementById('insight-old-requests-body').innerHTML = oldestRequests.length
                ? oldestRequests.map(request => `<tr>
                    <td>${window.escapeHtml(String(request.idSolicitud || '').slice(0, 8).toUpperCase())}</td>
                    <td>${window.escapeHtml(request.estado || '')}</td>
                    <td><strong>${window.escapeHtml(request.tipoSolicitud || '')}</strong><small>${window.escapeHtml(request.regional || 'Sin regional')}</small></td>
                    <td>${insightNumber(request.edadDias)} días</td>
                </tr>`).join('')
                : insightEmptyRow(4, 'No hay solicitudes abiertas.');

            const stagnantItems = Array.isArray(data.articulosSinMovimiento) ? data.articulosSinMovimiento : [];
            document.getElementById('insight-stagnant-summary').textContent =
                `${insightNumber(data.articulosSinMovimientoTotal)} referencias con stock sin salidas por ${parameters.sinMovimientoDias} días o más. Mostrando hasta 25; el valor suma solo referencias con costo registrado.`;
            document.getElementById('insight-stagnant-body').innerHTML = stagnantItems.length
                ? stagnantItems.slice(0, 25).map(item => `<tr>
                    <td>${insightArticle(item)}</td>
                    <td>${insightNumber(item.stockActual)}</td>
                    <td>${item.diasSinSalida == null ? 'Nunca' : `${insightDate(item.ultimaSalida)} · ${insightNumber(item.diasSinSalida)} días`}</td>
                    <td>${insightCurrency(item.valorEstimado)}</td>
                </tr>`).join('')
                : insightEmptyRow(4, 'No hay artículos inmovilizados con stock positivo.');

            const abcRows = Array.isArray(data.abc) ? data.abc : [];
            document.getElementById('insight-abc-summary').textContent =
                `Valor consumido: ${insightCurrency(data.valorConsumoPeriodo)} · A: ${insightCurrency(data.valorConsumoPorClase?.A)} · B: ${insightCurrency(data.valorConsumoPorClase?.B)} · C: ${insightCurrency(data.valorConsumoPorClase?.C)} · ${insightNumber(data.valorConsumoSinCosto)} artículos con consumo sin costo. Mostrando hasta 25.`;
            document.getElementById('insight-abc-body').innerHTML = abcRows.length
                ? abcRows.slice(0, 25).map(item => `<tr>
                    <td><span class="insight-class insight-class-${String(item.clasificacion || 'c').toLowerCase()}">${window.escapeHtml(item.clasificacion || '')}</span></td>
                    <td>${insightArticle(item)}</td>
                    <td>${insightCurrency(item.valorConsumo)}</td>
                    <td>${insightNumber(item.acumulado)}%</td>
                </tr>`).join('')
                : insightEmptyRow(4, 'No hay consumo valorizado en el periodo.');
            window.renderizarTiempoEntregaProveedor(data.tiempoEntregaProveedor || {});
        };

        window.cargarAnaliticaInventario = async function() {
            const button = document.getElementById('btn-inventory-insights-refresh');
            const feedback = document.getElementById('inventory-insights-feedback');
            const settings = {};
            Object.entries(insightSettingFields).forEach(([key, field]) => {
                settings[key] = Number(document.getElementById(field.id).value);
            });
            const invalidSetting = Object.entries(insightSettingFields).find(([key, field]) =>
                !Number.isInteger(settings[key]) || settings[key] < field.minimum || settings[key] > field.maximum
            );
            if (invalidSetting) {
                const field = insightSettingFields[invalidSetting[0]];
                feedback.textContent = `Revisa el parámetro: debe ser un número entero entre ${field.minimum} y ${field.maximum}.`;
                feedback.classList.add('is-error');
                return;
            }
            button.disabled = true;
            feedback.classList.remove('is-error');
            feedback.textContent = 'Calculando cobertura, solicitudes y consumo...';
            try {
                try {
                    localStorage.setItem('g4sInventoryInsightSettings', JSON.stringify(settings));
                } catch (storageError) {
                    console.warn('No se pudieron guardar los parámetros del análisis:', storageError);
                }
                const response = await apiRequest({ action: 'obtener_analitica_inventario', ...settings });
                const result = await response.json();
                if (result.status !== 'success') throw new Error(result.message || 'No se pudo calcular la analítica');
                const data = result.data || {};
                window.renderizarAnaliticaInventario(data);
                feedback.textContent =
                    `Análisis actualizado · consumo ${settings.consumoDias} días · solicitudes entregadas evaluadas en los últimos 90 días.`;
                return data;
            } catch (error) {
                console.error('No se pudo cargar el análisis de inventario:', error);
                feedback.textContent = `No se pudo actualizar el análisis: ${error.message}. Si el servicio indica que la acción no está permitida, actualiza y despliega apps-script/Code.gs.`;
                feedback.classList.add('is-error');
                return null;
            } finally {
                button.disabled = false;
            }
        };
        document.getElementById('btn-inventory-insights-refresh').addEventListener('click', window.cargarAnaliticaInventario);

        window.switchTab = function(tabName, tabElement) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            document.querySelectorAll('.tab').forEach(tab => {
                const isActive = tab === tabElement;
                tab.setAttribute('aria-selected', String(isActive));
                tab.tabIndex = isActive ? 0 : -1;
            });
            tabElement.classList.add('active');
            if (tabName === 'dashboard') window.cargarDashboard();
            if (tabName === 'reportes') window.cargarAnaliticaInventario();
            if (tabName === 'solicitudes') window.cargarSolicitudes();
            if (tabName === 'historial') window.cargarHistorial();
        }

        document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
            const tabKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!tabKeys.includes(event.key)) return;
            const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
            const currentIndex = tabs.indexOf(event.target);
            if (currentIndex < 0) return;
            event.preventDefault();
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? tabs.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
        });

        const historyMatchesColumn = (row, column) => {
            const selected = historyFilters[column.key];
            if (!selected.length) return true;
            const option = column.value(row);
            return Boolean(option && selected.includes(option.value));
        };

        const getHistoryFilterOptions = columnKey => {
            const otherColumns = historyFilterColumns.filter(column => column.key !== columnKey);
            const options = new Map();
            historyMovementRows.forEach(row => {
                if (!otherColumns.every(column => historyMatchesColumn(row, column))) return;
                const option = historyFilterColumns.find(column => column.key === columnKey).value(row);
                if (option && option.value && !options.has(option.value)) options.set(option.value, option.label);
            });
            return [...options.entries()].sort((first, second) =>
                first[1].localeCompare(second[1], 'es', { numeric: true, sensitivity: 'base' })
            );
        };

        const pruneHistoryFilters = startAtIndex => {
            historyFilterColumns.slice(startAtIndex).forEach(column => {
                const allowedValues = new Set(getHistoryFilterOptions(column.key).map(([value]) => value));
                historyFilters[column.key] = historyFilters[column.key].filter(value => allowedValues.has(value));
            });
        };

        const renderHistoryFilterPopover = () => {
            if (!activeHistoryFilter) return;
            const column = historyFilterColumns.find(item => item.key === activeHistoryFilter);
            const options = getHistoryFilterOptions(column.key);
            const selectedValues = historyFilters[column.key];
            const container = document.getElementById('history-filter-options');
            document.getElementById('history-filter-title').textContent = `Filtrar por ${column.label.toLocaleLowerCase('es')}`;
            document.getElementById('history-filter-count').textContent =
                selectedValues.length ? `${selectedValues.length} seleccionada${selectedValues.length === 1 ? '' : 's'}` : `${options.length} opciones`;
            container.innerHTML = options.length
                ? options.map(([value, label], index) => {
                    const id = `history-filter-${column.key}-${index}`;
                    const checked = selectedValues.includes(value);
                    return `<label class="history-filter-option" for="${id}">
                        <input id="${id}" type="checkbox" value="${window.escapeHtml(value)}" ${checked ? 'checked' : ''}>
                        <span>${window.escapeHtml(label)}</span>
                    </label>`;
                }).join('')
                : `<p class="history-filter-empty">${window.escapeHtml(column.emptyLabel)}</p>`;
        };

        const positionHistoryFilterPopover = () => {
            const popover = document.getElementById('history-filter-popover');
            if (!activeHistoryFilterTrigger || popover.hidden) return;
            const anchor = activeHistoryFilterTrigger.getBoundingClientRect();
            const margin = 12;
            const width = Math.min(340, window.innerWidth - margin * 2);
            popover.style.width = `${width}px`;
            popover.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
            popover.style.top = `${Math.min(anchor.bottom + 8, window.innerHeight - popover.offsetHeight - margin)}px`;
            if (popover.getBoundingClientRect().top < margin) popover.style.top = `${margin}px`;
        };

        const updateHistoryFilterIndicators = () => {
            let activeColumns = 0;
            let activeSelections = 0;
            historyFilterColumns.forEach(column => {
                const count = historyFilters[column.key].length;
                if (count) activeColumns++;
                activeSelections += count;
                const trigger = document.querySelector(`[data-history-filter-trigger="${column.key}"]`);
                trigger.classList.toggle('is-active', count > 0);
                trigger.setAttribute('aria-label', count ? `Filtrar por ${column.label}; ${count} seleccionada${count === 1 ? '' : 's'}` : `Filtrar por ${column.label}`);
                trigger.dataset.selectedCount = count ? String(count) : '';
            });
            const clearButton = document.getElementById('history-clear-column-filters');
            clearButton.hidden = activeSelections === 0;
            document.getElementById('history-filter-summary').textContent =
                activeSelections
                    ? `${activeColumns} columna${activeColumns === 1 ? '' : 's'} · ${activeSelections} opción${activeSelections === 1 ? '' : 'es'} seleccionada${activeSelections === 1 ? '' : 's'}`
                    : 'Filtra seleccionando una o varias opciones por columna';
        };

        window.renderizarHistorial = function() {
            const body = document.getElementById('history-table-body');
            const rows = historyMovementRows.filter(row =>
                historyFilterColumns.every(column => historyMatchesColumn(row, column))
            ).sort((first, second) => {
                const firstTime = new Date(first.fechaHora).getTime() || 0;
                const secondTime = new Date(second.fechaHora).getTime() || 0;
                return (firstTime - secondTime) * historyDateSortDirection;
            });
            const sortButton = document.getElementById('history-date-sort');
            if (!sortButton || !body) throw new Error('No se encontró la tabla de historial o su control de orden');
            sortButton.closest('th').setAttribute('aria-sort', historyDateSortDirection === 1 ? 'ascending' : 'descending');
            sortButton.innerHTML = `Fecha <i class="fa-solid ${historyDateSortDirection === 1 ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short'}" aria-hidden="true"></i>`;
            updateHistoryFilterIndicators();
            if (activeHistoryFilter) {
                renderHistoryFilterPopover();
                positionHistoryFilterPopover();
            }
            const resultCount = document.getElementById('history-result-count');
            if (resultCount) resultCount.textContent = `${rows.length.toLocaleString('es-CO')} movimientos`;
            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="9">No hay movimientos para los filtros seleccionados.</td></tr>';
                return;
            }
            body.innerHTML = rows.map(row => {
                const date = row.fechaHora ? new Date(row.fechaHora).toLocaleString('es-CO') : '';
                const canAnnul = canReconcileInventory && row.estado === 'Confirmado' && !row.relacionada;
                const statusClass = String(row.estado || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const actions = canAnnul
                    ? `<button type="button" class="btn-secondary photo-button" onclick="window.anularMovimiento('${window.escapeHtml(row.idTransaccion)}')">Anular</button>`
                    : `${window.escapeHtml(row.relacionada || (row.justificacionAnulacion ? `Anulada: ${row.justificacionAnulacion}` : 'Sin acciones'))}`;
                return `<tr class="history-row">
                    <td data-label="Fecha">${window.escapeHtml(date)}</td>
                    <td data-label="Artículo"><strong>${window.escapeHtml(window.nombreArticulo(row.idArticulo))}</strong></td>
                    <td data-label="Tipo"><span class="movement-type">${window.escapeHtml(row.tipoMovimiento)}</span></td>
                    <td data-label="Cantidad"><span class="movement-quantity">${Number(row.cantidad) || 0}</span></td>
                    <td data-label="Cliente/Proveedor">${window.escapeHtml(row.clienteProveedor || row.entregadoA || '—')}</td>
                    <td data-label="Regional">${window.escapeHtml(row.regional || row.regionalOrigen || row.regionalDestino || '—')}</td>
                    <td data-label="Estado"><span class="movement-status status-${statusClass}">${window.escapeHtml(row.estado)}</span></td>
                    <td data-label="Usuario">${window.escapeHtml(row.registradoPor)}</td>
                    <td data-label="Acción"><div class="history-actions">${actions}</div></td>
                </tr>`;
            }).join('');
        };

        window.cargarHistorial = function() {
            const body = document.getElementById('history-table-body');
            if (!body) {
                window.mostrarAlerta('No se encontró la tabla del historial. Recarga la aplicación para actualizar su interfaz.', 'error');
                return;
            }
            body.innerHTML = '<tr><td colspan="9">Cargando movimientos...</td></tr>';
            const payload = {
                action: 'obtener_movimientos',
                desde: document.getElementById('history-from')?.value || '',
                hasta: document.getElementById('history-to')?.value || '',
                filtro: document.getElementById('history-filter')?.value.trim() || ''
            };
            apiRequest(payload)
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo cargar el historial');
                    historyMovementRows = Array.isArray(result.data) ? result.data : [];
                    pruneHistoryFilters(0);
                    window.renderizarHistorial();
                }).catch(error => { body.innerHTML = `<tr><td colspan="9">${window.escapeHtml(error.message)}</td></tr>`; });
        };

        window.anularMovimiento = function(idTransaccion) {
            window.procesarAnulacionMovimiento(idTransaccion);
        };

        window.procesarAnulacionMovimiento = async function(idTransaccion) {
            if (!canReconcileInventory) {
                window.mostrarAlerta('Solo un administrador puede anular movimientos', 'error');
                return;
            }
            const justificacion = await window.confirmarAccion(
                'El movimiento quedará marcado como anulado y se conservará en el historial.',
                { titulo: 'Anular movimiento', danger: true, confirmLabel: 'Anular movimiento', requireReason: true }
            );
            if (!justificacion) return;
            apiRequest({ action: 'anular_movimiento', idTransaccion, justificacion })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo anular el movimiento');
                    window.mostrarAlerta('Movimiento anulado correctamente; no se creó una transacción inversa.', 'success');
                    window.cargarHistorial();
                    window.cargarCatalogo();
                    window.cargarDashboard();
                }).catch(error => window.mostrarAlerta(error.message, 'error'));
        };

        document.getElementById('btn-history-search').addEventListener('click', window.cargarHistorial);
        document.getElementById('history-date-sort').addEventListener('click', () => {
            historyDateSortDirection *= -1;
            window.renderizarHistorial();
        });
        const historyPopover = document.getElementById('history-filter-popover');
        const closeHistoryFilterPopover = () => {
            historyPopover.hidden = true;
            activeHistoryFilter = '';
            activeHistoryFilterTrigger?.setAttribute('aria-expanded', 'false');
            activeHistoryFilterTrigger = null;
        };
        const openHistoryFilterPopover = trigger => {
            const column = trigger.dataset.historyFilterTrigger;
            if (activeHistoryFilter === column && !historyPopover.hidden) {
                closeHistoryFilterPopover();
                return;
            }
            activeHistoryFilterTrigger?.setAttribute('aria-expanded', 'false');
            activeHistoryFilter = column;
            activeHistoryFilterTrigger = trigger;
            trigger.setAttribute('aria-expanded', 'true');
            renderHistoryFilterPopover();
            historyPopover.hidden = false;
            positionHistoryFilterPopover();
        };
        document.querySelectorAll('[data-history-filter-trigger]').forEach(trigger => {
            trigger.setAttribute('aria-expanded', 'false');
            trigger.addEventListener('click', () => openHistoryFilterPopover(trigger));
        });
        historyPopover.addEventListener('change', event => {
            if (!event.target.matches('input[type="checkbox"]') || !activeHistoryFilter) return;
            const selectedValues = historyFilters[activeHistoryFilter];
            if (event.target.checked) {
                if (!selectedValues.includes(event.target.value)) selectedValues.push(event.target.value);
            } else {
                historyFilters[activeHistoryFilter] = selectedValues.filter(value => value !== event.target.value);
            }
            pruneHistoryFilters(0);
            window.renderizarHistorial();
        });
        document.getElementById('history-clear-column-filters').addEventListener('click', () => {
            historyFilterColumns.forEach(column => { historyFilters[column.key] = []; });
            closeHistoryFilterPopover();
            window.renderizarHistorial();
        });
        document.getElementById('history-filter-clear').addEventListener('click', () => {
            if (!activeHistoryFilter) return;
            const columnIndex = historyFilterColumns.findIndex(column => column.key === activeHistoryFilter);
            historyFilters[activeHistoryFilter] = [];
            pruneHistoryFilters(columnIndex + 1);
            window.renderizarHistorial();
        });
        document.getElementById('history-filter-done').addEventListener('click', closeHistoryFilterPopover);
        document.getElementById('history-filter-close').addEventListener('click', closeHistoryFilterPopover);
        document.addEventListener('click', event => {
            if (historyPopover.hidden || historyPopover.contains(event.target) || event.target.closest('[data-history-filter-trigger]')) return;
            closeHistoryFilterPopover();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !historyPopover.hidden) closeHistoryFilterPopover();
        });
        window.addEventListener('resize', positionHistoryFilterPopover);
        window.addEventListener('scroll', positionHistoryFilterPopover, true);

        document.querySelectorAll('[role="tab"]').forEach(tab => {
            tab.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                tab.click();
            });
        });

        window.tipoMovimientoActual = function() {
            return document.getElementById('tipoMov').value;
        };

        window.cambiarMovimientoUI = function(tipo) {
            const providerRequired = ['Entrada', 'Devolucion'].includes(tipo);
            const reasonRequired = ['Ajuste positivo', 'Ajuste negativo', 'Baja por daño'].includes(tipo);
            document.getElementById('salida-fields').style.display = tipo === 'Salida' ? 'block' : 'none';
            document.getElementById('provider-field').style.display = providerRequired ? 'block' : 'none';
            document.getElementById('reason-field').style.display = reasonRequired ? 'block' : 'none';
            document.getElementById('movement-helper').textContent = tipo === 'Entrada' ? 'Destino fijo: Comunicaciones, Bogotá.' : tipo === 'Devolucion' ? 'Devuelve al proveedor un artículo dañado, incorrecto o cubierto por garantía.' : reasonRequired ? 'El motivo queda registrado para auditoría.' : '';
            distributionConfirmed = tipo === 'Salida' ? distributionConfirmed : false;
            distributionConfirmed = false;
            document.getElementById('distribution-review').style.display = 'none';
            window.renderizarCarrito();
        }

        window.cambiarMovimientoUI('Salida');
