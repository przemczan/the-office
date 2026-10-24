import React from 'react';
export function Drawer({open=true,title,description,children,footer,onClose,width=480,inline=false,style}){
React.useEffect(()=>{if(!open||inline||!onClose)return;const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[open,inline,onClose]);
if(!open)return null;
const panel=<aside role="dialog" aria-modal={!inline} style={{width:'100%',maxWidth:width,height:'100%',background:'var(--surface-raised)',borderLeft:'1px solid var(--border)',boxShadow:inline?'none':'var(--shadow-3)',display:'flex',flexDirection:'column',marginLeft:'auto',animation:inline?'none':'nns-drawer-in var(--duration-slow) var(--ease-out)',...style}}>
<style>{'@keyframes nns-drawer-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}'}</style>
<header style={{display:'flex',alignItems:'flex-start',gap:12,padding:'16px 20px',borderBottom:'1px solid var(--border)',flex:'none'}}><div style={{flex:1,minWidth:0}}>{title&&<h3 style={{margin:0,font:'600 16px/1.4 var(--font-sans)',color:'var(--fg-1)'}}>{title}</h3>}{description&&<p style={{margin:'2px 0 0',font:'var(--type-body-sm)',color:'var(--fg-3)'}}>{description}</p>}</div>{onClose&&<button aria-label="Close" onClick={onClose} style={{width:28,height:28,border:0,background:'transparent',borderRadius:'var(--radius-md)',cursor:'pointer',color:'var(--fg-3)',display:'grid',placeItems:'center'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>}</header>
<div style={{flex:1,overflowY:'auto',padding:20}}>{children}</div>
{footer&&<footer style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 20px',borderTop:'1px solid var(--border)',background:'var(--surface-sunken)',flex:'none'}}>{footer}</footer>}</aside>;
if(inline)return panel;
return <div onClick={e=>{if(e.target===e.currentTarget&&onClose)onClose()}} style={{position:'fixed',inset:0,zIndex:'var(--z-drawer)',background:'var(--overlay)',display:'flex'}}>{panel}</div>;}
