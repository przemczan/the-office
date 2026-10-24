The workhorse list view — sortable, selectable rows with custom cell renderers. Put it inside `<Card padding="none">` with a toolbar above and Pagination below.
```jsx
<DataTable rows={users} selectable selected={sel} onSelectionChange={setSel} sort={sort} onSortChange={setSort} onRowClick={open}
  columns={[{key:'name',header:'Name',sortable:true,render:u=><UserCell u={u}/>},{key:'status',header:'Status',render:u=><Badge tone="success" dot>{u.status}</Badge>},{key:'spend',header:'Spend',align:'right',sortable:true}]}/>
```
Right-align numbers. Use `mono` for IDs. Density compact/default/relaxed.
