Centered modal for confirmations and short forms; Esc and overlay click close it.
```jsx
<Dialog open={open} onClose={close} tone="danger" title="Suspend user?" description="They lose access immediately. You can reactivate them later."
  actions={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="danger">Suspend</Button></>}/>
```
