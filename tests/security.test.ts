import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { imageType, verifyHmac } from "../src/lib/security";
import { safeReturn, trackingUrl, money } from "../src/lib/core";
import {
  checkoutSchema,
  settingsSchema,
  productSchema,
} from "../src/lib/schemas";
test("payment signatures bind every byte and reject malformed signatures", () => {
  const body = "order_abc|pay_xyz",
    secret = "test-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert(verifyHmac(body, signature, secret));
  assert(!verifyHmac(body + "0", signature, secret));
  assert(!verifyHmac(body, signature, "other"));
  assert(!verifyHmac(body, "g".repeat(64), secret));
  assert(!verifyHmac(body, "a", secret));
});
test("only safe local redirects and HTTPS encoded tracking links are used", () => {
  for (const p of ["//evil.test", "https://evil.test", "/\\evil", "/\nfoo"])
    assert.equal(safeReturn(p), "/account");
  assert.equal(safeReturn("/account/orders/1"), "/account/orders/1");
  assert.equal(trackingUrl("javascript:alert(1)", "abc"), null);
  assert.equal(
    trackingUrl("https://track.example/{tracking_id}", "a/b?c"),
    "https://track.example/a%2Fb%3Fc",
  );
  assert.equal(money(0), "00 Rs");
  assert.equal(money(125050), "1,250.5 Rs");
});
test("image validation checks bytes rather than trusting filenames", () => {
  assert.equal(imageType(Uint8Array.from([255, 216, 255, 0])), "image/jpeg");
  assert.equal(imageType(Buffer.from('<svg onload="evil()"/>')), null);
  assert.equal(imageType(Buffer.from("RIFFxxxxWEBPxxxx")), "image/webp");
});
test("checkout forbids price injection and malformed addresses", () => {
  const data = {
    key: crypto.randomUUID(),
    cart: [{ product_id: crypto.randomUUID(), quantity: 1 }],
    address: {
      name: "Test user",
      phone: "9876543210",
      line1: "123 Test road",
      line2: "",
      city: "Chennai",
      state: "Tamil Nadu",
      pin: "600001",
    },
    channel: "upi",
    coupon: "",
    whatsapp_consent: false,
  };
  assert(checkoutSchema.safeParse(data).success);
  assert(!checkoutSchema.safeParse({ ...data, total_paise: 1 }).success);
  assert(
    !checkoutSchema.safeParse({
      ...data,
      cart: [{ ...data.cart[0], price_paise: 1 }],
    }).success,
  );
  assert(
    !checkoutSchema.safeParse({
      ...data,
      cart: [{ ...data.cart[0], quantity: -1 }],
    }).success,
  );
  assert(
    !checkoutSchema.safeParse({
      ...data,
      address: { ...data.address, pin: "000000" },
    }).success,
  );
});
test("product and settings schemas reject protected stock fields and unsafe content", () => {
  assert(!productSchema.safeParse({ stock_on_hand: 100 }).success);
  assert(
    !settingsSchema.safeParse({
      ordering_enabled: true,
      checkout_mode: "both",
      whatsapp_phone: "",
    }).success,
  );
});
