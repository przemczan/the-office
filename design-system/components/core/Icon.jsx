import React from 'react';
/* Lucide via CDN global (window.lucide). Load https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js before the bundle. */
const pascal=s=>s.replace(/(^|-)([a-z0-9])/g,(_,a,b)=>b.toUpperCase());
export function Icon({name,size=16,strokeWidth=1.75,color='currentColor',style}){const L=typeof window!=='undefined'&&window.lucide;let node=L&&(L.icons?.[pascal(name)]||L[pascal(name)]);
if(Array.isArray(node)&&node[0]==='svg')node=node[2];
const kids=Array.isArray(node)?node.map(([t,a],i)=>React.createElement(t,{key:i,...a})):null;
return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:'block',flex:'none',...style}}>{kids}</svg>;}
