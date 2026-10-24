Single-line text input; use `iconLeft={<Icon name="search"/>}` for table search. `Field` wraps any control with label/hint/error.
```jsx
<Input label="Email" type="email" placeholder="name@company.com" hint="Used for sign-in"/>
<Input iconLeft={<Icon name="search" size={14}/>} placeholder="Search users" suffix={<kbd>/</kbd>}/>
```
