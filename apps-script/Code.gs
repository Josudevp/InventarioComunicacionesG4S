// API de Inventario Comunicaciones G4S.
// Hojas del archivo principal:
//   Maestro de inventario: A=ID, B=Categoria, C=Descripcion, D=Stock inicial,
//   E=Entradas, F=Salidas, G=Stock_Actual, H=Stock_Minimo_Alerta, I=Foto_URL.
//   Registro de Movimientos: A=ID_Transaccion, B=Fecha_Hora, C=ID_Articulo,
//   D=Tipo_Movimiento, E=Cantidad, F=Registrado_Por, G=Entregado_A_Usuario,
//   H=Cliente, I=Regional.
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
  sessionTtlSeconds: 21600
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
    if (action === "registrar_movimiento") return registerMovement_(data, session);
    if (action === "crear_accesorio") return createAccessory_(data, session);
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
  var rows = users.getDataRange().getValues();
  var matched = null;
  for (var i = 1; i < rows.length; i++) {
    var active = rows[i].length < 4 || String(rows[i][3]).toLowerCase() !== "false";
    if (active && String(rows[i][0]).trim().toLowerCase() === userName.toLowerCase() &&
        String(rows[i][1]).trim() === password) {
      matched = rows[i];
      break;
    }
  }
  if (!matched) throw new Error("Credenciales invalidas");

  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
  var session = { usuario: String(matched[0]).trim(), rol: String(matched[2] || "usuario").trim() };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), CONFIG.sessionTtlSeconds);
  return json_({ status: "success", usuario: session.usuario, token: token });
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
  var rows = users.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === session.usuario.toLowerCase() &&
        String(rows[i][1]).trim() === oldPassword) {
      users.getRange(i + 1, 2).setValue(newPassword);
      return json_({ status: "success" });
    }
  }
  throw new Error("Usuario o contraseña actual incorrectos");
}

function getCatalog_(session) {
  var sheet = inventorySheet_();
  var rows = sheet.getDataRange().getValues();
  var catalog = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    catalog.push({
      idArticulo: clean_(rows[i][0], 100),
      categoria: clean_(rows[i][1], 100),
      descripcion: clean_(rows[i][2], 200),
      stockActual: number_(rows[i][6]),
      stockMinimo: number_(rows[i][7]),
      fotoUrl: clean_(rows[i][8], 500)
    });
  }
  return json_({ status: "success", usuario: session.usuario, data: catalog });
}

function registerMovement_(data, session) {
  var type = String(data.tipoMovimiento || "Salida");
  if (type !== "Entrada" && type !== "Salida") throw new Error("Tipo de movimiento invalido");
  var items = normalizeItems_(data.items);
  if (!items.length) throw new Error("El movimiento no tiene articulos");
  var distribution = Array.isArray(data.distribution) ? data.distribution : [];
  if (type === "Salida" && !distribution.length) {
    throw new Error("Las salidas deben registrarse por cliente");
  }
  if (type === "Entrada" && distribution.length) {
    throw new Error("Las entradas no usan distribucion por cliente");
  }
  var provider = clean_(data.proveedor, 150);
  if (type === "Entrada" && !provider) throw new Error("El proveedor es obligatorio");
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
      var next = type === "Entrada" ? current + requested[id] : current - requested[id];
      if (next < 0) throw new Error("Stock insuficiente para '" + id + "'. Disponible: " + current);
    });

    var transactionId = Utilities.getUuid();
    var now = new Date();
    var movementRows = [];
    if (distribution.length) {
      validateDistribution_(distribution, requested, type);
      distribution.forEach(function(row) {
        movementRows.push([transactionId, now, row.idArticulo, type, row.cantidad,
          session.usuario, clean_(row.usuario, 150), clean_(row.cliente, 150), clean_(row.regional || data.regional, 100)]);
      });
    } else {
      items.forEach(function(item) {
        movementRows.push([transactionId, now, item.idArticulo, type, item.cantidad,
          session.usuario, "", provider, "Bogota"]);
      });
    }
    var movements = movementSheet_();
    movements.getRange(movements.getLastRow() + 1, 1, movementRows.length, movementRows[0].length).setValues(movementRows);
    return json_({ status: "success", idTransaccion: transactionId, count: movementRows.length });
  } finally {
    lock.releaseLock();
  }
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
  sheet.getRange(row, 1, 1, 8).setValues([[id, clean_(data.categoria, 100), description, 0, 0, 0, 0, minimum]]);
  sheet.getRange(row, 5, 1, 3).setFormulas([[
    '=SUMIFS(\'Registro de Movimientos\'!E:E,\'Registro de Movimientos\'!C:C,A' + row + ',\'Registro de Movimientos\'!D:D,"Entrada")',
    '=SUMIFS(\'Registro de Movimientos\'!E:E,\'Registro de Movimientos\'!C:C,A' + row + ',\'Registro de Movimientos\'!D:D,"Salida")',
    '=D' + row + '+E' + row + '-F' + row
  ]]);
  sheet.getRange(row, 9).setValue("");
  return json_({ status: "success", message: "Accesorio añadido" });
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
