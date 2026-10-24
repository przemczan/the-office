Transient confirmation after an action ("User suspended"), stacked bottom-right, auto-dismiss ~5s; offer Undo for reversible actions.
```jsx
<Toast tone="success" title="User suspended" description="marta@acme.io can no longer sign in." action={<Button size="sm" variant="secondary">Undo</Button>} onClose={dismiss}/>
```
