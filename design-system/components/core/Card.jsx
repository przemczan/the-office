import React from 'react';
export function Card({title,subtitle,actions,footer,variant='outline',padding='md',children,style,bodyStyle}){const p={none:0,sm:16,md:20,lg:24}[padding]??20;
const V={outline:{bg:'var(--surface)',sh:'none'},raised:{bg:'var(--surface-raised)',sh:'var(--shadow-2)'},sunken:{bg:'var(--surface-sunken)',sh:'none'}}[variant]||{};
const head=title||actions;
return <section style={{background:V.bg,border:'1px solid var(--border)',borderRadius:'var(--radius-card)',boxShadow:V.sh,display:'flex',flexDirection:'column',minWidth:0,...style}}>
{head&&<header style={{display:'flex',alignItems:'flex-start',gap:12,padding:`${Math.max(p,16)-2}px ${Math.max(p,16)}px ${p===0?14:0}px`,borderBottom:p===0?'1px solid var(--border)':'none'}}><div style={{flex:1,minWidth:0}}>{title&&<h3 style={{margin:0,font:'var(--type-card-title)',color:'var(--fg-1)'}}>{title}</h3>}{subtitle&&<p style={{margin:'2px 0 0',font:'var(--type-body-sm)',color:'var(--fg-3)'}}>{subtitle}</p>}</div>{actions&&<div style={{display:'flex',gap:6,alignItems:'center',margin:'-4px -4px 0 0'}}>{actions}</div>}</header>}
<div style={{padding:p,paddingTop:head&&p?14:p,flex:1,minWidth:0,...bodyStyle}}>{children}</div>
{footer&&<footer style={{padding:`12px ${Math.max(p,16)}px`,borderTop:'1px solid var(--border)',font:'var(--type-body-sm)',color:'var(--fg-2)'}}>{footer}</footer>}</section>;}
