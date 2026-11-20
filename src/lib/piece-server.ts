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
  } catch {}
  return {};
}

function writeLocalCache(map: Record<string, IndividualPiece[]>) {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(map, null, 2), "utf8");
  } catch {}
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
  } catch {}

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
  }));

  map[pid] = normalized;
  await savePiecesMap(map);

  // Synchronize product stock counts in database
  await syncProductStockFromPieces(pid, normalized);

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

  for (const [pid, pieces] of Object.entries(map)) {
    const idx = pieces.findIndex((p) => p.id === pieceId || p.piece_code === pieceId || p.barcode === pieceId);
    if (idx !== -1) {
      pieces[idx].status = status;
      foundPiece = pieces[idx];
      targetProductId = pid;
      break;
    }
  }

  if (foundPiece && targetProductId) {
    await savePiecesMap(map);
    await syncProductStockFromPieces(targetProductId, map[targetProductId]);
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

  const prevLen = map[pid].length;
  map[pid] = map[pid].filter((p) => p.id !== pieceId && p.piece_code !== pieceId);
  if (map[pid].length !== prevLen) {
    await savePiecesMap(map);
    await syncProductStockFromPieces(pid, map[pid]);
    return true;
  }
  return false;
}

export async function syncProductStockFromPieces(
  productId: string,
  explicitPieces?: IndividualPiece[],
): Promise<{ stock_on_hand: number; reserved: number }> {
  const pieces = explicitPieces || (await getPiecesForProduct(productId));
  const availableCount = pieces
    .filter((p) => p.status === "available")
    .reduce((sum, p) => sum + (p.quantity != null && !isNaN(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1), 0);
  const reservedCount = pieces
    .filter((p) => p.status === "reserved")
    .reduce((sum, p) => sum + (p.quantity != null && !isNaN(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1), 0);

  const db = service();
  try {
    const updatePayload: Record<string, any> = {
      stock_on_hand: availableCount,
      reserved: reservedCount,
    };
    if (pieces.length > 0 && pieces[0]?.min_quantity != null && !isNaN(Number(pieces[0].min_quantity))) {
      updatePayload.min_stock_level = Math.max(0, Number(pieces[0].min_quantity));
    }
    await db
      .from("products")
      .update(updatePayload)
      .eq("id", productId);
  } catch (err) {
    console.warn("syncProductStockFromPieces database update error:", err);
  }

  return { stock_on_hand: availableCount, reserved: reservedCount };
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
