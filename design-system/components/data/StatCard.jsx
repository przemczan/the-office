import React from 'react';
import {Sparkline} from '../charts/Sparkline.jsx';
import {Icon} from '../core/Icon.jsx';
export function StatCard({label,value,delta,deltaSuffix='%',invertDelta=false,comparison,trend,icon,footer,style}){const up=delta>0,flat=!delta;const good=invertDelta?!up:up;const col=flat?'var(--fg-3)':good?'var(--positive)':'var(--negative)';
return <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-card)',padding:'var(--card-padding)',display:'flex',flexDirection:'column',gap:10,minWidth:0,...style}}>
<div style={{display:'flex',alignItems:'center',gap:8,font:'var(--type-label)',color:'var(--fg-2)'}}>{icon&&<span style={{color:'var(--fg-3)',display:'grid'}}><Icon name={icon} size={16}/></span>}<span style={{flex:1,minWidth:0}}>{label}</span></div>
<div style={{display:'flex',alignItems:'flex-end',gap:12,justifyContent:'space-between'}}><div style={{minWidth:0}}><div style={{font:'var(--type-metric)',letterSpacing:'var(--tracking-tight)',color:'var(--fg-1)',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>
{(delta!=null||comparison)&&<div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,font:'var(--type-body-sm)',flexWrap:'wrap'}}>{delta!=null&&<span style={{display:'inline-flex',alignItems:'center',gap:2,color:col,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{!flat&&<Icon name={up?'arrow-up-right':'arrow-down-right'} size={14} strokeWidth={2}/>}{up?'+':''}{delta}{deltaSuffix}</span>}{comparison&&<span style={{color:'var(--fg-3)'}}>{comparison}</span>}</div>}</div>
{trend&&<Sparkline data={trend} color={flat?'var(--chart-6)':good?'var(--positive)':'var(--negative)'} width={88} height={32}/>}</div>
{footer&&<div style={{borderTop:'1px solid var(--border-subtle)',paddingTop:10,font:'var(--type-body-sm)',color:'var(--fg-2)'}}>{footer}</div>}</div>;}
