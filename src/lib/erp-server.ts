import 'server-only';
import {Fault,service} from './server';
import {Profile,publicProduct} from './core';
export function can(profile:Profile,cap:string){return profile.role==='superadmin'||profile.role==='manager'&&profile.permissions.includes(cap)||profile.role==='billing'&&cap==='pos';}
export async function rows(table:string,select='*',filters:Record<string,unknown>={}) {let q=service().from(table).select(select);for(const [key,value] of Object.entries(filters))q=value===null?q.is(key,null):q.eq(key,value);const {data,error}=await q.limit(1000);if(error)throw new Fault(503,'ERP_LOAD_FAILED');return data as unknown as Record<string,any>[];}
export async function posProducts(){const data=await rows('store_catalogue','*',{archived:false,category_visible:true});return data.map(p=>({...publicProduct(p),barcode:p.barcode}));}
export async function erpReferences(profile:Profile){
 const data:Record<string,unknown>={};
 if(['catalogue','inventory','pos','purchases'].some(c=>can(profile,c))){data.products=await posProducts();data.categories=await rows('product_categories');}
 if(can(profile,'purchases'))data.suppliers=await rows('suppliers');
 if(can(profile,'attendance')||profile.role==='superadmin')data.employees=await rows('employees',profile.role==='superadmin'?'*':'id,code,name,employment,active,joined_on,ended_on,daily_minutes');
 if(profile.role==='superadmin'){data.salary_policies=await rows('salary_policies');data.profiles=await rows('profiles','id,email,role,display_name');}
 if(can(profile,'expenses'))data.expense_categories=await rows('expense_categories');
 return data;
}
