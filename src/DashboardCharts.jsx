import React, { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const chartRoots = new WeakMap();
const chartTooltipStyle = {
  backgroundColor: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-tooltip-border)',
  borderRadius: '8px',
  color: 'var(--chart-tooltip-color)'
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label && <p className="chart-tooltip-label">{label}</p>}
      {payload.filter(item => item.value != null).map((item, index) => (
        <p className="chart-tooltip-item" key={`${item.name}-${index}`}>
          <span className="chart-tooltip-swatch" style={{ backgroundColor: item.color }} />
          <span>
            {item.name}: {Number(item.value).toLocaleString('es-CO')}
            {['Ingresadas', 'Retiradas', 'Entregadas', 'Unidades entregadas'].includes(item.name) ? ' unidades' : ' días'}
          </span>
          {item.name === 'Días promedio' && (
            <small>{Number(item.payload.count || 0).toLocaleString('es-CO')} recepciones</small>
          )}
        </p>
      ))}
    </div>
  );
}

function ChartGradients({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--chart-bar-start)" />
        <stop offset="100%" stopColor="var(--chart-bar-end)" />
      </linearGradient>
    </defs>
  );
}

function renderChart(element, Component, props) {
  if (!element) return;
  let root = chartRoots.get(element);
  if (!root) {
    root = createRoot(element);
    chartRoots.set(element, root);
  }
  root.render(createElement(Component, props));
}

function EmptyChart({ children }) {
  return <p className="chart-empty-label">{children}</p>;
}

function MovementChart({ rows, months, visibleSeries }) {
  const data = rows.slice(-months).map(row => {
    const date = new Date(`${row.mes}-01T12:00:00`);
    return {
      ...row,
      label: Number.isNaN(date.getTime())
        ? row.mes
        : new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(date).replace('.', ''),
      entradas: Number(row.entradas) || 0,
      salidas: Number(row.salidas) || 0
    };
  });

  if (!data.some(row =>
    (visibleSeries.entradas && row.entradas > 0) ||
    (visibleSeries.salidas && row.salidas > 0)
  )) {
    return <EmptyChart>Sin movimientos en este periodo</EmptyChart>;
  }

  return (
    <div className="recharts-frame" role="img" aria-label={`Unidades ingresadas y retiradas en los últimos ${months} meses`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barGap={5}>
          <ChartGradients id="movement-bars-gradient" />
          <CartesianGrid stroke="var(--chart-grid-color)" strokeOpacity={0.1} vertical={false} />
          <XAxis
            dataKey="label"
            interval={data.length <= 6 ? 0 : 'preserveEnd'}
            tick={{ fontSize: 12, fill: 'var(--chart-axis-color)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid-color)' }}
            height={28}
          />
          <YAxis hide />
          <Tooltip
            content={<ChartTooltip />}
            contentStyle={chartTooltipStyle}
            formatter={(value, name) => [
              `${Number(value).toLocaleString('es-CO')} unidades`,
              name
            ]}
          />
          {visibleSeries.entradas && (
            <Bar dataKey="entradas" name="Ingresadas" fill="url(#movement-bars-gradient)" maxBarSize={18} radius={[4, 4, 0, 0]} />
          )}
          {visibleSeries.salidas && (
            <Bar dataKey="salidas" name="Retiradas" fill="var(--chart-bar-end)" maxBarSize={18} radius={[4, 4, 0, 0]} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const requestCategories = [
  ['Registrada', 'Registradas', '#3b82f6'],
  ['Revisión de disponibilidad', 'Revisión de disponibilidad', '#22d3ee'],
  ['Solicitada', 'Solicitadas', '#0ea5e9'],
  ['Recibida', 'Recibidas', '#06b6d4'],
  ['Entregada', 'Entregadas', '#6366f1'],
  ['Cerrada', 'Cerradas', '#1d4ed8'],
  ['Anulada', 'Anuladas', '#64748b']
];

function RequestDonut({ states, selectedState, onSelect }) {
  const total = requestCategories.reduce((sum, [key]) => sum + (Number(states[key]) || 0), 0);
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  const segments = requestCategories.map(([key, label, color]) => {
    const count = Number(states[key]) || 0;
    const length = total ? count / total * circumference : 0;
    const offset = -consumed;
    consumed += length;
    if (!count) return null;
    return (
      <circle
        key={key}
        className={`request-donut-segment${selectedState === key ? ' is-selected' : ''}`}
        data-request-state-segment={key}
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="17"
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={offset}
        transform="rotate(-90 60 60)"
        onClick={() => onSelect(key)}
      >
        <title>{label}: {count} solicitudes</title>
      </circle>
    );
  });

  return (
    <svg viewBox="0 0 120 120" className="request-donut-svg" aria-hidden="true">
      <circle className="request-donut-track" cx="60" cy="60" r={radius} fill="none" strokeWidth="17" />
      {segments}
      <text className="request-donut-total" x="60" y="57" textAnchor="middle">{total.toLocaleString('es-CO')}</text>
      <text className="request-donut-caption" x="60" y="71" textAnchor="middle">solicitudes</text>
    </svg>
  );
}

function RequestLegend({ states, selectedState, onSelect }) {
  return requestCategories.map(([key, label, color]) => {
    const count = Number(states[key]) || 0;
    return (
      <button
        key={key}
        type="button"
        className={`request-state-legend${selectedState === key ? ' is-selected' : ''}`}
        data-request-state={key}
        aria-pressed={selectedState === key}
        onClick={() => onSelect(key)}
      >
        <span className="chart-legend-dot" style={{ '--legend-color': color }} />
        <span>{label}</span>
        <strong>{count.toLocaleString('es-CO')}</strong>
      </button>
    );
  });
}

function RegionalChart({ rows, selectedRegional, onSelect }) {
  if (!rows.length) return <EmptyChart>Sin entregas registradas</EmptyChart>;
  const height = Math.max(150, rows.length * 34 + 12);
  const data = rows.map(item => ({ ...item, unidades: Number(item.unidades) || 0 }));
  const selectWithKeyboard = event => {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = rows.findIndex(item => item.regional === selectedRegional);
    const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? Math.min(currentIndex + 1, rows.length - 1)
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? Math.max(currentIndex < 0 ? 0 : currentIndex - 1, 0)
        : currentIndex < 0 ? 0 : currentIndex;
    onSelect(nextIndex);
  };

  return (
    <div className="recharts-frame" style={{ height }} role="group" tabIndex={0} aria-label="Unidades entregadas por regional. Usa las flechas para seleccionar una regional." onKeyDown={selectWithKeyboard}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }}>
          <ChartGradients id="regional-bars-gradient" />
          <CartesianGrid stroke="var(--chart-grid-color)" strokeOpacity={0.1} vertical={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="regional"
            width={112}
            tick={{ fontSize: 12, fill: 'var(--chart-region-label)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<ChartTooltip />}
            contentStyle={chartTooltipStyle}
            formatter={value => [`${Number(value).toLocaleString('es-CO')} unidades`, 'Entregadas']}
            labelFormatter={label => label}
          />
          <Bar
            dataKey="unidades"
            name="Unidades entregadas"
            maxBarSize={18}
            radius={[0, 5, 5, 0]}
            onClick={(_data, index) => onSelect(index)}
          >
            {data.map(item => (
              <Cell
                key={item.regional}
                fill={selectedRegional === item.regional ? '#22d3ee' : 'url(#regional-bars-gradient)'}
                cursor="pointer"
              />
            ))}
            <LabelList dataKey="unidades" position="right" fill="var(--chart-value-label)" formatter={value => Number(value).toLocaleString('es-CO')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AccessoriesChart({ rows, selectedAccessory, onSelect }) {
  if (!rows.length) return <EmptyChart>Sin entregas registradas en este periodo</EmptyChart>;
  const data = rows.map(item => ({ ...item, unidades: Number(item.unidades) || 0 }));
  const selectWithKeyboard = event => {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = rows.findIndex(item => item.idArticulo === selectedAccessory);
    const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? Math.min(currentIndex + 1, rows.length - 1)
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? Math.max(currentIndex < 0 ? 0 : currentIndex - 1, 0)
        : currentIndex < 0 ? 0 : currentIndex;
    onSelect(nextIndex);
  };

  return (
    <div className="recharts-frame accessories-recharts-frame" role="group" tabIndex={0} aria-label="Accesorios ordenados por unidades entregadas. Usa las flechas para seleccionar un accesorio." onKeyDown={selectWithKeyboard}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 12, bottom: 76, left: 12 }}>
          <ChartGradients id="accessory-bars-gradient" />
          <CartesianGrid stroke="var(--chart-grid-color)" strokeOpacity={0.1} vertical={false} />
          <XAxis
            dataKey="accesorio"
            interval={data.length <= 6 ? 0 : 'preserveEnd'}
            angle={-45}
            textAnchor="end"
            height={76}
            tick={{ fontSize: 12, fill: 'var(--chart-axis-color)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid-color)' }}
            tickFormatter={value => String(value).length > 18 ? `${String(value).slice(0, 17)}…` : value}
          />
          <YAxis hide />
          <Tooltip
            content={<ChartTooltip />}
            contentStyle={chartTooltipStyle}
            formatter={value => [`${Number(value).toLocaleString('es-CO')} unidades`, 'Entregadas']}
            labelFormatter={label => label}
          />
          <Bar
            dataKey="unidades"
            name="Unidades entregadas"
            maxBarSize={20}
            radius={[5, 5, 0, 0]}
            onClick={(_data, index) => onSelect(index)}
          >
            {data.map(item => (
              <Cell
                key={item.idArticulo}
                fill={selectedAccessory === item.idArticulo ? '#22d3ee' : 'url(#accessory-bars-gradient)'}
                cursor="pointer"
              />
            ))}
            <LabelList dataKey="unidades" position="top" fill="var(--chart-value-label)" formatter={value => Number(value).toLocaleString('es-CO')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SupplierLeadChart({ series, onFormatNumber }) {
  const data = series.map(item => {
    const date = new Date(`${item.month}-01T12:00:00`);
    const average = Number(item.average);
    return {
      ...item,
      average: item.average == null || !Number.isFinite(average) ? null : average,
      count: Number(item.count) || 0,
      label: Number.isNaN(date.getTime())
        ? item.month
        : date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
    };
  });

  if (!data.some(item => item.average != null)) {
    return <EmptyChart>Sin recepciones válidas en los últimos 12 meses para este filtro.</EmptyChart>;
  }

  return (
    <div className="recharts-frame" role="img" aria-label="Promedio mensual de días de entrega">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
          <defs>
            <linearGradient id="supplier-lead-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid-color)" strokeOpacity={0.1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--chart-axis-color)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid-color)' }}
            tickMargin={8}
            minTickGap={18}
            angle={-35}
            textAnchor="end"
            height={48}
          />
          <YAxis hide />
          <Tooltip
            content={<ChartTooltip />}
            contentStyle={chartTooltipStyle}
            labelFormatter={(_label, items) => {
              const month = items[0]?.payload?.month;
              const date = new Date(`${month}-01T12:00:00`);
              return Number.isNaN(date.getTime())
                ? month || ''
                : date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
            }}
            formatter={(value, _name, item) => value == null
              ? ['Sin recepciones', 'Promedio']
              : [`${onFormatNumber(value)} días · ${onFormatNumber(item.payload.count)} recepciones`, 'Promedio']}
          />
          <Area
            type="monotone"
            dataKey="average"
            name="Días promedio"
            stroke="#22d3ee"
            strokeWidth={3}
            fill="url(#supplier-lead-gradient)"
            connectNulls={false}
            activeDot={{ r: 6, fill: '#f8fafc', stroke: '#22d3ee', strokeWidth: 3 }}
            dot={{ r: 3, fill: '#e0fbff', stroke: '#22d3ee', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function renderMovementChart(element, props) {
  renderChart(element, MovementChart, props);
}

export function renderRequestDonut(element, props) {
  renderChart(element, RequestDonut, props);
}

export function renderRequestLegend(element, props) {
  renderChart(element, RequestLegend, props);
}

export function renderRegionalChart(element, props) {
  renderChart(element, RegionalChart, props);
}

export function renderAccessoriesChart(element, props) {
  renderChart(element, AccessoriesChart, props);
}

export function renderSupplierLeadChart(element, props) {
  renderChart(element, SupplierLeadChart, props);
}
