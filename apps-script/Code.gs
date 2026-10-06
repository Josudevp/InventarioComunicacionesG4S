/**
 * API segura para Inventario Comunicaciones G4S.
 *
 * Configuración:
 * 1. Cree las hojas Usuarios, Catalogo y Movimientos.
 * 2. En Usuarios use: usuario | passwordHash | rol | activo.
 * 3. En Catalogo use: idArticulo | categoria | descripcion | stockActual | stockMinimo.
 * 4. En Propiedades del proyecto configure SPREADSHEET_ID.
 * 5. Genere passwordHash con sha256Hex("SuContraseñaInicial").
 *
 * Nunca publique contraseñas en texto plano ni confíe en usuario/rol enviados por el cliente.
 */
const CONFIG = {
  spreadsheetIdProperty: 'SPREADSHEET_ID',
  sessionTtlSeconds: 21600,
  usersSheet: 'Usuarios',
  catalogSheet: 'Catalogo',
  movementsSheet: 'Movimientos'
};

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = String(payload.action || '');
    if (action === 'login') return login_(payload);
    if (action === 'cambiar_clave') return changePassword_(payload, requireSession_(e, payload));

    const session = requireSession_(e, payload);
    if (action === 'obtener_catalogo') return catalog_(session);
    if (action === 'registrar_movimiento') return registerMovement_(payload, session);
    if (action === 'crear_accesorio') return createAccessory_(payload, session);
    return response_({ status: 'error', message: 'Acción no permitida' });
  } catch (error) {
    console.error(error);
    return response_({ status: 'error', message: error.message || 'Error interno' });
  }
}

function login_(payload) {
  const username = clean_(payload.usuario, 100);
  const password = String(payload.clave || '');
  if (!username || !password) throw new Error('Credenciales incompletas');

  const rows = sheet_(CONFIG.usersSheet).getDataRange().getValues();
  const user = rows.slice(1).find(row => String(row[0]).toLowerCase() === username.toLowerCase() && String(row[3]).toLowerCase() !== 'false');
  if (!user || sha256Hex_(password) !== String(user[1])) throw new Error('Credenciales inválidas');

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify({ usuario: String(user[0]), rol: String(user[2] || 'usuario') }), CONFIG.sessionTtlSeconds);
  return response_({ status: 'success', usuario: String(user[0]), token: token });
}

function requireSession_(event, payload) {
  const headers = event && event.headers ? event.headers : {};
  const authorization = String(headers.Authorization || headers.authorization || (payload && payload.token ? 'Bearer ' + payload.token : ''));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Sesión requerida');
  const session = CacheService.getScriptCache().get(sessionKey_(match[1].trim()));
  if (!session) throw new Error('Sesión expirada');
  return JSON.parse(session);
}

function catalog_(session) {
  const values = sheet_(CONFIG.catalogSheet).getDataRange().getValues();
  const data = values.slice(1).filter(row => row[0]).map(row => ({
    idArticulo: String(row[0]),
    categoria: String(row[1] || ''),
    descripcion: String(row[2] || ''),
    stockActual: Number(row[3]) || 0,
    stockMinimo: Number(row[4]) || 0
  }));
  return response_({ status: 'success', usuario: session.usuario, data: data });
}

function registerMovement_(payload, session) {
  const type = String(payload.tipoMovimiento || '');
  if (type !== 'Entrada' && type !== 'Salida') throw new Error('Tipo de movimiento inválido');
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('El movimiento no tiene artículos');
  const catalog = sheet_(CONFIG.catalogSheet);
  const values = catalog.getDataRange().getValues();
  const index = {};
  values.slice(1).forEach((row, i) => { index[String(row[0])] = i + 2; });
  const normalized = items.map(item => {
    const id = clean_(item.idArticulo, 100);
    const quantity = Number(item.cantidad);
    if (!index[id] || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Artículo o cantidad inválida');
    return { id: id, quantity: quantity, row: index[id] };
  });
  normalized.forEach(item => {
    const cell = catalog.getRange(item.row, 4);
    const current = Number(cell.getValue()) || 0;
    const next = type === 'Entrada' ? current + item.quantity : current - item.quantity;
    if (next < 0) throw new Error('Stock insuficiente para ' + item.id);
    cell.setValue(next);
  });
  sheet_(CONFIG.movementsSheet).appendRow([new Date(), session.usuario, type, clean_(payload.cliente, 150), clean_(payload.regional, 80), clean_(payload.tecnico, 100), clean_(payload.usuario, 150), JSON.stringify(normalized)]);
  return response_({ status: 'success' });
}

function createAccessory_(payload, session) {
  if (!['admin', 'administrador'].includes(session.rol.toLowerCase())) throw new Error('Permisos insuficientes');
  const id = clean_(payload.idArticulo, 100);
  const description = clean_(payload.descripcion, 200);
  const minimum = Number(payload.stockMinimo);
  if (!id || !description || !Number.isInteger(minimum) || minimum < 1) throw new Error('Datos de accesorio inválidos');
  const catalog = sheet_(CONFIG.catalogSheet);
  const ids = catalog.getRange(2, 1, Math.max(catalog.getLastRow() - 1, 1), 1).getValues().flat().map(String);
  if (ids.includes(id)) throw new Error('El SKU ya existe');
  catalog.appendRow([id, clean_(payload.categoria, 80), description, 0, minimum]);
  return response_({ status: 'success' });
}

function changePassword_(payload, session) {
  const oldPassword = String(payload.claveAntigua || '');
  const newPassword = String(payload.claveNueva || '');
  if (String(payload.usuario || '').toLowerCase() !== session.usuario.toLowerCase()) throw new Error('Usuario inválido');
  if (newPassword.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
  const users = sheet_(CONFIG.usersSheet);
  const values = users.getDataRange().getValues();
  const rowIndex = values.slice(1).findIndex(row => String(row[0]).toLowerCase() === session.usuario.toLowerCase());
  if (rowIndex < 0 || sha256Hex_(oldPassword) !== String(values[rowIndex + 1][1])) throw new Error('Contraseña actual inválida');
  users.getRange(rowIndex + 2, 2).setValue(sha256Hex_(newPassword));
  return response_({ status: 'success' });
}

function sheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty(CONFIG.spreadsheetIdProperty);
  if (!id) throw new Error('Falta configurar SPREADSHEET_ID');
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja ' + name);
  return sheet;
}

function parsePayload_(event) {
  return JSON.parse(String(event && event.postData && event.postData.contents || '{}'));
}

function response_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function sessionKey_(token) {
  return 'session_' + sha256Hex_(token);
}

function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(byte => ('0' + (byte < 0 ? byte + 256 : byte).toString(16)).slice(-2)).join('');
}
