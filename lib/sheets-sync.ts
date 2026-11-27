import { extractParticipantDisplayName, normalizeBarcode } from './marathon-logic';
import type { MarathonEvent, Organizer, Participant, SheetsColumnMapping } from './types';

export const CAIRO_TIMEZONE = 'Africa/Cairo';
const SHEETS_SYNC_FINGERPRINT_PREFIX = 'emqr_sheets_sync_fp_v1_';
const SHEETS_SYNC_SNAPSHOT_PREFIX = 'emqr_sheets_sync_snap_v2_';

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
  statusText: 'Delivered' | 'Not Delivered';
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
  columns: SheetsColumnMapping[];
  dynamicColumns: string[];
  items: Array<{ id: string; name: string }>;
  rows: AppsScriptParticipantRow[];
  sentAt12h: string;
}

export function isBarcodeOrNameFieldHeader(col: string, nameField?: string): boolean {
  const trimmed = col.trim();
  if (!trimmed) return true;
  if (nameField && trimmed === nameField.trim()) return true;
  return (
    /^(tkt|ticket|barcode|باركود|كود|qr)(\s*(number|no|code|id))?$/i.test(trimmed) ||
    /^(full\s*)?(name|الاسم|اسم)$/i.test(trimmed)
  );
}

export function buildDefaultSheetsColumns(
  event: Pick<MarathonEvent, 'deliverableItems' | 'displayFields' | 'nameField'>,
  extraDynamicFields: string[] = []
): SheetsColumnMapping[] {
  const cols: SheetsColumnMapping[] = [
    { id: 'col_barcode', header: 'Tkt Number', sourceType: 'barcode' },
    { id: 'col_name', header: 'Name', sourceType: 'participant_name' },
  ];

  const candidateFields =
    event.displayFields.length > 0 ? event.displayFields : extraDynamicFields;
  const seenFields = new Set<string>();
  let dynIdx = 0;

  for (const raw of candidateFields) {
    const clean = raw.trim();
    if (!clean || seenFields.has(clean) || isBarcodeOrNameFieldHeader(clean, event.nameField)) {
      continue;
    }
    seenFields.add(clean);
    dynIdx += 1;
    cols.push({
      id: `col_dyn_${dynIdx}`,
      header: clean,
      sourceType: 'dynamic_field',
      fieldKey: clean,
    });
  }

  for (const item of event.deliverableItems) {
    cols.push(
      {
        id: `col_status_${item.id}`,
        header: `${item.name} - Status`,
        sourceType: 'item_status',
        itemId: item.id,
      },
      {
        id: `col_time_${item.id}`,
        header: `${item.name} - Delivery Time`,
        sourceType: 'item_time',
        itemId: item.id,
      },
      {
        id: `col_org_${item.id}`,
        header: `${item.name} - Organizer`,
        sourceType: 'item_organizer',
        itemId: item.id,
      }
    );
  }

  return cols;
}

export function getEffectiveSheetsColumns(
  event: Pick<
    MarathonEvent,
    'deliverableItems' | 'displayFields' | 'nameField' | 'sheetsColumns'
  >,
  extraDynamicFields: string[] = []
): SheetsColumnMapping[] {
  if (Array.isArray(event.sheetsColumns) && event.sheetsColumns.length > 0) {
    return event.sheetsColumns;
  }
  return buildDefaultSheetsColumns(event, extraDynamicFields);
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

export function computeEventSheetsSnapshot(params: {
  event: Pick<
    MarathonEvent,
    'id' | 'name' | 'deliverableItems' | 'displayFields' | 'nameField' | 'sheetsColumns'
  >;
  organizers: Organizer[];
  participants: Participant[];
}): string {
  const { event, organizers, participants } = params;
  const itemsPart = event.deliverableItems.map((i) => `${i.id}:${i.name}`).join(',');
  const fieldsPart = `${event.nameField ?? ''}|${event.displayFields.join(',')}`;
  const colsPart = (event.sheetsColumns ?? [])
    .map(
      (c) =>
        `${c.id}:${c.header}:${c.sourceType}:${c.fieldKey ?? ''}:${c.itemId ?? ''}:${c.staticValue ?? ''}`
    )
    .join('|');
  const orgsPart = [...organizers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((o) => `${o.id}:${o.name}:${o.boothName ?? ''}`)
    .join(';');
  const participantsPart = [...participants]
    .sort((a, b) => a.barcode.localeCompare(b.barcode))
    .map((p) => {
      const dynPart = Object.entries(p.dynamicData ?? {})
        .sort(([k1], [k2]) => k1.localeCompare(k2))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      return `${p.barcode}[${dynPart}][${computeParticipantDeliveriesFingerprint(p)}]`;
    })
    .join('\n');

  return `${event.id}#${event.name}#${fieldsPart}#${colsPart}#${itemsPart}#${orgsPart}#${participantsPart}`;
}

export function loadSyncedSnapshot(eventId: string): string | null {
  if (typeof window === 'undefined' || !eventId) return null;
  try {
    return window.localStorage.getItem(`${SHEETS_SYNC_SNAPSHOT_PREFIX}${eventId}`);
  } catch {
    return null;
  }
}

export function saveSyncedSnapshot(eventId: string, snapshot: string): void {
  if (typeof window === 'undefined' || !eventId) return;
  try {
    window.localStorage.setItem(`${SHEETS_SYNC_SNAPSHOT_PREFIX}${eventId}`, snapshot);
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
    | 'sheetsColumns'
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
          statusText: 'Delivered',
          organizerName: orgName,
          boothName,
          deliveredByLabel,
          deliveredAtIso: rec.deliveredAt,
          deliveredAt12h: formatDeliveryTime12hEn(rec.deliveredAt),
        };
      } else {
        deliveries[item.id] = {
          delivered: false,
          statusText: 'Not Delivered',
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

  const extraFields = Object.keys(participants[0]?.dynamicData ?? {});
  const dynamicColumns = Array.from(
    new Set(
      (event.displayFields.length > 0 ? event.displayFields : extraFields)
        .map((k) => k.trim())
        .filter((k) => !isBarcodeOrNameFieldHeader(k, event.nameField))
    )
  );
  const columns = getEffectiveSheetsColumns(event, extraFields);

  return {
    ...(event.sheetsWebhookSecret ? { secret: event.sheetsWebhookSecret } : {}),
    eventId: event.id,
    eventName: event.name,
    mode,
    columns,
    dynamicColumns,
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
    | 'sheetsColumns'
  >;
  organizers: Organizer[];
  participants: Participant[];
  mode: 'upsert' | 'full';
  chunkSize?: number;
}): Promise<SyncWebhookResponse> {
  const { webhookUrl, event, organizers, participants, mode } = params;
  const chunkSize = params.chunkSize ?? 500;

  if (!isValidAppsScriptUrl(webhookUrl)) {
    return { ok: false, error: 'رابط Google Apps Script غير صالح. يجب أن يبدأ بـ https://script.google.com/' };
  }

  if (participants.length === 0 && mode !== 'full') {
    return { ok: true, updatedRows: 0, insertedRows: 0 };
  }

  let totalUpdated = 0;
  let totalInserted = 0;

  const chunks: Participant[][] =
    participants.length === 0
      ? [[]]
      : Array.from({ length: Math.ceil(participants.length / chunkSize) }, (_, idx) =>
          participants.slice(idx * chunkSize, (idx + 1) * chunkSize)
        );

  for (let i = 0; i < chunks.length; i += 1) {
    const slice = chunks[i];
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

export function generateGoogleAppsScriptCode(
  secret?: string,
  columns?: SheetsColumnMapping[]
): string {
  const safeSecret = (secret ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  const effectiveCols =
    Array.isArray(columns) && columns.length > 0
      ? columns.map((c) => ({
          header: c.header.trim() || 'Column',
          sourceType: c.sourceType,
          ...(c.fieldKey ? { fieldKey: c.fieldKey } : {}),
          ...(c.itemId ? { itemId: c.itemId } : {}),
          ...(c.staticValue !== undefined && c.staticValue !== ''
            ? { staticValue: c.staticValue }
            : {}),
        }))
      : [
          { header: 'Tkt Number', sourceType: 'barcode' },
          { header: 'Full Name', sourceType: 'participant_name' },
        ];
  const serializedColumns = JSON.stringify(effectiveCols, null, 2);

  return `// EM QR -> Google Sheets Auto Sync (Apps Script Web App)
// Preserves all Conditional Formatting rules and cell styles
const SECRET = '${safeSecret}';
const TARGET_SHEET_NAME = 'Sheet1';
const INITIAL_CF_MAX_ROW = 331;

// Custom sheet columns generated from your EM QR configuration:
const SHEET_COLUMNS = ${serializedColumns};

function doGet() {
  return jsonOut({ ok: true, service: 'EM QR Google Sheets Sync' });
}

function resolveColumnValue(col, entry) {
  const src = col.sourceType || 'static_text';
  const delivs = entry.deliveries || {};
  const deliv = col.itemId ? delivs[col.itemId] : null;
  const dyn = entry.dynamicData || {};

  switch (src) {
    case 'barcode':
      return entry.barcode || '';
    case 'participant_name':
      return entry.name || '';
    case 'dynamic_field':
      return col.fieldKey && dyn[col.fieldKey] !== undefined ? String(dyn[col.fieldKey]) : '';
    case 'item_status':
      if (
        deliv &&
        (deliv.delivered === true ||
          String(deliv.statusText || '').trim().toLowerCase() === 'delivered')
      ) {
        return 'Delivered';
      }
      return 'Not Delivered';
    case 'item_time':
      return deliv && deliv.delivered ? (deliv.deliveredAt12h || '') : '';
    case 'item_organizer':
      return deliv && deliv.delivered ? (deliv.deliveredByLabel || deliv.organizerName || '') : '';
    case 'item_organizer_name':
      return deliv && deliv.delivered ? (deliv.organizerName || '') : '';
    case 'item_booth':
      return deliv && deliv.delivered ? (deliv.boothName || '') : '';
    case 'static_text':
      return col.staticValue !== undefined ? String(col.staticValue) : '';
    default:
      return '';
  }
}

function extendConditionalFormatRules(sheet, targetEndRow) {
  const rules = sheet.getConditionalFormatRules();
  if (!rules || rules.length === 0) {
    return { extended: false, ruleCount: 0 };
  }

  let updated = false;
  const nextRules = rules.map(function (rule) {
    const ranges = rule.getRanges();
    let ruleChanged = false;
    const expandedRanges = ranges.map(function (rng) {
      const startRow = rng.getRow();
      const endRow = rng.getLastRow();
      if (startRow >= 2 && endRow < targetEndRow) {
        ruleChanged = true;
        updated = true;
        return sheet.getRange(
          startRow,
          rng.getColumn(),
          targetEndRow - startRow + 1,
          rng.getNumColumns()
        );
      }
      return rng;
    });
    return ruleChanged ? rule.copy().setRanges(expandedRanges).build() : rule;
  });

  if (updated) {
    sheet.setConditionalFormatRules(nextRules);
  }
  return { extended: updated, ruleCount: nextRules.length };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const data = JSON.parse(raw);

    if (SECRET && String(data.secret || '') !== SECRET) {
      return jsonOut({ ok: false, error: 'Unauthorized: Secret code does not match' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(TARGET_SHEET_NAME) || ss.getSheets()[0];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const activeColumns = Array.isArray(data.columns) && data.columns.length > 0
      ? data.columns
      : SHEET_COLUMNS;
    const isReset = data.mode === 'full';

    const headers = activeColumns.map(function (c, idx) {
      return String(c.header || ('Column ' + (idx + 1))).trim();
    });
    const totalCols = headers.length;

    // 1. Build the entire 2D output matrix in memory first
    const outputRows = rows.map(function (entry) {
      return activeColumns.map(function (col) {
        return resolveColumnValue(col, entry);
      });
    });

    const prevLastRow = sheet.getLastRow();
    const prevLastCol = sheet.getLastColumn();

    if (totalCols > 0 && (isReset || prevLastCol === 0 || prevLastRow === 0)) {
      sheet.getRange(1, 1, 1, totalCols).setValues([headers]);
    }

    // 2. Write all rows in one batch setValues() call directly over existing cells
    let finalLastRow = prevLastRow;
    if (isReset) {
      if (outputRows.length > 0 && totalCols > 0) {
        sheet.getRange(2, 1, outputRows.length, totalCols).setValues(outputRows);
      }
      const newLastRow = 1 + outputRows.length;
      // Clear ONLY excess cell values (never formats or rows) when new dataset is shorter
      if (prevLastRow > newLastRow) {
        const excessRows = prevLastRow - newLastRow;
        const colsToClear = Math.max(totalCols, prevLastCol, 1);
        sheet.getRange(newLastRow + 1, 1, excessRows, colsToClear).clearContent();
      }
      if (prevLastCol > totalCols && totalCols > 0 && prevLastRow >= 1) {
        sheet.getRange(1, totalCols + 1, prevLastRow, prevLastCol - totalCols).clearContent();
      }
      finalLastRow = newLastRow;
    } else if (outputRows.length > 0 && totalCols > 0) {
      const appendStartRow = Math.max(2, prevLastRow + 1);
      sheet.getRange(appendStartRow, 1, outputRows.length, totalCols).setValues(outputRows);
      finalLastRow = appendStartRow + outputRows.length - 1;
    }

    // 3. Format Row 1 headers only (black bold, orange fill, centered) — leaves A2:K formatting untouched
    if (totalCols > 0) {
      sheet.getRange(1, 1, 1, totalCols)
        .setFontColor('#000000')
        .setFontWeight('bold')
        .setBackground('#FF9800')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }

    // 4. Align data cells without touching backgrounds or Conditional Formatting
    if (finalLastRow > 1 && totalCols > 0) {
      sheet.getRange(2, 1, finalLastRow - 1, totalCols)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }

    // 5. Auto-extend Conditional Formatting rules if rows exceed row 331
    let cfExtendedToRow = null;
    let warning = '';
    if (finalLastRow > INITIAL_CF_MAX_ROW) {
      const cfResult = extendConditionalFormatRules(sheet, finalLastRow);
      if (cfResult.extended) {
        cfExtendedToRow = finalLastRow;
      } else if (cfResult.ruleCount === 0) {
        warning = 'Rows exceeded ' + INITIAL_CF_MAX_ROW + ' (' + finalLastRow + ') and no conditional format rules were found.';
      }
    }

    // 6. Flush pending changes immediately
    SpreadsheetApp.flush();

    return jsonOut({
      ok: true,
      updatedRows: isReset ? outputRows.length : 0,
      insertedRows: isReset ? 0 : outputRows.length,
      cfExtendedToRow: cfExtendedToRow,
      warning: warning || undefined,
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
