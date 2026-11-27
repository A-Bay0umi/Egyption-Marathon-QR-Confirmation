import { extractParticipantDisplayName, normalizeBarcode } from './marathon-logic';
import type {
  MarathonEvent,
  Organizer,
  Participant,
  SheetsColorCondition,
  SheetsColorRule,
  SheetsColumnMapping,
} from './types';

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

export interface CompiledAppsScriptColorRule {
  name: string;
  formula: string;
  backgroundColor: string;
  fontColor?: string;
  bold?: boolean;
  startColIndex: number;
  numCols: number;
}

export interface AppsScriptSyncPayload {
  secret?: string;
  eventId: string;
  eventName: string;
  mode: 'upsert' | 'full';
  columns: SheetsColumnMapping[];
  colorRules?: CompiledAppsScriptColorRule[];
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
    | 'id'
    | 'name'
    | 'deliverableItems'
    | 'displayFields'
    | 'nameField'
    | 'sheetsColumns'
    | 'sheetsColorRules'
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
  const rulesPart = (event.sheetsColorRules ?? [])
    .map(
      (r) =>
        `${r.id}:${r.enabled}:${r.mode}:${r.presetType ?? ''}:${(r.presetColumnIds ?? []).join(',')}:${r.logic}:${r.conditions.map((c) => `${c.columnId}${c.operator}${c.value ?? ''}`).join('&')}:${r.customFormula ?? ''}:${r.requireNonEmptyRow !== false}:${r.backgroundColor}:${r.fontColor ?? ''}:${Boolean(r.bold)}:${r.targetScope}:${r.targetColumnId ?? ''}`
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

  return `${event.id}#${event.name}#${fieldsPart}#${colsPart}#${rulesPart}#${itemsPart}#${orgsPart}#${participantsPart}`;
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
    | 'sheetsColorRules'
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
  const colorRules = compileColorRulesForAppsScript(columns, event.sheetsColorRules);

  return {
    ...(event.sheetsWebhookSecret ? { secret: event.sheetsWebhookSecret } : {}),
    eventId: event.id,
    eventName: event.name,
    mode,
    columns,
    colorRules,
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
    | 'sheetsColorRules'
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

export function columnIndexToLetter(index: number): string {
  if (index < 0) return 'A';
  let n = index;
  let result = '';
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

function escapeFormulaText(value: string): string {
  return value.replaceAll('"', '""');
}

function sanitizeHexColor(value: string | undefined, fallback: string): string {
  const clean = (value ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(clean) || /^#[0-9A-Fa-f]{3}$/.test(clean)) {
    return clean.toUpperCase();
  }
  return fallback;
}

export function buildDefaultColorRules(columns: SheetsColumnMapping[]): SheetsColorRule[] {
  const statusCols = columns.filter((c) => c.sourceType === 'item_status');
  const statusColIds = statusCols.map((c) => c.id);

  const rules: SheetsColorRule[] = [
    {
      id: 'rule_all_delivered',
      name: 'الكل متسلّم (أخضر)',
      enabled: true,
      mode: 'preset_delivery',
      presetType: 'all_delivered',
      presetColumnIds: statusColIds,
      logic: 'AND',
      conditions: [],
      requireNonEmptyRow: true,
      backgroundColor: '#B8E0B8',
      fontColor: '#000000',
      bold: false,
      targetScope: 'row',
    },
  ];

  if (statusColIds.length >= 2) {
    rules.push({
      id: 'rule_partial_delivered',
      name: 'تسليم جزئي — بعض المهام فقط (أصفر فاقع)',
      enabled: true,
      mode: 'preset_delivery',
      presetType: 'partial_delivered',
      presetColumnIds: statusColIds,
      logic: 'AND',
      conditions: [],
      requireNonEmptyRow: true,
      backgroundColor: '#FFFF00',
      fontColor: '#000000',
      bold: true,
      targetScope: 'row',
    });
  }

  rules.push({
    id: 'rule_none_delivered',
    name: 'لم يُسلَّم أي شيء (أحمر)',
    enabled: true,
    mode: 'preset_delivery',
    presetType: 'none_delivered',
    presetColumnIds: statusColIds,
    logic: 'AND',
    conditions: [],
    requireNonEmptyRow: true,
    backgroundColor: '#F5B3B3',
    fontColor: '#000000',
    bold: false,
    targetScope: 'row',
  });

  return rules;
}

export function getColorRulePriorityRank(rule: SheetsColorRule): number {
  if (rule.mode === 'preset_delivery') {
    if (rule.presetType === 'all_delivered') return 1;
    if (rule.presetType === 'partial_delivered') return 2;
    return 3;
  }
  if (rule.mode === 'conditions') {
    const conds = rule.conditions;
    const allNegative =
      conds.length > 0 &&
      conds.every(
        (c) =>
          c.operator === 'is_not_delivered' ||
          c.operator === 'not_equals' ||
          c.operator === 'is_empty' ||
          c.operator === 'not_contains'
      );
    if (allNegative) return 3;
    const allPositiveDelivery =
      conds.length > 0 &&
      rule.logic === 'AND' &&
      conds.every((c) => c.operator === 'is_delivered');
    if (allPositiveDelivery && conds.length >= 2) return 1;
    return 2;
  }
  return 2;
}

export function checkColorRulesPriority(rules: SheetsColorRule[]): {
  hasIssue: boolean;
  message?: string;
} {
  let highestRankSeen = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const rank = getColorRulePriorityRank(rule);
    if (rank < highestRankSeen) {
      return {
        hasIssue: true,
        message:
          'في Google Sheets أول قاعدة تتحقق تكسب: يُفضّل وضع "الكل متسلّم" ثم "التسليم الجزئي" أو الشروط الخاصة قبل قاعدة "لم يُسلَّم أي شيء".',
      };
    }
    if (rank > highestRankSeen) highestRankSeen = rank;
  }
  return { hasIssue: false };
}

export function sortColorRulesByPriority(rules: SheetsColorRule[]): SheetsColorRule[] {
  return [...rules]
    .map((rule, idx) => ({ rule, idx, rank: getColorRulePriorityRank(rule) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.idx - b.idx))
    .map((x) => x.rule);
}

function buildConditionClause(
  cond: SheetsColorCondition,
  colIndex: number,
  startRow: number
): string {
  const ref = `$${columnIndexToLetter(colIndex)}${startRow}`;
  const val = escapeFormulaText((cond.value ?? '').trim());

  switch (cond.operator) {
    case 'is_delivered':
      return `TRIM(${ref})="Delivered"`;
    case 'is_not_delivered':
      return `TRIM(${ref})<>"Delivered"`;
    case 'equals':
      return `TRIM(${ref})="${val}"`;
    case 'not_equals':
      return `TRIM(${ref})<>"${val}"`;
    case 'contains':
      return val ? `ISNUMBER(SEARCH("${val}",TRIM(${ref})))` : `NOT(ISBLANK(${ref}))`;
    case 'not_contains':
      return val
        ? `AND(NOT(ISBLANK(${ref})),NOT(ISNUMBER(SEARCH("${val}",TRIM(${ref})))))`
        : `ISBLANK(${ref})`;
    case 'is_empty':
      return `OR(ISBLANK(${ref}),TRIM(${ref})="")`;
    case 'is_not_empty':
      return `AND(NOT(ISBLANK(${ref})),TRIM(${ref})<>"")`;
    default:
      return '';
  }
}

export function buildSheetsRuleFormula(
  rule: SheetsColorRule,
  columns: SheetsColumnMapping[],
  startRow = 2
): string | null {
  if (columns.length === 0) return null;

  const colIndexById = new Map<string, number>();
  columns.forEach((col, idx) => colIndexById.set(col.id, idx));

  const anchorRef = `$${columnIndexToLetter(0)}${startRow}`;
  const nonEmptyGuard = `NOT(ISBLANK(${anchorRef})),TRIM(${anchorRef})<>""`;
  const needGuard = rule.requireNonEmptyRow !== false;

  if (rule.mode === 'custom_formula') {
    const raw = (rule.customFormula ?? '').trim();
    if (!raw) return null;
    const normalized = raw.startsWith('=') ? raw : `=${raw}`;
    if (startRow !== 2) {
      return normalized.replace(/(\$?[A-Z]+)2\b/g, `$1${startRow}`);
    }
    return normalized;
  }

  if (rule.mode === 'preset_delivery') {
    const statusIndices = (
      rule.presetColumnIds && rule.presetColumnIds.length > 0
        ? rule.presetColumnIds
            .map((id) => colIndexById.get(id))
            .filter((idx): idx is number => idx !== undefined)
        : columns
            .map((col, idx) => (col.sourceType === 'item_status' ? idx : -1))
            .filter((idx) => idx >= 0)
    );

    if (statusIndices.length === 0) return null;
    const refs = statusIndices.map((idx) => `$${columnIndexToLetter(idx)}${startRow}`);

    if (rule.presetType === 'all_delivered') {
      const checks = refs.map((ref) => `TRIM(${ref})="Delivered"`);
      return needGuard
        ? `=AND(${nonEmptyGuard},${checks.join(',')})`
        : `=AND(${checks.join(',')})`;
    }

    if (rule.presetType === 'partial_delivered') {
      if (refs.length < 2) return null;
      const partialCore =
        refs.length === 2
          ? `OR(AND(TRIM(${refs[0]})="Delivered",TRIM(${refs[1]})<>"Delivered"),AND(TRIM(${refs[0]})<>"Delivered",TRIM(${refs[1]})="Delivered"))`
          : `AND(OR(${refs.map((r) => `TRIM(${r})="Delivered"`).join(',')}),OR(${refs.map((r) => `TRIM(${r})<>"Delivered"`).join(',')}))`;
      return needGuard
        ? `=AND(${nonEmptyGuard},${partialCore})`
        : `=${partialCore}`;
    }

    // none_delivered
    const noneChecks = refs.map((ref) => `TRIM(${ref})<>"Delivered"`);
    return needGuard
      ? `=AND(${nonEmptyGuard},${noneChecks.join(',')})`
      : `=AND(${noneChecks.join(',')})`;
  }

  // mode === 'conditions'
  const validClauses: string[] = [];
  let checksAnchorEmpty = false;

  for (const cond of rule.conditions) {
    const colIdx = colIndexById.get(cond.columnId);
    if (colIdx === undefined) continue;
    if (colIdx === 0 && cond.operator === 'is_empty') {
      checksAnchorEmpty = true;
    }
    const clause = buildConditionClause(cond, colIdx, startRow);
    if (clause) validClauses.push(clause);
  }

  if (validClauses.length === 0) return null;

  const combined =
    validClauses.length === 1
      ? validClauses[0]
      : `${rule.logic === 'OR' ? 'OR' : 'AND'}(${validClauses.join(',')})`;

  if (needGuard && !checksAnchorEmpty) {
    if (validClauses.length === 1 && rule.logic !== 'OR') {
      return `=AND(${nonEmptyGuard},${validClauses[0]})`;
    }
    return `=AND(${nonEmptyGuard},${combined})`;
  }

  return `=${combined}`;
}

export function compileColorRulesForAppsScript(
  columns: SheetsColumnMapping[],
  colorRules?: SheetsColorRule[],
  startRow = 2
): CompiledAppsScriptColorRule[] {
  if (columns.length === 0) return [];

  // Fallback when event has no configured colorRules yet
  if (colorRules === undefined) {
    const hasStatusCols = columns.some((c) => c.sourceType === 'item_status');
    if (!hasStatusCols) {
      const colSpan = Math.max(columns.length, 1);
      return [
        {
          name: 'الكل متسلّم (أخضر)',
          formula: `=AND(NOT(ISBLANK($A${startRow})),TRIM($A${startRow})<>"",TRIM($E${startRow})="Delivered",TRIM($I${startRow})="Delivered")`,
          backgroundColor: '#B8E0B8',
          startColIndex: 1,
          numCols: colSpan,
        },
        {
          name: 'تسليم جزئي (أصفر فاقع)',
          formula: `=AND(NOT(ISBLANK($A${startRow})),TRIM($A${startRow})<>"",OR(AND(TRIM($E${startRow})="Delivered",TRIM($I${startRow})<>"Delivered"),AND(TRIM($E${startRow})<>"Delivered",TRIM($I${startRow})="Delivered")))`,
          backgroundColor: '#FFFF00',
          fontColor: '#000000',
          bold: true,
          startColIndex: 1,
          numCols: colSpan,
        },
        {
          name: 'لم يُسلَّم أي شيء (أحمر)',
          formula: `=AND(NOT(ISBLANK($A${startRow})),TRIM($A${startRow})<>"",TRIM($E${startRow})<>"Delivered",TRIM($I${startRow})<>"Delivered")`,
          backgroundColor: '#F5B3B3',
          startColIndex: 1,
          numCols: colSpan,
        },
      ];
    }
    colorRules = buildDefaultColorRules(columns);
  }

  const colIndexById = new Map<string, number>();
  columns.forEach((col, idx) => colIndexById.set(col.id, idx));

  const compiled: CompiledAppsScriptColorRule[] = [];
  for (const rule of colorRules) {
    if (!rule.enabled) continue;
    const formula = buildSheetsRuleFormula(rule, columns, startRow);
    if (!formula) continue;

    let startColIndex = 1;
    let numCols = columns.length;
    if (rule.targetScope === 'column' && rule.targetColumnId) {
      const targetIdx = colIndexById.get(rule.targetColumnId);
      if (targetIdx === undefined) continue;
      startColIndex = targetIdx + 1;
      numCols = 1;
    }

    const safeFont = rule.fontColor ? sanitizeHexColor(rule.fontColor, '') : '';
    compiled.push({
      name: rule.name,
      formula,
      backgroundColor: sanitizeHexColor(rule.backgroundColor, '#B8E0B8'),
      ...(safeFont ? { fontColor: safeFont } : {}),
      ...(rule.bold ? { bold: true } : {}),
      startColIndex,
      numCols,
    });
  }

  return compiled;
}

function evaluateSingleConditionValue(
  cond: SheetsColorCondition,
  rawCellVal: string
): boolean {
  const trimmed = rawCellVal.trim();
  const targetVal = (cond.value ?? '').trim();

  switch (cond.operator) {
    case 'is_delivered':
      return trimmed === 'Delivered';
    case 'is_not_delivered':
      return trimmed !== 'Delivered';
    case 'equals':
      return trimmed.toLowerCase() === targetVal.toLowerCase();
    case 'not_equals':
      return trimmed.toLowerCase() !== targetVal.toLowerCase();
    case 'contains':
      return targetVal ? trimmed.toLowerCase().includes(targetVal.toLowerCase()) : trimmed !== '';
    case 'not_contains':
      return trimmed !== '' && (!targetVal || !trimmed.toLowerCase().includes(targetVal.toLowerCase()));
    case 'is_empty':
      return trimmed === '';
    case 'is_not_empty':
      return trimmed !== '';
    default:
      return false;
  }
}

function evaluateSimpleSheetFormulaForRow(
  formula: string,
  rowValues: string[]
): boolean {
  const stripped = formula.trim().replace(/^=/, '');
  if (!stripped) return false;

  const getCellByRef = (ref: string): string => {
    const clean = ref.replaceAll('$', '').toUpperCase();
    const match = /^([A-Z]+)(\d+)$/.exec(clean);
    if (!match) return '';
    let colIdx = 0;
    for (let i = 0; i < match[1].length; i += 1) {
      colIdx = colIdx * 26 + (match[1].charCodeAt(i) - 64);
    }
    return (rowValues[colIdx - 1] ?? '').trim();
  };

  const splitArgs = (inner: string): string[] => {
    const args: string[] = [];
    let depth = 0;
    let inQuotes = false;
    let current = '';
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        current += ch;
      } else if (!inQuotes && ch === '(') {
        depth += 1;
        current += ch;
      } else if (!inQuotes && ch === ')') {
        depth = Math.max(0, depth - 1);
        current += ch;
      } else if (!inQuotes && depth === 0 && ch === ',') {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());
    return args;
  };

  const evalExpr = (expr: string): boolean => {
    const s = expr.trim();
    if (!s) return false;
    const upper = s.toUpperCase();

    if (upper.startsWith('AND(') && s.endsWith(')')) {
      const args = splitArgs(s.slice(4, -1));
      return args.length > 0 && args.every(evalExpr);
    }
    if (upper.startsWith('OR(') && s.endsWith(')')) {
      const args = splitArgs(s.slice(3, -1));
      return args.some(evalExpr);
    }
    if (upper.startsWith('NOT(') && s.endsWith(')')) {
      return !evalExpr(s.slice(4, -1));
    }
    if (upper.startsWith('ISBLANK(') && s.endsWith(')')) {
      return getCellByRef(s.slice(8, -1)) === '';
    }
    if (upper.startsWith('ISNUMBER(SEARCH(') && s.endsWith('))')) {
      const args = splitArgs(s.slice(16, -2));
      if (args.length >= 2) {
        const needle = args[0].replace(/^"|"$/g, '').toLowerCase();
        const rawArg = args[1].replace(/^TRIM\((.*)\)$/i, '$1');
        const haystack = getCellByRef(rawArg).toLowerCase();
        return Boolean(needle) && haystack.includes(needle);
      }
    }

    const cmpMatch = /^(TRIM\(([^)]+)\)|\$?[A-Z]+\d+)\s*(<>|=)\s*"([^"]*)"$/i.exec(s);
    if (cmpMatch) {
      const refStr = cmpMatch[2] || cmpMatch[1];
      const op = cmpMatch[3];
      const expected = cmpMatch[4];
      const actual = getCellByRef(refStr);
      return op === '=' ? actual === expected : actual !== expected;
    }

    return false;
  };

  return evalExpr(stripped);
}

export interface PreviewCellColorStyle {
  backgroundColor: string;
  color?: string;
  fontWeight?: 'bold';
  ruleName: string;
}

export function evaluateColorRulesForRow(
  rules: SheetsColorRule[],
  columns: SheetsColumnMapping[],
  rowValues: string[]
): Record<number, PreviewCellColorStyle> {
  const cellStyles: Record<number, PreviewCellColorStyle> = {};
  const colIndexById = new Map<string, number>();
  columns.forEach((col, idx) => colIndexById.set(col.id, idx));

  const anchorNonEmpty = (rowValues[0] ?? '').trim() !== '';

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let matched = false;
    if (rule.mode === 'preset_delivery') {
      if (rule.requireNonEmptyRow !== false && !anchorNonEmpty) {
        matched = false;
      } else {
        const statusIndices =
          rule.presetColumnIds && rule.presetColumnIds.length > 0
            ? rule.presetColumnIds
                .map((id) => colIndexById.get(id))
                .filter((idx): idx is number => idx !== undefined)
            : columns
                .map((c, idx) => (c.sourceType === 'item_status' ? idx : -1))
                .filter((idx) => idx >= 0);

        if (statusIndices.length > 0) {
          const deliveredFlags = statusIndices.map(
            (idx) => (rowValues[idx] ?? '').trim() === 'Delivered'
          );
          if (rule.presetType === 'all_delivered') {
            matched = deliveredFlags.every(Boolean);
          } else if (rule.presetType === 'partial_delivered') {
            matched =
              statusIndices.length >= 2 &&
              deliveredFlags.some(Boolean) &&
              deliveredFlags.some((f) => !f);
          } else {
            matched = deliveredFlags.every((f) => !f);
          }
        }
      }
    } else if (rule.mode === 'conditions') {
      const validConds = rule.conditions.filter((c) => colIndexById.has(c.columnId));
      const checksAnchorEmpty = validConds.some(
        (c) => colIndexById.get(c.columnId) === 0 && c.operator === 'is_empty'
      );
      if (validConds.length > 0 && (rule.requireNonEmptyRow === false || checksAnchorEmpty || anchorNonEmpty)) {
        const evals = validConds.map((c) => {
          const idx = colIndexById.get(c.columnId)!;
          return evaluateSingleConditionValue(c, rowValues[idx] ?? '');
        });
        matched = rule.logic === 'OR' ? evals.some(Boolean) : evals.every(Boolean);
      }
    } else if (rule.mode === 'custom_formula') {
      matched = evaluateSimpleSheetFormulaForRow(rule.customFormula ?? '', rowValues);
    }

    if (!matched) continue;

    const style: PreviewCellColorStyle = {
      backgroundColor: rule.backgroundColor || '#B8E0B8',
      ...(rule.fontColor ? { color: rule.fontColor } : {}),
      ...(rule.bold ? { fontWeight: 'bold' } : {}),
      ruleName: rule.name,
    };

    if (rule.targetScope === 'column' && rule.targetColumnId) {
      const targetIdx = colIndexById.get(rule.targetColumnId);
      if (targetIdx !== undefined && !cellStyles[targetIdx]) {
        cellStyles[targetIdx] = style;
      }
    } else {
      for (let i = 0; i < columns.length; i += 1) {
        if (!cellStyles[i]) {
          cellStyles[i] = style;
        }
      }
    }
  }

  return cellStyles;
}

export function generateGoogleAppsScriptCode(
  secret?: string,
  columns?: SheetsColumnMapping[],
  colorRules?: SheetsColorRule[]
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
          { header: 'Tkt Number', sourceType: 'barcode' as const },
          { header: 'Full Name', sourceType: 'participant_name' as const },
        ];
  const fullColsForCompile: SheetsColumnMapping[] =
    Array.isArray(columns) && columns.length > 0
      ? columns
      : [
          { id: 'col_barcode', header: 'Tkt Number', sourceType: 'barcode' },
          { id: 'col_name', header: 'Full Name', sourceType: 'participant_name' },
        ];

  const compiledColorRules = compileColorRulesForAppsScript(fullColsForCompile, colorRules, 2);
  const serializedColumns = JSON.stringify(effectiveCols, null, 2);
  const serializedColorRules = JSON.stringify(compiledColorRules, null, 2);

  return `// EM QR -> Google Sheets Auto Sync (Apps Script Web App)
// Preserves & reapplies dynamic Conditional Formatting rules on every sync
const SECRET = '${safeSecret}';
const TARGET_SHEET_NAME = 'Sheet1';

// Custom sheet columns generated from your EM QR configuration:
const SHEET_COLUMNS = ${serializedColumns};

// Dynamic Conditional Formatting rules (priority: top -> bottom):
const SHEET_COLOR_RULES = ${serializedColorRules};

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

function applyColorRules(sheet, totalCols, rulesToApply) {
  const activeRules = Array.isArray(rulesToApply) ? rulesToApply : SHEET_COLOR_RULES;
  if (!activeRules || activeRules.length === 0) {
    sheet.setConditionalFormatRules([]);
    return;
  }

  const sheetMaxRows = Math.max(sheet.getMaxRows(), sheet.getLastRow(), 2);
  const sheetMaxCols = Math.max(sheet.getMaxColumns(), 1);
  const dataRowCount = Math.max(sheetMaxRows - 1, 1);
  const defaultSpanCols = Math.min(Math.max(totalCols || sheetMaxCols, 1), sheetMaxCols);
  const built = [];

  for (let i = 0; i < activeRules.length; i++) {
    const cfg = activeRules[i];
    if (!cfg || !cfg.formula || !cfg.backgroundColor) continue;
    const startCol = Math.min(
      Math.max(cfg.startColIndex >= 1 ? cfg.startColIndex : 1, 1),
      sheetMaxCols
    );
    const maxAvailCols = Math.max(sheetMaxCols - startCol + 1, 1);
    const requestedCols = cfg.numCols >= 1 ? cfg.numCols : defaultSpanCols;
    const numCols = Math.max(1, Math.min(requestedCols, maxAvailCols));
    const targetRange = sheet.getRange(2, startCol, dataRowCount, numCols);
    const builder = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(cfg.formula)
      .setBackground(cfg.backgroundColor)
      .setRanges([targetRange]);
    if (cfg.fontColor) builder.setFontColor(cfg.fontColor);
    if (cfg.bold) builder.setBold(true);
    built.push(builder.build());
  }

  sheet.setConditionalFormatRules(built);
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
    const activeColorRules = Array.isArray(data.colorRules)
      ? data.colorRules
      : SHEET_COLOR_RULES;
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

    // 3. Format Row 1 headers only (black bold, orange fill, centered)
    if (totalCols > 0) {
      sheet.getRange(1, 1, 1, totalCols)
        .setFontColor('#000000')
        .setFontWeight('bold')
        .setBackground('#FF9800')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }

    // 4. Center data cells horizontally & vertically without wiping conditional formatting
    if (finalLastRow > 1 && totalCols > 0) {
      sheet.getRange(2, 1, finalLastRow - 1, totalCols)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    }

    // 5. Re-apply dynamic Conditional Formatting rules (top -> bottom priority)
    applyColorRules(sheet, totalCols, activeColorRules);

    // 6. Flush pending changes immediately
    SpreadsheetApp.flush();

    return jsonOut({
      ok: true,
      updatedRows: isReset ? outputRows.length : 0,
      insertedRows: isReset ? 0 : outputRows.length,
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
