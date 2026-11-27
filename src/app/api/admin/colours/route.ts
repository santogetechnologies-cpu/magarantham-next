import { z } from "zod";
import { revalidatePath } from "next/cache";
import { staff, service, origin, json, rate, rpc, ok, failure, Fault } from "@/lib/server";
import { uuid } from "@/lib/schemas";
import { parseColours } from "@/lib/core";
import { legacyPieceColours } from "@/lib/piece-server";

/**
 * Colour stock of one individual saree (one barcode, one price).
 * GET  ?product_id=  -> colours, total pieces, undefined pieces (+ an old piece list to copy, if any)
 * POST {product_id, rows, total?, reason?} -> replaces the colour split; `total` also changes stock.
 */
const image = z
  .string()
  .trim()
  .max(1000)
  .refine((s) => s === "" || /^\/assets\/[a-zA-Z0-9._/-]+$/.test(s) || (/^https:\/\//.test(s) && !/[<>"']/.test(s)), "Use an uploaded photo");

const rowSchema = z
  .object({
    id: uuid.optional().nullable(),
    colour: z.string().trim().min(1).max(50),
    colour_hex: z.union([z.literal(""), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]).default(""),
    quantity: z.number().int().min(0).max(100000),
    image_path: image.default(""),
    sort_order: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

async function load(productId: string) {
  const db = service();
  const { data, error } = await db
    .from("store_catalogue")
    .select("id,name,sku,barcode,image_path,stock_on_hand,reserved,colours,undefined_quantity,online_available,online_ready")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Fault(503, "LOAD_FAILED", "Colour stock needs migration 202611270023_colour_stock.sql. Apply it in Supabase and reload.");
  if (!data) throw new Fault(404, "PRODUCT_NOT_FOUND");
  return { ...data, colours: parseColours(data.colours) };
}

export async function GET(req: Request) {
  try {
    await staff("catalogue");
    const productId = uuid.parse(new URL(req.url).searchParams.get("product_id"));
    const product = await load(productId);
    const legacy = product.colours.length ? [] : await legacyPieceColours(productId);
    return ok({ product, colours: product.colours, legacy });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    origin(req);
    const s = await staff("catalogue");
    await rate(req, "admin-write", s.user.id, 100);
    const p = z
      .object({
        product_id: uuid,
        rows: z.array(rowSchema).max(60),
        total: z.number().int().min(0).max(100000).nullable().optional(),
        reason: z.string().trim().max(300).optional(),
      })
      .strict()
      .parse(await json(req));
    await rpc("colour_stock_save", {
      p_actor: s.user.id,
      p_product: p.product_id,
      p_rows: p.rows.map((r, i) => ({ ...r, id: r.id || null, sort_order: r.sort_order || i })),
      p_total: p.total ?? null,
      p_reason: p.reason || "Colour stock edit",
    });
    try {
      revalidatePath("/", "layout");
      revalidatePath("/shop");
      revalidatePath("/products/[slug]", "page");
    } catch {}
    const product = await load(p.product_id);
    return ok({ message: "Colour stock saved.", product, colours: product.colours });
  } catch (e) {
    return failure(e);
  }
}
