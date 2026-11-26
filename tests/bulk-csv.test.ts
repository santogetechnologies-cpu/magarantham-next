import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_SAREE_CSV,
  SAMPLE_SAREE_CSV_FILENAME,
  BULK_SAREE_CSV_HEADERS,
  parseBulkSareeCsv,
} from "../src/lib/bulk-csv";

test("Download Sample CSV: filename, headers, and 2 valid sample saree products", () => {
  assert.equal(SAMPLE_SAREE_CSV_FILENAME, "saree-product-sample.csv");

  const lines = SAMPLE_SAREE_CSV.split("\n");
  assert.equal(lines.length, 3, "Header + 2 sample product rows");
  assert.equal(lines[0], BULK_SAREE_CSV_HEADERS.join(","));

  const parsed = parseBulkSareeCsv(SAMPLE_SAREE_CSV);
  assert.equal(parsed.length, 2);

  for (const row of parsed) {
    assert.equal(row.valid, true, `Row ${row.rowNumber} should be valid: ${row.error}`);
    assert.ok(row.sku.startsWith("MS-"));
    assert.ok(row.name.length > 5);
    assert.ok(row.category.length > 0);
    assert.ok(row.subcategory.length > 0);
    assert.ok(row.fabric.length > 0);
    assert.ok(row.colour.length > 0);
    assert.ok(row.saree_type.length > 0);
    assert.ok(row.design.length > 0);
    assert.ok(row.description.length > 10);
    assert.ok(row.original_price_rs >= row.selling_price_rs);
    assert.ok(row.selling_price_rs > 0);
    assert.ok(row.stock > 0);
    assert.ok(row.image_path.startsWith("/assets/"));
    assert.equal(row.status, "published");
  }
});
