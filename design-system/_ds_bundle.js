/* @ds-bundle: {"format":4,"namespace":"NotNullSoftAdminDesignSystem_a508e9","components":[{"name":"BarChart","sourcePath":"components/charts/BarChart.jsx"},{"name":"DonutChart","sourcePath":"components/charts/DonutChart.jsx"},{"name":"LineChart","sourcePath":"components/charts/LineChart.jsx"},{"name":"Sparkline","sourcePath":"components/charts/Sparkline.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Mark","sourcePath":"components/core/Logo.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"DescriptionList","sourcePath":"components/data/DescriptionList.jsx"},{"name":"ProgressBar","sourcePath":"components/data/ProgressBar.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"Timeline","sourcePath":"components/data/Timeline.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Input.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/Radio.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Breadcrumbs","sourcePath":"components/navigation/Breadcrumbs.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Sidebar","sourcePath":"components/navigation/Sidebar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Topbar","sourcePath":"components/navigation/Topbar.jsx"},{"name":"Dialog","sourcePath":"components/overlays/Dialog.jsx"},{"name":"Drawer","sourcePath":"components/overlays/Drawer.jsx"},{"name":"Menu","sourcePath":"components/overlays/Menu.jsx"},{"name":"Tooltip","sourcePath":"components/overlays/Tooltip.jsx"}],"sourceHashes":{"components/charts/BarChart.jsx":"e258ce885bcd","components/charts/DonutChart.jsx":"4b1010b08cb7","components/charts/LineChart.jsx":"92fcd7835d62","components/charts/Sparkline.jsx":"c28d04e7f6fb","components/core/Avatar.jsx":"74ee5bbf14b8","components/core/Badge.jsx":"9f6477eababb","components/core/Button.jsx":"ce5ac8c5d959","components/core/Card.jsx":"f98c76193ce4","components/core/Icon.jsx":"1b0005fa5265","components/core/IconButton.jsx":"9fe229c6487f","components/core/Logo.jsx":"aeed299ba3b1","components/core/Tag.jsx":"c57377d33f82","components/data/DataTable.jsx":"449e836c2bb8","components/data/DescriptionList.jsx":"a98371bdb7c1","components/data/ProgressBar.jsx":"751d0a2468c6","components/data/StatCard.jsx":"3c142a966a84","components/data/Timeline.jsx":"b9a1f752a3af","components/feedback/Alert.jsx":"a596d8d250df","components/feedback/EmptyState.jsx":"afa07c9c8b82","components/feedback/Skeleton.jsx":"516ca6934243","components/feedback/Toast.jsx":"49f46fceae55","components/forms/Checkbox.jsx":"ea428c5ee6a1","components/forms/Input.jsx":"c689816786d1","components/forms/Radio.jsx":"6c3e57ae4918","components/forms/SegmentedControl.jsx":"e7455059b5c2","components/forms/Select.jsx":"181022077b30","components/forms/Switch.jsx":"a3828c041c03","components/forms/Textarea.jsx":"2269c7cd88ea","components/navigation/Breadcrumbs.jsx":"f71729c10eb3","components/navigation/PageHeader.jsx":"0c4cb32bdd3c","components/navigation/Pagination.jsx":"906becccfba8","components/navigation/Sidebar.jsx":"38659452ef1b","components/navigation/Tabs.jsx":"f7d2ab5cbece","components/navigation/Topbar.jsx":"79efc6010e15","components/overlays/Dialog.jsx":"44c9552034e9","components/overlays/Drawer.jsx":"1b35190582b4","components/overlays/Menu.jsx":"9e9ed8692793","components/overlays/Tooltip.jsx":"4af71f9e0342","ui_kits/admin/AuditLog.jsx":"1f58baa043b9","ui_kits/admin/Dashboard.jsx":"abf5c1a01c06","ui_kits/admin/Login.jsx":"153675324e2d","ui_kits/admin/Settings.jsx":"dca966cf9ec2","ui_kits/admin/Shell.jsx":"4dd38307d92a","ui_kits/admin/UserDetail.jsx":"576b3bb20c2b","ui_kits/admin/Users.jsx":"3b4bd4d9f823","ui_kits/admin/data.js":"49f86dfd3f7a"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.NotNullSoftAdminDesignSystem_a508e9 = window.NotNullSoftAdminDesignSystem_a508e9 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/charts/BarChart.jsx
try { (() => {
function useWidth() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function niceStep(x) {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const PAL = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const fmtDef = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 100) / 100);
function Legend({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 16px',
      marginBottom: 12
    }
  }, items.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: 'var(--type-caption)',
      color: 'var(--fg-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: s.color
    }
  }), s.name)));
}
function Tip({
  x,
  y,
  w,
  title,
  rows,
  fmt
}) {
  const left = Math.min(Math.max(x + 12, 0), w - 170);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: x + 12 > w - 170 ? x - 182 : left,
      top: Math.max(0, y),
      minWidth: 150,
      padding: '8px 10px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-control)',
      boxShadow: 'var(--shadow-3)',
      pointerEvents: 'none',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.3 var(--font-sans)',
      color: 'var(--fg-3)',
      marginBottom: 6
    }
  }, title), rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: 'var(--type-body-sm)',
      color: 'var(--fg-1)',
      lineHeight: '20px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: r.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--fg-2)'
    }
  }, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums'
    }
  }, fmt(r.value)))));
}
function BarChart({
  labels = [],
  series = [],
  stacked = false,
  height = 240,
  yFormat = fmtDef,
  showLegend = true,
  yTicks = 4,
  style
}) {
  const [ref, w] = useWidth();
  const [hi, setHi] = React.useState(null);
  const S = series.map((s, i) => ({
    ...s,
    color: s.color || PAL[i % PAL.length]
  }));
  const n = labels.length;
  const mx = Math.max(1, ...(stacked ? labels.map((_, i) => S.reduce((a, s) => a + (s.data[i] || 0), 0)) : S.flatMap(s => s.data)));
  const step = niceStep(mx / yTicks);
  const top = Math.ceil(mx / step) * step;
  const pl = 44,
    pr = 8,
    pt = 8,
    pb = 24;
  const pw = Math.max(0, w - pl - pr),
    ph = height - pt - pb;
  const band = n ? pw / n : 0;
  const gw = Math.min(band * 0.64, stacked ? 40 : 18 * S.length + 4 * (S.length - 1));
  const bw = stacked ? gw : (gw - 4 * (S.length - 1)) / S.length;
  const Y = v => pt + ph - v / top * ph;
  const every = Math.max(1, Math.ceil(n / Math.max(1, pw / 56)));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      ...style
    }
  }, showLegend && S.length > 1 && /*#__PURE__*/React.createElement(Legend, {
    items: S
  }), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      height
    }
  }, w > 0 && /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: height,
    onMouseLeave: () => setHi(null),
    style: {
      display: 'block'
    }
  }, Array.from({
    length: Math.round(top / step) + 1
  }, (_, k) => {
    const v = k * step,
      y = Y(v);
    return /*#__PURE__*/React.createElement("g", {
      key: k
    }, /*#__PURE__*/React.createElement("line", {
      x1: pl,
      x2: w - pr,
      y1: y,
      y2: y,
      stroke: "var(--chart-grid)",
      strokeDasharray: k ? '3 3' : '0'
    }), /*#__PURE__*/React.createElement("text", {
      x: pl - 8,
      y: y,
      dy: "0.32em",
      textAnchor: "end",
      style: {
        font: '400 11px var(--font-sans)',
        fill: 'var(--chart-axis)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, yFormat(v)));
  }), labels.map((l, i) => {
    const cx = pl + band * i + band / 2;
    let acc = 0;
    return /*#__PURE__*/React.createElement("g", {
      key: i,
      onMouseEnter: () => setHi(i)
    }, /*#__PURE__*/React.createElement("rect", {
      x: pl + band * i,
      y: pt,
      width: band,
      height: ph,
      fill: hi === i ? 'var(--surface-sunken)' : 'transparent'
    }), S.map((s, si) => {
      const v = s.data[i] || 0;
      const h = v / top * ph;
      let x, y;
      if (stacked) {
        x = cx - gw / 2;
        y = Y(acc + v);
        acc += v;
      } else {
        x = cx - gw / 2 + si * (bw + 4);
        y = Y(v);
      }
      const r = Math.min(2, h / 2);
      return /*#__PURE__*/React.createElement("path", {
        key: si,
        d: stacked && si < S.length - 1 ? `M${x} ${y}h${bw}v${h}h${-bw}Z` : `M${x} ${y + h}V${y + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${y + h}Z`,
        fill: s.color
      });
    }), i % every === 0 && /*#__PURE__*/React.createElement("text", {
      x: cx,
      y: height - 6,
      textAnchor: "middle",
      style: {
        font: '400 11px var(--font-sans)',
        fill: 'var(--chart-axis)'
      }
    }, l));
  })), hi != null && w > 0 && /*#__PURE__*/React.createElement(Tip, {
    x: pl + band * hi + band / 2 + gw / 2,
    y: pt,
    w: w,
    title: labels[hi],
    rows: S.map(s => ({
      name: s.name,
      color: s.color,
      value: s.data[hi] || 0
    })),
    fmt: yFormat
  })));
}
Object.assign(__ds_scope, { BarChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/BarChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/DonutChart.jsx
try { (() => {
const PAL = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
function DonutChart({
  data = [],
  size = 160,
  thickness = 18,
  centerValue,
  centerLabel,
  showLegend = true,
  valueFormat = v => v.toLocaleString('en-US'),
  style
}) {
  const [hi, setHi] = React.useState(null);
  const tot = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let off = 0;
  const gap = data.length > 1 ? 2 : 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      flexWrap: 'wrap',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)',
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--chart-track)",
    strokeWidth: thickness
  }), data.map((d, i) => {
    const len = d.value / tot * C;
    const el = /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: size / 2,
      cy: size / 2,
      r: r,
      fill: "none",
      stroke: d.color || PAL[i % PAL.length],
      strokeWidth: hi === i ? thickness + 4 : thickness,
      strokeDasharray: `${Math.max(0, len - gap)} ${C}`,
      strokeDashoffset: -off,
      onMouseEnter: () => setHi(i),
      onMouseLeave: () => setHi(null),
      style: {
        transition: 'stroke-width var(--duration-fast)',
        cursor: 'default'
      }
    });
    off += len;
    return el;
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeContent: 'center',
      textAlign: 'center',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-metric-sm)',
      color: 'var(--fg-1)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, hi != null ? Math.round(data[hi].value / tot * 100) + '%' : centerValue), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--fg-3)',
      marginTop: 2
    }
  }, hi != null ? data[hi].label : centerLabel))), showLegend && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      flex: '1 1 160px',
      minWidth: 0
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onMouseEnter: () => setHi(i),
    onMouseLeave: () => setHi(null),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: 'var(--type-body-sm)',
      opacity: hi == null || hi === i ? 1 : .5,
      transition: 'opacity var(--duration-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: d.color || PAL[i % PAL.length],
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--fg-2)',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, d.label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-1)',
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums'
    }
  }, valueFormat(d.value)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      textAlign: 'right',
      color: 'var(--fg-3)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, Math.round(d.value / tot * 100), "%")))));
}
Object.assign(__ds_scope, { DonutChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/DonutChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/LineChart.jsx
try { (() => {
function useWidth() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function niceStep(x) {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const PAL = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const fmtDef = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v * 100) / 100);
function Legend({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 16px',
      marginBottom: 12
    }
  }, items.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      font: 'var(--type-caption)',
      color: 'var(--fg-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: s.color
    }
  }), s.name)));
}
function Tip({
  x,
  y,
  w,
  title,
  rows,
  fmt
}) {
  const left = Math.min(Math.max(x + 12, 0), w - 170);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: x + 12 > w - 170 ? x - 182 : left,
      top: Math.max(0, y),
      minWidth: 150,
      padding: '8px 10px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-control)',
      boxShadow: 'var(--shadow-3)',
      pointerEvents: 'none',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.3 var(--font-sans)',
      color: 'var(--fg-3)',
      marginBottom: 6
    }
  }, title), rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: 'var(--type-body-sm)',
      color: 'var(--fg-1)',
      lineHeight: '20px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: r.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--fg-2)'
    }
  }, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums'
    }
  }, fmt(r.value)))));
}
function LineChart({
  labels = [],
  series = [],
  height = 240,
  yFormat = fmtDef,
  showArea,
  showLegend = true,
  showGrid = true,
  yTicks = 4,
  style
}) {
  const [ref, w] = useWidth();
  const [hi, setHi] = React.useState(null);
  const S = series.map((s, i) => ({
    ...s,
    color: s.color || PAL[i % PAL.length]
  }));
  const n = labels.length || S[0]?.data.length || 0;
  const all = S.flatMap(s => s.data);
  const mx = Math.max(1, ...all);
  const step = niceStep(mx / yTicks);
  const top = Math.ceil(mx / step) * step;
  const pl = 44,
    pr = 8,
    pt = 8,
    pb = 24;
  const pw = Math.max(0, w - pl - pr),
    ph = height - pt - pb;
  const X = i => pl + (n <= 1 ? pw / 2 : i * pw / (n - 1));
  const Y = v => pt + ph - v / top * ph;
  const every = Math.max(1, Math.ceil(n / Math.max(1, pw / 72)));
  const area = showArea ?? S.length === 1;
  const move = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round((x - pl) / (pw || 1) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, i)));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      ...style
    }
  }, showLegend && S.length > 1 && /*#__PURE__*/React.createElement(Legend, {
    items: S
  }), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      height
    }
  }, w > 0 && /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: height,
    onMouseMove: move,
    onMouseLeave: () => setHi(null),
    style: {
      display: 'block',
      overflow: 'visible'
    }
  }, Array.from({
    length: Math.round(top / step) + 1
  }, (_, k) => {
    const v = k * step,
      y = Y(v);
    return /*#__PURE__*/React.createElement("g", {
      key: k
    }, showGrid && /*#__PURE__*/React.createElement("line", {
      x1: pl,
      x2: w - pr,
      y1: y,
      y2: y,
      stroke: "var(--chart-grid)",
      strokeDasharray: k ? '3 3' : '0'
    }), /*#__PURE__*/React.createElement("text", {
      x: pl - 8,
      y: y,
      dy: "0.32em",
      textAnchor: "end",
      style: {
        font: '400 11px var(--font-sans)',
        fill: 'var(--chart-axis)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, yFormat(v)));
  }), labels.map((l, i) => i % every === 0 && /*#__PURE__*/React.createElement("text", {
    key: i,
    x: X(i),
    y: height - 6,
    textAnchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
    style: {
      font: '400 11px var(--font-sans)',
      fill: 'var(--chart-axis)'
    }
  }, l)), S.map((s, si) => {
    const d = s.data.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    return /*#__PURE__*/React.createElement("g", {
      key: si
    }, area && /*#__PURE__*/React.createElement("path", {
      d: d + ` L${X(s.data.length - 1)} ${Y(0)} L${X(0)} ${Y(0)} Z`,
      fill: s.color,
      fillOpacity: ".08"
    }), /*#__PURE__*/React.createElement("path", {
      d: d,
      fill: "none",
      stroke: s.color,
      strokeWidth: "2",
      strokeLinejoin: "round",
      strokeLinecap: "round",
      strokeDasharray: s.dashed ? '4 4' : undefined
    }));
  }), hi != null && /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: X(hi),
    x2: X(hi),
    y1: pt,
    y2: pt + ph,
    stroke: "var(--border-strong)"
  }), S.map((s, si) => /*#__PURE__*/React.createElement("circle", {
    key: si,
    cx: X(hi),
    cy: Y(s.data[hi] ?? 0),
    r: "4",
    fill: "var(--surface)",
    stroke: s.color,
    strokeWidth: "2"
  })))), hi != null && w > 0 && /*#__PURE__*/React.createElement(Tip, {
    x: X(hi),
    y: pt,
    w: w,
    title: labels[hi],
    rows: S.map(s => ({
      name: s.name,
      color: s.color,
      value: s.data[hi]
    })),
    fmt: yFormat
  })));
}
Object.assign(__ds_scope, { LineChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/LineChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/Sparkline.jsx
try { (() => {
function Sparkline({
  data = [],
  width = 96,
  height = 28,
  color = 'var(--chart-1)',
  area = true,
  strokeWidth = 1.5,
  style
}) {
  if (data.length < 2) return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height
  });
  const mn = Math.min(...data),
    mx = Math.max(...data),
    rg = mx - mn || 1;
  const p = strokeWidth;
  const pts = data.map((v, i) => [p + i * (width - 2 * p) / (data.length - 1), p + (height - 2 * p) * (1 - (v - mn) / rg)]);
  const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: 'block',
      overflow: 'visible',
      flex: 'none',
      ...style
    },
    "aria-hidden": "true"
  }, area && /*#__PURE__*/React.createElement("path", {
    d: d + ` L${last[0]} ${height} L${pts[0][0]} ${height} Z`,
    fill: color,
    fillOpacity: ".1"
  }), /*#__PURE__*/React.createElement("path", {
    d: d,
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: last[0],
    cy: last[1],
    r: "2.5",
    fill: color
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/core/Avatar.jsx
try { (() => {
const BG = ['var(--blue-100)', 'var(--green-100)', 'var(--amber-100)', 'var(--ember-100)', 'var(--gray-100)', 'var(--red-100)'];
const FG = ['var(--blue-700)', 'var(--green-700)', 'var(--amber-700)', 'var(--ember-700)', 'var(--gray-700)', 'var(--red-700)'];
function Avatar({
  name = '',
  src,
  size = 'md',
  style,
  onImageError
}) {
  const d = {
    xs: 20,
    sm: 24,
    md: 32,
    lg: 40,
    xl: 56
  }[size] || 32;
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  let h = 0;
  for (const c of name) h = h * 31 + c.charCodeAt(0) >>> 0;
  const i = h % BG.length;
  return /*#__PURE__*/React.createElement("span", {
    title: name,
    style: {
      width: d,
      height: d,
      borderRadius: '50%',
      flex: 'none',
      display: 'inline-grid',
      placeItems: 'center',
      overflow: 'hidden',
      background: src ? 'var(--gray-100)' : BG[i],
      color: FG[i],
      font: `600 ${Math.round(d * 0.38)}px/1 var(--font-sans)`,
      ...style
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    onError: onImageError,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : ini);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const T = {
  neutral: ['var(--neutral-subtle)', 'var(--neutral-fg)', 'var(--neutral-border)', 'var(--gray-400)'],
  accent: ['var(--accent-subtle)', 'var(--accent-subtle-fg)', 'var(--ember-100)', 'var(--accent)'],
  success: ['var(--success-subtle)', 'var(--success-fg)', 'var(--success-border)', 'var(--success)'],
  warning: ['var(--warning-subtle)', 'var(--warning-fg)', 'var(--warning-border)', 'var(--warning)'],
  danger: ['var(--danger-subtle)', 'var(--danger-fg)', 'var(--danger-border)', 'var(--danger)'],
  info: ['var(--info-subtle)', 'var(--info-fg)', 'var(--info-border)', 'var(--info)']
};
function Badge({
  tone = 'neutral',
  dot = false,
  mono = false,
  size = 'md',
  children,
  style
}) {
  const [bg, fg, bd, dc] = T[tone] || T.neutral;
  const h = size === 'sm' ? 18 : 22;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: h,
      padding: `0 ${size === 'sm' ? 6 : 8}px`,
      background: bg,
      color: fg,
      border: `1px solid ${bd}`,
      borderRadius: 'var(--radius-badge)',
      font: mono ? `500 ${size === 'sm' ? 11 : 12}px/1 var(--font-mono)` : `500 ${size === 'sm' ? 11 : 12}px/1 var(--font-sans)`,
      whiteSpace: 'nowrap',
      flex: 'none',
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: dc,
      flex: 'none'
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useHP() {
  const [h, sh] = React.useState(false);
  const [p, sp] = React.useState(false);
  return [{
    h,
    p
  }, {
    onMouseEnter: () => sh(true),
    onMouseLeave: () => {
      sh(false);
      sp(false);
    },
    onMouseDown: () => sp(true),
    onMouseUp: () => sp(false)
  }];
}
const SIZES = {
  sm: {
    h: 28,
    px: 10,
    fs: 13,
    gap: 6
  },
  md: {
    h: 32,
    px: 12,
    fs: 13,
    gap: 6
  },
  lg: {
    h: 40,
    px: 16,
    fs: 14,
    gap: 8
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  children,
  style,
  ...rest
}) {
  const [s, ev] = useHP();
  const z = SIZES[size] || SIZES.md;
  const off = disabled || loading;
  const st = (a, b, c) => off ? a : s.p ? c : s.h ? b : a;
  const V = {
    primary: {
      bg: st('var(--primary)', 'var(--primary-hover)', 'var(--primary-press)'),
      fg: 'var(--primary-fg)',
      bd: 'transparent'
    },
    accent: {
      bg: st('var(--accent)', 'var(--accent-hover)', 'var(--accent-press)'),
      fg: 'var(--fg-on-accent)',
      bd: 'transparent'
    },
    secondary: {
      bg: st('var(--surface)', 'var(--control-hover)', 'var(--control-press)'),
      fg: 'var(--fg-1)',
      bd: 'var(--border-strong)',
      sh: 'var(--shadow-1)'
    },
    ghost: {
      bg: st('transparent', 'var(--control-hover)', 'var(--control-press)'),
      fg: 'var(--fg-1)',
      bd: 'transparent'
    },
    danger: {
      bg: st('var(--danger)', 'var(--danger-hover)', 'var(--danger-press)'),
      fg: '#fff',
      bd: 'transparent'
    },
    'danger-ghost': {
      bg: st('transparent', 'var(--danger-subtle)', 'var(--danger-subtle)'),
      fg: 'var(--danger-fg)',
      bd: 'transparent'
    }
  }[variant] || {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: off,
    onClick: onClick
  }, ev, rest, {
    style: {
      display: fullWidth ? 'flex' : 'inline-flex',
      width: fullWidth ? '100%' : undefined,
      alignItems: 'center',
      justifyContent: 'center',
      gap: z.gap,
      height: z.h,
      padding: `0 ${z.px}px`,
      font: `500 ${z.fs}px/1 var(--font-sans)`,
      color: V.fg,
      background: V.bg,
      border: `1px solid ${V.bd}`,
      boxShadow: V.sh || 'none',
      borderRadius: 'var(--radius-control)',
      cursor: off ? 'not-allowed' : 'pointer',
      opacity: disabled ? .45 : 1,
      transform: s.p && !off ? 'translateY(1px)' : 'none',
      transition: 'background var(--duration-fast) var(--ease-out),transform var(--duration-instant) var(--ease-out)',
      whiteSpace: 'nowrap',
      flex: 'none',
      ...style
    }
  }), loading ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: z.fs,
      height: z.fs,
      border: '1.5px solid currentColor',
      borderRightColor: 'transparent',
      borderRadius: '50%',
      animation: 'nns-spin .7s linear infinite'
    }
  }) : iconLeft, children, iconRight, /*#__PURE__*/React.createElement("style", null, '@keyframes nns-spin{to{transform:rotate(360deg)}}'));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  title,
  subtitle,
  actions,
  footer,
  variant = 'outline',
  padding = 'md',
  children,
  style,
  bodyStyle
}) {
  const p = {
    none: 0,
    sm: 16,
    md: 20,
    lg: 24
  }[padding] ?? 20;
  const V = {
    outline: {
      bg: 'var(--surface)',
      sh: 'none'
    },
    raised: {
      bg: 'var(--surface-raised)',
      sh: 'var(--shadow-2)'
    },
    sunken: {
      bg: 'var(--surface-sunken)',
      sh: 'none'
    }
  }[variant] || {};
  const head = title || actions;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: V.bg,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      boxShadow: V.sh,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      ...style
    }
  }, head && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: `${Math.max(p, 16) - 2}px ${Math.max(p, 16)}px ${p === 0 ? 14 : 0}px`,
      borderBottom: p === 0 ? '1px solid var(--border)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: 'var(--type-card-title)',
      color: 'var(--fg-1)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)'
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      margin: '-4px -4px 0 0'
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: p,
      paddingTop: head && p ? 14 : p,
      flex: 1,
      minWidth: 0,
      ...bodyStyle
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: `12px ${Math.max(p, 16)}px`,
      borderTop: '1px solid var(--border)',
      font: 'var(--type-body-sm)',
      color: 'var(--fg-2)'
    }
  }, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/* Lucide via CDN global (window.lucide). Load https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js before the bundle. */
const pascal = s => s.replace(/(^|-)([a-z0-9])/g, (_, a, b) => b.toUpperCase());
function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  color = 'currentColor',
  style
}) {
  const L = typeof window !== 'undefined' && window.lucide;
  let node = L && (L.icons?.[pascal(name)] || L[pascal(name)]);
  if (Array.isArray(node) && node[0] === 'svg') node = node[2];
  const kids = Array.isArray(node) ? node.map(([t, a], i) => React.createElement(t, {
    key: i,
    ...a
  })) : null;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    style: {
      display: 'block',
      flex: 'none',
      ...style
    }
  }, kids);
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useHP() {
  const [h, sh] = React.useState(false);
  const [p, sp] = React.useState(false);
  return [{
    h,
    p
  }, {
    onMouseEnter: () => sh(true),
    onMouseLeave: () => {
      sh(false);
      sp(false);
    },
    onMouseDown: () => sp(true),
    onMouseUp: () => sp(false)
  }];
}
function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const [s, ev] = useHP();
  const d = {
    xs: 24,
    sm: 28,
    md: 32,
    lg: 40
  }[size] || 32;
  const st = (a, b, c) => disabled ? a : s.p ? c : s.h ? b : a;
  const V = {
    ghost: {
      bg: st('transparent', 'var(--control-hover)', 'var(--control-press)'),
      fg: s.h ? 'var(--fg-1)' : 'var(--fg-2)',
      bd: 'transparent'
    },
    secondary: {
      bg: st('var(--surface)', 'var(--control-hover)', 'var(--control-press)'),
      fg: 'var(--fg-1)',
      bd: 'var(--border-strong)'
    },
    primary: {
      bg: st('var(--primary)', 'var(--primary-hover)', 'var(--primary-press)'),
      fg: 'var(--primary-fg)',
      bd: 'transparent'
    }
  }[variant] || {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick
  }, ev, rest, {
    style: {
      width: d,
      height: d,
      display: 'inline-grid',
      placeItems: 'center',
      flex: 'none',
      padding: 0,
      color: V.fg,
      background: V.bg,
      border: `1px solid ${V.bd}`,
      borderRadius: 'var(--radius-control)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .45 : 1,
      transition: 'background var(--duration-fast) var(--ease-out),color var(--duration-fast)',
      ...style
    }
  }), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
const PAL = {
  light: ['var(--gray-950)', 'var(--ember-500)'],
  dark: ['#F4F4F2', 'var(--ember-500)'],
  auto: ['var(--fg-1)', 'var(--ember-500)'],
  'mono-ink': ['var(--gray-950)', 'var(--gray-950)'],
  'mono-white': ['#fff', '#fff']
};
function Mark({
  size = 32,
  tone = 'auto',
  style
}) {
  const [k, e] = PAL[tone] || PAL.auto;
  return /*#__PURE__*/React.createElement("svg", {
    width: size * 16 / 48,
    height: size,
    viewBox: "2 0 16 48",
    style: {
      display: 'block',
      flex: 'none',
      ...style
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "2",
    width: "12",
    height: "30",
    rx: "6",
    fill: k
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "41",
    r: "6",
    fill: e
  }));
}
function Logo({
  variant = 'horizontal',
  tone = 'auto',
  size = 24,
  product,
  style
}) {
  const [k, e] = PAL[tone] || PAL.auto;
  if (variant === 'mark') return /*#__PURE__*/React.createElement(Mark, {
    size: size,
    tone: tone,
    style: style
  });
  const word = /*#__PURE__*/React.createElement("span", {
    style: {
      font: `500 ${size * 0.78}px/1 var(--font-logo)`,
      whiteSpace: 'nowrap',
      color: k
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: e
    }
  }, "not"), "nullsoft");
  return /*#__PURE__*/React.createElement("span", {
    role: "img",
    "aria-label": product ? 'NotNullSoft ' + product : 'NotNullSoft',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: size * 0.0529,
      ...style
    }
  }, /*#__PURE__*/React.createElement(Mark, {
    size: size * 0.55,
    tone: tone,
    style: {
      transform: `translateY(${size * 0.22}px)`
    }
  }), word, product && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: size * 0.35,
      padding: '3px 6px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-strong)',
      font: `500 ${Math.max(10, Math.round(size * 0.42))}px/1 var(--font-mono)`,
      color: 'var(--fg-2)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-caps)',
      alignSelf: 'center'
    }
  }, product));
}
Object.assign(__ds_scope, { Mark, Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function Tag({
  selected = false,
  onClick,
  onRemove,
  icon,
  count,
  children,
  style
}) {
  const [h, sh] = React.useState(false);
  const click = !!onClick;
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    onMouseEnter: () => sh(true),
    onMouseLeave: () => sh(false),
    role: click ? 'button' : undefined,
    "aria-pressed": click ? selected : undefined,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: `0 ${onRemove ? 6 : 10}px 0 10px`,
      borderRadius: 'var(--radius-full)',
      border: `1px solid ${selected ? 'var(--fg-1)' : 'var(--border-strong)'}`,
      background: selected ? 'var(--surface-inverse)' : h && click ? 'var(--control-hover)' : 'var(--surface)',
      color: selected ? 'var(--fg-inverse)' : 'var(--fg-1)',
      font: '500 13px/1 var(--font-sans)',
      cursor: click ? 'pointer' : 'default',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      transition: 'background var(--duration-fast) var(--ease-out)',
      ...style
    }
  }, icon, children, count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 12px/1 var(--font-mono)',
      opacity: .7
    }
  }, count), onRemove && /*#__PURE__*/React.createElement("span", {
    role: "button",
    "aria-label": "Remove",
    onClick: e => {
      e.stopPropagation();
      onRemove();
    },
    style: {
      width: 18,
      height: 18,
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      cursor: 'pointer',
      fontSize: 14,
      lineHeight: 1,
      opacity: .7
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/DescriptionList.jsx
try { (() => {
function Copy({
  text
}) {
  const [ok, setOk] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Copy",
    onClick: () => {
      navigator.clipboard && navigator.clipboard.writeText(String(text));
      setOk(true);
      setTimeout(() => setOk(false), 1200);
    },
    style: {
      border: 0,
      background: 'none',
      padding: 2,
      marginLeft: 6,
      color: ok ? 'var(--success)' : 'var(--fg-3)',
      cursor: 'pointer',
      display: 'inline-grid',
      verticalAlign: 'middle'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, ok ? /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "9",
    width: "13",
    height: "13",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
  }))));
}
function DescriptionList({
  items = [],
  layout = 'inline',
  columns = 1,
  labelWidth = 160,
  style
}) {
  if (layout === 'stacked') return /*#__PURE__*/React.createElement("dl", {
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
      gap: '16px 24px',
      margin: 0,
      ...style
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("dt", {
    style: {
      font: 'var(--type-caption)',
      color: 'var(--fg-3)',
      marginBottom: 4
    }
  }, it.label), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      font: it.mono ? 'var(--type-mono)' : 'var(--type-body)',
      color: 'var(--fg-1)',
      overflowWrap: 'anywhere'
    }
  }, it.value ?? '—', it.copyable && /*#__PURE__*/React.createElement(Copy, {
    text: it.copyable === true ? it.value : it.copyable
  })))));
  return /*#__PURE__*/React.createElement("dl", {
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
      columnGap: 32,
      margin: 0,
      ...style
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: `${labelWidth}px minmax(0,1fr)`,
      gap: 16,
      padding: '10px 0',
      borderBottom: '1px solid var(--border-subtle)',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("dt", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)'
    }
  }, it.label), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      font: it.mono ? 'var(--type-mono)' : 'var(--type-body)',
      fontSize: it.mono ? 12 : 13,
      color: 'var(--fg-1)',
      overflowWrap: 'anywhere'
    }
  }, it.value ?? '—', it.copyable && /*#__PURE__*/React.createElement(Copy, {
    text: it.copyable === true ? it.value : it.copyable
  })))));
}
Object.assign(__ds_scope, { DescriptionList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DescriptionList.jsx", error: String((e && e.message) || e) }); }

// components/data/ProgressBar.jsx
try { (() => {
const C = {
  accent: 'var(--accent)',
  neutral: 'var(--fg-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};
function ProgressBar({
  value = 0,
  max = 100,
  tone = 'accent',
  label,
  valueLabel,
  size = 'md',
  style
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const t = tone === 'auto' ? pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'success' : tone;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
      ...style
    }
  }, (label || valueLabel) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 8,
      font: 'var(--type-body-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-2)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-1)',
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums'
    }
  }, valueLabel ?? Math.round(pct) + '%')), /*#__PURE__*/React.createElement("div", {
    role: "progressbar",
    "aria-valuenow": value,
    "aria-valuemax": max,
    style: {
      height: size === 'sm' ? 4 : 6,
      borderRadius: 999,
      background: 'var(--chart-track)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      borderRadius: 999,
      background: C[t] || C.accent,
      transition: 'width var(--duration-slow) var(--ease-out)'
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
function StatCard({
  label,
  value,
  delta,
  deltaSuffix = '%',
  invertDelta = false,
  comparison,
  trend,
  icon,
  footer,
  style
}) {
  const up = delta > 0,
    flat = !delta;
  const good = invertDelta ? !up : up;
  const col = flat ? 'var(--fg-3)' : good ? 'var(--positive)' : 'var(--negative)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      padding: 'var(--card-padding)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: 'var(--type-label)',
      color: 'var(--fg-2)'
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-3)',
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, label)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 12,
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-metric)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--fg-1)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap'
    }
  }, value), (delta != null || comparison) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      font: 'var(--type-body-sm)',
      flexWrap: 'wrap'
    }
  }, delta != null && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      color: col,
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums'
    }
  }, !flat && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: up ? 'arrow-up-right' : 'arrow-down-right',
    size: 14,
    strokeWidth: 2
  }), up ? '+' : '', delta, deltaSuffix), comparison && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-3)'
    }
  }, comparison))), trend && /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    data: trend,
    color: flat ? 'var(--chart-6)' : good ? 'var(--positive)' : 'var(--negative)',
    width: 88,
    height: 32
  })), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border-subtle)',
      paddingTop: 10,
      font: 'var(--type-body-sm)',
      color: 'var(--fg-2)'
    }
  }, footer));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data/Timeline.jsx
try { (() => {
const T = {
  neutral: ['var(--surface-sunken)', 'var(--fg-2)'],
  accent: ['var(--accent-subtle)', 'var(--accent-subtle-fg)'],
  success: ['var(--success-subtle)', 'var(--success-fg)'],
  warning: ['var(--warning-subtle)', 'var(--warning-fg)'],
  danger: ['var(--danger-subtle)', 'var(--danger-fg)'],
  info: ['var(--info-subtle)', 'var(--info-fg)']
};
function Timeline({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("ol", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      ...style
    }
  }, items.map((it, i) => {
    const [bg, fg] = T[it.tone] || T.neutral;
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement("li", {
      key: it.id ?? i,
      style: {
        display: 'grid',
        gridTemplateColumns: '28px minmax(0,1fr)',
        gap: 12,
        position: 'relative'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        display: 'flex',
        justifyContent: 'center'
      }
    }, !last && /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: 28,
        bottom: 0,
        width: 1,
        background: 'var(--border)'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--surface)',
        boxShadow: '0 0 0 1px var(--border)',
        position: 'relative'
      }
    }, it.avatar || /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon || 'circle-dot',
      size: 14
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingBottom: last ? 0 : 20,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12,
        alignItems: 'baseline',
        justifyContent: 'space-between',
        minHeight: 28,
        paddingTop: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: 'var(--type-body)',
        color: 'var(--fg-2)',
        minWidth: 0
      }
    }, it.actor && /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 600,
        color: 'var(--fg-1)'
      }
    }, it.actor, " "), it.title), it.time && /*#__PURE__*/React.createElement("time", {
      style: {
        font: '400 12px/1 var(--font-mono)',
        color: 'var(--fg-3)',
        whiteSpace: 'nowrap',
        flex: 'none'
      }
    }, it.time)), it.description && /*#__PURE__*/React.createElement("div", {
      style: {
        font: 'var(--type-body-sm)',
        color: 'var(--fg-3)',
        marginTop: 2
      }
    }, it.description), it.meta && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8
      }
    }, it.meta)));
  }));
}
Object.assign(__ds_scope, { Timeline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Timeline.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
const T = {
  neutral: ['var(--surface-raised)', 'var(--fg-2)', 'var(--border)', 'info'],
  info: ['var(--info-subtle)', 'var(--info-fg)', 'var(--info-border)', 'info'],
  success: ['var(--success-subtle)', 'var(--success-fg)', 'var(--success-border)', 'circle-check'],
  warning: ['var(--warning-subtle)', 'var(--warning-fg)', 'var(--warning-border)', 'triangle-alert'],
  danger: ['var(--danger-subtle)', 'var(--danger-fg)', 'var(--danger-border)', 'circle-alert']
};
function Alert({
  tone = 'info',
  title,
  children,
  action,
  onClose,
  style
}) {
  const [bg, fg, bd, ic] = T[tone] || T.info;
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      padding: '10px 12px',
      background: bg,
      border: `1px solid ${bd}`,
      borderRadius: 'var(--radius-card)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: fg,
      marginTop: 2,
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ic,
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 13px/20px var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      lineHeight: '20px',
      color: 'var(--fg-2)'
    }
  }, children)), action && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 'none'
    }
  }, action), onClose && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Dismiss",
    onClick: onClose,
    style: {
      border: 0,
      background: 'none',
      padding: 2,
      color: 'var(--fg-3)',
      cursor: 'pointer',
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  })));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  compact = false,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 12,
      padding: compact ? '24px 16px' : '48px 24px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 'var(--radius-lg)',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 360
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-card-title)',
      color: 'var(--fg-1)'
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)',
      marginTop: 4
    }
  }, description)), action);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton.jsx
try { (() => {
function Skeleton({
  width = '100%',
  height = 12,
  radius = 4,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      display: 'block',
      width,
      height,
      borderRadius: radius,
      background: 'linear-gradient(90deg,var(--surface-sunken) 0%,var(--border-subtle) 50%,var(--surface-sunken) 100%)',
      backgroundSize: '200% 100%',
      animation: 'nns-shimmer 1.4s ease-in-out infinite',
      ...style
    }
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes nns-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}'));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const T = {
  neutral: ['var(--surface-raised)', 'var(--fg-2)', 'var(--border)', 'info'],
  info: ['var(--info-subtle)', 'var(--info-fg)', 'var(--info-border)', 'info'],
  success: ['var(--success-subtle)', 'var(--success-fg)', 'var(--success-border)', 'circle-check'],
  warning: ['var(--warning-subtle)', 'var(--warning-fg)', 'var(--warning-border)', 'triangle-alert'],
  danger: ['var(--danger-subtle)', 'var(--danger-fg)', 'var(--danger-border)', 'circle-alert']
};
function Toast({
  tone = 'neutral',
  title,
  description,
  action,
  onClose,
  style
}) {
  const [, fg,, ic] = T[tone] || T.neutral;
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      width: 360,
      maxWidth: '100%',
      padding: '12px 14px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-3)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: tone === 'neutral' ? 'var(--fg-2)' : fg,
      marginTop: 2,
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ic,
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 13px/20px var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-2)'
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, action)), onClose && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Dismiss",
    onClick: onClose,
    style: {
      border: 0,
      background: 'none',
      padding: 2,
      color: 'var(--fg-3)',
      cursor: 'pointer',
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  })));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  description,
  disabled = false,
  style
}) {
  const on = checked || indeterminate;
  const box = /*#__PURE__*/React.createElement("span", {
    role: "checkbox",
    "aria-checked": indeterminate ? 'mixed' : checked,
    tabIndex: disabled ? -1 : 0,
    onKeyDown: e => {
      if (e.key === ' ') {
        e.preventDefault();
        !disabled && onChange && onChange(!checked);
      }
    },
    onClick: e => {
      e.stopPropagation();
      !disabled && onChange && onChange(!checked);
    },
    style: {
      width: 16,
      height: 16,
      flex: 'none',
      display: 'grid',
      placeItems: 'center',
      borderRadius: 'var(--radius-sm)',
      border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
      background: on ? 'var(--accent)' : 'var(--surface)',
      color: '#fff',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      transition: 'background var(--duration-fast),border-color var(--duration-fast)',
      marginTop: label ? 2 : 0
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 5h6",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  })) : checked ? /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1.8 5.2 4 7.3 8.2 2.8",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })) : null);
  if (!label) return box;
  return /*#__PURE__*/React.createElement("label", {
    onClick: e => {
      e.preventDefault();
      !disabled && onChange && onChange(!checked);
    },
    style: {
      display: 'inline-flex',
      gap: 8,
      alignItems: 'flex-start',
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, box, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-label)',
      color: disabled ? 'var(--fg-disabled)' : 'var(--fg-1)',
      lineHeight: '20px'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-caption)',
      color: 'var(--fg-3)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
const arrow = dir => /*#__PURE__*/React.createElement("svg", {
  width: "12",
  height: "12",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, dir === 'asc' ? /*#__PURE__*/React.createElement("path", {
  d: "m18 15-6-6-6 6"
}) : dir === 'desc' ? /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
}) : /*#__PURE__*/React.createElement("path", {
  d: "m7 15 5 5 5-5M7 9l5-5 5 5"
}));
function Row({
  row,
  cols,
  i,
  k,
  sel,
  selectable,
  onToggle,
  onRowClick,
  h
}) {
  const [hv, sh] = React.useState(false);
  return /*#__PURE__*/React.createElement("tr", {
    onClick: onRowClick ? () => onRowClick(row) : undefined,
    onMouseEnter: () => sh(true),
    onMouseLeave: () => sh(false),
    style: {
      height: h,
      background: sel ? 'var(--surface-selected)' : hv && onRowClick ? 'var(--surface-hover)' : 'transparent',
      cursor: onRowClick ? 'pointer' : 'default',
      transition: 'background var(--duration-instant)'
    }
  }, selectable && /*#__PURE__*/React.createElement("td", {
    style: {
      width: 40,
      padding: '0 0 0 16px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: sel,
    onChange: () => onToggle(k)
  })), cols.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      padding: '0 16px',
      textAlign: c.align || 'left',
      font: c.mono ? 'var(--type-mono)' : 'var(--type-body)',
      fontSize: c.mono ? 12 : 13,
      color: c.muted ? 'var(--fg-2)' : 'var(--fg-1)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: c.wrap ? 'normal' : 'nowrap',
      borderBottom: '1px solid var(--border-subtle)',
      maxWidth: c.maxWidth,
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, c.render ? c.render(row, i) : row[c.key])));
}
function DataTable({
  columns = [],
  rows = [],
  rowKey = 'id',
  selectable = false,
  selected = [],
  onSelectionChange,
  onRowClick,
  sort,
  onSortChange,
  density = 'default',
  stickyHeader = false,
  empty,
  loading = false,
  style
}) {
  const h = {
    compact: 36,
    default: 44,
    relaxed: 52
  }[density] || 44;
  const keys = rows.map((r, i) => r[rowKey] ?? i);
  const all = keys.length > 0 && keys.every(k => selected.includes(k));
  const some = !all && keys.some(k => selected.includes(k));
  const toggle = k => onSelectionChange && onSelectionChange(selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k]);
  const toggleAll = () => onSelectionChange && onSelectionChange(all ? selected.filter(k => !keys.includes(k)) : [...new Set([...selected, ...keys])]);
  const th = {
    position: stickyHeader ? 'sticky' : 'static',
    top: 0,
    zIndex: 1,
    height: 36,
    padding: '0 16px',
    background: 'var(--surface-sunken)',
    borderBottom: '1px solid var(--border)',
    font: '500 12px/1 var(--font-sans)',
    color: 'var(--fg-2)',
    whiteSpace: 'nowrap'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto',
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'separate',
      borderSpacing: 0
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      ...th,
      width: 40,
      padding: '0 0 0 16px'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: all,
    indeterminate: some,
    onChange: toggleAll
  })), columns.map(c => {
    const active = sort && sort.key === c.key;
    return /*#__PURE__*/React.createElement("th", {
      key: c.key,
      style: {
        ...th,
        textAlign: c.align || 'left',
        width: c.width
      }
    }, c.sortable ? /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => onSortChange && onSortChange({
        key: c.key,
        dir: active && sort.dir === 'asc' ? 'desc' : 'asc'
      }),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: 0,
        padding: 0,
        background: 'none',
        font: 'inherit',
        color: active ? 'var(--fg-1)' : 'inherit',
        cursor: 'pointer',
        flexDirection: c.align === 'right' ? 'row-reverse' : 'row'
      }
    }, c.header, /*#__PURE__*/React.createElement("span", {
      style: {
        opacity: active ? 1 : .45
      }
    }, arrow(active ? sort.dir : null))) : c.header);
  }))), /*#__PURE__*/React.createElement("tbody", null, loading ? Array.from({
    length: 5
  }, (_, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      height: h
    }
  }, selectable && /*#__PURE__*/React.createElement("td", {
    style: {
      borderBottom: '1px solid var(--border-subtle)'
    }
  }), columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      padding: '0 16px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: 10,
      width: `${40 + (i * 7 + c.key.length * 13) % 45}%`,
      borderRadius: 4,
      background: 'var(--surface-sunken)'
    }
  }))))) : rows.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length + (selectable ? 1 : 0),
    style: {
      padding: '48px 16px',
      textAlign: 'center',
      color: 'var(--fg-3)',
      font: 'var(--type-body)'
    }
  }, empty || 'No results')) : rows.map((r, i) => /*#__PURE__*/React.createElement(Row, {
    key: keys[i],
    row: r,
    i: i,
    k: keys[i],
    cols: columns,
    sel: selected.includes(keys[i]),
    selectable: selectable,
    onToggle: toggle,
    onRowClick: onRowClick,
    h: h
  })))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: htmlFor,
    style: {
      font: 'var(--type-label)',
      color: 'var(--fg-1)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--danger)',
      marginLeft: 2
    }
  }, "*")), children, (error || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-caption)',
      color: error ? 'var(--danger-fg)' : 'var(--fg-3)'
    }
  }, error || hint));
}
function Input({
  label,
  hint,
  error,
  required,
  size = 'md',
  iconLeft,
  suffix,
  disabled = false,
  id,
  style,
  inputStyle,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  const h = {
    sm: 28,
    md: 32,
    lg: 40
  }[size] || 32;
  const iid = id || React.useId();
  const box = /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: h,
      padding: '0 10px',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface)',
      border: `1px solid ${error ? 'var(--danger)' : f ? 'var(--border-focus)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-control)',
      boxShadow: f ? error ? '0 0 0 3px color-mix(in oklab,var(--danger) 22%,transparent)' : 'var(--focus-ring)' : 'var(--shadow-1)',
      transition: 'border-color var(--duration-fast) var(--ease-out),box-shadow var(--duration-fast) var(--ease-out)',
      color: 'var(--fg-3)',
      opacity: disabled ? .6 : 1,
      minWidth: 0,
      ...style
    }
  }, iconLeft, /*#__PURE__*/React.createElement("input", _extends({
    id: iid,
    disabled: disabled,
    required: required,
    onFocus: () => setF(true),
    onBlur: () => setF(false)
  }, rest, {
    style: {
      flex: 1,
      minWidth: 0,
      height: '100%',
      border: 0,
      outline: 0,
      background: 'transparent',
      font: `400 ${size === 'lg' ? 14 : 13}px/1 var(--font-sans)`,
      color: 'var(--fg-1)',
      boxShadow: 'none',
      padding: 0,
      ...inputStyle
    }
  })), suffix);
  return label || hint || error ? /*#__PURE__*/React.createElement(Field, {
    label: label,
    hint: hint,
    error: error,
    required: required,
    htmlFor: iid
  }, box) : box;
}
Object.assign(__ds_scope, { Field, Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function Radio({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  style
}) {
  const dot = /*#__PURE__*/React.createElement("span", {
    role: "radio",
    "aria-checked": checked,
    style: {
      width: 16,
      height: 16,
      flex: 'none',
      borderRadius: '50%',
      border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
      background: 'var(--surface)',
      display: 'grid',
      placeItems: 'center',
      marginTop: label ? 2 : 0,
      transition: 'border-color var(--duration-fast)'
    }
  }, checked && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--accent)'
    }
  }));
  return /*#__PURE__*/React.createElement("label", {
    onClick: e => {
      e.preventDefault();
      !disabled && onChange && onChange(true);
    },
    style: {
      display: 'inline-flex',
      gap: 8,
      alignItems: 'flex-start',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      ...style
    }
  }, dot, label && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-label)',
      color: 'var(--fg-1)',
      lineHeight: '20px'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-caption)',
      color: 'var(--fg-3)'
    }
  }, description)));
}
function RadioGroup({
  options = [],
  value,
  onChange,
  direction = 'column',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: direction,
      gap: direction === 'row' ? 20 : 10,
      ...style
    }
  }, options.map(o => /*#__PURE__*/React.createElement(Radio, {
    key: o.value,
    checked: value === o.value,
    onChange: () => onChange && onChange(o.value),
    label: o.label,
    description: o.description,
    disabled: o.disabled
  })));
}
Object.assign(__ds_scope, { Radio, RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  style
}) {
  const h = size === 'sm' ? 28 : 32;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'inline-flex',
      padding: 2,
      gap: 2,
      height: h,
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-control)',
      flex: 'none',
      ...style
    }
  }, options.map(o => {
    const v = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    const on = v.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v.value,
      type: "button",
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(v.value),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        border: 0,
        borderRadius: 4,
        background: on ? 'var(--surface)' : 'transparent',
        boxShadow: on ? 'var(--shadow-1), 0 0 0 1px var(--border)' : 'none',
        color: on ? 'var(--fg-1)' : 'var(--fg-2)',
        font: `500 ${size === 'sm' ? 12 : 13}px/1 var(--font-sans)`,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background var(--duration-fast),color var(--duration-fast)'
      }
    }, v.icon, v.label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  hint,
  error,
  required,
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder,
  size = 'md',
  disabled = false,
  id,
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  const h = {
    sm: 28,
    md: 32,
    lg: 40
  }[size] || 32;
  const iid = id || React.useId();
  const el = /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: iid,
    value: value,
    defaultValue: defaultValue,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.value, e),
    onFocus: () => setF(true),
    onBlur: () => setF(false)
  }, rest, {
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      height: h,
      padding: '0 30px 0 10px',
      font: `400 ${size === 'lg' ? 14 : 13}px/1 var(--font-sans)`,
      color: 'var(--fg-1)',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface)',
      border: `1px solid ${error ? 'var(--danger)' : f ? 'var(--border-focus)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-control)',
      boxShadow: f ? 'var(--focus-ring)' : 'var(--shadow-1)',
      outline: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .6 : 1
    }
  }), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), options.map(o => {
    const v = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v.value,
      value: v.value
    }, v.label);
  })), /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: 'absolute',
      right: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  })));
  return label || hint || error ? /*#__PURE__*/React.createElement(__ds_scope.Field, {
    label: label,
    hint: hint,
    error: error,
    required: required,
    htmlFor: iid
  }, el) : el;
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  checked = false,
  onChange,
  label,
  description,
  size = 'md',
  disabled = false,
  style
}) {
  const w = size === 'sm' ? 28 : 34,
    h = size === 'sm' ? 16 : 20,
    k = h - 4;
  const sw = /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": checked,
    tabIndex: disabled ? -1 : 0,
    onKeyDown: e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        !disabled && onChange && onChange(!checked);
      }
    },
    onClick: e => {
      e.stopPropagation();
      e.preventDefault();
      !disabled && onChange && onChange(!checked);
    },
    style: {
      width: w,
      height: h,
      flex: 'none',
      borderRadius: 999,
      background: checked ? 'var(--accent)' : 'var(--gray-200)',
      position: 'relative',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      transition: 'background var(--duration-fast) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? w - k - 2 : 2,
      width: k,
      height: k,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.2)',
      transition: 'left var(--duration-base) var(--ease-out)'
    }
  }));
  if (!label) return sw;
  return /*#__PURE__*/React.createElement("label", {
    onClick: e => {
      e.preventDefault();
      !disabled && onChange && onChange(!checked);
    },
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-label)',
      color: 'var(--fg-1)',
      lineHeight: '20px'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      font: 'var(--type-caption)',
      color: 'var(--fg-3)'
    }
  }, description)), sw);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  label,
  hint,
  error,
  required,
  rows = 4,
  disabled = false,
  id,
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  const iid = id || React.useId();
  const el = /*#__PURE__*/React.createElement("textarea", _extends({
    id: iid,
    rows: rows,
    disabled: disabled,
    onFocus: () => setF(true),
    onBlur: () => setF(false)
  }, rest, {
    style: {
      width: '100%',
      resize: 'vertical',
      padding: '8px 10px',
      font: '400 13px/1.5 var(--font-sans)',
      color: 'var(--fg-1)',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface)',
      border: `1px solid ${error ? 'var(--danger)' : f ? 'var(--border-focus)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-control)',
      boxShadow: f ? 'var(--focus-ring)' : 'var(--shadow-1)',
      outline: 0,
      transition: 'border-color var(--duration-fast),box-shadow var(--duration-fast)',
      ...style
    }
  }));
  return label || hint || error ? /*#__PURE__*/React.createElement(__ds_scope.Field, {
    label: label,
    hint: hint,
    error: error,
    required: required,
    htmlFor: iid
  }, el) : el;
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumbs.jsx
try { (() => {
function Breadcrumbs({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("ol", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      listStyle: 'none',
      margin: 0,
      padding: 0,
      font: '500 13px/1 var(--font-sans)',
      minWidth: 0,
      ...style
    }
  }, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: last ? {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0
      } : {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flex: 'none'
      }
    }, last ? /*#__PURE__*/React.createElement("span", {
      "aria-current": "page",
      style: {
        color: 'var(--fg-1)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || '#',
      onClick: e => {
        if (it.onClick) {
          e.preventDefault();
          it.onClick();
        }
      },
      style: {
        color: 'var(--fg-3)',
        textDecoration: 'none',
        whiteSpace: 'nowrap'
      }
    }, it.label), !last && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--gray-300)'
      }
    }, "/"));
  }));
}
Object.assign(__ds_scope, { Breadcrumbs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumbs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader.jsx
try { (() => {
function PageHeader({
  title,
  description,
  actions,
  meta,
  eyebrow,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 320px',
      minWidth: 0
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 6
    }
  }, eyebrow), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: 'var(--type-page-title)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--fg-1)'
    }
  }, title), meta), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      font: 'var(--type-body)',
      color: 'var(--fg-2)',
      maxWidth: 720
    }
  }, description)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, actions)), children);
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
const btn = (on, dis) => ({
  minWidth: 28,
  height: 28,
  padding: '0 6px',
  display: 'inline-grid',
  placeItems: 'center',
  border: `1px solid ${on ? 'var(--border-strong)' : 'transparent'}`,
  borderRadius: 'var(--radius-control)',
  background: on ? 'var(--surface)' : 'transparent',
  boxShadow: on ? 'var(--shadow-1)' : 'none',
  color: dis ? 'var(--fg-disabled)' : on ? 'var(--fg-1)' : 'var(--fg-2)',
  font: `${on ? 600 : 500} 13px/1 var(--font-sans)`,
  fontVariantNumeric: 'tabular-nums',
  cursor: dis ? 'not-allowed' : 'pointer'
});
const chev = d => /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: d
}));
function Pagination({
  page = 1,
  pageCount = 1,
  total,
  pageSize = 25,
  onPageChange,
  style
}) {
  const go = p => p >= 1 && p <= pageCount && p !== page && onPageChange && onPageChange(p);
  const pages = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  const from = (page - 1) * pageSize + 1,
    to = Math.min(page * pageSize, total ?? page * pageSize);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      ...style
    }
  }, total != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, from.toLocaleString('en-US'), "\u2013", to.toLocaleString('en-US'), " of ", total.toLocaleString('en-US')) : /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 2,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Previous page",
    onClick: () => go(page - 1),
    style: btn(false, page <= 1)
  }, chev('m15 18-6-6 6-6')), pages.map((p, i) => p === '…' ? /*#__PURE__*/React.createElement("span", {
    key: 'e' + i,
    style: {
      width: 20,
      textAlign: 'center',
      color: 'var(--fg-3)'
    }
  }, "\u2026") : /*#__PURE__*/React.createElement("button", {
    key: p,
    type: "button",
    onClick: () => go(p),
    "aria-current": p === page ? 'page' : undefined,
    style: btn(p === page, false)
  }, p)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Next page",
    onClick: () => go(page + 1),
    style: btn(false, page >= pageCount)
  }, chev('m9 18 6-6-6-6'))));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Sidebar.jsx
try { (() => {
function Item({
  it,
  active,
  collapsed,
  onSelect
}) {
  const [h, sh] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: collapsed ? it.label : undefined,
    onClick: () => onSelect && onSelect(it.id),
    onMouseEnter: () => sh(true),
    onMouseLeave: () => sh(false),
    "aria-current": active ? 'page' : undefined,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      height: 32,
      padding: collapsed ? 0 : '0 10px',
      justifyContent: collapsed ? 'center' : 'flex-start',
      border: 0,
      borderRadius: 'var(--radius-control)',
      background: active ? 'var(--sidebar-active-bg)' : h ? 'var(--control-hover)' : 'transparent',
      color: active ? 'var(--sidebar-active-fg)' : 'var(--sidebar-fg)',
      font: `${active ? 600 : 500} 13px/1 var(--font-sans)`,
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'background var(--duration-fast)'
    }
  }, it.icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: active ? 'var(--accent)' : 'inherit',
      display: 'grid'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 16
  })), !collapsed && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, it.label), !collapsed && it.badge != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 11px/1 var(--font-mono)',
      padding: '3px 6px',
      borderRadius: 'var(--radius-sm)',
      background: active ? 'var(--surface)' : 'var(--surface-sunken)',
      color: 'var(--fg-2)',
      border: '1px solid var(--border)'
    }
  }, it.badge));
}
function Sidebar({
  header,
  sections = [],
  activeId,
  onSelect,
  footer,
  collapsed = false,
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
      flex: 'none',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border)',
      transition: 'width var(--duration-base) var(--ease-out)',
      overflow: 'hidden',
      ...style
    }
  }, header && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--topbar-height)',
      display: 'flex',
      alignItems: 'center',
      padding: collapsed ? 0 : '0 16px',
      justifyContent: collapsed ? 'center' : 'flex-start',
      borderBottom: '1px solid var(--border)',
      flex: 'none'
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: collapsed ? '12px 8px' : '12px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, sections.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, s.title && !collapsed && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-overline)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-caps)',
      color: 'var(--fg-3)',
      padding: '4px 10px 6px'
    }
  }, s.title), s.items.map(it => /*#__PURE__*/React.createElement(Item, {
    key: it.id,
    it: it,
    active: it.id === activeId,
    collapsed: collapsed,
    onSelect: onSelect
  }))))), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border)',
      padding: collapsed ? 8 : 10,
      flex: 'none'
    }
  }, footer));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Sidebar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      gap: 20,
      borderBottom: '1px solid var(--border)',
      overflowX: 'auto',
      overflowY: 'hidden',
      ...style
    }
  }, tabs.map(t => {
    const v = typeof t === 'string' ? {
      value: t,
      label: t
    } : t;
    const on = v.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v.value,
      role: "tab",
      "aria-selected": on,
      type: "button",
      onClick: () => onChange && onChange(v.value),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 38,
        padding: 0,
        marginBottom: -1,
        border: 0,
        borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
        background: 'transparent',
        color: on ? 'var(--fg-1)' : 'var(--fg-3)',
        font: `${on ? 600 : 500} 13px/1 var(--font-sans)`,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'color var(--duration-fast),border-color var(--duration-fast)'
      }
    }, v.label, v.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        font: '500 11px/1 var(--font-mono)',
        padding: '3px 5px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        color: 'var(--fg-2)'
      }
    }, v.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Topbar.jsx
try { (() => {
function Topbar({
  left,
  center,
  right,
  sticky = true,
  style
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--topbar-height)',
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '0 var(--page-padding)',
      background: 'color-mix(in oklab,var(--surface) 88%,transparent)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--border)',
      position: sticky ? 'sticky' : 'relative',
      top: 0,
      zIndex: 'var(--z-sticky)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 200,
      flex: '1 1 auto'
    }
  }, left), center && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 1 320px',
      minWidth: 160
    }
  }, center), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 'none',
      justifyContent: 'flex-end'
    }
  }, right));
}
Object.assign(__ds_scope, { Topbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Topbar.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Dialog.jsx
try { (() => {
function Dialog({
  open = true,
  title,
  description,
  children,
  actions,
  onClose,
  width = 480,
  tone,
  inline = false
}) {
  React.useEffect(() => {
    if (!open || inline || !onClose) return;
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, inline, onClose]);
  if (!open) return null;
  const panel = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      background: 'var(--surface-raised)',
      color: 'var(--fg-1)',
      borderRadius: 'var(--radius-dialog)',
      boxShadow: 'var(--shadow-3)',
      border: '1px solid var(--border)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 20px 0',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start'
    }
  }, tone === 'danger' && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: 'var(--danger-subtle)',
      color: 'var(--danger-fg)',
      display: 'grid',
      placeItems: 'center',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: '600 16px/1.4 var(--font-sans)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      font: 'var(--type-body)',
      color: 'var(--fg-2)'
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Close",
    onClick: onClose,
    style: {
      width: 28,
      height: 28,
      margin: '-4px -6px 0 0',
      border: 0,
      background: 'transparent',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      color: 'var(--fg-3)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), children && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px 0'
    }
  }, children), actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '16px 20px',
      marginTop: 20,
      background: 'var(--surface-sunken)',
      borderTop: '1px solid var(--border)'
    }
  }, actions) : /*#__PURE__*/React.createElement("div", {
    style: {
      height: 20
    }
  }));
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'var(--overlay)',
      display: 'grid',
      placeItems: 'center',
      padding: 24
    }
  }, panel);
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Drawer.jsx
try { (() => {
function Drawer({
  open = true,
  title,
  description,
  children,
  footer,
  onClose,
  width = 480,
  inline = false,
  style
}) {
  React.useEffect(() => {
    if (!open || inline || !onClose) return;
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, inline, onClose]);
  if (!open) return null;
  const panel = /*#__PURE__*/React.createElement("aside", {
    role: "dialog",
    "aria-modal": !inline,
    style: {
      width: '100%',
      maxWidth: width,
      height: '100%',
      background: 'var(--surface-raised)',
      borderLeft: '1px solid var(--border)',
      boxShadow: inline ? 'none' : 'var(--shadow-3)',
      display: 'flex',
      flexDirection: 'column',
      marginLeft: 'auto',
      animation: inline ? 'none' : 'nns-drawer-in var(--duration-slow) var(--ease-out)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes nns-drawer-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}'), /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '16px 20px',
      borderBottom: '1px solid var(--border)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      font: '600 16px/1.4 var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)'
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Close",
    onClick: onClose,
    style: {
      width: 28,
      height: 28,
      border: 0,
      background: 'transparent',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      color: 'var(--fg-3)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 20
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '12px 20px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface-sunken)',
      flex: 'none'
    }
  }, footer));
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-drawer)',
      background: 'var(--overlay)',
      display: 'flex'
    }
  }, panel);
}
Object.assign(__ds_scope, { Drawer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Drawer.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Menu.jsx
try { (() => {
function MI({
  it,
  close
}) {
  const [h, sh] = React.useState(false);
  if (it.divider) return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--border)',
      margin: '4px 0'
    }
  });
  if (it.heading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 10px 4px',
      font: 'var(--type-overline)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-caps)',
      color: 'var(--fg-3)'
    }
  }, it.heading);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: it.disabled,
    onMouseEnter: () => sh(true),
    onMouseLeave: () => sh(false),
    onClick: () => {
      it.onSelect && it.onSelect();
      close();
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      height: 32,
      padding: '0 10px',
      border: 0,
      borderRadius: 4,
      background: h && !it.disabled ? it.danger ? 'var(--danger-subtle)' : 'var(--control-hover)' : 'transparent',
      color: it.disabled ? 'var(--fg-disabled)' : it.danger ? 'var(--danger-fg)' : 'var(--fg-1)',
      font: '400 13px/1 var(--font-sans)',
      textAlign: 'left',
      cursor: it.disabled ? 'not-allowed' : 'pointer'
    }
  }, it.icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      color: it.danger ? 'inherit' : 'var(--fg-3)'
    }
  }, it.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, it.label), it.shortcut && /*#__PURE__*/React.createElement("kbd", {
    style: {
      font: '400 11px/1 var(--font-mono)',
      color: 'var(--fg-3)'
    }
  }, it.shortcut));
}
function Menu({
  trigger,
  items = [],
  align = 'end',
  width = 200,
  open: ctrl,
  onOpenChange,
  style
}) {
  const [o, setO] = React.useState(false);
  const open = ctrl ?? o;
  const set = v => {
    setO(v);
    onOpenChange && onOpenChange(v);
  };
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const f = e => {
      if (ref.current && !ref.current.contains(e.target)) set(false);
    };
    const k = e => e.key === 'Escape' && set(false);
    document.addEventListener('mousedown', f);
    window.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', f);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => set(!open),
    style: {
      display: 'inline-flex'
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      [align === 'end' ? 'right' : 'left']: 0,
      width,
      padding: 4,
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-3)',
      zIndex: 'var(--z-dropdown)'
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement(MI, {
    key: i,
    it: it,
    close: () => set(false)
  }))));
}
Object.assign(__ds_scope, { Menu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Menu.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Tooltip.jsx
try { (() => {
function Tooltip({
  content,
  side = 'top',
  children,
  open: force
}) {
  const [o, setO] = React.useState(false);
  const open = force ?? o;
  const pos = {
    top: {
      bottom: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)'
    },
    bottom: {
      top: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)'
    },
    left: {
      right: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)'
    },
    right: {
      left: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)'
    }
  }[side];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setO(true),
    onMouseLeave: () => setO(false),
    onFocus: () => setO(true),
    onBlur: () => setO(false)
  }, children, open && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      ...pos,
      zIndex: 'var(--z-tooltip)',
      padding: '5px 8px',
      background: 'var(--surface-inverse)',
      color: 'var(--fg-inverse)',
      font: '500 12px/1.35 var(--font-sans)',
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      boxShadow: 'var(--shadow-2)'
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Tooltip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/AuditLog.jsx
try { (() => {
function AuditLogScreen() {
  const {
    PageHeader,
    Button,
    Icon,
    Input,
    Select,
    SegmentedControl,
    Card,
    Timeline,
    Drawer,
    DescriptionList,
    Badge
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const D = window.ADMIN_DATA;
  const [q, setQ] = React.useState('');
  const [actor, setActor] = React.useState('all');
  const [sev, setSev] = React.useState('All');
  const [open, setOpen] = React.useState(null);
  const sevMap = {
    All: null,
    Security: ['danger'],
    Changes: ['info', 'success', 'accent', 'warning']
  };
  const groups = D.audit.map(g => ({
    ...g,
    items: g.items.filter(it => (actor === 'all' || it.actor === actor) && (!sevMap[sev] || sevMap[sev].includes(it.tone)) && (!q || (it.title + it.actor + it.target).toLowerCase().includes(q.toLowerCase()))).map(it => ({
      ...it,
      title: /*#__PURE__*/React.createElement("span", null, it.title, " ", /*#__PURE__*/React.createElement("button", {
        onClick: () => setOpen(it),
        style: {
          border: 0,
          background: 'none',
          padding: 0,
          font: '500 12px var(--font-sans)',
          color: 'var(--fg-3)',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          cursor: 'pointer'
        }
      }, "Details")),
      meta: it.diff ? /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement(Badge, {
        mono: true,
        size: "sm",
        tone: "danger"
      }, "\u2212 ", it.diff[0]), /*#__PURE__*/React.createElement(Badge, {
        mono: true,
        size: "sm",
        tone: "success"
      }, "+ ", it.diff[1])) : null
    }))
  })).filter(g => g.items.length);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Audit log",
    description: "Every admin and system action. Retained for 400 days, read-only.",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 14
      })
    }, "Export JSON")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 14
    }),
    placeholder: "Search action, actor or target ID",
    value: q,
    onChange: e => setQ(e.target.value),
    style: {
      width: 300
    }
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: actor,
    onChange: setActor,
    options: [{
      value: 'all',
      label: 'All actors'
    }, 'Jan Nowak', 'Marta Kowalska', 'Tomasz Wójcik', 'System'],
    style: {
      width: 150
    }
  }), /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "sm",
    options: ['All', 'Security', 'Changes'],
    value: sev,
    onChange: setSev
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)'
    }
  }, "Times in UTC")), groups.map(g => /*#__PURE__*/React.createElement(Card, {
    key: g.day,
    title: g.day,
    subtitle: g.items.length + ' events'
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: g.items
  }))), !groups.length && /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 32,
      color: 'var(--fg-3)'
    }
  }, "No events match these filters.")), /*#__PURE__*/React.createElement(Drawer, {
    open: !!open,
    onClose: () => setOpen(null),
    title: open && open.actor + ' ' + (typeof open.title === 'string' ? open.title : ''),
    description: open && open.time + ' UTC · ' + open.id,
    footer: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "copy",
        size: 14
      })
    }, "Copy JSON")
  }, open && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(DescriptionList, {
    labelWidth: 90,
    items: [{
      label: 'Event',
      value: open.kind,
      mono: true
    }, {
      label: 'Event ID',
      value: open.id,
      mono: true,
      copyable: true
    }, {
      label: 'Actor',
      value: open.actor
    }, {
      label: 'Target',
      value: open.target,
      mono: true,
      copyable: true
    }, {
      label: 'IP address',
      value: open.ip,
      mono: true
    }, {
      label: 'Time',
      value: open.time + ' UTC'
    }]
  }), /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      padding: 12,
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-control)',
      font: 'var(--type-mono)',
      fontSize: 12,
      color: 'var(--fg-2)',
      overflowX: 'auto'
    }
  }, JSON.stringify({
    id: open.id,
    type: open.kind,
    actor: open.actor,
    target: open.target,
    ip: open.ip,
    ...(open.diff ? {
      changes: {
        before: open.diff[0],
        after: open.diff[1]
      }
    } : {})
  }, null, 2)))));
}
window.AuditLogScreen = AuditLogScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/AuditLog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/Dashboard.jsx
try { (() => {
function DashboardScreen({
  onOpenUser,
  onNav
}) {
  const {
    PageHeader,
    SegmentedControl,
    Button,
    Icon,
    StatCard,
    Card,
    LineChart,
    DonutChart,
    BarChart,
    Timeline,
    Alert,
    IconButton,
    DataTable,
    Badge
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const D = window.ADMIN_DATA;
  const [range, setRange] = React.useState('30d');
  const [alert, setAlert] = React.useState(true);
  const n = range === '7d' ? 7 : range === '14d' ? 14 : 30;
  const labels = D.days.slice(-n);
  const st = {
    Paid: 'success',
    Pending: 'warning',
    Refunded: 'neutral',
    Failed: 'danger'
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Overview",
    description: "Platform health and revenue at a glance.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SegmentedControl, {
      options: ['7d', '14d', '30d'],
      value: range,
      onChange: setRange
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 14
      })
    }, "Export"))
  }), alert && /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Payment provider degraded since 13:20 UTC",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "external-link",
        size: 12
      })
    }, "Status page"),
    onClose: () => setAlert(false)
  }, "Card payments succeed, refunds are delayed up to 2 hours."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Revenue",
    icon: "wallet",
    value: "$48,210",
    delta: 12.4,
    comparison: 'vs previous ' + range,
    trend: D.rev.slice(-12)
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Active users",
    icon: "users",
    value: "1,040",
    delta: 3.2,
    comparison: 'vs previous ' + range,
    trend: [960, 972, 980, 990, 1001, 1012, 1020, 1040]
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Churn",
    icon: "user-minus",
    value: "2.1%",
    delta: 0.4,
    deltaSuffix: "pp",
    invertDelta: true,
    comparison: 'vs previous ' + range,
    trend: [1.6, 1.7, 1.7, 1.8, 2.0, 2.1]
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "p95 API latency",
    icon: "activity",
    value: "184 ms",
    delta: -6,
    invertDelta: true,
    comparison: 'vs previous ' + range,
    trend: [210, 204, 198, 196, 190, 184]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Revenue",
    subtitle: "Daily, USD",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      label: "More",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "more-horizontal"
      })
    })
  }, /*#__PURE__*/React.createElement(LineChart, {
    height: 240,
    labels: labels,
    series: [{
      name: 'This period',
      data: D.rev.slice(-n)
    }, {
      name: 'Previous period',
      data: D.prev.slice(-n),
      color: 'var(--chart-6)',
      dashed: true
    }],
    yFormat: v => '$' + (v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v)
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Users by status",
    subtitle: "1,284 total"
  }, /*#__PURE__*/React.createElement(DonutChart, {
    size: 140,
    thickness: 16,
    centerValue: "1,284",
    centerLabel: "Users",
    data: [{
      label: 'Active',
      value: 1040,
      color: 'var(--chart-3)'
    }, {
      label: 'Invited',
      value: 156,
      color: 'var(--chart-2)'
    }, {
      label: 'Pending',
      value: 42,
      color: 'var(--chart-4)'
    }, {
      label: 'Suspended',
      value: 46,
      color: 'var(--chart-1)'
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Signups by plan",
    subtitle: "Last 7 days"
  }, /*#__PURE__*/React.createElement(BarChart, {
    height: 200,
    stacked: true,
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    series: [{
      name: 'Pro',
      data: [42, 51, 48, 60, 55, 22, 18]
    }, {
      name: 'Team',
      data: [20, 24, 22, 28, 30, 10, 8]
    }, {
      name: 'Enterprise',
      data: [2, 1, 3, 2, 4, 0, 0]
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Recent activity",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-right",
        size: 14
      }),
      onClick: () => onNav('audit')
    }, "Audit log")
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: D.audit[0].items.slice(0, 3)
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Latest orders",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconRight: /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-right",
        size: 14
      })
    }, "All orders")
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: D.orders,
    onRowClick: () => {},
    columns: [{
      key: 'id',
      header: 'Order',
      mono: true
    }, {
      key: 'customer',
      header: 'Customer'
    }, {
      key: 'plan',
      header: 'Plan',
      muted: true
    }, {
      key: 'status',
      header: 'Status',
      render: o => /*#__PURE__*/React.createElement(Badge, {
        tone: st[o.status],
        dot: true
      }, o.status)
    }, {
      key: 'date',
      header: 'Date',
      muted: true
    }, {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: o => '$' + o.total.toLocaleString('en-US', {
        minimumFractionDigits: 2
      })
    }]
  })));
}
window.DashboardScreen = DashboardScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/Login.jsx
try { (() => {
function LoginScreen({
  onSignIn
}) {
  const {
    Logo,
    Input,
    Button,
    Icon,
    Checkbox
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const [busy, setBusy] = React.useState(false);
  const [rem, setRem] = React.useState(true);
  const submit = e => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      onSignIn();
    }, 700);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 24,
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 380,
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    size: 26,
    product: "Admin"
  })), /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-2)',
      padding: 28,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: '600 20px/1.3 var(--font-sans)',
      letterSpacing: '-0.015em'
    }
  }, "Sign in to back office"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)'
    }
  }, "Use your NotNullSoft staff account.")), /*#__PURE__*/React.createElement(Input, {
    label: "Work email",
    type: "email",
    defaultValue: "jan.nowak@notnullsoft.com",
    size: "lg"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    defaultValue: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    size: "lg",
    suffix: /*#__PURE__*/React.createElement("a", {
      href: "#",
      style: {
        font: '500 12px var(--font-sans)',
        whiteSpace: 'nowrap'
      }
    }, "Forgot?")
  }), /*#__PURE__*/React.createElement(Checkbox, {
    checked: rem,
    onChange: setRem,
    label: "Keep me signed in for 8 hours"
  }), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    variant: "accent",
    size: "lg",
    fullWidth: true,
    loading: busy
  }, "Sign in"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      font: 'var(--type-caption)',
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  }), "or", /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border)'
    }
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    fullWidth: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "key-round",
      size: 16
    }),
    onClick: onSignIn
  }, "Continue with SSO")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      textAlign: 'center',
      font: 'var(--type-caption)',
      color: 'var(--fg-3)'
    }
  }, "Restricted to NotNullSoft staff. Every sign-in is logged.")));
}
window.LoginScreen = LoginScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/Login.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/Settings.jsx
try { (() => {
function SettingsScreen({
  toast
}) {
  const {
    PageHeader,
    Tabs,
    Card,
    Input,
    Select,
    Switch,
    RadioGroup,
    Textarea,
    Button,
    Icon,
    Alert,
    Field,
    DataTable,
    Badge,
    IconButton
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const [tab, setTab] = React.useState('general');
  const [dirty, setDirty] = React.useState(false);
  const [s, setS] = React.useState({
    twofa: true,
    sso: false,
    ipAllow: false,
    digest: 'weekly',
    alerts: true,
    billing: true
  });
  const set = (k, v) => {
    setS(x => ({
      ...x,
      [k]: v
    }));
    setDirty(true);
  };
  const d = () => setDirty(true);
  const Row = ({
    title,
    desc,
    children
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)',
      gap: 24,
      padding: '20px 0',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-card-title)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--fg-3)',
      marginTop: 2
    }
  }, desc)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      maxWidth: 480
    }
  }, children));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Settings",
    description: "Organisation-wide configuration for the back office."
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'general',
      label: 'General'
    }, {
      value: 'security',
      label: 'Security'
    }, {
      value: 'notifications',
      label: 'Notifications'
    }, {
      value: 'api',
      label: 'API keys'
    }]
  })), tab === 'general' && /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    bodyStyle: {
      paddingTop: 4,
      paddingBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Row, {
    title: "Organisation",
    desc: "Shown on invoices and emails."
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Name",
    defaultValue: "NotNullSoft sp. z o.o.",
    onChange: d
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Billing email",
    type: "email",
    defaultValue: "billing@notnullsoft.com",
    onChange: d
  })), /*#__PURE__*/React.createElement(Row, {
    title: "Region & format",
    desc: "Affects dates, numbers and currency."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Timezone",
    defaultValue: "UTC",
    options: ['UTC', 'Europe/Warsaw', 'Europe/London'],
    onChange: d
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Currency",
    defaultValue: "USD",
    options: ['USD', 'EUR', 'PLN'],
    onChange: d
  }))), /*#__PURE__*/React.createElement(Row, {
    title: "Support footer",
    desc: "Appended to customer-facing emails."
  }, /*#__PURE__*/React.createElement(Textarea, {
    rows: 3,
    defaultValue: "Questions? Reply to this email \u2014 a human reads every message.",
    onChange: d
  }))), tab === 'security' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Alert, {
    tone: "info"
  }, "Changes here are recorded in the audit log."), /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    bodyStyle: {
      paddingTop: 4,
      paddingBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Row, {
    title: "Authentication",
    desc: "How staff sign in to the back office."
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: s.twofa,
    onChange: v => set('twofa', v),
    label: "Require two-factor authentication",
    description: "Applies to all admin and owner accounts."
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: s.sso,
    onChange: v => set('sso', v),
    label: "Enforce SSO",
    description: "Disable password sign-in for staff."
  })), /*#__PURE__*/React.createElement(Row, {
    title: "Session length",
    desc: "Staff are signed out after this period of inactivity."
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: "8 hours",
    options: ['1 hour', '8 hours', '24 hours', '7 days'],
    onChange: d
  })), /*#__PURE__*/React.createElement(Row, {
    title: "IP allowlist",
    desc: "Restrict back-office access to known networks."
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: s.ipAllow,
    onChange: v => set('ipAllow', v),
    label: "Only allow listed IP ranges"
  }), s.ipAllow && /*#__PURE__*/React.createElement(Textarea, {
    rows: 3,
    placeholder: '83.21.4.0/24\n91.150.2.8',
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12
    }
  })))), tab === 'notifications' && /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    bodyStyle: {
      paddingTop: 4,
      paddingBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Row, {
    title: "Digest",
    desc: "Summary of revenue, signups and incidents."
  }, /*#__PURE__*/React.createElement(RadioGroup, {
    value: s.digest,
    onChange: v => set('digest', v),
    options: [{
      value: 'daily',
      label: 'Daily',
      description: 'Every morning at 08:00'
    }, {
      value: 'weekly',
      label: 'Weekly',
      description: 'Mondays at 08:00'
    }, {
      value: 'off',
      label: 'Off'
    }]
  })), /*#__PURE__*/React.createElement(Row, {
    title: "Alerts",
    desc: "Sent immediately to owners."
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: s.alerts,
    onChange: v => set('alerts', v),
    label: "Security events",
    description: "Blocked sign-ins, role changes, key rotations."
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: s.billing,
    onChange: v => set('billing', v),
    label: "Failed payments",
    description: "When a renewal fails twice."
  }))), tab === 'api' && /*#__PURE__*/React.createElement(Card, {
    title: "API keys",
    subtitle: "Keys grant full access \u2014 store them in a secret manager.",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "plus",
        size: 14
      })
    }, "Create key")
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: [{
      id: 'key_live_04',
      name: 'Production',
      created: '20 Oct 2026',
      used: 'just now',
      env: 'live'
    }, {
      id: 'key_live_03',
      name: 'Data warehouse sync',
      created: '02 Aug 2026',
      used: '1h ago',
      env: 'live'
    }, {
      id: 'key_test_11',
      name: 'Staging',
      created: '14 Jun 2026',
      used: '3d ago',
      env: 'test'
    }],
    columns: [{
      key: 'name',
      header: 'Name'
    }, {
      key: 'id',
      header: 'Key',
      mono: true,
      render: k => k.id + '_••••'
    }, {
      key: 'env',
      header: 'Mode',
      render: k => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        tone: k.env === 'live' ? 'accent' : 'neutral'
      }, k.env)
    }, {
      key: 'created',
      header: 'Created',
      muted: true
    }, {
      key: 'used',
      header: 'Last used',
      muted: true
    }, {
      key: 'x',
      header: '',
      width: 48,
      render: () => /*#__PURE__*/React.createElement(IconButton, {
        size: "sm",
        label: "Revoke",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "trash-2",
          size: 14
        })
      })
    }]
  })), dirty && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      bottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px 10px 16px',
      background: 'var(--surface-inverse)',
      color: 'var(--fg-inverse)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: 'var(--type-label)'
    }
  }, "You have unsaved changes"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    style: {
      color: 'var(--fg-inverse)'
    },
    onClick: () => setDirty(false)
  }, "Discard"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "accent",
    onClick: () => {
      setDirty(false);
      toast({
        tone: 'success',
        title: 'Settings saved'
      });
    }
  }, "Save changes")));
}
window.SettingsScreen = SettingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/Settings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/Shell.jsx
try { (() => {
function Shell({
  active,
  onNav,
  crumbs,
  theme,
  onTheme,
  onSignOut,
  children
}) {
  const {
    Sidebar,
    Topbar,
    Breadcrumbs,
    Logo,
    Input,
    Icon,
    IconButton,
    Avatar,
    Menu,
    Tooltip
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const [col, setCol] = React.useState(false);
  const sections = [{
    items: [{
      id: 'overview',
      label: 'Overview',
      icon: 'layout-dashboard'
    }]
  }, {
    title: 'Manage',
    items: [{
      id: 'users',
      label: 'Users',
      icon: 'users',
      badge: '1,284'
    }, {
      id: 'orders',
      label: 'Orders',
      icon: 'receipt',
      badge: 3
    }, {
      id: 'audit',
      label: 'Audit log',
      icon: 'scroll-text'
    }]
  }, {
    title: 'System',
    items: [{
      id: 'settings',
      label: 'Settings',
      icon: 'settings'
    }]
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100vh',
      background: 'var(--bg)',
      color: 'var(--fg-1)'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    collapsed: col,
    header: col ? /*#__PURE__*/React.createElement(Logo, {
      variant: "mark",
      size: 22
    }) : /*#__PURE__*/React.createElement(Logo, {
      size: 20,
      product: "Admin"
    }),
    sections: sections,
    activeId: active,
    onSelect: onNav,
    footer: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: col ? 'center' : 'flex-start'
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: "Jan Nowak",
      size: "sm"
    }), !col && /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0,
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: 'var(--type-label)'
      }
    }, "Jan Nowak"), /*#__PURE__*/React.createElement("div", {
      style: {
        font: 'var(--type-caption)',
        color: 'var(--fg-3)'
      }
    }, "Owner")), !col && /*#__PURE__*/React.createElement(Menu, {
      align: "end",
      trigger: /*#__PURE__*/React.createElement(IconButton, {
        size: "sm",
        label: "Account",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "chevrons-up-down",
          size: 14
        })
      }),
      items: [{
        label: 'Profile',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "user",
          size: 14
        })
      }, {
        label: 'Keyboard shortcuts',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "keyboard",
          size: 14
        }),
        shortcut: '?'
      }, {
        divider: true
      }, {
        label: 'Sign out',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "log-out",
          size: 14
        }),
        onSelect: onSignOut
      }],
      style: {}
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(Topbar, {
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Toggle sidebar",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "panel-left"
      }),
      onClick: () => setCol(c => !c)
    }), /*#__PURE__*/React.createElement(Breadcrumbs, {
      items: crumbs
    })),
    center: /*#__PURE__*/React.createElement(Input, {
      size: "sm",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "search",
        size: 14
      }),
      placeholder: "Search users, orders, IDs\u2026",
      suffix: /*#__PURE__*/React.createElement("kbd", {
        style: {
          font: '400 11px/1 var(--font-mono)',
          padding: '2px 5px',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--fg-3)'
        }
      }, "\u2318K")
    }),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tooltip, {
      content: theme === 'dark' ? 'Light mode' : 'Dark mode',
      side: "bottom"
    }, /*#__PURE__*/React.createElement(IconButton, {
      label: "Theme",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: theme === 'dark' ? 'sun' : 'moon'
      }),
      onClick: onTheme
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'relative',
        display: 'inline-flex'
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      label: "Notifications",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "bell"
      })
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: 7,
        right: 8,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'var(--accent)'
      }
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Help",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "circle-help"
      })
    }))
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--content-max)',
      margin: '0 auto',
      padding: 'var(--page-padding)',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, children))));
}
window.Shell = Shell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/UserDetail.jsx
try { (() => {
function UserDetailScreen({
  user,
  onBack,
  toast
}) {
  const {
    PageHeader,
    Tabs,
    Button,
    Icon,
    Card,
    DescriptionList,
    Badge,
    Avatar,
    Menu,
    IconButton,
    StatCard,
    DataTable,
    Timeline,
    Dialog,
    Textarea,
    Select,
    ProgressBar
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const D = window.ADMIN_DATA;
  const [tab, setTab] = React.useState('overview');
  const [dlg, setDlg] = React.useState(false);
  const [status, setStatus] = React.useState(user.status);
  const st = {
    Paid: 'success',
    Pending: 'warning',
    Refunded: 'neutral',
    Failed: 'danger'
  };
  const suspend = () => {
    setDlg(false);
    setStatus('Suspended');
    toast({
      tone: 'success',
      title: 'User suspended',
      description: user.email + ' can no longer sign in.',
      action: true
    });
  };
  const orders = D.orders.slice(0, 4).map(o => ({
    ...o,
    customer: user.name
  }));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-left",
        size: 14
      }),
      onClick: onBack,
      style: {
        marginLeft: -10
      }
    }, "Users"),
    title: /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: user.name,
      size: "lg"
    }), user.name),
    meta: /*#__PURE__*/React.createElement(Badge, {
      tone: window.USER_TONE[status],
      dot: true
    }, status),
    description: /*#__PURE__*/React.createElement("span", null, user.email, " \xB7 ", user.org, " \xB7 ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12
      }
    }, user.id)),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "key-round",
        size: 14
      }),
      onClick: () => toast({
        tone: 'success',
        title: 'Reset link sent',
        description: user.email
      })
    }, "Reset password"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "log-in",
        size: 14
      })
    }, "Impersonate"), /*#__PURE__*/React.createElement(Menu, {
      trigger: /*#__PURE__*/React.createElement(IconButton, {
        variant: "secondary",
        label: "More",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "more-horizontal"
        })
      }),
      items: [{
        label: 'Change role',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "shield",
          size: 14
        })
      }, {
        label: 'Revoke sessions',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "monitor-x",
          size: 14
        })
      }, {
        divider: true
      }, {
        label: status === 'Suspended' ? 'Reactivate' : 'Suspend user',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "user-x",
          size: 14
        }),
        danger: status !== 'Suspended',
        onSelect: () => status === 'Suspended' ? (setStatus('Active'), toast({
          tone: 'success',
          title: 'User reactivated'
        })) : setDlg(true)
      }, {
        label: 'Delete user',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "trash-2",
          size: 14
        }),
        danger: true
      }]
    }))
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'overview',
      label: 'Overview'
    }, {
      value: 'orders',
      label: 'Orders',
      count: 14
    }, {
      value: 'activity',
      label: 'Activity'
    }, {
      value: 'sessions',
      label: 'Sessions',
      count: 2
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,2fr) minmax(280px,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Lifetime spend",
    value: '$' + (user.spend || 0).toLocaleString('en-US')
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Orders",
    value: "14",
    delta: 2,
    deltaSuffix: "",
    comparison: "this month"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Sign-ins (30d)",
    value: "38"
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Orders",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost"
    }, "View all")
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: orders,
    density: "compact",
    columns: [{
      key: 'id',
      header: 'Order',
      mono: true
    }, {
      key: 'plan',
      header: 'Plan'
    }, {
      key: 'status',
      header: 'Status',
      render: o => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        tone: st[o.status],
        dot: true
      }, o.status)
    }, {
      key: 'date',
      header: 'Date',
      muted: true
    }, {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: o => '$' + o.total.toFixed(2)
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Activity"
  }, /*#__PURE__*/React.createElement(Timeline, {
    items: [{
      actor: user.name.split(' ')[0],
      title: 'signed in from Chrome on macOS',
      time: '2h ago',
      icon: 'log-in',
      description: 'Warsaw, PL · 91.150.2.8'
    }, {
      actor: user.name.split(' ')[0],
      title: 'upgraded to Pro · annual',
      time: '3 days ago',
      icon: 'arrow-up-circle',
      tone: 'success'
    }, {
      actor: 'Jan Nowak',
      title: 'changed role to ' + user.role,
      time: '12 Mar',
      icon: 'shield',
      tone: 'info',
      meta: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          gap: 6
        }
      }, /*#__PURE__*/React.createElement(Badge, {
        mono: true,
        size: "sm"
      }, "Viewer"), /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-right",
        size: 14,
        color: "var(--fg-3)"
      }), /*#__PURE__*/React.createElement(Badge, {
        mono: true,
        size: "sm",
        tone: "info"
      }, user.role))
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Details"
  }, /*#__PURE__*/React.createElement(DescriptionList, {
    labelWidth: 100,
    items: [{
      label: 'User ID',
      value: user.id,
      mono: true,
      copyable: true
    }, {
      label: 'Email',
      value: user.email
    }, {
      label: 'Role',
      value: user.role
    }, {
      label: 'Organisation',
      value: user.org
    }, {
      label: 'Created',
      value: '12 Mar 2026'
    }, {
      label: 'Last seen',
      value: user.seen
    }, {
      label: '2FA',
      value: /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        tone: "success"
      }, "Enabled")
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Plan usage"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Seats",
    value: 41,
    max: 50,
    valueLabel: "41 / 50",
    tone: "auto"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "API calls",
    value: 782,
    max: 1000,
    valueLabel: "782k / 1M",
    tone: "auto"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Storage",
    value: 18,
    max: 100,
    valueLabel: "18 / 100 GB",
    tone: "auto"
  }))))), /*#__PURE__*/React.createElement(Dialog, {
    open: dlg,
    onClose: () => setDlg(false),
    tone: "danger",
    title: 'Suspend ' + user.name + '?',
    description: "They are signed out everywhere and can't sign in until reactivated. Their data is kept.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setDlg(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      onClick: suspend
    }, "Suspend user"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Reason",
    options: ['Chargebacks', 'Terms violation', 'Security concern', 'Requested by customer']
  }), /*#__PURE__*/React.createElement(Textarea, {
    label: "Internal note",
    rows: 2,
    placeholder: "Visible to admins only"
  }))));
}
window.UserDetailScreen = UserDetailScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/UserDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/Users.jsx
try { (() => {
const USER_TONE = {
  Active: 'success',
  Invited: 'info',
  Pending: 'warning',
  Suspended: 'danger'
};
function UsersScreen({
  onOpenUser,
  toast
}) {
  const {
    PageHeader,
    Tabs,
    Button,
    Icon,
    Input,
    Select,
    Tag,
    Card,
    DataTable,
    Pagination,
    Badge,
    Avatar,
    Menu,
    IconButton,
    EmptyState
  } = window.NotNullSoftAdminDesignSystem_a508e9;
  const D = window.ADMIN_DATA;
  const [tab, setTab] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('all');
  const [sel, setSel] = React.useState([]);
  const [sort, setSort] = React.useState({
    key: 'name',
    dir: 'asc'
  });
  const [page, setPage] = React.useState(1);
  const [st, setSt] = React.useState([]);
  let rows = D.users.filter(u => (tab === 'all' || (tab === 'admins' ? ['Admin', 'Owner'].includes(u.role) : u.status === 'Suspended')) && (role === 'all' || u.role === role) && (!st.length || st.includes(u.status)) && (!q || (u.name + u.email + u.id).toLowerCase().includes(q.toLowerCase())));
  rows = [...rows].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0));
  const tog = s => setSt(x => x.includes(s) ? x.filter(y => y !== s) : [...x, s]);
  const cols = [{
    key: 'name',
    header: 'Name',
    sortable: true,
    render: u => /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: u.name,
      size: "sm"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontWeight: 500
      }
    }, u.name), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        font: 'var(--type-caption)',
        color: 'var(--fg-3)'
      }
    }, u.email)))
  }, {
    key: 'role',
    header: 'Role',
    sortable: true,
    muted: true
  }, {
    key: 'status',
    header: 'Status',
    render: u => /*#__PURE__*/React.createElement(Badge, {
      tone: USER_TONE[u.status],
      dot: true
    }, u.status)
  }, {
    key: 'org',
    header: 'Organisation',
    muted: true
  }, {
    key: 'seen',
    header: 'Last seen',
    muted: true
  }, {
    key: 'spend',
    header: 'Lifetime spend',
    align: 'right',
    sortable: true,
    render: u => u.spend ? '$' + u.spend.toLocaleString('en-US') : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--fg-3)'
      }
    }, "\u2014")
  }, {
    key: 'act',
    header: '',
    width: 48,
    render: u => /*#__PURE__*/React.createElement(Menu, {
      trigger: /*#__PURE__*/React.createElement(IconButton, {
        size: "sm",
        label: "Actions",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "more-horizontal",
          size: 16
        })
      }),
      items: [{
        label: 'View profile',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "user",
          size: 14
        }),
        onSelect: () => onOpenUser(u)
      }, {
        label: 'Reset password',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "key-round",
          size: 14
        }),
        onSelect: () => toast({
          tone: 'success',
          title: 'Reset link sent',
          description: u.email
        })
      }, {
        divider: true
      }, {
        label: 'Suspend',
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "user-x",
          size: 14
        }),
        danger: true,
        onSelect: () => toast({
          tone: 'neutral',
          title: u.name + ' suspended'
        })
      }]
    })
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Users",
    meta: /*#__PURE__*/React.createElement(Badge, {
      mono: true
    }, "1,284"),
    description: "Everyone with access to the platform, across all organisations.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 14
      })
    }, "Export CSV"), /*#__PURE__*/React.createElement(Button, {
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "user-plus",
        size: 14
      })
    }, "Invite user"))
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: t => {
      setTab(t);
      setSel([]);
    },
    tabs: [{
      value: 'all',
      label: 'All users',
      count: 1284
    }, {
      value: 'admins',
      label: 'Admins',
      count: 12
    }, {
      value: 'suspended',
      label: 'Suspended',
      count: 46
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      padding: 12,
      borderBottom: '1px solid var(--border)',
      flexWrap: 'wrap'
    }
  }, sel.length ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-label)',
      padding: '0 4px'
    }
  }, sel.length, " selected"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 14
    })
  }, "Email"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "shield",
      size: 14
    })
  }, "Change role"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "danger-ghost",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "user-x",
      size: 14
    }),
    onClick: () => {
      toast({
        tone: 'success',
        title: sel.length + ' users suspended',
        action: true
      });
      setSel([]);
    }
  }, "Suspend"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: () => setSel([])
  }, "Clear")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 14
    }),
    placeholder: "Search name, email or ID",
    value: q,
    onChange: e => setQ(e.target.value),
    style: {
      width: 260
    }
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: role,
    onChange: setRole,
    options: [{
      value: 'all',
      label: 'All roles'
    }, 'Owner', 'Admin', 'Editor', 'Viewer'],
    style: {
      width: 130
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 20,
      background: 'var(--border)',
      margin: '0 4px'
    }
  }), ['Active', 'Invited', 'Pending', 'Suspended'].map(s => /*#__PURE__*/React.createElement(Tag, {
    key: s,
    selected: st.includes(s),
    onClick: () => tog(s),
    style: {
      height: 28
    }
  }, s)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), st.length || q || role !== 'all' ? /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    onClick: () => {
      setSt([]);
      setQ('');
      setRole('all');
    }
  }, "Reset filters") : null)), /*#__PURE__*/React.createElement(DataTable, {
    rows: rows,
    columns: cols,
    selectable: true,
    selected: sel,
    onSelectionChange: setSel,
    sort: sort,
    onSortChange: setSort,
    onRowClick: onOpenUser,
    empty: /*#__PURE__*/React.createElement(EmptyState, {
      compact: true,
      icon: "search-x",
      title: "No users match these filters",
      description: "Try removing a filter or searching by email."
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 16px'
    }
  }, /*#__PURE__*/React.createElement(Pagination, {
    page: page,
    pageCount: 52,
    total: 1284,
    onPageChange: setPage
  }))));
}
window.UsersScreen = UsersScreen;
window.USER_TONE = USER_TONE;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/Users.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/data.js
try { (() => {
window.ADMIN_DATA = (() => {
  const users = [['usr_8f2k1', 'Marta Kowalska', 'marta@acme.io', 'Admin', 'Active', 'Acme Corp', 4210, '2h ago'], ['usr_3h9d2', 'Jan Nowak', 'jan@northwind.pl', 'Owner', 'Active', 'Northwind', 12890, '5m ago'], ['usr_7c1m4', 'Ola Wiśniewska', 'ola@initech.com', 'Editor', 'Suspended', 'Initech', 890, '12 days ago'], ['usr_2p8x7', 'Piotr Zieliński', 'piotr@globex.io', 'Viewer', 'Active', 'Globex', 0, '1d ago'], ['usr_9q4t3', 'Anna Lewandowska', 'anna@umbrella.eu', 'Editor', 'Invited', 'Umbrella', 0, '—'], ['usr_5r6y8', 'Tomasz Wójcik', 'tomasz@hooli.com', 'Admin', 'Active', 'Hooli', 7340, '3h ago'], ['usr_1s2u9', 'Katarzyna Kamińska', 'kasia@stark.pl', 'Viewer', 'Active', 'Stark Ind.', 1520, '4d ago'], ['usr_6v3w0', 'Michał Dąbrowski', 'michal@wayne.co', 'Editor', 'Pending', 'Wayne Ent.', 310, '—'], ['usr_4z7a5', 'Ewa Szymańska', 'ewa@soylent.io', 'Viewer', 'Active', 'Soylent', 2240, '6h ago'], ['usr_0b8c6', 'Paweł Woźniak', 'pawel@cyberdyne.ai', 'Editor', 'Active', 'Cyberdyne', 5610, '2d ago']].map(([id, name, email, role, status, org, spend, seen]) => ({
    id,
    name,
    email,
    role,
    status,
    org,
    spend,
    seen
  }));
  const days = Array.from({
    length: 30
  }, (_, i) => {
    const d = new Date(2026, 8, 21 + i);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short'
    });
  });
  const rev = days.map((_, i) => Math.round(1200 + i * 38 + Math.sin(i / 2.2) * 220 + (i % 7 === 5 || i % 7 === 6 ? -260 : 0)));
  const prev = days.map((_, i) => Math.round(1100 + i * 22 + Math.sin(i / 2.6 + 1) * 180 + (i % 7 === 5 || i % 7 === 6 ? -200 : 0)));
  const orders = [['ord_10482', 'Marta Kowalska', 'Pro · annual', 412, 'Paid', '20 Oct, 14:02'], ['ord_10481', 'Tomasz Wójcik', 'Team · monthly', 189, 'Paid', '20 Oct, 11:47'], ['ord_10480', 'Michał Dąbrowski', 'Pro · monthly', 39, 'Pending', '20 Oct, 09:15'], ['ord_10479', 'Ola Wiśniewska', 'Team · annual', 1890, 'Refunded', '19 Oct, 17:30'], ['ord_10478', 'Ewa Szymańska', 'Pro · monthly', 39, 'Failed', '19 Oct, 16:02']].map(([id, customer, plan, total, status, date]) => ({
    id,
    customer,
    plan,
    total,
    status,
    date
  }));
  const audit = [{
    day: 'Today',
    items: [{
      id: 'evt_9a1',
      actor: 'Jan Nowak',
      title: 'suspended user ola@initech.com',
      time: '14:02',
      icon: 'user-x',
      tone: 'danger',
      description: 'Reason: repeated chargebacks',
      ip: '83.21.4.17',
      target: 'usr_7c1m4',
      kind: 'user.suspend'
    }, {
      id: 'evt_9a0',
      actor: 'Marta Kowalska',
      title: 'changed role of tomasz@hooli.com',
      time: '13:41',
      icon: 'shield',
      tone: 'info',
      diff: ['role: Editor', 'role: Admin'],
      ip: '91.150.2.8',
      target: 'usr_5r6y8',
      kind: 'user.role_change'
    }, {
      id: 'evt_99f',
      actor: 'System',
      title: 'rotated API signing key',
      time: '12:00',
      icon: 'key-round',
      tone: 'neutral',
      description: 'Scheduled rotation · next in 30 days',
      ip: '—',
      target: 'key_live_04',
      kind: 'key.rotate'
    }, {
      id: 'evt_99e',
      actor: 'Marta Kowalska',
      title: 'refunded order ord_10479',
      time: '10:18',
      icon: 'undo-2',
      tone: 'warning',
      description: '$1,890.00 to Visa •••• 4242',
      ip: '91.150.2.8',
      target: 'ord_10479',
      kind: 'order.refund'
    }]
  }, {
    day: 'Yesterday',
    items: [{
      id: 'evt_99d',
      actor: 'Tomasz Wójcik',
      title: 'enabled required 2FA for all admins',
      time: '17:55',
      icon: 'lock',
      tone: 'success',
      ip: '46.205.11.3',
      target: 'org_settings',
      kind: 'settings.update'
    }, {
      id: 'evt_99c',
      actor: 'System',
      title: 'blocked 14 failed sign-ins from 185.220.101.4',
      time: '03:12',
      icon: 'shield-alert',
      tone: 'danger',
      description: 'IP added to denylist for 24h',
      ip: '185.220.101.4',
      target: 'auth',
      kind: 'auth.block'
    }, {
      id: 'evt_99b',
      actor: 'Jan Nowak',
      title: 'invited anna@umbrella.eu as Editor',
      time: '09:30',
      icon: 'user-plus',
      tone: 'accent',
      ip: '83.21.4.17',
      target: 'usr_9q4t3',
      kind: 'user.invite'
    }]
  }];
  return {
    users,
    days,
    rev,
    prev,
    orders,
    audit
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/data.js", error: String((e && e.message) || e) }); }

__ds_ns.BarChart = __ds_scope.BarChart;

__ds_ns.DonutChart = __ds_scope.DonutChart;

__ds_ns.LineChart = __ds_scope.LineChart;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Mark = __ds_scope.Mark;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DescriptionList = __ds_scope.DescriptionList;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Timeline = __ds_scope.Timeline;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Breadcrumbs = __ds_scope.Breadcrumbs;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Topbar = __ds_scope.Topbar;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Drawer = __ds_scope.Drawer;

__ds_ns.Menu = __ds_scope.Menu;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
