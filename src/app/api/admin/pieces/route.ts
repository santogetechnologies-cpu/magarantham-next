import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  staff,
  origin,
  json,
  rate,
  ok,
  failure,
  Fault,
} from "@/lib/server";
import { uuid } from "@/lib/schemas";
import {
  getPiecesForProduct,
  savePiecesForProduct,
  updatePieceStatus,
  deletePiece,
} from "@/lib/piece-server";
import { IndividualPiece, PieceStatus } from "@/lib/core";

export async function GET(req: Request) {
  try {
    const s = await staff("catalogue");
    const url = new URL(req.url);
    const productId = url.searchParams.get("product_id");
    if (!productId) {
      throw new Fault(400, "PRODUCT_ID_REQUIRED");
    }
    uuid.parse(productId);
    const pieces = await getPiecesForProduct(productId);
    return ok({ pieces });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    origin(req);
    const s = await staff("catalogue");
    await rate(req, "admin-write", s.user.id, 100);

    const body = await json(req);
    const schema = z.object({
      product_id: uuid,
      pieces: z.array(
        z.object({
          id: z.string().optional(),
          product_id: uuid.optional(),
          piece_code: z.string().trim().min(1).max(60),
          barcode: z.string().trim().max(60).optional(),
          colour: z.string().trim().max(60),
          price_paise: z.number().int().min(0).max(100000000),
          purchase_cost_paise: z.number().int().min(0).max(100000000).optional(),
          status: z.enum(["available", "reserved", "sold", "damaged", "returned"]),
          image_path: z.string().trim().max(1000).optional(),
          location: z.string().trim().max(100).optional(),
          created_at: z.string().optional(),
        }),
      ),
    });

    const parsed = schema.parse(body);
    const saved = await savePiecesForProduct(
      parsed.product_id,
      parsed.pieces as IndividualPiece[],
    );

    try {
      revalidatePath("/", "layout");
      revalidatePath("/shop");
      revalidatePath("/products/[slug]", "page");
    } catch {}

    return ok({
      message: "Pieces saved successfully.",
      pieces: saved,
      available_count: saved.filter((p) => p.status === "available").length,
      total_count: saved.length,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: Request) {
  try {
    origin(req);
    const s = await staff("catalogue");
    await rate(req, "admin-write", s.user.id, 100);

    const body = await json(req);
    const schema = z.object({
      piece_id: z.string().min(1),
      status: z.enum(["available", "reserved", "sold", "damaged", "returned"]),
    });

    const parsed = schema.parse(body);
    const updated = await updatePieceStatus(
      parsed.piece_id,
      parsed.status as PieceStatus,
    );

    if (!updated) {
      throw new Fault(404, "PIECE_NOT_FOUND");
    }

    try {
      revalidatePath("/", "layout");
      revalidatePath("/shop");
      revalidatePath("/products/[slug]", "page");
    } catch {}

    return ok({
      message: `Piece ${updated.piece_code} marked as ${parsed.status}.`,
      piece: updated,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  try {
    origin(req);
    const s = await staff("catalogue");
    await rate(req, "admin-write", s.user.id, 100);

    const url = new URL(req.url);
    const productId = url.searchParams.get("product_id");
    const pieceId = url.searchParams.get("piece_id");

    if (!productId || !pieceId) {
      throw new Fault(400, "PRODUCT_AND_PIECE_ID_REQUIRED");
    }

    uuid.parse(productId);
    const deleted = await deletePiece(productId, pieceId);

    if (!deleted) {
      throw new Fault(404, "PIECE_NOT_FOUND");
    }

    try {
      revalidatePath("/", "layout");
      revalidatePath("/shop");
      revalidatePath("/products/[slug]", "page");
    } catch {}

    return ok({ message: "Piece removed from catalogue." });
  } catch (e) {
    return failure(e);
  }
}
