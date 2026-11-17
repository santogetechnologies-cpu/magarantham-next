import { randomUUID } from "node:crypto";
import {
  identity,
  staff,
  origin,
  rate,
  service,
  rpc,
  ok,
  failure,
  Fault,
} from "@/lib/server";
import { uuid } from "@/lib/schemas";
import { imageType } from "@/lib/security";
export async function POST(req: Request) {
  try {
    origin(req);
    const session = await identity();
    await rate(req, "upload", session.user.id, 15);
    if (Number(req.headers.get("content-length") || 0) > 5300000)
      throw new Fault(413, "FILE_TOO_LARGE");
    // Stream-bounded before form parsing; never buffer an unbounded chunked upload.
    const reader = req.body?.getReader();
    if (!reader) throw new Fault(400, "FILE_REQUIRED");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5300000) {
        await reader.cancel();
        throw new Fault(413, "FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bounded = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: Buffer.concat(chunks),
    });
    const form = await bounded.formData();
    const kind = form.get("kind");
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 5242880 || file.size < 12)
      throw new Fault(400, "INVALID_IMAGE");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = imageType(bytes);
    if (!mime || mime !== file.type)
      throw new Fault(
        400,
        "INVALID_IMAGE",
        "Use a real JPEG, PNG or WebP image.",
      );
    const extension = mime.split("/")[1];
    const db = service();
    let bucket: string, path: string;
    if (kind === "media") {
      await staff("content");
      bucket = "store-media";
      path = `images/${randomUUID()}.${extension}`;
    } else if (kind === "proof") {
      const id = uuid.parse(form.get("order_id"));
      const ref = String(form.get("reference") || "").trim();
      if (!/^[a-zA-Z0-9 -]{6,80}$/.test(ref))
        throw new Fault(400, "REFERENCE_REQUIRED");
      const { data: o } = await db
        .from("orders")
        .select("id,channel,status,payment_status")
        .eq("id", id)
        .eq("customer_id", session.user.id)
        .single();
      if (
        !o ||
        o.channel === "razorpay" ||
        !["awaiting_payment", "expired", "cancelled"].includes(o.status) ||
        !["pending", "submitted", "failed"].includes(o.payment_status)
      )
        throw new Fault(403, "PROOF_NOT_ALLOWED");
      bucket = "payment-proofs";
      path = `${session.user.id}/${id}/${randomUUID()}.${extension}`;
    } else throw new Fault(400, "INVALID_UPLOAD_KIND");
    const { error } = await db.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: mime,
        upsert: false,
        cacheControl: kind === "media" ? "31536000" : "0",
      });
    if (error) throw new Fault(503, "UPLOAD_FAILED");
    if (kind === "proof") {
      try {
        await rpc("submit_payment_proof", {
          p_customer: session.user.id,
          p_order: form.get("order_id"),
          p_path: path,
          p_reference: String(form.get("reference")).trim(),
        });
      } catch (e) {
        await db.storage.from(bucket).remove([path]);
        throw e;
      }
      return ok({
        message: "Proof uploaded. Staff must check the bank payment.",
      });
    }
    const url = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    return ok({
      url,
      message: "Image uploaded. Copy this URL into an image field.",
    });
  } catch (e) {
    return failure(e);
  }
}
