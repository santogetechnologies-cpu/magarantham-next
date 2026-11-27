import "server-only";
import { service } from "./server";
import { IndividualPiece } from "./core";

/**
 * Read-only access to the retired "piece-metadata.json" list (kept in Storage by
 * earlier versions). Colour stock now lives in the product_colours table; this file
 * only lets the admin copy an old colour breakdown into it once.
 */
let cache: { at: number; map: Record<string, IndividualPiece[]> } | null = null;

async function legacyPiecesMap(): Promise<Record<string, IndividualPiece[]>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  let map: Record<string, IndividualPiece[]> = {};
  try {
    const { data } = await service().storage.from("store-media").download("piece-metadata.json");
    if (data) {
      const parsed = JSON.parse(await data.text());
      if (parsed && typeof parsed === "object") map = parsed;
    }
  } catch {
    // No old list: nothing to offer.
  }
  cache = { at: Date.now(), map };
  return map;
}

/** Old available pieces of one saree grouped by colour, e.g. [{colour:"Red", quantity:3}]. */
export async function legacyPieceColours(
  productId: string,
): Promise<{ colour: string; quantity: number; image_path: string }[]> {
  const pieces = (await legacyPiecesMap())[String(productId)] || [];
  const byColour = new Map<string, { colour: string; quantity: number; image_path: string }>();
  for (const p of pieces) {
    if (p.status !== "available") continue;
    const name = String(p.colour || "").trim();
    if (!name || /^(standard|undefined|custom)$/i.test(name)) continue;
    const qty = p.quantity != null && !Number.isNaN(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1;
    const key = name.toLowerCase();
    const row = byColour.get(key) || { colour: name, quantity: 0, image_path: "" };
    row.quantity += qty;
    if (!row.image_path && p.image_path) row.image_path = String(p.image_path);
    byColour.set(key, row);
  }
  return [...byColour.values()].filter((r) => r.quantity > 0);
}
