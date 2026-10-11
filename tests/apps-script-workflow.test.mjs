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

  setFormulas() { return this; }
  setDataValidation() { return this; }
}

class Sheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows;
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
    const incoming = movements.filter(item => item[2] === sku && ['Entrada', 'Ajuste positivo'].includes(item[3]) && (!item[9] || item[9] === 'Confirmado'))
      .reduce((sum, item) => sum + Number(item[4] || 0), 0);
    const outgoing = movements.filter(item => item[2] === sku && ['Salida', 'Devolucion', 'Ajuste negativo', 'Baja por daño'].includes(item[3]) && (!item[9] || item[9] === 'Confirmado'))
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
  let uuid = 0;
  const properties = {
    MAIN_SHEET: '',
    ADMIN_USERS: 'legacy-admin',
    CATALOG_EDITOR_USERS: 'catalog-editor'
  };
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => spreadsheet,
      flush() {},
      newDataValidation: () => ({
        requireValueInList() { return this; },
        setAllowInvalid() { return this; },
        build() { return {}; }
      })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `test-id-${++uuid}`,
      formatDate: date => date.toISOString().slice(0, 7)
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) { return { content, setMimeType() { return this; } }; }
    }
  };
  runInNewContext(code, context, { filename: 'Code.gs' });
  return { context, spreadsheet };
}

function response(output) {
  return JSON.parse(output.content);
}

function stockFor(spreadsheet, sku) {
  const inventory = spreadsheet.getSheetByName('Maestro de inventario');
  const row = inventory.rows.findIndex(values => values[0] === sku) + 1;
  return inventory.getRange(row, 7).getValue();
}

test('request receipt adds stock and delivery removes it exactly once', () => {
  const { context, spreadsheet } = createRuntime();
  const session = { usuario: 'solicitante', rol: 'usuario' };
  const created = response(context.createRequest_({ items: [{
    idArticulo: 'CARG-USB', cantidad: 32, cliente: 'Cliente A', regional: 'Bogota', entregadoA: 'Ana'
  }] }, session));
  const request = { idSolicitud: created.idSolicitud };
  const requestSheet = spreadsheet.getSheetByName('Solicitudes');
  assert.equal(requestSheet.rows[1][19], 25000);

  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
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

  context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 32);
  const receiptCount = spreadsheet.getSheetByName('Registro de Movimientos').getLastRow();
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Recibida' }, session));
  assert.equal(spreadsheet.getSheetByName('Registro de Movimientos').getLastRow(), receiptCount);

  context.registerMovement_({
    tipoMovimiento: 'Salida',
    items: [{ idArticulo: 'CARG-USB', cantidad: 2 }],
    distribution: [{ idArticulo: 'CARG-USB', cantidad: 2, cliente: 'Cliente B', regional: 'Bogota', usuario: 'Luis' }]
  }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 30);
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session), /Stock insuficiente/);

  context.registerMovement_({ tipoMovimiento: 'Entrada', proveedor: 'Proveedor alterno', items: [{ idArticulo: 'CARG-USB', cantidad: 2 }] }, session);
  context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session);
  assert.equal(stockFor(spreadsheet, 'CARG-USB'), 0);
  const deliveryCount = spreadsheet.getSheetByName('Registro de Movimientos').getLastRow();
  assert.throws(() => context.updateRequestStatus_({ ...request, estado: 'Entregada' }, session));
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
  }, { usuario: 'solicitante', rol: 'usuario' }), /Disponible según movimientos: 1/);
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