import type { MarathonEvent, Organizer } from './types';

export const ADMIN_PASSCODE = 'Abdallah@2008';
export const ADMIN_SESSION_STORAGE_KEY = 'marathon_admin_passcode_session_v1';
export const ORGANIZER_SESSION_STORAGE_KEY = 'marathon_organizer_session_v1';

export interface SavedOrganizerSession {
  eventId: string;
  token: string;
}

export function verifyAdminPasscode(input: string): boolean {
  return input.trim() === ADMIN_PASSCODE;
}

export function isAdminSavedLocally(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'authenticated';
}

export function saveOrganizerSessionLocally(session: SavedOrganizerSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ORGANIZER_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function readOrganizerSessionLocally(): SavedOrganizerSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ORGANIZER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedOrganizerSession>;
    if (parsed && typeof parsed.eventId === 'string' && typeof parsed.token === 'string' && parsed.eventId && parsed.token) {
      return { eventId: parsed.eventId, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearOrganizerSessionLocally(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ORGANIZER_SESSION_STORAGE_KEY);
}

export function normalizeWhatsAppPhone(raw: string): string {
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (!digitsOnly) return '';
  let normalized = digitsOnly;
  if (normalized.startsWith('00')) {
    normalized = normalized.slice(2);
  }
  // Egyptian mobile format: 010/011/012/015XXXXXXXX -> 201XXXXXXXXX
  if (/^01[0125]\d{8}$/.test(normalized)) {
    normalized = `2${normalized}`;
  }
  return normalized.length >= 8 ? normalized : '';
}

export function buildOrganizerMagicUrl(
  origin: string,
  org: Organizer,
  eventId?: string
): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const targetEventId = eventId || org.eventId;
  return `${cleanOrigin}/?event=${encodeURIComponent(targetEventId)}&token=${encodeURIComponent(org.magicToken)}`;
}

export function buildOrganizerWhatsAppMessage(
  magicUrl: string,
  org: Organizer,
  event: MarathonEvent | null
): string {
  const rolesList =
    event?.deliverableItems
      .filter((i) => org.assignedItems.includes(i.id))
      .map((i) => i.name)
      .join('، ') || 'المهام المخصصة';

  return [
    `مرحباً ${org.name} 👋`,
    `تم تفعيل حسابك في إيفنت "${event?.name ?? 'الماراثون'}"${org.boothName ? ` (${org.boothName})` : ''}.`,
    '',
    `🔗 رابط الدخول الخاص بك:`,
    magicUrl,
    '',
    `📋 الوظائف / المهام المخصصة لك: ${rolesList}`,
    `📱 يتم حفظ تسجيل دخولك تلقائياً على هاتفك بمجرد فتح الرابط.`,
  ].join('\n');
}

export function buildOrganizerWhatsAppHref(
  magicUrl: string,
  org: Organizer,
  event: MarathonEvent | null
): string {
  const message = buildOrganizerWhatsAppMessage(magicUrl, org, event);
  const cleanPhone = org.whatsappPhone ? normalizeWhatsAppPhone(org.whatsappPhone) : '';
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  }
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
