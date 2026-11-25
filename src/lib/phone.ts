/**
 * Phone number normalization, country codes, and validation utilities
 * for Magarantham Silks mobile authentication and WhatsApp notifications.
 */

export interface CountryCode {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
}

export const SUPPORTED_COUNTRY_CODES: CountryCode[] = [
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', flag: '🇰🇼' },
  { code: 'OM', name: 'Oman', dialCode: '+968', flag: '🇴🇲' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
];

/**
 * Normalizes an input phone string and country dial code into E.164 format.
 * Defaults to India (+91) if dial code is not supplied.
 * Example: ("9876543210", "+91") => "+919876543210"
 */
export function normalizePhone(rawPhone: string, dialCode: string = '+91'): string {
  const cleaned = rawPhone.trim();
  const digits = cleaned.replace(/\D/g, '');
  const prefix = (dialCode || '+91').trim().replace(/[^\d+]/g, '');
  const normalizedPrefix = prefix.startsWith('+') ? prefix : `+${prefix}`;
  const prefixDigits = normalizedPrefix.replace('+', '');

  // If user entered a full number starting with +
  if (cleaned.startsWith('+')) {
    return `+${digits}`;
  }

  // If user entered 11 digits for India starting with 0 (trunk prefix)
  if (normalizedPrefix === '+91' && digits.length === 11 && digits.startsWith('0')) {
    return `+91${digits.slice(1)}`;
  }

  // If user entered 10 digits for India
  if (normalizedPrefix === '+91' && digits.length === 10) {
    return `+91${digits}`;
  }

  // If user already included the country code digits without the plus sign
  if (digits.startsWith(prefixDigits) && digits.length > prefixDigits.length + 6) {
    return `+${digits}`;
  }

  return `${normalizedPrefix}${digits}`;
}

/**
 * Validates whether a phone number matches standard E.164 format (+ followed by 8-15 digits).
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Formats a phone number cleanly for UI display (e.g., +91 98765 43210).
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+91') && digits.length === 13) {
    return `+91 ${digits.slice(3, 8)} ${digits.slice(8)}`;
  }
  return digits;
}
