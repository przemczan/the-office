Primary action control for the app's screens — ink "primary" for the main action, "secondary" for everything else in toolbars.
```jsx
<Button iconLeft={<Icon name="plus" size={14}/>}>New user</Button>
<Button variant="secondary">Export</Button>
<Button variant="danger">Delete</Button>
```
Variants: primary, accent (ember — sign-in / brand moments only), secondary, ghost, danger, danger-ghost. Sizes sm/md/lg (28/32/40). `loading` shows a spinner.
