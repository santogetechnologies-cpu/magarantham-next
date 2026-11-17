import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
)
  throw new Error("Set .env.local before seeding.");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const products = JSON.parse(
  await readFile(
    new URL("../supabase/seed-products.json", import.meta.url),
    "utf8",
  ),
);
for (const category of [...new Set(products.map(p=>p.category))]) {
  const {data:existing,error:lookupError}=await db.from('product_categories').select('id').is('parent_id',null).eq('name',category).maybeSingle();
  if(lookupError) throw lookupError;
  let parent=existing;
  if(!parent){const result=await db.from('product_categories').insert({name:category,slug:`seed-${crypto.randomUUID()}`}).select('id').single();if(result.error)throw result.error;parent=result.data;}
  let child=(await db.from('product_categories').select('id').eq('parent_id',parent.id).eq('name','All styles').maybeSingle()).data;
  if(!child){const result=await db.from('product_categories').insert({name:'All styles',slug:`seed-${crypto.randomUUID()}`,parent_id:parent.id}).select('id').single();if(result.error)throw result.error;child=result.data;}
  for(const p of products.filter(p=>p.category===category))p.subcategory_id=child.id;
}
// Ignore existing UUIDs so running this command again never resets sale prices, stock or reservations.
const { error } = await db
  .from("products")
  .upsert(products, { onConflict: "id", ignoreDuplicates: true });
if (error) {
  console.error("Seed failed. Check migrations and server credentials.");
  process.exitCode = 1;
} else
  console.log(
    "Catalogue seeded. Existing products unchanged. Initial new products: price 0, stock 0; orders remain controlled by store settings.",
  );
