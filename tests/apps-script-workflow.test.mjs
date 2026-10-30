import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const code = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class Range {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset)));
  }

  getDisplayValues() {
    return this.getValues().map(row => row.map(value => String(value ?? '')));
  }

  getValue() {
    return this.sheet.getCell(this.row, this.column);
  }

  setValues(values) {
    values.forEach((row, rowOffset) => row.forEach((value, columnOffset) =>
      this.sheet.setCell(this.row + rowOffset, this.column + columnOffset, value)));
    return this;
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }

  clearContent() {
    this.sheet.clearContents();
    return this;
  }

  setFormulas(formulas) {
    this.sheet.lastFormulas = formulas;
    return this;
  }
  setDataValidation(rule) {
    this.sheet.validations.push({ row: this.row, column: this.column, rowCount: this.rowCount, columnCount: this.columnCount, rule });
    return this;
  }
}

class Sheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows;
    this.validations = [];
    this.hiddenColumns = new Set();
    this.maxRows = 100;
    this.maxColumns = 26;
  }

  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index].some(value => value !== '' && value != null)) return index + 1;
    }
    return 0;
  }

  getLastColumn() {
    return Math.max(0, ...this.rows.map(row => row.length));
  }

  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }

  insertRowsAfter(_row, count) { this.maxRows += count; return this; }
  insertColumnsAfter(_column, count) { this.maxColumns += count; return this; }

  clearContents() {
    this.rows = [];
    return this;
  }

  getDataRange() {
    const lastRow = Math.max(this.getLastRow(), 1);
    const lastColumn = Math.max(1, ...this.rows.map(row => row.length));
    return new Range(this, 1, 1, lastRow, lastColumn);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new Range(this, row, column, rowCount, columnCount);
  }

  deleteRow(row) {
    this.rows.splice(row - 1, 1);
    return this;
  }

  setName(name) {
    this.spreadsheet.sheets.delete(this.name);
    this.name = name;
    this.spreadsheet.sheets.set(name, this);
    return this;
  }

  copyTo(spreadsheet) {
    const copy = new Sheet(`Copy of ${this.name}`, this.rows.map(row => [...row]));
    return spreadsheet.addSheet(copy);
  }

  hideColumns(column, count = 1) {
    for (let index = column; index < column + count; index++) this.hiddenColumns.add(index);
    return this;
  }

  getCell(row, column) {
    const override = this.formulaOverrides && this.formulaOverrides[`${row}:${column}`];
    if (override != null) return override;
    const raw = this.rows[row - 1]?.[column - 1] ?? '';
    if (this.name !== 'Inventario accesorios' || row === 1 || column < 5 || column > 7) return raw;
    const sku = this.rows[row - 1][0];
    const movements = this.spreadsheet.getSheetByName('Registro de Movimientos').rows.slice(1);
    const incoming = movements.filter(item => item[2] === sku && ['Entrada', 'Ajuste positivo'].includes(item[3]) && ['Confirmado', 'Reversado'].includes(item[9] || 'Confirmado'))
      .reduce((sum, item) => sum + Number(item[4] || 0), 0);
    const outgoing = movements.filter(item => item[2] === sku && ['Salida', 'Devolucion', 'Ajuste negativo', 'Baja por daño'].includes(item[3]) && ['Confirmado', 'Reversado'].includes(item[9] || 'Confirmado'))
      .reduce((sum, item) => sum + Number(item[4] || 0), 0);
    return column === 5 ? incoming : column === 6 ? outgoing : Number(this.rows[row - 1][3] || 0) + incoming - outgoing;
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }
}

class Spreadsheet {
  constructor(id = 'mock-spreadsheet') {
    this.id = id;
    this.sheets = new Map();
    const inventory = new Sheet('Inventario accesorios', [
      ['ID', 'Categoria', 'Descripcion', 'Stock inicial', 'Entradas', 'Salidas', 'Stock_Actual', 'Minimo', 'Foto', 'Activo', 'Costo_Unitario_COP'],
      ['CARG-USB', 'Cargador', 'Cargador USB', 0, 0, 0, 0, 5, '', true, 25000]
    ]);
    const movements = new Sheet('Registro de Movimientos', [[
      'ID_Transaccion', 'Fecha_Hora', 'ID_Articulo', 'Tipo_Movimiento', 'Cantidad', 'Registrado_Por',
      'Entregado_A_Usuario', 'Cliente_Proveedor', 'Regional', 'Estado', 'ID_Transaccion_Relacionada',
      'Motivo', 'Regional_Origen', 'Regional_Destino'
    ]]);
    this.addSheet(inventory);
    this.addSheet(movements);
  }

  addSheet(sheet) {
    sheet.spreadsheet = this;
    this.sheets.set(sheet.name, sheet);
    return sheet;
  }

  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return [...this.sheets.values()]; }
  getId() { return this.id; }
  insertSheet(name) { return this.addSheet(new Sheet(name)); }
  deleteSheet(sheet) { this.sheets.delete(sheet.name); }
}

function createRuntime() {
  const spreadsheet = new Spreadsheet('internal-spreadsheet');
  const sessionEntries = new Map();
  const cacheWrites = [];
  const scheduledTriggers = [];
  let uuid = 0;
  const properties = {
    MAIN_SHEET: '',
    ADMIN_USERS: 'legacy-admin',
    CATALOG_EDITOR_USERS: 'catalog-editor',
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-3.8-flash',
    INVENTORY_EMAIL_ACCOUNT: 'sol.comunicaciones.g4s@gmail.com'
  };
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => spreadsheet,
      flush() {},
      newDataValidation: () => {
        const rule = {};
        return {
          requireValueInList(values) { rule.values = values; return this; },
          requireNumberGreaterThanOrEqualTo(value) { rule.minimum = value; return this; },
          setAllowInvalid(value) { rule.allowInvalid = value; return this; },
          build() { return rule; }
        };
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties[key] || '',
        setProperty: (key, value) => { properties[key] = value; },
        deleteProperty: key => { delete properties[key]; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => sessionEntries.get(key) || null,
        put(key, value, ttl) {
          sessionEntries.set(key, value);
          cacheWrites.push({ key, value, ttl });
        }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => scheduledTriggers,
      newTrigger(handler) {
        return {
          timeBased() { return this; },
          everyDays() { return this; },
          atHour() { return this; },
          create() {
            const trigger = { getHandlerFunction: () => handler };
            scheduledTriggers.push(trigger);
            return trigger;
          }
        };
      }
    },
    Utilities: {
      getUuid: () => `test-id-${++uuid}`,
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_algorithm, value) => Array.from(value).map(character => character.charCodeAt(0)),
      base64EncodeWebSafe: bytes => bytes.join(''),
      sleep() {},
      formatDate: (date, _timezone, pattern) => pattern === 'dd/MM/yyyy'
        ? `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
        : date.toISOString().slice(0, 7)
    },
    Session: {
      getScriptTimeZone: () => 'UTC',
      getEffectiveUser: () => ({ getEmail: () => 'sol.comunicaciones.g4s@gmail.com' })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) { return { content, setMimeType() { return this; } }; }
    }
  };
  runInNewContext(code, context, { filename: 'Code.gs' });
  return { context, spreadsheet, sessionEntries, cacheWrites, scheduledTriggers };
}

function mockAi(context, content) {
  let request;
  context.UrlFetchApp = {
    fetch(url, options) {
      request = { url, options };
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }]
        })
      };
    }
  };
  return () => request;
}

function response(output) {
  return JSON.parse(output.content);
}

function stockFor(spreadsheet, sku) {
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');
  const row = inventory.rows.findIndex(values => values[0] === sku) + 1;
  return inventory.getRange(row, 7).getValue();
}

test('authenticated activity renews the server-side session lifetime', () => {
  const { context, sessionEntries, cacheWrites } = createRuntime();
  const token = 'active-session-token';
  const key = context.sessionKey_(token);
  const rawSession = JSON.stringify({ usuario: 'operador', rol: 'usuario' });
  sessionEntries.set(key, rawSession);

  assert.equal(context.requireSession_({ token }).usuario, 'operador');
  assert.deepEqual(cacheWrites, [{
    key,
    value: rawSession,
    ttl: context.CONFIG.sessionTtlSeconds
  }]);
});

test('movement retries with the same idempotency key do not duplicate inventory rows', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'administrador', rol: 'admin' };
  const movement = {
    tipoMovimiento: 'Entrada',
    proveedor: 'Proveedor A',
    claveIdempotencia: 'request-key-001',
    items: [{ idArticulo: 'CARG-USB', cantidad: 6 }]
  };

  const first = response(context.registerMovement_(movement, session));
  const retried = response(context.registerMovement_(movement, session));
  const rows = spreadsheet.getSheetByName('Registro de Movimientos').rows;

  assert.equal(first.idTransaccion, retried.idTransaccion);
  assert.equal(retried.duplicado, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][14], 'request-key-001');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 6);
  assert.throws(() => context.registerMovement_({
    ...movement,
    items: [{ idArticulo: 'CARG-USB', cantidad: 7 }]
  }, session), /clave de registro ya fue usada/);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 6);
});

test('negative movement quantities are rejected and spreadsheet quantity columns disallow negatives', () => {
  const { context, spreadsheet } = createRuntime();
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');

  context.ensureMovementHeaders_(movements);
  assert.throws(() => context.registerMovement_({
    tipoMovimiento: 'Entrada',
    proveedor: 'Proveedor A',
    items: [{ idArticulo: 'CARG-USB', cantidad: -1 }]
  }, { usuario: 'administrador', rol: 'admin' }), /cantidad invalida/i);
  assert.equal(movements.getLastRow(), 1);
  assert.ok(movements.validations.some(validation =>
    validation.column === 5 && validation.rule.minimum === 1 && validation.rule.allowInvalid === false));
});

test('operators can record entries, customer exits, and damage write-offs only', () => {
  const { context, spreadsheet } = createRuntime();
  const admin = { usuario: 'administrador', rol: 'admin' };
  const operator = { usuario: 'operador', rol: 'usuario' };
  const movement = response(context.registerMovement_({
    tipoMovimiento: 'Entrada',
    proveedor: 'Proveedor A',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }]
  }, admin));

  assert.throws(() => context.registerMovement_({
    tipoMovimiento: 'Ajuste positivo',
    motivo: 'Ajuste no autorizado',
    items: [{ idArticulo: 'CARG-USB', cantidad: 1 }]
  }, operator), /reservado a administradores/);
  assert.throws(() => context.registerMovement_({
    tipoMovimiento: 'Ajuste negativo',
    motivo: 'Ajuste no autorizado',
    items: [{ idArticulo: 'CARG-USB', cantidad: 1 }]
  }, operator), /reservado a administradores/);
  assert.throws(() => context.registerMovement_({
    tipoMovimiento: 'Devolucion',
    proveedor: 'Proveedor A',
    items: [{ idArticulo: 'CARG-USB', cantidad: 1 }]
  }, operator), /reservado a administradores/);
  assert.throws(() => context.annulMovement_({
    idTransaccion: movement.idTransaccion,
    justificacion: 'Motivo'
  }, operator), /Solo un administrador/);
  assert.throws(() => context.annulMovement_({
    idTransaccion: movement.idTransaccion
  }, admin), /justificacion.*obligatoria/i);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 2);
});

test('non-admin users can register Entrada, Salida, and Baja por daño', () => {
  const { context, spreadsheet } = createRuntime();
  const operator = { usuario: 'operador', rol: 'usuario' };
  const entry = response(context.registerMovement_({
    tipoMovimiento: 'Entrada',
    proveedor: 'CAPMOVIL',
    items: [{ idArticulo: 'CARG-USB', cantidad: 5 }]
  }, operator));
  assert.equal(entry.status, 'success');

  const exit = response(context.registerMovement_({
    tipoMovimiento: 'Salida',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }],
    distribution: [{
      cliente: 'Cliente A',
      idArticulo: 'CARG-USB',
      regional: 'Bogota',
      usuario: 'Ana',
      cantidad: 2
    }]
  }, operator));
  assert.equal(exit.status, 'success');

  const damage = response(context.registerMovement_({
    tipoMovimiento: 'Baja por daño',
    motivo: 'Equipo averiado',
    items: [{ idArticulo: 'CARG-USB', cantidad: 1 }]
  }, operator));
  assert.equal(damage.status, 'success');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 2);
  assert.deepEqual(spreadsheet.getSheetByName('Registro de Movimientos').rows.slice(1).map(row => row[3]), [
    'Entrada',
    'Salida',
    'Baja por daño'
  ]);
});

test('inventory formulas retain both sides of corrected movements', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');

  context.refreshInventoryFormulas_(inventory, 2);

  assert.match(inventory.lastFormulas[0][0], /"Confirmado"/);
  assert.match(inventory.lastFormulas[0][1], /"Confirmado"/);
  assert.match(inventory.lastFormulas[0][0], /"Reversado"/);
  assert.match(inventory.lastFormulas[0][1], /"Reversado"/);
  assert.doesNotMatch(inventory.lastFormulas[0][0], /"Anulado"/);
  assert.doesNotMatch(inventory.lastFormulas[0][1], /"Anulado"/);
});

test('legacy annulment inverse is neutralized without deleting its audit row', () => {
  const { context, spreadsheet } = createRuntime();
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 2, 14).setValues([
    ['old-annulled', new Date(), 'CARG-USB', 'Salida', 4, 'operador', '', 'Cliente A', 'Bogota', 'Anulado', 'old-inverse', '', '', ''],
    ['old-inverse', new Date(), 'CARG-USB', 'Entrada', 4, 'operador', '', 'Cliente A', 'Bogota', 'Confirmado', 'old-annulled', 'Anulacion de old-annulled', '', '']
  ]);

  assert.equal(context.neutralizeLegacyAnnulmentInverses_(movements), 1);
  assert.equal(movements.rows.length, 3);
  assert.equal(movements.rows[1][9], 'Anulado');
  assert.equal(movements.rows[2][9], 'Anulado');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
  assert.equal(context.neutralizeLegacyAnnulmentInverses_(movements), 0);
});

test('dashboard includes the last twelve months of incoming and outgoing unit totals', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'administrador', rol: 'admin' };
  const now = new Date();
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 2, 14).setValues([
    ['incoming-test', now, 'CARG-USB', 'Entrada', 5, 'operador', '', 'Proveedor A', 'Bogota', 'Confirmado', '', '', '', ''],
    ['outgoing-test', now, 'CARG-USB', 'Salida', 2, 'operador', 'Ana', 'Cliente A', 'Bogota', 'Confirmado', '', '', '', '']
  ]);

  const dashboard = response(context.getDashboard_(session));
  const currentMonth = now.toISOString().slice(0, 7);
  const currentMonthTotals = dashboard.data.unidadesPorMes.find(item => item.mes === currentMonth);

  assert.equal(dashboard.data.unidadesPorMes.length, 12);
  assert.equal(currentMonthTotals.entradas, 5);
  assert.equal(currentMonthTotals.salidas, 2);
});

test('inventory insights calculate coverage, replenishment, request aging, SLA, stagnant stock, and ABC', () => {
  const { context, spreadsheet } = createRuntime();
  const now = new Date();
  const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');
  inventory.getRange(2, 4).setValue(128);
  inventory.getRange(3, 1, 1, 11).setValues([
    ['CABLE-HDMI', 'Cable', 'Cable HDMI', 30, 0, 0, 0, 5, '', true, 10000]
  ]);
  inventory.getRange(4, 1, 1, 11).setValues([
    ['ROUTER-WIFI', 'Red', 'Router Wi-Fi', 8, 0, 0, 0, 2, '', true, 20000]
  ]);
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 5, 14).setValues([
    ['recent-usb-sale', daysAgo(10), 'CARG-USB', 'Salida', 90, 'operador', 'Ana', 'Cliente A', 'Bogota', 'Confirmado', '', '', '', ''],
    ['recent-cable-sale', daysAgo(20), 'CABLE-HDMI', 'Salida', 10, 'operador', 'Luis', 'Cliente B', 'Cali', 'Confirmado', '', '', '', ''],
    ['annulled-sale', daysAgo(2), 'CARG-USB', 'Salida', 50, 'operador', 'Eva', 'Cliente C', 'Cali', 'Anulado', '', '', '', ''],
    ['damage-writeoff', daysAgo(1), 'CARG-USB', 'Baja por daño', 8, 'operador', '', '', 'Cali', 'Confirmado', '', '', '', ''],
    ['old-sale', daysAgo(120), 'CARG-USB', 'Salida', 20, 'operador', 'Eva', 'Cliente D', 'Bogota', 'Confirmado', '', '', '', '']
  ]);

  const requests = context.requestSheet_();
  const addRequest = ({ id, age, status, type = 'Cliente', deliveryDays }) => {
    const row = Array(26).fill('');
    row[0] = id;
    row[1] = daysAgo(age);
    row[4] = 'Bogota';
    row[9] = status;
    row[13] = deliveryDays == null ? '' : daysAgo(deliveryDays);
    row[25] = type;
    requests.rows.push(row);
  };
  addRequest({ id: 'open-overdue', age: 10, status: 'Registrada' });
  addRequest({ id: 'open-communications', age: 20, status: 'Solicitada', type: 'Comunicaciones' });
  addRequest({ id: 'delivered-ontime', age: 5, status: 'Entregada', deliveryDays: 1 });
  addRequest({ id: 'delivered-late', age: 10, status: 'Entregada', deliveryDays: 1 });

  const insights = response(context.getInventoryInsights_({
    consumoDias: 90,
    sinMovimientoDias: 180,
    plazoProveedorDias: 10,
    stockSeguridadDias: 5,
    metaEntregaDias: 7
  }, { usuario: 'administrador', rol: 'admin' })).data;

  assert.equal(insights.parametros.consumoDias, 90);
  assert.equal(insights.cobertura.find(item => item.idArticulo === 'CARG-USB').consumoDiario, 1);
  assert.equal(insights.cobertura.find(item => item.idArticulo === 'CARG-USB').coberturaDias, 10);
  assert.equal(insights.reposicion.find(item => item.idArticulo === 'CARG-USB').cantidadSugerida, 5);
  assert.equal(insights.articulosPorDebajoCobertura, 1);
  assert.equal(insights.solicitudesAbiertas.total, 2);
  assert.equal(insights.solicitudesAbiertas.masDe14Dias, 1);
  assert.equal(insights.solicitudesAbiertas.vencidas, 1);
  assert.equal(insights.cumplimientoEntrega.entregadas, 2);
  assert.equal(insights.cumplimientoEntrega.porcentaje, 50);
  assert.equal(insights.cumplimientoEntrega.medianaDias, 6.5);
  assert.equal(insights.cumplimientoEntrega.percentil90Dias, 8.5);
  assert.equal(insights.articulosSinMovimientoTotal, 1);
  assert.equal(insights.articulosSinMovimiento[0].idArticulo, 'ROUTER-WIFI');
  assert.equal(insights.abc[0].idArticulo, 'CARG-USB');
  assert.equal(insights.abc[0].clasificacion, 'A');
  assert.throws(() => context.getInventoryInsights_({ consumoDias: 5 }, { usuario: 'operador' }), /Parametro de analitica invalido/);

  const operatorInsights = response(context.getInventoryInsights_({
    consumoDias: 90,
    plazoProveedorDias: 1,
    stockSeguridadDias: 0,
    metaEntregaDias: 7,
    sinMovimientoDias: 180
  }, { usuario: 'operador', rol: 'usuario' })).data;
  assert.deepEqual(operatorInsights.cobertura, []);
  assert.deepEqual(operatorInsights.reposicion, []);
  assert.equal(operatorInsights.articulosPorDebajoCobertura, null);
  assert.equal(operatorInsights.parametros.plazoProveedorDias, null);
});

test('supplier lead-time analysis measures request-to-receipt once per request and tracks waiting requests', () => {
  const { context } = createRuntime();
  const requests = context.requestSheet_();
  const now = new Date();
  const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const addRequestLine = ({ id, requestedDays, receivedDays, supplier, status = 'Recibida', type = 'Comunicaciones' }) => {
    const row = Array(26).fill('');
    row[0] = id;
    row[1] = daysAgo(requestedDays + 2);
    row[9] = status;
    row[10] = supplier || '';
    row[11] = daysAgo(requestedDays);
    row[12] = receivedDays == null ? '' : daysAgo(receivedDays);
    row[25] = type;
    requests.rows.push(row);
  };
  addRequestLine({ id: 'cap-request-1', requestedDays: 30, receivedDays: 25, supplier: 'CAPMOVIL' });
  addRequestLine({ id: 'cap-request-1', requestedDays: 30, receivedDays: 25, supplier: 'CAPMOVIL' });
  addRequestLine({ id: 'other-request', requestedDays: 20, receivedDays: 10, supplier: 'Proveedor B' });
  addRequestLine({ id: 'cap-pending', requestedDays: 6, receivedDays: null, supplier: 'CAPMOVIL', status: 'Solicitada' });
  addRequestLine({ id: 'unknown-pending', requestedDays: 5, receivedDays: null, supplier: '', status: 'Solicitada' });
  addRequestLine({ id: 'annulled-order', requestedDays: 3, receivedDays: 1, supplier: 'Proveedor anulado', status: 'Anulada' });
  addRequestLine({ id: 'invalid-date-order', requestedDays: 9, receivedDays: 10, supplier: 'Proveedor fecha invalida' });
  addRequestLine({ id: 'old-order', requestedDays: 500, receivedDays: 490, supplier: 'Proveedor antiguo' });

  const insight = response(context.getInventoryInsights_({}, {
    usuario: 'administrador',
    rol: 'admin'
  })).data.tiempoEntregaProveedor;

  assert.equal(insight.recibidas, 2);
  assert.equal(insight.promedioDias, 7.5);
  assert.equal(insight.medianaDias, 7.5);
  assert.equal(insight.percentil90Dias, 9.5);
  assert.equal(insight.abiertas, 2);
  assert.equal(insight.proveedoresSinNombre, 1);
  assert.equal(insight.proveedores.find(item => item.proveedor === 'CAPMOVIL').recibidas, 1);
  assert.equal(insight.proveedores.find(item => item.proveedor === 'CAPMOVIL').promedioDias, 5);
  assert.equal(insight.proveedores.find(item => item.proveedor === 'CAPMOVIL').abiertas, 1);
  assert.equal(insight.proveedores.find(item => item.proveedor === 'Proveedor B').promedioDias, 10);
  assert.equal(insight.meses.reduce((total, item) => total + item.recibidas, 0), 2);
  assert.equal(insight.solicitudesEnEspera[0].idSolicitud, 'cap-pending');
  assert.equal(insight.solicitudesEnEspera[0].diasEspera, 6);

  const operatorData = response(context.getInventoryInsights_({}, {
    usuario: 'operador',
    rol: 'usuario'
  })).data;
  assert.equal(operatorData.tiempoEntregaProveedor.recibidas, 2);
  assert.equal(operatorData.tiempoEntregaProveedor.proveedores.length, 2);
  assert.deepEqual(operatorData.reposicion, []);
});

test('dashboard ranks delivered accessories and excludes corrected movements', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'operador', rol: 'usuario' };
  const now = new Date();
  const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  spreadsheet.getSheetByName('Inventario accesorios').getRange(3, 1, 1, 11).setValues([
    ['ADAPT-HDMI', 'Adaptador', 'Adaptador HDMI', 0, 0, 0, 0, 1, '', true, 15000]
  ]);
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 5, 14).setValues([
    ['sale-bogota-1', now, 'CARG-USB', 'Salida', 5, 'operador', 'Ana', 'Cliente A', 'Bogota', 'Confirmado', '', '', '', ''],
    ['sale-bogota-2', daysAgo(10), 'CARG-USB', 'Salida', 3, 'operador', 'Luis', 'Cliente B', 'Bogota', 'Confirmado', '', '', '', ''],
    ['sale-cali', daysAgo(45), 'CARG-USB', 'Salida', 4, 'operador', 'Eva', 'Cliente C', 'Cali', 'Confirmado', '', '', '', ''],
    ['sale-reversed', now, 'CARG-USB', 'Salida', 9, 'operador', 'Mia', 'Cliente D', 'Cali', 'Reversado', '', '', '', ''],
    ['sale-adapter', daysAgo(95), 'ADAPT-HDMI', 'Salida', 6, 'operador', 'Eva', 'Cliente C', 'Cali', 'Confirmado', '', '', '', '']
  ]);

  const dashboard = response(context.getDashboard_(session));

  assert.deepEqual(JSON.parse(JSON.stringify(dashboard.data.entregasPorRegional)), [
    { regional: 'Cali', unidades: 10 },
    { regional: 'Bogota', unidades: 8 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(dashboard.data.accesoriosMasEntregados)), [
    { idArticulo: 'CARG-USB', accesorio: 'Cargador USB', unidades: 12 },
    { idArticulo: 'ADAPT-HDMI', accesorio: 'Adaptador HDMI', unidades: 6 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(dashboard.data.accesoriosMasEntregadosPorPeriodo)), {
    dias7: [{ idArticulo: 'CARG-USB', accesorio: 'Cargador USB', unidades: 5 }],
    dias30: [{ idArticulo: 'CARG-USB', accesorio: 'Cargador USB', unidades: 8 }],
    dias90: [{ idArticulo: 'CARG-USB', accesorio: 'Cargador USB', unidades: 12 }]
  });
});

test('monthly purchases count only confirmed Entrada movements and preserve supplier names', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'operador', rol: 'usuario' };
  const now = new Date();
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 5, 14).setValues([
    ['entry-alpha', now, 'CARG-USB', 'Entrada', 12, 'operador', '', 'CAPMOVIL', 'Bogota', 'Confirmado', '', '', '', ''],
    ['entry-beta', now, 'CARG-USB', 'Entrada', 7, 'operador', '', 'CAP', 'Bogota', 'Confirmado', '', '', '', ''],
    ['entry-legacy', now, 'CARG-USB', 'Entrada', 3, 'operador', '', '', 'Bogota', '', '', '', '', ''],
    ['entry-reversed', now, 'CARG-USB', 'Entrada', 40, 'operador', '', 'Proveedor Anulado', 'Bogota', 'Reversado', '', '', '', ''],
    ['positive-adjustment', now, 'CARG-USB', 'Ajuste positivo', 80, 'operador', '', 'Proveedor Ignorado', 'Bogota', 'Confirmado', '', '', '', '']
  ]);

  const dashboard = response(context.getDashboard_(session));
  const currentMonth = now.toISOString().slice(0, 7);
  const currentPurchases = dashboard.data.comprasPorMesProveedor.find(item => item.mes === currentMonth);

  assert.deepEqual(JSON.parse(JSON.stringify(currentPurchases.proveedores)), [
    { proveedor: 'CAPMOVIL', unidades: 19 },
    { proveedor: 'Sin proveedor', unidades: 3 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(dashboard.data.proveedoresCompras)), [
    { proveedor: 'CAPMOVIL', unidades: 19 },
    { proveedor: 'Sin proveedor', unidades: 3 }
  ]);
});

test('anular marks the original movement, creates no inverse, and is idempotent', () => {
    const { context, spreadsheet } = createRuntime();
    const session = { usuario: 'administrador', rol: 'admin' };
    const original = response(context.registerMovement_({
      tipoMovimiento: 'Entrada',
      proveedor: 'Proveedor A',
      claveIdempotencia: 'anular-source',
      items: [{ idArticulo: 'CARG-USB', cantidad: 6 }]
    }, session));
    const correction = response(context.annulMovement_({
      idTransaccion: original.idTransaccion,
      justificacion: 'Registro de prueba incorrecto'
    }, session));
    const retry = response(context.annulMovement_({
      idTransaccion: original.idTransaccion,
      justificacion: 'Registro de prueba incorrecto'
    }, session));
    const movementSheet = spreadsheet.getSheetByName('Registro de Movimientos');
    const history = response(context.getMovements_({}, session)).data;

    assert.equal(retry.duplicado, true);
    assert.equal(correction.anulada, true);
    assert.equal(correction.idTransaccionOriginal, original.idTransaccion);
    assert.equal(movementSheet.rows.length, 2);
    assert.equal(movementSheet.rows[1][9], 'Anulado');
    assert.equal(movementSheet.rows[1][10], '');
    assert.equal(movementSheet.rows[1][16], 'Registro de prueba incorrecto');
    assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
    assert.equal(history.length, 1);
    assert.equal(history[0].estado, 'Anulado');
    assert.equal(movementSheet.rows.length, 2);
    assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
});

test('movement and request reports can page through every record while keeping existing defaults', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'operador', rol: 'usuario' };
  const movementSheet = spreadsheet.getSheetByName('Registro de Movimientos');
  for (let index = 1; index <= 620; index++) {
    movementSheet.rows.push([
      `movement-${index}`, new Date(Date.UTC(2026, 0, index)), 'CARG-USB', 'Entrada', 1,
      'operador', '', 'Proveedor', 'Bogota', 'Confirmado', '', '', '', '', '', '', ''
    ]);
  }

  const movementFirstPage = response(context.getMovements_({}, session));
  const movementLastPage = response(context.getMovements_({ offset: 500, limite: 500 }, session));
  const defaultMovements = movementFirstPage.data;
  const olderMovements = movementLastPage.data;
  assert.equal(defaultMovements.length, 500);
  assert.equal(defaultMovements[0].idTransaccion, 'movement-620');
  assert.deepEqual(movementFirstPage.pagination, { offset: 0, limit: 500, total: 620, hasMore: true });
  assert.equal(olderMovements.length, 120);
  assert.equal(olderMovements[0].idTransaccion, 'movement-120');
  assert.equal(olderMovements.at(-1).idTransaccion, 'movement-1');
  assert.equal(movementLastPage.pagination.hasMore, false);
  assert.throws(() => context.getMovements_({ limite: 1001 }, session), /Paginacion invalida/);

  const requestSheet = context.requestSheet_();
  for (let index = 1; index <= 305; index++) {
    const row = Array(26).fill('');
    row[0] = `request-${index}`;
    row[1] = new Date(Date.UTC(2026, 0, index));
    row[2] = 'operador';
    row[3] = 'Cliente';
    row[4] = 'Bogota';
    row[5] = 'Ana';
    row[6] = 'CARG-USB';
    row[7] = 'Cargador USB';
    row[8] = 1;
    row[9] = 'Registrada';
    requestSheet.rows.push(row);
  }
  const requestFirstPage = response(context.getRequests_({}, session));
  const requestLastPage = response(context.getRequests_({ offset: 300, limite: 300 }, session));
  const defaultRequests = requestFirstPage.data;
  const olderRequests = requestLastPage.data;
  assert.equal(defaultRequests.length, 300);
  assert.equal(defaultRequests[0].idSolicitud, 'request-305');
  assert.deepEqual(requestFirstPage.pagination, { offset: 0, limit: 300, total: 305, hasMore: true });
  assert.equal(olderRequests.length, 5);
  assert.equal(olderRequests[0].idSolicitud, 'request-5');
  assert.equal(requestLastPage.pagination.hasMore, false);
});

test('request receipt adds stock and delivery removes it exactly once', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const requestItems = [{
    idArticulo: 'CARG-USB', cantidad: 32, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana'
  }];
  assert.throws(() => context.createRequest_({ correoSolicitante: 'correo-invalido', items: requestItems }, session), /correo del solicitante/);
  const created = response(context.createRequest_({ correoSolicitante: 'solicitante@example.com', items: requestItems }, session));
  const request = { idSolicitud: created.idSolicitud };
  const requestSheet = spreadsheet.getSheetByName('Solicitudes accesorios');
  assert.equal(requestSheet.rows[1][19], 25000);
  assert.equal(requestSheet.rows[1][20], 'solicitante@example.com');
  assert.equal(response(context.getRequests_({}, session)).data[0].correoSolicitante, 'solicitante@example.com');

  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
  context.updateRequestStatus_({ ...request, estado: 'Revisión de disponibilidad' }, session);
  assert.equal(response(context.checkRequestAvailability_({ idSolicitud: created.idSolicitud }, session)).disponible, false);
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session));
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Solicitada' }, session));
  context.updateAccessory_({ idArticulo: 'CARG-USB', costoUnitario: 30000 }, {
    usuario: 'catalog-editor', rol: 'usuario'
  });

  const catalog = response(context.getCatalog_(session));
  assert.equal(catalog.data[0].costoUnitario, 30000);
  context.updateRequestStatus_({
    ...request,
    estado: 'Solicitada',
    proveedor: 'Proveedor Uno'
  }, session);
  assert.equal(requestSheet.rows[1][19], 30000);
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), 1);

  requestSheet.rows[1][8] = -1;
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session), /cantidad invalida/i);
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), 1);
  requestSheet.rows[1][8] = 32;
  context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 32);
  const receiptCount = spreadsheet.getSheetByName('Registro de Movimientos').getLastRow();
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session));
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Anulada' }, session), /Solo un administrador/);
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), receiptCount);

  const adminSession = { usuario: 'administrador', rol: 'admin' };
  context.registerMovement_({
    tipoMovimiento: 'Salida',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }],
    distribution: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente B', regional: 'Bogota', usuario: 'Luis' }]
  }, adminSession);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 30);
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session), /Stock insuficiente/);

  context.registerMovement_({ tipoMovimiento: 'Entrada', proveedor: 'Proveedor alterno', items: [{ idArticulo: 'CARG-USB', cantidad: 2 }] }, adminSession);
  context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
  const deliveryCount = spreadsheet.getSheetByName('Registro de Movimientos').getLastRow();
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session));
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Anulada' }, session), /Solo un administrador/);
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), deliveryCount);

  const dashboard = response(context.getDashboard_(session));
  assert.equal(dashboard.data.unidades, 0);
  assert.equal(dashboard.data.solicitudesPendientes, 0);
  assert.equal(dashboard.data.solicitudesPorEstado.Entregada, 1);
  assert.equal(dashboard.data.comprasProveedorMes, 1);
  assert.equal(dashboard.data.comprasPromedioMensual, 0.2);
  assert.equal(dashboard.data.valorComprasMes, 960000);
  assert.equal(dashboard.data.lineasCompraConCostoMes, 1);
  assert.equal(dashboard.data.solicitudesEntregadasMes, 1);
  assert.equal(dashboard.data.tiempoPromedioEntregaHoras, 0);
});

test('linking a delivered request preserves the original Gmail URL for redirect', () => {
  const { context, spreadsheet } = createRuntime();
  context.Session.getEffectiveUser = () => ({ getEmail: () => 'teammate@example.com' });
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const threadUrl = 'https://mail.google.com/mail/u/0/#inbox/thread-123456789';
  assert.throws(() => context.createRequest_({
    gmailThreadUrl: 'https://example.com/thread-123456789',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana' }]
  }, session), /mail.google.com/);
  const created = response(context.createRequest_({
    items: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana' }]
  }, session));
  const requestSheet = spreadsheet.getSheetByName('Solicitudes accesorios');
  requestSheet.rows[1][9] = 'Entregada';
  context.linkRequestThread_({ idSolicitud: created.idSolicitud, gmailThreadUrl: threadUrl }, session);
  assert.equal(requestSheet.rows[1][22], threadUrl);
  assert.equal(requestSheet.rows[1][21], 'thread-123456789');
  assert.equal(response(context.getRequests_({}, session)).data[0].gmailThreadUrl, threadUrl);
});

test('availability review validates client stock and dispatches directly when available', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');
  inventory.rows[1][3] = 5;
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const created = response(context.createRequest_({
    regional: 'Bogota',
    entregadoA: 'Ana',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente A' }]
  }, session));
  const requestSheet = spreadsheet.getSheetByName('Solicitudes accesorios');

  context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Revisión de disponibilidad'
  }, session);
  assert.equal(typeof requestSheet.rows[1][23].getTime, 'function');
  const availability = response(context.checkRequestAvailability_({ idSolicitud: created.idSolicitud }, session));
  assert.equal(availability.disponible, true);
  assert.throws(() => context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Solicitada',
    proveedor: 'Proveedor'
  }, session), /disponibilidad suficiente/i);
  const dispatched = response(context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Entregada'
  }, session));
  assert.equal(dispatched.estado, 'Entregada');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 3);
  const movements = spreadsheet.getSheetByName('Registro de Movimientos').rows;
  assert.equal(movements[1][3], 'Salida');
  assert.equal(movements[1][4], 2);
  assert.equal(movements[1][7], 'Cliente A');
});

test('Communications requests go directly to supplier and close on receipt', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const created = response(context.createRequest_({
    tipoSolicitud: 'Comunicaciones',
    correoSolicitante: 'ignored@example.com',
    gmailThreadUrl: 'https://mail.google.com/mail/u/0/#inbox/thread-123456789',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }]
  }, session));

  assert.equal(spreadsheet.getSheetByName('Solicitudes accesorios').rows[1][4], 'Comunicaciones');
  assert.throws(() => context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Revisión de disponibilidad'
  }, session), /Transicion invalida/);
  assert.throws(() => context.checkRequestAvailability_({ idSolicitud: created.idSolicitud   }, session), /Comunicaciones.*proveedor y recepci[oó]n/i);
  context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Solicitada',
    proveedor: 'Proveedor'
  }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);

  const request = response(context.getRequests_({}, session)).data[0];
  assert.equal(request.tipoSolicitud, 'Comunicaciones');
  assert.equal(request.correoSolicitante, '');
  assert.equal(request.gmailThreadUrl, '');
  assert.equal(request.items[0].cliente, 'Comunicaciones');
  assert.equal(request.items[0].entregadoA, 'Comunicaciones');
  assert.throws(() => context.linkRequestThread_({
    idSolicitud: created.idSolicitud,
    gmailThreadUrl: 'https://mail.google.com/mail/u/0/#inbox/thread-abcdef123'
  }, session), /correo nuevo/i);

  const closed = response(context.updateRequestStatus_({
    idSolicitud: created.idSolicitud,
    estado: 'Cerrada'
  }, session));
  assert.equal(closed.estado, 'Cerrada');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 2);
  const movements = spreadsheet.getSheetByName('Registro de Movimientos').rows;
  assert.equal(movements[1][3], 'Entrada');
  assert.equal(movements[1][4], 2);
  assert.equal(movements[1][7], 'Proveedor');
  assert.equal(movements[1][8], 'Comunicaciones');
  assert.equal(response(context.getDashboard_(session)).data.solicitudesPendientes, 0);
});

test('request schema adds email and Gmail thread columns without shifting existing data', () => {
  const { context, spreadsheet } = createRuntime();
  const oldHeaders = context.CONFIG.requestHeaders.slice(0, 20);
  const oldRow = ['legacy-request', new Date(), 'operador', 'Cliente A', 'Bogota', 'Ana', 'CARG-USB', 'Cargador USB', 1,
    'Entregada', '', '', '', new Date(), '', '', '', 'operador', new Date(), 25000];
  const sheet = spreadsheet.insertSheet('Solicitudes accesorios');
  sheet.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  sheet.getRange(2, 1, 1, oldRow.length).setValues([oldRow]);

  context.requestSheet_();

  assert.equal(sheet.rows[0][20], 'Correo_Solicitante');
  assert.equal(sheet.rows[0][21], 'Gmail_Thread_ID');
  assert.equal(sheet.rows[0][22], 'Gmail_Thread_URL');
  assert.equal(sheet.rows[0][23], 'Fecha_Revision_Disponibilidad');
  assert.equal(sheet.rows[0][24], 'Justificacion_Anulacion');
  assert.equal(sheet.rows[0][25], 'Tipo_Solicitud');
  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows[1].slice(0, 20))), JSON.parse(JSON.stringify(oldRow)));
});

test('request response summarizes accessory quantities across separate lines', () => {
  const { context } = createRuntime();
  const session = { usuario: 'solicitante', rol: 'usuario' };
  assert.throws(() => context.createRequest_({ items: [
    { idArticulo: 'CARG-USB', cantidad: 1, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana' },
    { idArticulo: 'CARG-USB', cantidad: 1, cliente: 'Cliente B', regional: 'Cali', entregadoA: 'Ana' }
  ] }, session), /regional/i);
  const created = response(context.createRequest_({ items: [
    { idArticulo: 'CARG-USB', cantidad: 7, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana' },
    { idArticulo: 'CARG-USB', cantidad: 5, cliente: 'Cliente B', regional: 'Bogota', entregadoA: 'Ana' },
    { idArticulo: 'CARG-USB', cantidad: 3, cliente: 'Cliente C', regional: 'Bogota', entregadoA: 'Ana' }
  ] }, session));
  const requests = response(context.getRequests_({}, session));

  assert.equal(requests.data.length, 1);
  assert.equal(requests.data[0].items.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.data[0].resumenAccesorios)), [
    { nombre: 'Cargador USB', cantidad: 15 }
  ]);
});

test('registered or ordered requests can be annulled before receipt without inventory movements', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'administrador', rol: 'admin' };
  const registered = response(context.createRequest_({ items: [{
    idArticulo: 'CARG-USB', cantidad: 3, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana'
  }] }, session));
  const requestSheet = spreadsheet.getSheetByName('Solicitudes accesorios');
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');

  assert.throws(() => context.updateRequestStatus_({
    idSolicitud: registered.idSolicitud, estado: 'Anulada', justificacion: 'Motivo'
  }, { usuario: 'operador', rol: 'usuario' }), /Solo un administrador/);
  const cancelled = response(context.updateRequestStatus_({
    idSolicitud: registered.idSolicitud, estado: 'Anulada', justificacion: 'Solicitud duplicada'
  }, session));
  assert.equal(cancelled.estado, 'Anulada');
  assert.equal(requestSheet.rows[1][9], 'Anulada');
  assert.equal(requestSheet.rows[1][17], 'administrador');
  assert.equal(requestSheet.rows[1][24], 'Solicitud duplicada');
  assert.equal(movements.getLastRow(), 1);
  assert.throws(() => context.updateRequestStatus_({
    idSolicitud: registered.idSolicitud, estado: 'Solicitada', proveedor: 'Proveedor'
  }, session), /Transicion invalida/);

  const ordered = response(context.createRequest_({ items: [{
    idArticulo: 'CARG-USB', cantidad: 1, cliente: 'Cliente B', regional: 'Bogota', entregadoA: 'Luis'
  }] }, session));
  context.updateRequestStatus_({
    idSolicitud: ordered.idSolicitud, estado: 'Revisión de disponibilidad'
  }, session);
  context.updateRequestStatus_({
    idSolicitud: ordered.idSolicitud, estado: 'Solicitada', proveedor: 'Proveedor'
  }, session);
  context.updateRequestStatus_({ idSolicitud: ordered.idSolicitud, estado: 'Anulada', justificacion: 'Compra ya no requerida' }, session);

  const dashboard = response(context.getDashboard_(session));
  assert.equal(dashboard.data.solicitudesPorEstado.Anulada, 2);
  assert.equal(dashboard.data.solicitudesPendientes, 0);
  assert.equal(dashboard.data.comprasProveedorMes, 0);
  assert.equal(dashboard.data.valorComprasMes, null);
  assert.equal(movements.getLastRow(), 1);
});

test('AI extraction requests JSON and maps an email request to inventory exactly once', () => {
  const { context, spreadsheet } = createRuntime();
  const getRequest = mockAi(context, {
    articulo: 'CARG-USB',
    cliente: 'Cliente de correo',
    regional: 'Bogota',
    entregado_a: 'Ana Perez',
    cantidad: 2
  });
  const extracted = context.extractInventoryRequest_('Solicito dos cargadores para Ana.');
  assert.equal(getRequest().url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(getRequest().options.headers['x-goog-api-key'], 'test-key');
  const payload = JSON.parse(getRequest().options.payload);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.match(payload.systemInstruction.parts[0].text, /sin Markdown/);
  assert.match(payload.systemInstruction.parts[0].text, /SKU exacto/);
  assert.match(payload.contents[0].parts[0].text, /Correo a procesar/);
  assert.match(payload.contents[0].parts[0].text, /CARG-USB/);

  const requestId = context.insertEmailRequest_(extracted, 'gmail-message-1');
  const sheet = spreadsheet.getSheetByName('Solicitudes accesorios');
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1][0], requestId);
  assert.equal(sheet.rows[1][2], 'Correo automatico');
  assert.equal(sheet.rows[1][6], 'CARG-USB');
  assert.equal(sheet.rows[1][8], 2);
  assert.equal(sheet.rows[1][9], 'Registrada');
  assert.match(sheet.rows[1][16], /generada automaticamente desde correo/);
  assert.equal(context.insertEmailRequest_(extracted, 'gmail-message-1'), requestId);
  assert.throws(
    () => context.insertEmailRequest_([], 'empty-result'),
    /Gemini no identifico articulos/
  );
  assert.equal(sheet.rows.length, 2);
});

test('email processing isolates invalid messages and labels them for review', () => {
  const { context, spreadsheet } = createRuntime();
  const goodMessage = {
    isUnread: () => true,
    getId: () => 'good-message',
    getPlainBody: () => 'Solicito cargador para Ana',
    markRead() { this.read = true; }
  };
  const invalidMessage = {
    isUnread: () => true,
    getId: () => 'invalid-message',
    getPlainBody: () => 'Mensaje sin articulo en catalogo',
    markRead() { this.read = true; }
  };
  const thread = {
    getMessages: () => [goodMessage, invalidMessage],
    addLabel(label) { this.label = label; }
  };
  const extractedByBody = {
    'Solicito cargador para Ana': {
      articulo: 'CARG-USB', cliente: 'Cliente A', regional: 'Bogota',
      entregado_a: 'Ana', cantidad: 1
    },
    'Mensaje sin articulo en catalogo': {
      articulo: 'Articulo desconocido', cliente: 'Cliente A', regional: 'Bogota',
      entregado_a: 'Ana', cantidad: 1
    }
  };
  context.UrlFetchApp = {
    fetch(_url, options) {
      const prompt = JSON.parse(options.payload).contents[0].parts[0].text;
      const body = Object.keys(extractedByBody).find(text => prompt.endsWith(text));
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(extractedByBody[body]) }] } }]
        })
      };
    }
  };
  let createdLabel = '';
  let searchArguments;
  context.GmailApp = {
    search(...args) { searchArguments = args; return [thread]; },
    getUserLabelByName: () => null,
    createLabel(name) { createdLabel = name; return { name }; }
  };

  const result = context.procesarCorreosInventario();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    hilosEncontrados: 1,
    correosRevisados: 2,
    correosSinProcesar: 0,
    procesados: 1,
    errores: 1,
    reintentosPendientes: 0,
    lecturaDetenida: false,
    detalleErrores: [{
      id: 'invalid-message',
      mensaje: 'Articulo inexistente o inactivo en el inventario: Articulo desconocido',
      reintentoPendiente: false,
      errorServicio: false,
      etiquetadoParaRevision: true
    }]
  });
  assert.equal(goodMessage.read, true);
  assert.equal(invalidMessage.read, true);
  assert.equal(createdLabel, 'Inventario/Error de procesamiento');
  assert.equal(thread.label.name, createdLabel);
  assert.equal(spreadsheet.getSheetByName('Solicitudes accesorios').rows.length, 2);
  assert.deepEqual(searchArguments, ['in:inbox is:unread', 0, 50]);
});

test('mail worker refuses to scan when executed by an account other than the dedicated mailbox', () => {
  const { context } = createRuntime();
  context.Session.getEffectiveUser = () => ({ getEmail: () => 'owner@example.com' });
  let searched = false;
  context.GmailApp = { search() { searched = true; return []; } };

  assert.throws(
    () => context.procesarCorreosInventario(),
    /debe ejecutarse como sol\.comunicaciones\.g4s@gmail\.com/
  );
  assert.equal(searched, false);
});

test('temporary Gemini 503 retries and leaves email unread until a later run succeeds', () => {
  const { context, spreadsheet } = createRuntime();
  let unread = true;
  const message = {
    isUnread: () => unread,
    getId: () => 'temporary-outage-message',
    getPlainBody: () => 'Solicito cargador para Ana',
    markRead() { unread = false; }
  };
  const thread = { getMessages: () => [message], addLabel() { throw new Error('Should not label transient failures'); } };
  context.GmailApp = { search: () => [thread] };
  let fetchCalls = 0;
  context.UrlFetchApp = {
    fetch() {
      fetchCalls++;
      if (fetchCalls <= 3) {
        return {
          getResponseCode: () => 503,
          getContentText: () => '{"error":{"message":"temporary overload"}}'
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                    articulo: 'CARG-USB', cliente: 'Cliente A', regional: 'Bogota',
                  entregado_a: 'Ana', cantidad: 1
                })
              }]
            }
          }]
        })
      };
    }
  };

  const failedRun = context.procesarCorreosInventario();
  const failedResult = JSON.parse(JSON.stringify(failedRun));
  assert.equal(failedResult.hilosEncontrados, 1);
  assert.equal(failedResult.correosRevisados, 1);
  assert.equal(failedResult.procesados, 0);
  assert.equal(failedResult.errores, 1);
  assert.equal(failedResult.reintentosPendientes, 1);
  assert.equal(failedResult.lecturaDetenida, false);
  assert.equal(failedResult.detalleErrores[0].id, 'temporary-outage-message');
  assert.match(failedResult.detalleErrores[0].mensaje, /HTTP 503/);
  assert.equal(failedResult.detalleErrores[0].reintentoPendiente, true);
  assert.equal(failedResult.detalleErrores[0].errorServicio, false);
  assert.equal(unread, true);
  assert.equal(fetchCalls, 3);
  assert.equal(spreadsheet.getSheetByName('Solicitudes accesorios'), null);

  const successfulRun = context.procesarCorreosInventario();
  assert.deepEqual(JSON.parse(JSON.stringify(successfulRun)), {
    hilosEncontrados: 1,
    correosRevisados: 1,
    correosSinProcesar: 0,
    procesados: 1,
    errores: 0,
    reintentosPendientes: 0,
    lecturaDetenida: false,
    detalleErrores: []
  });
  assert.equal(unread, false);
  assert.equal(spreadsheet.getSheetByName('Solicitudes accesorios').rows.length, 2);
});

test('Gemini quota 429 observes retry time and does not spend quota again before reset', () => {
  const { context } = createRuntime();
  let unread = true;
  const message = {
    isUnread: () => unread,
    getId: () => 'quota-message',
    getPlainBody: () => 'Solicitud de inventario',
    markRead() { unread = false; }
  };
  const thread = {
    getMessages: () => [message],
    addLabel() { throw new Error('Quota errors should remain unread for retry'); }
  };
  context.GmailApp = { search: () => [thread] };
  let fetchCalls = 0;
  context.UrlFetchApp = {
    fetch() {
      fetchCalls++;
      return {
        getResponseCode: () => 429,
        getContentText: () => JSON.stringify({
          error: {
            message: 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests. Please retry in 21h30m35.2s.',
            status: 'RESOURCE_EXHAUSTED'
          }
        })
      };
    }
  };

  const firstRun = context.procesarCorreosInventario();
  const firstResult = JSON.parse(JSON.stringify(firstRun));
  assert.equal(firstResult.correosRevisados, 1);
  assert.equal(firstResult.errores, 1);
  assert.equal(firstResult.reintentosPendientes, 1);
  assert.equal(firstResult.lecturaDetenida, false);
  assert.match(firstResult.detalleErrores[0].mensaje, /HTTP 429/);
  assert.equal(firstResult.detalleErrores[0].errorServicio, false);
  assert.equal(fetchCalls, 1);
  assert.equal(unread, true);

  const secondRun = context.procesarCorreosInventario();
  const secondResult = JSON.parse(JSON.stringify(secondRun));
  assert.equal(secondResult.correosRevisados, 1);
  assert.equal(secondResult.errores, 1);
  assert.equal(secondResult.reintentosPendientes, 1);
  assert.equal(secondResult.lecturaDetenida, false);
  assert.match(secondResult.detalleErrores[0].mensaje, /Gemini alcanzo la cuota/);
  assert.equal(secondResult.detalleErrores[0].errorServicio, false);
  assert.equal(fetchCalls, 1);
  assert.equal(unread, true);
});

test('email worker reports zero unread emails explicitly', () => {
  const { context } = createRuntime();
  context.GmailApp = { search: () => [] };

  assert.deepEqual(JSON.parse(JSON.stringify(context.procesarCorreosInventario())), {
    hilosEncontrados: 0,
    correosRevisados: 0,
    correosSinProcesar: 0,
    procesados: 0,
    errores: 0,
    reintentosPendientes: 0,
    lecturaDetenida: false,
    detalleErrores: []
  });
});

test('Gemini permission denial stops the batch and leaves all affected emails unread', () => {
  const { context } = createRuntime();
  let firstUnread = true;
  let secondUnread = true;
  let fetchCalls = 0;
  let labelsCreated = 0;
  const firstMessage = {
    isUnread: () => firstUnread,
    getId: () => 'permission-denied-first',
    getPlainBody: () => 'Solicitud uno',
    markRead() { firstUnread = false; }
  };
  const secondMessage = {
    isUnread: () => secondUnread,
    getId: () => 'permission-denied-second',
    getPlainBody: () => 'Solicitud dos',
    markRead() { secondUnread = false; }
  };
  const threads = [
    { getMessages: () => [firstMessage], addLabel() { assert.fail('Service errors must not label mail'); } },
    { getMessages: () => [secondMessage], addLabel() { assert.fail('Skipped mail must not be labeled'); } }
  ];
  context.GmailApp = {
    search: () => threads,
    getUserLabelByName: () => null,
    createLabel() { labelsCreated++; }
  };
  context.UrlFetchApp = {
    fetch() {
      fetchCalls++;
      return {
        getResponseCode: () => 403,
        getContentText: () => '{"error":{"message":"Your project has been denied access.","status":"PERMISSION_DENIED"}}'
      };
    }
  };

  const result = JSON.parse(JSON.stringify(context.procesarCorreosInventario()));
  assert.equal(result.correosRevisados, 1);
  assert.equal(result.correosSinProcesar, 1);
  assert.equal(result.errores, 1);
  assert.equal(result.reintentosPendientes, 1);
  assert.equal(result.lecturaDetenida, true);
  assert.equal(result.detalleErrores[0].errorServicio, true);
  assert.equal(result.detalleErrores[0].reintentoPendiente, true);
  assert.equal(fetchCalls, 1);
  assert.equal(labelsCreated, 0);
  assert.equal(firstUnread, true);
  assert.equal(secondUnread, true);
});

test('email worker configuration removes old triggers without creating new ones', () => {
  const { context } = createRuntime();
  const removed = [];
  const oldTrigger = { getHandlerFunction: () => 'procesarCorreosInventario' };
  const unrelatedTrigger = { getHandlerFunction: () => 'otraTarea' };
  context.ScriptApp = {
    getProjectTriggers: () => [oldTrigger, unrelatedTrigger],
    deleteTrigger: trigger => removed.push(trigger),
    newTrigger() { assert.fail('Manual-only setup must not create a trigger'); }
  };

  const result = context.configurarProcesamientoCorreos();
  assert.deepEqual(removed, [oldTrigger]);
  assert.match(result, /desactivado/);
  assert.match(result, /1$/);
});

test('manual email processing is restricted to admins and returns worker counts', () => {
  const { context } = createRuntime();
  let runs = 0;
  context.procesarCorreosInventario = () => {
    runs++;
    return { procesados: 2, errores: 1, reintentosPendientes: 1 };
  };

  assert.throws(
    () => context.processEmailRequests_({ usuario: 'operador', rol: 'usuario' }),
    /Solo un administrador/
  );
  assert.equal(runs, 0);

  const result = response(context.processEmailRequests_({ usuario: 'administrador', rol: 'admin' }));
  assert.deepEqual(result, {
    status: 'success',
    data: { procesados: 2, errores: 1, reintentosPendientes: 1 }
  });
  assert.equal(runs, 1);
});

test('catalog write permissions are enforced for selected users on the server', () => {
  const { context } = createRuntime();
  const selected = { usuario: 'catalog-editor', rol: 'usuario' };
  const unselected = { usuario: 'operador', rol: 'usuario' };

  assert.equal(context.permissions_(selected).canManageCatalog, true);
  assert.equal(context.permissions_(unselected).canManageCatalog, false);
  assert.throws(() => context.createAccessory_({ idArticulo: 'CBL-1', descripcion: 'Cable', stockMinimo: 2 }, unselected), /permiso/i);
  assert.equal(response(context.createAccessory_({ idArticulo: 'CBL-1', descripcion: 'Cable', stockMinimo: 2, costoUnitario: 4500 }, selected)).status, 'success');
  assert.equal(context.inventorySheet_().getRange(3, 11).getValue(), 4500);
  assert.throws(() => context.updateAccessory_({ idArticulo: 'CBL-1', descripcion: 'Nuevo nombre' }, unselected), /permiso/i);
  assert.throws(() => context.updateAccessory_({ idArticulo: 'CBL-1', stockMinimo: -1 }, selected), /stock minimo invalido/i);
  assert.ok(context.inventorySheet_().validations.some(validation =>
    validation.column === 4 && validation.rule.minimum === 0 && validation.rule.allowInvalid === false));
  assert.ok(context.inventorySheet_().validations.some(validation =>
    validation.column === 8 && validation.rule.minimum === 0 && validation.rule.allowInvalid === false));
});

test('request quantity column rejects negative values in the spreadsheet', () => {
  const { context, spreadsheet } = createRuntime();

  context.requestSheet_();

  const requests = spreadsheet.getSheetByName(context.CONFIG.requestsSheet);
  assert.ok(requests.validations.some(validation =>
    validation.column === 9 && validation.rule.minimum === 1 && validation.rule.allowInvalid === false));
});

test('catalog initializes the cost column without overwriting existing inventory fields', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');
  inventory.rows[0] = inventory.rows[0].slice(0, 10);
  inventory.rows[1] = inventory.rows[1].slice(0, 10);

  const catalog = response(context.getCatalog_({ usuario: 'consulta', rol: 'usuario' }));
  assert.equal(inventory.getRange(1, 11).getValue(), 'Costo_Unitario_COP');
  assert.equal(catalog.data[0].costoUnitario, 0);
  assert.equal(inventory.getRange(1, 10).getValue(), 'Activo');
});

test('outgoing movements use the ledger when the inventory formula is stale', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Inventario accesorios');
  inventory.rows[1][3] = 3;
  inventory.formulaOverrides = { '2:7': 3 };
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 1, 14).setValues([[
    'previous-sale', new Date(), 'CARG-USB', 'Salida', 2, 'operador', 'Ana', 'Cliente A',
    'Bogota', 'Confirmado', '', '', '', ''
  ]]);

  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 3);
  assert.throws(() => context.registerMovement_({
    tipoMovimiento: 'Salida',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }],
    distribution: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente B', regional: 'Bogota', usuario: 'Luis' }]
  }, { usuario: 'administrador', rol: 'admin' }), /Disponible según movimientos: 1/);
  assert.equal(movements.getLastRow(), 2);
});

test('inventory audit identifies the transaction that first made a SKU negative', () => {
  const { context, spreadsheet } = createRuntime();
  const movements = spreadsheet.getSheetByName('Registro de Movimientos');
  movements.getRange(2, 1, 1, 14).setValues([[
    'bad-sale', new Date(), 'CARG-USB', 'Salida', 1, 'operador', 'Ana', 'Cliente A',
    'Bogota', 'Confirmado', '', '', '', ''
  ]]);

  const audit = response(context.auditInventory_({ usuario: 'auditor', rol: 'usuario' }));
  assert.equal(audit.data.inconsistencias.length, 1);
  assert.equal(audit.data.inconsistencias[0].stockSegunMovimientos, -1);
  assert.equal(audit.data.inconsistencias[0].primerMovimientoNegativo.idTransaccion, 'bad-sale');
  assert.equal(audit.data.inconsistencias[0].primerMovimientoNegativo.saldoDespues, -1);
});

test('returned phones register by IMEI and retain state transition history', () => {
  const { context, spreadsheet, sessionEntries } = createRuntime();
  const token = 'equipment-session-token';
  const session = JSON.stringify({ usuario: 'operador', rol: 'usuario' });
  sessionEntries.set(context.sessionKey_(token), session);
  const post = payload => response(context.doPost({
    postData: { contents: JSON.stringify({ ...payload, token }) }
  }));

  const created = post({
    action: 'registrar_equipo',
    fechaRecepcion: '2026-10-23',
    modelo: 'MOTO G23',
    imei: '354696572315130',
    ubicacionSam: 'BODEGA COMUNICACIONES',
    danoReparacion: 'BUEN ESTADO',
    estado: 'Disponible'
  });
  assert.equal(created.status, 'success');
  assert.equal(created.data.modelo, 'MOTO G23');
  assert.equal(created.data.fechaRecepcion, '2026-10-23');
  assert.equal(created.data.imei, '354696572315130');
  assert.equal(created.data.ubicacionSam, 'BODEGA COMUNICACIONES');
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), 1);

  const duplicate = post({
    action: 'registrar_equipo', fechaRecepcion: '2026-10-23', modelo: 'MOTO G23',
    imei: '354696572315130', danoReparacion: 'BUEN ESTADO'
  });
  assert.match(duplicate.message, /IMEI/i);

  assert.equal(post({
    action: 'actualizar_estado_equipo', id: created.data.id, estado: 'Enviados CAP'
  }).status, 'success');
  const savedEquipment = post({ action: 'obtener_equipos' }).data[0];
  assert.equal(savedEquipment.estado, 'Enviados CAP');
  assert.equal(savedEquipment.fechaRecepcion, '23/10/2026');
  assert.equal(savedEquipment.ubicacionSam, 'BODEGA COMUNICACIONES');
  const history = spreadsheet.getSheetByName(context.CONFIG.equipmentHistorySheet);
  assert.equal(history.getLastRow(), 3);
  assert.equal(history.getRange(3, 6).getValue(), 'Disponible');
  assert.equal(history.getRange(3, 7).getValue(), 'Enviados CAP');
});

test('cellphone batch registration writes multiple unique IMEIs in one request', () => {
  const { context, spreadsheet, sessionEntries } = createRuntime();
  const token = 'phone-batch-session';
  sessionEntries.set(context.sessionKey_(token), JSON.stringify({ usuario: 'operador', rol: 'usuario' }));
  const post = payload => response(context.doPost({
    postData: { contents: JSON.stringify({ ...payload, token }) }
  }));
  const items = [
    { fechaRecepcion: '2026-10-30', modelo: 'MOTO G23', imei: '111111111111111', ubicacionSam: 'BODEGA', danoReparacion: 'BUEN ESTADO', estado: 'Disponible' },
    { fechaRecepcion: '2026-10-30', modelo: 'MOTO G24', imei: '222222222222222', ubicacionSam: 'PUESTO 4', danoReparacion: 'PANTALLA ROTA', estado: 'Dañado' }
  ];

  const result = post({ action: 'registrar_equipos_lote', items });
  assert.equal(result.status, 'success');
  assert.equal(result.count, 2);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.equipmentSheet).getLastRow(), 3);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.equipmentHistorySheet).getLastRow(), 3);
  assert.equal(post({ action: 'registrar_equipos_lote', items }).status, 'error');
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.equipmentSheet).getLastRow(), 3);
});

test('bulk cellphone status change records a separate KPI trace for each selected device', () => {
  const { context, spreadsheet, sessionEntries } = createRuntime();
  const token = 'phone-bulk-state-session';
  sessionEntries.set(context.sessionKey_(token), JSON.stringify({ usuario: 'operador', rol: 'usuario' }));
  const post = payload => response(context.doPost({
    postData: { contents: JSON.stringify({ ...payload, token }) }
  }));
  const created = post({
    action: 'registrar_equipos_lote',
    items: [
      { fechaRecepcion: '2026-10-30', modelo: 'MOTO G23', imei: '111111111111111', danoReparacion: 'BUEN ESTADO', estado: 'Disponible' },
      { fechaRecepcion: '2026-10-30', modelo: 'MOTO G24', imei: '222222222222222', danoReparacion: 'BUEN ESTADO', estado: 'Disponible' }
    ]
  });

  const changed = post({ action: 'actualizar_estados_equipos', ids: created.ids, estado: 'Enviados CAP' });
  assert.equal(changed.status, 'success');
  assert.equal(changed.updated, 2);
  assert.deepEqual(post({ action: 'obtener_equipos' }).data.map(item => item.estado), ['Enviados CAP', 'Enviados CAP']);
  const history = spreadsheet.getSheetByName(context.CONFIG.equipmentHistorySheet);
  assert.equal(history.getLastRow(), 5);
  assert.equal(history.getRange(4, 6).getValue(), 'Disponible');
  assert.equal(history.getRange(4, 7).getValue(), 'Enviados CAP');
  assert.equal(history.getRange(5, 6).getValue(), 'Disponible');
  assert.equal(history.getRange(5, 7).getValue(), 'Enviados CAP');
});

test('equipment sheet initializer creates sheets, preserves rows, and installs one daily archive trigger', () => {
  const { context, spreadsheet, scheduledTriggers } = createRuntime();

  assert.match(context.inicializarHojasEquipos(), /inicializadas/);
  const equipment = spreadsheet.getSheetByName(context.CONFIG.equipmentSheet);
  const history = spreadsheet.getSheetByName(context.CONFIG.equipmentHistorySheet);
  assert.deepEqual(Array.from(equipment.getRange(1, 1, 1, context.CONFIG.equipmentHeaders.length).getValues()[0]), Array.from(context.CONFIG.equipmentHeaders));
  assert.deepEqual(Array.from(history.getRange(1, 1, 1, context.CONFIG.equipmentHistoryHeaders.length).getValues()[0]), Array.from(context.CONFIG.equipmentHistoryHeaders));

  equipment.getRange(2, 1).setValue('existing-equipment');
  context.inicializarHojasEquipos();
  assert.equal(equipment.getRange(2, 1).getValue(), 'existing-equipment');
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.equipmentArchiveSheet).getRange(1, 1).getValue(), 'ID_Equipo');
  assert.equal(scheduledTriggers.length, 1);
  assert.equal(scheduledTriggers[0].getHandlerFunction(), 'archivarEquiposDisposicionFinal');
});

test('existing equipment sheet gains SAM location column without changing stored rows', () => {
  const { context, spreadsheet } = createRuntime();
  const equipment = spreadsheet.insertSheet(context.CONFIG.equipmentSheet);
  const oldHeaders = Array.from(context.CONFIG.equipmentHeaders).slice(0, 10);
  oldHeaders[3] = 'Serial';
  equipment.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  equipment.getRange(2, 1, 1, oldHeaders.length).setValues([[
    'existing-id', '2026-10-23', 'MOTO G23', '', 'BUEN ESTADO', 'Bodega Comunicaciones',
    'operador', new Date(), 'operador', '354696572315130'
  ]]);

  context.equipmentSheet_();

  assert.equal(equipment.getRange(1, 4).getValue(), 'Dato legado');
  assert.equal(equipment.hiddenColumns.has(4), true);
  assert.equal(equipment.getRange(1, 11).getValue(), 'Ubicacion_SAM');
  assert.equal(equipment.getRange(2, 1).getValue(), 'existing-id');
  assert.equal(equipment.getRange(2, 10).getValue(), '354696572315130');
});

test('manual cellphone deletion is admin-only and keeps an archive copy', () => {
  const { context, spreadsheet, sessionEntries } = createRuntime();
  const equipment = context.equipmentSheet_();
  equipment.getRange(2, 1, 1, context.CONFIG.equipmentHeaders.length).setValues([[
    'phone-delete-1', '2026-10-23', 'MOTO G23', '', 'BUEN ESTADO', 'Bodega Comunicaciones',
    'operador', new Date(), 'operador', '354696572315130', 'BODEGA'
  ]]);
  const operatorToken = 'phone-delete-operator';
  const adminToken = 'phone-delete-admin';
  sessionEntries.set(context.sessionKey_(operatorToken), JSON.stringify({ usuario: 'operador', rol: 'usuario' }));
  sessionEntries.set(context.sessionKey_(adminToken), JSON.stringify({ usuario: 'admin', rol: 'admin' }));
  const post = (token, payload) => response(context.doPost({
    postData: { contents: JSON.stringify({ ...payload, token }) }
  }));

  assert.match(post(operatorToken, { action: 'eliminar_equipo', id: 'phone-delete-1' }).message, /administrador/i);
  assert.equal(post(adminToken, { action: 'eliminar_equipo', id: 'phone-delete-1' }).status, 'success');
  assert.equal(equipment.getLastRow(), 1);
  const archive = spreadsheet.getSheetByName(context.CONFIG.equipmentArchiveSheet);
  assert.equal(archive.getRange(2, 1).getValue(), 'phone-delete-1');
  assert.equal(archive.getRange(2, 13).getValue(), 'Eliminación manual');
});

test('existing cellphone archive migrates the Serial header and preserves its data', () => {
  const { context, spreadsheet } = createRuntime();
  const archive = spreadsheet.insertSheet(context.CONFIG.equipmentArchiveSheet);
  const oldHeaders = Array.from(context.CONFIG.equipmentArchiveHeaders);
  oldHeaders[3] = 'Serial';
  archive.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  const oldRow = Array(oldHeaders.length).fill('');
  oldRow[0] = 'archived-phone';
  oldRow[3] = 'legacy-serial-value';
  archive.getRange(2, 1, 1, oldRow.length).setValues([oldRow]);

  context.inicializarHojasEquipos();

  assert.equal(archive.getRange(1, 4).getValue(), 'Dato legado');
  assert.equal(archive.getRange(2, 4).getValue(), 'legacy-serial-value');
  assert.equal(archive.hiddenColumns.has(4), true);
});

test('disposal rows are archived after 30 days but remain active before the cutoff', () => {
  const { context, spreadsheet } = createRuntime();
  const equipment = context.equipmentSheet_();
  const now = new Date();
  const row = (id, ageDays) => [
    id, '2026-09-01', 'MOTO G23', '', 'Daño', 'Disposición final', 'operador',
    new Date(now.getTime() - ageDays * 86400000), 'operador', `1234567890123${id.endsWith('old') ? '01' : '02'}`, 'BODEGA'
  ];
  equipment.getRange(2, 1, 2, context.CONFIG.equipmentHeaders.length).setValues([
    row('phone-old', 31), row('phone-recent', 29)
  ]);

  assert.equal(context.archivarEquiposDisposicionFinal(), 1);
  assert.equal(equipment.getLastRow(), 2);
  assert.equal(equipment.getRange(2, 1).getValue(), 'phone-recent');
  const archive = spreadsheet.getSheetByName(context.CONFIG.equipmentArchiveSheet);
  assert.equal(archive.getRange(2, 1).getValue(), 'phone-old');
  assert.equal(archive.getRange(2, 13).getValue(), 'Disposición final por más de 30 días');
});

test('cellphone dashboard measures CAPMOVIL and warranty return durations separately from stock', () => {
  const { context, spreadsheet } = createRuntime();
  const equipment = context.equipmentSheet_();
  const history = context.equipmentHistorySheet_();
  const now = new Date('2026-10-30T12:00:00Z');
  equipment.getRange(2, 1, 2, context.CONFIG.equipmentHeaders.length).setValues([
    ['phone-returned', '2026-10-10', 'MOTO G22', '', 'BUEN ESTADO', 'Bodega Comunicaciones', 'op', now, 'op', '123456789012345', 'BODEGA'],
    ['phone-warranty', '2026-10-25', 'MOTO G24', '', 'Revisión', 'Garantía', 'op', new Date('2026-10-25T12:00:00Z'), 'op', '543210987654321', 'TALLER']
  ]);
  history.getRange(2, 1, 3, context.CONFIG.equipmentHistoryHeaders.length).setValues([
    ['event-1', new Date('2026-10-20T12:00:00Z'), 'phone-returned', '', 'MOTO G22', 'Bodega Comunicaciones', 'Enviado a CAPMOVIL (reparación)', 'op'],
    ['event-2', new Date('2026-10-24T12:00:00Z'), 'phone-returned', '', 'MOTO G22', 'Enviado a CAPMOVIL (reparación)', 'Bodega Comunicaciones', 'op'],
    ['event-3', new Date('2026-10-25T12:00:00Z'), 'phone-warranty', '', 'MOTO G24', 'Bodega Comunicaciones', 'Garantía', 'op']
  ]);

  const metrics = context.getEquipmentDashboardMetrics_(now);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.bodega, 1);
  assert.equal(metrics.enGarantia, 1);
  assert.equal(metrics.retornosMedidos, 1);
  assert.equal(metrics.promedioRetornoDias, 4);
  assert.equal(metrics.pendientes[0].diasEspera, 5);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);

  const dashboard = response(context.getDashboard_({ usuario: 'operador', rol: 'usuario' }));
  assert.equal(dashboard.data.celulares.total, 2);
  assert.equal(dashboard.data.celulares.promedioRetornoDias, 4);
  assert.equal(dashboard.data.unidades, 0);
});

test('equipment list refreshes SAM location from the current master row', () => {
  const { context, spreadsheet } = createRuntime();
  const equipment = context.equipmentSheet_();
  equipment.getRange(2, 1, 1, context.CONFIG.equipmentHeaders.length).setValues([[
    'phone-location-1', '2026-10-23', 'MOTO G23', '', 'BUEN ESTADO', 'Bodega Comunicaciones',
    'operador', new Date(), 'operador', '354696572315130', 'UBICACIÓN ANTERIOR'
  ]]);
  const master = spreadsheet.insertSheet('Equipos');
  master.getRange(1, 1, 2, 4).setValues([
    ['Modelo', 'IMEI_ICCID', 'ubicacion', 'Estado'],
    ['MOTO G23', '354696572315130', 'NUEVA UBICACION', 'Activo']
  ]);

  const result = response(context.getEquipment_({ usuario: 'operador', rol: 'usuario' }));

  assert.equal(result.data[0].ubicacionSam, 'NUEVA UBICACION');
  assert.equal(equipment.getRange(2, 11).getValue(), 'NUEVA UBICACION');
});

test('master spreadsheet import copies its first tab and synchronizes later updates', () => {
  const { context, spreadsheet, scheduledTriggers } = createRuntime();
  const source = new Spreadsheet(context.CONFIG.equipmentSourceSpreadsheetId);
  source.sheets.clear();
  const sourceSheet = source.insertSheet('Maestro telefónico');
  const sourceRows = [
    ['id', 'Modelo', 'linea', 'IMEI_ICCID', 'ubicacion', 'Estado'],
    [25387, 'MOTO G23', '3222634305', '354696572315130', 'BODEGA', 'Activo'],
    [25388, 'SIM Card', 'sin linea', '000000000123456', 'BODEGA', 'Activo']
  ];
  sourceSheet.getRange(1, 1, sourceRows.length, sourceRows[0].length).setValues(sourceRows);
  const oldMaster = spreadsheet.insertSheet('Equipos');
  oldMaster.getRange(1, 1, 2, 2).setValues([['Maestro anterior'], ['conservar']]);
  const openById = context.SpreadsheetApp.openById;
  context.SpreadsheetApp.openById = id => id === context.CONFIG.equipmentSourceSpreadsheetId ? source : openById(id);

  assert.match(context.importarMaestroCelularesDesdeFuente(), /2 filas de datos/);
  const imported = spreadsheet.getSheetByName(context.CONFIG.equipmentMasterSheet);
  assert.deepEqual(imported.getDataRange().getValues(), sourceRows);
  assert.equal(spreadsheet.getSheetByName('Equipos').name, context.CONFIG.equipmentMasterSheet);
  assert.equal([...spreadsheet.sheets.keys()].some(name => name.indexOf('Equipos respaldo ') === 0), true);
  assert.equal(scheduledTriggers.filter(trigger => trigger.getHandlerFunction() === 'sincronizarMaestroCelularesDesdeFuente').length, 1);

  sourceSheet.getRange(2, 5).setValue('NUEVA UBICACION');
  context.sincronizarMaestroCelularesDesdeFuente();
  const updatedMaster = spreadsheet.getSheetByName(context.CONFIG.equipmentMasterSheet);
  assert.equal(updatedMaster.getRange(2, 5).getValue(), 'NUEVA UBICACION');
  assert.equal(scheduledTriggers.filter(trigger => trigger.getHandlerFunction() === 'sincronizarMaestroCelularesDesdeFuente').length, 1);
});

test('accessory sheet migration renames legacy sheets without losing rows', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName(context.CONFIG.inventorySheet);
  inventory.setName(context.CONFIG.legacyInventorySheet);
  const requests = spreadsheet.insertSheet(context.CONFIG.legacyRequestsSheet);
  requests.getRange(1, 1, 1, context.CONFIG.requestHeaders.length).setValues([context.CONFIG.requestHeaders]);
  requests.getRange(2, 1).setValue('existing-request');

  assert.match(context.migrarNombresHojasAccesorios(), /Inventario accesorios y Solicitudes accesorios/);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.legacyInventorySheet), null);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.legacyRequestsSheet), null);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.inventorySheet), inventory);
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.requestsSheet), requests);
  assert.equal(requests.getRange(2, 1).getValue(), 'existing-request');
});

test('IMEI suffix lookup returns equipment matches and excludes SIM rows', () => {
  const { context, spreadsheet, sessionEntries } = createRuntime();
  const source = spreadsheet.insertSheet('Equipos');
  source.getRange(1, 1, 4, 6).setValues([
    ['id', 'Modelo', 'linea', 'IMEI_ICCID', 'ubicacion', 'Estado'],
    [25387, 'MOTO G23', '3222634305', '354696572315130', 'BODEGA', 'Activo'],
    [25388, 'SIM Card', 'sin linea', '000000000123456', 'BODEGA', 'Activo'],
    [25389, 'MOTO G54', '1230000001', '123000000123456', 'BODEGA', 'Activo']
  ]);
  const token = 'imei-lookup-session';
  sessionEntries.set(context.sessionKey_(token), JSON.stringify({ usuario: 'operador', rol: 'usuario' }));

  const result = response(context.doPost({
    postData: { contents: JSON.stringify({ action: 'buscar_equipo_maestro', imeiConsulta: '123456', token }) }
  }));

  assert.equal(result.status, 'success');
  assert.equal(result.total, 1);
  assert.deepEqual(result.data[0], { modelo: 'MOTO G54', imei: '123000000123456', ubicacionSam: 'BODEGA' });
  const longerSearch = response(context.doPost({
    postData: { contents: JSON.stringify({ action: 'buscar_equipo_maestro', imeiConsulta: '000123456', token }) }
  }));
  assert.equal(longerSearch.total, 1);
  assert.deepEqual(longerSearch.data[0], { modelo: 'MOTO G54', imei: '123000000123456', ubicacionSam: 'BODEGA' });
  assert.equal(response(context.doPost({
    postData: { contents: JSON.stringify({ action: 'buscar_equipo_maestro', imeiConsulta: '123', token }) }
  })).status, 'error');
  assert.equal(spreadsheet.getSheetByName(context.CONFIG.equipmentSheet), null);
});