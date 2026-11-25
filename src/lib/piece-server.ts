import "server-only";
import fs from "fs";
import path from "path";
import { service } from "./server";
import { IndividualPiece, PieceStatus } from "./core";

const PIECES_STORAGE_KEY = "piece-metadata.json";
const LOCAL_CACHE_DIR = path.join(process.cwd(), ".cache");
const LOCAL_CACHE_PATH = path.join(LOCAL_CACHE_DIR, "piece-metadata.json");

// In-memory cache for ultra-fast lookups during request lifecycle
let memoryPiecesCache: Record<string, IndividualPiece[]> | null = null;
let lastCacheSync = 0;
const CACHE_TTL_MS = 2000; // 2 seconds

function readLocalCache(): Record<string, IndividualPiece[]> {
  try {
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      const raw = fs.readFileSync(LOCAL_CACHE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch { }
  return {};
}

function writeLocalCache(map: Record<string, IndividualPiece[]>) {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(map, null, 2), "utf8");
  } catch { }
}

export async function getPiecesMap(): Promise<Record<string, IndividualPiece[]>> {
  const now = Date.now();
  if (memoryPiecesCache && now - lastCacheSync < CACHE_TTL_MS) {
    return memoryPiecesCache;
  }

  const db = service();
  try {
    const { data } = await db.storage
      .from("store-media")
      .download(PIECES_STORAGE_KEY);
    if (data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        memoryPiecesCache = parsed;
        lastCacheSync = now;
        writeLocalCache(parsed);
        return parsed;
      }
    }
  } catch { }

  // Fallback to local cache if storage had a momentary delay
  const local = readLocalCache();
  memoryPiecesCache = local;
  lastCacheSync = now;
  return local;
}

export async function savePiecesMap(
  map: Record<string, IndividualPiece[]>,
): Promise<void> {
  memoryPiecesCache = map;
  lastCacheSync = Date.now();
  writeLocalCache(map);

  const db = service();
  try {
    await db.storage
      .from("store-media")
      .upload(
        PIECES_STORAGE_KEY,
        Buffer.from(JSON.stringify(map)),
        { upsert: true, contentType: "image/webp" },
      );
  } catch (err) {
    console.warn("Storage upload for pieces-metadata:", err);
  }
}

export async function getPiecesForProduct(
  productId: string,
): Promise<IndividualPiece[]> {
  const map = await getPiecesMap();
  return map[String(productId)] || [];
}

export async function savePiecesForProduct(
  productId: string,
  pieces: IndividualPiece[],
): Promise<IndividualPiece[]> {
  const map = await getPiecesMap();
  const pid = String(productId);
  const before = map[pid] || [];

  // Normalize pieces with IDs, timestamps and barcodes if missing
  const normalized: IndividualPiece[] = pieces.map((p, idx) => ({
    id: p.id || `piece-${pid.slice(0, 8)}-${idx + 1}-${Date.now().toString(36)}`,
    product_id: pid,
    piece_code: (p.piece_code || "").trim() || `PC-${pid.slice(0, 6).toUpperCase()}-${String(idx + 1).padStart(3, "0")}`,
    barcode: (p.barcode || "").trim() || `MSU${Date.now().toString().slice(-8)}${String(idx + 1).padStart(4, "0")}`,
    colour: (p.colour || "Standard").trim(),
    price_paise: Math.max(0, Math.round(Number(p.price_paise || 0))),
    purchase_cost_paise: p.purchase_cost_paise != null ? Math.max(0, Math.round(Number(p.purchase_cost_paise))) : undefined,
    quantity: p.quantity != null && !isNaN(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1,
    min_quantity: p.min_quantity != null && !isNaN(Number(p.min_quantity)) ? Math.max(0, Number(p.min_quantity)) : 0,
    status: (p.status || "available") as PieceStatus,
    image_path: p.image_path ? p.image_path.trim() : undefined,
    location: p.location ? p.location.trim() : undefined,
    created_at: p.created_at || new Date().toISOString(),
    unit_id: p.unit_id != null ? p.unit_id : undefined,
    sold_refs: Array.isArray(p.sold_refs) ? p.sold_refs.slice(-20) : undefined,
  }));

  map[pid] = normalized;
  await savePiecesMap(map);

  // Apply the change in available pieces to the database stock ledger
  await syncProductStockFromPieces(pid, normalized, before);

  return normalized;
}

export async function updatePieceStatus(
  pieceId: string,
  status: PieceStatus,
  options?: { sale_id?: string; order_id?: string },
): Promise<IndividualPiece | null> {
  const map = await getPiecesMap();
  let foundPiece: IndividualPiece | null = null;
  let targetProductId: string | null = null;
  let before: IndividualPiece[] = [];

  for (const [pid, pieces] of Object.entries(map)) {
    const idx = pieces.findIndex((p) => p.id === pieceId || p.piece_code === pieceId || p.barcode === pieceId);
    if (idx !== -1) {
      before = pieces.map((x) => ({ ...x }));
      pieces[idx].status = status;
      foundPiece = pieces[idx];
      targetProductId = pid;
      break;
    }
  }

  if (foundPiece && targetProductId) {
    await savePiecesMap(map);
    await syncProductStockFromPieces(targetProductId, map[targetProductId], before);
  }

  return foundPiece;
}

export async function deletePiece(
  productId: string,
  pieceId: string,
): Promise<boolean> {
  const map = await getPiecesMap();
  const pid = String(productId);
  if (!map[pid]) return false;

  const before = map[pid];
  map[pid] = map[pid].filter((p) => p.id !== pieceId && p.piece_code !== pieceId);
  if (map[pid].length !== before.length) {
    await savePiecesMap(map);
    await syncProductStockFromPieces(pid, map[pid], before);
    return true;
  }
  return false;
}

const pieceQty = (p: IndividualPiece) =>
  p.quantity != null && !isNaN(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1;
const availableQty = (pieces: IndividualPiece[]) =>
  pieces.filter((p) => p.status === "available").reduce((sum, p) => sum + pieceQty(p), 0);

/**
 * Keeps products.stock_on_hand in step with admin piece edits.
 *
 * The database stock is the ledger shared by POS and online orders, so piece
 * edits are applied as a +/- change instead of overwriting it. Overwriting would
 * bring back stock already sold at the counter or online, and the online
 * `reserved` count is never touched here (checkout owns it).
 */
export async function syncProductStockFromPieces(
  productId: string,
  explicitPieces?: IndividualPiece[],
  previousPieces?: IndividualPiece[],
): Promise<{ stock_on_hand: number } | null> {
  const pieces = explicitPieces || (await getPiecesForProduct(productId));
  const after = availableQty(pieces);
  const db = service();
  try {
    const { data: prod } = await db
      .from("products")
      .select("stock_on_hand,reserved")
      .eq("id", productId)
      .maybeSingle();
    if (!prod) return null;
    const current = Number(prod.stock_on_hand || 0);
    const reserved = Number(prod.reserved || 0);
    const hadPieces = (previousPieces || []).length > 0;
    // First time pieces are recorded they describe stock that may already exist.
    const target = hadPieces
      ? current + (after - availableQty(previousPieces || []))
      : Math.max(current, after);
    const next = Math.max(reserved, target);
    const updatePayload: Record<string, any> = {};
    if (next !== current) updatePayload.stock_on_hand = next;
    if (pieces.length > 0 && pieces[0]?.min_quantity != null && !isNaN(Number(pieces[0].min_quantity))) {
      updatePayload.min_stock_level = Math.max(0, Number(pieces[0].min_quantity));
    }
    if (Object.keys(updatePayload).length) {
      await db.from("products").update(updatePayload).eq("id", productId);
    }
    return { stock_on_hand: next };
  } catch (err) {
    console.warn("syncProductStockFromPieces database update error:", err);
    return null;
  }
}

const hasRef = (p: IndividualPiece, ref: string) =>
  (p.sold_refs || []).some((r) => r === ref || r.startsWith(`${ref}#`));

/**
 * After a POS sale (stock already reduced in the database), mark the sold
 * pieces so piece lists, labels and the website stay in step. Scanned pieces are
 * used first, then the oldest available pieces. Safe to call twice for a sale.
 */
export async function markPiecesSold(
  lines: { product_id: string; quantity: number; piece_ids?: string[] }[],
  saleRef: string,
): Promise<void> {
  const map = await getPiecesMap();
  let changed = false;
  for (const line of lines) {
    const pieces = map[String(line.product_id)];
    if (!pieces?.length) continue;
    if (pieces.some((p) => hasRef(p, saleRef))) continue;
    let need = Math.max(0, Math.round(line.quantity));
    const preferred = new Set((line.piece_ids || []).map((x) => x.toLowerCase()));
    const order = [
      ...pieces.filter((p) => preferred.has(String(p.id).toLowerCase()) || preferred.has(String(p.piece_code).toLowerCase()) || preferred.has(String(p.barcode).toLowerCase())),
      ...pieces,
    ];
    for (const piece of order) {
      if (need <= 0) break;
      if (piece.status !== "available") continue;
      const qty = pieceQty(piece);
      if (qty <= 0) continue;
      const take = Math.min(need, qty);
      if (qty - take <= 0) {
        piece.status = "sold";
        if (qty > 1) piece.quantity = qty;
      } else {
        piece.quantity = qty - take;
      }
      piece.sold_refs = [...(piece.sold_refs || []), `${saleRef}#${take}`].slice(-20);
      need -= take;
      changed = true;
    }
  }
  if (changed) await savePiecesMap(map);
}

export function generatePieceCode(
  categoryName: string,
  colour: string,
  index: number,
): string {
  const catPrefix = (categoryName || "SAR")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase() || "SAR";
  const colPrefix = (colour || "DEF")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase() || "DEF";
  const numStr = String(index).padStart(3, "0");
  return `${catPrefix}-${colPrefix}-${numStr}`;
}

export function generatePieceBarcode(index = 1): string {
  const timestamp = Date.now().toString().slice(-7);
  const padIdx = String(index % 1000).padStart(3, "0");
  const rand = Math.floor(Math.random() * 90 + 10);
  return `MSU${timestamp}${padIdx}${rand}`;
}

/**
 * Undo markPiecesSold for a sale/order that was returned or cancelled (the
 * database has already put the stock back). Safe to call more than once.
 */
export async function restorePieces(ref: string): Promise<void> {
  const map = await getPiecesMap();
  let changed = false;
  for (const pieces of Object.values(map)) {
    for (const piece of pieces) {
      const entry = (piece.sold_refs || []).find((r) => r === ref || r.startsWith(`${ref}#`));
      if (!entry) continue;
      const took = Math.max(1, Number(entry.split("#")[1]) || 1);
      if (piece.status === "sold") piece.status = "available";
      else piece.quantity = pieceQty(piece) + took;
      piece.sold_refs = (piece.sold_refs || []).filter((r) => r !== entry);
      changed = true;
    }
  }
  if (changed) await savePiecesMap(map);
}

/**
 * Bring an online order's pieces in line with its stock state:
 * consumed (paid) → mark pieces sold; released after payment (cancelled/returned) → restore.
 * Never throws; piece records are descriptive and must not block order handling.
 */
export async function syncOrderPieces(orderId: string): Promise<void> {
  try {
    const { data: o } = await service()
      .from("orders")
      .select("stock_state,order_items(product_id,quantity,piece_id)")
      .eq("id", orderId)
      .maybeSingle();
    if (!o) return;
    const ref = `order:${orderId}`;
    if (o.stock_state === "consumed") {
      await markPiecesSold(
        ((o.order_items || []) as { product_id: string; quantity: number; piece_id?: string }[]).map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          piece_ids: l.piece_id ? [l.piece_id] : undefined,
        })),
        ref,
      );
    } else if (o.stock_state === "released") {
      await restorePieces(ref);
    }
  } catch (err) {
    console.warn("syncOrderPieces failed", err);
  }
}
