import assert from "node:assert/strict";
const base = process.env.NEXT_PUBLIC_SITE_URL;
if (!base) throw new Error("Set NEXT_PUBLIC_SITE_URL first.");
for (const path of [
  "/",
  "/shop",
  "/products/magenta-kanchipuram-saree",
  "/cart",
  "/login",
  "/register",
  "/bulk",
]) {
  const r = await fetch(`${base}${path}`);
  assert.equal(r.status, 200, `${path} must render`);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  console.log("PASS page", path);
}
for (const path of ["/api/account/session", "/api/admin/overview"]) {
  const r = await fetch(`${base}${path}`);
  assert(
    [401, 503].includes(r.status),
    "private API must reject unauthenticated access",
  );
  console.log("PASS unauthenticated block", path);
}
const crossSite = await fetch(`${base}/api/checkout`, {
  method: "POST",
  headers: {
    Origin: "https://untrusted.invalid",
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(crossSite.status, 403);
console.log("PASS cross-origin mutation blocked");
const webhook = await fetch(`${base}/api/webhooks/razorpay`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-razorpay-signature": "forged",
  },
  body: "{}",
});
assert([401, 503].includes(webhook.status));
console.log("PASS forged webhook blocked");
const cron = await fetch(`${base}/api/cron/maintenance`);
assert.equal(cron.status, 401);
console.log("PASS unauthenticated cron blocked");
console.log(
  "Read-only HTTP checks passed. Complete the authenticated, concurrent and settlement checks in WORKFLOW-GUIDE.xlsx before launch.",
);
