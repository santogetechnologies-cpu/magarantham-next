import 'server-only';
import PDFDocument from 'pdfkit';
import { money } from './core';

export interface InvoiceOrderData {
  id: string;
  number: number | string;
  created_at: string;
  channel?: string;
  payment_status?: string;
  subtotal_paise: number;
  discount_paise?: number;
  shipping_paise?: number;
  tax_paise?: number;
  total_paise: number;
  customer_phone?: string;
  address?: {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pin?: string;
  };
  order_items: Array<{
    name: string;
    quantity: number;
    unit_price_paise: number;
    line_total_paise?: number;
  }>;
}

export interface InvoiceStoreSettings {
  brand_name?: string;
  support_email?: string;
  support_phone?: string;
  whatsapp_phone?: string;
}

/**
 * Converts a number to Indian Rupees words (e.g., 4850 -> Four Thousand Eight Hundred and Fifty Rupees Only)
 */
function numberToRupeesWords(num: number): string {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ',
    'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    if (n === 0) return 'Zero ';
    let str = '';
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    const hundred = Math.floor(n / 100);
    n %= 100;

    if (crore > 0) str += inWords(crore) + 'Crore ';
    if (lakh > 0) str += inWords(lakh) + 'Lakh ';
    if (thousand > 0) str += inWords(thousand) + 'Thousand ';
    if (hundred > 0) str += inWords(hundred) + 'Hundred ';
    if (n > 0) {
      if (str !== '') str += 'and ';
      if (n < 20) str += a[n];
      else str += b[Math.floor(n / 10)] + (n % 10 > 0 ? ' ' + a[n % 10] : ' ');
    }
    return str;
  }

  const intPart = Math.floor(num);
  return `${inWords(intPart).trim()} Rupees Only`;
}

/**
 * Generates an elegant, printable A4 PDF invoice for an order.
 * Follows premium Indian saree boutique invoice styling (Maroon, Gold, clean typography).
 */
export async function generateInvoicePdf(
  order: InvoiceOrderData,
  settings?: InvoiceStoreSettings
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        info: {
          Title: `Invoice MS-${order.number}`,
          Author: 'Magarantham Silks',
          Subject: `Order Invoice MS-${order.number}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const maroon = '#6B1724';
      const gold = '#C49A52';
      const darkText = '#1F2937';
      const mutedText = '#4B5563';
      const tableBorder = '#EAD5C0';
      const tableBg = '#FAF5EE';

      const orderDate = new Date(order.created_at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      const customerPhone = order.customer_phone || order.address?.phone || '—';
      const customerName = order.address?.name || 'Valued Customer';
      const invoiceNo = `MS-INV-${order.number}`;
      const orderNo = `MS-${order.number}`;

      // 1. Header Section: Brand & Store Contacts
      doc.rect(36, 36, 523, 76).fill('#FFFDF9');
      doc.rect(36, 36, 523, 76).stroke(tableBorder);

      // Gold top accent strip
      doc.rect(36, 36, 523, 4).fill(gold);

      // Brand Title
      doc.fillColor(maroon).fontSize(20).font('Helvetica-Bold').text('MAGARANTHAM SILKS', 50, 48);
      doc.fillColor(gold).fontSize(9).font('Helvetica-Bold').text('SILKS · SAREES · CELEBRATIONS', 50, 72);
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica').text('Exclusive Pure Silk & Handloom Sarees', 50, 86);

      // Store contact info (right side)
      doc.fillColor(darkText).fontSize(8.5).font('Helvetica');
      doc.text('Tiruppur & Kanchipuram, Tamil Nadu, India', 340, 50, { align: 'right', width: 200 });
      doc.text(`Phone: ${settings?.support_phone || settings?.whatsapp_phone || '+91 98765 43210'}`, 340, 63, { align: 'right', width: 200 });
      doc.text(`Email: ${settings?.support_email || 'support@magaranthamsilks.com'}`, 340, 76, { align: 'right', width: 200 });
      doc.text('GSTIN: 33AAACM1234F1Z8', 340, 89, { align: 'right', width: 200 });

      // 2. Invoice Banner
      doc.rect(36, 122, 523, 26).fill(maroon);
      doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text('TAX INVOICE / CASH BILL', 50, 130);
      doc.fillColor('#FDE047').fontSize(9).font('Helvetica-Bold').text(`ORIGINAL FOR RECIPIENT`, 400, 131, { align: 'right', width: 140 });

      // 3. Customer Details & Invoice Metadata (Two columns)
      doc.rect(36, 154, 523, 90).fill('#FFFFFF').stroke(tableBorder);

      // Left Column: Customer & Delivery Address
      doc.fillColor(gold).fontSize(8.5).font('Helvetica-Bold').text('BILLED & DELIVERED TO:', 50, 164);
      doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text(customerName, 50, 178);
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica');
      doc.text(`Mobile: ${customerPhone}`, 50, 192);

      const addrLine1 = order.address?.line1 || '';
      const addrLine2 = order.address?.line2 ? `${order.address.line2}, ` : '';
      const addrCity = `${order.address?.city || ''}, ${order.address?.state || ''} ${order.address?.pin || ''}`;
      doc.text(`${addrLine1}`, 50, 204, { width: 250 });
      doc.text(`${addrLine2}${addrCity}`, 50, 216, { width: 250 });

      // Divider vertical line
      doc.moveTo(310, 158).lineTo(310, 240).lineWidth(0.8).stroke(tableBorder);

      // Right Column: Invoice & Payment Info
      doc.fillColor(gold).fontSize(8.5).font('Helvetica-Bold').text('ORDER INFORMATION:', 325, 164);
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica');

      doc.text('Invoice Number:', 325, 178);
      doc.fillColor(darkText).font('Helvetica-Bold').text(invoiceNo, 420, 178);

      doc.fillColor(mutedText).font('Helvetica').text('Order Number:', 325, 192);
      doc.fillColor(darkText).font('Helvetica-Bold').text(orderNo, 420, 192);

      doc.fillColor(mutedText).font('Helvetica').text('Order Date:', 325, 206);
      doc.fillColor(darkText).font('Helvetica').text(orderDate, 420, 206);

      doc.fillColor(mutedText).font('Helvetica').text('Payment Method:', 325, 220);
      doc.fillColor(maroon).font('Helvetica-Bold').text((order.channel || 'ONLINE').toUpperCase(), 420, 220);

      doc.fillColor(mutedText).font('Helvetica').text('Payment Status:', 325, 232);
      const isPaid = (order.payment_status || 'paid') === 'paid';
      doc.fillColor(isPaid ? '#166534' : '#991B1B').font('Helvetica-Bold').text((order.payment_status || 'PAID').toUpperCase(), 420, 232);

      // 4. Products Table
      let tableY = 254;

      // Table Header
      doc.rect(36, tableY, 523, 24).fill(tableBg).stroke(tableBorder);
      doc.fillColor(maroon).fontSize(8.5).font('Helvetica-Bold');
      doc.text('#', 46, tableY + 7, { width: 24, align: 'center' });
      doc.text('SARRE DESCRIPTION & ITEM DETAILS', 80, tableY + 7, { width: 260 });
      doc.text('QTY', 350, tableY + 7, { width: 40, align: 'center' });
      doc.text('PRICE (₹)', 400, tableY + 7, { width: 70, align: 'right' });
      doc.text('TOTAL (₹)', 480, tableY + 7, { width: 65, align: 'right' });

      tableY += 24;

      // Table Rows
      const items = order.order_items || [];
      items.forEach((item, index) => {
        const isOdd = index % 2 === 1;
        if (isOdd) {
          doc.rect(36, tableY, 523, 28).fill('#FFFDF9');
        }
        doc.rect(36, tableY, 523, 28).stroke(tableBorder);

        const unitRs = ((item.unit_price_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        const lineTotalRs = ((item.line_total_paise || item.quantity * item.unit_price_paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

        doc.fillColor(mutedText).fontSize(8.5).font('Helvetica').text(String(index + 1), 46, tableY + 9, { width: 24, align: 'center' });
        doc.fillColor(darkText).fontSize(9).font('Helvetica-Bold').text(item.name || 'Silk Saree', 80, tableY + 9, { width: 260, lineBreak: false });
        doc.fillColor(darkText).fontSize(9).font('Helvetica').text(String(item.quantity), 350, tableY + 9, { width: 40, align: 'center' });
        doc.fillColor(darkText).fontSize(9).font('Helvetica').text(unitRs, 400, tableY + 9, { width: 70, align: 'right' });
        doc.fillColor(maroon).fontSize(9).font('Helvetica-Bold').text(lineTotalRs, 480, tableY + 9, { width: 65, align: 'right' });

        tableY += 28;
      });

      // 5. Total Calculations & Breakdown
      tableY += 6;
      const discountPaise = order.discount_paise || 0;
      const shippingPaise = order.shipping_paise || 0;
      const subtotalRs = (order.subtotal_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const discountRs = (discountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const shippingRs = shippingPaise > 0
        ? `₹${(shippingPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        : 'FREE (Complimentary)';
      const finalAmountRs = (order.total_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

      // Left Box: Amount in words & Bank Seal
      doc.rect(36, tableY, 300, 110).fill('#FAFAF9').stroke(tableBorder);
      doc.fillColor(gold).fontSize(8).font('Helvetica-Bold').text('TOTAL AMOUNT IN WORDS:', 46, tableY + 12);
      doc.fillColor(darkText).fontSize(9.5).font('Helvetica-Bold')
        .text(numberToRupeesWords(order.total_paise / 100), 46, tableY + 26, { width: 280 });

      doc.fillColor(mutedText).fontSize(8).font('Helvetica')
        .text('• Pure Silk authenticity guaranteed by Magarantham Silks.', 46, tableY + 66)
        .text('• Dry clean pure silk garments only.', 46, tableY + 78)
        .text('• Goods once sold may be exchanged within 7 days with tag intact.', 46, tableY + 90);

      // Right Box: Detailed Breakdown
      doc.rect(342, tableY, 217, 110).fill('#FFFFFF').stroke(tableBorder);

      let sumRowY = tableY + 10;
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica').text('Subtotal:', 354, sumRowY);
      doc.fillColor(darkText).fontSize(8.5).font('Helvetica').text(`₹${subtotalRs}`, 440, sumRowY, { align: 'right', width: 105 });

      if (discountPaise > 0) {
        sumRowY += 16;
        doc.fillColor('#166534').fontSize(8.5).font('Helvetica').text('Discount:', 354, sumRowY);
        doc.text(`-₹${discountRs}`, 440, sumRowY, { align: 'right', width: 105 });
      }

      sumRowY += 16;
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica').text('Delivery Charges:', 354, sumRowY);
      doc.fillColor(darkText).fontSize(8.5).font('Helvetica').text(shippingRs, 440, sumRowY, { align: 'right', width: 105 });

      sumRowY += 16;
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica').text('Tax (GST Included):', 354, sumRowY);
      doc.fillColor(darkText).fontSize(8.5).font('Helvetica').text('Included in price', 440, sumRowY, { align: 'right', width: 105 });

      // Final Total Box
      sumRowY += 18;
      doc.rect(342, sumRowY, 217, 28).fill(maroon);
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('FINAL AMOUNT:', 354, sumRowY + 8);
      doc.fillColor('#FDE047').fontSize(12).font('Helvetica-Bold').text(`₹${finalAmountRs}`, 430, sumRowY + 7, { align: 'right', width: 115 });

      // 6. Signatures & Footer
      const footerY = tableY + 124;
      doc.rect(36, footerY, 523, 50).fill('#FFFDF9').stroke(tableBorder);

      doc.fillColor(mutedText).fontSize(8).font('Helvetica')
        .text('Thank you for shopping at Magarantham Silks! We cherish being part of your celebrations.', 50, footerY + 12, { align: 'center', width: 495 });

      doc.fillColor(gold).fontSize(7.5).font('Helvetica-Bold')
        .text('MAGARANTHAM SILKS · REGISTERED HANDLOOM SILK HOUSE · COMPUTER GENERATED INVOICE', 50, footerY + 28, { align: 'center', width: 495 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
