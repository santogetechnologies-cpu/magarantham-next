'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Profile} from '@/lib/core';
import {adminNav} from '@/lib/admin-fields';
import {erpModules} from '@/lib/erp-fields';
import {api} from '../api';
import {ERPRecords} from './records';
import {Purchases} from './purchases';
import {Expenses} from './expenses';
import {POS} from './pos';
import {Labels} from './labels';
import {Attendance} from './attendance';
import {Payroll} from './payroll';
import {Reports} from './reports';
import {References} from './shared';
export function ERP({module,profile}:{module:string;profile:Profile}){const [refs,setRefs]=useState<References>({}),[error,setError]=useState('');async function refreshRefs(){try{setRefs(await api<References>('/api/erp/reference'));setError('');}catch(e){setError((e as Error).message);}}useEffect(()=>{void refreshRefs();},[module]);const permitted=(cap:string)=>profile.role==='superadmin'||profile.role==='billing'?profile.role==='superadmin'||cap==='pos':cap!=='superadmin'&&(!cap||profile.permissions.includes(cap));return <div className="erp-shell"><aside className="erp-sidebar"><p className="eyebrow">மகரந்தம் சில்க்ஸ்</p><h2>Shop ERP.</h2><p>{profile.display_name||profile.email}<small>{profile.role==='billing'?'Billing staff':profile.role}</small></p><nav aria-label="ERP navigation">{adminNav.filter(([, ,cap])=>permitted(cap)).map(([key,label])=><Link key={key} href={`/admin${key?`/${key}`:''}`} className={key===module?'active':''}>{label}<span>↗</span></Link>)}</nav><Link href="/" className="text-link">View online shop ↗</Link><Link href="/account" className="text-link">My account / sign out ↗</Link></aside><section className="erp-main"><header className="section-heading"><div><p className="eyebrow">One shop · one stock ledger</p><h1>{erpModules[module]?.title}.</h1></div><Link className="text-link" href="/shop">Online shop ↗</Link></header>{error&&<div role="alert" className="notice">{error}</div>}{module==='pos'?<POS profile={profile}/>:module==='purchases'?<Purchases refs={refs}/>:module==='labels'?<Labels refs={refs}/>:module==='expenses'?<Expenses refs={refs}/>:module==='attendance'?<Attendance refs={refs}/>:module==='payroll'?<Payroll refs={refs}/>:module==='reports'?<Reports/>:<ERPRecords module={module} refs={refs} refreshRefs={refreshRefs}/>}</section></div>;}
