import { NextResponse } from 'next/server';
import { identity, service, Fault, failure } from '@/lib/server';
import { uuid } from '@/lib/schemas';
import { getOrder } from '@/lib/store';
import { generateInvoicePdf } from '@/lib/invoice';

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const s = await identity();
    const { id } = await params;
    uuid.parse(id);

    // Verify ownership or admin access
    const isStaff = s.profile.role !== 'customer';
    const o = await getOrder(id, isStaff ? undefined : s.user.id);
    if (!o) throw new Fault(404, 'ORDER_NOT_FOUND');

    // Fetch store settings for contact info & configurable GST
    const { data: settings } = await service()
      .from('store_settings')
      .select('brand_name,support_email,support_phone,whatsapp_phone,gstin,store_address,invoice_prefix,tax_bps')
      .eq('id', true)
      .maybeSingle();

    const pdfBuffer = await generateInvoicePdf(o, settings || undefined);

    const filename = `Magarantham-Silks-Invoice-MS-${o.number}.pdf`;

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'private, no-transform, max-age=3600',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
