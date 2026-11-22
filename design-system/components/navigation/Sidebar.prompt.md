Left navigation rail for the app shell; active item gets a tinted fill and an ember icon.
```jsx
<Sidebar header={<OfficeMark/>} activeId="tasks" onSelect={go}
  sections={[{items:[{id:'now',label:'Now',icon:'layout-dashboard'}]},{title:'Work',items:[{id:'tasks',label:'Tasks',icon:'list-checks',badge:12}]}]}
  footer={<UserChip/>}/>
```
`collapsed` shows icons only (56px).
