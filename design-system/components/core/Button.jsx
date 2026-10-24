import React from 'react';
function useHP(){const[h,sh]=React.useState(false);const[p,sp]=React.useState(false);return[{h,p},{onMouseEnter:()=>sh(true),onMouseLeave:()=>{sh(false);sp(false)},onMouseDown:()=>sp(true),onMouseUp:()=>sp(false)}];}
const SIZES={sm:{h:28,px:10,fs:13,gap:6},md:{h:32,px:12,fs:13,gap:6},lg:{h:40,px:16,fs:14,gap:8}};
export function Button({variant='primary',size='md',iconLeft,iconRight,loading=false,disabled=false,fullWidth=false,type='button',onClick,children,style,...rest}){
const[s,ev]=useHP();const z=SIZES[size]||SIZES.md;const off=disabled||loading;
const st=(a,b,c)=>off?a:s.p?c:s.h?b:a;
const V={
primary:{bg:st('var(--primary)','var(--primary-hover)','var(--primary-press)'),fg:'var(--primary-fg)',bd:'transparent'},
accent:{bg:st('var(--accent)','var(--accent-hover)','var(--accent-press)'),fg:'var(--fg-on-accent)',bd:'transparent'},
secondary:{bg:st('var(--surface)','var(--control-hover)','var(--control-press)'),fg:'var(--fg-1)',bd:'var(--border-strong)',sh:'var(--shadow-1)'},
ghost:{bg:st('transparent','var(--control-hover)','var(--control-press)'),fg:'var(--fg-1)',bd:'transparent'},
danger:{bg:st('var(--danger)','var(--danger-hover)','var(--danger-press)'),fg:'#fff',bd:'transparent'},
'danger-ghost':{bg:st('transparent','var(--danger-subtle)','var(--danger-subtle)'),fg:'var(--danger-fg)',bd:'transparent'}}[variant]||{};
return <button type={type} disabled={off} onClick={onClick} {...ev} {...rest} style={{display:fullWidth?'flex':'inline-flex',width:fullWidth?'100%':undefined,alignItems:'center',justifyContent:'center',gap:z.gap,height:z.h,padding:`0 ${z.px}px`,font:`500 ${z.fs}px/1 var(--font-sans)`,color:V.fg,background:V.bg,border:`1px solid ${V.bd}`,boxShadow:V.sh||'none',borderRadius:'var(--radius-control)',cursor:off?'not-allowed':'pointer',opacity:disabled?.45:1,transform:s.p&&!off?'translateY(1px)':'none',transition:'background var(--duration-fast) var(--ease-out),transform var(--duration-instant) var(--ease-out)',whiteSpace:'nowrap',flex:'none',...style}}>{loading?<span style={{width:z.fs,height:z.fs,border:'1.5px solid currentColor',borderRightColor:'transparent',borderRadius:'50%',animation:'nns-spin .7s linear infinite'}}/>:iconLeft}{children}{iconRight}<style>{'@keyframes nns-spin{to{transform:rotate(360deg)}}'}</style></button>;}
