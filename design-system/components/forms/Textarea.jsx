import React from 'react';
import {Field} from './Input.jsx';
export function Textarea({label,hint,error,required,rows=4,disabled=false,id,style,...rest}){const[f,setF]=React.useState(false);const iid=id||React.useId();
const el=<textarea id={iid} rows={rows} disabled={disabled} onFocus={()=>setF(true)} onBlur={()=>setF(false)} {...rest} style={{width:'100%',resize:'vertical',padding:'8px 10px',font:'400 13px/1.5 var(--font-sans)',color:'var(--fg-1)',background:disabled?'var(--surface-sunken)':'var(--surface)',border:`1px solid ${error?'var(--danger)':f?'var(--border-focus)':'var(--border-strong)'}`,borderRadius:'var(--radius-control)',boxShadow:f?'var(--focus-ring)':'var(--shadow-1)',outline:0,transition:'border-color var(--duration-fast),box-shadow var(--duration-fast)',...style}}/>;
return label||hint||error?<Field label={label} hint={hint} error={error} required={required} htmlFor={iid}>{el}</Field>:el;}
