-- 202611260021_seed_tracking_providers.sql
-- Seed default Indian courier tracking providers if none exist
insert into public.tracking_providers (name, url_template, enabled)
select v.name, v.url_template, true
from (
  values
    ('ST Courier', 'https://stcourier.com/track/shipment?awb={tracking_id}'),
    ('India Post', 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx'),
    ('DTDC', 'https://www.dtdc.in/tracking/tracking_results.asp?Ttype=awb_no&strCnno={tracking_id}'),
    ('The Professional Couriers', 'https://www.tpcindia.com/tracking.aspx?id={tracking_id}'),
    ('Blue Dart', 'https://www.bluedart.com/tracking?trackFor=0&trackNo={tracking_id}'),
    ('Delhivery', 'https://www.delhivery.com/track/package/{tracking_id}')
) as v(name, url_template)
where not exists (
  select 1 from public.tracking_providers tp where tp.name = v.name
);
