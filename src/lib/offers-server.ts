// src/lib/offers-server.ts
// Magarantham Silks: Server-side offers & target persistence layer

import "server-only";
import fs from "fs";
import path from "path";
import { service } from "./server";
import {
  EnhancedOffer,
  OfferTargetRecord,
  OfferTargetType,
} from "./offers";

const TARGETS_STORAGE_KEY = "offer-targets.json";
const LOCAL_CACHE_DIR = path.join(process.cwd(), ".cache");
const LOCAL_CACHE_PATH = path.join(LOCAL_CACHE_DIR, "offer-targets.json");

let memoryTargetsCache: Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }> | null = null;
let lastCacheSync = 0;
const CACHE_TTL_MS = 2500;

function readLocalTargetsCache(): Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }> {
  try {
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      const raw = fs.readFileSync(LOCAL_CACHE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}

function writeLocalTargetsCache(map: Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }>) {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(map, null, 2), "utf8");
  } catch {}
}

export async function getTargetsMap(): Promise<
  Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }>
> {
  const now = Date.now();
  if (memoryTargetsCache && now - lastCacheSync < CACHE_TTL_MS) {
    return memoryTargetsCache;
  }

  const db = service();
  // 1. Try fetching from Supabase Storage
  try {
    const { data } = await db.storage
      .from("store-media")
      .download(TARGETS_STORAGE_KEY);
    if (data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        memoryTargetsCache = parsed;
        lastCacheSync = now;
        writeLocalTargetsCache(parsed);
        return parsed;
      }
    }
  } catch {}

  // 2. Try fetching from public.offer_targets table if exists
  try {
    const { data: dbTargets } = await db.from("offer_targets").select("*");
    if (dbTargets && Array.isArray(dbTargets) && dbTargets.length > 0) {
      const builtMap: Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }> = {};
      for (const t of dbTargets) {
        const oid = String(t.offer_id);
        if (!builtMap[oid]) {
          builtMap[oid] = { target_type: t.target_type as OfferTargetType, priority: 0, targets: [] };
        }
        builtMap[oid].targets.push(t);
      }
      memoryTargetsCache = builtMap;
      lastCacheSync = now;
      writeLocalTargetsCache(builtMap);
      return builtMap;
    }
  } catch {}

  // 3. Fallback to local disk cache
  const local = readLocalTargetsCache();
  memoryTargetsCache = local;
  lastCacheSync = now;
  return local;
}

export async function saveTargetsMap(
  map: Record<string, { target_type: OfferTargetType; priority: number; targets: OfferTargetRecord[] }>,
): Promise<void> {
  memoryTargetsCache = map;
  lastCacheSync = Date.now();
  writeLocalTargetsCache(map);

  const db = service();
  try {
    await db.storage
      .from("store-media")
      .upload(
        TARGETS_STORAGE_KEY,
        Buffer.from(JSON.stringify(map)),
        { upsert: true, contentType: "application/json" },
      );
  } catch (err) {
    console.warn("Storage upload for offer-targets:", err);
  }
}

/**
 * Fetch all offers with their targets and metadata merged.
 */
export async function getOffersWithTargets(): Promise<EnhancedOffer[]> {
  const db = service();
  const [offersRes, targetsMap] = await Promise.all([
    db
      .from("offers")
      .select("*")
      .order("created_at", { ascending: false }),
    getTargetsMap(),
  ]);

  const rawOffers = (offersRes.data || []) as Record<string, any>[];

  return rawOffers.map((o) => {
    const oid = String(o.id);
    const meta = targetsMap[oid] || {
      target_type: (o.target_type as OfferTargetType) || "all",
      priority: Number(o.priority || 0),
      targets: [],
    };

    return {
      id: oid,
      title: o.title || "Special Offer",
      code: o.code || null,
      kind: (o.kind as "percent" | "fixed") || "percent",
      value: Number(o.value || 0),
      min_subtotal_paise: Number(o.min_subtotal_paise || 0),
      max_discount_paise: o.max_discount_paise !== null && o.max_discount_paise !== undefined
        ? Number(o.max_discount_paise)
        : null,
      max_uses: o.max_uses !== null && o.max_uses !== undefined ? Number(o.max_uses) : null,
      used_count: Number(o.used_count || 0),
      per_customer_limit: Number(o.per_customer_limit || 1),
      active: Boolean(o.active ?? true),
      starts_at: o.starts_at || null,
      ends_at: o.ends_at || null,
      target_type: meta.target_type || "all",
      priority: meta.priority ?? 0,
      description: o.description || null,
      targets: meta.targets || [],
    };
  });
}

/**
 * Save an offer and its targets.
 */
export async function saveOfferWithTargets(
  input: {
    id?: string | null;
    title: string;
    code?: string | null;
    kind: "percent" | "fixed";
    value: number;
    min_subtotal_paise?: number;
    max_discount_paise?: number | null;
    max_uses?: number | null;
    per_customer_limit?: number;
    active?: boolean;
    starts_at?: string | null;
    ends_at?: string | null;
    target_type?: OfferTargetType;
    priority?: number;
    description?: string | null;
  },
  targets: OfferTargetRecord[] = [],
): Promise<string> {
  const db = service();
  const targetType = input.target_type || "all";
  const priority = input.priority !== undefined ? Number(input.priority) : 0;

  // Clean code: uppercase or null
  const code = input.code && input.code.trim() ? input.code.trim().toUpperCase() : null;

  // Value: percent (1-90) or fixed amount in paise
  let value = Number(input.value) || 0;
  if (input.kind === "percent") {
    value = Math.max(1, Math.min(90, value));
  } else {
    // If entered in rupees (< 100000), convert to paise
    if (value > 0 && value < 100000) {
      value = Math.round(value * 100);
    }
  }

  const baseRecord: Record<string, any> = {
    title: input.title.trim().slice(0, 100),
    code,
    kind: input.kind,
    value,
    min_subtotal_paise: Math.max(0, Number(input.min_subtotal_paise || 0)),
    max_discount_paise:
      input.max_discount_paise !== null && input.max_discount_paise !== undefined
        ? Math.max(0, Number(input.max_discount_paise))
        : null,
    max_uses:
      input.max_uses !== null && input.max_uses !== undefined && Number(input.max_uses) > 0
        ? Number(input.max_uses)
        : null,
    per_customer_limit: Math.max(1, Number(input.per_customer_limit || 1)),
    active: input.active !== undefined ? Boolean(input.active) : true,
    starts_at: input.starts_at || null,
    ends_at: input.ends_at || null,
  };

  let offerId = input.id;

  if (offerId) {
    // Update existing offer
    const { error } = await db.from("offers").update(baseRecord).eq("id", offerId);
    if (error) {
      throw new Error(`Failed to update offer: ${error.message}`);
    }
  } else {
    // Insert new offer
    const { data, error } = await db.from("offers").insert(baseRecord).select("id").single();
    if (error || !data?.id) {
      throw new Error(`Failed to create offer: ${error?.message || "No ID returned"}`);
    }
    offerId = data.id;
  }

  // Checkout (SQL) reads target_type/priority from the offer row and its
  // offer_targets rows, so keep them in the database as well as the JSON map.
  await db.from("offers").update({ target_type: targetType, priority }).eq("id", offerId);

  // 2. Persist extended targets in metadata map
  const targetsMap = await getTargetsMap();
  const cleanedTargets = targets.map((t) => ({
    offer_id: offerId!,
    target_type: t.target_type,
    category_id: t.category_id || null,
    subcategory_id: t.subcategory_id || null,
    product_id: t.product_id || null,
  }));

  targetsMap[offerId!] = {
    target_type: targetType,
    priority,
    targets: cleanedTargets,
  };

  await saveTargetsMap(targetsMap);

  // 3. Optional: Try saving to offer_targets DB table if present
  try {
    await db.from("offer_targets").delete().eq("offer_id", offerId);
    if (cleanedTargets.length > 0) {
      await db.from("offer_targets").insert(cleanedTargets);
    }
  } catch {}

  return offerId!;
}

/**
 * Delete an offer and its associated targets.
 */
export async function deleteOfferWithTargets(id: string): Promise<void> {
  const db = service();
  const { error } = await db.from("offers").delete().eq("id", id);
  if (error) {
    throw new Error(`Failed to delete offer: ${error.message}`);
  }

  const targetsMap = await getTargetsMap();
  if (targetsMap[id]) {
    delete targetsMap[id];
    await saveTargetsMap(targetsMap);
  }

  try {
    await db.from("offer_targets").delete().eq("offer_id", id);
  } catch {}
}
