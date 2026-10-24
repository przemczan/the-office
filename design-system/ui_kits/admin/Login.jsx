function LoginScreen({onSignIn}){const {Logo,Input,Button,Icon,Checkbox}=window.NotNullSoftAdminDesignSystem_a508e9;const[busy,setBusy]=React.useState(false);const[rem,setRem]=React.useState(true);
const submit=e=>{e.preventDefault();setBusy(true);setTimeout(()=>{setBusy(false);onSignIn()},700)};
return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'var(--bg)'}}><div style={{width:'100%',maxWidth:380,display:'flex',flexDirection:'column',gap:24}}>
<div style={{display:'flex',justifyContent:'center'}}><Logo size={26} product="Admin"/></div>
<form onSubmit={submit} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-xl)',boxShadow:'var(--shadow-2)',padding:28,display:'flex',flexDirection:'column',gap:16}}>
<div><h1 style={{margin:0,font:'600 20px/1.3 var(--font-sans)',letterSpacing:'-0.015em'}}>Sign in to back office</h1><p style={{margin:'4px 0 0',font:'var(--type-body-sm)',color:'var(--fg-3)'}}>Use your NotNullSoft staff account.</p></div>
<Input label="Work email" type="email" defaultValue="jan.nowak@notnullsoft.com" size="lg"/>
<Input label="Password" type="password" defaultValue="••••••••••••" size="lg" suffix={<a href="#" style={{font:'500 12px var(--font-sans)',whiteSpace:'nowrap'}}>Forgot?</a>}/>
<Checkbox checked={rem} onChange={setRem} label="Keep me signed in for 8 hours"/>
<Button type="submit" variant="accent" size="lg" fullWidth loading={busy}>Sign in</Button>
<div style={{display:'flex',alignItems:'center',gap:10,font:'var(--type-caption)',color:'var(--fg-3)'}}><span style={{flex:1,height:1,background:'var(--border)'}}/>or<span style={{flex:1,height:1,background:'var(--border)'}}/></div>
<Button variant="secondary" size="lg" fullWidth iconLeft={<Icon name="key-round" size={16}/>} onClick={onSignIn}>Continue with SSO</Button></form>
<p style={{margin:0,textAlign:'center',font:'var(--type-caption)',color:'var(--fg-3)'}}>Restricted to NotNullSoft staff. Every sign-in is logged.</p></div></div>;}
window.LoginScreen=LoginScreen;
