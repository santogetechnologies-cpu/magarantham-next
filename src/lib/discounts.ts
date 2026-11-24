export type DiscountChannel = 'both' | 'pos' | 'online';

export interface DiscountChannelInfo {
  cleanName: string;
  applyInPos: boolean;
  applyOnline: boolean;
  channel: DiscountChannel;
}

/**
 * Extracts the user-facing clean name and channel permissions from a discount row.
 * Channel tags supported in name:
 * - [POS]     -> Counter billing only
 * - [ONLINE]  -> Online storefront & checkout only
 * - [BOTH]    -> Both channels (default when untagged)
 */
export function parseDiscountChannels(name = '', active = true): DiscountChannelInfo {
  const trimmed = String(name || '').trim();
  const match = trimmed.match(/\s*\[(POS|ONLINE|BOTH)\]\s*$/i);

  if (!match) {
    return {
      cleanName: trimmed,
      applyInPos: active,
      applyOnline: active,
      channel: 'both',
    };
  }

  const tag = match[1].toUpperCase();
  const cleanName = trimmed.slice(0, match.index).trim();

  if (tag === 'POS') {
    return {
      cleanName,
      applyInPos: active,
      applyOnline: false,
      channel: 'pos',
    };
  }
  if (tag === 'ONLINE') {
    return {
      cleanName,
      applyInPos: false,
      applyOnline: active,
      channel: 'online',
    };
  }
  return {
    cleanName,
    applyInPos: active,
    applyOnline: active,
    channel: 'both',
  };
}

/**
 * Formats the clean name and channel preferences into stored record fields.
 */
export function formatDiscountName(
  cleanName: string,
  applyInPos: boolean,
  applyOnline: boolean
): { name: string; active: boolean; applyInPos: boolean; applyOnline: boolean } {
  const base = String(cleanName || '')
    .replace(/\s*\[(POS|ONLINE|BOTH)\]\s*$/i, '')
    .trim();

  if (!applyInPos && !applyOnline) {
    return { name: base, active: false, applyInPos: false, applyOnline: false };
  }
  if (applyInPos && applyOnline) {
    return { name: base, active: true, applyInPos: true, applyOnline: true };
  }
  if (applyInPos && !applyOnline) {
    return { name: `${base} [POS]`, active: true, applyInPos: true, applyOnline: false };
  }
  return { name: `${base} [ONLINE]`, active: true, applyInPos: false, applyOnline: true };
}

/**
 * Checks whether a discount applies to POS counter billing.
 */
export function isDiscountActiveInPos(discount: { name?: string; active?: boolean }): boolean {
  if (!discount || discount.active === false) return false;
  const name = String(discount.name || '').toUpperCase();
  if (name.includes('[ONLINE]')) return false;
  return true;
}

/**
 * Checks whether a discount applies to the online website / storefront.
 */
export function isDiscountActiveOnline(discount: { name?: string; active?: boolean }): boolean {
  if (!discount || discount.active === false) return false;
  const name = String(discount.name || '').toUpperCase();
  if (name.includes('[POS]')) return false;
  return true;
}
