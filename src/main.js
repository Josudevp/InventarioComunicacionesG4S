import Choices from "choices.js";
import "@fortawesome/fontawesome-free/css/fontawesome.css";
import "@fortawesome/fontawesome-free/css/solid.css";
import "choices.js/public/assets/styles/choices.min.css";
import "./tailwind.css";
import { apiRequest } from "./services/api.js";

        const LOGO_URL = "assets/LOGO_G4S.jpg";

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
        let inactivityTimer = null;
        const storedUserActivity = sessionStorage.getItem("g4sLastActivity");
        let lastUserActivity = storedUserActivity ? Number(storedUserActivity) : Date.now();
        const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

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
            const previousFocus = document.activeElement;
            document.getElementById('confirm-title').textContent = opciones.titulo || 'Confirmar acción';
            document.getElementById('confirm-message').textContent = mensaje;
            panel.classList.toggle('is-danger', Boolean(opciones.danger));
            accept.textContent = opciones.confirmLabel || 'Confirmar';
            accept.classList.toggle('btn-danger', Boolean(opciones.danger));
            accept.classList.toggle('btn-primary', !opciones.danger);
            modal.hidden = false;

            return new Promise(resolve => {
                const finish = confirmed => {
                    modal.hidden = true;
                    modal.onclick = null;
                    modal.onkeydown = null;
                    cancel.onclick = null;
                    accept.onclick = null;
                    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
                    resolve(confirmed);
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
                        event.preventDefault();
                        (document.activeElement === cancel ? accept : cancel).focus();
                    }
                };
                panel.focus();
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
            document.getElementById('items-list').innerHTML = '<p style="text-align:center; color:#9ca3af; font-size:13px; padding: 20px 0;">No hay ítems seleccionados</p>';
            document.querySelectorAll('#app-screen input[type="text"], #app-screen input[type="number"]').forEach(input => { input.value = ''; });
            document.getElementById('app-screen').style.display = 'none';
            document.getElementById('login-pass').value = '';
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
            });
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
            const button = document.getElementById('btn-editar-acc');
            button.disabled = true;
            apiRequest({
                action: 'actualizar_accesorio', idArticulo,
                descripcion: document.getElementById('edit-desc').value,
                stockMinimo: document.getElementById('edit-min').value,
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
            let list = document.getElementById('items-list'); let btnSubmit = document.getElementById('btn-submit');
            if(carrito.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:#9ca3af; font-size:13px; padding: 20px 0;">No hay ítems seleccionados</p>';
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
                    html += `<div class="item-row">
                            <div class="item-info">🏷️ ${window.escapeHtml(window.nombreArticulo(item.idArticulo))}</div>
                        ${stockWarning}
                            <input type="number" min="1" max="${maxQuantity}" class="qty-input" value="${Math.min(item.cantidad, maxQuantity)}" onchange="window.actualizarCant(${idx}, this.value)" aria-label="Cantidad de ${window.escapeHtml(item.idArticulo)}">
                            <button type="button" class="btn-del" onclick="window.eliminarItem(${idx})" aria-label="Eliminar ${window.escapeHtml(item.idArticulo)}"><i class="fa-solid fa-trash-can"></i></button>
                    </div>`;
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

        const regionalOptions = [
            ['Bogota', 'Bogotá'], ['Eje Cafetero', 'Eje Cafetero'], ['Noroccidente', 'Noroccidente'],
            ['Sabana', 'Sabana'], ['Cordoba', 'Córdoba'], ['Costa', 'Costa'],
            ['Suroccidente', 'Suroccidente'], ['Santanderes', 'Santanderes']
        ];

        window.agregarLineaSolicitud = function() {
            const firstItem = catalogoActual.find(item => item && item.activo !== false);
            requestDraft.push({ idArticulo: firstItem ? firstItem.idArticulo : '', cliente: '', regional: 'Bogota', entregadoA: '', cantidad: 1 });
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
            const regions = selected => regionalOptions.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
            container.innerHTML = requestDraft.map((line, index) => `<div class="request-draft-row">
                <div class="request-field"><label for="request-article-${index}">Artículo</label><select id="request-article-${index}" aria-label="Artículo de la línea ${index + 1}" onchange="window.actualizarLineaSolicitud(${index}, 'idArticulo', this.value)"><option value="">Selecciona artículo</option>${itemOptions}</select></div>
                <label>Cliente<input type="text" value="${window.escapeHtml(line.cliente)}" placeholder="Cliente" maxlength="150" onchange="window.actualizarLineaSolicitud(${index}, 'cliente', this.value)"></label>
                <div class="request-field"><label for="request-regional-${index}">Regional</label><select id="request-regional-${index}" aria-label="Regional de la línea ${index + 1}" onchange="window.actualizarLineaSolicitud(${index}, 'regional', this.value)">${regions(line.regional)}</select></div>
                <label>Entregado a<input type="text" value="${window.escapeHtml(line.entregadoA)}" placeholder="Persona destinataria" maxlength="150" onchange="window.actualizarLineaSolicitud(${index}, 'entregadoA', this.value)"></label>
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
            const items = requestDraft.map(line => ({
                idArticulo: line.idArticulo,
                cliente: line.cliente.trim(),
                regional: line.regional,
                entregadoA: line.entregadoA.trim(),
                cantidad: Number(line.cantidad)
            }));
            if (!items.length || items.some(line => !line.idArticulo || !line.cliente || !line.regional || !line.entregadoA || !Number.isInteger(line.cantidad) || line.cantidad < 1)) {
                window.mostrarAlerta('Completa artículo, cliente, regional, destinatario y cantidad en cada línea', 'error');
                return;
            }
            const button = document.getElementById('btn-save-request');
            button.disabled = true;
            apiRequest({ action: 'crear_solicitud', items })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo registrar la solicitud');
                    window.mostrarAlerta(`Solicitud ${result.idSolicitud.slice(0, 8)} registrada`, 'success');
                    requestDraft = [];
                    window.agregarLineaSolicitud();
                    window.cargarSolicitudes();
                    window.cargarDashboard();
                }).catch(error => window.mostrarAlerta(error.message, 'error'))
                .finally(() => { button.disabled = false; });
        };

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
                const date = request.fechaRegistro ? new Date(request.fechaRegistro).toLocaleDateString('es-CO') : '';
                const total = request.items.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
                const accessoryTotals = Array.isArray(request.resumenAccesorios) ? request.resumenAccesorios : [];
                const clients = [...new Set(request.items.map(item => String(item.cliente || '').trim()).filter(Boolean))];
                const regions = [...new Set(request.items.map(item => String(item.regional || '').trim()).filter(Boolean))];
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
                    action = `<label class="request-provider-field">Proveedor<input type="text" data-provider-for="${safeId}" placeholder="Proveedor solicitado" maxlength="150"></label><button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Solicitada', this)">Marcar solicitada</button><button type="button" class="btn-secondary request-transition" onclick="window.actualizarEstadoSolicitud('${safeId}', 'Anulada', this)">Anular solicitud</button>`;
                } else if (request.estado === 'Solicitada') {
                    action = '<button type="button" class="btn-primary request-transition" onclick="window.actualizarEstadoSolicitud(\'' + safeId + '\', \'Recibida\', this)">Registrar recepción</button><button type="button" class="btn-secondary request-transition" onclick="window.actualizarEstadoSolicitud(\'' + safeId + '\', \'Anulada\', this)">Anular solicitud</button>';
                } else if (request.estado === 'Recibida') {
                    action = '<button type="button" class="btn-black request-transition" onclick="window.actualizarEstadoSolicitud(\'' + safeId + '\', \'Entregada\', this)">Marcar entregada</button>';
                } else if (request.estado === 'Anulada') {
                    action = '<span class="request-cancelled"><i class="fa-solid fa-ban"></i> Solicitud anulada</span>';
                } else {
                    action = '<span class="request-complete"><i class="fa-solid fa-circle-check"></i> Entregada</span>';
                }
                return `<article class="request-card">
                    <button type="button" class="request-card-toggle" data-request-toggle aria-expanded="false" aria-controls="${detailsId}">
                        <span class="request-card-toggle-main">
                            <span class="request-card-identity"><strong class="request-reference">SOL-${shortId}</strong><small>${window.escapeHtml(date)} · ${window.escapeHtml(request.registradoPor)}</small></span>
                            <span class="request-status status-${request.estado.toLowerCase()}">${window.escapeHtml(request.estado)}</span>
                        </span>
                        <span class="request-card-parties">
                            <span><small>Cliente</small><strong>${window.escapeHtml(clients.join(', ') || 'Sin cliente')}</strong></span>
                            <span><small>Regional</small><strong>${window.escapeHtml(regions.join(', ') || 'Sin regional')}</strong></span>
                            <i class="fa-solid fa-chevron-down request-card-chevron" aria-hidden="true"></i>
                        </span>
                    </button>
                    <div class="request-card-details" id="${detailsId}" hidden>
                        <div class="request-card-summary"><span>${request.items.length} líneas</span><strong>${total} unidades</strong>${request.proveedor ? `<span>Proveedor: ${window.escapeHtml(request.proveedor)}</span>` : ''}</div>
                        ${accessorySummary}
                        <div class="request-item-list">${lines}</div>
                        <footer class="request-card-actions">${action}</footer>
                    </div>
                </article>`;
            }).join('');
        };

        window.actualizarEstadoSolicitud = async function(idSolicitud, estado, button) {
            const confirmation = estado === 'Recibida'
                ? 'La recepción sumará las unidades al inventario. ¿Confirmar?'
                : estado === 'Entregada'
                    ? 'La entrega descontará las unidades del inventario. ¿Confirmar?'
                    : estado === 'Anulada'
                        ? 'La solicitud se anulará y no podrá avanzar a recepción o entrega. ¿Continuar?'
                        : '';
            if (confirmation && !(await window.confirmarAccion(confirmation, {
                titulo: estado === 'Recibida' ? 'Confirmar recepción' : estado === 'Entregada' ? 'Confirmar entrega' : 'Anular solicitud'
            }))) return;
            let proveedor = '';
            if (estado === 'Solicitada') {
                const field = document.querySelector(`[data-provider-for="${idSolicitud}"]`);
                proveedor = field ? field.value.trim() : '';
                if (!proveedor) {
                    window.mostrarAlerta('Indica el proveedor para avanzar la solicitud', 'error');
                    return;
                }
            }
            button.disabled = true;
            apiRequest({ action: 'actualizar_estado_solicitud', idSolicitud, estado, proveedor })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo actualizar la solicitud');
                    window.mostrarAlerta(`Solicitud actualizada: ${result.estado}`, 'success');
                    window.cargarSolicitudes();
                    window.cargarDashboard();
                    if (estado === 'Recibida' || estado === 'Entregada') window.cargarCatalogo();
                }).catch(error => window.mostrarAlerta(error.message, 'error'))
                .finally(() => { button.disabled = false; });
        };

        window.renderizarGraficoUnidades = function() {
            const container = document.getElementById('dashboard-movement-chart');
            if (!container || !dashboardChartData) return;
            const rows = dashboardChartData.slice(-dashboardChartMonths);
            const width = 640;
            const height = 260;
            const margin = { top: 16, right: 16, bottom: 38, left: 42 };
            const chartWidth = width - margin.left - margin.right;
            const chartHeight = height - margin.top - margin.bottom;
            const visibleValues = rows.flatMap(row => [
                dashboardVisibleSeries.entradas ? Number(row.entradas) || 0 : 0,
                dashboardVisibleSeries.salidas ? Number(row.salidas) || 0 : 0
            ]);
            const maxValue = Math.max(...visibleValues, 1);
            const step = Math.max(1, Math.ceil(maxValue / 4));
            const axisMax = step * 4;
            const groupWidth = chartWidth / rows.length;
            const barWidth = Math.min(24, groupWidth * 0.28);
            const y = value => margin.top + chartHeight - (value / axisMax) * chartHeight;
            const grid = Array.from({ length: 5 }, (_, index) => {
                const value = axisMax - step * index;
                const lineY = y(value);
                return `<g class="chart-grid-line"><line x1="${margin.left}" y1="${lineY}" x2="${width - margin.right}" y2="${lineY}"></line><text x="${margin.left - 8}" y="${lineY + 4}" text-anchor="end">${value.toLocaleString('es-CO')}</text></g>`;
            }).join('');
            const bars = rows.map((row, index) => {
                const center = margin.left + groupWidth * (index + 0.5);
                const monthLabel = new Intl.DateTimeFormat('es-CO', { month: 'short' })
                    .format(new Date(`${row.mes}-01T12:00:00`))
                    .replace('.', '');
                const entryValue = Number(row.entradas) || 0;
                const exitValue = Number(row.salidas) || 0;
                const entryHeight = dashboardVisibleSeries.entradas ? (entryValue / axisMax) * chartHeight : 0;
                const exitHeight = dashboardVisibleSeries.salidas ? (exitValue / axisMax) * chartHeight : 0;
                return `<g class="chart-month">
                    ${dashboardVisibleSeries.entradas ? `<rect class="chart-bar chart-entry-bar" x="${center - barWidth - 2}" y="${y(entryValue)}" width="${barWidth}" height="${Math.max(entryHeight, entryValue ? 1 : 0)}" rx="3"><title>${monthLabel}: ${entryValue.toLocaleString('es-CO')} unidades ingresadas</title></rect>` : ''}
                    ${dashboardVisibleSeries.salidas ? `<rect class="chart-bar chart-exit-bar" x="${center + 2}" y="${y(exitValue)}" width="${barWidth}" height="${Math.max(exitHeight, exitValue ? 1 : 0)}" rx="3"><title>${monthLabel}: ${exitValue.toLocaleString('es-CO')} unidades retiradas</title></rect>` : ''}
                    <text class="chart-month-label" x="${center}" y="${height - 12}" text-anchor="middle">${monthLabel}</text>
                </g>`;
            }).join('');
            const hasActivity = visibleValues.some(value => value > 0);
            container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="movement-chart-svg" role="img" aria-label="Unidades ingresadas y retiradas en los últimos ${dashboardChartMonths} meses">
                ${grid}${bars}
                ${hasActivity ? '' : `<text class="chart-empty-label" x="${width / 2}" y="${margin.top + chartHeight / 2}" text-anchor="middle">Sin movimientos en este periodo</text>`}
            </svg>`;
        };

        window.seleccionarEstadoDashboard = function(state) {
            const states = dashboardRequestStates;
            if (!states || !Object.prototype.hasOwnProperty.call(states, state)) return;
            dashboardSelectedRequestState = state;
            const label = {
                Registrada: 'Registradas',
                Solicitada: 'Solicitadas',
                Recibida: 'Recibidas',
                Entregada: 'Entregadas',
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
        };

        window.renderizarGraficoSolicitudes = function(states) {
            const chart = document.getElementById('dashboard-request-chart');
            const legend = document.getElementById('dashboard-request-states');
            if (!chart || !legend) return;
            const categories = [
                ['Registrada', 'Registradas', '#2563eb'],
                ['Solicitada', 'Solicitadas', '#f59e0b'],
                ['Recibida', 'Recibidas', '#8b5cf6'],
                ['Entregada', 'Entregadas', '#10b981'],
                ['Anulada', 'Anuladas', '#94a3b8']
            ];
            const total = categories.reduce((sum, [key]) => sum + (Number(states[key]) || 0), 0);
            const radius = 43;
            const circumference = 2 * Math.PI * radius;
            let consumed = 0;
            const segments = categories.map(([key, label, color]) => {
                const count = Number(states[key]) || 0;
                const length = total ? count / total * circumference : 0;
                const offset = -consumed;
                consumed += length;
                return count
                    ? `<circle class="request-donut-segment${dashboardSelectedRequestState === key ? ' is-selected' : ''}" data-request-state-segment="${key}" cx="60" cy="60" r="${radius}" fill="none" stroke="${color}" stroke-width="17" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)"><title>${label}: ${count} solicitudes</title></circle>`
                    : '';
            }).join('');
            chart.innerHTML = `<svg viewBox="0 0 120 120" class="request-donut-svg" aria-hidden="true">
                <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="17"></circle>${segments}
                <text class="request-donut-total" x="60" y="57" text-anchor="middle">${total.toLocaleString('es-CO')}</text>
                <text class="request-donut-caption" x="60" y="71" text-anchor="middle">solicitudes</text>
            </svg>`;
            legend.innerHTML = categories.map(([key, label, color]) => {
                const count = Number(states[key]) || 0;
                return `<button type="button" class="request-state-legend${dashboardSelectedRequestState === key ? ' is-selected' : ''}" data-request-state="${key}" aria-pressed="${dashboardSelectedRequestState === key}" onclick="window.seleccionarEstadoDashboard('${key}')">
                    <span class="chart-legend-dot" style="--legend-color:${color}"></span><span>${label}</span><strong>${count.toLocaleString('es-CO')}</strong>
                </button>`;
            }).join('');
            if (dashboardSelectedRequestState) window.seleccionarEstadoDashboard(dashboardSelectedRequestState);
        };

        window.seleccionarRegionalDashboard = function(index) {
            const item = dashboardRegionalData[index];
            if (!item) return;
            dashboardSelectedRegional = item.regional;
            document.getElementById('dashboard-regional-detail').textContent =
                `${item.regional}: ${Number(item.unidades || 0).toLocaleString('es-CO')} unidades entregadas`;
            document.querySelectorAll('[data-regional-index]').forEach(bar => {
                const selected = Number(bar.dataset.regionalIndex) === index;
                bar.setAttribute('aria-pressed', String(selected));
                bar.classList.toggle('is-selected', selected);
            });
        };

        window.renderizarGraficoRegional = function(regionalData) {
            const container = document.getElementById('dashboard-regional-chart');
            if (!container) return;
            dashboardRegionalData = Array.isArray(regionalData)
                ? regionalData.filter(item => item && item.regional)
                : [];
            if (!dashboardRegionalData.length) {
                container.innerHTML = '<p class="chart-empty-label">Sin entregas registradas</p>';
                document.getElementById('dashboard-regional-detail').textContent =
                    'No hay unidades entregadas por regional para mostrar.';
                return;
            }
            const width = 640;
            const rowHeight = 34;
            const height = Math.max(150, dashboardRegionalData.length * rowHeight + 12);
            const labelWidth = 170;
            const chartWidth = width - labelWidth - 30;
            const maxValue = Math.max(...dashboardRegionalData.map(item => Number(item.unidades) || 0), 1);
            const bars = dashboardRegionalData.map((item, index) => {
                const value = Number(item.unidades) || 0;
                const y = index * rowHeight + 6;
                const barWidth = value / maxValue * chartWidth;
                const selected = dashboardSelectedRegional === item.regional;
                const label = String(item.regional);
                const displayLabel = label.length > 24 ? `${label.slice(0, 22)}…` : label;
                return `<g class="regional-bar-group${selected ? ' is-selected' : ''}" data-regional-index="${index}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${window.escapeHtml(label)}: ${value.toLocaleString('es-CO')} unidades de salida">
                    <title>${window.escapeHtml(label)}: ${value.toLocaleString('es-CO')} unidades de salida</title>
                    <text class="regional-bar-label" x="${labelWidth - 10}" y="${y + 16}" text-anchor="end">${window.escapeHtml(displayLabel)}</text>
                    <rect class="regional-bar-track" x="${labelWidth}" y="${y}" width="${chartWidth}" height="22" rx="4"></rect>
                    <rect class="regional-bar" x="${labelWidth}" y="${y}" width="${Math.max(barWidth, value ? 2 : 0)}" height="22" rx="4"></rect>
                    <text class="regional-bar-value" x="${Math.min(labelWidth + barWidth + 8, width - 8)}" y="${y + 16}" text-anchor="${labelWidth + barWidth + 8 > width - 8 ? 'end' : 'start'}">${value.toLocaleString('es-CO')}</text>
                </g>`;
            }).join('');
            container.innerHTML = `<svg class="regional-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Unidades entregadas por regional">${bars}</svg>`;
            container.querySelectorAll('[data-regional-index]').forEach(bar => {
                const select = () => window.seleccionarRegionalDashboard(Number(bar.dataset.regionalIndex));
                bar.addEventListener('click', select);
                bar.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    select();
                });
            });
            if (dashboardSelectedRegional && !dashboardRegionalData.some(item => item.regional === dashboardSelectedRegional)) {
                dashboardSelectedRegional = '';
            }
            const selectedIndex = dashboardRegionalData.findIndex(item => item.regional === dashboardSelectedRegional);
            if (selectedIndex >= 0) window.seleccionarRegionalDashboard(selectedIndex);
            else document.getElementById('dashboard-regional-detail').textContent =
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
            document.querySelectorAll('[data-accessory-index]').forEach(bar => {
                const selected = Number(bar.dataset.accessoryIndex) === index;
                bar.setAttribute('aria-pressed', String(selected));
                bar.classList.toggle('is-selected', selected);
            });
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
                        container.innerHTML = '<p class="chart-empty-label">Sin entregas registradas en este periodo</p>';
                document.getElementById('dashboard-accessories-detail').textContent =
                            'No hay accesorios entregados para mostrar en este periodo.';
                return;
            }
            if (!dashboardAccessoryData.some(item => item.idArticulo === dashboardSelectedAccessory)) {
                dashboardSelectedAccessory = '';
            }
            const width = 640;
                    const height = 270;
                    const margin = { top: 28, right: 18, bottom: 58, left: 46 };
                    const chartWidth = width - margin.left - margin.right;
                    const chartHeight = height - margin.top - margin.bottom;
            const maxValue = Math.max(...dashboardAccessoryData.map(item => Number(item.unidades) || 0), 1);
                    const step = Math.max(1, Math.ceil(maxValue / 4));
                    const axisMax = step * 4;
                    const y = value => margin.top + chartHeight - value / axisMax * chartHeight;
                    const grid = Array.from({ length: 5 }, (_, index) => {
                        const value = axisMax - step * index;
                        const lineY = y(value);
                        return `<g class="chart-grid-line"><line x1="${margin.left}" y1="${lineY}" x2="${width - margin.right}" y2="${lineY}"></line><text x="${margin.left - 8}" y="${lineY + 4}" text-anchor="end">${value.toLocaleString('es-CO')}</text></g>`;
                    }).join('');
                    const groupWidth = chartWidth / dashboardAccessoryData.length;
                    const barWidth = Math.min(38, groupWidth * 0.56);
            const bars = dashboardAccessoryData.map((item, index) => {
                const value = Number(item.unidades) || 0;
                        const center = margin.left + groupWidth * (index + 0.5);
                        const barHeight = value / axisMax * chartHeight;
                const selected = dashboardSelectedAccessory === item.idArticulo;
                const label = String(item.accesorio);
                        const displayLabel = label.length > 11 ? `${label.slice(0, 10)}…` : label;
                        return `<g class="accessory-column-group${selected ? ' is-selected' : ''}" data-accessory-index="${index}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${window.escapeHtml(label)}: ${value.toLocaleString('es-CO')} unidades entregadas">
                            <title>${window.escapeHtml(label)}: ${value.toLocaleString('es-CO')} unidades entregadas</title>
                            <rect class="chart-bar accessory-column-bar" x="${center - barWidth / 2}" y="${y(value)}" width="${barWidth}" height="${Math.max(barHeight, value ? 1 : 0)}" rx="3"></rect>
                            <text class="accessory-column-value" x="${center}" y="${Math.max(y(value) - 7, margin.top - 8)}" text-anchor="middle">${value.toLocaleString('es-CO')}</text>
                            <text class="chart-month-label accessory-column-label" x="${center}" y="${height - 24}" text-anchor="middle">${window.escapeHtml(displayLabel)}</text>
                </g>`;
            }).join('');
                    container.innerHTML = `<svg class="accessory-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Accesorios ordenados por unidades entregadas">${grid}${bars}</svg>`;
            container.querySelectorAll('[data-accessory-index]').forEach(bar => {
                const select = () => window.seleccionarAccesorioDashboard(Number(bar.dataset.accessoryIndex));
                bar.addEventListener('click', select);
                bar.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    select();
                });
            });
            const selectedIndex = dashboardAccessoryData.findIndex(item => item.idArticulo === dashboardSelectedAccessory);
            if (selectedIndex >= 0) window.seleccionarAccesorioDashboard(selectedIndex);
            else document.getElementById('dashboard-accessories-detail').textContent =
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

        window.switchTab = function(tabName, tabElement) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t === tabElement)));
            tabElement.classList.add('active');
            if (tabName === 'dashboard') window.cargarDashboard();
            if (tabName === 'solicitudes') window.cargarSolicitudes();
            if (tabName === 'historial') window.cargarHistorial();
        }

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
                const canAnnul = row.estado === 'Confirmado' && !row.relacionada;
                const statusClass = String(row.estado || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const actions = canAnnul
                    ? `<button type="button" class="btn-secondary photo-button" onclick="window.anularMovimiento('${window.escapeHtml(row.idTransaccion)}')">Anular</button>`
                    : window.escapeHtml(row.relacionada || 'Sin acciones');
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
            const confirmation = 'El movimiento quedará marcado como anulado, no afectará el saldo y se conservará en el historial. No se creará una transacción inversa.';
            if (!(await window.confirmarAccion(confirmation, { titulo: 'Anular movimiento', danger: true, confirmLabel: 'Anular' }))) return;
            apiRequest({ action: 'anular_movimiento', idTransaccion })
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
