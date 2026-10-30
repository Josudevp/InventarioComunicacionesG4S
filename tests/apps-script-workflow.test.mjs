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
  }

  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      if (this.rows[index].some(value => value !== '' && value != null)) return index + 1;
    }
    return 0;
  }

  getMaxRows() { return 100; }

  getDataRange() {
    const lastRow = Math.max(this.getLastRow(), 1);
    const lastColumn = Math.max(1, ...this.rows.map(row => row.length));
    return new Range(this, 1, 1, lastRow, lastColumn);
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new Range(this, row, column, rowCount, columnCount);
  }

  getCell(row, column) {
    const override = this.formulaOverrides && this.formulaOverrides[`${row}:${column}`];
    if (override != null) return override;
    const raw = this.rows[row - 1]?.[column - 1] ?? '';
    if (this.name !== 'Maestro de inventario' || row === 1 || column < 5 || column > 7) return raw;
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
  constructor() {
    this.sheets = new Map();
    const inventory = new Sheet('Maestro de inventario', [
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
  insertSheet(name) { return this.addSheet(new Sheet(name)); }
}

function createRuntime() {
  const spreadsheet = new Spreadsheet();
  const sessionEntries = new Map();
  const cacheWrites = [];
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
    Utilities: {
      getUuid: () => `test-id-${++uuid}`,
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_algorithm, value) => Array.from(value).map(character => character.charCodeAt(0)),
      base64EncodeWebSafe: bytes => bytes.join(''),
      sleep() {},
      formatDate: date => date.toISOString().slice(0, 7)
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
  return { context, spreadsheet, sessionEntries, cacheWrites };
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
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');
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
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');

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

test('dashboard ranks delivered accessories and excludes corrected movements', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'operador', rol: 'usuario' };
  const now = new Date();
  const daysAgo = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  spreadsheet.getSheetByName('Maestro de inventario').getRange(3, 1, 1, 11).setValues([
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
  const requestSheet = spreadsheet.getSheetByName('Solicitudes');
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
  const requestSheet = spreadsheet.getSheetByName('Solicitudes');
  requestSheet.rows[1][9] = 'Entregada';
  context.linkRequestThread_({ idSolicitud: created.idSolicitud, gmailThreadUrl: threadUrl }, session);
  assert.equal(requestSheet.rows[1][22], threadUrl);
  assert.equal(requestSheet.rows[1][21], 'thread-123456789');
  assert.equal(response(context.getRequests_({}, session)).data[0].gmailThreadUrl, threadUrl);
});

test('availability review validates client stock and dispatches directly when available', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');
  inventory.rows[1][3] = 5;
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const created = response(context.createRequest_({
    regional: 'Bogota',
    entregadoA: 'Ana',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente A' }]
  }, session));
  const requestSheet = spreadsheet.getSheetByName('Solicitudes');

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

  assert.equal(spreadsheet.getSheetByName('Solicitudes').rows[1][4], 'Comunicaciones');
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
  const sheet = spreadsheet.insertSheet('Solicitudes');
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
  const requestSheet = spreadsheet.getSheetByName('Solicitudes');
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
  const sheet = spreadsheet.getSheetByName('Solicitudes');
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
  assert.equal(spreadsheet.getSheetByName('Solicitudes').rows.length, 2);
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
  assert.equal(spreadsheet.getSheetByName('Solicitudes'), null);

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
  assert.equal(spreadsheet.getSheetByName('Solicitudes').rows.length, 2);
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
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');
  inventory.rows[0] = inventory.rows[0].slice(0, 10);
  inventory.rows[1] = inventory.rows[1].slice(0, 10);

  const catalog = response(context.getCatalog_({ usuario: 'consulta', rol: 'usuario' }));
  assert.equal(inventory.getRange(1, 11).getValue(), 'Costo_Unitario_COP');
  assert.equal(catalog.data[0].costoUnitario, 0);
  assert.equal(inventory.getRange(1, 10).getValue(), 'Activo');
});

test('outgoing movements use the ledger when the inventory formula is stale', () => {
  const { context, spreadsheet } = createRuntime();
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');
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