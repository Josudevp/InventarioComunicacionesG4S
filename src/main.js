import Choices from "choices.js";
import "@fortawesome/fontawesome-free/css/fontawesome.css";
import "@fortawesome/fontawesome-free/css/solid.css";
import "choices.js/public/assets/styles/choices.min.css";
import "./tailwind.css";
import { apiRequest } from "./services/api.js";

        // =========================================================================
        // URL FIJA DE APPS SCRIPT
        // =========================================================================
        // Reemplaza este valor por la ruta local o URL HTTPS de tu imagen de logo.
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
                window.mostrarApp(loggedUser);
            } else {
                sessionStorage.removeItem("g4sLoggedUser");
                sessionStorage.removeItem("g4sSessionToken");
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
            let payload = { action: "registrar_movimiento", tipoMovimiento: tipoMov, cliente, proveedor: provider, motivo: reason, items: carrito, distribution: tipoMov === 'Salida' ? distribution : null };
            let btn = document.getElementById('btn-submit');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            btn.disabled = true;

            apiRequest(payload)
            .then(res => res.json()).then(res => {
                if(res.status === "success") {
                    window.mostrarAlerta("🎉 Movimiento guardado con éxito", "success");
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
                const clients = [...new Set(request.items.map(item => String(item.cliente || '').trim()).filter(Boolean))];
                const regions = [...new Set(request.items.map(item => String(item.regional || '').trim()).filter(Boolean))];
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
                    document.getElementById('kpi-compras-promedio').textContent = Number(data.comprasPromedioMensual || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
                    const purchaseValue = data.valorComprasMes;
                    document.getElementById('kpi-compras-valor').textContent = purchaseValue == null
                        ? 'Sin datos'
                        : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(purchaseValue);
                    const costCoverage = Number(data.lineasCompraConCostoMes || 0);
                    const purchaseLines = Number(data.lineasCompraMes || 0);
                    document.getElementById('kpi-compras-cobertura').textContent = costCoverage
                        ? `${costCoverage} de ${purchaseLines} líneas con costo`
                        : 'Captura costos al solicitar al proveedor';
                    const states = data.solicitudesPorEstado || {};
                    const total = Object.values(states).reduce((sum, value) => sum + Number(value || 0), 0);
                    const labels = [['Registrada', 'Registradas'], ['Solicitada', 'Solicitadas'], ['Recibida', 'Recibidas'], ['Entregada', 'Entregadas'], ['Anulada', 'Anuladas']];
                    document.getElementById('dashboard-request-states').innerHTML = labels.map(([key, label]) => {
                        const count = Number(states[key] || 0);
                        const width = total ? count / total * 100 : 0;
                        return `<div class="request-state-row"><div><span>${label}</span><strong>${count}</strong></div><div class="request-state-track"><span class="state-${key.toLowerCase()}" style="width:${width}%"></span></div></div>`;
                    }).join('');
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

        window.cargarHistorial = function() {
            const body = document.getElementById('history-table-body');
            body.innerHTML = '<tr><td colspan="9">Cargando movimientos...</td></tr>';
            const payload = {
                action: 'obtener_movimientos',
                desde: document.getElementById('history-from').value,
                hasta: document.getElementById('history-to').value,
                filtro: document.getElementById('history-filter').value.trim()
            };
            apiRequest(payload)
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo cargar el historial');
                    const rows = Array.isArray(result.data) ? result.data : [];
                    if (!rows.length) {
                        body.innerHTML = '<tr><td colspan="9">No hay movimientos para los filtros seleccionados.</td></tr>';
                        return;
                    }
                    body.innerHTML = rows.map(row => {
                        const date = row.fechaHora ? new Date(row.fechaHora).toLocaleString('es-CO') : '';
                        const canReverse = row.estado === 'Confirmado';
                        const statusClass = String(row.estado || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                        const actions = canReverse
                            ? `<button type="button" class="btn-secondary photo-button" onclick="window.reversarMovimiento('${window.escapeHtml(row.idTransaccion)}')">Reversar</button><button type="button" class="btn-secondary photo-button" onclick="window.anularMovimiento('${window.escapeHtml(row.idTransaccion)}')">Anular</button>`
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
                }).catch(error => { body.innerHTML = `<tr><td colspan="9">${window.escapeHtml(error.message)}</td></tr>`; });
        };

        window.reversarMovimiento = function(idTransaccion) {
            window.procesarCorreccionMovimiento(idTransaccion, 'reversar_movimiento', 'Se creará una transacción inversa y el original quedará como reversado. ¿Continuar?');
        };

        window.anularMovimiento = function(idTransaccion) {
            window.procesarCorreccionMovimiento(idTransaccion, 'anular_movimiento', 'Se creará una transacción inversa y el original quedará como anulado. ¿Continuar?');
        };

        window.procesarCorreccionMovimiento = async function(idTransaccion, action, confirmation) {
            if (!(await window.confirmarAccion(confirmation, { titulo: action === 'anular_movimiento' ? 'Anular movimiento' : 'Reversar movimiento', danger: true, confirmLabel: action === 'anular_movimiento' ? 'Anular' : 'Reversar' }))) return;
            apiRequest({ action, idTransaccion })
                .then(response => response.json()).then(result => {
                    if (result.status !== 'success') throw new Error(result.message || 'No se pudo reversar');
                    window.mostrarAlerta('Movimiento reversado correctamente', 'success');
                    window.cargarHistorial();
                    window.cargarCatalogo();
                    window.cargarDashboard();
                }).catch(error => window.mostrarAlerta(error.message, 'error'));
        };

        document.getElementById('btn-history-search').addEventListener('click', window.cargarHistorial);

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
