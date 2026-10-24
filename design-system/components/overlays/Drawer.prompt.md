Right-side sheet for quick record preview, filters or edit forms without leaving the list.
```jsx
<Drawer open={!!row} onClose={()=>setRow(null)} title="Order #10482" footer={<Button>Save</Button>}><DescriptionList items={…}/></Drawer>
```
