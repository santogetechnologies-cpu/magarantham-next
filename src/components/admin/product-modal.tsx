"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { compressImage, validateImageFile } from "@/lib/image-compress";

export type ProductFormData = {
  id?: string;
  name: string;
  sku: string;
  barcode: string | null;
  slug: string;
  category: string;
  subcategory_id: string | null;
  saree_type: string;
  fabric: string;
  colour: string;
  design: string;
  description: string;
  image_path: string;
  purchase_price_paise: number;
  price_paise: number;
  compare_at_price_paise: number;
  discount_percent: number;
  stock_on_hand?: number;
  min_stock_level: number;
  published: boolean;
  featured: boolean;
  archived: boolean;
};

type CategoryOption = {
  id: string;
  parent_id?: string | null;
  name: string;
  slug?: string;
  active?: boolean;
  image_path?: string;
};

type PieceRow = {
  key: string;
  id?: string;
  piece_code: string;
  barcode: string;
  colour: string;
  priceRupees: string;
  purchaseCostRupees: string;
  quantity?: number | string;
  minQuantity?: number | string;
  status: "available" | "reserved" | "sold" | "damaged" | "returned";
  location: string;
  image_path?: string;
};

type VariantRow = {
  key: string;
  existingProductId?: string;
  existingSku?: string;
  existingSlug?: string;
  existingStock?: number;
  typeName: string;
  colour: string;
  priceRupees: string;
  stock: string;
  minStock: string;
  image_path: string;
  uploading?: boolean;
};

const COLOUR_PRESETS: { name: string; hex: string }[] = [
  { name: "Purple", hex: "#7C3AED" },
  { name: "Green", hex: "#2E7D32" },
  { name: "Red", hex: "#C62828" },
  { name: "Crimson Red", hex: "#B91C1C" },
  { name: "Maroon", hex: "#800020" },
  { name: "Beige", hex: "#D4A373" },
  { name: "Blue", hex: "#1D4ED8" },
  { name: "Gold", hex: "#C49A52" },
  { name: "Pink", hex: "#DB2777" },
  { name: "Magenta", hex: "#A21CAF" },
  { name: "Ivory", hex: "#E7DFD3" },
  { name: "Yellow", hex: "#CA8A04" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Terracotta", hex: "#B45309" },
  { name: "Wine", hex: "#650019" },
];

function colourHex(name: string): string {
  const found = COLOUR_PRESETS.find(
    (c) => c.name.toLowerCase() === (name || "").trim().toLowerCase(),
  );
  return found ? found.hex : "#800020";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function ProductModal({
  product,
  categories = [],
  onClose,
  onSaved,
}: {
  product?: Partial<ProductFormData> | null;
  categories: CategoryOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = Boolean(product?.id);

  const [internalCategories, setInternalCategories] = useState<CategoryOption[]>(
    categories && categories.length > 0 ? categories : [],
  );

  useEffect(() => {
    if (categories && categories.length > 0) {
      setInternalCategories(categories);
    } else {
      api<{ rows: CategoryOption[] }>("/api/erp/product_categories?page=0")
        .then((res) => {
          if (res?.rows?.length) setInternalCategories(res.rows);
        })
        .catch(() => {});
    }
  }, [categories]);

  const mainCategories = useMemo(
    () => internalCategories.filter((c) => !c.parent_id && c.active !== false),
    [internalCategories],
  );

  const initialCategory = useMemo(() => {
    if (product?.subcategory_id) {
      const sub = internalCategories.find((c) => c.id === product.subcategory_id);
      if (sub?.parent_id) {
        const parent = internalCategories.find((c) => c.id === sub.parent_id);
        if (parent) return parent.name;
      }
    }
    return product?.category || mainCategories[0]?.name || "Kanchipuram";
  }, [product, internalCategories, mainCategories]);

  const [productName, setProductName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [category, setCategory] = useState(initialCategory);
  const [subcategoryId, setSubcategoryId] = useState<string>(product?.subcategory_id || "");
  const [newSubcategoryName, setNewSubcategoryName] = useState("");
  const [showNewSubcategoryInput, setShowNewSubcategoryInput] = useState(false);
  const [fabric, setFabric] = useState(product?.fabric || "Pure Mulberry Silk");
  const [design, setDesign] = useState(product?.design || "Traditional Zari Border");
  const [basePriceRupees, setBasePriceRupees] = useState(
    product?.price_paise ? String(product.price_paise / 100) : "",
  );
  const [purchasePriceRupees, setPurchasePriceRupees] = useState(
    product?.purchase_price_paise ? String(product.purchase_price_paise / 100) : "",
  );
  const [minStockLevel, setMinStockLevel] = useState<number | string>(
    product?.min_stock_level !== undefined ? product.min_stock_level : 0,
  );
  const [stockInput, setStockInput] = useState<number | string>(
    product?.stock_on_hand !== undefined ? product.stock_on_hand : 1,
  );
  const [published, setPublished] = useState(product?.published ?? true);
  const [featured, setFeatured] = useState(product?.featured ?? false);
  const [mainImage, setMainImage] = useState(product?.image_path || "");
  const [mainUploading, setMainUploading] = useState(false);

  // Sync state if product changes
  useEffect(() => {
    if (product) {
      if (product.name) setProductName(product.name);
      if (product.description !== undefined) setDescription(product.description);
      if (product.fabric) setFabric(product.fabric);
      if (product.design) setDesign(product.design);
      if (product.price_paise) setBasePriceRupees(String(product.price_paise / 100));
      if (product.purchase_price_paise) setPurchasePriceRupees(String(product.purchase_price_paise / 100));
      if (product.min_stock_level !== undefined) setMinStockLevel(product.min_stock_level);
      if (product.stock_on_hand !== undefined) setStockInput(product.stock_on_hand);
      if (product.published !== undefined) setPublished(product.published);
      if (product.featured !== undefined) setFeatured(product.featured);
      if (product.image_path) setMainImage(product.image_path);
      if (product.category) setCategory(product.category);
      if (product.subcategory_id) setSubcategoryId(product.subcategory_id);
    } else {
      setProductName("");
      setDescription("");
      setBasePriceRupees("");
      setPurchasePriceRupees("");
      setMinStockLevel(0);
      setStockInput(1);
      setMainImage("");
      if (mainCategories[0]?.name) setCategory(mainCategories[0].name);
      setSubcategoryId("");
    }
  }, [product, mainCategories]);

  // Sync category if product arrives late
  useEffect(() => {
    if (!category && initialCategory) {
      setCategory(initialCategory);
    }
  }, [initialCategory, category]);

  // Selected Main Category Object
  const selectedMainObj = useMemo(() => {
    return (
      mainCategories.find(
        (m) => m.name.toLowerCase() === (category || "").trim().toLowerCase(),
      ) || null
    );
  }, [mainCategories, category]);

  // Subcategories strictly belonging to the selected main category
  const existingSubcategories = useMemo(() => {
    if (!selectedMainObj) return [];
    return internalCategories.filter(
      (c) =>
        c.parent_id === selectedMainObj.id &&
        c.active !== false &&
        c.name.toLowerCase() !== "all styles",
    );
  }, [internalCategories, selectedMainObj]);

  // Automatically select the first subcategory if none selected
  useEffect(() => {
    if (existingSubcategories.length > 0 && !subcategoryId) {
      setSubcategoryId(existingSubcategories[0].id);
    }
  }, [existingSubcategories, subcategoryId]);

  // -------------------------------------------------------------
  // LEVEL 4: INDIVIDUAL PHYSICAL PIECES MANAGEMENT
  // -------------------------------------------------------------
  const [pieces, setPieces] = useState<PieceRow[]>([]);
  const [piecesTab, setPiecesTab] = useState<"pieces" | "variants">("pieces");

  // Load existing individual pieces if editing product
  useEffect(() => {
    if (product?.id) {
      api<{ pieces: any[] }>(`/api/admin/pieces?product_id=${product.id}`)
        .then((res) => {
          if (res?.pieces && Array.isArray(res.pieces) && res.pieces.length > 0) {
            setPieces(
              res.pieces.map((p) => ({
                key: p.id || `pc-${Math.random().toString(36).slice(2, 6)}`,
                id: p.id,
                piece_code: p.piece_code || "",
                barcode: p.barcode || "",
                colour: p.colour || "Purple",
                priceRupees: p.price_paise ? String(p.price_paise / 100) : "",
                purchaseCostRupees: p.purchase_cost_paise
                  ? String(p.purchase_cost_paise / 100)
                  : "",
                quantity: 1,
                minQuantity: product?.min_stock_level !== undefined ? product.min_stock_level : 0,
                status: p.status || "available",
                location: p.location || "Rack A-1",
                image_path: p.image_path || "",
              })),
            );
          } else {
            // Initialize 1 default piece from product info
            setPieces([
              {
                key: `pc-init-1`,
                piece_code: `${category.slice(0, 3).toUpperCase()}-PUR-001`,
                barcode: `MSU${Date.now().toString().slice(-7)}001`,
                colour: product.colour || "Purple",
                priceRupees: product.price_paise ? String(product.price_paise / 100) : "",
                purchaseCostRupees: product.purchase_price_paise
                  ? String(product.purchase_price_paise / 100)
                  : "",
                quantity: 1,
                minQuantity: product?.min_stock_level !== undefined ? product.min_stock_level : 0,
                status: "available",
                location: "Rack A-1",
              },
            ]);
          }
        })
        .catch(() => {});
    } else {
      // New Product: Initialize default 1st piece
      setPieces([
        {
          key: `pc-new-1`,
          piece_code: `${category.slice(0, 3).toUpperCase()}-PUR-001`,
          barcode: `MSU${Date.now().toString().slice(-7)}001`,
          colour: "Purple",
          priceRupees: basePriceRupees || "",
          purchaseCostRupees: purchasePriceRupees || "",
          quantity: 1,
          minQuantity: minStockLevel || 0,
          status: "available",
          location: "Rack A-1",
        },
      ]);
    }
  }, [product?.id]);

  // Variant Rows (for legacy multi-variant mode if needed)
  const [variants, setVariants] = useState<VariantRow[]>([
    {
      key: "v-1",
      typeName: "",
      colour: "Purple",
      priceRupees: "",
      stock: "",
      minStock: "0",
      image_path: "",
    },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mainFileRef = useRef<HTMLInputElement>(null);
  const variantFileRef = useRef<HTMLInputElement>(null);
  const [activeVariantKey, setActiveVariantKey] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Piece inventory counts
  const pieceStats = useMemo(() => {
    const total = pieces.reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    const available = pieces.filter((p) => p.status === "available").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    const reserved = pieces.filter((p) => p.status === "reserved").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    const sold = pieces.filter((p) => p.status === "sold").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    const damaged = pieces.filter((p) => p.status === "damaged").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    const returned = pieces.filter((p) => p.status === "returned").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
    return { total, available, reserved, sold, damaged, returned };
  }, [pieces]);

  function addPieceRow() {
    const nextIdx = pieces.length + 1;
    const catCode = category.slice(0, 3).toUpperCase() || "SAR";
    const nextCol = COLOUR_PRESETS[(nextIdx - 1) % COLOUR_PRESETS.length].name;
    const colCode = nextCol.slice(0, 3).toUpperCase();
    const pieceCode = `${catCode}-${colCode}-${String(nextIdx).padStart(3, "0")}`;
    const barcode = `MSU${Date.now().toString().slice(-7)}${String(nextIdx).padStart(3, "0")}`;

    setPieces((prev) => [
      ...prev,
      {
        key: `pc-${Date.now()}-${nextIdx}`,
        piece_code: pieceCode,
        barcode,
        colour: nextCol,
        priceRupees: basePriceRupees || (prev[prev.length - 1]?.priceRupees || ""),
        purchaseCostRupees: purchasePriceRupees || (prev[prev.length - 1]?.purchaseCostRupees || ""),
        quantity: 1,
        minQuantity: minStockLevel || 0,
        status: "available",
        location: `Rack A-${nextIdx}`,
      },
    ]);
  }

  function updatePiece(key: string, patch: Partial<PieceRow>) {
    setPieces((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    );
  }

  function removePiece(key: string) {
    setPieces((prev) => {
      if (prev.length <= 1) {
        const catCode = category.slice(0, 3).toUpperCase() || "SAR";
        return [
          {
            key: `pc-${Date.now()}-1`,
            piece_code: `${catCode}-PUR-001`,
            barcode: `MSU${Date.now().toString().slice(-7)}001`,
            colour: "Purple",
            priceRupees: "",
            purchaseCostRupees: "",
            quantity: 1,
            minQuantity: 0,
            status: "available",
            location: "Rack A-1",
          },
        ];
      }
      return prev.filter((p) => p.key !== key);
    });
  }

  function autoGeneratePieceCodes() {
    const catCode = category.slice(0, 3).toUpperCase() || "SAR";
    setPieces((prev) =>
      prev.map((p, idx) => {
        const colCode = (p.colour || "DEF").slice(0, 3).toUpperCase();
        return {
          ...p,
          piece_code: `${catCode}-${colCode}-${String(idx + 1).padStart(3, "0")}`,
          barcode: p.barcode || `MSU${Date.now().toString().slice(-7)}${String(idx + 1).padStart(3, "0")}`,
        };
      }),
    );
  }

  // Smart horizontal auto-scrolling on input focus & keyboard navigation
  const handleTableFocus = useCallback((e: React.FocusEvent) => {
    const container = tableScrollRef.current;
    if (!container) return;

    const target = e.target as HTMLElement;
    if (!target) return;

    // Find the cell or the element
    const cell = target.closest("td") || target;
    const containerRect = container.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    const padding = 28; // Comfortable spacing from table edges
    const cellLeftRelative = cellRect.left - containerRect.left;
    const cellRightRelative = cellRect.right - containerRect.left;

    // Smoothly scroll only if element is partially or fully out of view
    if (cellLeftRelative < padding) {
      const scrollDiff = cellLeftRelative - padding;
      container.scrollBy({ left: scrollDiff, behavior: "smooth" });
    } else if (cellRightRelative > containerRect.width - padding) {
      const scrollDiff = cellRightRelative - (containerRect.width - padding);
      container.scrollBy({ left: scrollDiff, behavior: "smooth" });
    }
  }, []);

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) {
        e.preventDefault();
        const container = tableScrollRef.current;
        if (!container) return;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled]), button.ap-variant-del-btn")
        );
        const idx = focusables.indexOf(target);
        if (idx >= 0 && idx + 1 < focusables.length) {
          focusables[idx + 1].focus();
        } else if (idx === focusables.length - 1) {
          addPieceRow();
        }
      }
    }
  }, []);

  // Automatically sync stockInput when physical pieces change
  useEffect(() => {
    if (pieces.length > 0) {
      const avail = pieces
        .filter((p) => p.status === "available")
        .reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0);
      setStockInput(avail);
    }
  }, [pieces]);

  function handleStockChange(valStr: string) {
    if (valStr === "") {
      setStockInput("");
      return;
    }
    const target = Math.max(0, parseInt(valStr, 10) || 0);
    setStockInput(target);

    const currentAvailable = pieces.filter((p) => p.status === "available").length;
    if (target > currentAvailable) {
      const diff = target - currentAvailable;
      const catCode = category.slice(0, 3).toUpperCase() || "SAR";
      const newItems: PieceRow[] = [];
      for (let i = 0; i < diff; i++) {
        const idx = pieces.length + i + 1;
        const nextCol = COLOUR_PRESETS[(idx - 1) % COLOUR_PRESETS.length].name;
        const colCode = nextCol.slice(0, 3).toUpperCase();
        newItems.push({
          key: `pc-${Date.now()}-${idx}`,
          piece_code: `${catCode}-${colCode}-${String(idx).padStart(3, "0")}`,
          barcode: `MSU${Date.now().toString().slice(-7)}${String(idx).padStart(3, "0")}`,
          colour: nextCol,
          priceRupees: basePriceRupees || (pieces[0]?.priceRupees || ""),
          purchaseCostRupees: purchasePriceRupees || (pieces[0]?.purchaseCostRupees || ""),
          quantity: 1,
          minQuantity: minStockLevel || 0,
          status: "available",
          location: `Rack A-${idx}`,
        });
      }
      setPieces((prev) => [...prev, ...newItems]);
    } else if (target < currentAvailable) {
      let toRemove = currentAvailable - target;
      setPieces((prev) => {
        const nextList: PieceRow[] = [];
        for (let i = prev.length - 1; i >= 0; i--) {
          const item = prev[i];
          if (toRemove > 0 && item.status === "available" && (prev.length - (currentAvailable - target + toRemove - 1)) >= 1) {
            toRemove--;
            continue;
          }
          nextList.unshift(item);
        }
        return nextList.length > 0 ? nextList : prev;
      });
    }
  }

  async function compressAndUpload(file: File): Promise<string> {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error("Please choose a valid JPG, PNG, or WebP image.");
    }
    const compressed = await compressImage(file, {
      maxSizeKB: 60,
      minSizeKB: 1,
      maxWidth: 1200,
      maxHeight: 1200,
      preferFormat: "image/webp",
    });
    const formData = new FormData();
    formData.append("kind", "product");
    formData.append("file", compressed.file);
    const res = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || "Image upload failed.");
    }
    return String(data.url);
  }

  async function handleMainImageSelected(file: File) {
    setError("");
    setMainUploading(true);
    try {
      const url = await compressAndUpload(file);
      setMainImage(url);
    } catch (err) {
      setError((err as Error).message || "Unable to upload image.");
    } finally {
      setMainUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedName = productName.trim();
    if (!trimmedName) {
      setError("Product Name is required. Please enter a name for the saree.");
      return;
    }

    if (!category || !selectedMainObj) {
      setError("Main Category is required. Please choose a category from the dropdown.");
      return;
    }

    // Determine final subcategory ID
    let finalSubcategoryId = subcategoryId;
    if (showNewSubcategoryInput && newSubcategoryName.trim()) {
      try {
        const newSubSlug = slugify(`${selectedMainObj.name}-${newSubcategoryName.trim()}`);
        const res = await api<{ id: string }>("/api/erp/product_categories", {
          id: null,
          data: {
            parent_id: selectedMainObj.id,
            name: newSubcategoryName.trim().slice(0, 80),
            slug: newSubSlug,
            active: true,
          },
        });
        if (res?.id) {
          finalSubcategoryId = res.id;
        }
      } catch (subErr) {
        setError(`Could not create subcategory: ${(subErr as Error).message}`);
        return;
      }
    }

    // If still no subcategory, check if there is an "All styles" subcategory or use first
    if (!finalSubcategoryId) {
      const defaultSub = internalCategories.find(
        (c) => c.parent_id === selectedMainObj.id && c.name.toLowerCase() === "all styles",
      );
      if (defaultSub) finalSubcategoryId = defaultSub.id;
      else if (existingSubcategories.length > 0) finalSubcategoryId = existingSubcategories[0].id;
    }

    // Form validation check: Selling Price (₹) from Pieces
    const basePriceNum = pieces.length > 0 && pieces[0]?.priceRupees
      ? Number(String(pieces[0].priceRupees).replace(/,/g, ""))
      : Number(String(basePriceRupees || "").replace(/,/g, ""));

    if (!basePriceNum || isNaN(basePriceNum) || basePriceNum <= 0) {
      setError("Selling Price (₹) is required and must be greater than ₹0.");
      return;
    }
    const pricePaise = Math.round(basePriceNum * 100);

    // Form validation check: Purchase Cost (₹, optional but cannot be negative)
    const purchasePriceNum = pieces.length > 0 && pieces[0]?.purchaseCostRupees
      ? Number(String(pieces[0].purchaseCostRupees).replace(/,/g, ""))
      : (purchasePriceRupees ? Number(String(purchasePriceRupees).replace(/,/g, "")) : 0);

    if (isNaN(purchasePriceNum) || purchasePriceNum < 0) {
      setError("Purchase Cost (₹) cannot be negative.");
      return;
    }
    const purchasePricePaise = Math.round(purchasePriceNum * 100);

    // Stock on hand is calculated directly from AVAILABLE pieces
    const stockOnHand = pieces.length > 0
      ? pieces.filter((p) => p.status === "available").reduce((sum, p) => sum + (p.quantity !== undefined && p.quantity !== "" ? Math.max(0, Number(p.quantity)) : 1), 0)
      : (typeof stockInput === "number" ? stockInput : parseInt(String(stockInput || 0), 10) || 0);

    const finalMinStock = pieces.length > 0 && pieces[0]?.minQuantity !== undefined
      ? Math.max(0, parseInt(String(pieces[0].minQuantity || 0), 10) || 0)
      : (typeof minStockLevel === "number" ? minStockLevel : parseInt(String(minStockLevel || 0), 10) || 0);

    setSaving(true);
    try {
      const catPrefix = slugify(category).slice(0, 4).toUpperCase() || "SAR";
      const rawSlug =
        product?.slug ||
        `${slugify(trimmedName) || "saree"}-${slugify(pieces[0]?.colour || "silk")}-${uniqueSuffix()}`;
      const baseSlug = slugify(rawSlug).slice(0, 118).replace(/-+$/, "");
      const sku =
        product?.sku ||
        `MS-${catPrefix}-${slugify(trimmedName).slice(0, 5).toUpperCase()}-${uniqueSuffix().toUpperCase()}`;

      const finalImagePath = (mainImage || pieces.find((p) => p.image_path)?.image_path || "/assets/product-01.jpg").trim();

      // 1. Save Product Record
      const savedProduct = await api<{ id: string }>("/api/admin/products", {
        id: product?.id && product.id.trim() ? product.id.trim() : null,
        data: {
          name: trimmedName,
          sku,
          barcode: product?.barcode?.trim() ? product.barcode.trim() : null,
          slug: baseSlug,
          category: selectedMainObj.name,
          subcategory_id: finalSubcategoryId || null,
          saree_type: `${selectedMainObj.name} Silk`,
          fabric: fabric.trim() || "Pure Mulberry Silk",
          colour: (pieces[0]?.colour || product?.colour || "Purple").trim(),
          design: design.trim() || "Traditional Zari Border",
          description: description.trim(),
          image_path: finalImagePath,
          purchase_price_paise: purchasePricePaise,
          price_paise: pricePaise,
          compare_at_price_paise: product?.compare_at_price_paise || 0,
          discount_percent: product?.discount_percent || 0,
          min_stock_level: finalMinStock,
          published: Boolean(published),
          featured: Boolean(featured),
          archived: false,
        },
      });

      const targetProductId = savedProduct?.id || product?.id;
      if (!targetProductId) {
        throw new Error("Product saved, but no product ID was returned.");
      }

      // 2. Save Level 4 Individual Pieces
      if (pieces.length > 0) {
        await api("/api/admin/pieces", {
          product_id: targetProductId,
          pieces: pieces.map((p, idx) => {
            const piecePriceNum = p.priceRupees ? Number(String(p.priceRupees).replace(/,/g, "")) : 0;
            const pieceCostNum = p.purchaseCostRupees ? Number(String(p.purchaseCostRupees).replace(/,/g, "")) : 0;
            const pieceCode = (p.piece_code || "").trim() || `${catPrefix}-${slugify(p.colour || "PUR").slice(0, 3).toUpperCase()}-${String(idx + 1).padStart(3, "0")}`;
            const barcode = (p.barcode || "").trim() || `MSU${Date.now().toString().slice(-7)}${String(idx + 1).padStart(3, "0")}`;
            const colour = (p.colour || "").trim() || "Purple";
            const location = (p.location || "").trim() || "Rack A-1";
            return {
              id: p.id && !p.id.startsWith("pc-") ? p.id : undefined,
              product_id: targetProductId,
              piece_code: pieceCode,
              barcode,
              colour,
              price_paise: piecePriceNum > 0 ? Math.round(piecePriceNum * 100) : pricePaise,
              purchase_cost_paise: pieceCostNum > 0 ? Math.round(pieceCostNum * 100) : (purchasePricePaise || undefined),
              status: p.status,
              location,
              image_path: p.image_path || finalImagePath,
            };
          }),
        });
      }

      onSaved();
    } catch (err) {
      setError((err as Error).message || "Failed to save saree.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ap-page-root" onSubmit={handleSave}>
      <input
        ref={mainFileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleMainImageSelected(file);
        }}
      />

      {/* Top Header Bar */}
      <div className="ap-header-bar">
        <div>
          <h1 className="ap-title">{isEditing ? "Edit Saree" : "Add Saree"}</h1>
          <p className="ap-subtitle">
            4-Level Hierarchy: Main Category → Sub Category → Product → Individual Pieces
          </p>
        </div>

        <div className="ap-header-actions">
          <button
            type="button"
            className="button outline-btn ap-cancel-btn"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button ap-save-btn"
            disabled={saving || mainUploading}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>{saving ? "Saving Saree..." : "Save Saree"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="ap-error-banner" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* 2-Column Form Layout */}
      <div className="ap-columns-grid">
        {/* LEFT COLUMN: Main Cover Photo */}
        <section className="ap-card ap-photo-card">
          <h2 className="ap-photo-heading">Saree Cover Photo</h2>
          <div className="ap-photo-preview-wrap">
            {mainImage ? (
              <img
                src={mainImage}
                alt={productName || "Saree cover"}
                className="ap-photo-preview-img"
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  minHeight: 220,
                  color: "#800020",
                  background: "#FBF7F0",
                  gap: 10,
                  cursor: "pointer",
                }}
                onClick={() => mainFileRef.current?.click()}
              >
                <span style={{ fontSize: 32, opacity: 0.6 }}>📷</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#800020" }}>
                  Upload Saree Photo
                </span>
                <span style={{ fontSize: 11, color: "#666" }}>
                  PNG, JPG or WEBP
                </span>
              </div>
            )}
            {mainUploading && (
              <div className="ap-photo-loading" role="status">
                <span className="spinner-gold" />
                <span>Optimizing Image...</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="ap-change-img-btn"
            disabled={mainUploading}
            onClick={() => mainFileRef.current?.click()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <span>{mainUploading ? "Optimizing Image..." : "Change Image"}</span>
          </button>
        </section>

        {/* RIGHT COLUMN: Hierarchy, Details & Physical Pieces */}
        <div className="ap-right-col">
          {/* Card 1: Product Name, Main Category & Subcategory */}
          <section className="ap-card ap-details-card">
            <label className="ap-field">
              <span className="ap-label">
                Product Name <em className="ap-req">*</em>
              </span>
              <input
                type="text"
                required
                placeholder="e.g. Kanchipuram Purple Gold Zari Saree"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="ap-input"
              />
            </label>

            {/* LEVEL 1 & LEVEL 2: DYNAMIC CATEGORY HIERARCHY */}
            <div className="ap-category-flags-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {/* Level 1: Main Category */}
              <label className="ap-field" style={{ flex: "1 1 200px" }}>
                <span className="ap-label">
                  1. Main Category <em className="ap-req">*</em>
                </span>
                <select
                  value={category}
                  required
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setSubcategoryId("");
                    setShowNewSubcategoryInput(false);
                  }}
                  className="ap-select"
                >
                  <option value="" disabled>-- Select Main Category --</option>
                  {mainCategories.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* Level 2: Sub Category */}
              <label className="ap-field" style={{ flex: "1 1 200px" }}>
                <span className="ap-label">
                  2. Sub Category <em className="ap-req">*</em>
                </span>
                <select
                  value={showNewSubcategoryInput ? "__new__" : subcategoryId}
                  required={!showNewSubcategoryInput}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setShowNewSubcategoryInput(true);
                    } else {
                      setShowNewSubcategoryInput(false);
                      setSubcategoryId(e.target.value);
                    }
                  }}
                  className="ap-select"
                >
                  <option value="" disabled>-- Select {category} Subcategory --</option>
                  {existingSubcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                  <option value="__new__">＋ Add New Subcategory...</option>
                </select>
              </label>

              <div className="ap-flags-group" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                  />
                  <span>Published</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                  />
                  <span>Featured</span>
                </label>
              </div>
            </div>

            {/* Inline New Subcategory Input if requested */}
            {showNewSubcategoryInput && (
              <div
                style={{
                  background: "#FBF7F0",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px dashed #C49A52",
                  marginTop: 6,
                }}
              >
                <label className="ap-field" style={{ margin: 0 }}>
                  <span className="ap-label" style={{ color: "#800020" }}>
                    New Subcategory for {category}:
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="e.g. Pure Zari, Korvai, Bridal Kanchipuram..."
                      value={newSubcategoryName}
                      onChange={(e) => setNewSubcategoryName(e.target.value)}
                      className="ap-input"
                    />
                    <button
                      type="button"
                      className="button outline-btn"
                      onClick={() => setShowNewSubcategoryInput(false)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                </label>
              </div>
            )}

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              <label className="ap-field" style={{ flex: "1 1 180px" }}>
                <span className="ap-label">Fabric</span>
                <input
                  type="text"
                  placeholder="e.g. Pure Mulberry Silk"
                  value={fabric}
                  onChange={(e) => setFabric(e.target.value)}
                  className="ap-input"
                />
              </label>

              <label className="ap-field" style={{ flex: "1 1 180px" }}>
                <span className="ap-label">Design / Weave</span>
                <input
                  type="text"
                  placeholder="e.g. Traditional Zari Border"
                  value={design}
                  onChange={(e) => setDesign(e.target.value)}
                  className="ap-input"
                />
              </label>
            </div>

            <label className="ap-field" style={{ marginTop: 10 }}>
              <span className="ap-label">Description</span>
              <textarea
                rows={2}
                placeholder="Traditional Kanchipuram silk saree with rich zari work and elegant border."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="ap-textarea"
              />
            </label>
          </section>

          {/* Card 2: LEVEL 4 INDIVIDUAL PHYSICAL PIECES MANAGEMENT */}
          <section className="ap-card ap-variants-card">
            <div className="ap-variants-header">
              <div>
                <h2 className="ap-variants-title">Level 4: Individual Saree Pieces (Physical Stock)</h2>
                <p className="ap-variants-subtitle">
                  Each physical saree has its own unique piece code, individual price, and stock status.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="cat-count-pill" style={{ background: "#DCFCE7", color: "#166534" }}>
                    Available Stock: {pieceStats.available}
                  </span>
                  <span className="cat-count-pill" style={{ background: "#F1F5F9", color: "#475569" }}>
                    Sold: {pieceStats.sold}
                  </span>
                  <span className="cat-count-pill" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    Reserved: {pieceStats.reserved}
                  </span>
                  <span className="cat-count-pill" style={{ background: "#F8EBDD", color: "#800020" }}>
                    Total Stock: {pieceStats.total}
                  </span>
                  <span className="cat-count-pill" style={{ background: "#EFF6FF", color: "#1E40AF" }}>
                    Low Stock: {minStockLevel || 0}
                  </span>
                  {pieceStats.available <= Number(minStockLevel || 0) && Number(minStockLevel || 0) > 0 && (
                    <span className="cat-count-pill" style={{ background: "#FEE2E2", color: "#991B1B", fontWeight: 700 }}>
                      ⚠️ Low Stock
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="button outline-btn"
                  onClick={autoGeneratePieceCodes}
                  title="Auto format piece codes"
                  style={{ fontSize: 12, padding: "6px 10px" }}
                >
                  ⚡ Auto-Code
                </button>
                <button
                  type="button"
                  className="button ap-add-variant-btn"
                  onClick={addPieceRow}
                >
                  <span className="ap-btn-plus">+</span>
                  <span>Add Saree Piece</span>
                </button>
              </div>
            </div>

            <div
              className="ap-variants-table-wrapper"
              ref={tableScrollRef}
              onFocusCapture={handleTableFocus}
              onKeyDown={handleTableKeyDown}
            >
              <table className="ap-variants-table" style={{ minWidth: 880 }}>
                <thead>
                  <tr className="ap-variants-thead-row">
                    <th style={{ width: 125 }}>Piece Code</th>
                    <th style={{ width: 95 }}>Colour</th>
                    <th style={{ width: 110 }}>Selling Price (₹)</th>
                    <th style={{ width: 110 }}>Purchase Cost (₹)</th>
                    <th style={{ width: 75 }}>Stock</th>
                    <th style={{ width: 80 }}>Low Stock</th>
                    <th style={{ width: 95 }}>Location</th>
                    <th style={{ width: 110 }}>Stock Status</th>
                    <th style={{ width: 60, textAlign: "center" }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {pieces.map((pc, idx) => (
                    <tr className="ap-variant-table-row" key={pc.key}>
                      {/* Piece Code */}
                      <td>
                        <input
                          type="text"
                          required
                          placeholder="e.g. KAN-PUR-001"
                          value={pc.piece_code}
                          onChange={(e) => updatePiece(pc.key, { piece_code: e.target.value })}
                          className="ap-inline-input"
                          style={{ fontWeight: 600, color: "#800020" }}
                        />
                      </td>

                      {/* Colour */}
                      <td>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              backgroundColor: colourHex(pc.colour),
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              flexShrink: 0,
                              border: "1px solid rgba(0,0,0,0.15)",
                            }}
                          />
                          <select
                            value={pc.colour}
                            onChange={(e) => updatePiece(pc.key, { colour: e.target.value })}
                            className="ap-inline-select"
                            style={{
                              border: "none",
                              background: "transparent",
                              fontWeight: 600,
                              fontSize: 12,
                              color: "#800020",
                            }}
                          >
                            {COLOUR_PRESETS.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* Selling Price (₹) */}
                      <td>
                        <div className="ap-inline-price-wrap" style={{ border: "1px solid #EAD5C0", borderRadius: 4, padding: "2px 6px", background: "#FFFFFF", height: 30, display: "flex", alignItems: "center" }}>
                          <span className="ap-rupee-symbol" style={{ fontSize: 12, color: "#800020", fontWeight: 600 }}>₹</span>
                          <input
                            type="number"
                            min="0"
                            placeholder={basePriceRupees || "0"}
                            value={pc.priceRupees || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || Number(val) >= 0) {
                                updatePiece(pc.key, { priceRupees: val });
                              }
                            }}
                            className="ap-inline-input"
                            style={{ fontSize: 12, fontWeight: 600, color: "#800020", width: "100%", border: "none", outline: "none", padding: "0 2px" }}
                            aria-label="Selling price"
                          />
                        </div>
                      </td>

                      {/* Purchase Cost (₹) */}
                      <td>
                        <div className="ap-inline-price-wrap" style={{ border: "1px solid #EAD5C0", borderRadius: 4, padding: "2px 6px", background: "#FFFDF9", height: 30, display: "flex", alignItems: "center" }}>
                          <span className="ap-rupee-symbol" style={{ fontSize: 12, color: "#888" }}>₹</span>
                          <input
                            type="number"
                            min="0"
                            placeholder={purchasePriceRupees || "0"}
                            value={pc.purchaseCostRupees || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || Number(val) >= 0) {
                                updatePiece(pc.key, { purchaseCostRupees: val });
                              }
                            }}
                            className="ap-inline-input"
                            style={{ fontSize: 12, color: "#555", width: "100%", border: "none", outline: "none", padding: "0 2px" }}
                            aria-label="Purchase cost"
                          />
                        </div>
                      </td>

                      {/* Stock */}
                      <td>
                        <div style={{ border: "1px solid #D4B99F", borderRadius: 4, padding: "2px 6px", background: "#FFFFFF", height: 30, display: "flex", alignItems: "center" }}>
                          <input
                            type="number"
                            min="0"
                            placeholder="1"
                            value={pc.quantity !== undefined ? pc.quantity : 1}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              const val = e.target.value;
                              updatePiece(pc.key, {
                                quantity: val === "" ? "" : Math.max(0, parseInt(val, 10) || 0),
                              });
                            }}
                            className="ap-inline-input"
                            style={{ fontSize: 12, fontWeight: 700, color: "#166534", width: "100%", border: "none", outline: "none", textAlign: "center" }}
                            aria-label="Stock"
                          />
                        </div>
                      </td>

                      {/* Low Stock */}
                      <td>
                        <div style={{ border: "1px solid #EAD5C0", borderRadius: 4, padding: "2px 6px", background: "#FFFDF9", height: 30, display: "flex", alignItems: "center" }}>
                          <input
                            type="number"
                            min="0"
                            placeholder={String(minStockLevel || 0)}
                            value={pc.minQuantity !== undefined ? pc.minQuantity : (minStockLevel || 0)}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              const val = e.target.value;
                              updatePiece(pc.key, {
                                minQuantity: val === "" ? "" : Math.max(0, parseInt(val, 10) || 0),
                              });
                            }}
                            className="ap-inline-input"
                            style={{ fontSize: 12, fontWeight: 600, color: "#475569", width: "100%", border: "none", outline: "none", textAlign: "center" }}
                            aria-label="Low stock"
                          />
                        </div>
                      </td>

                      {/* Stock Location */}
                      <td>
                        <input
                          type="text"
                          placeholder="e.g. Rack A-1"
                          value={pc.location}
                          onChange={(e) => updatePiece(pc.key, { location: e.target.value })}
                          className="ap-inline-input"
                          style={{ fontSize: 12 }}
                        />
                      </td>

                      {/* Stock Status */}
                      <td>
                        <select
                          value={pc.status}
                          onChange={(e) =>
                            updatePiece(pc.key, {
                              status: e.target.value as PieceRow["status"],
                            })
                          }
                          className="ap-inline-select"
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "4px 8px",
                            borderRadius: 4,
                            background:
                              pc.status === "available"
                                ? "#DCFCE7"
                                : pc.status === "sold"
                                  ? "#F1F5F9"
                                  : pc.status === "reserved"
                                    ? "#FEF3C7"
                                    : "#FEE2E2",
                            color:
                              pc.status === "available"
                                ? "#166534"
                                : pc.status === "sold"
                                  ? "#475569"
                                  : pc.status === "reserved"
                                    ? "#92400E"
                                    : "#991B1B",
                          }}
                        >
                          <option value="available">Available</option>
                          <option value="reserved">Reserved</option>
                          <option value="sold">Sold</option>
                          <option value="damaged">Damaged</option>
                          <option value="returned">Returned</option>
                        </select>
                      </td>

                      {/* Delete */}
                      <td style={{ textAlign: "center", width: 60 }}>
                        <button
                          type="button"
                          className="ap-variant-del-btn"
                          onClick={() => removePiece(pc.key)}
                          title="Delete saree piece"
                          aria-label="Delete saree piece"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
