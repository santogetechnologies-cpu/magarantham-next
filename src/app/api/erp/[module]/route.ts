import {createHash,randomUUID} from 'crypto';
import {z} from 'zod';
import {staff,service,origin,json,rate,rpc,ok,failure,Fault} from '@/lib/server';
import {Capability} from '@/lib/core';
import {can,enrichCategories,erpReferences,posProducts,removeCategoryImage,saveCategoryImage} from '@/lib/erp-server';
import {erpSchemas,employeeSchema,attendanceSchema,posInput,posCart,purchaseSchema,expenseSchema,payrollInput,id} from '@/lib/erp-schemas';
const access:Record<string,Capability|'superadmin'|undefined>={reference:undefined,scan:'pos',pos:'pos',pos_quote:'pos',pos_sale:'pos',pos_return:'pos',labels:'inventory',suppliers:'purchases',purchases:'purchases',purchase_status:'purchases',purchase_receive:'purchases',purchase_pay:'purchases',expenses:'expenses',expense_void:'superadmin',expense_review:'superadmin',expense_status:'superadmin',attendance:'attendance',employees:'superadmin',employee_login:'superadmin',product_categories:'superadmin',catalog_discounts:'superadmin',expense_categories:'superadmin',salary_policies:'superadmin',pos_settings:'superadmin',payroll:'superadmin',payroll_preview:'superadmin',payroll_finalize:'superadmin',reports:'reports'};
export async function GET(req:Request,{params}:{params:Promise<{module:string}>}){try{
 const {module}=await params;if(!(module in access))throw new Fault(404,'NOT_FOUND');const session=await staff(access[module]);const db=service(),url=new URL(req.url);const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')||0);
 if(module==='reference')return ok(await erpReferences(session.profile));
 if(module==='scan'){
  const rawCode=url.searchParams.get('barcode')||'';
  // Scanners may append Tab/CR or other control characters; keep the printable code only.
  const code=z.string().trim().min(1).max(100).parse(rawCode.replace(/[\x00-\x1f\x7f]/g,''));
  const likeCode=code.replace(/[\\%_]/g,m=>'\\'+m);
  let productId:string|undefined;
  let unit:Record<string,unknown>|null=null;

  // 1. Check ERP serialized units in product_units (MSU...)
  if(/^MSU[0-9]+$/i.test(code)){
   const r=await db.from('product_units').select('id,product_id,state,barcode').eq('barcode',code).maybeSingle();
   if(r.data){
    if(r.data.state!=='in_stock')throw new Fault(409,'UNIT_UNAVAILABLE','This serialized unit is already sold or unavailable.');
    productId=r.data.product_id;
    unit={...r.data,id:String(r.data.id)};
   }
  }

  // 2. Check Products table by barcode (case-insensitive)
  if(!productId){
   const r=await db.from('products').select('id').ilike('barcode',likeCode).limit(1).maybeSingle();
   if(r.data?.id)productId=r.data.id;
  }

  // 3. Check Products table by SKU (case-insensitive)
  if(!productId){
   const r=await db.from('products').select('id').ilike('sku',likeCode).limit(1).maybeSingle();
   if(r.data?.id)productId=r.data.id;
  }

  if(!productId)throw new Fault(404,'BARCODE_NOT_FOUND',`Barcode or SKU "${code}" was not found in catalogue.`);

  // 4. Load full product data
  let r=await db.from('store_catalogue').select('*').eq('id',productId).maybeSingle();
  if(!r.data){
   r=await db.from('products').select('*').eq('id',productId).maybeSingle();
  }
  if(r.error||!r.data||r.data.archived)throw new Fault(404,'PRODUCT_UNAVAILABLE','This saree is archived or unavailable for sale.');

  const {publicProduct}=await import('@/lib/core');
  // One barcode per saree: the scan returns its colour split (colours + undefined pieces) so the
  // cashier picks which colour is being billed.
  const prodData=publicProduct(r.data);
  return ok({product:{...prodData,barcode:r.data.barcode||code,stock_on_hand:Number(r.data.stock_on_hand||0),reserved:Number(r.data.reserved||0),category_visible:r.data.category_visible!==false},unit});
 }
 if(module==='pos'){const {data:settings,error}=await db.from('pos_settings').select('*').eq('id',true).single();if(error)throw new Fault(503,'ERP_LOAD_FAILED');const {getOffersWithTargets}=await import('@/lib/offers-server');const {isOfferValid}=await import('@/lib/offers');const posOffers=(await getOffersWithTargets().catch(()=>[])).filter(o=>!o.code&&o.apply_in_pos&&isOfferValid(o));return ok({settings,products:(await posProducts()).filter(p=>p.category_visible!==false),offers:posOffers,references:await erpReferences(session.profile)});}
 if(module==='pos_sale'){const saleId=url.searchParams.get('id');let q=db.from('pos_sales').select('*').order('created_at',{ascending:false}).order('id');if(session.profile.role==='billing')q=q.eq('cashier_id',session.user.id);if(saleId)q=q.eq('id',id.parse(saleId));const {data,error}=await q.range(page*50,page*50+50);if(error)throw new Fault(503,'ERP_LOAD_FAILED');return ok({rows:data.slice(0,50),nextPage:data.length>50?page+1:null});}
 if(module==='labels'){let q=db.from('product_units').select('id,product_id,barcode,purchase_id,printed_at,products(name,sku,price_paise)').eq('state','in_stock').order('id');const product=url.searchParams.get('product_id'),purchase=url.searchParams.get('purchase_id');if(product)q=q.eq('product_id',id.parse(product));if(purchase)q=q.eq('purchase_id',id.parse(purchase));const quantity=z.coerce.number().int().min(1).max(500).parse(url.searchParams.get('quantity')||100);const after=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('after')||0);const {data,error}=await q.gt('id',after).limit(quantity+1);if(error)throw new Fault(503,'ERP_LOAD_FAILED');return ok({rows:data.slice(0,quantity),nextAfter:data.length>quantity?data[quantity-1].id:null});}
 if(module==='payroll_preview'){return ok({calculation:await rpc('payroll_preview',{p_actor:session.user.id,p_employee:id.parse(url.searchParams.get('employee_id')),p_period:z.iso.date().parse(url.searchParams.get('period'))})});}
 if(module==='reports'){return ok(await rpc('erp_report',{p_actor:session.user.id,p_from:z.iso.date().parse(url.searchParams.get('from')),p_to:z.iso.date().parse(url.searchParams.get('to'))}));}
 const table=module==='payroll'?'payroll_runs':module;if(!['suppliers','purchases','expenses','attendance','employees','product_categories','catalog_discounts','expense_categories','salary_policies','pos_settings','payroll_runs'].includes(table))throw new Fault(404,'NOT_FOUND');
 let q=db.from(table).select(table==='purchases'?'*,purchase_items(*),suppliers(name)': '*');
 if(module==='expenses'&&session.profile.role!=='superadmin')q=q.eq('source','manual');
 if(module==='attendance'){const month=z.string().regex(/^\d{4}-\d{2}$/).parse(url.searchParams.get('month'));const start=`${month}-01`;const next=new Date(`${start}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);q=q.gte('work_on',start).lt('work_on',next.toISOString().slice(0,10));const emp=url.searchParams.get('employee_id');if(emp)q=q.eq('employee_id',id.parse(emp));q=q.order('work_on',{ascending:false});}
 if(module==='expenses'){q=q.order('expense_on',{ascending:false}).order('created_at',{ascending:false});}
 else if(table==='purchases'){q=q.order('number',{ascending:false});}else if(table==='payroll_runs'){q=q.order('period',{ascending:false}).order('id');}else if(table==='suppliers'||table==='expense_categories'){q=q.order('name').order('id');}else{q=q.order(table==='attendance'?'employee_id':table==='product_categories'?'created_at':'id');}
 const {data,error}=await q.range(page*100,page*100+100);if(error)throw new Fault(503,'ERP_LOAD_FAILED',error.code==='42501'||!process.env.SUPABASE_SERVICE_ROLE_KEY?'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Add your Supabase Secret / service_role key and restart the server.':undefined);let list=data.slice(0,100) as unknown as Record<string,any>[];
 if(table==='product_categories')list=await enrichCategories(list);
 if(module==='purchases'&&list.length){const balances=await rpc('purchase_balances',{p_actor:session.user.id,p_ids:list.map(p=>p.id)});return ok({rows:list.map(p=>({...p,due_paise:balances.find((b:{id:string})=>b.id===p.id)?.due_paise||0})),nextPage:data.length>100?page+1:null});}
 if(module==='expenses'&&list.length){
  const actorIds=Array.from(new Set(list.flatMap(r=>[r.actor_id,r.void_by,r.reviewed_by].filter(Boolean))));
  if(actorIds.length){
   const [profilesRes, employeesRes]=await Promise.all([
    db.from('profiles').select('id,display_name,email,role').in('id',actorIds),
    db.from('employees').select('id,name,code,profile_id,designation').or(`profile_id.in.(${actorIds.join(',')}),id.in.(${actorIds.join(',')})`),
   ]);
   const profMap=new Map((profilesRes.data||[]).map(p=>[p.id,p]));
   const empByProf=new Map((employeesRes.data||[]).map(e=>[e.profile_id,e]));
   const empById=new Map((employeesRes.data||[]).map(e=>[e.id,e]));
   list=list.map(r=>{
    const emp=empByProf.get(r.actor_id)||empById.get(r.actor_id);
    const prof=profMap.get(r.actor_id);
    const name=emp?.name||prof?.display_name||(prof?.email?prof.email.split('@')[0]:'Administrator');
    const role=prof?.role||(emp?'billing':'superadmin');
    const code=emp?.code||'';
    const designation=emp?.designation||(role==='superadmin'?'Super Administrator':role==='billing'?'POS Billing Staff':'Store Staff');
    let voidByName='';
    if(r.void_by){
     const vEmp=empByProf.get(r.void_by)||empById.get(r.void_by);
     const vProf=profMap.get(r.void_by);
     voidByName=vEmp?.name||vProf?.display_name||(vProf?.email?vProf.email.split('@')[0]:'Staff');
    }
    return {
     ...r,
     created_by_name:name,
     created_by_role:role,
     created_by_code:code,
     created_by_designation:designation,
     created_by_email:prof?.email||'',
     void_by_name:voidByName,
     reviewed_by_name:(() => { if (!r.reviewed_by) return ''; const revEmp = empByProf.get(r.reviewed_by) || empById.get(r.reviewed_by); const revProf = profMap.get(r.reviewed_by); return revEmp?.name || revProf?.display_name || (revProf?.email ? revProf.email.split('@')[0] : 'Admin'); })(),
    };
   });
  }
 }
 return ok({rows:list,nextPage:data.length>100?page+1:null});
}catch(e){return failure(e);}}
export async function POST(req:Request,{params}:{params:Promise<{module:string}>}){try{
 origin(req);const {module}=await params;if(!(module in access))throw new Fault(404,'NOT_FOUND');const session=await staff(access[module]);await rate(req,'erp-write',session.user.id,100);const input=await json(req,100000);const actor=session.user.id;let result:unknown;
 if(module in erpSchemas){const p=z.object({id:id.nullable(),data:z.record(z.string(),z.unknown())}).strict().parse(input);const parsed=erpSchemas[module as keyof typeof erpSchemas].parse(p.data) as Record<string,unknown>;if(module==='product_categories'){const imgPath=typeof parsed.image_path==='string'?parsed.image_path:'';const desc=typeof parsed.description==='string'?parsed.description:'';const {image_path:_omit,description:_omitDesc,...coreCat}=parsed;result=await rpc('erp_save',{p_actor:actor,p_entity:module,p_id:p.id,p_data:coreCat});if(result)await saveCategoryImage(String(result),imgPath,desc);}else if(module==='catalog_discounts'){const coreDiscount={name:parsed.name,scope:parsed.scope,target_id:parsed.target_id??null,discount_bps:parsed.discount_bps,active:Boolean(parsed.active),starts_at:parsed.starts_at||null,ends_at:parsed.ends_at||null};result=await rpc('erp_save',{p_actor:actor,p_entity:module,p_id:p.id,p_data:coreDiscount});}else{result=await rpc('erp_save',{p_actor:actor,p_entity:module,p_id:p.id,p_data:parsed});}}
 else if(module==='employees'){const p=z.object({id:id.nullable(),data:employeeSchema}).strict().parse(input);const{email,photo_url,address,emergency_contact,designation,department,bank_details,...coreEmployee}=p.data;result=await rpc('save_employee',{p_actor:actor,p_id:p.id,p_data:coreEmployee});const savedId=p.id||String(result);const db=service();await db.from('employees').update({email:email||'',photo_url:photo_url||'',address:address||'',emergency_contact:emergency_contact||'',designation:designation||'Sales Executive',department:department||'Retail Sales',bank_details:bank_details||{}}).eq('id',savedId);}
 else if(module==='attendance'){const p=attendanceSchema.parse(input);await rpc('attendance_save',{p_actor:actor,p_employee:p.employee_id,p_on:p.work_on,p_data:p.data});}
 else if(module==='employee_login'){const p=z.object({employee_id:id,existing_profile_id:id.nullable().default(null),role:z.enum(['billing','manager']),email:z.email().optional(),password:z.string().min(6).max(128).optional()}).strict().parse(input);const db=service();const e=await db.from('employees').select('id,name,active,profile_id').eq('id',p.employee_id).single();if(e.error||!e.data.active||e.data.profile_id)throw new Fault(409,'LOGIN_ALREADY_LINKED');if(p.existing_profile_id){await rpc('employee_link',{p_actor:actor,p_employee:p.employee_id,p_profile:p.existing_profile_id});}
  else{if(!p.email||!p.password)throw new Fault(400,'EMAIL_PASSWORD_REQUIRED');let userId:string;const created=await db.auth.admin.createUser({email:p.email,password:p.password,email_confirm:true,app_metadata:{store_role:p.role},user_metadata:{name:e.data.name}});if(created.data?.user){userId=created.data.user.id;}else{const{data:users}=await db.auth.admin.listUsers();const existing=users?.users?.find(u=>u.email?.toLowerCase()===p.email!.toLowerCase());if(existing){userId=existing.id;await db.auth.admin.updateUserById(userId,{password:p.password,email_confirm:true,app_metadata:{store_role:p.role},user_metadata:{name:e.data.name}});}else{throw new Fault(409,'ACCOUNT_CREATE_FAILED',created.error?.message||'Unable to create staff login');}}try{await rpc('employee_link',{p_actor:actor,p_employee:p.employee_id,p_profile:userId});}catch(error){if(created.data?.user)await db.auth.admin.deleteUser(userId);throw error;}}}
 else if(module==='purchases'){const p=purchaseSchema.parse(input);result=await rpc('purchase_save',{p_actor:actor,p_id:p.id,p_data:p.data,p_lines:p.lines});}
 else if(module==='purchase_status'){const p=z.object({id,status:z.enum(['ordered','cancelled'])}).strict().parse(input);await rpc('purchase_status',{p_actor:actor,p_id:p.id,p_status:p.status});}
 else if(module==='purchase_receive'){const p=z.object({id,key:id,kind:z.enum(['receive','return']),lines:z.array(z.object({product_id:id,quantity:z.number().int().min(1).max(10000)}).strict()).min(1).max(100),note:z.string().trim().max(1000),update_cost:z.boolean().optional()}).strict().parse(input);result=await rpc('purchase_receive',{p_actor:actor,p_id:p.id,p_key:p.key,p_kind:p.kind,p_lines:p.lines,p_note:p.note});
  // Optional: keep each saree's cost price at its latest purchase cost (used for margins and stock value).
  if(result&&p.kind==='receive'&&p.update_cost){const db=service();const {data:items}=await db.from('purchase_items').select('product_id,unit_cost_paise').eq('purchase_id',p.id).in('product_id',p.lines.map(l=>l.product_id));for(const it of items||[]){if(Number(it.unit_cost_paise)>0)await db.from('products').update({purchase_price_paise:it.unit_cost_paise}).eq('id',it.product_id);}}}
 else if(module==='purchase_pay'){const p=z.object({id,key:id,direction:z.enum(['paid','refund']),amount_paise:z.number().int().min(1).max(2000000000),method:z.enum(['cash','upi','card','bank']),reference:z.string().trim().min(6).max(100),checked:z.literal(true)}).strict().parse(input);result=await rpc('purchase_pay',{p_actor:actor,p_id:p.id,p_key:p.key,p_direction:p.direction,p_amount:p.amount_paise,p_method:p.method,p_reference:p.reference,p_checked:p.checked});}
 else if(module==='expenses'){const p=expenseSchema.parse(input);if(session.profile.role==='billing'){const db=service();const fp=createHash('sha256').update(JSON.stringify(p.data)).digest('hex');const existing=await db.from('expenses').select('id,fingerprint').eq('request_key',p.key).maybeSingle();if(existing.data){if(existing.data.fingerprint!==fp)throw new Fault(409,'IDEMPOTENCY_CONFLICT');result=existing.data.id;}else{const cat=await db.from('expense_categories').select('id').eq('id',p.data.category_id).eq('active',true).maybeSingle();if(!cat.data)throw new Fault(409,'CATEGORY_UNAVAILABLE');if(p.data.method!=='cash'&&p.data.reference.trim().length<6)throw new Fault(400,'PAYMENT_REFERENCE_REQUIRED');const expId=randomUUID();const ins=await db.from('expenses').insert({id:expId,request_key:p.key,fingerprint:fp,category_id:p.data.category_id,expense_on:p.data.expense_on,description:p.data.description,amount_paise:p.data.amount_paise,method:p.data.method,reference:p.data.reference||'',payee:p.data.payee||'',actor_id:actor,source:'manual',status:'pending'});if(ins.error)throw new Fault(503,'SAVE_FAILED');try{await db.from('audit_log').insert({actor_id:actor,action:'expense.submitted',entity:'expenses',entity_id:expId,details:{amount_paise:p.data.amount_paise,method:p.data.method}});}catch{}result=expId;}}else{result=await rpc('expense_post',{p_actor:actor,p_key:p.key,p_data:p.data});}}
 else if(module==='expense_review'){const p=z.object({id,action:z.enum(['approve','reject']),note:z.string().trim().max(300).default('')}).strict().parse(input);await rpc('expense_review',{p_actor:actor,p_id:p.id,p_action:p.action,p_note:p.note});}
 else if(module==='expense_status'){
   const p=z.object({id,status:z.enum(['posted','pending','rejected','void']),reason:z.string().trim().max(500).default('')}).strict().parse(input);
   const db=service();
   const existing=await db.from('expenses').select('id,source,status').eq('id',p.id).single();
   if(existing.error||!existing.data)throw new Fault(404,'NOT_FOUND');
   if(existing.data.source!=='manual')throw new Fault(409,'EXPENSE_LOCKED','Automated payroll expenses cannot be manually modified.');
   const nowIso=new Date().toISOString();
   let updData:Record<string,unknown>={status:p.status};
   if(p.status==='posted'){
    updData={status:'posted',reviewed_by:actor,reviewed_at:nowIso,review_note:p.reason||'Approved by Admin',void_by:null,void_reason:null};
   }else if(p.status==='pending'){
    updData={status:'pending',reviewed_by:null,reviewed_at:null,review_note:p.reason||'',void_by:null,void_reason:null};
   }else if(p.status==='rejected'){
    updData={status:'rejected',reviewed_by:actor,reviewed_at:nowIso,review_note:p.reason||'Rejected by Admin'};
   }else if(p.status==='void'){
    updData={status:'void',void_by:actor,void_reason:p.reason||'Voided by Admin'};
   }
   const upd=await db.from('expenses').update(updData).eq('id',p.id);
   if(upd.error)throw new Fault(503,'SAVE_FAILED');
   try{
    await db.from('audit_log').insert({actor_id:actor,action:'expense.status_changed',entity:'expenses',entity_id:p.id,details:{old_status:existing.data.status,new_status:p.status,reason:p.reason}});
   }catch{}
   result=p.id;
  }
  else if(module==='expense_void'){
   const p=z.object({id,reason:z.string().trim().min(3).max(500)}).strict().parse(input);
   const db=service();
   const existing=await db.from('expenses').select('id,source,status').eq('id',p.id).single();
   if(existing.error||!existing.data||existing.data.source!=='manual')throw new Fault(409,'EXPENSE_LOCKED');
   const upd=await db.from('expenses').update({status:'void',void_by:actor,void_reason:p.reason}).eq('id',p.id);
   if(upd.error)throw new Fault(503,'SAVE_FAILED');
   try{
    await db.from('audit_log').insert({actor_id:actor,action:'expense.void',entity:'expenses',entity_id:p.id,details:{reason:p.reason}});
   }catch{}
  }
 else if(module==='pos_quote'){const p=z.object({cart:posCart,discount_paise:z.number().int().min(0).max(100000000)}).strict().parse(input);result=await rpc('pos_quote',{p_actor:actor,p_cart:p.cart,p_discount:p.discount_paise});return ok(result);}
 else if(module==='pos_sale'){const p=posInput.parse(input);result=await rpc('pos_checkout',{p_actor:actor,p_key:p.key,p_cart:p.cart,p_customer:p.customer,p_discount:p.discount_paise,p_tenders:p.tenders,p_cash_received:p.cash_received_paise,p_bank_checked:p.bank_checked});
  // Colour stock is updated inside pos_checkout (same transaction as the stock ledger).
 }
 else if(module==='pos_return'){if(!can(session.profile,'inventory'))throw new Fault(403,'FORBIDDEN');const p=z.object({id,reason:z.string().trim().min(3).max(500),reference:z.string().trim().min(6).max(100),checked:z.literal(true)}).strict().parse(input);await rpc('pos_return',{p_actor:actor,p_sale:p.id,p_reason:p.reason,p_reference:p.reference});}
 else if(module==='labels'){const p=z.object({ids:z.array(z.string().regex(/^[1-9][0-9]*$/)).min(1).max(500)}).strict().parse(input);await rpc('labels_printed',{p_actor:actor,p_ids:p.ids});}
 else if(module==='payroll'){const p=payrollInput.parse(input);result=await rpc('payroll_from_attendance',{p_actor:actor,p_employee:p.employee_id,p_period:p.period,p_bonus:p.bonus_paise,p_allowances:p.allowances,p_deductions:p.deductions});}
 else if(module==='payroll_finalize'){const p=z.object({id,action:z.enum(['approve','reopen','paid']),reference:z.string().trim().max(100).default(''),method:z.enum(['cash','upi','card','bank']).default('bank'),checked:z.boolean().default(false)}).strict().parse(input);await rpc('payroll_finalize',{p_actor:actor,p_run:p.id,p_action:p.action,p_reference:p.reference,p_method:p.method,p_checked:p.checked});}
 else throw new Fault(404,'NOT_FOUND');return ok({id:result,message:module==='employee_login'?'Login linked. Confirmation email requested for a newly created account.':module==='expenses'&&session.profile.role!=='superadmin'?'Expense sent to the owner for approval.':module==='expense_review'?'Expense review saved.':module==='expense_status'?'Expense status updated.':'Saved.'});
}catch(e){return failure(e);}}
export async function DELETE(req:Request,{params}:{params:Promise<{module:string}>}){try{
 origin(req);const {module}=await params;if(module!=='product_categories'&&module!=='employees'&&module!=='catalog_discounts')throw new Fault(403,'CANNOT_DELETE');const session=await staff('superadmin');await rate(req,'erp-write',session.user.id,60);const targetId=id.parse(new URL(req.url).searchParams.get('id'));const db=service();
 if(module==='catalog_discounts'){const del=await db.from('catalog_discounts').delete().eq('id',targetId);if(del.error)throw new Fault(503,'DELETE_FAILED');try{await db.from('audit_log').insert({actor_id:session.user.id,action:'catalog_discounts.deleted',entity:'catalog_discounts',entity_id:targetId,details:{}});}catch{}return ok({message:'Discount removed. Prices are back to normal in POS and online.'});}
 if(module==='employees'){
  const {data:emp,error:empErr}=await db.from('employees').select('id,name,profile_id,joined_on').eq('id',targetId).single();
  if(empErr||!emp)throw new Fault(404,'NOT_FOUND');
  const {count:payCount}=await db.from('payroll_runs').select('id',{count:'exact',head:true}).eq('employee_id',targetId);
  if(emp.profile_id){
   const {data:prof}=await db.from('profiles').select('role').eq('id',emp.profile_id).maybeSingle();
   if(prof&&prof.role!=='superadmin'){await db.from('profiles').update({suspended:true}).eq('id',emp.profile_id);}
  }
  if((payCount||0)===0){
   await db.from('attendance').delete().eq('employee_id',targetId);
   const del=await db.from('employees').delete().eq('id',targetId);
   if(!del.error){
    try{await db.from('audit_log').insert({actor_id:session.user.id,action:'employees.deleted',entity:'employees',entity_id:targetId,details:{name:emp.name}});}catch{}
    return ok({message:`Staff member "${emp.name}" deleted.`});
   }
  }
  const today=new Date().toISOString().slice(0,10);
  const endDate=emp.joined_on&&today<emp.joined_on?emp.joined_on:today;
  const arch=await db.from('employees').update({active:false,profile_id:null,ended_on:endDate}).eq('id',targetId);
  if(arch.error)throw new Fault(409,'DELETE_FAILED','Could not remove this staff member.');
  try{await db.from('audit_log').insert({actor_id:session.user.id,action:'employees.deactivated',entity:'employees',entity_id:targetId,details:{name:emp.name}});}catch{}
  return ok({message:`Staff member "${emp.name}" deactivated (salary history preserved).`});
 }
 const catId=targetId;
 const {data:cat,error:catErr}=await db.from('product_categories').select('id,parent_id,name').eq('id',catId).single();
 if(catErr||!cat)throw new Fault(404,'NOT_FOUND');
 const {count:childCount}=await db.from('product_categories').select('id',{count:'exact',head:true}).eq('parent_id',catId);
 if((childCount||0)>0)throw new Fault(409,'HAS_SUBCATEGORIES','Remove its subcategories before deleting this main category.');
 // Safely preserve existing products in this subcategory by falling back to sibling 'All styles' or null (keeping their Main Category intact)
 let fallbackSub:string|null=null;
 if(cat.parent_id){const {data:allStyle}=await db.from('product_categories').select('id').eq('parent_id',cat.parent_id).eq('name','All styles').neq('id',catId).maybeSingle();fallbackSub=allStyle?.id||null;}
 await db.from('products').update({subcategory_id:fallbackSub}).eq('subcategory_id',catId);
 // Rules and banners aimed at this category must not outlive it (a banner whose category is cleared would show on every category page).
 await db.from('banners').update({published:false}).eq('category_id',catId);
 await db.from('catalog_discounts').delete().eq('target_id',catId).in('scope',['category','subcategory']);
 const del=await db.from('product_categories').delete().eq('id',catId);
 if(del.error)throw new Fault(409,'DELETE_FAILED','This category could not be deleted.');
 await removeCategoryImage(catId);
 try{await db.from('audit_log').insert({actor_id:session.user.id,action:'product_categories.deleted',entity:'product_categories',entity_id:catId,details:{name:cat.name,parent_id:cat.parent_id}});}catch{}
 return ok({message:`"${cat.name}" deleted.`});
}catch(e){return failure(e);}}
