'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Profile, money, unitPrice } from '@/lib/core';
import { api } from '../api';
import { Row, useERP } from './shared';

type CartLine = {
  product_id: string;
  quantity: number;
  unit_ids: string[];
};

type PayMode = 'cash' | 'upi' | 'card' | 'split';

type LastScanned = {
  name: string;
  sku: string;
  code: string;
  price_paise: number;
  isUnit: boolean;
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
  } catch {}
}

export function POS({ profile }: { profile: Profile }) {
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Row>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
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
  const [gstInput, setGstInput] = useState('0');

  const { busy, send, notice } = useERP();
  const scannerRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLElement>(null);
  const quoteVersion = useRef(0);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gstEditingRef = useRef(false);

  async function load() {
    try {
      const data = await api<Row>('/api/erp/pos');
      setCatalog(data.products || []);
      const nextSettings = data.settings || {};
      setSettings(nextSettings);
      if (!gstEditingRef.current) {
        setGstInput(String(Math.round(Number(nextSettings.tax_bps || 0) / 100)));
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
      api<Row>('/api/erp/pos_quote', { cart, discount_paise: discount })
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
    if (digitsOnly === '') {
      setGstInput('');
      if (gstTimerRef.current) clearTimeout(gstTimerRef.current);
      gstTimerRef.current = setTimeout(() => {
        void updateGstRate(0, true);
      }, 300);
      return;
    }
    const clamped = Math.min(100, parseInt(digitsOnly, 10) || 0);
    setGstInput(String(clamped));
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

  function add(product: Row, unit?: Row, scannedCode?: string) {
    setCatalog((old) => (old.some((p) => p.id === product.id) ? old : [product, ...old]));
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
        },
      ];
    });

    if (added || scannedCode) {
      const price = unitPrice(product as any);
      setLastScanned({
        name: product.name,
        sku: product.sku || '',
        code: scannedCode || unit?.barcode || product.barcode || product.sku || '',
        price_paise: price,
        isUnit: Boolean(unit),
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

  async function scan(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanning(true);

    // 1. Instant local catalog match for zero-latency scanning
    const lower = trimmed.toLowerCase();
    const localProd = catalog.find((p) => {
      if (p.barcode && p.barcode.toLowerCase() === lower) return true;
      if (p.sku && p.sku.toLowerCase() === lower) return true;
      if (Array.isArray(p.pieces)) {
        return p.pieces.some(
          (pc: any) =>
            (pc.piece_code && pc.piece_code.toLowerCase() === lower) ||
            (pc.barcode && pc.barcode.toLowerCase() === lower) ||
            (pc.id && pc.id.toLowerCase() === lower),
        );
      }
      return false;
    });

    if (localProd) {
      playScanBeep(true);
      const isPieceCode =
        Array.isArray(localProd.pieces) &&
        localProd.pieces.some(
          (pc: any) =>
            (pc.piece_code && pc.piece_code.toLowerCase() === lower) ||
            (pc.barcode && pc.barcode.toLowerCase() === lower) ||
            (pc.id && pc.id.toLowerCase() === lower),
        );
      if (isPieceCode) rememberPiece(localProd.id, trimmed);
      add(localProd, undefined, trimmed);
      setBarcodeInput('');
      scannerRef.current?.focus();
      setScanning(false);
      return;
    }

    // 2. Authoritative backend scan lookup (supports serialized units, pieces, barcodes, SKUs)
    try {
      const r = await api<Row>(`/api/erp/scan?barcode=${encodeURIComponent(trimmed)}`);
      playScanBeep(true);
      if (r.product?.piece) rememberPiece(r.product.id, String(r.product.piece.id || trimmed));
      add(r.product, r.unit || undefined, trimmed);
      setBarcodeInput('');
      scannerRef.current?.focus();
    } catch (e) {
      playScanBeep(false);
      notice((e as Error).message || `Barcode or code "${trimmed}" was not found.`);
      scannerRef.current?.select();
    } finally {
      setScanning(false);
    }
  }

  async function openBill(
    id: string,
    triggerPrint = false,
    extraMeta?: { discount_type_label?: string },
  ) {
    try {
      const r = await api<Row>(`/api/erp/pos_sale?id=${id}`);
      if (!r.rows[0]) throw new Error('Bill not found.');
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

  function updateQty(productId: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((old) => old.filter((l) => l.product_id !== productId));
      return;
    }
    const prod = catalog.find((p) => p.id === productId);
    const maxAvail = Math.min(100, Math.max(1, Number(prod?.available ?? 100)));
    if (nextQty > maxAvail && maxAvail < 100) {
      notice(`Only ${maxAvail} piece${maxAvail === 1 ? '' : 's'} available in stock.`);
    }
    setCart((old) =>
      old.map((l) =>
        l.product_id === productId
          ? { ...l, quantity: Math.max(1, Math.min(maxAvail, nextQty)) }
          : l,
      ),
    );
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
    setPayMode('cash');
    setTenders({ cash: 0, upi: 0, card: 0 });
    setCashReceived(0);
    setCashReceivedEdited(false);
    setLastScanned(null);
    scannerRef.current?.focus();
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

  const filtered = catalog.filter((p) => {
    const catMatch = !category || p.category_id === category || p.subcategory_id === category;
    if (!catMatch) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const piecesText = Array.isArray(p.pieces)
      ? p.pieces.map((pc: any) => `${pc.piece_code || ''} ${pc.barcode || ''} ${pc.colour || ''}`).join(' ')
      : '';
    const searchable = `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''} ${p.subcategory_name || ''} ${p.colour || ''} ${p.fabric || ''} ${piecesText}`.toLowerCase();
    return searchable.includes(q);
  });

  const categories = [
    ...new Map(
      catalog
        .flatMap((p) => [
          { id: p.category_id, name: p.category },
          { id: p.subcategory_id, name: `${p.category} / ${p.subcategory_name}` },
        ])
        .filter((c) => c.id)
        .map((c) => [c.id, c]),
    ).values(),
  ];

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
    const itemsHtml = (s.items || [])
      .map(
        (i: Row) =>
          `<tr><td><strong>${esc(i.name)}</strong><br/><small>${esc(i.sku)} · ${esc(money(i.unit_paise))}</small></td><td style="text-align:center">${esc(i.quantity)}</td><td style="text-align:right">${esc(money(i.line_paise))}</td></tr>`,
      )
      .join('');
    const tendersHtml = (s.tenders || [])
      .map(
        (t: Row) =>
          `<div class="row"><span>Payment (${esc(String(t.method || '').toUpperCase())})</span><span>${esc(money(t.amount_paise))}</span></div>`,
      )
      .join('');
    const discLabel = s.discount_type_label ? ` (${esc(s.discount_type_label)})` : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(s.invoice_no || 'POS-Invoice')}</title><style>@page{margin:12mm;}body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:420px;margin:0 auto;padding:12px;font-size:13px;line-height:1.5;}h1{font-family:Georgia,serif;font-size:20px;text-align:center;margin:0 0 2px;color:#650019;}.sub{text-align:center;font-size:11px;letter-spacing:1px;font-weight:700;margin-bottom:6px;}.meta{text-align:center;font-size:12px;color:#444;margin-bottom:10px;}.badge{text-align:center;font-weight:700;border-top:1px dashed #999;border-bottom:1px dashed #999;padding:5px 0;margin:8px 0;letter-spacing:1px;font-size:12px;}table{width:100%;border-collapse:collapse;margin:8px 0;}th,td{padding:6px 4px;border-bottom:1px solid #eee;font-size:12px;text-align:left;}th{font-size:11px;text-transform:uppercase;color:#666;}.div{border-top:1px dashed #999;margin:8px 0;}.row{display:flex;justify-content:space-between;padding:3px 0;}.grand{font-size:16px;font-weight:700;color:#650019;}.disc{color:#15803D;}.foot{text-align:center;margin-top:14px;font-size:11px;color:#555;}</style></head><body><h1>${esc(s.business?.business_name || 'மகரந்தம் சில்க்ஸ்')}</h1><div class="sub">${esc(s.business?.business_english || 'MAGARANTHAM SILKS')}</div><div class="meta">${s.business?.address ? `${esc(s.business.address)}<br/>` : ''}${s.business?.phone ? `Ph: ${esc(s.business.phone)}<br/>` : ''}${s.business?.gstin ? `<strong>GSTIN: ${esc(s.business.gstin)}</strong><br/>` : ''}<strong>${esc(s.invoice_no)}</strong> · ${esc(new Date(s.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}<br/>${esc(s.customer_name || 'Walk-in customer')} ${esc(s.customer_phone || '')}</div><div class="badge">${s.isDraft ? 'BILL PREVIEW' : taxPaise > 0 || gstPct > 0 ? 'TAX INVOICE (GST)' : 'RETAIL INVOICE'}</div><table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table><div class="div"></div><div class="row"><span>Subtotal</span><b>${esc(money(Number(s.subtotal_paise || 0)))}</b></div>${Number(s.discount_paise || 0) > 0 ? `<div class="row disc"><span>Discount${discLabel}</span><b>−${esc(money(Number(s.discount_paise)))}</b></div>` : ''}<div class="row"><span>GST (${gstPct}%)</span><b>${esc(money(taxPaise))}</b></div><div class="div"></div><div class="row grand"><span>GRAND TOTAL</span><span>${esc(money(Number(s.total_paise || 0)))}</span></div><div class="div"></div>${tendersHtml}${Number(s.cash_received_paise || 0) > 0 || Number(s.change_paise || 0) > 0 ? `<div class="row"><span>Cash Received</span><b>${esc(money(Number(s.cash_received_paise || 0)))}</b></div><div class="row"><span>Change Returned</span><b>${esc(money(Number(s.change_paise || 0)))}</b></div>` : ''}<div class="foot">${esc(s.business?.receipt_footer || 'Thank you. Please keep your bill.')}${!s.isDraft ? `<br/>Ref: ${esc(s.id)}` : ''}</div></body></html>`;

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

      {/* Prominent Barcode Scanner Bar */}
      <form
        className="pos-scanner-banner"
        onSubmit={(e) => {
          e.preventDefault();
          void scan(barcodeInput);
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
        <div className="pos-scanner-input-wrap">
          <label htmlFor="pos-barcode-input" className="pos-scanner-label">
            Barcode Scanner — Scan piece code (KAN-PUR-001), barcode, or type SKU &amp;
            press Enter (Adds to bill automatically)
          </label>
          <input
            id="pos-barcode-input"
            ref={scannerRef}
            name="barcode"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            autoComplete="off"
            placeholder="Scan barcode here or type SKU / piece code (e.g. KAN-PUR-001, MSU1001, KS-001)..."
            className="pos-scanner-input"
          />
        </div>
        <button
          type="submit"
          className="button gold-btn pos-scan-submit"
          disabled={scanning || !barcodeInput.trim()}
        >
          {scanning ? 'Scanning…' : '+ Add Scanned Item'}
        </button>
      </form>

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
        </div>
      )}

      {/* Main 2-Column POS Workspace */}
      <div className="pos-workspace-grid">
        {/* LEFT COLUMN: Saree Catalogue */}
        <section className="pos-catalogue-panel">
          <div className="pos-panel-header">
            <div>
              <h2 className="pos-panel-title">Saree Catalogue</h2>
              <p className="pos-panel-subtitle">
                Tap any saree to add it to the bill with live pricing
              </p>
            </div>
            <span className="pos-count-pill">{filtered.length} styles</span>
          </div>

          <div className="pos-filter-bar">
            <div className="pos-search-box">
              <span className="pos-search-icon">🔍</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by saree name, SKU, or barcode..."
                className="pos-search-input"
              />
              {search && (
                <button
                  type="button"
                  className="pos-search-clear-btn"
                  onClick={() => setSearch("")}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="pos-category-select"
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {filtered.length > 0 ? (
            <div className="pos-catalogue-grid">
              {filtered.map((p) => {
                const sellPaise = unitPrice(p as any);
                const origPaise = Number(p.price_paise || 0);
                const hasDiscount = sellPaise < origPaise;
                const outOfStock = Number(p.available || 0) < 1 || origPaise <= 0;
                const inCartQty =
                  cart.find((l) => l.product_id === p.id)?.quantity || 0;

                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pos-saree-card ${inCartQty > 0 ? 'in-bill' : ''} ${outOfStock ? 'is-disabled' : ''
                      }`}
                    disabled={outOfStock}
                    onClick={() => add(p)}
                  >
                    <div className="pos-saree-thumb-wrap">
                      <img
                        src={p.image_path || '/assets/brand-logo.png'}
                        alt={p.name}
                        className="pos-saree-thumb"
                      />
                      {inCartQty > 0 && (
                        <span className="pos-in-bill-pill">{inCartQty} in bill</span>
                      )}
                      <span
                        className={`pos-stock-tag ${outOfStock
                          ? 'out'
                          : Number(p.available) <= 3
                            ? 'low'
                            : 'ok'
                          }`}
                      >
                        {outOfStock ? 'Out of stock' : `${p.available} left`}
                      </span>
                    </div>

                    <div className="pos-saree-info">
                      <span className="pos-saree-name">{p.name}</span>
                      <span className="pos-saree-sku">
                        {p.sku}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                      </span>
                      <div className="pos-saree-price-row">
                        <strong className="pos-saree-price">
                          {money(sellPaise)}
                        </strong>
                        {hasDiscount && (
                          <span className="pos-saree-mrp">
                            {money(origPaise)}
                          </span>
                        )}
                        <span className="pos-add-chip">+ Add</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="pos-empty-catalogue">
              <p>
                {catalog.length === 0
                  ? 'No published sarees with stock found in catalogue yet.'
                  : 'No sarees match your search or category filter.'}
              </p>
              {catalog.length === 0 &&
                (profile.role === 'superadmin' ||
                  (profile.role === 'manager' &&
                    profile.permissions.includes('catalogue'))) && (
                  <Link href="/admin/products?action=new" className="button mini-btn">
                    + Add Saree in Catalogue
                  </Link>
                )}
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: Current Bill & Checkout Counter */}
        <section className="pos-bill-panel">
          <div className="pos-bill-header">
            <div>
              <h2 className="pos-panel-title">Current Bill</h2>
              <p className="pos-panel-subtitle">
                {totalPieces === 0
                  ? 'Scan a barcode or tap a saree to begin'
                  : `${cart.length} ${cart.length === 1 ? 'style' : 'styles'} · ${totalPieces} ${totalPieces === 1 ? 'piece' : 'pieces'}`}
              </p>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                className="pos-clear-btn"
                disabled={busy}
                onClick={clearBill}
              >
                Clear Bill
              </button>
            )}
          </div>

          {/* Itemized Bill Lines WITH Live Unit Price & Line Total */}
          <div className="pos-bill-items">
            {cart.length > 0 ? (
              cart.map((line) => {
                const p = catalog.find((item) => item.id === line.product_id);
                const eachPaise = p ? unitPrice(p as any) : 0;
                const lineTotalPaise = eachPaise * line.quantity;
                const isSerialized = line.unit_ids.length > 0;
                const spotPct = Number(lineSpot[line.product_id] || 0);
                const spotPaise = Math.round((lineTotalPaise * spotPct) / 100);

                return (
                  <div className="pos-bill-item-row" key={line.product_id}>
                    <img
                      src={p?.image_path || '/assets/brand-logo.png'}
                      alt={p?.name || 'Saree'}
                      className="pos-bill-item-thumb"
                    />
                    <div className="pos-bill-item-meta">
                      <strong className="pos-bill-item-name">
                        {p?.name || line.product_id}
                      </strong>
                      <div className="pos-bill-item-sub">
                        <span>{money(eachPaise)} each</span>
                        <span>·</span>
                        <span>
                          {isSerialized
                            ? `${line.unit_ids.length} scanned sticker${line.unit_ids.length > 1 ? 's' : ''}`
                            : p?.sku || 'Qty'}
                        </span>
                      </div>
                    </div>

                    <div className="pos-spot-wrap">
                      <button
                        type="button"
                        className={`pos-spot-btn ${spotPct > 0 ? 'on' : ''}`}
                        onClick={() => setSpotOpen(spotOpen === line.product_id ? null : line.product_id)}
                        title="Give a spot discount on this saree"
                      >
                        {spotPct > 0 ? `−${spotPct}%` : 'Spot %'}
                      </button>
                      {spotOpen === line.product_id && (
                        <div className="pos-spot-pop" role="dialog" aria-label="Spot discount">
                          <span>Spot discount on this saree</span>
                          <div className="ms-chips">
                            {[0, 5, 10, 15, 20, 25].map((v) => (
                              <button
                                type="button"
                                key={v}
                                className={`ms-chip ${spotPct === v ? 'on' : ''}`}
                                onClick={() => {
                                  setLineSpot((o) => ({ ...o, [line.product_id]: v }));
                                  setSpotOpen(null);
                                }}
                              >
                                {v === 0 ? 'None' : `${v}%`}
                              </button>
                            ))}
                          </div>
                          <label className="pos-spot-custom">
                            Custom
                            <input
                              type="number"
                              min={0}
                              max={90}
                              step={0.5}
                              value={spotPct || ''}
                              placeholder="%"
                              onChange={(e) =>
                                setLineSpot((o) => ({ ...o, [line.product_id]: Math.max(0, Math.min(90, Number(e.target.value) || 0)) }))
                              }
                            />
                            %
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="pos-qty-stepper">
                      <button
                        type="button"
                        className="pos-qty-btn"
                        disabled={isSerialized}
                        onClick={() => updateQty(line.product_id, line.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={line.quantity}
                        disabled={isSerialized}
                        onChange={(e) =>
                          updateQty(line.product_id, Number(e.target.value))
                        }
                        className="pos-qty-input"
                        aria-label="Quantity"
                      />
                      <button
                        type="button"
                        className="pos-qty-btn"
                        disabled={isSerialized || line.quantity >= 100}
                        onClick={() => updateQty(line.product_id, line.quantity + 1)}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <div className="pos-bill-item-total">
                      {spotPaise > 0 ? (
                        <span className="pos-line-price">
                          <s>{money(lineTotalPaise)}</s>
                          <strong>{money(lineTotalPaise - spotPaise)}</strong>
                        </span>
                      ) : (
                        <strong>{money(lineTotalPaise)}</strong>
                      )}
                      <button
                        type="button"
                        className="pos-remove-item-btn"
                        onClick={() =>
                          setCart((old) =>
                            old.filter((l) => l.product_id !== line.product_id),
                          )
                        }
                        title="Remove item"
                        aria-label={`Remove ${p?.name || 'item'}`}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="pos-bill-empty">
                <div className="pos-bill-empty-icon">🧾</div>
                <p>No items in bill yet</p>
                <small>
                  Scan a barcode above or select sarees from the catalogue on the left.
                  Prices and totals calculate automatically.
                </small>
              </div>
            )}
          </div>

          {/* Checkout Form */}
          <form
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
                cart,
                customer: {
                  name: customerName.trim(),
                  phone: customerPhone.trim(),
                  discount_reason: serverDiscountReason,
                },
                discount_paise: discount,
                tenders: paymentLines,
                cash_received_paise: cashReceived,
                bank_checked: f.get('bank_checked') === 'on',
                piece_ids: Object.fromEntries(
                  cart
                    .filter((l) => scannedPieces[l.product_id]?.length)
                    .map((l) => [l.product_id, scannedPieces[l.product_id]]),
                ),
              });

              if (result) {
                clearBill();
                form.reset();
                await load();
                await loadBills();
                await openBill(String(result.id), autoPrint, {
                  discount_type_label: savedDiscountLabel,
                });
              }
            }}
          >
            {/* Customer Info (Compact 2-Column) */}
            <div className="pos-section-block">
              <span className="pos-block-title">Customer Details (Optional)</span>
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
                  <span>Mobile Number</span>
                  <input
                    name="customer_phone"
                    maxLength={25}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </label>
              </div>
            </div>

            {/* Manual Discount Section */}
            <div className="pos-section-block">
              <div className="pos-discount-head">
                <label htmlFor="pos-manual-discount-input" className="pos-block-title" style={{ margin: 0 }}>
                  Discount
                </label>
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
                {[5, 10, 15].map((v) => (
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
                {[10, 100].map((step) => {
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

            {quoteError && !discountError && (
              <div role="alert" className="modal-error-banner">
                {quoteError}
              </div>
            )}

            {/* Manual Whole-Number GST (%) Input + Bill Summary Card */}
            <div className="pos-gst-bar">
              <label htmlFor="pos-gst-pct-input" className="pos-block-title" style={{ margin: 0 }}>
                GST (%)
              </label>
              {profile.role === 'superadmin' ? (
                <div className="pos-gst-input-wrap">
                  <input
                    id="pos-gst-pct-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={3}
                    value={gstInput}
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
                      setGstInput(String(normalized));
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
                  />
                  <span className="pos-gst-suffix">%</span>
                </div>
              ) : (
                <span className="pos-meta-chip">
                  GST: <strong>{Math.round(Number(settings.tax_bps || 0) / 100)}%</strong>
                </span>
              )}
            </div>

            {activeTotals && (
              <div className="pos-summary-card">
                <span className="pos-summary-eyebrow">Bill Summary</span>
                <div className="pos-summary-line">
                  <span>Subtotal ({totalPieces} pcs)</span>
                  <strong>{money(Number(activeTotals.subtotal_paise || 0))}</strong>
                </div>
                {Number(activeTotals.offer_discount_paise || 0) > 0 && (
                  <div className="pos-summary-line discount pos-offer-line">
                    <span>Festival offer{activeTotals.offer_title ? ` · ${activeTotals.offer_title}` : ''}</span>
                    <strong>−{money(Number(activeTotals.offer_discount_paise))}</strong>
                  </div>
                )}
                <div className={`pos-summary-line ${Number(activeTotals.discount_paise || 0) > 0 ? 'discount' : ''}`}>
                  <span>
                    Counter discount{discountTypeLabel ? ` (${discountTypeLabel})` : ''}
                  </span>
                  <strong>
                    {Number(activeTotals.discount_paise || 0) > 0
                      ? `−${money(Number(activeTotals.discount_paise))}`
                      : money(0)}
                  </strong>
                </div>
                <div className="pos-summary-line">
                  <span>GST ({parsedGstPct}%)</span>
                  <strong>{money(Number(activeTotals.tax_paise || 0))}</strong>
                </div>
                <div className="pos-summary-grand">
                  <span>Grand Total</span>
                  <strong>{money(total)}</strong>
                </div>
              </div>
            )}

            {/* Payment Method Selector */}
            <div className="pos-section-block">
              <span className="pos-block-title">Payment Mode</span>
              <div className="pos-paymode-grid">
                {(
                  [
                    ['cash', '💵 Cash'],
                    ['upi', '📱 UPI'],
                    ['card', '💳 Card'],
                    ['split', '⇄ Split'],
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

              {/* Split Payment Inputs */}
              {payMode === 'split' && (
                <div className="pos-split-box">
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
                    className={`pos-remaining-pill ${remainingPaise === 0 ? 'balanced' : 'unbalanced'
                      }`}
                  >
                    <span>Remaining to allocate:</span>
                    <strong>{money(remainingPaise)}</strong>
                  </div>
                </div>
              )}

              {/* Cash Received & Change Return Calculator */}
              {(payMode === 'cash' || (payMode === 'split' && cashDuePaise > 0)) && (
                <div className="pos-cash-box">
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

                  {/* Large Bold Change to Return / Balance Due Highlight Box */}
                  <div
                    className={`pos-change-banner ${cashShortfallPaise > 0 ? 'is-due' : 'is-change'
                      }`}
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

                  {/* Live Cash Breakdown Summary */}
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

              {/* UPI & Card Reference Inputs */}
              {Number(tenders.upi) > 0 && (
                <label className="input-group">
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

              {Number(tenders.card) > 0 && (
                <label className="input-group">
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
                <label className="checkbox-item pos-verify-check">
                  <input name="bank_checked" type="checkbox" required />
                  <span>
                    I verified the exact UPI/Card amount on the merchant terminal.
                  </span>
                </label>
              )}
            </div>

            <label className="checkbox-item pos-autoprint-row">
              <input
                type="checkbox"
                checked={autoPrint}
                onChange={(e) => setAutoPrint(e.target.checked)}
              />
              <span>Auto-open print dialog after completing bill</span>
            </label>

            <div className="pos-action-row">
              <button
                type="button"
                className="button outline-btn pos-print-draft-btn"
                disabled={cart.length === 0 || busy}
                onClick={printDraftBill}
              >
                🖨 Print Bill
              </button>
              <button
                type="submit"
                className="button gold-btn pos-complete-btn"
                disabled={!canComplete}
              >
                {busy
                  ? 'Saving Bill & Updating Stock…'
                  : total > 0
                    ? autoPrint
                      ? `Complete & Print · ${money(total)}`
                      : `Complete Bill · ${money(total)}`
                    : 'Complete Bill & Save Stock'}
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
          <table className="luxury-table pos-bills-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Sarees Bought</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Return</th>
                <th>Action</th>
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
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--erp-maroon)' }}>
                            {b.invoice_no}
                          </strong>
                          <span
                            className={`pill-status ${b.status === 'completed' ? 'status-paid' : 'status-pending'}`}
                            style={{ fontSize: 10, padding: '1px 7px' }}
                          >
                            {b.status}
                          </span>
                        </div>
                        <small style={{ display: 'block', color: 'var(--erp-text-muted)', marginTop: 2 }}>
                          {new Date(b.created_at).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </small>
                      </td>
                      <td>
                        <strong>{b.customer_name || 'Walk-in Customer'}</strong>
                        {b.customer_phone && (
                          <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                            {b.customer_phone}
                          </small>
                        )}
                      </td>
                      <td>
                        {billItems.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {billItems.map((it: Row, idx: number) => (
                              <span key={`${it.product_id || idx}-${idx}`} style={{ fontSize: 13 }}>
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
                      <td className="money-cell">
                        {money(b.total_paise)}
                        {Number(b.discount_paise || 0) > 0 && (
                          <small
                            style={{
                              display: 'block',
                              fontWeight: 600,
                              color: '#15803D',
                            }}
                          >
                            Disc: −{money(Number(b.discount_paise))}
                          </small>
                        )}
                      </td>
                      <td className="money-cell">
                        <strong>{money(totalPaidPaise)}</strong>
                        <small
                          style={{
                            display: 'block',
                            fontWeight: 600,
                            color: 'var(--erp-text-muted)',
                          }}
                        >
                          {payMethodsLabel}
                        </small>
                      </td>
                      <td className="money-cell">
                        {changeReturnedPaise > 0 ? (
                          <strong style={{ color: '#15803D' }}>
                            {money(changeReturnedPaise)}
                          </strong>
                        ) : (
                          <span style={{ color: 'var(--erp-text-muted)' }}>0 Rs</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

  return (
    <article
      className="erp-print pos-receipt"
      style={{ width: `${s.business?.paper_mm || 80}mm` }}
    >
      <h2>{s.business?.business_name || 'மகரந்தம் சில்க்ஸ்'}</h2>
      <b>{s.business?.business_english || 'MAGARANTHAM SILKS'}</b>
      <p>
        {s.business?.address ? (
          <>
            {s.business.address}
            <br />
          </>
        ) : null}
        {s.business?.phone ? (
          <>
            Ph: {s.business.phone}
            <br />
          </>
        ) : null}
        {s.business?.gstin ? (
          <>
            <strong>GSTIN: {s.business.gstin}</strong>
          </>
        ) : null}
      </p>
      <div className="receipt-doc-title">
        {s.isDraft
          ? 'BILL PREVIEW (NOT SAVED)'
          : taxPaise > 0 || gstPct > 0
            ? 'TAX INVOICE (GST)'
            : 'RETAIL BILL'}
      </div>
      <h3>{s.invoice_no}</h3>
      <p>
        {new Date(s.created_at).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
        })}
        <br />
        {s.customer_name || 'Walk-in customer'} {s.customer_phone}
      </p>
      {s.status === 'returned' && <strong>FULL RETURN RECORDED</strong>}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((i: Row) => (
            <tr key={i.product_id}>
              <td>
                {i.name}
                <small>
                  {i.sku} · {money(i.unit_paise)}
                </small>
              </td>
              <td>{i.quantity}</td>
              <td>{money(i.line_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="receipt-divider" />
      <div className="receipt-total">
        <span>Subtotal</span>
        <b>{money(Number(s.subtotal_paise || 0))}</b>
      </div>
      {Number(s.discount_paise || 0) > 0 && (
        <div className="receipt-total">
          <span>
            Discount{s.discount_type_label ? ` (${s.discount_type_label})` : ''}
          </span>
          <b>−{money(Number(s.discount_paise))}</b>
        </div>
      )}
      {taxPaise > 0 || gstPct > 0 ? (
        <div className="receipt-total">
          <span>GST ({gstPct}%)</span>
          <b>{money(taxPaise)}</b>
        </div>
      ) : null}
      <div className="receipt-divider" />
      <div className="receipt-total receipt-grand">
        <span>GRAND TOTAL</span>
        <b>{money(Number(s.total_paise || 0))}</b>
      </div>
      <div className="receipt-divider" />
      {s.tenders.map((t: Row) => (
        <div className="receipt-total" key={t.method}>
          <span>{t.method.toUpperCase()}</span>
          <span>{money(t.amount_paise)}</span>
        </div>
      ))}
      {(Number(s.cash_received_paise || 0) > 0 ||
        Number(s.change_paise || 0) > 0) && (
          <>
            <div className="receipt-total">
              <span>Cash Received</span>
              <b>{money(Number(s.cash_received_paise || 0))}</b>
            </div>
            <div className="receipt-total">
              <span>Change Returned</span>
              <b>{money(Number(s.change_paise || 0))}</b>
            </div>
          </>
        )}
      <p style={{ marginTop: 10 }}>{s.business?.receipt_footer}</p>
      {!s.isDraft && <small>Digital bill reference: {s.id}</small>}
    </article>
  );
}
