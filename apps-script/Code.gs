// API de Inventario Comunicaciones G4S.
// Hojas del archivo principal:
//   Maestro de inventario: A=ID, B=Categoria, C=Descripcion, D=Stock inicial,
//   E=Entradas, F=Salidas, G=Stock_Actual, H=Stock_Minimo_Alerta, I=Foto_URL.
//   Registro de Movimientos: A=ID_Transaccion, B=Fecha_Hora, C=ID_Articulo,
//   D=Tipo_Movimiento, E=Cantidad, F=Registrado_Por, G=Entregado_A_Usuario,
//   H=Cliente_Proveedor, I=Regional, J=Estado, K=ID_Transaccion_Relacionada,
//   L=Motivo, M=Regional_Origen, N=Regional_Destino.
//
// Propiedades recomendadas:
//   SPREADSHEET_ID: ID del archivo principal (opcional si el script esta vinculado al Sheet).
//   PHOTOS_FOLDER_ID: carpeta de Drive para fotografias.
//   ADMIN_USERS: usuarios separados por coma autorizados a crear accesorios.

var ID_BOVEDA_USUARIOS = "1CSj9D793DGZkxtGadmeTYIOu05ClPhhcOYnxZLzpnWw";
var CONFIG = {
  mainSheetIdProperty: "SPREADSHEET_ID",
  photosFolderProperty: "PHOTOS_FOLDER_ID",
  adminsProperty: "ADMIN_USERS",
  usersSheetIndex: 0,
  inventorySheet: "Maestro de inventario",
  movementsSheet: "Registro de Movimientos",
  movementHeaders: ["ID_Transaccion", "Fecha_Hora", "ID_Articulo", "Tipo_Movimiento", "Cantidad", "Registrado_Por", "Entregado_A_Usuario", "Cliente_Proveedor", "Regional", "Estado", "ID_Transaccion_Relacionada", "Motivo", "Regional_Origen", "Regional_Destino"],
  movementTypes: ["Entrada", "Salida", "Devolucion", "Ajuste positivo", "Ajuste negativo", "Baja por daño"],
  inventoryActiveColumn: 10,
  sessionTtlSeconds: 21600,
  passwordIterations: 10000,
  maxLoginAttempts: 5,
  lockoutSeconds: 900,
  userFailedAttemptsColumn: 5,
  userLockedUntilColumn: 6,
  userLastLoginColumn: 7
};

// Ejecuta esta funcion una vez desde el editor de Apps Script con la cuenta
// configurada en "Ejecutar como" para conceder y comprobar acceso a Drive.
function autorizarDrive() {
  var folderId = PropertiesService.getScriptProperties().getProperty(CONFIG.photosFolderProperty);
  if (!folderId) throw new Error("Falta configurar PHOTOS_FOLDER_ID");
  var folder = DriveApp.getFolderById(folderId.trim());
  Logger.log("Carpeta autorizada: " + folder.getName() + " (" + folder.getId() + ")");
}

function doGet() {
  return json_({ status: "success", message: "API Enterprise activa" });
}

function doPost(e) {
  try {
    var data = parse_(e);
    var action = String(data.action || "registrar_movimiento");
    if (action === "login") return login_(data);

    var session = requireSession_(data);
    if (action === "cambiar_clave") return changePassword_(data, session);
    if (action === "obtener_catalogo") return getCatalog_(session);
    if (action === "obtener_movimientos") return getMovements_(data, session);
    if (action === "registrar_movimiento") return registerMovement_(data, session);
    if (action === "reversar_movimiento") return reverseMovement_(data, session, "Reversado");
    if (action === "anular_movimiento") return reverseMovement_(data, session, "Anulado");
    if (action === "crear_accesorio") return createAccessory_(data, session);
    if (action === "actualizar_accesorio") return updateAccessory_(data, session);
    if (action === "subir_fotografia") return uploadPhoto_(data, session);
    return json_({ status: "error", message: "Accion no permitida" });
  } catch (error) {
    console.error(error);
    return json_({ status: "error", message: error.message || String(error) });
  }
}

function login_(data) {
  var userName = clean_(data.usuario, 100);
  var password = String(data.clave || "");
  if (!userName || !password) throw new Error("Credenciales incompletas");

  var users = SpreadsheetApp.openById(ID_BOVEDA_USUARIOS).getSheets()[CONFIG.usersSheetIndex];
  ensureUserSecurityColumns_(users);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rows = users.getDataRange().getValues();
    var matched = null;
    var matchedRow = 0;
    for (var i = 1; i < rows.length; i++) {
      var active = rows[i].length < 4 || String(rows[i][3]).toLowerCase() !== "false";
      if (active && String(rows[i][0]).trim().toLowerCase() === userName.toLowerCase()) {
        matched = rows[i];
        matchedRow = i + 1;
        break;
      }
    }
    if (!matched) throw new Error("Credenciales invalidas");

    var lockedUntil = matched[CONFIG.userLockedUntilColumn - 1];
    if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
      throw new Error("Cuenta bloqueada temporalmente. Intenta nuevamente mas tarde");
    }

    if (!verifyPassword_(password, String(matched[1] || ""))) {
      recordFailedLogin_(users, matchedRow, matched);
      throw new Error("Credenciales invalidas");
    }

    var storedPassword = String(matched[1] || "");
    var updates = [[0, "", new Date()]];
    users.getRange(matchedRow, CONFIG.userFailedAttemptsColumn, 1, 3).setValues(updates);
    if (!isPasswordHash_(storedPassword)) {
      users.getRange(matchedRow, 2).setValue(hashPassword_(password));
    }

    var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
    var session = { usuario: String(matched[0]).trim(), rol: String(matched[2] || "usuario").trim() };
    CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), CONFIG.sessionTtlSeconds);
    return json_({ status: "success", usuario: session.usuario, token: token });
  } finally {
    lock.releaseLock();
  }
}

function requireSession_(data) {
  var token = clean_(data.token, 200);
  if (!token) throw new Error("Sesion requerida");
  var raw = CacheService.getScriptCache().get(sessionKey_(token));
  if (!raw) throw new Error("Sesion expirada");
  return JSON.parse(raw);
}

function changePassword_(data, session) {
  if (clean_(data.usuario, 100).toLowerCase() !== session.usuario.toLowerCase()) {
    throw new Error("Usuario invalido");
  }
  var oldPassword = String(data.claveAntigua || "");
  var newPassword = String(data.claveNueva || "");
  if (newPassword.length < 8) throw new Error("La nueva clave debe tener al menos 8 caracteres");

  var users = SpreadsheetApp.openById(ID_BOVEDA_USUARIOS).getSheets()[CONFIG.usersSheetIndex];
  ensureUserSecurityColumns_(users);
  var rows = users.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === session.usuario.toLowerCase() &&
        verifyPassword_(oldPassword, String(rows[i][1] || ""))) {
      users.getRange(i + 1, 2).setValue(hashPassword_(newPassword));
      users.getRange(i + 1, CONFIG.userFailedAttemptsColumn, 1, 2).setValues([[0, ""]]);
      return json_({ status: "success" });
    }
  }
  throw new Error("Usuario o contraseña actual incorrectos");
}

function getCatalog_(session) {
  var sheet = inventorySheet_();
  var rows = sheet.getDataRange().getValues();
  refreshInventoryFormulas_(sheet, rows.length);
  rows = sheet.getDataRange().getValues();
  var catalog = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    catalog.push({
      idArticulo: clean_(rows[i][0], 100),
      categoria: clean_(rows[i][1], 100),
      descripcion: clean_(rows[i][2], 200),
      stockActual: number_(rows[i][6]),
      stockMinimo: number_(rows[i][7]),
      fotoUrl: clean_(rows[i][8], 500),
      activo: rows[i].length < CONFIG.inventoryActiveColumn || String(rows[i][CONFIG.inventoryActiveColumn - 1]).toLowerCase() !== "false"
    });
  }
  return json_({ status: "success", usuario: session.usuario, data: catalog });
}

function getMovements_(data, session) {
  var sheet = movementSheet_();
  ensureMovementHeaders_(sheet);
  var rows = sheet.getDataRange().getValues();
  var from = clean_(data.desde, 30);
  var to = clean_(data.hasta, 30);
  var filter = clean_(data.filtro, 200).toLowerCase();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    var date = rows[i][1] instanceof Date ? rows[i][1] : new Date(rows[i][1]);
    var dateKey = isNaN(date.getTime()) ? "" : Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var text = rows[i].slice(0, 14).join(" ").toLowerCase();
    if (from && dateKey < from) continue;
    if (to && dateKey > to) continue;
    if (filter && text.indexOf(filter) < 0) continue;
    result.push({
      idTransaccion: clean_(rows[i][0], 100), fechaHora: date,
      idArticulo: clean_(rows[i][2], 100), tipoMovimiento: clean_(rows[i][3], 100),
      cantidad: number_(rows[i][4]), registradoPor: clean_(rows[i][5], 100),
      entregadoA: clean_(rows[i][6], 150), clienteProveedor: clean_(rows[i][7], 150),
      regional: clean_(rows[i][8], 100), estado: clean_(rows[i][9], 50) || "Confirmado",
      relacionada: clean_(rows[i][10], 100), motivo: clean_(rows[i][11], 200),
      regionalOrigen: clean_(rows[i][12], 100), regionalDestino: clean_(rows[i][13], 100)
    });
  }
  return json_({ status: "success", usuario: session.usuario, data: result.slice(-500).reverse() });
}

function registerMovement_(data, session) {
  var type = String(data.tipoMovimiento || "Salida");
  if (CONFIG.movementTypes.indexOf(type) < 0) throw new Error("Tipo de movimiento invalido");
  var items = normalizeItems_(data.items);
  if (!items.length) throw new Error("El movimiento no tiene articulos");
  var distribution = Array.isArray(data.distribution) ? data.distribution : [];
  if (type === "Salida" && !distribution.length) {
    throw new Error("Las salidas deben registrarse por cliente");
  }
  if (type !== "Salida" && distribution.length) {
    throw new Error("Las entradas no usan distribucion por cliente");
  }
  var provider = clean_(data.proveedor, 150);
  if (["Entrada", "Devolucion"].indexOf(type) >= 0 && !provider) throw new Error("El proveedor es obligatorio");
  if (["Ajuste positivo", "Ajuste negativo", "Baja por daño"].indexOf(type) >= 0 && !clean_(data.motivo, 200)) throw new Error("El motivo es obligatorio");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var inventory = inventorySheet_();
    var rows = inventory.getDataRange().getValues();
    var index = {};
    for (var i = 1; i < rows.length; i++) index[clean_(rows[i][0], 100)] = i + 1;
    var requested = {};
    items.forEach(function(item) {
      if (!index[item.idArticulo]) throw new Error("Articulo no existe: " + item.idArticulo);
      requested[item.idArticulo] = (requested[item.idArticulo] || 0) + item.cantidad;
    });
    Object.keys(requested).forEach(function(id) {
      var row = index[id];
      var current = number_(inventory.getRange(row, 7).getValue());
      var effect = movementEffect_(type);
      var next = current + effect * requested[id];
      if (next < 0) throw new Error("Stock insuficiente para '" + id + "'. Disponible: " + current);
    });

    var transactionId = Utilities.getUuid();
    var now = new Date();
    var movementRows = [];
    if (distribution.length) {
      validateDistribution_(distribution, requested, type);
      distribution.forEach(function(row) {
        movementRows.push([transactionId, now, row.idArticulo, type, row.cantidad,
          session.usuario, clean_(row.usuario, 150), clean_(row.cliente, 150), clean_(row.regional || data.regional, 100), "Confirmado", "", clean_(data.motivo, 200), "", ""]);
      });
    } else {
      items.forEach(function(item) {
        movementRows.push([transactionId, now, item.idArticulo, type, item.cantidad,
          session.usuario, "", provider, clean_(data.regional || "Bogota", 100), "Confirmado", "", clean_(data.motivo, 200), clean_(data.regionalOrigen, 100), clean_(data.regionalDestino, 100)]);
      });
    }
    var movements = movementSheet_();
    ensureMovementHeaders_(movements);
    movements.getRange(movements.getLastRow() + 1, 1, movementRows.length, movementRows[0].length).setValues(movementRows);
    refreshInventoryFormulas_(inventory, rows.length);
    return json_({ status: "success", idTransaccion: transactionId, count: movementRows.length });
  } finally {
    lock.releaseLock();
  }
}

function reverseMovement_(data, session, finalStatus) {
  var originalId = clean_(data.idTransaccion, 100);
  if (!originalId) throw new Error("Falta la transaccion original");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var movements = movementSheet_();
    var rows = movements.getDataRange().getValues();
    var originals = [];
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === originalId) originals.push({ row: i + 1, values: rows[i] });
    }
    if (!originals.length) throw new Error("Transaccion original no encontrada");
    if (originals.some(function(item) { return String(item.values[9] || "Confirmado") !== "Confirmado"; })) {
      throw new Error("La transaccion ya fue anulada o reversada");
    }
    var inverseItems = originals.map(function(item) {
      return { idArticulo: clean_(item.values[2], 100), cantidad: number_(item.values[4]), type: inverseMovementType_(String(item.values[3])) };
    });
    var inventory = inventorySheet_();
    var inventoryRows = inventory.getDataRange().getValues();
    var index = {};
    for (var j = 1; j < inventoryRows.length; j++) index[clean_(inventoryRows[j][0], 100)] = j + 1;
    var requested = {};
    inverseItems.forEach(function(item) {
      requested[item.idArticulo] = (requested[item.idArticulo] || 0) + movementEffect_(item.type) * item.cantidad;
    });
    Object.keys(requested).forEach(function(id) {
      if (!index[id]) throw new Error("Articulo no existe: " + id);
      var current = number_(inventory.getRange(index[id], 7).getValue());
      if (current + requested[id] < 0) throw new Error("Stock insuficiente para reversar '" + id + "'");
    });
    var reverseId = Utilities.getUuid();
    var now = new Date();
    var reverseRows = originals.map(function(item) {
      var values = item.values;
      return [reverseId, now, values[2], inverseMovementType_(String(values[3])), values[4], session.usuario,
        values[6], values[7], values[8], "Confirmado", originalId, finalStatus === "Anulado" ? "Anulacion de " + originalId : "Reversion de " + originalId, values[12], values[13]];
    });
    ensureMovementHeaders_(movements);
    movements.getRange(movements.getLastRow() + 1, 1, reverseRows.length, reverseRows[0].length).setValues(reverseRows);
    originals.forEach(function(item) {
      movements.getRange(item.row, 10, 1, 2).setValues([[finalStatus, reverseId]]);
    });
    refreshInventoryFormulas_(inventory, inventoryRows.length);
    return json_({ status: "success", idTransaccion: reverseId, idTransaccionOriginal: originalId });
  } finally {
    lock.releaseLock();
  }
}

function inverseMovementType_(type) {
  var inverses = {
    "Entrada": "Salida",
    "Salida": "Entrada",
    "Devolucion": "Entrada",
    "Ajuste positivo": "Ajuste negativo",
    "Ajuste negativo": "Ajuste positivo",
    "Baja por daño": "Ajuste positivo"
  };
  return inverses[type] || type;
}

function createAccessory_(data, session) {
  if (!isAdmin_(session)) throw new Error("Permisos insuficientes");
  var id = clean_(data.idArticulo, 100);
  var description = clean_(data.descripcion, 200);
  var minimum = number_(data.stockMinimo);
  if (!id || !description || minimum < 1) throw new Error("Datos de accesorio invalidos");
  var sheet = inventorySheet_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (clean_(rows[i][0], 100).toUpperCase() === id.toUpperCase()) throw new Error("El codigo ya existe");
  }
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, CONFIG.inventoryActiveColumn).setValues([[id, clean_(data.categoria, 100), description, 0, 0, 0, 0, minimum, "", true]]);
  refreshInventoryFormulas_(sheet, row);
  sheet.getRange(row, 9).setValue("");
  return json_({ status: "success", message: "Accesorio añadido" });
}

function updateAccessory_(data, session) {
  if (!isAdmin_(session)) throw new Error("Permisos insuficientes");
  var id = clean_(data.idArticulo, 100);
  var sheet = inventorySheet_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (clean_(rows[i][0], 100).toUpperCase() !== id.toUpperCase()) continue;
    if (data.descripcion != null) sheet.getRange(i + 1, 3).setValue(clean_(data.descripcion, 200));
    if (data.stockMinimo != null && Number(data.stockMinimo) >= 0) sheet.getRange(i + 1, 8).setValue(Number(data.stockMinimo));
    if (data.activo != null) sheet.getRange(i + 1, CONFIG.inventoryActiveColumn).setValue(Boolean(data.activo));
    return json_({ status: "success", message: "Accesorio actualizado" });
  }
  throw new Error("Articulo no existe");
}

function movementEffect_(type) {
  if (["Entrada", "Ajuste positivo"].indexOf(type) >= 0) return 1;
  if (["Salida", "Devolucion", "Ajuste negativo", "Baja por daño"].indexOf(type) >= 0) return -1;
  return 0;
}

function ensureMovementHeaders_(sheet) {
  var current = sheet.getRange(1, 1, 1, CONFIG.movementHeaders.length).getValues()[0];
  var changed = false;
  CONFIG.movementHeaders.forEach(function(header, index) {
    if (String(current[index] || "").trim() !== header) {
      current[index] = header;
      changed = true;
    }
  });
  if (changed) sheet.getRange(1, 1, 1, CONFIG.movementHeaders.length).setValues([current]);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.movementTypes, true).setAllowInvalid(false).build();
  sheet.getRange(2, 4, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

function refreshInventoryFormulas_(sheet, lastRow) {
  var formulas = [];
  for (var row = 2; row <= lastRow; row++) {
    formulas.push([
      '=SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Entrada")+SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Ajuste positivo")',
      '=SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Salida")+SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Devolucion")+SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Ajuste negativo")+SUMIFS(\'Registro de Movimientos\'!E:E;\'Registro de Movimientos\'!C:C;A' + row + ';\'Registro de Movimientos\'!D:D;"Baja por daño")',
      '=D' + row + '+E' + row + '-F' + row
    ]);
  }
  if (formulas.length) sheet.getRange(2, 5, formulas.length, 3).setFormulas(formulas);
}

function uploadPhoto_(data, session) {
  var id = clean_(data.idArticulo, 100);
  var mime = String(data.mimeType || "");
  var content = String(data.content || "");
  if (!id || !/^image\/(jpeg|png|webp)$/.test(mime) || !content) throw new Error("Fotografia invalida");
  if (content.length > 7000000) throw new Error("La fotografia supera el limite permitido");
  var folderId = PropertiesService.getScriptProperties().getProperty(CONFIG.photosFolderProperty);
  if (!folderId) throw new Error("Falta configurar PHOTOS_FOLDER_ID en Propiedades del script");
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId.trim());
  } catch (error) {
    throw new Error("PHOTOS_FOLDER_ID no existe o la cuenta que ejecuta Apps Script no tiene acceso a esa carpeta");
  }
  var extension = mime.split("/")[1].replace("jpeg", "jpg");
  var blob = Utilities.newBlob(Utilities.base64Decode(content), mime, id + "_" + new Date().getTime() + "." + extension);
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingError) {
    console.warn("No se pudo habilitar enlace público; se conserva el permiso privado del archivo");
  }
  var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
  var sheet = inventorySheet_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (clean_(rows[i][0], 100) === id) {
      sheet.getRange(i + 1, 9).setValue(url);
      return json_({ status: "success", fotoUrl: url });
    }
  }
  throw new Error("Articulo no existe");
}

function validateDistribution_(distribution, requested, type) {
  var totals = {};
  distribution.forEach(function(row) {
    var id = clean_(row.idArticulo, 100);
    var client = clean_(row.cliente, 150);
    var user = clean_(row.usuario, 150);
    var regional = clean_(row.regional, 100);
    var quantity = Number(row.cantidad);
    if (!id || !client || (type === "Salida" && !user) || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Distribucion invalida");
    }
    if (type === "Salida" && !regional) throw new Error("Regional invalida");
    totals[id] = (totals[id] || 0) + quantity;
  });
  Object.keys(requested).forEach(function(id) {
    if (totals[id] !== requested[id]) throw new Error("La distribucion no coincide con el total de " + id);
  });
  Object.keys(totals).forEach(function(id) {
    if (!requested[id]) throw new Error("Articulo no incluido en el lote: " + id);
  });
}

function normalizeItems_(items) {
  if (!Array.isArray(items)) return [];
  return items.map(function(item) {
    var id = clean_(item.idArticulo, 100);
    var quantity = Number(item.cantidad);
    if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error("Articulo o cantidad invalida");
    return { idArticulo: id, cantidad: quantity };
  });
}

function isAdmin_(session) {
  var configured = PropertiesService.getScriptProperties().getProperty(CONFIG.adminsProperty) || "";
  var admins = configured.split(",").map(function(value) { return value.trim().toLowerCase(); });
  return String(session.rol || "").toLowerCase() === "admin" || admins.indexOf(session.usuario.toLowerCase()) >= 0;
}

function inventorySheet_() {
  return mainSpreadsheet_().getSheetByName(CONFIG.inventorySheet);
}

function movementSheet_() {
  return mainSpreadsheet_().getSheetByName(CONFIG.movementsSheet);
}

function mainSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.mainSheetIdProperty);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function parse_(event) {
  return JSON.parse(String(event && event.postData && event.postData.contents || "{}"));
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function number_(value) {
  var number = Number(value);
  return isFinite(number) ? number : 0;
}

function sessionKey_(token) {
  return "g4s_session_" + sha256_(token);
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(byte) { return ("0" + (byte < 0 ? byte + 256 : byte).toString(16)).slice(-2); })
    .join("");
}

function isPasswordHash_(value) {
  return String(value || "").indexOf("v1$") === 0 && String(value).split("$").length === 3;
}

function hashPassword_(password) {
  var salt = Utilities.getUuid().replace(/-/g, "");
  return "v1$" + salt + "$" + passwordDigest_(password, salt);
}

function passwordDigest_(password, salt) {
  var digest = sha256_(salt + "|" + password);
  for (var i = 1; i < CONFIG.passwordIterations; i++) {
    digest = sha256_(salt + "|" + digest + "|" + password);
  }
  return digest;
}

function verifyPassword_(password, stored) {
  if (isPasswordHash_(stored)) {
    var parts = stored.split("$");
    return passwordDigest_(password, parts[1]) === parts[2];
  }
  return stored !== "" && stored === password;
}

function recordFailedLogin_(users, rowNumber, row) {
  var attempts = Number(row[CONFIG.userFailedAttemptsColumn - 1]) || 0;
  attempts += 1;
  var lockUntil = "";
  if (attempts >= CONFIG.maxLoginAttempts) {
    lockUntil = new Date(Date.now() + CONFIG.lockoutSeconds * 1000);
    attempts = 0;
  }
  users.getRange(rowNumber, CONFIG.userFailedAttemptsColumn, 1, 2).setValues([[attempts, lockUntil]]);
}

function ensureUserSecurityColumns_(users) {
  var headers = users.getRange(1, CONFIG.userFailedAttemptsColumn, 1, 3).getValues()[0];
  var expected = ["Intentos_Fallidos", "Bloqueado_Hasta", "Ultimo_Acceso"];
  var changed = false;
  for (var i = 0; i < expected.length; i++) {
    if (String(headers[i] || "").trim() !== expected[i]) {
      headers[i] = expected[i];
      changed = true;
    }
  }
  if (changed) users.getRange(1, CONFIG.userFailedAttemptsColumn, 1, 3).setValues([headers]);
}
