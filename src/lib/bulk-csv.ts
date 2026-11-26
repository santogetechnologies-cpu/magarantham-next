import { productSchema } from "./schemas";

export const SAMPLE_SAREE_CSV_FILENAME = "saree-product-sample.csv";

export const BULK_SAREE_CSV_HEADERS = [
  "category",
  "subcategory",
  "sku",
  "name",
  "fabric",
  "colour",
  "saree_type",
  "design",
  "description",
  "original_price_rs",
  "selling_price_rs",
  "purchase_cost_rs",
  "stock",
  "min_stock",
  "image_path",
  "status",
] as const;

export const SAMPLE_SAREE_CSV = [
  BULK_SAREE_CSV_HEADERS.join(","),
  'Kanchipuram,Bridal Zari,MS-KAN-MAR-8801,Kanchipuram Bridal Korvai Silk Saree,Pure Mulberry Silk,Maroon,Bridal Kanchipuram,Traditional Temple Zari Border,"Handwoven pure mulberry Kanchipuram silk saree with rich gold zari korvai border and contrast pallu.",9800,8500,5200,5,2,/assets/product-01.jpg,published',
  'Soft Silk,Festive Silk,MS-SOF-PUR-8802,Soft Silk Festive Butta Saree,Pure Soft Silk,Purple,Festive Soft Silk,Gold Zari Floral Butta,"Lightweight pure soft silk saree with delicate gold zari buttas for festive and wedding occasions.",4800,4200,2600,8,2,/assets/product-02.jpg,published',
].join("\n");

export interface ParsedBulkSareeRow {
  rowNumber: number;
  category: string;
  subcategory: string;
  sku: string;
  name: string;
  fabric: string;
  colour: string;
  saree_type: string;
  design: string;
  description: string;
  original_price_rs: number;
  selling_price_rs: number;
  purchase_cost_rs: number;
  stock: number;
  min_stock: number;
  image_path: string;
  status: "published" | "draft" | "archived";
  valid: boolean;
  error?: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSampleImagePath(raw: string): string {
  const val = (raw || "").trim();
  if (!val) return "/assets/product-01.jpg";
  if (val.startsWith("/assets/")) return val;
  if (/^product-\d+\.(jpg|jpeg|png|webp)$/i.test(val)) return `/assets/${val}`;
  return val;
}

export function parseBulkSareeCsv(csvText: string): ParsedBulkSareeRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    firstCols.includes("name") &&
    (firstCols.includes("category") || firstCols.includes("selling_price_rs"));

  const headerIndex = new Map<string, number>();
  if (hasHeader) {
    firstCols.forEach((h, idx) => headerIndex.set(h, idx));
  } else {
    BULK_SAREE_CSV_HEADERS.forEach((h, idx) => headerIndex.set(h, idx));
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line, idx) => {
    const cols = parseCsvLine(line);
    const get = (key: string, fallback = "") => {
      const colIdx = headerIndex.get(key);
      return colIdx !== undefined && cols[colIdx] !== undefined ? cols[colIdx] : fallback;
    };

    const category = get("category", "Kanchipuram") || "Kanchipuram";
    const subcategory = get("subcategory", "");
    const sku = get("sku", "");
    const name = get("name", "");
    const fabric = get("fabric", "Pure Mulberry Silk") || "Pure Mulberry Silk";
    const colour = get("colour", "Maroon") || "Maroon";
    const saree_type = get("saree_type", `${category} Silk`) || `${category} Silk`;
    const design = get("design", "Traditional Zari Border") || "Traditional Zari Border";
    const description = get("description", "");
    const original_price_rs = Math.max(0, Number(get("original_price_rs", "0")) || 0);
    const selling_price_rs = Math.max(0, Number(get("selling_price_rs", "0")) || 0);
    const purchase_cost_rs = Math.max(0, Number(get("purchase_cost_rs", "0")) || 0);
    const stock = Math.max(1, parseInt(get("stock", "1"), 10) || 1);
    const min_stock = Math.max(0, parseInt(get("min_stock", "0"), 10) || 0);
    const image_path = normalizeSampleImagePath(get("image_path", "/assets/product-01.jpg"));
    const rawStatus = get("status", "published").toLowerCase();
    const status: "published" | "draft" | "archived" =
      rawStatus === "archived"
        ? "archived"
        : rawStatus === "draft"
          ? "draft"
          : "published";

    const testPayload = {
      subcategory_id: null,
      barcode: null,
      sku: sku || `MS-${category.slice(0, 3).toUpperCase()}-${idx + 1}`,
      slug: `${slugify(name) || "saree"}-${slugify(colour) || "silk"}-${idx + 1}`,
      name,
      category,
      colour,
      description,
      image_path,
      price_paise: Math.round(selling_price_rs * 100),
      compare_at_price_paise: Math.round(original_price_rs * 100),
      purchase_price_paise: Math.round(purchase_cost_rs * 100),
      min_stock_level: min_stock,
      discount_percent: 0,
      published: status === "published",
      archived: status === "archived",
      featured: false,
      saree_type,
      fabric,
      design,
      sale_unit: "piece" as const,
    };

    const validation = productSchema.safeParse(testPayload);
    return {
      rowNumber: idx + 1,
      category,
      subcategory,
      sku,
      name,
      fabric,
      colour,
      saree_type,
      design,
      description,
      original_price_rs,
      selling_price_rs,
      purchase_cost_rs,
      stock,
      min_stock,
      image_path,
      status,
      valid: validation.success && selling_price_rs > 0,
      error: !validation.success
        ? validation.error.issues[0]?.message || "Invalid product fields"
        : selling_price_rs <= 0
          ? "selling_price_rs must be greater than 0"
          : undefined,
    };
  });
}
