Bordered container for dashboard widgets, forms and tables, with optional title/actions header and footer.
```jsx
<Card title="Revenue" subtitle="Last 30 days" actions={<IconButton label="More" icon={<Icon name="more-horizontal"/>}/>}>…</Card>
<Card title="Recent orders" padding="none"><DataTable …/></Card>
```
`padding="none"` puts a divider under the header — use for tables and lists.
