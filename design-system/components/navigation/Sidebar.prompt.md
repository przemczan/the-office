Left navigation rail for the admin shell; active item gets a tinted fill and an ember icon.
```jsx
<Sidebar header={<Logo size={20} product="Admin"/>} activeId="users" onSelect={go}
  sections={[{items:[{id:'overview',label:'Overview',icon:'layout-dashboard'}]},{title:'Manage',items:[{id:'users',label:'Users',icon:'users',badge:1284}]}]}
  footer={<UserChip/>}/>
```
`collapsed` shows icons only (56px).
