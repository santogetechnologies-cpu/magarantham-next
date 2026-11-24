import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE128_PATTERNS, code128Barcode, code128Values } from "../src/lib/barcode";

test("Code 128 table: 107 distinct patterns, 11 modules each, even bar sum (parity check catches typos)", () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  assert.equal(new Set(CODE128_PATTERNS).size, 107);
  CODE128_PATTERNS.forEach((p, v) => {
    const w = [...p].map(Number);
    assert.equal(w.reduce((a, b) => a + b, 0), v === 106 ? 13 : 11, `pattern ${v} width`);
    const bars = w.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
    assert.equal(bars % 2, 0, `pattern ${v} bar parity`);
  });
});

/** Independent decoder: read bar/space widths back into text, verifying the checksum. */
function decode(raw: string) {
  const { bars, width } = code128Barcode(raw);
  // rebuild the module sequence, then the width runs
  const mods = new Array(width).fill(0);
  for (const b of bars) for (let k = 0; k < b.width; k++) mods[b.x + k] = 1;
  const runs: number[] = [];
  let i = mods.indexOf(1);
  const end = mods.lastIndexOf(1) + 1;
  while (i < end) { let n = 0; const c = mods[i]; while (i < end && mods[i] === c) { n++; i++; } runs.push(n); }
  const values: number[] = [];
  for (let k = 0; k + 6 <= runs.length; k += 6) {
    const key = runs.slice(k, k + 6).join("");
    const v = CODE128_PATTERNS.indexOf(key);
    if (v === -1 && runs.slice(k).join("") === "2331112") { values.push(106); break; }
    assert.notEqual(v, -1, `unknown symbol ${key}`);
    values.push(v);
  }
  const stop = values.pop();
  assert.equal(stop, 106);
  const check = values.pop()!;
  assert.equal(values.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103, check, "checksum");
  let set = values[0] === 105 ? "C" : "B", out = "";
  for (const v of values.slice(1)) {
    if (v === 99) { set = "C"; continue; }
    if (v === 100) { set = "B"; continue; }
    out += set === "C" ? String(v).padStart(2, "0") : String.fromCharCode(v + 32);
  }
  return out;
}

test("Code 128 round-trips every kind of code the shop prints", () => {
  for (const code of ["MSU000000000123", "MSU17761234001042", "MS-1001", "8901234567890", "KAN-PUR-001", "pc-ruby-003", "12", "A", "MS-SILK-RED-0012345"]) {
    assert.equal(decode(code), code, code);
  }
});

test("Code 128 labels are compact enough to print sharply", () => {
  // A 15-character unit code fits in well under 200 modules (≈0.27 mm bars on a 50 mm label)
  const unit = code128Barcode("MSU000000000123");
  assert.ok(unit.width < 200, `width ${unit.width}`);
  // Numeric-only codes start directly in the dense set
  assert.equal(code128Values("12345678")[0], 105);
  // …and Code 128 is much narrower than the old Code 39 for the same unit code
  assert.ok(unit.width < 0.7 * 300);
});
