56px sticky app bar above the content area — breadcrumbs left, search centre, utilities right.
```jsx
<Topbar left={<Breadcrumbs items={[{label:'Users'},{label:'Marta Kowalska'}]}/>} center={<Input size="sm" iconLeft={<Icon name="search" size={14}/>} placeholder="Search"/>} right={<Avatar name="Jan Nowak" size="sm"/>}/>
```
