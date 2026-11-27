'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Profile, money, unitPrice, unitSuffix } from '@/lib/core';
import { api } from '../api';
import { Row, useERP } from './shared';
import { buildCategoryMap, EnhancedOffer, resolveProductOffer } from '@/lib/offers';
import { DEFAULT_TEMPLATES, renderTemplate, whatsappLink } from '@/lib/message-templates';
import { CameraScannerModal, CameraScanResult } from './camera-scanner';

type CartLine = {
  product_id: string;
  quantity: number;
  unit_ids: string[];
  /** Pieces billed per colour id; "undef" = pieces whose colour is not recorded. Sum = quantity. */
  colours: Record<string, number>;
};

const UNDEF = 'undef';
type ColourOption = { key: string; label: string; hex: string; image: string; free: number };

/** Colours (and undefined pieces) still free to bill for this saree, after what is already in the bill. */
function colourOptions(p: Row | undefined, line?: CartLine): ColourOption[] {
  if (!p) return [];
  const colours: Row[] = Array.isArray(p.colours) ? p.colours : [];
  const inBill = (k: string) => Number(line?.colours?.[k] || 0);
  const colouredQty = colours.reduce((s, c) => s + Number(c.quantity || 0), 0);
  const colouredHeld = colours.reduce((s, c) => s + Number(c.reserved || 0), 0);
  const stock = Number(p.stock_on_hand ?? p.available ?? 0);
  const undefQty = p.undefined_quantity != null ? Number(p.undefined_quantity) : Math.max(0, stock - colouredQty);
  const undefHeld = Math.max(0, Number(p.reserved || 0) - colouredHeld);
  const out: ColourOption[] = colours.map((c) => ({
    key: String(c.id),
    label: String(c.colour),
    hex: String(c.colour_hex || ''),
    image: String(c.image_path || ''),
    free: Math.max(0, Number(c.quantity || 0) - Number(c.reserved || 0) - inBill(String(c.id))),
  }));
  if (undefQty > 0 || inBill(UNDEF) > 0 || !colours.length) {
    out.push({ key: UNDEF, label: 'Undefined colour', hex: '', image: '', free: Math.max(0, undefQty - undefHeld - inBill(UNDEF)) });
  }
  return out;
}
const normaliseLine = (l: Partial<CartLine> & { product_id: string; quantity: number }): CartLine => ({
  product_id: l.product_id,
  quantity: l.quantity,
  unit_ids: Array.isArray(l.unit_ids) ? l.unit_ids : [],
  colours: l.colours && Object.keys(l.colours).length ? { ...l.colours } : { [UNDEF]: l.quantity },
});
/** Server cart: colours named per line; pieces not named come from undefined stock. */
const serverCart = (cart: CartLine[]) =>
  cart.map((l) => ({
    product_id: l.product_id,
    quantity: l.quantity,
    unit_ids: l.unit_ids,
    colours: Object.entries(l.colours || {})
      .filter(([k, n]) => k !== UNDEF && n > 0)
      .map(([k, n]) => ({ colour_id: k, quantity: n })),
  }));

type PayMode = 'cash' | 'upi' | 'card' | 'split';

type LastScanned = {
  name: string;
  sku: string;
  code: string;
  price_paise: number;
  isUnit: boolean;
  offer?: string;
};

export type HeldBill = {
  id: string;
  heldAt: string;
  holdNumber: number;
  note?: string;
  customerName: string;
  customerPhone: string;
  cart: CartLine[];
  scannedPieces: Record<string, string[]>;
  lineSpot: Record<string, number>;
  discountType: 'fixed' | 'percent';
  discountInput: string;
  payMode: PayMode;
  tenders: { cash: number; upi: number; card: number };
  cashReceived: number;
  cashReceivedEdited: boolean;
  totalPieces: number;
  estimatedTotalPaise: number;
  itemSummary: string;
};

function playScanBeep(success = true) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    if (success) {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch { }
}

export function POS({ profile }: { profile: Profile }) {
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Row>({});
  // Automatic festival offers switched on for POS (shown on cards, scans and bill lines).
  const [posOffers, setPosOffers] = useState<EnhancedOffer[]>([]);
  const [posCategories, setPosCategories] = useState<Row[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScanned, setLastScanned] = useState<LastScanned | null>(null);
  const [quote, setQuote] = useState<Row | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountInput, setDiscountInput] = useState('');
  // Spot (counter) discount per bill line, in percent of that line.
  const [lineSpot, setLineSpot] = useState<Record<string, number>>({});
  const [spotOpen, setSpotOpen] = useState<string | null>(null);
  // Piece codes scanned per product, so the exact pieces are marked sold.
  const [scannedPieces, setScannedPieces] = useState<Record<string, string[]>>({});
  // Scanned saree with several colours: the cashier picks which colour is being billed.
  const [colourPick, setColourPick] = useState<{ product: Row; unit?: Row; code?: string } | null>(null);
  // After a bill: offer to send it on WhatsApp with the store's warm message (editable in Settings).
  const [waPrompt, setWaPrompt] = useState<{ phone: string; text: string } | null>(null);
  const waTemplate = useRef<string>(DEFAULT_TEMPLATES.pos_bill_whatsapp);
  const waEnabled = useRef(true);
  useEffect(() => {
    api<{ rows: Row[] }>('/api/admin/message-templates')
      .then((r) => {
        const t = r.rows.find((x) => x.key === 'pos_bill_whatsapp');
        if (t) { waTemplate.current = String(t.body); waEnabled.current = t.enabled !== false; }
      })
      .catch(() => {});
  }, []);
  function billWhatsAppText(sale: Row) {
    const items = (Array.isArray(sale.items) ? sale.items : [])
      .map((i: Row) => {
        const colours = Array.isArray(i.colours) ? i.colours.filter((c: Row) => c.colour).map((c: Row) => c.colour).join(', ') : '';
        return `• ${i.name}${colours ? ` (${colours})` : ''} × ${i.quantity} — ${money(Number(i.line_paise || 0))}`;
      })
      .join('\n');
    return renderTemplate(waTemplate.current, {
      customer_name: String(sale.customer_name || '').trim() || 'Customer',
      store_name: String(settings.business_english || settings.business_name || 'Magarantham Silks'),
      invoice_no: String(sale.invoice_no || ''),
      total: money(Number(sale.total_paise || 0)),
      items,
      date: new Date(String(sale.created_at || Date.now())).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      store_phone: String(settings.phone || ''),
    });
  }
  // Automatic festival offer the server applied to the last quote.
  const [offerInfo, setOfferInfo] = useState<{ paise: number; title: string }>({ paise: 0, title: '' });
  const [bills, setBills] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [returning, setReturning] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>('cash');
  const [tenders, setTenders] = useState<{ cash: number; upi: number; card: number }>({
    cash: 0,
    upi: 0,
    card: 0,
  });
  const [cashReceived, setCashReceived] = useState(0);
  const [cashReceivedEdited, setCashReceivedEdited] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [autoPrint, setAutoPrint] = useState(true);
  const [savingGst, setSavingGst] = useState(false);
  const [gstInput, setGstInput] = useState('');

  // Unified Product Search & Barcode Scanner State
  const [manualDropdownOpen, setManualDropdownOpen] = useState(false);
  const [isSearchingBarcode, setIsSearchingBarcode] = useState(false);
  const [asyncBarcodeMatch, setAsyncBarcodeMatch] = useState<Row | null>(null);
  const manualDropdownRef = useRef<HTMLDivElement>(null);

  // Held / Parked Bills state
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [heldModalOpen, setHeldModalOpen] = useState(false);
  const [holdPromptOpen, setHoldPromptOpen] = useState(false);
  const [holdNoteInput, setHoldNoteInput] = useState('');
  const [conflictHeldBill, setConflictHeldBill] = useState<HeldBill | null>(null);

  // Client-side portal mounting & modal scroll lock
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (holdPromptOpen || heldModalOpen || Boolean(conflictHeldBill)) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [holdPromptOpen, heldModalOpen, conflictHeldBill]);

  // Dismiss manual search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        manualDropdownRef.current &&
        !manualDropdownRef.current.contains(event.target as Node)
      ) {
        setManualDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { busy, send, notice } = useERP();
  const formRef = useRef<HTMLFormElement>(null);
  const scannerRef = useRef<HTMLInputElement>(null);
  const holdNoteInputRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLElement>(null);
  const quoteVersion = useRef(0);
  const prefsApplied = useRef(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gstEditingRef = useRef(false);

  const HELD_STORAGE_KEY = 'ms_pos_held_bills';

  // Load held bills from localStorage on mount & listen to multi-tab storage sync
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHeldBills(parsed);
      }
    } catch (e) {
      console.error('Failed to load held bills from storage:', e);
    }

    function onStorage(e: StorageEvent) {
      if (e.key === HELD_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setHeldBills(parsed);
        } catch { }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Autofocus the note input whenever the hold prompt opens
  useEffect(() => {
    if (holdPromptOpen) {
      const t = setTimeout(() => holdNoteInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [holdPromptOpen]);

  function persistHeldBills(list: HeldBill[]) {
    setHeldBills(list);
    try {
      localStorage.setItem(HELD_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save held bills to storage:', e);
    }
  }

  async function load() {
    try {
      const data = await api<Row>('/api/erp/pos');
      setCatalog(data.products || []);
      setPosOffers(Array.isArray(data.offers) ? data.offers : []);
      setPosCategories(data.references?.categories || []);
      const nextSettings = data.settings || {};
      setSettings(nextSettings);
      if (!prefsApplied.current) {
        prefsApplied.current = true;
        if (['cash', 'upi', 'card'].includes(nextSettings.default_pay_mode)) setPayMode(nextSettings.default_pay_mode);
        if (typeof nextSettings.auto_print === 'boolean') setAutoPrint(nextSettings.auto_print);
      }
      if (!gstEditingRef.current) {
        const rate = Math.round(Number(nextSettings.tax_bps || 0) / 100);
        setGstInput(rate > 0 ? String(rate) : '');
      }
    } catch (e) {
      notice((e as Error).message);
    }
  }

  async function loadBills(page = 0) {
    try {
      const data = await api<Row>(`/api/erp/pos_sale?page=${page}`);
      setBills((old) => (page === 0 ? data.rows : [...old, ...data.rows]));
      setNext(data.nextPage);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    void loadBills();
    scannerRef.current?.focus();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20000);
    return () => clearInterval(t);
  }, []);

  // Global keyboard-wedge barcode scanner capture when focus is not in another form field
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (manualDropdownOpen) {
          setManualDropdownOpen(false);
          return;
        }
        if (conflictHeldBill) {
          setConflictHeldBill(null);
          setHeldModalOpen(true);
          return;
        }
        if (holdPromptOpen) {
          setHoldPromptOpen(false);
          return;
        }
        if (heldModalOpen) {
          setHeldModalOpen(false);
          return;
        }
      }
      if (e.key === 'F3' || (e.altKey && (e.key === 'p' || e.key === 'P'))) {
        e.preventDefault();
        scannerRef.current?.focus();
        scannerRef.current?.select();
        if (barcodeInput.trim()) setManualDropdownOpen(true);
        return;
      }
      if (e.key === 'F4' || (e.altKey && (e.key === 'h' || e.key === 'H'))) {
        e.preventDefault();
        handleOpenHoldModal();
        return;
      }
      if (e.key === 'F2' || (e.altKey && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault();
        setHeldModalOpen(true);
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        if (!canComplete) {
          if (cart.length === 0) {
            notice('Scan or add sarees to the bill before completing.');
          } else if (!settings.enabled) {
            notice('POS Billing is disabled in Store Settings.');
          } else if (discountError) {
            notice(discountError);
          } else if (hasNonCash) {
            notice('Please verify the non-cash payment checkbox and references.');
          }
          return;
        }
        formRef.current?.requestSubmit();
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - lastKeyTime > 120) buffer = '';
      lastKeyTime = now;

      if (e.key === 'Enter' && buffer.length >= 3) {
        const scannedCode = buffer;
        buffer = '';
        void scan(scannedCode);
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Instant scan lookup: every barcode, SKU and piece code -> product, built once per catalogue refresh.
  const codeIndex = useMemo(() => {
    const map = new Map<string, { product: Row; piece: boolean }>();
    for (const p of catalog) {
      if (p.barcode) map.set(String(p.barcode).toLowerCase(), { product: p, piece: false });
      if (p.sku) map.set(String(p.sku).toLowerCase(), { product: p, piece: false });
    }
    return map;
  }, [catalog]);

  // Proactively lookup barcodes / piece codes / serialized units in backend if not found locally
  useEffect(() => {
    const trimmed = barcodeInput.trim();
    if (!trimmed || trimmed.length < 3) {
      setAsyncBarcodeMatch(null);
      setIsSearchingBarcode(false);
      return;
    }

    const q = trimmed.toLowerCase();
    const hit = codeIndex.get(q);
    if (hit?.product) {
      setAsyncBarcodeMatch(null);
      setIsSearchingBarcode(false);
      return;
    }

    // Check if local catalog already has an exact barcode, SKU or piece code match
    const hasExactLocal = catalog.some((p) => {
      const b = String(p.barcode || '').toLowerCase();
      const s = String(p.sku || '').toLowerCase();
      return b === q || s === q;
    });

    if (hasExactLocal) {
      setAsyncBarcodeMatch(null);
      setIsSearchingBarcode(false);
      return;
    }

    // Proactively query backend scan endpoint (e.g. MSU serialized unit stickers or new barcodes)
    setIsSearchingBarcode(true);
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const r = await api<Row>(`/api/erp/scan?barcode=${encodeURIComponent(trimmed)}`);
        if (active && r?.product) {
          setAsyncBarcodeMatch({
            ...r.product,
            matchedCode: trimmed,
            matchedUnit: r.unit,
          });
        } else if (active) {
          setAsyncBarcodeMatch(null);
        }
      } catch {
        if (active) setAsyncBarcodeMatch(null);
      } finally {
        if (active) setIsSearchingBarcode(false);
      }
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [barcodeInput, catalog, codeIndex]);

  const manualMatches = useMemo(() => {
    if (!barcodeInput.trim()) return [];
    const q = barcodeInput.trim().toLowerCase();
    const local = catalog.filter((p) => {
      const name = String(p.name || '').toLowerCase();
      const sku = String(p.sku || '').toLowerCase();
      const barcode = String(p.barcode || '').toLowerCase();
      const cat = String(p.category || '').toLowerCase();
      const subcat = String(p.subcategory_name || '').toLowerCase();
      const colour = String(p.colour || '').toLowerCase();
      const fabric = String(p.fabric || '').toLowerCase();
      const pieceMatch = Array.isArray(p.colours) && p.colours.some((c: Row) => String(c.colour || '').toLowerCase().includes(q));
      return (
        name.includes(q) ||
        sku.includes(q) ||
        barcode.includes(q) ||
        cat.includes(q) ||
        subcat.includes(q) ||
        colour.includes(q) ||
        fabric.includes(q) ||
        pieceMatch
      );
    });

    const codeHit = codeIndex.get(q)?.product;
    let list = local;
    if (codeHit && !list.some((p) => p.id === codeHit.id)) {
      list = [codeHit, ...list];
    }

    if (asyncBarcodeMatch) {
      list = [asyncBarcodeMatch, ...list.filter((p) => p.id !== asyncBarcodeMatch.id)];
    }

    return list;
  }, [catalog, barcodeInput, codeIndex, asyncBarcodeMatch]);

  const parsedGstPct = Math.min(100, Math.max(0, parseInt(gstInput || '0', 10) || 0));

  const rawSubtotalPaise = useMemo(() => {
    let subtotal = 0;
    for (const line of cart) {
      const prod = catalog.find((p) => p.id === line.product_id);
      if (prod) subtotal += unitPrice(prod as any) * line.quantity;
    }
    return subtotal;
  }, [cart, catalog]);

  const spotLines = useMemo(() => {
    return cart
      .map((line) => {
        const pct = Number(lineSpot[line.product_id] || 0);
        const prod = catalog.find((p) => p.id === line.product_id);
        if (!prod || pct <= 0) return null;
        const lineTotal = unitPrice(prod as any) * line.quantity;
        return { product_id: line.product_id, name: String(prod.name || ''), pct, paise: Math.round((lineTotal * pct) / 100) };
      })
      .filter(Boolean) as { product_id: string; name: string; pct: number; paise: number }[];
  }, [cart, catalog, lineSpot]);
  const spotTotalPaise = spotLines.reduce((sum, l) => sum + l.paise, 0);

  const parsedDiscountNum = useMemo(() => {
    if (!discountInput.trim()) return 0;
    const n = Number(discountInput);
    return Number.isFinite(n) ? n : 0;
  }, [discountInput]);

  const rawDiscountPaise = useMemo(() => {
    if (parsedDiscountNum <= 0) return 0;
    if (discountType === 'percent') {
      return Math.round((rawSubtotalPaise * parsedDiscountNum) / 100);
    }
    return Math.round(parsedDiscountNum * 100);
  }, [discountType, parsedDiscountNum, rawSubtotalPaise]);

  const maxDiscountBps = Number(settings.max_discount_bps ?? 9000);
  const maxAllowedDiscountPaise = Math.min(
    rawSubtotalPaise,
    Math.floor((rawSubtotalPaise * maxDiscountBps) / 10000),
  );

  const combinedDiscountPaise = rawDiscountPaise + spotTotalPaise;

  const discountError = useMemo(() => {
    if (!discountInput.trim() && spotTotalPaise === 0) return '';
    if (parsedDiscountNum < 0) return 'Discount cannot be negative.';
    if (discountType === 'percent' && parsedDiscountNum > 100) {
      return 'Discount percentage cannot exceed 100%.';
    }
    if (rawSubtotalPaise > 0 && combinedDiscountPaise > rawSubtotalPaise) {
      return `Discount cannot exceed the subtotal (${money(rawSubtotalPaise)}).`;
    }
    if (rawSubtotalPaise > 0 && combinedDiscountPaise >= rawSubtotalPaise && combinedDiscountPaise > 0) {
      return 'Final bill amount must be greater than ₹0.';
    }
    if (rawSubtotalPaise > 0 && combinedDiscountPaise > maxAllowedDiscountPaise) {
      return maxDiscountBps === 0
        ? 'Counter discounts are switched off (0%) in POS Settings.'
        : `Total counter discount is limited to ${maxDiscountBps / 100}% (${money(maxAllowedDiscountPaise)}) in POS Settings.`;
    }
    return '';
  }, [
    discountInput,
    parsedDiscountNum,
    discountType,
    rawSubtotalPaise,
    combinedDiscountPaise,
    spotTotalPaise,
    maxAllowedDiscountPaise,
    maxDiscountBps,
  ]);

  const discount = discountError ? 0 : Math.max(0, Math.min(combinedDiscountPaise, maxAllowedDiscountPaise));
  const discountTypeLabel =
    discount > 0
      ? [
        spotTotalPaise > 0 ? 'Spot' : '',
        rawDiscountPaise > 0 ? (discountType === 'percent' ? `${parsedDiscountNum}%` : 'Fixed ₹') : '',
      ]
        .filter(Boolean)
        .join(' + ')
      : '';

  // Live instant client-side price preview (synced with authoritative server pos_quote)
  const localEstimate = useMemo(() => {
    const subtotal = rawSubtotalPaise;
    const cappedDiscount = Math.min(discount, subtotal);
    const offerPaise = Math.max(0, Math.min(offerInfo.paise, subtotal - cappedDiscount));
    const afterDiscount = Math.max(0, subtotal - cappedDiscount - offerPaise);
    const taxBps = parsedGstPct * 100;
    const tax = Math.round((afterDiscount * taxBps) / 10000);
    return {
      subtotal_paise: subtotal,
      discount_paise: cappedDiscount,
      offer_discount_paise: offerPaise,
      offer_title: offerInfo.title,
      tax_paise: tax,
      total_paise: afterDiscount + tax,
    };
  }, [rawSubtotalPaise, discount, parsedGstPct, offerInfo]);

  useEffect(() => {
    const v = ++quoteVersion.current;
    if (!cart.length || !settings.enabled || Boolean(discountError)) {
      setQuote(null);
      setQuoteError('');
      if (!cart.length) setOfferInfo({ paise: 0, title: '' });
      return;
    }
    const timer = setTimeout(() => {
      api<Row>('/api/erp/pos_quote', { cart: serverCart(cart), discount_paise: discount })
        .then((r) => {
          if (quoteVersion.current === v) {
            setQuote(r);
            setOfferInfo({ paise: Number(r.offer_discount_paise || 0), title: String(r.offer_title || '') });
            setQuoteError('');
          }
        })
        .catch((e) => {
          if (quoteVersion.current === v) {
            setQuote(null);
            setQuoteError((e as Error).message);
          }
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [cart, discount, discountError, catalog, settings.enabled, settings.tax_bps]);

  async function savePosSettingPatch(patch: Partial<Row>, okMsg: string) {
    await api('/api/erp/pos_settings', {
      id: null,
      data: {
        enabled: Boolean(patch.enabled ?? settings.enabled),
        business_name: String(settings.business_name || 'மகரந்தம் சில்க்ஸ்'),
        business_english: String(settings.business_english || 'MAGARANTHAM SILKS'),
        address: String(settings.address || ''),
        phone: String(settings.phone || ''),
        gstin: String(settings.gstin || ''),
        invoice_prefix: String(settings.invoice_prefix || 'MS-POS'),
        receipt_footer: String(
          settings.receipt_footer || 'Thank you. Please keep your bill.',
        ),
        tax_bps: Number(patch.tax_bps ?? settings.tax_bps ?? 0),
        max_discount_bps: Number(settings.max_discount_bps || 0),
        paper_mm: Number(settings.paper_mm) === 58 ? 58 : 80,
      },
    });
    notice(okMsg);
  }

  async function enablePosNow() {
    try {
      await savePosSettingPatch({ enabled: true }, 'POS Register enabled.');
      await load();
    } catch (e) {
      notice((e as Error).message || 'Could not enable POS Register.');
    }
  }

  async function updateGstRate(nextTaxBps: number, silent = false) {
    if (Number(settings.tax_bps || 0) === nextTaxBps) return;
    setSavingGst(true);
    try {
      await api('/api/erp/pos_settings', {
        id: null,
        data: {
          enabled: Boolean(settings.enabled),
          business_name: String(settings.business_name || 'மகரந்தம் சில்க்ஸ்'),
          business_english: String(settings.business_english || 'MAGARANTHAM SILKS'),
          address: String(settings.address || ''),
          phone: String(settings.phone || ''),
          gstin: String(settings.gstin || ''),
          invoice_prefix: String(settings.invoice_prefix || 'MS-POS'),
          receipt_footer: String(
            settings.receipt_footer || 'Thank you. Please keep your bill.',
          ),
          tax_bps: nextTaxBps,
          max_discount_bps: Number(settings.max_discount_bps || 0),
          paper_mm: Number(settings.paper_mm) === 58 ? 58 : 80,
        },
      });
      setSettings((old) => ({ ...old, tax_bps: nextTaxBps }));
      if (!silent) {
        notice(
          nextTaxBps > 0 ? `GST set to ${nextTaxBps / 100}%.` : 'GST set to 0%.',
        );
      }
    } catch (e) {
      notice((e as Error).message || 'Could not update GST rate.');
    } finally {
      setSavingGst(false);
    }
  }

  function handleGstInputChange(raw: string) {
    // Only allow whole integer digits (no decimal/point values)
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    if (digitsOnly === '' || digitsOnly === '0') {
      setGstInput('');
      if (gstTimerRef.current) clearTimeout(gstTimerRef.current);
      gstTimerRef.current = setTimeout(() => {
        void updateGstRate(0, true);
      }, 300);
      return;
    }
    const clamped = Math.min(100, parseInt(digitsOnly, 10) || 0);
    setGstInput(clamped > 0 ? String(clamped) : '');
    if (gstTimerRef.current) clearTimeout(gstTimerRef.current);
    gstTimerRef.current = setTimeout(() => {
      void updateGstRate(clamped * 100, true);
    }, 300);
  }

  const activeTotals =
    quote &&
      !discountError &&
      Number(settings.tax_bps || 0) === parsedGstPct * 100 &&
      Number(quote.discount_paise || 0) === discount
      ? quote
      : cart.length
        ? localEstimate
        : null;
  const total = Number(activeTotals?.total_paise || 0);

  // Auto-sync tender amount when in single-method mode (Cash / UPI / Card)
  useEffect(() => {
    if (payMode === 'split') return;
    const nextTenders = {
      cash: payMode === 'cash' ? total : 0,
      upi: payMode === 'upi' ? total : 0,
      card: payMode === 'card' ? total : 0,
    };
    setTenders(nextTenders);
    if (payMode === 'cash') {
      if (!cashReceivedEdited) {
        setCashReceived(total);
      }
    } else {
      setCashReceived(0);
      setCashReceivedEdited(false);
    }
  }, [total, payMode]);

  // Best POS festival offer per saree, matching how the server prices the bill.
  const categoryMap = useMemo(() => buildCategoryMap(posCategories as any), [posCategories]);
  function offerFor(p: Row | undefined) {
    if (!p || !posOffers.length) return null;
    const r = resolveProductOffer(
      { id: p.id, price_paise: Number(p.price_paise || 0), effective_price_paise: unitPrice(p as any), category: p.category, category_id: p.category_id, subcategory_id: p.subcategory_id },
      posOffers,
      categoryMap,
    );
    return r.appliedOffer ? { price: r.effectivePricePaise, title: r.appliedOffer.title, badge: r.badgeText } : null;
  }

  function add(product: Row, unit?: Row, scannedCode?: string, colourKey?: string) {
    setCatalog((old) => {
      const i = old.findIndex((p) => p.id === product.id);
      if (i < 0) return [product, ...old];
      // A fresh scan result carries the latest colour counts.
      if (Array.isArray(product.colours)) { const next = [...old]; next[i] = { ...old[i], ...product }; return next; }
      return old;
    });
    if (!colourKey) {
      // One barcode per saree: work out which colour this piece is.
      const opts = colourOptions(product, cart.find((l) => l.product_id === product.id)).filter((o) => o.free > 0);
      if (!opts.length) {
        notice(`No more pieces of ${product.name} are free to bill.`);
        playScanBeep(false);
        return;
      }
      if (opts.length > 1) {
        setColourPick({ product, unit, code: scannedCode });
        return;
      }
      colourKey = opts[0].key;
    }
    const key = colourKey;
    let added = false;
    setCart((old) => {
      const line = old.find((l) => l.product_id === product.id);
      if (unit && old.some((l) => l.unit_ids.includes(String(unit.id)))) {
        notice('This unit sticker is already in the current bill.');
        return old;
      }
      if (
        line &&
        ((unit && line.unit_ids.length === 0) || (!unit && line.unit_ids.length > 0))
      ) {
        notice(
          'Use either unique unit stickers or quantity for this saree. Remove the line to switch.',
        );
        return old;
      }
      if (line) {
        const stockVal = product.available ?? product.stock_on_hand ?? 100;
        const maxAvail = Math.min(100, Math.max(1, Number(stockVal || 1)));
        if (line.quantity >= maxAvail) {
          notice(
            maxAvail < 100
              ? `Only ${maxAvail} piece${maxAvail === 1 ? '' : 's'} available in stock.`
              : 'Maximum 100 units per saree per bill.',
          );
          return old;
        }
        added = true;
        return old.map((l) =>
          l === line
            ? {
              ...l,
              quantity: l.quantity + 1,
              unit_ids: unit ? [...l.unit_ids, String(unit.id)] : [],
              colours: { ...l.colours, [key]: (l.colours?.[key] || 0) + 1 },
            }
            : l,
        );
      }
      added = true;
      return [
        ...old,
        {
          product_id: product.id,
          quantity: 1,
          unit_ids: unit ? [String(unit.id)] : [],
          colours: { [key]: 1 },
        },
      ];
    });

    if (added || scannedCode) {
      const offer = offerFor(product);
      const price = offer ? offer.price : unitPrice(product as any);
      const opt = colourOptions(product).find((o) => o.key === key);
      setLastScanned({
        name: `${product.name}${opt && key !== UNDEF ? ` · ${opt.label}` : ''}`,
        sku: product.sku || '',
        code: scannedCode || unit?.barcode || product.barcode || product.sku || '',
        price_paise: price,
        isUnit: Boolean(unit),
        offer: offer ? `${offer.title} · ${offer.badge}` : undefined,
      });
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(() => setLastScanned(null), 5000);
    }
  }

  function rememberPiece(productId: string, code: string) {
    setScannedPieces((o) => {
      const list = o[productId] || [];
      return list.includes(code) ? o : { ...o, [productId]: [...list, code].slice(-100) };
    });
  }

  async function scan(code: string): Promise<CameraScanResult> {
    // Strip scanner suffixes/prefixes (Tab, CR, control characters)
    const trimmed = code.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!trimmed) return { ok: false, message: 'Empty barcode.' };
    setScanning(true);

    // 1. Instant local match from the prebuilt code index (no per-scan search)
    const lower = trimmed.toLowerCase();
    const hit = codeIndex.get(lower);
    const localProd = hit?.product;
    if (localProd) {
      playScanBeep(true);
      add(localProd, undefined, trimmed);
      setBarcodeInput('');
      scannerRef.current?.focus();
      setScanning(false);
      return { ok: true, message: `Added "${localProd.name}" (${trimmed})` };
    }

    // 2. Authoritative backend scan lookup (supports serialized units, pieces, barcodes, SKUs)
    try {
      const r = await api<Row>(`/api/erp/scan?barcode=${encodeURIComponent(trimmed)}`);
      playScanBeep(true);
      add(r.product, r.unit || undefined, trimmed);
      setBarcodeInput('');
      scannerRef.current?.focus();
      return { ok: true, message: `Added "${r.product?.name || trimmed}" (${trimmed})` };
    } catch (e) {
      playScanBeep(false);
      const msg = (e as Error).message || `Barcode or code "${trimmed}" was not found.`;
      notice(msg);
      scannerRef.current?.select();
      return { ok: false, message: msg };
    } finally {
      setScanning(false);
    }
  }

  async function openBill(
    id: string,
    triggerPrint = false,
    extraMeta?: { discount_type_label?: string; whatsapp?: boolean },
  ) {
    try {
      const r = await api<Row>(`/api/erp/pos_sale?id=${id}`);
      if (!r.rows[0]) throw new Error('Bill not found.');
      if (extraMeta?.whatsapp && waEnabled.current) {
        setWaPrompt({ phone: String(r.rows[0].customer_phone || ''), text: billWhatsAppText(r.rows[0]) });
      }
      setReceipt({
        ...r.rows[0],
        ...(extraMeta?.discount_type_label
          ? { discount_type_label: extraMeta.discount_type_label }
          : {}),
      });
      setReturning(false);
      setTimeout(() => {
        receiptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (triggerPrint) {
          window.print();
        }
      }, 120);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  function printDraftBill() {
    if (!cart.length || !activeTotals) return;
    const draftItems = cart.map((line) => {
      const p = catalog.find((item) => item.id === line.product_id);
      const eachPaise = p ? unitPrice(p as any) : 0;
      return {
        product_id: line.product_id,
        name: p?.name || line.product_id,
        sku: p?.sku || '',
        quantity: line.quantity,
        unit_paise: eachPaise,
        line_paise: eachPaise * line.quantity,
      };
    });
    const activeTenders = (['cash', 'upi', 'card'] as const)
      .filter((m) => Number(tenders[m]) > 0)
      .map((method) => ({ method, amount_paise: Number(tenders[method]) }));

    setReceipt({
      id: 'DRAFT-PREVIEW',
      isDraft: true,
      invoice_no: `${settings.invoice_prefix || 'MS-POS'}-PREVIEW`,
      created_at: new Date().toISOString(),
      status: 'draft',
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      business: {
        business_name: settings.business_name || 'மகரந்தம் சில்க்ஸ்',
        business_english: settings.business_english || 'MAGARANTHAM SILKS',
        address: settings.address || '',
        phone: settings.phone || '',
        gstin: settings.gstin || '',
        tax_bps: parsedGstPct * 100,
        paper_mm: Number(settings.paper_mm || 80),
        receipt_footer: settings.receipt_footer || 'Thank you. Please keep your bill.',
      },
      items: draftItems,
      tenders: activeTenders.length
        ? activeTenders
        : [{ method: payMode === 'split' ? 'cash' : payMode, amount_paise: total }],
      subtotal_paise: Number(activeTotals.subtotal_paise || 0),
      discount_paise: Number(activeTotals.discount_paise || 0) + Number(activeTotals.offer_discount_paise || 0),
      discount_type_label: [Number(activeTotals.offer_discount_paise || 0) > 0 ? 'Offer' : '', discountTypeLabel].filter(Boolean).join(' + '),
      tax_paise: Number(activeTotals.tax_paise || 0),
      total_paise: total,
      cash_received_paise: cashReceived,
      change_paise: changePaise,
    });
    setReturning(false);
    setTimeout(() => {
      receiptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.print();
    }, 120);
  }

  /** Remove one piece of a colour (or, without a colour, undefined first then the last colour). */
  function dropPiece(productId: string, key?: string) {
    setCart((old) =>
      old.flatMap((l) => {
        if (l.product_id !== productId) return [l];
        const c = { ...l.colours };
        const k = key || (c[UNDEF] ? UNDEF : Object.keys(c).reverse().find((x) => c[x] > 0));
        if (!k || !c[k]) return [l];
        c[k] -= 1;
        if (c[k] <= 0) delete c[k];
        return l.quantity - 1 <= 0 ? [] : [{ ...l, quantity: l.quantity - 1, colours: c }];
      }),
    );
  }

  function updateQty(productId: string, nextQty: number) {
    if (nextQty <= 0) {
      removeItem(productId);
      return;
    }
    const prod = catalog.find((p) => p.id === productId);
    const current = cart.find((l) => l.product_id === productId);
    if (current && prod && current.unit_ids.length === 0) {
      if (nextQty === current.quantity + 1) { add(prod); return; }
      if (nextQty === current.quantity - 1) { dropPiece(productId); return; }
      if (nextQty !== current.quantity && Object.keys(current.colours).some((k) => k !== UNDEF)) {
        notice('Use + / − on each colour to change coloured pieces.');
        return;
      }
    }
    const maxAvail = Math.min(100, Math.max(1, Number(prod?.available ?? 100)));
    if (nextQty > maxAvail && maxAvail < 100) {
      notice(`Only ${maxAvail} piece${maxAvail === 1 ? '' : 's'} available in stock.`);
    }
    setCart((old) =>
      old.map((l) =>
        l.product_id === productId
          ? { ...l, quantity: Math.max(1, Math.min(maxAvail, nextQty)), colours: { [UNDEF]: Math.max(1, Math.min(maxAvail, nextQty)) } }
          : l,
      ),
    );
  }

  function removeItem(productId: string) {
    setCart((old) => old.filter((l) => l.product_id !== productId));
    setScannedPieces((old) => {
      const next = { ...old };
      delete next[productId];
      return next;
    });
    setLineSpot((old) => {
      const next = { ...old };
      delete next[productId];
      return next;
    });
  }

  function clearBill() {
    setCart([]);
    setDiscountInput('');
    setDiscountType('fixed');
    setLineSpot({});
    setSpotOpen(null);
    setScannedPieces({});
    setCustomerName('');
    setCustomerPhone('');
    setPayMode(['cash', 'upi', 'card'].includes(settings.default_pay_mode) ? settings.default_pay_mode : 'cash');
    setTenders({ cash: 0, upi: 0, card: 0 });
    setCashReceived(0);
    setCashReceivedEdited(false);
    setLastScanned(null);
    scannerRef.current?.focus();
  }

  function handleOpenHoldModal() {
    if (cart.length === 0) {
      notice('No items in the current bill to hold.');
      return;
    }
    setHoldNoteInput(customerName.trim() ? `Customer: ${customerName.trim()}` : '');
    setHoldPromptOpen(true);
  }

  function handleConfirmHold(customNote?: string) {
    if (cart.length === 0) return;
    const now = new Date();
    const nextHoldNumber =
      heldBills.reduce((acc, b) => Math.max(acc, Number(b.holdNumber) || 0), 0) + 1;

    const summary = cart
      .map((l) => {
        const p = catalog.find((item) => item.id === l.product_id);
        return `${p?.name || 'Saree'} (${l.quantity})`;
      })
      .join(', ');

    const finalNote = customNote !== undefined ? customNote.trim() : holdNoteInput.trim();

    const newHeldBill: HeldBill = {
      id: `HOLD-${Date.now()}`,
      heldAt: now.toISOString(),
      holdNumber: nextHoldNumber,
      note: finalNote || (customerName.trim() ? `Customer: ${customerName.trim()}` : `Walk-in Hold #${nextHoldNumber}`),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      cart: cart.map((c) => ({
        product_id: c.product_id,
        quantity: c.quantity,
        unit_ids: Array.isArray(c.unit_ids) ? [...c.unit_ids] : [],
        colours: { ...c.colours },
      })),
      scannedPieces: JSON.parse(JSON.stringify(scannedPieces)),
      lineSpot: { ...lineSpot },
      discountType,
      discountInput,
      payMode,
      tenders: { ...tenders },
      cashReceived,
      cashReceivedEdited,
      totalPieces,
      estimatedTotalPaise: total,
      itemSummary: summary,
    };

    const nextList = [newHeldBill, ...heldBills];
    persistHeldBills(nextList);
    clearBill();
    setHoldPromptOpen(false);
    setHoldNoteInput('');
    playScanBeep(true);
    notice(`✓ Bill #${newHeldBill.holdNumber} placed on hold (${newHeldBill.totalPieces} items · ${money(newHeldBill.estimatedTotalPaise)}).`);
    scannerRef.current?.focus();
  }

  function handleInitiateResume(bill: HeldBill) {
    if (cart.length > 0) {
      setHeldModalOpen(false);
      setConflictHeldBill(bill);
      return;
    }
    doResumeBill(bill);
  }

  function doResumeBill(bill: HeldBill) {
    setCart((bill.cart || []).map(normaliseLine));
    setScannedPieces(bill.scannedPieces || {});
    setLineSpot(bill.lineSpot || {});
    setDiscountType(bill.discountType || 'fixed');
    setDiscountInput(bill.discountInput || '');
    setCustomerName(bill.customerName || '');
    setCustomerPhone(bill.customerPhone || '');
    setPayMode(bill.payMode || 'cash');
    setTenders(bill.tenders || { cash: 0, upi: 0, card: 0 });
    setCashReceived(bill.cashReceived || 0);
    setCashReceivedEdited(Boolean(bill.cashReceivedEdited));

    const nextList = heldBills.filter((b) => b.id !== bill.id);
    persistHeldBills(nextList);

    setHeldModalOpen(false);
    setConflictHeldBill(null);
    playScanBeep(true);
    notice(`✓ Bill #${bill.holdNumber} recalled back to register.`);
    scannerRef.current?.focus();
  }

  function printHoldSlip(b: HeldBill) {
    const draftItems = b.cart.map((line) => {
      const p = catalog.find((x) => x.id === line.product_id);
      const eachPaise = p ? unitPrice(p as any) : 0;
      return {
        product_id: line.product_id,
        name: p?.name || 'Saree',
        sku: p?.sku || '',
        quantity: line.quantity,
        unit_paise: eachPaise,
        line_paise: eachPaise * line.quantity,
      };
    });

    setReceipt({
      id: b.id,
      invoice_no: `HOLD-#${b.holdNumber}`,
      created_at: b.heldAt,
      cashier_id: profile.id,
      cashier_name: profile.display_name,
      customer_name: b.customerName || 'Walk-in Customer',
      customer_phone: b.customerPhone || '',
      discount_reason: `PARKED HOLD BILL: ${b.note || `Hold #${b.holdNumber}`}`,
      business: {
        business_name: settings.business_name || 'மகரந்தம் சில்க்ஸ்',
        business_english: settings.business_english || 'MAGARANTHAM SILKS',
        address: settings.address || '',
        phone: settings.phone || '',
        gstin: settings.gstin || '',
        paper_mm: Number(settings.paper_mm || 80),
        receipt_footer: 'PARKED BILL SLIP. Please present this slip at the billing counter to resume checkout.',
      },
      items: draftItems,
      tenders: [{ method: 'cash', amount_paise: b.estimatedTotalPaise }],
      subtotal_paise: b.estimatedTotalPaise,
      discount_paise: 0,
      tax_paise: 0,
      total_paise: b.estimatedTotalPaise,
      cash_received_paise: 0,
      change_paise: 0,
    });
    setHeldModalOpen(false);
    setTimeout(() => {
      receiptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.print();
    }, 120);
  }

  function handleHoldCurrentAndResume(billToResume: HeldBill) {
    const now = new Date();
    const nextHoldNumber =
      heldBills.reduce((acc, b) => Math.max(acc, Number(b.holdNumber) || 0), 0) + 1;

    const summary = cart
      .map((l) => {
        const p = catalog.find((item) => item.id === l.product_id);
        return `${p?.name || 'Saree'} (${l.quantity})`;
      })
      .join(', ');

    const currentParked: HeldBill = {
      id: `HOLD-${Date.now()}`,
      heldAt: now.toISOString(),
      holdNumber: nextHoldNumber,
      note: customerName.trim() ? `Customer: ${customerName.trim()}` : `Walk-in Hold #${nextHoldNumber}`,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      cart: cart.map((c) => ({
        product_id: c.product_id,
        quantity: c.quantity,
        unit_ids: Array.isArray(c.unit_ids) ? [...c.unit_ids] : [],
        colours: { ...c.colours },
      })),
      scannedPieces: JSON.parse(JSON.stringify(scannedPieces)),
      lineSpot: { ...lineSpot },
      discountType,
      discountInput,
      payMode,
      tenders: { ...tenders },
      cashReceived,
      cashReceivedEdited,
      totalPieces,
      estimatedTotalPaise: total,
      itemSummary: summary,
    };

    const nextList = [currentParked, ...heldBills.filter((b) => b.id !== billToResume.id)];
    persistHeldBills(nextList);

    setCart((billToResume.cart || []).map(normaliseLine));
    setScannedPieces(billToResume.scannedPieces || {});
    setLineSpot(billToResume.lineSpot || {});
    setDiscountType(billToResume.discountType || 'fixed');
    setDiscountInput(billToResume.discountInput || '');
    setCustomerName(billToResume.customerName || '');
    setCustomerPhone(billToResume.customerPhone || '');
    setPayMode(billToResume.payMode || 'cash');
    setTenders(billToResume.tenders || { cash: 0, upi: 0, card: 0 });
    setCashReceived(billToResume.cashReceived || 0);
    setCashReceivedEdited(Boolean(billToResume.cashReceivedEdited));

    setHeldModalOpen(false);
    setConflictHeldBill(null);
    playScanBeep(true);
    notice(`✓ Current bill parked as Hold #${currentParked.holdNumber}. Bill #${billToResume.holdNumber} resumed!`);
    scannerRef.current?.focus();
  }

  function handleDiscardCurrentAndResume(billToResume: HeldBill) {
    doResumeBill(billToResume);
  }

  function handleDeleteHeldBill(id: string, holdNum: number) {
    if (!window.confirm(`Are you sure you want to discard Held Bill #${holdNum}?`)) {
      return;
    }
    const nextList = heldBills.filter((b) => b.id !== id);
    persistHeldBills(nextList);
    notice(`Held Bill #${holdNum} discarded.`);
  }

  function formatRelativeTime(iso: string) {
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);

      const timeStr = new Date(iso).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      if (diffMin < 1) return `Just now (${timeStr})`;
      if (diffMin === 1) return `1 min ago (${timeStr})`;
      if (diffMin < 60) return `${diffMin} mins ago (${timeStr})`;
      if (diffHour === 1) return `1 hr ago (${timeStr})`;
      return `${diffHour} hrs ago (${timeStr})`;
    } catch {
      return '';
    }
  }

  function selectPayMode(mode: PayMode) {
    setPayMode(mode);
    setCashReceivedEdited(false);
    if (mode === 'split') {
      // Keep current values or default to cash = total so user can split easily
      if (tenders.cash + tenders.upi + tenders.card === 0) {
        setTenders({ cash: total, upi: 0, card: 0 });
        setCashReceived(total);
      }
    }
  }

  const totalPieces = cart.reduce((s, l) => s + l.quantity, 0);
  const splitTotal = Number(tenders.cash) + Number(tenders.upi) + Number(tenders.card);
  const remainingPaise = total - splitTotal;
  const cashDuePaise = Number(tenders.cash);
  const changePaise = Math.max(0, cashReceived - cashDuePaise);
  const cashShortfallPaise = Math.max(0, cashDuePaise - cashReceived);
  const hasNonCash = Number(tenders.upi) > 0 || Number(tenders.card) > 0;

  const canComplete =
    !busy &&
    !savingGst &&
    !discountError &&
    Boolean(settings.enabled) &&
    cart.length > 0 &&
    Boolean(quote) &&
    Number(settings.tax_bps || 0) === parsedGstPct * 100 &&
    Number(quote?.discount_paise || 0) === discount &&
    splitTotal === total &&
    cashReceived >= cashDuePaise &&
    !(cashDuePaise === 0 && cashReceived !== 0);

  function downloadReceiptPdf(s: Row) {
    const taxPaise = Number(s.tax_paise || 0);
    const taxBps = Number(s.business?.tax_bps || 0);
    const gstPct =
      taxBps > 0
        ? Math.round(taxBps / 100)
        : taxPaise > 0 && Number(s.subtotal_paise || 0) - Number(s.discount_paise || 0) > 0
          ? Math.round(
            (taxPaise /
              (Number(s.subtotal_paise || 0) - Number(s.discount_paise || 0))) *
            100,
          )
          : 0;
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const totalPieces = (s.items || []).reduce(
      (acc: number, item: Row) => acc + Number(item.quantity || 1),
      0
    );
    const totalStyles = (s.items || []).length;
    const createdAt = s.created_at ? new Date(s.created_at) : new Date();
    const dateFormatted = createdAt.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timeFormatted = createdAt.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const itemsHtml = (s.items || [])
      .map((i: Row, idx: number) => {
        const unitRate = Number(i.unit_paise || 0);
        const qty = Number(i.quantity || 1);
        const lineTotal = Number(i.line_paise ?? unitRate * qty);
        return `<tr>
          <td style="text-align:center;color:#666;width:20px;padding:5px 2px;">${idx + 1}</td>
          <td style="padding:5px 2px;"><strong>${esc(i.name)}</strong>${i.sku ? `<br/><small style="color:#666;">SKU: ${esc(i.sku)}</small>` : ''}</td>
          <td style="text-align:right;white-space:nowrap;padding:5px 2px;">${esc(money(unitRate))}</td>
          <td style="text-align:center;font-weight:600;padding:5px 2px;">${qty}</td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;padding:5px 2px;">${esc(money(lineTotal))}</td>
        </tr>`;
      })
      .join('');

    const tendersHtml = (s.tenders || [])
      .map((t: Row) => {
        const isCash = String(t.method || '').toLowerCase() === 'cash';
        const cashRec = Number(s.cash_received_paise || 0);
        const change = Number(s.change_paise || 0);
        let extra = '';
        if (isCash && cashRec > 0) {
          extra = `<div style="font-size:11px;color:#555;padding-left:4px;margin-top:2px;">Cash Given: ${esc(money(cashRec))}${change > 0 ? ` · Change: ${esc(money(change))}` : ''}</div>`;
        }
        return `<div class="row"><span>Paid via <strong>${esc(String(t.method || '').toUpperCase())}</strong></span><b>${esc(money(t.amount_paise))}</b></div>${extra}`;
      })
      .join('');
    const discLabel = s.discount_type_label ? ` (${esc(s.discount_type_label)})` : '';
    const docTitle = s.isDraft
      ? '★ BILL PREVIEW (NOT SAVED) ★'
      : taxPaise > 0 || gstPct > 0
        ? 'TAX INVOICE (GST)'
        : 'RETAIL CASH MEMO';

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(s.invoice_no || 'POS-Invoice')}</title><style>
@page { margin: 6mm; size: ${s.business?.paper_mm || 80}mm auto; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; max-width: 380px; margin: 0 auto; padding: 10px; font-size: 12px; line-height: 1.45; }
.hdr { text-align: center; margin-bottom: 8px; }
h1 { font-size: 18px; font-weight: 700; color: #800020; margin: 0 0 2px; }
.sub { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; margin: 0 0 4px; }
.meta { font-size: 11px; color: #555; margin: 2px 0; }
.badge { text-align: center; font-weight: 700; font-size: 11.5px; letter-spacing: 1px; border-top: 1px dashed #555; border-bottom: 1px dashed #555; padding: 4px 0; margin: 8px 0; }
.meta-box { border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 6px; font-size: 11.5px; }
.meta-row { display: flex; justify-content: space-between; margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11.5px; }
th { border-top: 1px solid #222; border-bottom: 1px solid #222; font-size: 10.5px; font-weight: 700; text-transform: uppercase; background: #fbf9f7; padding: 4px 2px; }
td { border-bottom: 1px dashed #eee; vertical-align: top; }
.count-bar { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: #555; padding: 4px 0; border-bottom: 1px dashed #888; }
.div { border-top: 1px dashed #888; margin: 6px 0; }
.row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
.grand { display: flex; justify-content: space-between; align-items: center; background: #faf5f3; border: 1px solid #800020; border-radius: 4px; padding: 6px 8px; font-size: 14px; font-weight: 800; color: #800020; margin: 6px 0; }
.disc { color: #15803D; font-weight: 600; }
.pay-sec { border-top: 1px dashed #888; padding-top: 6px; margin-top: 6px; }
.sec-title { font-size: 10.5px; font-weight: 700; color: #666; text-transform: uppercase; margin-bottom: 4px; }
.foot { text-align: center; margin-top: 12px; padding-top: 8px; border-top: 1px dashed #888; font-size: 11px; color: #555; }
.thankyou { font-weight: 700; font-size: 12px; color: #800020; margin-bottom: 3px; }
</style></head><body>
<div class="hdr">
  <h1>${esc(s.business?.business_name || 'மகரந்தம் சில்க்ஸ்')}</h1>
  <div class="sub">${esc(s.business?.business_english || 'MAGARANTHAM SILKS')}</div>
  ${s.business?.address ? `<div class="meta">${esc(s.business.address)}</div>` : ''}
  <div class="meta">${s.business?.phone ? `Ph: ${esc(s.business.phone)}` : ''}${s.business?.gstin ? ` · GSTIN: <strong>${esc(s.business.gstin)}</strong>` : ''}</div>
</div>
<div class="badge">${docTitle}</div>
<div class="meta-box">
  <div class="meta-row"><span><strong>Bill No:</strong> ${esc(s.invoice_no)}</span><span><strong>Date:</strong> ${esc(dateFormatted)}</span></div>
  <div class="meta-row"><span><strong>Customer:</strong> ${esc(s.customer_name || 'Walk-in customer')}</span><span><strong>Time:</strong> ${esc(timeFormatted)}</span></div>
  ${s.customer_phone ? `<div class="meta-row"><span><strong>Mobile:</strong> ${esc(s.customer_phone)}</span></div>` : ''}
</div>
<table>
  <thead>
    <tr>
      <th style="width:20px;text-align:center;">#</th>
      <th style="text-align:left;">Item Description</th>
      <th style="text-align:right;">Rate</th>
      <th style="text-align:center;">Qty</th>
      <th style="text-align:right;">Amount</th>
    </tr>
  </thead>
  <tbody>${itemsHtml}</tbody>
</table>
<div class="count-bar">
  <span>Total Items: <strong>${totalStyles}</strong></span>
  <span>Total Pieces: <strong>${totalPieces}</strong></span>
</div>
<div style="margin: 6px 0;">
  <div class="row"><span>Subtotal</span><b>${esc(money(Number(s.subtotal_paise || 0)))}</b></div>
  ${Number(s.discount_paise || 0) > 0 ? `<div class="row disc"><span>Discount Saved${discLabel}</span><b>−${esc(money(Number(s.discount_paise)))}</b></div>` : ''}
  ${taxPaise > 0 || gstPct > 0 ? `<div class="row"><span>GST (${gstPct}%)</span><b>+${esc(money(taxPaise))}</b></div>` : ''}
  <div class="grand"><span>GRAND TOTAL</span><span>${esc(money(Number(s.total_paise || 0)))}</span></div>
</div>
<div class="pay-sec">
  <div class="sec-title">Payment Details</div>
  ${tendersHtml}
</div>
<div class="foot">
  <div class="thankyou">Thank You! Please Visit Again!</div>
  ${s.business?.receipt_footer ? `<div>${esc(s.business.receipt_footer)}</div>` : ''}
  ${!s.isDraft ? `<div style="font-size:9.5px;color:#888;margin-top:4px;">Ref: ${esc(s.id)}</div>` : ''}
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=520,height=740');
    if (!win) {
      window.print();
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 180);
  }

  return (
    <div className="erp-print-host pos-redesign-root">
      {/* Status & Disabled Warning Strip */}
      <div className="pos-status-bar">
        <div className="pos-status-left">
          <span
            className={`pos-live-badge ${settings.enabled ? 'is-open' : 'is-closed'}`}
          >
            <span className="pos-live-dot" />
            {settings.enabled ? 'POS Register Open' : 'POS Billing Disabled'}
          </span>
          <span className="pos-meta-chip">
            Catalogue: <strong>{catalog.length}</strong> sarees
          </span>
          <span className="pos-meta-chip">
            Max Discount: <strong>{Number(settings.max_discount_bps || 0) / 100}%</strong>
          </span>
          {Number(settings.tax_bps || 0) > 0 && (
            <span className="pos-meta-chip">
              GST: <strong>{Number(settings.tax_bps) / 100}%</strong>
            </span>
          )}
        </div>
        <div className="pos-status-right">
          {/* Quick Held Bills Button */}
          <button
            type="button"
            className="button outline-btn mini-btn"
            onClick={() => setHeldModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: heldBills.length > 0 ? '#FEF3C7' : undefined,
              borderColor: heldBills.length > 0 ? '#D97706' : undefined,
              color: heldBills.length > 0 ? '#92400E' : undefined,
              fontWeight: heldBills.length > 0 ? 700 : undefined,
            }}
            title="View and resume parked / held bills (Shortcut: F2 or Alt+R)"
          >
            <span>⏸ Held Bills</span>
            {heldBills.length > 0 && (
              <span
                style={{
                  background: '#D97706',
                  color: '#FFF',
                  borderRadius: '999px',
                  padding: '1px 7px',
                  fontSize: '11px',
                  fontWeight: 800,
                  lineHeight: 1.3,
                }}
              >
                {heldBills.length}
              </span>
            )}
          </button>
          {!settings.enabled && profile.role === 'superadmin' && (
            <button
              type="button"
              className="button gold-btn mini-btn"
              onClick={() => void enablePosNow()}
            >
              Enable POS Register
            </button>
          )}
          <button
            type="button"
            className="button outline-btn mini-btn"
            onClick={() => void load()}
          >
            ↻ Refresh Stock &amp; Prices
          </button>
          <button
            type="button"
            className="button outline-btn mini-btn"
            onClick={() => scannerRef.current?.focus()}
          >
            Focus Scanner
          </button>
        </div>
      </div>

      {settings.id !== undefined && !settings.enabled && (
        <div className="pos-disabled-alert" role="alert">
          <div>
            <strong>POS Billing is currently paused by Store Settings.</strong>
            <span>
              {' '}
              You can scan items and preview prices, but completing a bill requires POS
              to be enabled.
            </span>
          </div>
          {profile.role === 'superadmin' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button mini-btn"
                onClick={() => void enablePosNow()}
              >
                Enable POS Now
              </button>
              <Link href="/admin/pos-settings" className="button outline-btn mini-btn">
                POS Settings →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Prominent Unified Search & Barcode Scanner Bar */}
      <form
        className="pos-scanner-banner"
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = barcodeInput.trim();
          if (!trimmed) return;

          // 1. Exact barcode/piece code match in local index
          const lower = trimmed.toLowerCase();
          const hit = codeIndex.get(lower);
          if (hit?.product) {
            setManualDropdownOpen(false);
            setAsyncBarcodeMatch(null);
            await scan(trimmed);
            return;
          }

          // 2. If matching manual search result exists, add the top match
          if (manualMatches.length > 0) {
            const selected = manualMatches[0];
            const stock = Number(selected.available ?? selected.stock_on_hand ?? 0);
            if (stock <= 0) {
              notice(`"${selected.name}" is currently out of stock.`);
              return;
            }
            if (selected.matchedCode) {
              if (selected.piece) rememberPiece(selected.id, String(selected.piece.id || selected.matchedCode));
              add(selected, selected.matchedUnit || undefined, selected.matchedCode);
            } else {
              add(selected);
            }
            setBarcodeInput('');
            setAsyncBarcodeMatch(null);
            setManualDropdownOpen(false);
            playScanBeep(true);
            notice(`✓ Added "${selected.name}" to bill.`);
            scannerRef.current?.focus();
            return;
          }

          // 3. Fallback to authoritative backend scan (serialized piece or database SKU)
          setManualDropdownOpen(false);
          setAsyncBarcodeMatch(null);
          await scan(trimmed);
        }}
      >
        <div className="pos-scanner-icon" aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />
          </svg>
        </div>
        <div className="pos-scanner-input-wrap" ref={manualDropdownRef} style={{ position: 'relative' }}>
          <label htmlFor="pos-barcode-input" className="pos-scanner-label">
            Search &amp; Barcode Scanner — Scan barcode / piece code or search saree name, SKU, colour, category &amp; press Enter
          </label>
          <div className="pos-scanner-controls">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <input
                id="pos-barcode-input"
                ref={scannerRef}
                name="barcode"
                value={barcodeInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setBarcodeInput(val);
                  if (val.trim()) {
                    setManualDropdownOpen(true);
                  } else {
                    setManualDropdownOpen(false);
                  }
                }}
                onFocus={() => {
                  if (barcodeInput.trim()) setManualDropdownOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setManualDropdownOpen(false);
                  }
                }}
                autoComplete="off"
                placeholder="Scan barcode, piece code, or type saree name, SKU, colour, category (or press F3)..."
                className="pos-scanner-input"
              />
              {barcodeInput && (
                <button
                  type="button"
                  onClick={() => {
                    setBarcodeInput('');
                    setAsyncBarcodeMatch(null);
                    setIsSearchingBarcode(false);
                    setManualDropdownOpen(false);
                    scannerRef.current?.focus();
                  }}
                  style={{
                    position: 'absolute',
                    right: 12,
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px',
                  }}
                  title="Clear input"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              className="pos-camera-btn"
              onClick={() => setCameraOpen(true)}
              disabled={busy}
              title="Scan barcode using mobile or device camera"
              aria-label="Scan with Camera"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              <span>Scan with Camera</span>
            </button>
          </div>

          {/* Autocomplete Dropdown */}
          {manualDropdownOpen && barcodeInput.trim() && (
            <div className="pos-manual-dropdown" role="listbox" aria-label="Matching sarees">
              <div className="pos-manual-dropdown-header">
                <span>
                  Matches ({manualMatches.length} {manualMatches.length === 1 ? 'saree' : 'sarees'})
                  {isSearchingBarcode && (
                    <span style={{ marginLeft: 8, fontSize: '11px', color: '#800020', fontWeight: 600 }}>
                      Searching barcode…
                    </span>
                  )}
                </span>
                <small style={{ color: '#888', fontWeight: 400 }}>
                  Press [Enter] to add top match or click any saree
                </small>
              </div>
              <div className="pos-manual-dropdown-list">
                {manualMatches.length > 0 ? (
                  manualMatches.slice(0, 15).map((p) => {
                    const stock = Number(p.available ?? p.stock_on_hand ?? 0);
                    const isOutOfStock = stock <= 0;
                    const price = unitPrice(p as any);
                    const offer = offerFor(p);
                    return (
                      <div
                        key={p.id}
                        className={`pos-manual-dropdown-item ${isOutOfStock ? 'disabled' : ''}`}
                        onClick={() => {
                          if (isOutOfStock) {
                            notice(`"${p.name}" is currently out of stock.`);
                            return;
                          }
                          if (p.matchedCode) {
                            if (p.piece) rememberPiece(p.id, String(p.piece.id || p.matchedCode));
                            add(p, p.matchedUnit || undefined, p.matchedCode);
                          } else {
                            add(p);
                          }
                          setBarcodeInput('');
                          setAsyncBarcodeMatch(null);
                          setManualDropdownOpen(false);
                          playScanBeep(true);
                          notice(`✓ Added "${p.name}" to bill.`);
                          scannerRef.current?.focus();
                        }}
                      >
                        <img
                          src={p.image_path || '/assets/brand-logo.png'}
                          alt={p.name || 'Saree'}
                          className="pos-manual-item-thumb"
                        />
                        <div className="pos-manual-item-info">
                          <strong className="pos-manual-item-name">{p.name}</strong>
                          <div className="pos-manual-item-sub">
                            <code>{p.sku || 'No SKU'}</code>
                            {p.matchedCode ? (
                              <span style={{ color: '#800020', fontWeight: 700 }}>
                                🏷️ Barcode: {p.matchedCode}
                              </span>
                            ) : p.barcode && p.barcode !== p.sku ? (
                              <span>Barcode: {p.barcode}</span>
                            ) : null}
                            {p.category && <span>• {p.category}</span>}
                            {p.colour && <span>• {p.colour}</span>}
                            <span
                              style={{
                                fontWeight: 700,
                                color: isOutOfStock ? '#DC2626' : '#15803D',
                              }}
                            >
                              • {isOutOfStock ? 'Out of stock' : `${stock} in stock`}
                            </span>
                            {offer && (
                              <span className="pos-offer-chip" style={{ fontSize: '11px' }}>
                                🎉 {offer.badge}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="pos-manual-item-action">
                          <span className="pos-manual-item-price">{money(price)}</span>
                          <button
                            type="button"
                            className="ms-btn ms-btn-primary ms-btn-sm"
                            disabled={isOutOfStock}
                            style={{ height: '28px', padding: '0 10px', fontSize: '11.5px' }}
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : isSearchingBarcode ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#650019' }}>
                    <div style={{ fontSize: '20px', marginBottom: '6px' }}>⏳</div>
                    <p style={{ margin: 0, fontWeight: 600 }}>Searching barcode / piece code &ldquo;{barcodeInput}&rdquo;…</p>
                    <small style={{ color: '#888', display: 'block', marginTop: 4 }}>
                      Checking barcode scanner database…
                    </small>
                  </div>
                ) : (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#777' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>No sarees found matching &ldquo;{barcodeInput}&rdquo;</p>
                    <small style={{ color: '#999', display: 'block', marginTop: 4 }}>
                      Check the spelling or try searching by SKU, barcode or category.
                    </small>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button type="submit" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
      </form>

      {waPrompt && (
        <div className="cat-modal-backdrop" onClick={() => setWaPrompt(null)} role="presentation">
          <div className="cat-modal-card" role="dialog" aria-modal="true" aria-label="Send bill on WhatsApp" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 style={{ margin: 0 }}>Send bill on WhatsApp?</h2>
            <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#6B4F47' }}>WhatsApp opens with this message; tap Send there. The PDF can be attached from “Download PDF”.</p>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
              Customer WhatsApp number
              <input
                type="tel"
                value={waPrompt.phone}
                autoFocus={!waPrompt.phone}
                onChange={(e) => setWaPrompt({ ...waPrompt, phone: e.target.value })}
                placeholder="10-digit mobile"
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
              Message
              <textarea
                rows={9}
                value={waPrompt.text}
                onChange={(e) => setWaPrompt({ ...waPrompt, text: e.target.value })}
                style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13 }}
              />
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="button outline-btn" onClick={() => setWaPrompt(null)}>Skip</button>
              <button
                type="button"
                className="button"
                autoFocus={Boolean(waPrompt.phone)}
                disabled={!whatsappLink(waPrompt.phone, waPrompt.text)}
                onClick={() => {
                  const link = whatsappLink(waPrompt.phone, waPrompt.text);
                  if (link) window.open(link, '_blank', 'noopener,noreferrer');
                  setWaPrompt(null);
                  setTimeout(() => scannerRef.current?.focus(), 0);
                }}
              >
                Open WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {colourPick && (
        <PosColourPicker
          product={colourPick.product}
          options={colourOptions(colourPick.product, cart.find((l) => l.product_id === colourPick.product.id)).filter((o) => o.free > 0)}
          onPick={(key) => {
            const pick = colourPick;
            setColourPick(null);
            add(pick.product, pick.unit, pick.code, key);
            setTimeout(() => scannerRef.current?.focus(), 0);
          }}
          onClose={() => {
            setColourPick(null);
            setTimeout(() => scannerRef.current?.focus(), 0);
          }}
        />
      )}

      {mounted &&
        cameraOpen &&
        createPortal(
          <CameraScannerModal
            open={cameraOpen}
            paused={Boolean(colourPick)}
            onDetected={(code) => scan(code)}
            onClose={() => {
              setCameraOpen(false);
              setTimeout(() => scannerRef.current?.focus(), 0);
            }}
          />,
          document.body,
        )}

      {/* Instant Scanned Confirmation Toast */}
      {lastScanned && (
        <div className="pos-scan-toast" role="status">
          <span className="pos-scan-toast-badge">✓ ADDED TO BILL</span>
          <strong className="pos-scan-toast-name">{lastScanned.name}</strong>
          {lastScanned.code && (
            <code className="pos-scan-toast-code">{lastScanned.code}</code>
          )}
          <span className="pos-scan-toast-price">
            +{money(lastScanned.price_paise)}
          </span>
          {lastScanned.offer && <span className="pos-scan-toast-offer">🎉 {lastScanned.offer}</span>}
        </div>
      )}

      {/* Full-Width POS Workspace */}
      <div className="pos-workspace-full">
        {/* Full-Width Current Bill Section */}
        <section className="pos-bill-panel-full">
          {/* Header */}
          <div className="pos-bill-header">
            <div>
              <h2 className="pos-panel-title">Current Bill</h2>
              <p className="pos-panel-subtitle">
                {totalPieces === 0
                  ? 'Scan a barcode or enter SKU above to begin'
                  : `${cart.length} ${cart.length === 1 ? 'style' : 'styles'} · ${totalPieces} ${totalPieces === 1 ? 'piece' : 'pieces'}`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Always visible: Held Bills button with live count */}
              <button
                type="button"
                className="pos-held-btn"
                onClick={() => setHeldModalOpen(true)}
                style={{
                  background: heldBills.length > 0 ? '#FEF3C7' : '#F8FAFC',
                  borderColor: heldBills.length > 0 ? '#D97706' : '#CBD5E1',
                  color: heldBills.length > 0 ? '#92400E' : '#475569',
                  boxShadow: heldBills.length > 0 ? '0 1px 3px rgba(217, 119, 6, 0.2)' : 'none',
                }}
                title="View and resume parked / held bills (Shortcut: F2)"
              >
                <span>⏸ Held Bills</span>
                <span
                  style={{
                    background: heldBills.length > 0 ? '#D97706' : '#94A3B8',
                    color: '#FFF',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                  }}
                >
                  {heldBills.length}
                </span>
              </button>

              {/* Always visible: Hold Current Bill button */}
              <button
                type="button"
                className="pos-hold-btn"
                disabled={cart.length === 0 || busy}
                onClick={handleOpenHoldModal}
                style={{
                  opacity: cart.length === 0 ? 0.5 : 1,
                  cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                }}
                title={
                  cart.length === 0
                    ? 'Scan or enter sarees first to put current bill on hold'
                    : 'Park / Hold current bill to serve next customer (Shortcut: F4)'
                }
              >
                <span>⏸ Hold Bill</span>
              </button>

              {cart.length > 0 && (
                <button
                  type="button"
                  className="pos-clear-btn"
                  disabled={busy}
                  onClick={clearBill}
                  title="Clear all items from current bill"
                >
                  Clear Bill
                </button>
              )}
            </div>
          </div>

          {/* Product Billing Table */}
          <div className="pos-billing-table-wrapper">
            <table className="pos-billing-table">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: 'center' }}>S.No</th>
                  <th>Product Name</th>
                  <th style={{ width: 180 }}>SKU / Barcode</th>
                  <th style={{ width: 140, textAlign: 'center' }}>Quantity</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 100, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {cart.length > 0 ? (
                  cart.map((line, index) => {
                    const p = catalog.find((item) => item.id === line.product_id);
                    const eachPaise = p ? unitPrice(p as any) : 0;
                    const lineTotalPaise = eachPaise * line.quantity;
                    const isSerialized = line.unit_ids.length > 0;
                    const spotPct = Number(lineSpot[line.product_id] || 0);
                    const spotPaise = Math.round((lineTotalPaise * spotPct) / 100);
                    const finalLineTotalPaise = lineTotalPaise - spotPaise;
                    const cardOffer = p ? offerFor(p) : null;
                    const linePieces = scannedPieces[line.product_id] || [];

                    return (
                      <tr key={line.product_id} className="pos-table-row">
                        <td style={{ textAlign: 'center', fontWeight: 600, color: '#666' }}>
                          {index + 1}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <img
                              src={p?.image_path || '/assets/brand-logo.png'}
                              alt={p?.name || 'Saree'}
                              className="pos-bill-item-thumb"
                            />
                            <div>
                              <strong className="pos-table-item-name">
                                {p?.name || line.product_id}
                              </strong>
                              {(() => {
                                if (!p || !Array.isArray(p.colours) || p.colours.length === 0) return null;
                                const colouredOpts = colourOptions(p, line).filter(
                                  (o) => o.key !== UNDEF && (o.free > 0 || (line.colours?.[o.key] || 0) > 0)
                                );
                                if (colouredOpts.length === 0) return null;
                                return (
                                  <div className="pos-colour-pick" aria-label="Colours in this line">
                                    {colouredOpts.map((o) => {
                                      const n = line.colours?.[o.key] || 0;
                                      return (
                                        <span key={o.key} className={`pos-colour-chip ${n ? 'active' : ''}`} title={`${o.free} more free`}>
                                          <i style={{ background: o.hex || '#C49A52' }} />
                                          {o.label} <small>({o.free} left)</small>
                                          <button type="button" disabled={!n || busy || line.unit_ids.length > 0} onClick={() => dropPiece(line.product_id, o.key)} aria-label={`One less ${o.label}`}>−</button>
                                          <b>{n}</b>
                                          <button type="button" disabled={o.free < 1 || busy || line.unit_ids.length > 0 || line.quantity >= 100} onClick={() => add(p, undefined, undefined, o.key)} aria-label={`One more ${o.label}`}>+</button>
                                        </span>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {linePieces.length > 0 && (
                                <div className="pos-table-piece-chips">
                                  {linePieces.map((code) => (
                                    <span key={code} className="pos-table-piece-chip" title="Scanned Piece Code">
                                      🏷️ {code}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {cardOffer && (
                                <span className="pos-offer-chip" style={{ marginTop: 4, display: 'inline-block' }} title={cardOffer.title}>
                                  🎉 {cardOffer.badge}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="pos-table-sku-col">
                            <code>{p?.sku || '—'}</code>
                            {p?.barcode && p.barcode !== p.sku && (
                              <span className="pos-table-barcode">{p.barcode}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="pos-qty-stepper">
                            <button
                              type="button"
                              className="pos-qty-btn"
                              disabled={isSerialized || line.quantity <= 1 || busy}
                              onClick={() => updateQty(line.product_id, line.quantity - 1)}
                              aria-label="Decrease quantity"
                              title={isSerialized ? "Serialized piece quantity is managed by scanning stickers" : "Decrease quantity"}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={line.quantity}
                              disabled={isSerialized || busy}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              onChange={(e) =>
                                updateQty(line.product_id, Number(e.target.value))
                              }
                              className="pos-qty-input"
                              aria-label="Quantity"
                            />
                            <button
                              type="button"
                              className="pos-qty-btn"
                              disabled={isSerialized || line.quantity >= 100 || busy}
                              onClick={() => updateQty(line.product_id, line.quantity + 1)}
                              aria-label="Increase quantity"
                              title={isSerialized ? "Serialized piece quantity is managed by scanning stickers" : "Increase quantity"}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <strong className="pos-table-rate">{money(eachPaise)}</strong>
                          {unitSuffix(p?.sale_unit) && (
                            <small className="pos-table-unit"> /{unitSuffix(p?.sale_unit)}</small>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {spotPaise > 0 ? (
                            <div>
                              <s style={{ fontSize: 11, color: '#888', display: 'block' }}>{money(lineTotalPaise)}</s>
                              <strong style={{ color: '#800020', fontSize: 15 }}>{money(finalLineTotalPaise)}</strong>
                              <span style={{ fontSize: 10, color: '#15803D', display: 'block', fontWeight: 600 }}>−{spotPct}% spot</span>
                            </div>
                          ) : (
                            <strong style={{ color: '#800020', fontSize: 15 }}>{money(lineTotalPaise)}</strong>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="pos-table-del-btn"
                            onClick={() => removeItem(line.product_id)}
                            title={`Remove ${p?.name || 'saree'} from bill`}
                            aria-label={`Remove ${p?.name || 'saree'}`}
                          >
                            <span>🗑️</span>
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="pos-table-empty">
                      <div className="pos-bill-empty">
                        <div className="pos-bill-empty-icon">🧾</div>
                        <p>No items in bill yet</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Checkout Form */}
          <form
            ref={formRef}
            className="pos-checkout-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!quote) return;
              const form = e.currentTarget;
              const f = new FormData(form);
              const paymentLines = (['cash', 'upi', 'card'] as const)
                .filter((m) => Number(tenders[m]) > 0)
                .map((method) => ({
                  method,
                  amount_paise: Number(tenders[method]),
                  reference: String(f.get(`${method}_reference`) || ''),
                }));

              const savedDiscountLabel = [offerInfo.paise > 0 ? 'Offer' : '', discountTypeLabel].filter(Boolean).join(' + ');
              const serverDiscountReason =
                discount > 0
                  ? [
                    ...spotLines.map((l) => `Spot ${l.pct}% on ${l.name} (${money(l.paise)})`),
                    rawDiscountPaise > 0
                      ? discountType === 'percent'
                        ? `Bill ${parsedDiscountNum}% (${money(rawDiscountPaise)})`
                        : `Bill fixed (${money(rawDiscountPaise)})`
                      : '',
                  ]
                    .filter(Boolean)
                    .join('; ')
                    .slice(0, 300)
                  : '';

              const result = await send('pos_sale', {
                cart: serverCart(cart),
                customer: {
                  name: customerName.trim(),
                  phone: customerPhone.trim(),
                  discount_reason: serverDiscountReason,
                },
                discount_paise: discount,
                tenders: paymentLines,
                cash_received_paise: cashReceived,
                bank_checked: f.get('bank_checked') === 'on',
              });

              if (result) {
                clearBill();
                form.reset();
                await load();
                await loadBills();
                await openBill(String(result.id), autoPrint, {
                  discount_type_label: savedDiscountLabel,
                  whatsapp: true,
                });
              }
            }}
          >
            {/* Lower 2-Column Responsive Grid */}
            <div className="pos-lower-grid">
              {/* Left Column: Customer Details, Discount Section, Payment Mode */}
              <div className="pos-lower-col">
                {/* 1. Customer Details (Optional) */}
                <div className="pos-card-box">
                  <h3 className="pos-card-title">
                    <span>👤 Customer Details (Optional)</span>
                  </h3>
                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Customer Name</span>
                      <input
                        name="customer_name"
                        maxLength={80}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Walk-in customer"
                      />
                    </label>
                    <label className="input-group">
                      <span>Mobile Number{settings.require_customer_phone ? ' *' : ''}</span>
                      <input
                        name="customer_phone"
                        maxLength={25}
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                        required={Boolean(settings.require_customer_phone)}
                        pattern={settings.require_customer_phone ? '[0-9+ -]{10,25}' : undefined}
                        title={settings.require_customer_phone ? 'Enter the customer mobile number (at least 10 digits)' : undefined}
                      />
                    </label>
                  </div>
                </div>

                {/* 2. Discount Section */}
                <div className="pos-card-box">
                  <div className="pos-card-title">
                    <span>🏷️ Discount Section</span>
                    {discountInput !== '' && (
                      <button
                        type="button"
                        className="pos-discount-reset-btn"
                        onClick={() => setDiscountInput('')}
                      >
                        ✕ Reset Discount
                      </button>
                    )}
                  </div>

                  <div className="pos-discount-controls">
                    <div className="pos-discount-input-wrap">
                      <span className="pos-discount-prefix">
                        {discountType === 'fixed' ? '₹' : '%'}
                      </span>
                      <input
                        id="pos-manual-discount-input"
                        type="number"
                        min={0}
                        max={discountType === 'percent' ? 100 : undefined}
                        step="any"
                        value={discountInput}
                        placeholder={
                          discountType === 'fixed'
                            ? 'Enter Discount Amount'
                            : 'Enter Discount %'
                        }
                        onKeyDown={(e) => {
                          if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                            e.preventDefault();
                          }
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setDiscountInput('');
                            return;
                          }
                          if (Number(val) < 0) return;
                          setDiscountInput(val);
                        }}
                        className="pos-discount-input"
                        aria-label="Manual discount value"
                        style={{
                          border: 'none',
                          outline: 'none',
                          boxShadow: 'none',
                          background: 'transparent',
                          padding: 0,
                          minHeight: 'auto',
                          height: 'auto',
                          borderRadius: 0,
                        }}
                      />
                    </div>

                    <div className="pos-discount-type-toggle" role="group" aria-label="Discount type">
                      <button
                        type="button"
                        className={`pos-dtype-btn ${discountType === 'fixed' ? 'active' : ''}`}
                        onClick={() => {
                          setDiscountType('fixed');
                          setDiscountInput('');
                        }}
                      >
                        ₹ Fixed
                      </button>
                      <button
                        type="button"
                        className={`pos-dtype-btn ${discountType === 'percent' ? 'active' : ''}`}
                        onClick={() => {
                          setDiscountType('percent');
                          setDiscountInput('');
                        }}
                      >
                        % Percent
                      </button>
                    </div>
                  </div>

                  <div className="pos-quick-discount">
                    <span>Quick:</span>
                    {(Array.isArray(settings.bill_discount_options) ? settings.bill_discount_options : [5, 10, 15]).map((v: number) => (
                      <button
                        type="button"
                        key={v}
                        className={`ms-chip ${discountType === 'percent' && parsedDiscountNum === v ? 'on' : ''}`}
                        onClick={() => {
                          setDiscountType('percent');
                          setDiscountInput(String(v));
                        }}
                      >
                        {v}% off bill
                      </button>
                    ))}
                    {(Array.isArray(settings.round_off_options) ? settings.round_off_options : [10, 100]).map((step: number) => {
                      const afterSpot = rawSubtotalPaise - spotTotalPaise;
                      const roundOff = afterSpot % (step * 100);
                      return (
                        <button
                          type="button"
                          key={step}
                          className="ms-chip"
                          disabled={afterSpot <= 0 || roundOff === 0}
                          title={`Drop the extra so the bill (before GST) ends in a round ₹${step}`}
                          onClick={() => {
                            setDiscountType('fixed');
                            setDiscountInput(String(roundOff / 100));
                          }}
                        >
                          Round off ₹{step}
                        </button>
                      );
                    })}
                  </div>

                  {spotTotalPaise > 0 && (
                    <div className="pos-spot-summary">
                      {spotLines.map((l) => (
                        <span key={l.product_id}>
                          Spot {l.pct}% · {l.name} <b>−{money(l.paise)}</b>
                        </span>
                      ))}
                    </div>
                  )}

                  {discountType === 'percent' && discount > 0 && !discountError && (
                    <span className="pos-discount-hint">
                      {parsedDiscountNum}% of {money(rawSubtotalPaise)} = −{money(discount)}
                    </span>
                  )}

                  {discountError && (
                    <div role="alert" className="modal-error-banner" style={{ marginTop: 4 }}>
                      {discountError}
                    </div>
                  )}
                </div>

                {/* 3. Payment Mode (Horizontal) */}
                <div className="pos-card-box">
                  <h3 className="pos-card-title">
                    <span>💳 Payment Mode</span>
                  </h3>
                  <div className="pos-paymode-grid-horizontal">
                    {(
                      [
                        ['cash', '💵 Cash'],
                        ['upi', '📱 UPI'],
                        ['card', '💳 Card'],
                        ['split', '⇄ Other'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`pos-paymode-btn ${payMode === mode ? 'active' : ''}`}
                        onClick={() => selectPayMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Split / Other Payment Inputs */}
                  {payMode === 'split' && (
                    <div className="pos-split-box" style={{ marginTop: 10 }}>
                      {(['cash', 'upi', 'card'] as const).map((method) => (
                        <div className="pos-split-row" key={method}>
                          <label className="input-group">
                            <span>{method.toUpperCase()} (₹)</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={tenders[method] ? tenders[method] / 100 : ''}
                              placeholder="0"
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Math.round(Number(e.target.value || 0) * 100),
                                );
                                setTenders((old) => ({ ...old, [method]: val }));
                                if (method === 'cash' && !cashReceivedEdited) {
                                  setCashReceived(val);
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="button outline-btn mini-btn pos-fill-rem-btn"
                            disabled={!total}
                            onClick={() => {
                              const other = (['cash', 'upi', 'card'] as const)
                                .filter((m) => m !== method)
                                .reduce((s, m) => s + Number(tenders[m]), 0);
                              const rem = Math.max(0, total - other);
                              setTenders((old) => ({ ...old, [method]: rem }));
                              if (method === 'cash') setCashReceived(rem);
                            }}
                          >
                            Fill Remaining
                          </button>
                        </div>
                      ))}
                      <div
                        className={`pos-remaining-pill ${remainingPaise === 0 ? 'balanced' : 'unbalanced'}`}
                      >
                        <span>Remaining to allocate:</span>
                        <strong>{money(remainingPaise)}</strong>
                      </div>
                    </div>
                  )}

                  {/* UPI Reference */}
                  {Number(tenders.upi) > 0 && (
                    <label className="input-group" style={{ marginTop: 10 }}>
                      <span>UPI Transaction Reference / UTR *</span>
                      <input
                        name="upi_reference"
                        required
                        minLength={6}
                        maxLength={100}
                        placeholder="Enter UPI Ref / UTR number (min 6 chars)"
                      />
                    </label>
                  )}

                  {/* Card Reference */}
                  {Number(tenders.card) > 0 && (
                    <label className="input-group" style={{ marginTop: 10 }}>
                      <span>Card POS Slip / Auth Reference *</span>
                      <input
                        name="card_reference"
                        required
                        minLength={6}
                        maxLength={100}
                        placeholder="Enter Card approval / RRN number (min 6 chars)"
                      />
                    </label>
                  )}

                  {hasNonCash && (
                    <label className="checkbox-item pos-verify-check" style={{ marginTop: 8 }}>
                      <input name="bank_checked" type="checkbox" required />
                      <span>
                        I verified the exact UPI/Card amount on the merchant terminal.
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {/* Right Column: Cash Tender & Change, GST Setting, Bill Summary */}
              <div className="pos-lower-col">
                {/* Cash Calculator Box (when Cash is active) */}
                {(payMode === 'cash' || (payMode === 'split' && cashDuePaise > 0)) && (
                  <div className="pos-card-box">
                    <h3 className="pos-card-title">
                      <span>💵 Cash Tender &amp; Change</span>
                    </h3>
                    <label className="input-group">
                      <span>Cash Received from Customer (₹)</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={
                          cashReceived === 0 && !cashReceivedEdited
                            ? ''
                            : cashReceived === 0
                              ? ''
                              : cashReceived / 100
                        }
                        placeholder={
                          cashDuePaise > 0 ? String(cashDuePaise / 100) : 'Enter Amount'
                        }
                        onKeyDown={(e) => {
                          if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                            e.preventDefault();
                          }
                        }}
                        onChange={(e) => {
                          setCashReceivedEdited(true);
                          const raw = e.target.value;
                          setCashReceived(
                            raw === ''
                              ? 0
                              : Math.max(0, Math.round(Number(raw) * 100)),
                          );
                        }}
                      />
                    </label>

                    {/* Change / Due Banner */}
                    <div
                      className={`pos-change-banner ${cashShortfallPaise > 0 ? 'is-due' : 'is-change'}`}
                      role={cashShortfallPaise > 0 ? 'alert' : 'status'}
                    >
                      <span className="pos-change-banner-label">
                        {cashShortfallPaise > 0 ? 'BALANCE DUE' : 'CHANGE TO RETURN'}
                      </span>
                      <strong className="pos-change-banner-amt">
                        {cashShortfallPaise > 0
                          ? money(cashShortfallPaise)
                          : money(changePaise)}
                      </strong>
                    </div>

                    {cashDuePaise > 0 && (
                      <div className="pos-cash-summary">
                        <div className="pos-cash-summary-row">
                          <span>Cash Received</span>
                          <strong>{money(cashReceived)}</strong>
                        </div>
                        <div className="pos-cash-summary-row">
                          <span>{payMode === 'split' ? 'Cash Tender Due' : 'Grand Total'}</span>
                          <strong>{money(cashDuePaise)}</strong>
                        </div>
                        {cashShortfallPaise > 0 ? (
                          <div className="pos-cash-summary-row is-short">
                            <span>Balance Due</span>
                            <strong>{money(cashShortfallPaise)} short</strong>
                          </div>
                        ) : (
                          <div className="pos-cash-summary-row is-change">
                            <span>Change to Return</span>
                            <strong>{money(changePaise)}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* GST Rate Setting Bar */}
                <div className="pos-card-box" style={{ padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label htmlFor="pos-gst-pct-input" className="pos-block-title" style={{ margin: 0 }}>
                      GST Rate (%)
                    </label>
                    {profile.role === 'superadmin' ? (
                      <div className="pos-gst-input-wrap">
                        <input
                          id="pos-gst-pct-input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={3}
                          value={gstInput === '0' ? '' : gstInput}
                          placeholder="0"
                          onFocus={() => {
                            gstEditingRef.current = true;
                          }}
                          onBlur={() => {
                            gstEditingRef.current = false;
                            const normalized = Math.min(
                              100,
                              Math.max(0, parseInt(gstInput || '0', 10) || 0),
                            );
                            setGstInput(normalized > 0 ? String(normalized) : '');
                            if (gstTimerRef.current) clearTimeout(gstTimerRef.current);
                            void updateGstRate(normalized * 100, true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === '.' || e.key === ',' || e.key === '-' || e.key === 'e' || e.key === 'E') {
                              e.preventDefault();
                            }
                          }}
                          onChange={(e) => handleGstInputChange(e.target.value)}
                          className="pos-gst-input"
                          aria-label="GST percentage whole number"
                          style={{
                            border: 'none',
                            outline: 'none',
                            boxShadow: 'none',
                            background: 'transparent',
                            padding: 0,
                            minHeight: 'auto',
                            height: 'auto',
                            borderRadius: 0,
                          }}
                        />
                        <span className="pos-gst-suffix">%</span>
                      </div>
                    ) : (
                      <span className="pos-meta-chip">
                        GST: <strong>{Math.round(Number(settings.tax_bps || 0) / 100)}%</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Prominent Bill Summary Card */}
                {activeTotals && (
                  <div className="pos-summary-card" style={{ padding: '20px 22px', background: '#FAF5EE', border: '1px solid #EAD5C0' }}>
                    <span className="pos-summary-eyebrow" style={{ color: '#800020', fontWeight: 800, letterSpacing: '0.08em' }}>
                      ✦ BILL SUMMARY
                    </span>
                    <div className="pos-summary-line" style={{ fontSize: 14 }}>
                      <span>Subtotal ({totalPieces} {totalPieces === 1 ? 'piece' : 'pieces'})</span>
                      <strong style={{ fontSize: 15 }}>{money(Number(activeTotals.subtotal_paise || 0))}</strong>
                    </div>
                    {Number(activeTotals.offer_discount_paise || 0) > 0 && (
                      <div className="pos-summary-line discount pos-offer-line" style={{ fontSize: 13.5 }}>
                        <span>Festival Offer{activeTotals.offer_title ? ` · ${activeTotals.offer_title}` : ''}</span>
                        <strong style={{ color: '#15803D' }}>−{money(Number(activeTotals.offer_discount_paise))}</strong>
                      </div>
                    )}
                    <div className={`pos-summary-line ${Number(activeTotals.discount_paise || 0) > 0 ? 'discount' : ''}`} style={{ fontSize: 13.5 }}>
                      <span>
                        Counter Discount{discountTypeLabel ? ` (${discountTypeLabel})` : ''}
                      </span>
                      <strong style={{ color: Number(activeTotals.discount_paise || 0) > 0 ? '#15803D' : undefined }}>
                        {Number(activeTotals.discount_paise || 0) > 0
                          ? `−${money(Number(activeTotals.discount_paise))}`
                          : money(0)}
                      </strong>
                    </div>
                    <div className="pos-summary-line" style={{ fontSize: 14 }}>
                      <span>Tax / GST ({parsedGstPct}%)</span>
                      <strong style={{ fontSize: 15 }}>{money(Number(activeTotals.tax_paise || 0))}</strong>
                    </div>
                    <div className="pos-summary-grand" style={{ marginTop: 10, paddingTop: 14, borderTop: '2px dashed #C49A52' }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#800020' }}>TOTAL AMOUNT</span>
                      <strong style={{ fontSize: 32, color: '#800020', fontFamily: 'var(--serif, Georgia, serif)', lineHeight: 1.1 }}>
                        {money(total)}
                      </strong>
                    </div>
                  </div>
                )}

                {quoteError && !discountError && (
                  <div role="alert" className="modal-error-banner">
                    {quoteError}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Action Row (Complete Bill & Print Controls) */}
            <div className="pos-bottom-bar">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="button outline-btn pos-print-draft-btn"
                  disabled={cart.length === 0 || busy}
                  onClick={printDraftBill}
                  style={{ minWidth: 110, height: 42, padding: '0 16px', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Print quotation or draft slip before completing"
                >
                  🖨 Print Bill
                </button>
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={cart.length === 0 || busy}
                  onClick={handleOpenHoldModal}
                  style={{
                    minWidth: 110,
                    height: 42,
                    padding: '0 16px',
                    fontSize: 13.5,
                    background: '#FEF3C7',
                    borderColor: '#FCD34D',
                    color: '#92400E',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Park this bill temporarily to ring up another customer (Shortcut: F4)"
                >
                  ⏸ Hold Bill (F4)
                </button>
                <label className="checkbox-item" style={{ fontSize: 12.5, color: '#555', cursor: 'pointer', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoPrint}
                    onChange={(e) => setAutoPrint(e.target.checked)}
                  />
                  <span>Auto-open print dialog</span>
                </label>
              </div>

              <button
                type="submit"
                className="pos-complete-full-btn"
                disabled={!canComplete}
                title="Complete bill, generate invoice and update stock (Shortcut: F10)"
              >
                {busy ? (
                  'Saving Bill & Updating Stock…'
                ) : (
                  <>
                    <span style={{ fontSize: 16 }}>✓</span>
                    <span>
                      {total > 0
                        ? autoPrint
                          ? `Complete & Print Bill (F10) · ${money(total)}`
                          : `Complete Bill (F10) · ${money(total)}`
                        : 'Complete Bill (F10)'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Receipt Preview & Print Panel */}
      {receipt && (
        <section ref={receiptRef} className="pos-receipt-section">
          <div className="pos-receipt-controls">
            <div>
              <span className="modal-eyebrow">✦ GENERATED POS INVOICE</span>
              <h3 className="pos-panel-title">{receipt.invoice_no}</h3>
            </div>
            <div className="pos-receipt-btns">
              <button
                type="button"
                className="button"
                onClick={() => window.print()}
              >
                🖨 Print Receipt
              </button>
              <button
                type="button"
                className="button gold-btn"
                onClick={() => downloadReceiptPdf(receipt)}
              >
                ⬇ Download PDF
              </button>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => setWaPrompt({ phone: String(receipt.customer_phone || ''), text: billWhatsAppText(receipt) })}
              >
                💬 Send on WhatsApp
              </button>
              {profile.role !== 'billing' &&
                (profile.role === 'superadmin' ||
                  profile.permissions.includes('inventory')) &&
                receipt.status === 'completed' && (
                  <button
                    type="button"
                    className="button outline-btn"
                    onClick={() => setReturning((v) => !v)}
                  >
                    {returning ? 'Cancel Return' : 'Record Full Return'}
                  </button>
                )}
              <button
                type="button"
                className="button outline-btn"
                onClick={() => {
                  setReceipt(null);
                  setReturning(false);
                }}
              >
                Close
              </button>
            </div>
          </div>

          {returning && (
            <form
              className="pos-return-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await send('pos_return', {
                    id: receipt.id,
                    reason: f.get('reason'),
                    reference: f.get('reference'),
                    checked: f.get('checked') === 'on',
                  })
                ) {
                  await openBill(receipt.id);
                  await loadBills();
                  await load();
                }
              }}
            >
              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Return Reason *</span>
                  <input
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    required
                    placeholder="e.g. Customer exchanged saree / defect found"
                  />
                </label>
                <label className="input-group">
                  <span>Refund Reference *</span>
                  <input
                    name="reference"
                    minLength={6}
                    maxLength={100}
                    required
                    placeholder="Cash voucher or UPI refund ref"
                  />
                </label>
              </div>
              <label className="checkbox-item">
                <input name="checked" type="checkbox" required />
                <span>
                  All sarees were physically returned and full refund was completed.
                </span>
              </label>
              <div>
                <button type="submit" className="button" disabled={busy}>
                  Confirm Full Return &amp; Restock
                </button>
              </div>
            </form>
          )}

          <Receipt sale={receipt} />
          <div className="pos-receipt-bottom-actions" style={{ textAlign: 'center', marginTop: 18, borderTop: '1px dashed var(--erp-border, #EAD5C0)', paddingTop: 14 }}>
            <button
              type="button"
              className="button outline-btn"
              onClick={() => {
                setReceipt(null);
                setReturning(false);
              }}
            >
              ✕ Close Receipt Preview
            </button>
          </div>
        </section>
      )}

      {/* Recent Bills Table */}
      <section className="table-widget-panel pos-recent-bills">
        <div className="widget-header">
          <div className="widget-title-group">
            <span className="widget-badge-gold">POS History</span>
            <h3>Recent POS Bills</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--erp-text-muted)' }}>
              {profile.role === 'billing'
                ? 'Showing your bills'
                : 'Showing all register bills'}
            </span>
            <button
              type="button"
              className="button outline-btn mini-btn"
              onClick={() => void loadBills()}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="table-responsive-wrapper pos-bills-table-wrap">
          <table className="luxury-table pos-bills-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 155, whiteSpace: 'nowrap' }}>Invoice</th>
                <th style={{ minWidth: 145, whiteSpace: 'nowrap' }}>Customer</th>
                <th style={{ minWidth: 190, whiteSpace: 'nowrap' }}>Sarees Bought</th>
                <th style={{ minWidth: 105, whiteSpace: 'nowrap', textAlign: 'right' }}>Total</th>
                <th style={{ minWidth: 115, whiteSpace: 'nowrap', textAlign: 'right' }}>Paid</th>
                <th style={{ minWidth: 125, whiteSpace: 'nowrap', textAlign: 'right' }}>Change Returned</th>
                <th style={{ minWidth: 135, whiteSpace: 'nowrap', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {bills.length > 0 ? (
                bills.map((b) => {
                  const billItems = Array.isArray(b.items) ? b.items : [];
                  const billTenders = Array.isArray(b.tenders) ? b.tenders : [];
                  const digitalPaise = billTenders
                    .filter((t: Row) => t.method !== 'cash')
                    .reduce((sum: number, t: Row) => sum + Number(t.amount_paise || 0), 0);
                  const cashRecvPaise = Number(b.cash_received_paise || 0);
                  const totalPaidPaise =
                    cashRecvPaise > 0 ? cashRecvPaise + digitalPaise : Number(b.total_paise || 0);
                  const changeReturnedPaise = Number(b.change_paise || 0);
                  const payMethodsLabel = billTenders.length
                    ? billTenders
                      .map((t: Row) => String(t.method || '').toUpperCase())
                      .join(' + ')
                    : 'CASH';

                  return (
                    <tr key={b.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ color: 'var(--erp-maroon)' }}>
                            {b.invoice_no}
                          </strong>
                          <span
                            className={`pill-status ${b.status === 'completed' ? 'status-paid' : 'status-pending'}`}
                            style={{ fontSize: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}
                          >
                            {b.status}
                          </span>
                        </div>
                        <small style={{ display: 'block', color: 'var(--erp-text-muted)', marginTop: 2, whiteSpace: 'nowrap' }}>
                          {new Date(b.created_at).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </small>
                      </td>
                      <td style={{ minWidth: 145 }}>
                        <strong>{b.customer_name || 'Walk-in Customer'}</strong>
                        {b.customer_phone && (
                          <small style={{ display: 'block', color: 'var(--erp-text-muted)', whiteSpace: 'nowrap' }}>
                            {b.customer_phone}
                          </small>
                        )}
                      </td>
                      <td style={{ minWidth: 190, maxWidth: 300 }}>
                        {billItems.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {billItems.map((it: Row, idx: number) => (
                              <span key={`${it.product_id || idx}-${idx}`} style={{ fontSize: 13, lineHeight: 1.3 }}>
                                <strong style={{ color: 'var(--erp-maroon)' }}>{it.name}</strong>
                                <span style={{ color: 'var(--erp-text-muted)' }}>
                                  {' '}× {it.quantity}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="money-cell" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {money(b.total_paise)}
                        {Number(b.discount_paise || 0) > 0 && (
                          <small
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              color: '#15803D',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Disc: −{money(Number(b.discount_paise))}
                          </small>
                        )}
                      </td>
                      <td className="money-cell" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <strong>{money(totalPaidPaise)}</strong>
                        {billTenders.length > 0 ? (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              gap: 3,
                              marginTop: 4,
                            }}
                          >
                            {billTenders.map((t: Row, tidx: number) => {
                              const method = String(t.method || 'cash').toUpperCase();
                              const amt =
                                method === 'CASH' && cashRecvPaise > Number(t.amount_paise || 0)
                                  ? cashRecvPaise
                                  : Number(t.amount_paise || 0);
                              const badgeColors: Record<string, { bg: string; color: string }> = {
                                UPI: { bg: '#EFF6FF', color: '#1D4ED8' },
                                CASH: { bg: '#ECFDF5', color: '#047857' },
                                CARD: { bg: '#FEF3C7', color: '#B45309' },
                              };
                              const c = badgeColors[method] || { bg: '#F3F4F6', color: '#374151' };
                              return (
                                <div
                                  key={`${t.id || tidx}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    fontSize: 11,
                                    fontWeight: 600,
                                  }}
                                >
                                  <span
                                    style={{
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      background: c.bg,
                                      color: c.color,
                                      fontSize: 10,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {method}
                                  </span>
                                  <span style={{ color: 'var(--erp-text)' }}>
                                    {money(amt)}
                                  </span>
                                  {t.reference && (
                                    <span style={{ color: 'var(--erp-text-muted)', fontSize: 10 }}>
                                      ({t.reference})
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <small
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              color: 'var(--erp-text-muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {payMethodsLabel}
                          </small>
                        )}
                      </td>
                      <td className="money-cell" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {changeReturnedPaise > 0 ? (
                          <strong style={{ color: '#15803D' }}>
                            {money(changeReturnedPaise)}
                          </strong>
                        ) : (
                          <span style={{ color: 'var(--erp-text-muted)' }}>0 Rs</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="button outline-btn mini-btn"
                            onClick={() => void openBill(b.id, false)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="button mini-btn"
                            onClick={() => void openBill(b.id, true)}
                          >
                            🖨 Print
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="table-empty-cell">
                    No POS bills recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {next !== null && (
          <div style={{ padding: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="button outline-btn"
              onClick={() => void loadBills(next)}
            >
              Load More Bills
            </button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 1. HOLD BILL PROMPT MODAL                                     */}
      {/* ------------------------------------------------------------- */}
      {mounted && typeof document !== 'undefined' && holdPromptOpen && createPortal(
        <div
          className="cat-modal-backdrop luxury-admin-shell"
          onClick={() => setHoldPromptOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            className="cat-modal-card"
            style={{ maxWidth: 480, margin: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cat-modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <span>⏸</span>
                <span>Hold Current Bill</span>
              </h2>
              <button
                type="button"
                className="cat-close-btn"
                onClick={() => setHoldPromptOpen(false)}
                aria-label="Close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmHold(holdNoteInput);
              }}
              style={{ padding: '20px 24px' }}
            >
              <p style={{ margin: '0 0 16px', color: '#555', fontSize: 13.5, lineHeight: 1.5 }}>
                Park this bill temporarily to attend to the next customer. You can recall and complete it anytime.
              </p>

              {/* Bill Summary Banner */}
              <div
                style={{
                  background: '#FAF5EE',
                  border: '1px solid #EAD5C0',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 18,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: '#666' }}>Bill Items</div>
                  <strong style={{ color: '#800020', fontSize: 14 }}>
                    {totalPieces} {totalPieces === 1 ? 'piece' : 'pieces'} ({cart.length} {cart.length === 1 ? 'style' : 'styles'})
                  </strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Estimated Total</div>
                  <strong style={{ color: '#800020', fontSize: 18 }}>{money(total)}</strong>
                </div>
              </div>

              {/* Note / Customer Label Input */}
              <label className="ap-field" style={{ marginBottom: 20 }}>
                <span className="ap-label" style={{ fontWeight: 700, color: '#444' }}>
                  Hold Note / Customer Label <small style={{ fontWeight: 400, color: '#888' }}>(Optional)</small>
                </span>
                <input
                  ref={holdNoteInputRef}
                  type="text"
                  value={holdNoteInput}
                  onChange={(e) => setHoldNoteInput(e.target.value)}
                  placeholder="e.g. Went to ATM, Choosing matching blouse, Saree table 3..."
                  className="ap-input"
                  style={{ height: 40, fontSize: 13.5 }}
                />
                <small style={{ color: '#888', marginTop: 4, display: 'block' }}>
                  Press Enter to hold immediately or type a quick reference note.
                </small>
              </label>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="cat-footer-close-btn"
                  onClick={() => setHoldPromptOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ms-btn ms-btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <span>⏸</span>
                  <span>Hold Bill (Enter)</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. HELD BILLS LIST MODAL / DRAWER                             */}
      {/* ------------------------------------------------------------- */}
      {mounted && typeof document !== 'undefined' && heldModalOpen && createPortal(
        <div
          className="cat-modal-backdrop luxury-admin-shell"
          onClick={() => setHeldModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            className="cat-modal-card"
            style={{ maxWidth: 740, width: '95%', margin: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cat-modal-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                  <span>⏸</span>
                  <span>Held Bills (Parked Orders)</span>
                </h2>
                <span style={{ fontSize: 12, color: '#777', marginTop: 2, display: 'block' }}>
                  {heldBills.length === 0
                    ? 'No bills currently on hold'
                    : `${heldBills.length} ${heldBills.length === 1 ? 'bill' : 'bills'} waiting to be recalled`}
                </span>
              </div>
              <button
                type="button"
                className="cat-close-btn"
                onClick={() => setHeldModalOpen(false)}
                aria-label="Close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '16px 20px', maxHeight: '68vh', overflowY: 'auto' }}>
              {heldBills.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <span style={{ fontSize: 44, display: 'block', marginBottom: 12, opacity: 0.6 }}>⏸</span>
                  <p style={{ fontSize: 16, fontWeight: 700, color: '#800020', margin: '0 0 6px' }}>
                    No bills currently on hold
                  </p>
                  <p style={{ fontSize: 13, color: '#666', maxWidth: 380, margin: '0 auto' }}>
                    When a customer steps away or is picking another saree, click <strong>"Hold Bill"</strong> to temporarily park their items and ring up the next customer.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {heldBills.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        background: '#FFFDF9',
                        border: '1px solid #EAD5C0',
                        borderRadius: 10,
                        padding: '14px 16px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      {/* Top line: Hold Badge, Note, and Time */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              background: '#FEF3C7',
                              color: '#92400E',
                              border: '1px solid #FCD34D',
                              borderRadius: 6,
                              padding: '2px 8px',
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            Hold #{b.holdNumber}
                          </span>
                          <strong style={{ color: '#800020', fontSize: 14 }}>
                            {b.note || `Hold #${b.holdNumber}`}
                          </strong>
                        </div>
                        <span style={{ fontSize: 11.5, color: '#888' }}>
                          🕒 {formatRelativeTime(b.heldAt)}
                        </span>
                      </div>

                      {/* Middle line: Customer details & Items count */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ flex: '1 1 300px' }}>
                          <div style={{ fontSize: 12.5, color: '#333', marginBottom: 2 }}>
                            👤 <strong>{b.customerName || 'Walk-in customer'}</strong>
                            {b.customerPhone && (
                              <span style={{ color: '#666', marginLeft: 8 }}>· 📞 {b.customerPhone}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Bill Amount
                          </div>
                          <strong style={{ fontSize: 18, color: '#800020' }}>
                            {money(b.estimatedTotalPaise)}
                          </strong>
                        </div>
                      </div>

                      {/* Itemized List of Sarees in this Held Bill */}
                      <div style={{ background: '#FAF5EE', borderRadius: 8, padding: '8px 12px', border: '1px solid #F1E5D8' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#800020', marginBottom: 6, textTransform: 'uppercase' }}>
                          🛍️ Parked Items ({b.totalPieces} {b.totalPieces === 1 ? 'piece' : 'pieces'}):
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {b.cart.map((line) => {
                            const p = catalog.find((x) => x.id === line.product_id);
                            const eachPaise = p ? unitPrice(p as any) : 0;
                            const linePieces = b.scannedPieces?.[line.product_id] || [];
                            return (
                              <div
                                key={line.product_id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: 12,
                                  gap: 8,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                  {p?.image_path ? (
                                    <img
                                      src={p.image_path}
                                      alt=""
                                      style={{ width: 26, height: 26, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                                    />
                                  ) : (
                                    <span style={{ fontSize: 14 }}>🥻</span>
                                  )}
                                  <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <strong style={{ color: '#333' }}>{p?.name || 'Saree'}</strong>
                                    <small style={{ color: '#888', marginLeft: 6 }}>{p?.sku || ''}</small>
                                    {linePieces.length > 0 && (
                                      <span
                                        style={{
                                          marginLeft: 6,
                                          background: '#EFF6FF',
                                          color: '#1E40AF',
                                          border: '1px solid #BFDBFE',
                                          borderRadius: 4,
                                          padding: '1px 5px',
                                          fontSize: 10.5,
                                        }}
                                      >
                                        {linePieces.join(', ')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>
                                  {line.quantity} × {money(eachPaise)} = <span style={{ color: '#800020', fontWeight: 700 }}>{money(eachPaise * line.quantity)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Bottom line: Actions */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px dashed #EAD5C0', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => printHoldSlip(b)}
                          style={{
                            background: '#FAF5EE',
                            border: '1px solid #EAD5C0',
                            color: '#800020',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="Print customer hold slip"
                        >
                          <span>🖨️</span>
                          <span>Print Slip</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHeldBill(b.id, b.holdNumber)}
                          style={{
                            background: '#FEF2F2',
                            border: '1px solid #FECACA',
                            color: '#B91C1C',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="Discard this held bill"
                        >
                          <span>🗑️</span>
                          <span>Discard</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateResume(b)}
                          className="ms-btn ms-btn-primary ms-btn-sm"
                          style={{
                            padding: '0 16px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                          title="Load this bill back into the register"
                        >
                          <span>▶</span>
                          <span>Recall / Resume Bill</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid #EAD5C0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FAF5EE' }}>
              <small style={{ color: '#777' }}>
                💡 Held bills remain safely saved until you recall or discard them.
              </small>
              <button
                type="button"
                className="cat-footer-close-btn"
                onClick={() => setHeldModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. CONFLICT RECALL MODAL                                      */}
      {/* ------------------------------------------------------------- */}
      {mounted && typeof document !== 'undefined' && conflictHeldBill && createPortal(
        <div
          className="cat-modal-backdrop luxury-admin-shell"
          onClick={() => {
            setConflictHeldBill(null);
            setHeldModalOpen(true);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div className="cat-modal-card" style={{ maxWidth: 480, margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="cat-modal-header">
              <h2 style={{ color: '#800020', margin: 0, fontSize: 18 }}>⚠️ Active Bill in Progress</h2>
              <button
                type="button"
                className="cat-close-btn"
                onClick={() => {
                  setConflictHeldBill(null);
                  setHeldModalOpen(true);
                }}
                aria-label="Close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ margin: '0 0 12px', color: '#333', fontSize: 13.5, lineHeight: 1.5 }}>
                The register currently has <strong>{cart.length} item(s)</strong> ({money(total)}) for an active customer.
              </p>
              <p style={{ margin: '0 0 20px', color: '#666', fontSize: 13 }}>
                What would you like to do before recalling <strong>Hold #{conflictHeldBill.holdNumber}</strong>?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  className="ms-btn ms-btn-primary"
                  style={{ padding: '10px 16px' }}
                  onClick={() => handleHoldCurrentAndResume(conflictHeldBill)}
                >
                  ⏸ Park Current Bill &amp; Resume Hold #{conflictHeldBill.holdNumber}
                </button>
                <button
                  type="button"
                  className="cat-footer-close-btn"
                  style={{ color: '#B91C1C', borderColor: '#FECACA', background: '#FEF2F2', height: 38, width: '100%' }}
                  onClick={() => handleDiscardCurrentAndResume(conflictHeldBill)}
                >
                  🗑 Discard Current Bill &amp; Resume Hold #{conflictHeldBill.holdNumber}
                </button>
                <button
                  type="button"
                  className="cat-footer-close-btn"
                  style={{ height: 38, width: '100%' }}
                  onClick={() => {
                    setConflictHeldBill(null);
                    setHeldModalOpen(true);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function Receipt({ sale: s }: { sale: Row }) {
  const taxPaise = Number(s.tax_paise || 0);
  const taxBps = Number(s.business?.tax_bps || 0);
  const gstPct =
    taxBps > 0
      ? Math.round(taxBps / 100)
      : taxPaise > 0 && Number(s.subtotal_paise || 0) - Number(s.discount_paise || 0) > 0
        ? Math.round(
          (taxPaise /
            (Number(s.subtotal_paise || 0) - Number(s.discount_paise || 0))) *
          100,
        )
        : 0;

  const createdAt = s.created_at ? new Date(s.created_at) : new Date();
  const dateFormatted = createdAt.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeFormatted = createdAt.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const totalPieces = (s.items || []).reduce(
    (acc: number, item: Row) => acc + Number(item.quantity || 1),
    0
  );
  const totalStyles = (s.items || []).length;

  return (
    <article
      className="erp-print pos-receipt"
      style={{ width: `${s.business?.paper_mm || 80}mm` }}
    >
      {/* 1. Store Header */}
      <div className="pos-receipt-header">
        <h2 className="pos-receipt-store-tamil">{s.business?.business_name || 'மகரந்தம் சில்க்ஸ்'}</h2>
        <b className="pos-receipt-store-english">{s.business?.business_english || 'MAGARANTHAM SILKS'}</b>
        {s.business?.address ? (
          <p className="pos-receipt-store-meta">{s.business.address}</p>
        ) : null}
        <div className="pos-receipt-contact-row">
          {s.business?.phone ? <span>Ph: {s.business.phone}</span> : null}
          {s.business?.gstin ? <span>GSTIN: <strong>{s.business.gstin}</strong></span> : null}
        </div>
      </div>

      {/* 2. Document Title Badge */}
      <div className="receipt-doc-title">
        {s.isDraft
          ? '★ BILL PREVIEW (NOT SAVED) ★'
          : taxPaise > 0 || gstPct > 0
            ? 'TAX INVOICE (GST)'
            : 'RETAIL CASH MEMO'}
      </div>

      {s.status === 'returned' && (
        <div className="pos-receipt-returned-badge">
          ⚠ FULL RETURN RECORDED
        </div>
      )}

      {/* 3. Bill & Customer Metadata Box */}
      <div className="pos-receipt-meta-box">
        <div className="pos-receipt-meta-row">
          <span><strong>Bill No:</strong> {s.invoice_no}</span>
          <span><strong>Date:</strong> {dateFormatted}</span>
        </div>
        <div className="pos-receipt-meta-row">
          <span><strong>Customer:</strong> {s.customer_name || 'Walk-in customer'}</span>
          <span><strong>Time:</strong> {timeFormatted}</span>
        </div>
        {s.customer_phone ? (
          <div className="pos-receipt-meta-row">
            <span><strong>Mobile:</strong> {s.customer_phone}</span>
            {s.cashier_name ? <span><strong>Cashier:</strong> {s.cashier_name}</span> : null}
          </div>
        ) : s.cashier_name ? (
          <div className="pos-receipt-meta-row">
            <span><strong>Cashier:</strong> {s.cashier_name}</span>
          </div>
        ) : null}
      </div>

      {/* 4. Product Billing Table with Rate & Qty */}
      <table className="pos-receipt-table">
        <thead>
          <tr>
            <th style={{ width: '20px', textAlign: 'center' }}>#</th>
            <th style={{ textAlign: 'left' }}>Item Description</th>
            <th style={{ textAlign: 'right', width: '60px' }}>Rate</th>
            <th style={{ textAlign: 'center', width: '32px' }}>Qty</th>
            <th style={{ textAlign: 'right', width: '64px' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(s.items || []).map((i: Row, idx: number) => {
            const unitRate = Number(i.unit_paise || 0);
            const qty = Number(i.quantity || 1);
            const linePaise = Number(i.line_paise ?? unitRate * qty);

            return (
              <tr key={i.product_id || idx}>
                <td style={{ textAlign: 'center', color: '#666', verticalAlign: 'top', padding: '5px 2px' }}>
                  {idx + 1}
                </td>
                <td style={{ verticalAlign: 'top', padding: '5px 2px' }}>
                  <strong className="pos-receipt-item-title">{i.name}</strong>
                  {i.sku && (
                    <span className="pos-receipt-item-sku">SKU: {i.sku}</span>
                  )}
                  {Array.isArray(i.colours) && i.colours.length > 0 && (
                    <span className="pos-receipt-item-pieces">
                      Colour: {i.colours.map((c: Row) => `${c.colour || 'Undefined'} × ${c.quantity}`).join(', ')}
                    </span>
                  )}
                  {Array.isArray(i.pieces) && i.pieces.length > 0 && (
                    <span className="pos-receipt-item-pieces">
                      Tags: {i.pieces.join(', ')}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap', padding: '5px 2px' }}>
                  {money(unitRate)}
                </td>
                <td style={{ textAlign: 'center', verticalAlign: 'top', fontWeight: 600, padding: '5px 2px' }}>
                  {qty}
                </td>
                <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: 700, whiteSpace: 'nowrap', padding: '5px 2px' }}>
                  {money(linePaise)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 5. Summary Count Strip */}
      <div className="pos-receipt-count-bar">
        <span>Total Items: <strong>{totalStyles}</strong></span>
        <span>Total Pieces: <strong>{totalPieces}</strong></span>
      </div>

      {/* 6. Financial Breakdown */}
      <div className="pos-receipt-calc">
        <div className="pos-receipt-calc-row">
          <span>Subtotal</span>
          <b>{money(Number(s.subtotal_paise || 0))}</b>
        </div>

        {Number(s.discount_paise || 0) > 0 && (
          <div className="pos-receipt-calc-row pos-receipt-disc-row">
            <span>
              Discount Saved{s.discount_type_label ? ` (${s.discount_type_label})` : ''}
            </span>
            <b>−{money(Number(s.discount_paise))}</b>
          </div>
        )}

        {(taxPaise > 0 || gstPct > 0) && (
          <div className="pos-receipt-calc-row">
            <span>GST ({gstPct}%)</span>
            <b>+{money(taxPaise)}</b>
          </div>
        )}

        <div className="pos-receipt-grand-row">
          <span>GRAND TOTAL</span>
          <strong>{money(Number(s.total_paise || 0))}</strong>
        </div>
      </div>

      {/* 7. Clear Payment Details */}
      <div className="pos-receipt-payment-section">
        <div className="pos-receipt-sec-title">PAYMENT DETAILS</div>
        {(s.tenders || []).map((t: Row) => {
          const isCash = String(t.method || '').toLowerCase() === 'cash';
          const cashRec = Number(s.cash_received_paise || 0);
          const change = Number(s.change_paise || 0);

          return (
            <div key={t.method} className="pos-receipt-tender-block">
              <div className="pos-receipt-calc-row">
                <span>Paid via <strong>{String(t.method || '').toUpperCase()}</strong>:</span>
                <b>{money(t.amount_paise)}</b>
              </div>
              {isCash && cashRec > 0 && (
                <div className="pos-receipt-cash-sub">
                  <span>Cash Given: {money(cashRec)}</span>
                  {change > 0 ? (
                    <span> · Change Returned: {money(change)}</span>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 8. Footer */}
      <div className="pos-receipt-footer">
        <p className="pos-receipt-thankyou">Thank You! Please Visit Again!</p>
        {s.business?.receipt_footer && (
          <p className="pos-receipt-custom-note">{s.business.receipt_footer}</p>
        )}
        {!s.isDraft && (
          <small className="pos-receipt-ref-id">Ref: {s.id}</small>
        )}
      </div>
    </article>
  );
}

/** Colour chooser shown after scanning a saree that has several colours (keys 1-9, Esc to cancel). */
function PosColourPicker({ product, options, onPick, onClose }: { product: Row; options: ColourOption[]; onPick: (key: string) => void; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) { e.preventDefault(); onPick(options[n - 1].key); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [options, onPick, onClose]);
  return (
    <div className="cat-modal-backdrop" onClick={onClose} role="presentation">
      <div className="cat-modal-card" role="dialog" aria-modal="true" aria-label="Choose colour" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h2 style={{ margin: 0 }}>Which colour?</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B4F47' }}>
          {product.name} · {money(unitPrice(product as any))} · same barcode for all colours
        </p>
        <div className="pos-colour-modal-list">
          {options.map((o, i) => (
            <button key={o.key} type="button" autoFocus={i === 0} onClick={() => onPick(o.key)}>
              {o.image ? <img src={o.image} alt="" /> : o.key !== 'undef' ? <i style={{ background: o.hex || '#C49A52' }} /> : <i style={{ background: 'repeating-linear-gradient(45deg,#eee,#eee 3px,#ccc 3px,#ccc 6px)' }} />}
              <span>
                <strong>{o.key === 'undef' ? 'Undefined colour' : o.label}</strong>
                <span className="count"> · {o.free} in stock</span>
              </span>
              <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
        <button type="button" className="button outline-btn" onClick={onClose}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
