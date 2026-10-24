window.ADMIN_DATA=(()=>{
const users=[
['usr_8f2k1','Marta Kowalska','marta@acme.io','Admin','Active','Acme Corp',4210,'2h ago'],
['usr_3h9d2','Jan Nowak','jan@northwind.pl','Owner','Active','Northwind',12890,'5m ago'],
['usr_7c1m4','Ola Wiśniewska','ola@initech.com','Editor','Suspended','Initech',890,'12 days ago'],
['usr_2p8x7','Piotr Zieliński','piotr@globex.io','Viewer','Active','Globex',0,'1d ago'],
['usr_9q4t3','Anna Lewandowska','anna@umbrella.eu','Editor','Invited','Umbrella',0,'—'],
['usr_5r6y8','Tomasz Wójcik','tomasz@hooli.com','Admin','Active','Hooli',7340,'3h ago'],
['usr_1s2u9','Katarzyna Kamińska','kasia@stark.pl','Viewer','Active','Stark Ind.',1520,'4d ago'],
['usr_6v3w0','Michał Dąbrowski','michal@wayne.co','Editor','Pending','Wayne Ent.',310,'—'],
['usr_4z7a5','Ewa Szymańska','ewa@soylent.io','Viewer','Active','Soylent',2240,'6h ago'],
['usr_0b8c6','Paweł Woźniak','pawel@cyberdyne.ai','Editor','Active','Cyberdyne',5610,'2d ago']
].map(([id,name,email,role,status,org,spend,seen])=>({id,name,email,role,status,org,spend,seen}));
const days=Array.from({length:30},(_,i)=>{const d=new Date(2026,8,21+i);return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})});
const rev=days.map((_,i)=>Math.round(1200+i*38+Math.sin(i/2.2)*220+(i%7===5||i%7===6?-260:0)));
const prev=days.map((_,i)=>Math.round(1100+i*22+Math.sin(i/2.6+1)*180+(i%7===5||i%7===6?-200:0)));
const orders=[
['ord_10482','Marta Kowalska','Pro · annual',412,'Paid','20 Oct, 14:02'],
['ord_10481','Tomasz Wójcik','Team · monthly',189,'Paid','20 Oct, 11:47'],
['ord_10480','Michał Dąbrowski','Pro · monthly',39,'Pending','20 Oct, 09:15'],
['ord_10479','Ola Wiśniewska','Team · annual',1890,'Refunded','19 Oct, 17:30'],
['ord_10478','Ewa Szymańska','Pro · monthly',39,'Failed','19 Oct, 16:02']
].map(([id,customer,plan,total,status,date])=>({id,customer,plan,total,status,date}));
const audit=[
{day:'Today',items:[
{id:'evt_9a1',actor:'Jan Nowak',title:'suspended user ola@initech.com',time:'14:02',icon:'user-x',tone:'danger',description:'Reason: repeated chargebacks',ip:'83.21.4.17',target:'usr_7c1m4',kind:'user.suspend'},
{id:'evt_9a0',actor:'Marta Kowalska',title:'changed role of tomasz@hooli.com',time:'13:41',icon:'shield',tone:'info',diff:['role: Editor','role: Admin'],ip:'91.150.2.8',target:'usr_5r6y8',kind:'user.role_change'},
{id:'evt_99f',actor:'System',title:'rotated API signing key',time:'12:00',icon:'key-round',tone:'neutral',description:'Scheduled rotation · next in 30 days',ip:'—',target:'key_live_04',kind:'key.rotate'},
{id:'evt_99e',actor:'Marta Kowalska',title:'refunded order ord_10479',time:'10:18',icon:'undo-2',tone:'warning',description:'$1,890.00 to Visa •••• 4242',ip:'91.150.2.8',target:'ord_10479',kind:'order.refund'}]},
{day:'Yesterday',items:[
{id:'evt_99d',actor:'Tomasz Wójcik',title:'enabled required 2FA for all admins',time:'17:55',icon:'lock',tone:'success',ip:'46.205.11.3',target:'org_settings',kind:'settings.update'},
{id:'evt_99c',actor:'System',title:'blocked 14 failed sign-ins from 185.220.101.4',time:'03:12',icon:'shield-alert',tone:'danger',description:'IP added to denylist for 24h',ip:'185.220.101.4',target:'auth',kind:'auth.block'},
{id:'evt_99b',actor:'Jan Nowak',title:'invited anna@umbrella.eu as Editor',time:'09:30',icon:'user-plus',tone:'accent',ip:'83.21.4.17',target:'usr_9q4t3',kind:'user.invite'}]}];
return {users,days,rev,prev,orders,audit};})();
