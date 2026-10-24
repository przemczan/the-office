KPI tile: label, big tabular value, signed delta coloured by good/bad, comparison text and optional sparkline. Use 3–4 in a row at the top of dashboards.
```jsx
<StatCard label="Revenue" icon="wallet" value="$48,210" delta={12.4} comparison="vs last 30 days" trend={[3,4,4,6,5,8]}/>
<StatCard label="Error rate" value="0.42%" delta={-0.08} deltaSuffix="pp" invertDelta/>
```
