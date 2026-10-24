Time-series line chart for trends (revenue, signups, errors); fills its container width.
```jsx
<LineChart height={220} labels={days} series={[{name:'This period',data:cur},{name:'Previous',data:prev,color:'var(--chart-6)',dashed:true}]} yFormat={v=>'$'+v}/>
```
