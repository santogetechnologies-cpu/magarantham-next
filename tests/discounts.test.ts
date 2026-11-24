import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDiscountChannels,
  formatDiscountName,
  isDiscountActiveInPos,
  isDiscountActiveOnline,
} from '../src/lib/discounts';
import { discountSchema } from '../src/lib/erp-schemas';

test('parseDiscountChannels parses untagged, POS-only, online-only and both channels', () => {
  // Untagged defaults to both
  const untagged = parseDiscountChannels('aniversary', true);
  assert.equal(untagged.cleanName, 'aniversary');
  assert.equal(untagged.applyInPos, true);
  assert.equal(untagged.applyOnline, true);
  assert.equal(untagged.channel, 'both');

  // Untagged inactive
  const untaggedOff = parseDiscountChannels('aniversary', false);
  assert.equal(untaggedOff.cleanName, 'aniversary');
  assert.equal(untaggedOff.applyInPos, false);
  assert.equal(untaggedOff.applyOnline, false);

  // [POS] tag
  const posOnly = parseDiscountChannels('Diwali Special [POS]', true);
  assert.equal(posOnly.cleanName, 'Diwali Special');
  assert.equal(posOnly.applyInPos, true);
  assert.equal(posOnly.applyOnline, false);
  assert.equal(posOnly.channel, 'pos');

  // [ONLINE] tag
  const onlineOnly = parseDiscountChannels('Diwali Special [ONLINE]', true);
  assert.equal(onlineOnly.cleanName, 'Diwali Special');
  assert.equal(onlineOnly.applyInPos, false);
  assert.equal(onlineOnly.applyOnline, true);
  assert.equal(onlineOnly.channel, 'online');

  // [BOTH] tag
  const bothTagged = parseDiscountChannels('Pongal Sale [BOTH]', true);
  assert.equal(bothTagged.cleanName, 'Pongal Sale');
  assert.equal(bothTagged.applyInPos, true);
  assert.equal(bothTagged.applyOnline, true);
  assert.equal(bothTagged.channel, 'both');
});

test('formatDiscountName encodes channel preferences cleanly without double tags', () => {
  // Both on -> clean name without tags
  const both = formatDiscountName('Wedding Season', true, true);
  assert.equal(both.name, 'Wedding Season');
  assert.equal(both.active, true);
  assert.equal(both.applyInPos, true);
  assert.equal(both.applyOnline, true);

  // POS only
  const pos = formatDiscountName('Wedding Season', true, false);
  assert.equal(pos.name, 'Wedding Season [POS]');
  assert.equal(pos.active, true);
  assert.equal(pos.applyInPos, true);
  assert.equal(pos.applyOnline, false);

  // Online only
  const online = formatDiscountName('Wedding Season', false, true);
  assert.equal(online.name, 'Wedding Season [ONLINE]');
  assert.equal(online.active, true);
  assert.equal(online.applyInPos, false);
  assert.equal(online.applyOnline, true);

  // Both off -> inactive
  const off = formatDiscountName('Wedding Season', false, false);
  assert.equal(off.name, 'Wedding Season');
  assert.equal(off.active, false);

  // Stripping existing tags before appending new tag
  const stripped = formatDiscountName('Wedding Season [ONLINE]', true, false);
  assert.equal(stripped.name, 'Wedding Season [POS]');
});

test('isDiscountActiveInPos and isDiscountActiveOnline enforce channel isolation', () => {
  // Untagged active applies to both
  assert.equal(isDiscountActiveInPos({ name: 'aniversary', active: true }), true);
  assert.equal(isDiscountActiveOnline({ name: 'aniversary', active: true }), true);

  // Inactive discount applies to neither
  assert.equal(isDiscountActiveInPos({ name: 'aniversary', active: false }), false);
  assert.equal(isDiscountActiveOnline({ name: 'aniversary', active: false }), false);

  // POS only discount applies only to POS
  assert.equal(isDiscountActiveInPos({ name: 'Festival [POS]', active: true }), true);
  assert.equal(isDiscountActiveOnline({ name: 'Festival [POS]', active: true }), false);

  // Online only discount applies only to online
  assert.equal(isDiscountActiveInPos({ name: 'Web Offer [ONLINE]', active: true }), false);
  assert.equal(isDiscountActiveOnline({ name: 'Web Offer [ONLINE]', active: true }), true);
});

test('discountSchema validates payloads even with extra DB metadata like created_at or channel booleans', () => {
  const validPayload = {
    name: 'Diwali Saree Dhamaka',
    scope: 'all',
    target_id: null,
    discount_bps: 1500,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: '2026-11-24T05:00:00Z',
    apply_in_pos: true,
    apply_online: false,
  };

  const parsed = discountSchema.parse(validPayload);
  assert.equal(parsed.name, 'Diwali Saree Dhamaka');
  assert.equal(parsed.active, true);
  assert.equal(parsed.discount_bps, 1500);
});
