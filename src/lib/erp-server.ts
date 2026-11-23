import 'server-only';
import { Fault, service } from './server';
import { Profile, publicProduct } from './core';
import { getPiecesMap } from './piece-server';

const CATEGORY_IMAGES_KEY = 'category-images.json';

export function can(profile: Profile, cap: string) {
  return (
    profile.role === 'superadmin' ||
    (profile.role === 'manager' && profile.permissions.includes(cap)) ||
    (profile.role === 'billing' && (cap === 'pos' || cap === 'expenses'))
  );
}

const CATEGORY_META_KEY = 'category-metadata.json';
const LEGACY_IMAGES_KEY = 'category-images.json';

export type CategoryMeta = {
  image_path?: string;
  description?: string;
};

export async function getCategoryMetaMap(): Promise<Record<string, CategoryMeta>> {
  const db = service();
  try {
    const { data } = await db.storage
      .from('store-media')
      .download(CATEGORY_META_KEY);
    if (data) {
      const parsed = JSON.parse(await data.text());
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  try {
    const { data } = await db.storage
      .from('store-media')
      .download(LEGACY_IMAGES_KEY);
    if (data) {
      const parsed = JSON.parse(await data.text());
      if (parsed && typeof parsed === 'object') {
        const converted: Record<string, CategoryMeta> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') converted[k] = { image_path: v };
        }
        return converted;
      }
    }
  } catch {}
  return {};
}

export async function getCategoryImageMap(): Promise<Record<string, string>> {
  const meta = await getCategoryMetaMap();
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v.image_path) res[k] = v.image_path;
  }
  return res;
}

export async function saveCategoryMeta(
  categoryId: string,
  meta: { image_path?: string; description?: string },
): Promise<void> {
  const db = service();
  try {
    const map = await getCategoryMetaMap();
    map[categoryId] = {
      ...(map[categoryId] || {}),
      ...(meta.image_path !== undefined ? { image_path: meta.image_path.trim() } : {}),
      ...(meta.description !== undefined ? { description: meta.description.trim() } : {}),
    };
    await db.storage
      .from('store-media')
      .upload(
        CATEGORY_META_KEY,
        Buffer.from(JSON.stringify(map)),
        { upsert: true, contentType: 'image/webp' },
      );
  } catch {}
}

export async function saveCategoryImage(
  categoryId: string,
  imagePath: string,
  description?: string,
): Promise<void> {
  const db = service();
  const clean = (imagePath || '').trim();

  // Try native PostgreSQL column first if available
  try {
    await db
      .from('product_categories')
      .update({ image_path: clean })
      .eq('id', categoryId);
  } catch {}

  await saveCategoryMeta(categoryId, { image_path: clean, description });
}

export async function removeCategoryImage(categoryId: string): Promise<void> {
  const db = service();
  try {
    const map = await getCategoryMetaMap();
    if (categoryId in map) {
      delete map[categoryId];
      await db.storage
        .from('store-media')
        .upload(
          CATEGORY_META_KEY,
          Buffer.from(JSON.stringify(map)),
          { upsert: true, contentType: 'image/webp' },
        );
    }
  } catch {}
}

export async function enrichCategories<T extends Record<string, any>>(
  list: T[],
): Promise<T[]> {
  if (!list.length) return list;
  const metaMap = await getCategoryMetaMap();

  let productImagesByCat: Record<string, string> = {};
  const productCountByCat: Record<string, number> = {};
  const pieceCountByCat: Record<string, number> = {};

  try {
    const db = service();
    const { data: prods } = await db
      .from('products')
      .select('id, category, subcategory_id, image_path, stock_on_hand, archived')
      .eq('archived', false);

    if (prods?.length) {
      for (const p of prods) {
        const cKey = String(p.category || '').trim().toLowerCase();
        const subId = p.subcategory_id ? String(p.subcategory_id) : '';
        const stock = Number(p.stock_on_hand || 0);

        if (p.image_path) {
          if (cKey && !productImagesByCat[cKey]) productImagesByCat[cKey] = p.image_path;
          if (subId && !productImagesByCat[subId]) productImagesByCat[subId] = p.image_path;
        }

        if (cKey) {
          productCountByCat[cKey] = (productCountByCat[cKey] || 0) + 1;
          pieceCountByCat[cKey] = (pieceCountByCat[cKey] || 0) + stock;
        }
        if (subId) {
          productCountByCat[subId] = (productCountByCat[subId] || 0) + 1;
          pieceCountByCat[subId] = (pieceCountByCat[subId] || 0) + stock;
        }
      }
    }
  } catch {}

  return list.map((c) => {
    const cid = String(c.id);
    const cNameLower = String(c.name || '').trim().toLowerCase();
    const meta = metaMap[cid] || {};
    const img =
      (c.image_path && typeof c.image_path === 'string' && c.image_path.trim()) ||
      meta.image_path ||
      productImagesByCat[cid] ||
      productImagesByCat[cNameLower] ||
      '';
    const desc =
      (c.description && typeof c.description === 'string' && c.description.trim()) ||
      meta.description ||
      '';

    const subcategoryCount = list.filter((item) => String(item.parent_id) === cid).length;
    const prodCount = productCountByCat[cid] || productCountByCat[cNameLower] || 0;
    const pieceCount = pieceCountByCat[cid] || pieceCountByCat[cNameLower] || 0;

    return {
      ...c,
      image_path: img,
      description: desc,
      subcategory_count: subcategoryCount,
      product_count: prodCount,
      piece_count: pieceCount,
    };
  });
}

export async function rows(
  table: string,
  select = '*',
  filters: Record<string, unknown> = {},
) {
  let q = service().from(table).select(select);
  for (const [key, value] of Object.entries(filters))
    q = value === null ? q.is(key, null) : q.eq(key, value);
  const { data, error } = await q.limit(1000);
  if (error)
    throw new Fault(
      503,
      'ERP_LOAD_FAILED',
      error.code === '42501' || !process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Add your Supabase Secret / service_role key and restart the server.'
        : undefined,
    );
  const result = data as unknown as Record<string, any>[];
  if (table === 'product_categories') {
    return enrichCategories(result);
  }
  return result;
}

export async function posProducts() {
  const data = await rows('store_catalogue', '*', {
    archived: false,
  });
  const piecesMap = await getPiecesMap();
  return data.map((p) => {
    const pid = String(p.id);
    const prodPieces = piecesMap[pid] || [];
    return {
      ...publicProduct({ ...p, pieces: prodPieces }),
      barcode: p.barcode,
      stock_on_hand: Number(p.stock_on_hand ?? 0),
      min_stock_level: Number(p.min_stock_level ?? 0),
      category_id: p.category_id ? String(p.category_id) : undefined,
      category_name: p.category_name ? String(p.category_name) : undefined,
      subcategory_id: p.subcategory_id ? String(p.subcategory_id) : undefined,
      subcategory_name: p.subcategory_name ? String(p.subcategory_name) : undefined,
      pieces: prodPieces, // retain full admin pieces including purchase cost & location
      category_visible: p.category_visible !== false,
    };
  });
}

export async function erpReferences(profile: Profile) {
  const data: Record<string, unknown> = {};
  if (['catalogue', 'inventory', 'pos', 'purchases'].some((c) => can(profile, c)) || profile.role === 'superadmin') {
    data.products = await posProducts();
    data.categories = await rows('product_categories');
  }
  if (can(profile, 'purchases')) data.suppliers = await rows('suppliers');
  if (can(profile, 'attendance') || profile.role === 'superadmin')
    data.employees = await rows(
      'employees',
      profile.role === 'superadmin'
        ? '*'
        : 'id,code,name,employment,active,joined_on,ended_on,daily_minutes',
    );
  if (profile.role === 'superadmin') {
    data.salary_policies = await rows('salary_policies');
    data.profiles = await rows('profiles', 'id,email,role,display_name');
  }
  if (can(profile, 'expenses'))
    data.expense_categories = await rows('expense_categories');
  return data;
}
