import { extractParticipantDisplayName, normalizeBarcode } from './marathon-logic';
import type { MarathonEvent, Organizer, Participant } from './types';

export const CAIRO_TIMEZONE = 'Africa/Cairo';
const SHEETS_SYNC_FINGERPRINT_PREFIX = 'emqr_sheets_sync_fp_v1_';

/**
 * Formats an ISO timestamp in Africa/Cairo timezone using strictly English digits,
 * 12-hour clock, with seconds (e.g. "2026-11-20 02:05:33 PM").
 */
export function formatDeliveryTime12hEn(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    numberingSystem: 'latn',
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');
  const period = get('dayPeriod').toUpperCase();

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${period}`;
}

export interface AppsScriptDeliveryCell {
  delivered: boolean;
  statusText: 'تم التسليم' | 'لم يستلم';
  organizerName: string;
  boothName: string;
  deliveredByLabel: string;
  deliveredAtIso: string;
  deliveredAt12h: string;
}

export interface AppsScriptParticipantRow {
  barcode: string;
  name: string;
  dynamicData: Record<string, string>;
  deliveries: Record<string, AppsScriptDeliveryCell>;
}

export interface AppsScriptSyncPayload {
  secret?: string;
  eventId: string;
  eventName: string;
  mode: 'upsert' | 'full';
  items: Array<{ id: string; name: string }>;
  rows: AppsScriptParticipantRow[];
  sentAt12h: string;
}

export function isValidAppsScriptUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'script.google.com' ||
        parsed.hostname === 'script.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

export function computeParticipantDeliveriesFingerprint(p: Participant): string {
  const entries = Object.entries(p.deliveries ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, rec]) => `${itemId}:${rec.status}:${rec.deliveredByOrganizerId}:${rec.deliveredAt}`);
  return entries.join('|');
}

export function loadSyncedFingerprints(eventId: string): Record<string, string> {
  if (typeof window === 'undefined' || !eventId) return {};
  try {
    const raw = window.localStorage.getItem(`${SHEETS_SYNC_FINGERPRINT_PREFIX}${eventId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveSyncedFingerprints(
  eventId: string,
  fingerprints: Record<string, string>
): void {
  if (typeof window === 'undefined' || !eventId) return;
  try {
    window.localStorage.setItem(
      `${SHEETS_SYNC_FINGERPRINT_PREFIX}${eventId}`,
      JSON.stringify(fingerprints)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function buildAppsScriptPayload(params: {
  event: Pick<
    MarathonEvent,
    | 'id'
    | 'name'
    | 'deliverableItems'
    | 'displayFields'
    | 'nameField'
    | 'sheetsWebhookSecret'
  >;
  organizers: Organizer[];
  participants: Participant[];
  mode: 'upsert' | 'full';
}): AppsScriptSyncPayload {
  const { event, organizers, participants, mode } = params;
  const boothByOrgId = new Map<string, string>();
  for (const org of organizers) {
    if (org.boothName) {
      boothByOrgId.set(org.id, org.boothName);
    }
  }

  const rows: AppsScriptParticipantRow[] = participants.map((p) => {
    const name = extractParticipantDisplayName(p, event.displayFields, event.nameField);
    const deliveries: Record<string, AppsScriptDeliveryCell> = {};

    for (const item of event.deliverableItems) {
      const rec = p.deliveries?.[item.id];
      if (rec?.status === 'delivered') {
        const boothName = boothByOrgId.get(rec.deliveredByOrganizerId) ?? '';
        const orgName = rec.deliveredByOrganizerName || '';
        const deliveredByLabel = boothName && orgName ? `${orgName} (${boothName})` : orgName || boothName;
        deliveries[item.id] = {
          delivered: true,
          statusText: 'تم التسليم',
          organizerName: orgName,
          boothName,
          deliveredByLabel,
          deliveredAtIso: rec.deliveredAt,
          deliveredAt12h: formatDeliveryTime12hEn(rec.deliveredAt),
        };
      } else {
        deliveries[item.id] = {
          delivered: false,
          statusText: 'لم يستلم',
          organizerName: '',
          boothName: '',
          deliveredByLabel: '',
          deliveredAtIso: '',
          deliveredAt12h: '',
        };
      }
    }

    return {
      barcode: normalizeBarcode(p.barcode) || p.barcode,
      name,
      dynamicData: p.dynamicData ?? {},
      deliveries,
    };
  });

  return {
    ...(event.sheetsWebhookSecret ? { secret: event.sheetsWebhookSecret } : {}),
    eventId: event.id,
    eventName: event.name,
    mode,
    items: event.deliverableItems.map((i) => ({ id: i.id, name: i.name })),
    rows,
    sentAt12h: formatDeliveryTime12hEn(new Date().toISOString()),
  };
}

export interface SyncWebhookResponse {
  ok: boolean;
  updatedRows?: number;
  insertedRows?: number;
  error?: string;
}

export async function postAppsScriptWebhookChunks(params: {
  webhookUrl: string;
  event: Pick<
    MarathonEvent,
    | 'id'
    | 'name'
    | 'deliverableItems'
    | 'displayFields'
    | 'nameField'
    | 'sheetsWebhookSecret'
  >;
  organizers: Organizer[];
  participants: Participant[];
  mode: 'upsert' | 'full';
  chunkSize?: number;
}): Promise<SyncWebhookResponse> {
  const { webhookUrl, event, organizers, participants, mode } = params;
  const chunkSize = params.chunkSize ?? 250;

  if (!isValidAppsScriptUrl(webhookUrl)) {
    return { ok: false, error: 'رابط Google Apps Script غير صالح. يجب أن يبدأ بـ https://script.google.com/' };
  }

  if (participants.length === 0) {
    return { ok: true, updatedRows: 0, insertedRows: 0 };
  }

  let totalUpdated = 0;
  let totalInserted = 0;

  for (let i = 0; i < participants.length; i += chunkSize) {
    const slice = participants.slice(i, i + chunkSize);
    const payload = buildAppsScriptPayload({
      event,
      organizers,
      participants: slice,
      mode: i === 0 ? mode : 'upsert',
    });

    const res = await fetch('/api/sheets-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: webhookUrl.trim(),
        payload,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as SyncWebhookResponse;
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `تعذر المزامنة مع Google Sheet (رمز ${res.status})`,
      };
    }
    totalUpdated += data.updatedRows ?? 0;
    totalInserted += data.insertedRows ?? 0;
  }

  return {
    ok: true,
    updatedRows: totalUpdated,
    insertedRows: totalInserted,
  };
}

export function generateGoogleAppsScriptCode(secret?: string): string {
  const safeSecret = (secret ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return `// EM QR -> Google Sheets Auto Sync (Apps Script Web App)
const SECRET = '${safeSecret}';

function doGet() {
  return jsonOut({ ok: true, service: 'EM QR Google Sheets Sync' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const data = JSON.parse(raw);

    if (SECRET && String(data.secret || '') !== SECRET) {
      return jsonOut({ ok: false, error: 'كود الحماية غير مطابق (Unauthorized)' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets()[0];
    const items = Array.isArray(data.items) ? data.items : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];

    let lastCol = sheet.getLastColumn();
    let headers = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); })
      : [];

    if (headers.length === 0) {
      headers = ['الباركود', 'الاسم'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    function ensureColumn(title) {
      let idx = headers.indexOf(title);
      if (idx === -1) {
        headers.push(title);
        idx = headers.length - 1;
        sheet.getRange(1, idx + 1).setValue(title);
      }
      return idx;
    }

    function normalizeKey(v) {
      return String(v || '').trim().replace(/\\s+/g, '-').toUpperCase();
    }

    let barcodeCol = headers.findIndex(function (h) {
      return /barcode|باركود|كود|id|code|qr/i.test(h);
    });
    if (barcodeCol === -1) barcodeCol = 0;

    const itemCols = {};
    items.forEach(function (item) {
      itemCols[item.id] = {
        statusCol: ensureColumn(item.name + ' - الحالة'),
        timeCol: ensureColumn(item.name + ' - وقت التسليم'),
        orgCol: ensureColumn(item.name + ' - المنظم'),
      };
    });

    const totalCols = headers.length;
    const lastRow = sheet.getLastRow();
    let existingGrid = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, totalCols).getValues() : [];

    const rowIndexByBarcode = {};
    for (let r = 0; r < existingGrid.length; r++) {
      const key = normalizeKey(existingGrid[r][barcodeCol]);
      if (key) rowIndexByBarcode[key] = r;
    }

    const appendedRows = [];
    let updatedRows = 0;
    let insertedRows = 0;

    rows.forEach(function (entry) {
      const key = normalizeKey(entry.barcode);
      if (!key) return;

      const existingIdx = rowIndexByBarcode[key];
      let targetArr;
      if (existingIdx !== undefined) {
        targetArr = existingGrid[existingIdx];
        while (targetArr.length < totalCols) targetArr.push('');
        updatedRows++;
      } else {
        targetArr = new Array(totalCols).fill('');
        targetArr[barcodeCol] = entry.barcode;
        const nameCol = headers.findIndex(function (h) { return /اسم|name/i.test(h); });
        if (nameCol !== -1) targetArr[nameCol] = entry.name || '';
        const dyn = entry.dynamicData || {};
        headers.forEach(function (h, cIdx) {
          if (cIdx !== barcodeCol && dyn[h] !== undefined && !targetArr[cIdx]) {
            targetArr[cIdx] = dyn[h];
          }
        });
        rowIndexByBarcode[key] = existingGrid.length + appendedRows.length;
        appendedRows.push(targetArr);
        insertedRows++;
      }

      const delivs = entry.deliveries || {};
      items.forEach(function (item) {
        const cols = itemCols[item.id];
        const cell = delivs[item.id];
        if (!cols || !cell) return;
        targetArr[cols.statusCol] = cell.statusText || (cell.delivered ? 'تم التسليم' : 'لم يستلم');
        targetArr[cols.timeCol] = cell.delivered ? (cell.deliveredAt12h || '') : '';
        targetArr[cols.orgCol] = cell.delivered ? (cell.deliveredByLabel || cell.organizerName || '') : '';
      });
    });

    if (existingGrid.length > 0) {
      sheet.getRange(2, 1, existingGrid.length, totalCols).setValues(existingGrid);
    }
    if (appendedRows.length > 0) {
      const startRow = 2 + existingGrid.length;
      sheet.getRange(startRow, 1, appendedRows.length, totalCols).setValues(appendedRows);
    }

    return jsonOut({
      ok: true,
      updatedRows: updatedRows,
      insertedRows: insertedRows,
      syncedAt: data.sentAt12h || ''
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}
