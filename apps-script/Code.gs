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
//   CATALOG_EDITOR_USERS: usuarios separados por coma autorizados a crear y editar accesorios.

var ID_BOVEDA_USUARIOS = "1CSj9D793DGZkxtGadmeTYIOu05ClPhhcOYnxZLzpnWw";
var CONFIG = {
  mainSheetIdProperty: "SPREADSHEET_ID",
  photosFolderProperty: "PHOTOS_FOLDER_ID",
  adminsProperty: "ADMIN_USERS",
  catalogEditorsProperty: "CATALOG_EDITOR_USERS",
  usersSheetIndex: 0,
  inventorySheet: "Maestro de inventario",
  movementsSheet: "Registro de Movimientos",
  requestsSheet: "Solicitudes",
  requestHeaders: ["ID_Solicitud", "Fecha_Registro", "Registrado_Por", "Cliente", "Regional", "Entregado_A", "ID_Articulo", "Descripcion", "Cantidad", "Estado", "Proveedor", "Fecha_Solicitud_Proveedor", "Fecha_Recepcion", "Fecha_Entrega", "ID_Transaccion_Recepcion", "ID_Transaccion_Entrega", "Observaciones", "Actualizado_Por", "Fecha_Actualizacion", "Costo_Unitario_COP"],
  requestStatuses: ["Registrada", "Solicitada", "Recibida", "Entregada"],
  movementHeaders: ["ID_Transaccion", "Fecha_Hora", "ID_Articulo", "Tipo_Movimiento", "Cantidad", "Registrado_Por", "Entregado_A_Usuario", "Cliente_Proveedor", "Regional", "Estado", "ID_Transaccion_Relacionada", "Motivo", "Regional_Origen", "Regional_Destino"],
  movementTypes: ["Entrada", "Salida", "Devolucion", "Ajuste positivo", "Ajuste negativo", "Baja por daño"],
  inventoryActiveColumn: 10,
  inventoryCostColumn: 11,
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
    if (action === "auditar_inventario") return auditInventory_(session);
    if (action === "reparar_formulas_inventario") return rebuildInventoryFormulas_(session);
    if (action === "obtener_dashboard") return getDashboard_(session);
    if (action === "obtener_solicitudes") return getRequests_(data, session);
    if (action === "crear_solicitud") return createRequest_(data, session);
    if (action === "actualizar_estado_solicitud") return updateRequestStatus_(data, session);
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
    return json_({ status: "success", usuario: session.usuario, token: token, permissions: permissions_(session) });
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
  ensureInventoryCostColumn_(sheet);
  var rows = sheet.getDataRange().getValues();
  var ledger = calculateStockLedger_(rows, movementSheet_().getDataRange().getValues());
  var catalog = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    catalog.push({
      idArticulo: clean_(rows[i][0], 100),
      categoria: clean_(rows[i][1], 100),
      descripcion: clean_(rows[i][2], 200),
      stockActual: number_(ledger.balances[clean_(rows[i][0], 100)]),
      stockMinimo: number_(rows[i][7]),
      costoUnitario: number_(rows[i][CONFIG.inventoryCostColumn - 1]),
      fotoUrl: clean_(rows[i][8], 500),
      activo: rows[i].length < CONFIG.inventoryActiveColumn || String(rows[i][CONFIG.inventoryActiveColumn - 1]).toLowerCase() !== "false"
    });
  }
  return json_({ status: "success", usuario: session.usuario, permissions: permissions_(session), data: catalog });
}

function auditInventory_(session) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return auditInventoryData_();
  } finally {
    lock.releaseLock();
  }
}

function auditInventoryData_() {
  var inventory = inventorySheet_();
  var inventoryRows = inventory.getDataRange().getValues();
  var movements = movementSheet_();
  ensureMovementHeaders_(movements);
  var movementRows = movements.getDataRange().getValues();
  var ledger = calculateStockLedger_(inventoryRows, movementRows);
  var issues = [];
  for (var i = 1; i < inventoryRows.length; i++) {
    var id = clean_(inventoryRows[i][0], 100);
    if (!id) continue;
    var ledgerStock = number_(ledger.balances[id]);
    var sheetStock = number_(inventoryRows[i][6]);
    var unknown = Boolean(ledger.unknownMovements[id]);
    var firstNegative = findFirstNegativeMovement_(id, number_(inventoryRows[i][3]), movementRows);
    if (Math.abs(ledgerStock - sheetStock) > 0.0001 || ledgerStock < 0 || unknown) {
      issues.push({
        idArticulo: id,
        descripcion: clean_(inventoryRows[i][2], 200),
        stockEnHoja: sheetStock,
        stockSegunMovimientos: ledgerStock,
        diferencia: sheetStock - ledgerStock,
        stockNegativo: ledgerStock < 0,
        movimientosInvalidos: unknown,
        primerMovimientoNegativo: firstNegative
      });
    }
  }
  return json_({ status: "success", data: { articulosRevisados: Math.max(inventoryRows.length - 1, 0), inconsistencias: issues } });
}

function rebuildInventoryFormulas_(session) {
  if (!isAdmin_(session)) throw new Error("Solo un administrador puede reparar formulas de inventario");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var inventory = inventorySheet_();
    refreshInventoryFormulas_(inventory, inventory.getLastRow());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return auditInventory_(session);
}

function findFirstNegativeMovement_(id, openingStock, movementRows) {
  var balance = openingStock;
  for (var i = 1; i < movementRows.length; i++) {
    var row = movementRows[i];
    if (clean_(row[2], 100) !== id || (clean_(row[9], 50) || "Confirmado") !== "Confirmado") continue;
    var type = clean_(row[3], 100);
    if (CONFIG.movementTypes.indexOf(type) < 0) continue;
    var quantity = Number(row[4]);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    var next = balance + movementEffect_(type) * quantity;
    if (next < 0 && balance >= 0) {
      return {
        idTransaccion: clean_(row[0], 100),
        tipoMovimiento: type,
        cantidad: quantity,
        fechaHora: row[1],
        saldoAntes: balance,
        saldoDespues: next
      };
    }
    balance = next;
  }
  return null;
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

function getDashboard_(session) {
  var inventory = inventorySheet_();
  var inventoryRows = inventory.getDataRange().getValues();
  var movementRows = movementSheet_().getDataRange().getValues();
  var ledger = calculateStockLedger_(inventoryRows, movementRows);
  var metrics = { articulos: 0, unidades: 0, stockBajo: 0, agotados: 0 };
  for (var i = 1; i < inventoryRows.length; i++) {
    if (!inventoryRows[i][0]) continue;
    var stock = number_(ledger.balances[clean_(inventoryRows[i][0], 100)]);
    var minimum = number_(inventoryRows[i][7]);
    var active = String(inventoryRows[i][9]).toLowerCase() !== "false";
    metrics.unidades += stock;
    if (!active) continue;
    metrics.articulos++;
    if (stock <= 0) metrics.agotados++;
    else if (stock <= minimum) metrics.stockBajo++;
  }

  var requestRows = requestSheet_().getDataRange().getValues();
  var requests = Object.create(null);
  for (var j = 1; j < requestRows.length; j++) {
    var requestRow = requestRows[j];
    var requestId = clean_(requestRow[0], 100);
    if (!requestId) continue;
    if (!requests[requestId]) {
      requests[requestId] = {
        estado: String(requestRow[9] || "Registrada"),
        fechaRegistro: requestRow[1],
        fechaCompra: requestRow[11],
        fechaEntrega: requestRow[13],
        lineas: []
      };
    }
    requests[requestId].lineas.push({ cantidad: number_(requestRow[8]), costoUnitario: number_(requestRow[19]) });
  }
  var states = { Registrada: 0, Solicitada: 0, Recibida: 0, Entregada: 0 };
  Object.keys(requests).forEach(function(id) { states[requests[id].estado] = (states[requests[id].estado] || 0) + 1; });

  var now = new Date();
  var monthKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM");
  var purchaseMonthKeys = [];
  var purchaseCounts = Object.create(null);
  for (var monthOffset = 0; monthOffset < 6; monthOffset++) {
    var monthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    var purchaseMonthKey = Utilities.formatDate(monthDate, Session.getScriptTimeZone(), "yyyy-MM");
    purchaseMonthKeys.push(purchaseMonthKey);
    purchaseCounts[purchaseMonthKey] = 0;
  }
  var deliveredCount = 0;
  var completedDurationHours = 0;
  var completedDurationCount = 0;
  var purchaseValueThisMonth = 0;
  var purchaseLinesThisMonth = 0;
  var costedLinesThisMonth = 0;
  Object.keys(requests).forEach(function(id) {
    var request = requests[id];
    var purchased = request.fechaCompra instanceof Date ? request.fechaCompra : new Date(request.fechaCompra);
    var purchaseDateIsValid = !isNaN(purchased.getTime());
    var purchasedMonth = purchaseDateIsValid ? Utilities.formatDate(purchased, Session.getScriptTimeZone(), "yyyy-MM") : "";
    if (purchaseMonthKeys.indexOf(purchasedMonth) >= 0) purchaseCounts[purchasedMonth]++;
    if (purchasedMonth === monthKey) {
      request.lineas.forEach(function(line) {
        purchaseLinesThisMonth++;
        if (line.costoUnitario > 0) {
          purchaseValueThisMonth += line.cantidad * line.costoUnitario;
          costedLinesThisMonth++;
        }
      });
    }
    if (request.estado === "Entregada") {
      var delivered = request.fechaEntrega instanceof Date ? request.fechaEntrega : new Date(request.fechaEntrega);
      var registered = request.fechaRegistro instanceof Date ? request.fechaRegistro : new Date(request.fechaRegistro);
      if (!isNaN(delivered.getTime()) && !isNaN(registered.getTime()) && delivered >= registered) {
        completedDurationHours += (delivered.getTime() - registered.getTime()) / 3600000;
        completedDurationCount++;
      }
      if (!isNaN(delivered.getTime()) && Utilities.formatDate(delivered, Session.getScriptTimeZone(), "yyyy-MM") === monthKey) deliveredCount++;
    }
  });
  var purchasesLastSixMonths = purchaseMonthKeys.reduce(function(total, key) { return total + purchaseCounts[key]; }, 0);
  var movementRows = movementSheet_().getDataRange().getValues();
  var movementsThisMonth = 0;
  for (var k = 1; k < movementRows.length; k++) {
    if (!movementRows[k][0]) continue;
    var movementDate = movementRows[k][1] instanceof Date ? movementRows[k][1] : new Date(movementRows[k][1]);
    if (!isNaN(movementDate.getTime()) && Utilities.formatDate(movementDate, Session.getScriptTimeZone(), "yyyy-MM") === monthKey) movementsThisMonth++;
  }

  return json_({
    status: "success",
    data: {
      articulos: metrics.articulos,
      unidades: metrics.unidades,
      stockBajo: metrics.stockBajo,
      agotados: metrics.agotados,
      solicitudesPendientes: states.Registrada + states.Solicitada + states.Recibida,
      solicitudesPorEstado: states,
      movimientosMes: movementsThisMonth,
      tiempoPromedioEntregaHoras: completedDurationCount ? Math.round(completedDurationHours / completedDurationCount * 10) / 10 : null,
      solicitudesEntregadasMes: deliveredCount,
      comprasProveedorMes: purchaseCounts[monthKey] || 0,
      comprasPromedioMensual: Math.round(purchasesLastSixMonths / 6 * 10) / 10,
      valorComprasMes: costedLinesThisMonth ? purchaseValueThisMonth : null,
      lineasCompraMes: purchaseLinesThisMonth,
      lineasCompraConCostoMes: costedLinesThisMonth
    }
  });
}

function getRequests_(data, session) {
  var sheet = requestSheet_();
  var rows = sheet.getDataRange().getValues();
  var grouped = Object.create(null);
  var statusFilter = clean_(data.estado, 30);
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var id = clean_(row[0], 100);
    if (!id) continue;
    var status = clean_(row[9], 30) || "Registrada";
    if (statusFilter && status !== statusFilter) continue;
    if (!grouped[id]) {
      grouped[id] = {
        idSolicitud: id,
        fechaRegistro: row[1],
        registradoPor: clean_(row[2], 100),
        estado: status,
        proveedor: clean_(row[10], 150),
        fechaSolicitudProveedor: row[11],
        fechaRecepcion: row[12],
        fechaEntrega: row[13],
        observaciones: clean_(row[16], 500),
        items: []
      };
    }
    grouped[id].items.push({
      cliente: clean_(row[3], 150),
      regional: clean_(row[4], 100),
      entregadoA: clean_(row[5], 150),
      idArticulo: clean_(row[6], 100),
      descripcion: clean_(row[7], 200),
      cantidad: number_(row[8]),
      costoUnitario: number_(row[19])
    });
  }
  var result = Object.keys(grouped).map(function(id) { return grouped[id]; });
  result.sort(function(first, second) { return new Date(second.fechaRegistro).getTime() - new Date(first.fechaRegistro).getTime(); });
  return json_({ status: "success", usuario: session.usuario, data: result.slice(0, 300) });
}

function createRequest_(data, session) {
  var lines = Array.isArray(data.items) ? data.items : [];
  if (!lines.length || lines.length > 250) throw new Error("La solicitud debe tener entre 1 y 250 lineas");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var inventory = inventorySheet_();
    ensureInventoryCostColumn_(inventory);
    var inventoryRows = inventory.getDataRange().getValues();
    var catalog = Object.create(null);
    for (var i = 1; i < inventoryRows.length; i++) {
      var sku = clean_(inventoryRows[i][0], 100);
      if (sku) catalog[sku] = {
        description: clean_(inventoryRows[i][2], 200),
        active: String(inventoryRows[i][9]).toLowerCase() !== "false",
        cost: number_(inventoryRows[i][CONFIG.inventoryCostColumn - 1])
      };
    }
    var requestId = Utilities.getUuid();
    var now = new Date();
    var observations = clean_(data.observaciones, 500);
    var rows = lines.map(function(line) {
      var id = clean_(line.idArticulo, 100);
      var item = catalog[id];
      var quantity = Number(line.cantidad);
      var client = clean_(line.cliente, 150);
      var regional = clean_(line.regional, 100);
      var recipient = clean_(line.entregadoA || line.usuario, 150);
      if (!item || !item.active) throw new Error("Articulo inexistente o inactivo: " + id);
      if (!client || !regional || !recipient || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
        throw new Error("Cada linea requiere cliente, regional, destinatario y cantidad valida");
      }
      return [requestId, now, session.usuario, client, regional, recipient, id, item.description, quantity,
        "Registrada", "", "", "", "", "", "", observations, session.usuario, now, item.cost];
    });
    var sheet = requestSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CONFIG.requestHeaders.length).setValues(rows);
    return json_({ status: "success", idSolicitud: requestId, estado: "Registrada", lineas: rows.length });
  } finally {
    lock.releaseLock();
  }
}

function updateRequestStatus_(data, session) {
  var requestId = clean_(data.idSolicitud, 100);
  var nextStatus = clean_(data.estado, 30);
  if (!requestId || ["Solicitada", "Recibida", "Entregada"].indexOf(nextStatus) < 0) throw new Error("Solicitud o estado invalido");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = requestSheet_();
    var values = sheet.getDataRange().getValues();
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === requestId) rows.push({ row: i + 1, values: values[i] });
    }
    if (!rows.length) throw new Error("Solicitud no encontrada");
    var currentStatus = String(rows[0].values[9] || "Registrada");
    if (rows.some(function(row) { return String(row.values[9] || "Registrada") !== currentStatus; })) {
      throw new Error("La solicitud tiene estados inconsistentes; requiere revision administrativa");
    }
    var allowed = { Registrada: "Solicitada", Solicitada: "Recibida", Recibida: "Entregada" };
    if (allowed[currentStatus] !== nextStatus) throw new Error("Transicion invalida: " + currentStatus + " a " + nextStatus);
    if (rows.some(function(row, index) { return index && row.row !== rows[index - 1].row + 1; })) {
      throw new Error("Las lineas de la solicitud no son contiguas; requiere revision administrativa");
    }

    var now = new Date();
    var provider = clean_(data.proveedor, 150) || clean_(rows[0].values[10], 150);
    var unitCosts = [];
    if (nextStatus === "Solicitada") {
      var inventory = inventorySheet_();
      ensureInventoryCostColumn_(inventory);
      var inventoryRows = inventory.getDataRange().getValues();
      var costsBySku = Object.create(null);
      for (var inventoryIndex = 1; inventoryIndex < inventoryRows.length; inventoryIndex++) {
        costsBySku[clean_(inventoryRows[inventoryIndex][0], 100)] = number_(inventoryRows[inventoryIndex][CONFIG.inventoryCostColumn - 1]);
      }
      unitCosts = rows.map(function(row) {
        var sku = clean_(row.values[6], 100);
        if (!Object.prototype.hasOwnProperty.call(costsBySku, sku)) throw new Error("Articulo no existe en el catalogo: " + sku);
        return costsBySku[sku];
      });
    }
    var transactionId = "";
    var receiptTransactionId = String(rows[0].values[14] || "");
    var deliveryTransactionId = String(rows[0].values[15] || "");
    var movementRows = [];
    if (nextStatus === "Solicitada" && !provider) throw new Error("Indica el proveedor solicitado");
    if (nextStatus === "Recibida") {
      if (!provider) throw new Error("La solicitud no tiene proveedor registrado");
      receiptTransactionId = receiptTransactionId || Utilities.getUuid();
      transactionId = receiptTransactionId;
      if (!rows[0].values[14]) sheet.getRange(rows[0].row, 15, rows.length, 1).setValues(rows.map(function() { return [receiptTransactionId]; }));
      movementRows = buildReceiptMovements_(rows, session, provider, transactionId, now);
      ensureRequestTransaction_(movementSheet_(), transactionId, movementRows);
    }
    if (nextStatus === "Entregada") {
      validateRequestStock_(rows);
      deliveryTransactionId = deliveryTransactionId || Utilities.getUuid();
      transactionId = deliveryTransactionId;
      if (!rows[0].values[15]) sheet.getRange(rows[0].row, 16, rows.length, 1).setValues(rows.map(function() { return [deliveryTransactionId]; }));
      movementRows = buildDeliveryMovements_(rows, session, transactionId, now);
      ensureRequestTransaction_(movementSheet_(), transactionId, movementRows);
    }

    var updates = rows.map(function(row) {
      var original = row.values;
      return [nextStatus, provider,
        nextStatus === "Solicitada" ? now : original[11],
        nextStatus === "Recibida" ? now : original[12],
        nextStatus === "Entregada" ? now : original[13],
        receiptTransactionId, deliveryTransactionId, original[16] || "", session.usuario, now];
    });
    sheet.getRange(rows[0].row, 10, updates.length, 10).setValues(updates);
    if (nextStatus === "Solicitada") {
      unitCosts.forEach(function(amount, index) { sheet.getRange(rows[index].row, 20).setValue(amount); });
    }
    return json_({ status: "success", idSolicitud: requestId, estado: nextStatus, idTransaccion: transactionId });
  } finally {
    lock.releaseLock();
  }
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
    var movements = movementSheet_();
    ensureMovementHeaders_(movements);
    var ledger = calculateStockLedger_(rows, movements.getDataRange().getValues());
    var index = {};
    for (var i = 1; i < rows.length; i++) index[clean_(rows[i][0], 100)] = i + 1;
    var requested = {};
    var stockChanges = {};
    items.forEach(function(item) {
      if (!index[item.idArticulo]) throw new Error("Articulo no existe: " + item.idArticulo);
      requested[item.idArticulo] = (requested[item.idArticulo] || 0) + item.cantidad;
      stockChanges[item.idArticulo] = (stockChanges[item.idArticulo] || 0) + movementEffect_(type) * item.cantidad;
    });
    validateStockChanges_(stockChanges, ledger);

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
    movements.getRange(movements.getLastRow() + 1, 1, movementRows.length, movementRows[0].length).setValues(movementRows);
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
    var ledger = calculateStockLedger_(inventoryRows, rows);
    var index = {};
    for (var j = 1; j < inventoryRows.length; j++) index[clean_(inventoryRows[j][0], 100)] = j + 1;
    var requested = {};
    var stockChanges = {};
    inverseItems.forEach(function(item) {
      var delta = movementEffect_(item.type) * item.cantidad;
      requested[item.idArticulo] = (requested[item.idArticulo] || 0) + delta;
      stockChanges[item.idArticulo] = (stockChanges[item.idArticulo] || 0) + delta;
    });
    Object.keys(requested).forEach(function(id) {
      if (!index[id]) throw new Error("Articulo no existe: " + id);
    });
    validateStockChanges_(stockChanges, ledger, "reversar");
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
  requireCatalogEditor_(session);
  var id = clean_(data.idArticulo, 100);
  var description = clean_(data.descripcion, 200);
  var minimum = number_(data.stockMinimo);
  if (!id || !description || minimum < 1) throw new Error("Datos de accesorio invalidos");
  var sheet = inventorySheet_();
  ensureInventoryCostColumn_(sheet);
  var unitCost = Number(data.costoUnitario);
  if (!isFinite(unitCost) || unitCost < 0 || unitCost > 1000000000) throw new Error("Costo unitario invalido");
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (clean_(rows[i][0], 100).toUpperCase() === id.toUpperCase()) throw new Error("El codigo ya existe");
  }
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, CONFIG.inventoryActiveColumn).setValues([[id, clean_(data.categoria, 100), description, 0, 0, 0, 0, minimum, "", true]]);
  sheet.getRange(row, CONFIG.inventoryCostColumn).setValue(unitCost);
  refreshInventoryFormulas_(sheet, row);
  sheet.getRange(row, 9).setValue("");
  return json_({ status: "success", message: "Accesorio añadido" });
}

function updateAccessory_(data, session) {
  requireCatalogEditor_(session);
  var id = clean_(data.idArticulo, 100);
  var sheet = inventorySheet_();
  ensureInventoryCostColumn_(sheet);
  var unitCost = data.costoUnitario == null ? null : Number(data.costoUnitario);
  if (unitCost != null && (!isFinite(unitCost) || unitCost < 0 || unitCost > 1000000000)) throw new Error("Costo unitario invalido");
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (clean_(rows[i][0], 100).toUpperCase() !== id.toUpperCase()) continue;
    if (data.descripcion != null) sheet.getRange(i + 1, 3).setValue(clean_(data.descripcion, 200));
    if (data.stockMinimo != null && Number(data.stockMinimo) >= 0) sheet.getRange(i + 1, 8).setValue(Number(data.stockMinimo));
    if (data.activo != null) sheet.getRange(i + 1, CONFIG.inventoryActiveColumn).setValue(Boolean(data.activo));
    if (unitCost != null) sheet.getRange(i + 1, CONFIG.inventoryCostColumn).setValue(unitCost);
    return json_({ status: "success", message: "Accesorio actualizado" });
  }
  throw new Error("Articulo no existe");
}

function movementEffect_(type) {
  if (["Entrada", "Ajuste positivo"].indexOf(type) >= 0) return 1;
  if (["Salida", "Devolucion", "Ajuste negativo", "Baja por daño"].indexOf(type) >= 0) return -1;
  return 0;
}

function calculateStockLedger_(inventoryRows, movementRows) {
  var balances = Object.create(null);
  var unknownMovements = Object.create(null);
  for (var i = 1; i < inventoryRows.length; i++) {
    var id = clean_(inventoryRows[i][0], 100);
    if (id) balances[id] = number_(inventoryRows[i][3]);
  }
  for (var j = 1; j < movementRows.length; j++) {
    var movement = movementRows[j];
    var id = clean_(movement[2], 100);
    if (!id || !Object.prototype.hasOwnProperty.call(balances, id)) continue;
    var status = clean_(movement[9], 50) || "Confirmado";
    if (status !== "Confirmado") continue;
    var type = clean_(movement[3], 100);
    if (CONFIG.movementTypes.indexOf(type) < 0) {
      unknownMovements[id] = true;
      continue;
    }
    var quantity = Number(movement[4]);
    if (!Number.isInteger(quantity) || quantity < 1) {
      unknownMovements[id] = true;
      continue;
    }
    balances[id] += movementEffect_(type) * quantity;
  }
  return { balances: balances, unknownMovements: unknownMovements };
}

function validateStockChanges_(changes, ledger, operation) {
  var verb = operation || "registrar";
  Object.keys(changes).forEach(function(id) {
    if (ledger.unknownMovements[id]) {
      throw new Error("No se puede " + verb + " el movimiento de '" + id + "': hay movimientos confirmados inválidos; audita el inventario primero");
    }
    var current = number_(ledger.balances[id]);
    var next = current + changes[id];
    if (next < 0) {
      throw new Error("Stock insuficiente para '" + id + "'. Disponible según movimientos: " + current);
    }
  });
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
    var confirmedMovement = function(type) {
      var criteria = "'Registro de Movimientos'!C:C;A" + row + ";'Registro de Movimientos'!D:D;\"" + type + "\";";
      return "SUMIFS('Registro de Movimientos'!E:E;" + criteria + "'Registro de Movimientos'!J:J;\"Confirmado\")+" +
        "SUMIFS('Registro de Movimientos'!E:E;" + criteria + "'Registro de Movimientos'!J:J;\"\")";
    };
    formulas.push([
      "=" + confirmedMovement("Entrada") + "+" + confirmedMovement("Ajuste positivo"),
      "=" + confirmedMovement("Salida") + "+" + confirmedMovement("Devolucion") + "+" + confirmedMovement("Ajuste negativo") + "+" + confirmedMovement("Baja por daño"),
      '=D' + row + '+E' + row + '-F' + row
    ]);
  }
  if (formulas.length) sheet.getRange(2, 5, formulas.length, 3).setFormulas(formulas);
}

function uploadPhoto_(data, session) {
  requireCatalogEditor_(session);
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

function isCatalogEditor_(session) {
  var configured = PropertiesService.getScriptProperties().getProperty(CONFIG.catalogEditorsProperty) || "";
  var editors = configured.split(",").map(function(value) { return value.trim().toLowerCase(); }).filter(Boolean);
  return isAdmin_(session) || editors.indexOf(String(session.usuario || "").toLowerCase()) >= 0;
}

function permissions_(session) {
  return {
    canManageCatalog: isCatalogEditor_(session),
    canReconcileInventory: isAdmin_(session)
  };
}

function requireCatalogEditor_(session) {
  if (!isCatalogEditor_(session)) throw new Error("No tienes permiso para crear o editar accesorios");
}

function ensureInventoryCostColumn_(sheet) {
  var header = clean_(sheet.getRange(1, CONFIG.inventoryCostColumn).getValue(), 100);
  if (!header) {
    sheet.getRange(1, CONFIG.inventoryCostColumn).setValue("Costo_Unitario_COP");
    return;
  }
  if (header !== "Costo_Unitario_COP") throw new Error("La columna K debe estar libre para Costo_Unitario_COP");
}

function requestSheet_() {
  var spreadsheet = mainSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(CONFIG.requestsSheet);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.requestsSheet);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.requestHeaders.length).setValues([CONFIG.requestHeaders]);
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, CONFIG.requestHeaders.length).getValues()[0];
  for (var i = 0; i < CONFIG.requestHeaders.length; i++) {
    if (String(headers[i] || "").trim() !== CONFIG.requestHeaders[i]) {
      if (i === CONFIG.requestHeaders.length - 1 && !String(headers[i] || "").trim()) {
        sheet.getRange(1, i + 1).setValue(CONFIG.requestHeaders[i]);
        continue;
      }
      throw new Error("La hoja Solicitudes existe con encabezados incompatibles");
    }
  }
  return sheet;
}

function buildReceiptMovements_(requestRows, session, provider, transactionId, now) {
  var totals = requestTotals_(requestRows);
  return Object.keys(totals).map(function(id) {
    return [transactionId, now, id, "Entrada", totals[id], session.usuario, "", provider, "Bogota", "Confirmado", "",
      "Recepcion de solicitud " + clean_(requestRows[0].values[0], 100), "", "Comunicaciones"];
  });
}

function buildDeliveryMovements_(requestRows, session, transactionId, now) {
  return requestRows.map(function(requestRow) {
    var row = requestRow.values;
    return [transactionId, now, clean_(row[6], 100), "Salida", number_(row[8]), session.usuario,
      clean_(row[5], 150), clean_(row[3], 150), clean_(row[4], 100), "Confirmado", "",
      "Entrega de solicitud " + clean_(row[0], 100), "", ""];
  });
}

function requestTotals_(requestRows) {
  var totals = Object.create(null);
  requestRows.forEach(function(requestRow) {
    var row = requestRow.values;
    var id = clean_(row[6], 100);
    totals[id] = (totals[id] || 0) + number_(row[8]);
  });
  return totals;
}

function validateRequestStock_(requestRows) {
  var inventory = inventorySheet_();
  var inventoryRows = inventory.getDataRange().getValues();
  var ledger = calculateStockLedger_(inventoryRows, movementSheet_().getDataRange().getValues());
  var totals = requestTotals_(requestRows);
  var stockChanges = Object.create(null);
  Object.keys(totals).forEach(function(id) {
    if (!Object.prototype.hasOwnProperty.call(ledger.balances, id)) throw new Error("Articulo no existe: " + id);
    stockChanges[id] = -totals[id];
  });
  validateStockChanges_(stockChanges, ledger, "entregar solicitud");
}

function ensureRequestTransaction_(movements, transactionId, movementRows) {
  ensureMovementHeaders_(movements);
  var values = movements.getDataRange().getValues();
  var existing = 0;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === transactionId) existing++;
  }
  if (existing && existing !== movementRows.length) {
    throw new Error("La transaccion de solicitud esta incompleta; requiere revision administrativa");
  }
  if (!existing) {
    movements.getRange(movements.getLastRow() + 1, 1, movementRows.length, movementRows[0].length).setValues(movementRows);
  }
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
