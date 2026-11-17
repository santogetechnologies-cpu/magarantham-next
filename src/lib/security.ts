import { createHmac, timingSafeEqual } from "node:crypto";
export function safeEqual(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function verifyHmac(body: string, signature: string, secret: string) {
  return (
    /^[a-f0-9]{64}$/i.test(signature) &&
    safeEqual(
      createHmac("sha256", secret).update(body).digest("hex"),
      signature.toLowerCase(),
    )
  );
}
export function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    Buffer.from(bytes.slice(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return "image/png";
  if (
    Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
