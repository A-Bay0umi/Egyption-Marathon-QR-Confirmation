import type { MarathonEvent, Organizer } from './types';

export const ADMIN_PASSCODE = 'Abdallah@2008';
export const ADMIN_SESSION_STORAGE_KEY = 'marathon_admin_passcode_session_v1';

export function verifyAdminPasscode(input: string): boolean {
  return input.trim() === ADMIN_PASSCODE;
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

export interface OrganizerInvitePayload {
  org: Organizer;
  event: MarathonEvent | null;
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(`${b64}${pad}`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeOrganizerInvite(org: Organizer, event: MarathonEvent | null): string {
  const compact: OrganizerInvitePayload = {
    org,
    event: event
      ? {
          id: event.id,
          name: event.name,
          date: event.date,
          isActive: true,
          deliverableItems: event.deliverableItems,
          displayFields: event.displayFields,
          displayLabels: event.displayLabels,
          searchFields: event.searchFields,
          totalParticipants: event.totalParticipants,
          ownerUid: event.ownerUid,
          createdAt: event.createdAt,
        }
      : null,
  };
  return toBase64Url(JSON.stringify(compact));
}

export function decodeOrganizerInvite(encoded: string): OrganizerInvitePayload | null {
  try {
    if (!encoded || !encoded.trim()) return null;
    const json = fromBase64Url(encoded.trim());
    const parsed = JSON.parse(json) as OrganizerInvitePayload;
    if (!parsed || !parsed.org || !parsed.org.magicToken || !parsed.org.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildOrganizerMagicUrl(
  origin: string,
  org: Organizer,
  event: MarathonEvent | null
): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const invite = encodeOrganizerInvite(org, event);
  return `${cleanOrigin}/?token=${encodeURIComponent(org.magicToken)}&invite=${encodeURIComponent(invite)}`;
}

export function buildOrganizerWhatsAppMessage(
  magicUrl: string,
  org: Organizer,
  event: MarathonEvent | null
): string {
  const itemsList =
    event?.deliverableItems
      .filter((i) => org.assignedItems.includes(i.id))
      .map((i) => i.name)
      .join('، ') || 'المستلزمات المخصصة';

  return [
    `مرحباً ${org.name} 👋`,
    `تم تفعيل حسابك لتسليم مستلزمات "${event?.name ?? 'الماراثون'}" (${org.boothName || 'نقطة التوزيع'}).`,
    '',
    `🔗 اضغط على رابط الدخول المباشر الخاص بك:`,
    magicUrl,
    '',
    `📦 المستلزمات المخصصة لبوثك: ${itemsList}`,
    `📱 ملاحظة: بمجرد فتح الرابط، يتم حفظ تسجيل دخولك تلقائياً على هاتفك للعمل فوراً حتى عند انقطاع الإنترنت.`,
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
