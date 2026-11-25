import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Mock 'server-only' for Node test runner before any server-only imports
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as any;
} catch {}

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Mobile phone normalization and validation for Indian and International formats', async () => {
  const { normalizePhone, isValidE164, formatPhoneForDisplay } = await import('../src/lib/phone');

  // 10-digit Indian numbers
  assert.equal(normalizePhone('9876543210', '+91'), '+919876543210');
  assert.equal(normalizePhone('98765 43210', '+91'), '+919876543210');
  assert.equal(normalizePhone('+91 98765-43210', '+91'), '+919876543210');
  assert.equal(normalizePhone('09876543210', '+91'), '+919876543210');

  // E.164 validity
  assert.equal(isValidE164('+919876543210'), true);
  assert.equal(isValidE164('9876543210'), false); // Missing leading +
  assert.equal(isValidE164('+14155552671'), true);

  // Formatting
  assert.equal(formatPhoneForDisplay('+919876543210'), '+91 98765 43210');
});

test('WhatsApp order confirmation message adheres to Magarantham Silks exact format', async () => {
  const { formatOrderConfirmationMessage } = await import('../src/lib/whatsapp');

  const sampleOrder = {
    id: '00000000-0000-0000-0000-000000000001',
    number: 10452,
    created_at: '2026-11-25T10:00:00Z',
    channel: 'razorpay' as const,
    payment_status: 'paid' as const,
    subtotal_paise: 485000,
    discount_paise: 0,
    shipping_paise: 0,
    total_paise: 485000,
    order_items: [
      {
        name: 'Kanchipuram Silk Saree',
        quantity: 1,
        unit_price_paise: 485000,
      },
    ],
  };

  const message = formatOrderConfirmationMessage(sampleOrder);

  // Required header and greeting
  assert.ok(message.includes('MAGARANTHAM SILKS'));
  assert.ok(message.includes('Dear Customer,'));
  assert.ok(message.includes('Thank you for shopping with Magarantham Silks!'));
  assert.ok(message.includes('Your order has been successfully placed.'));

  // Order Details
  assert.ok(message.includes('Order Number: MS-10452'));
  assert.ok(message.includes('Product Name: Kanchipuram Silk Saree'));
  assert.ok(message.includes('Quantity: 1'));
  assert.ok(message.includes('Price: ₹4,850'));

  // Financial breakdown
  assert.ok(message.includes('Subtotal: ₹4,850'));
  assert.ok(message.includes('Discount: ₹0'));
  assert.ok(message.includes('Delivery Charges: ₹0'));
  assert.ok(message.includes('Total Amount: ₹4,850'));

  // Payment status & attachment
  assert.ok(message.includes('Payment Status: Paid'));
  assert.ok(message.includes('Your invoice is attached below.'));
});

test('A4 PDF Invoice generator produces a valid binary PDF document', async () => {
  const { generateInvoicePdf } = await import('../src/lib/invoice');

  const sampleOrder = {
    id: '00000000-0000-0000-0000-000000000001',
    number: 10452,
    created_at: '2026-11-25T10:00:00Z',
    channel: 'razorpay' as const,
    payment_status: 'paid' as const,
    subtotal_paise: 485000,
    discount_paise: 0,
    shipping_paise: 0,
    total_paise: 485000,
    customer_phone: '+919876543210',
    address: {
      name: 'Priyadharshini',
      phone: '+91 98765 43210',
      line1: '12 Gandhi Road',
      city: 'Kanchipuram',
      state: 'Tamil Nadu',
      pin: '631501',
    },
    order_items: [
      {
        name: 'Pure Kanchipuram Silk Saree - Crimson Gold',
        quantity: 1,
        unit_price_paise: 485000,
        sku: 'MS-KANC-001',
      },
    ],
  };

  const pdfBuffer = await generateInvoicePdf(sampleOrder, {
    brand_name: 'மகரந்தம் சில்க்ஸ் - Magarantham Silks',
    support_phone: '+91 98765 43210',
    support_email: 'care@magaranthamsilks.com',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000); // Realistic PDF with vector styling

  // Verify PDF header magic bytes "%PDF-"
  const header = pdfBuffer.subarray(0, 5).toString('ascii');
  assert.equal(header, '%PDF-');
});
