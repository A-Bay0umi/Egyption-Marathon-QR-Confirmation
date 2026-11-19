import type {
  ActivityLog,
  ColumnMapping,
  DeliverableItem,
  DeliveryRecord,
  ItemProgressStat,
  Organizer,
  Participant,
} from './types';

const EASTERN_ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toWesternDigits(input: string): string {
  let out = input;
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(EASTERN_ARABIC_DIGITS[i], String(i));
    out = out.replaceAll(PERSIAN_DIGITS[i], String(i));
  }
  return out;
}

export function normalizeBarcode(raw: string): string {
  const western = toWesternDigits(String(raw ?? ''));
  return western
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_\-]/g, '');
}

export function normalizeArabicText(raw: string): string {
  return toWesternDigits(String(raw ?? ''))
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '');
}

export function generateSearchKeywords(
  dynamicData: Record<string, string>,
  searchFields: string[],
  barcode: string
): string[] {
  const keywords = new Set<string>();
  const normBarcode = normalizeBarcode(barcode).toLowerCase();
  if (normBarcode) {
    keywords.add(normBarcode);
  }

  for (const field of searchFields) {
    const rawVal = String(dynamicData[field] ?? '').trim();
    if (!rawVal) continue;

    const normalized = normalizeArabicText(rawVal);
    if (!normalized) continue;

    keywords.add(normalized);

    const tokens = normalized.split(/[\s\-_/]+/).filter(Boolean);
    for (const token of tokens) {
      keywords.add(token);
      if (token.length >= 2) {
        for (let len = 2; len <= Math.min(token.length, 6); len++) {
          keywords.add(token.slice(0, len));
        }
      }
      // Phone number or numeric suffix matching (last 4 to 6 digits)
      const digitsOnly = token.replace(/\D/g, '');
      if (digitsOnly.length >= 4) {
        keywords.add(digitsOnly);
        keywords.add(digitsOnly.slice(-4));
        if (digitsOnly.length >= 6) {
          keywords.add(digitsOnly.slice(-6));
        }
      }
    }
  }

  return Array.from(keywords).slice(0, 60);
}

export function matchesSearchQuery(participant: Participant, rawQuery: string): boolean {
  const q = normalizeArabicText(rawQuery);
  if (!q) return false;

  const qBarcode = normalizeBarcode(rawQuery).toLowerCase();
  if (qBarcode && participant.barcode.toLowerCase().includes(qBarcode)) {
    return true;
  }

  for (const kw of participant.searchKeywords) {
    if (kw.includes(q) || q === kw) {
      return true;
    }
  }

  for (const val of Object.values(participant.dynamicData)) {
    if (normalizeArabicText(String(val)).includes(q)) {
      return true;
    }
  }

  return false;
}

export function getPrerequisiteItem(
  item: DeliverableItem,
  allItems: DeliverableItem[]
): DeliverableItem | null {
  if (!item.dependsOnItemId) return null;
  return allItems.find((i) => i.id === item.dependsOnItemId) ?? null;
}

export function isPrerequisiteMet(
  participant: Participant,
  item: DeliverableItem,
  allItems: DeliverableItem[]
): boolean {
  const prereq = getPrerequisiteItem(item, allItems);
  if (!prereq) return true;
  return participant.deliveries?.[prereq.id]?.status === 'delivered';
}

export function countEligibleForItem(
  participants: Participant[],
  item: DeliverableItem,
  allItems: DeliverableItem[]
): { eligible: number; prerequisiteItem: DeliverableItem | null } {
  const prerequisiteItem = getPrerequisiteItem(item, allItems);
  if (!prerequisiteItem) {
    return { eligible: participants.length, prerequisiteItem: null };
  }
  let eligible = 0;
  for (const p of participants) {
    if (p.deliveries?.[prerequisiteItem.id]?.status === 'delivered') {
      eligible += 1;
    }
  }
  return { eligible, prerequisiteItem };
}

export function wouldCreateDependencyCycle(
  items: DeliverableItem[],
  itemId: string,
  candidatePrereqId: string
): boolean {
  if (!candidatePrereqId) return false;
  if (candidatePrereqId === itemId) return true;
  const map = new Map(items.map((i) => [i.id, i]));
  let cursor: string | undefined = candidatePrereqId;
  const visited = new Set<string>([itemId]);
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = map.get(cursor)?.dependsOnItemId;
  }
  return false;
}

export type DeliveryAttemptResult =
  | {
      ok: true;
      updatedParticipant: Participant;
      updatedOrganizer: Organizer;
      logEntry: ActivityLog;
      deliveryRecord: DeliveryRecord;
    }
  | {
      ok: false;
      reason:
        | 'organizer_frozen'
        | 'unauthorized_item'
        | 'already_delivered'
        | 'prerequisite_not_met';
      existingDelivery?: DeliveryRecord;
      missingItemId?: string;
      missingItemName?: string;
    };

export function extractParticipantDisplayName(
  participant: Participant,
  displayFields: string[]
): string {
  const candidateKeys = [
    ...Object.keys(participant.dynamicData).filter((k) =>
      /اسم|name|full|متسابق|مشترك/i.test(k)
    ),
    ...displayFields,
  ];

  for (const key of candidateKeys) {
    const val = participant.dynamicData[key];
    if (val && String(val).trim()) {
      return String(val).trim();
    }
  }
  return participant.barcode;
}

export function attemptLocalDelivery(params: {
  eventId: string;
  participant: Participant;
  organizer: Organizer;
  item: DeliverableItem;
  displayFields: string[];
  allItems?: DeliverableItem[];
  nowIso?: string;
}): DeliveryAttemptResult {
  const { eventId, participant, organizer, item, displayFields, allItems } = params;
  const nowIso = params.nowIso ?? new Date().toISOString();

  if (!organizer.isActive) {
    return { ok: false, reason: 'organizer_frozen' };
  }

  if (!organizer.assignedItems.includes(item.id)) {
    return { ok: false, reason: 'unauthorized_item' };
  }

  if (item.dependsOnItemId) {
    const prereqItem = allItems?.find((i) => i.id === item.dependsOnItemId);
    const prereqValid = !allItems || Boolean(prereqItem);
    if (prereqValid && participant.deliveries?.[item.dependsOnItemId]?.status !== 'delivered') {
      return {
        ok: false,
        reason: 'prerequisite_not_met',
        missingItemId: item.dependsOnItemId,
        missingItemName: prereqItem?.name ?? 'الخطوة السابقة',
      };
    }
  }

  const existingDelivery = participant.deliveries?.[item.id];
  if (existingDelivery && existingDelivery.status === 'delivered') {
    return {
      ok: false,
      reason: 'already_delivered',
      existingDelivery,
    };
  }

  const deliveryRecord: DeliveryRecord = {
    status: 'delivered',
    deliveredByOrganizerId: organizer.id,
    deliveredByOrganizerName: organizer.name,
    deliveredAt: nowIso,
  };

  const updatedParticipant: Participant = {
    ...participant,
    deliveries: {
      ...participant.deliveries,
      [item.id]: deliveryRecord,
    },
  };

  const updatedOrganizer: Organizer = {
    ...organizer,
    deliveredCount: (organizer.deliveredCount || 0) + 1,
  };

  const logEntry: ActivityLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    eventId,
    participantName: extractParticipantDisplayName(participant, displayFields),
    barcode: participant.barcode,
    itemId: item.id,
    itemName: item.name,
    organizerId: organizer.id,
    organizerName: organizer.name,
    action: 'delivered',
    timestamp: nowIso,
  };

  return {
    ok: true,
    updatedParticipant,
    updatedOrganizer,
    logEntry,
    deliveryRecord,
  };
}

export function adminUndoDelivery(params: {
  eventId: string;
  participant: Participant;
  item: DeliverableItem;
  adminName: string;
  displayFields: string[];
  nowIso?: string;
}): { updatedParticipant: Participant; logEntry: ActivityLog } {
  const { eventId, participant, item, adminName, displayFields } = params;
  const nowIso = params.nowIso ?? new Date().toISOString();

  const nextDeliveries = { ...participant.deliveries };
  delete nextDeliveries[item.id];

  const updatedParticipant: Participant = {
    ...participant,
    deliveries: nextDeliveries,
  };

  const logEntry: ActivityLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    eventId,
    participantName: extractParticipantDisplayName(participant, displayFields),
    barcode: participant.barcode,
    itemId: item.id,
    itemName: item.name,
    organizerId: 'admin',
    organizerName: adminName,
    action: 'undone',
    timestamp: nowIso,
  };

  return { updatedParticipant, logEntry };
}

export function computeEventStats(
  participants: Participant[],
  deliverableItems: DeliverableItem[]
): ItemProgressStat[] {
  const totalParticipants = participants.length;
  return deliverableItems.map((item) => {
    let delivered = 0;
    for (const p of participants) {
      if (p.deliveries?.[item.id]?.status === 'delivered') {
        delivered += 1;
      }
    }
    const { eligible, prerequisiteItem } = countEligibleForItem(
      participants,
      item,
      deliverableItems
    );
    const percentage = eligible > 0 ? Math.min(100, Math.round((delivered / eligible) * 100)) : 0;
    return {
      itemId: item.id,
      itemName: item.name,
      delivered,
      total: eligible,
      totalParticipants,
      prerequisiteName: prerequisiteItem?.name,
      percentage,
    };
  });
}

export function autoSuggestColumnMapping(headers: string[]): ColumnMapping {
  const cleanHeaders = headers.filter((h) => String(h).trim().length > 0);
  const barcodeField =
    cleanHeaders.find((h) => /barcode|باركود|كود|id|code|qr/i.test(h)) ??
    cleanHeaders.find((h) => /bib|صدر|رقم/i.test(h)) ??
    cleanHeaders[0] ??
    '';

  const searchFields = cleanHeaders.filter((h) =>
    /اسم|name|موبايل|هاتف|جوال|phone|mobile|bib|صدر|barcode|باركود/i.test(h)
  );

  const displayFields = cleanHeaders.filter(
    (h) =>
      h !== barcodeField &&
      /اسم|name|مقاس|size|tshirt|تيشيرت|bib|صدر|فئة|category|سباق|مسافة|distance|wave|مجموعة/i.test(h)
  );

  const fallbackDisplay =
    displayFields.length > 0
      ? displayFields
      : cleanHeaders.filter((h) => h !== barcodeField).slice(0, 4);

  const displayLabels: Record<string, string> = {};
  for (const field of fallbackDisplay) {
    displayLabels[field] = field;
  }

  return {
    barcodeField,
    searchFields: searchFields.length > 0 ? searchFields : cleanHeaders.slice(0, 3),
    displayFields: fallbackDisplay,
    displayLabels,
  };
}

export function formatArabicTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

export function formatRelativeArabicTime(iso: string, nowMs = Date.now()): string {
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
    if (diffSec < 30) return 'منذ لحظات';
    if (diffSec < 60) return `منذ ${diffSec} ثانية`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `منذ ${diffHr} ساعة`;
    return formatArabicTime(iso);
  } catch {
    return '';
  }
}
