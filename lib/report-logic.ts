import {
  computeEventStats,
  detectDeliveryConflicts,
  extractParticipantDisplayName,
  isPrerequisiteMet,
} from './marathon-logic';
import type {
  ActivityLog,
  DeliveryConflictResolution,
  MarathonEvent,
  Organizer,
  Participant,
} from './types';

export const CAIRO_TIMEZONE = 'Africa/Cairo';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export function getCairoDateKey(input: string | number | Date = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

export function getCairoHour(input: string | number | Date): number {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const parsed = Number.parseInt(hourStr, 10);
  if (Number.isNaN(parsed)) return 0;
  return parsed % 24;
}

export function formatCairoTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatCairoHourRange(hour: number): string {
  const start = String(hour % 24).padStart(2, '0');
  const end = String((hour + 1) % 24).padStart(2, '0');
  return `${start}:00 - ${end}:00`;
}

export function formatArabicDurationSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) {
    return `${rounded} ثانية`;
  }
  const mins = Math.floor(rounded / 60);
  const remSec = rounded % 60;
  if (mins < 60) {
    return remSec > 0 ? `${mins} د ${remSec} ث` : `${mins} دقيقة`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs} س ${remMins} د` : `${hrs} ساعة`;
}

function isValidIso(val?: string): val is string {
  if (!val) return false;
  return !Number.isNaN(Date.parse(val));
}

export function resolveLogEffectiveTimestamp(
  log: ActivityLog,
  participantByBarcode: Map<string, Participant>
): string {
  if (isValidIso(log.clientDeliveredAt)) {
    return log.clientDeliveredAt;
  }

  if (log.action === 'delivered') {
    const participant = participantByBarcode.get(log.barcode);
    const record = participant?.deliveries?.[log.itemId];
    if (
      record?.status === 'delivered' &&
      isValidIso(record.deliveredAt) &&
      (!log.organizerId || record.deliveredByOrganizerId === log.organizerId)
    ) {
      return record.deliveredAt;
    }
    if (record?.status === 'delivered' && isValidIso(record.deliveredAt) && !log.organizerId) {
      return record.deliveredAt;
    }
  }

  return log.timestamp;
}

export interface DayReportSummary {
  totalParticipants: number;
  dayDeliveriesCount: number;
  uniqueParticipantsDeliveredCount: number;
  overallDeliveredUnits: number;
  overallTotalUnits: number;
  overallCompletionPercent: number;
  firstDeliveryAt: string | null;
  lastDeliveryAt: string | null;
  peakHour: { hour: number; count: number } | null;
}

export interface DayReportItemStat {
  itemId: string;
  itemName: string;
  delivered: number;
  total: number;
  remaining: number;
  percentage: number;
  prerequisiteName?: string;
  readyToReceiveCount: number;
  dayDeliveredCount: number;
}

export interface DayReportOrganizerStat {
  organizerId: string;
  organizerName: string;
  boothName?: string;
  deliveriesCount: number;
  itemsBreakdown: Array<{ itemId: string; itemName: string; count: number }>;
  firstActionAt: string;
  lastActionAt: string;
  avgSecondsBetweenDeliveries: number | null;
  peakHour: { hour: number; count: number } | null;
}

export interface DayReportHourlyBucket {
  hour: number;
  label: string;
  total: number;
  segments: Array<{
    itemId: string;
    itemName: string;
    count: number;
    colorIndex: number;
  }>;
}

export interface PendingParticipantSummary {
  barcode: string;
  name: string;
  extra: string;
  isReady: boolean;
}

export interface DayReportPendingItemGroup {
  itemId: string;
  itemName: string;
  pendingCount: number;
  readyCount: number;
  participants: PendingParticipantSummary[];
}

export interface DayReportUndoneEntry {
  logId: string;
  participantName: string;
  barcode: string;
  itemId: string;
  itemName: string;
  organizerName: string;
  timestamp: string;
}

export interface DayReportAuditSection {
  undoneCount: number;
  undoneEntries: DayReportUndoneEntry[];
  offlineDeliveriesCount: number;
  openConflictsCount: number;
}

export interface DayReport {
  selectedDate: string;
  availableDates: string[];
  summary: DayReportSummary;
  itemStats: DayReportItemStat[];
  organizerStats: DayReportOrganizerStat[];
  hourlyBuckets: DayReportHourlyBucket[];
  maxHourlyCount: number;
  pendingByItem: DayReportPendingItemGroup[];
  audit: DayReportAuditSection;
}

export interface BuildDayReportParams {
  event: MarathonEvent;
  participants: Participant[];
  organizers: Organizer[];
  logs: ActivityLog[];
  conflictResolutions: Record<string, DeliveryConflictResolution>;
  selectedDate: string; // 'YYYY-MM-DD' in Africa/Cairo or 'all'
}

export function buildDayReport(params: BuildDayReportParams): DayReport {
  const { event, participants, organizers, logs, conflictResolutions, selectedDate } = params;

  const participantByBarcode = new Map<string, Participant>();
  for (const p of participants) {
    participantByBarcode.set(p.barcode, p);
  }

  const organizerById = new Map<string, Organizer>();
  for (const org of organizers) {
    organizerById.set(org.id, org);
  }

  const itemIndexMap = new Map<string, number>();
  event.deliverableItems.forEach((item, idx) => {
    itemIndexMap.set(item.id, idx);
  });

  // Resolve effective timestamps and collect available Cairo date keys
  const availableDateSet = new Set<string>();
  const resolvedLogs = logs.map((log) => {
    const effectiveTimestamp = resolveLogEffectiveTimestamp(log, participantByBarcode);
    const dateKey = getCairoDateKey(effectiveTimestamp) || getCairoDateKey(log.timestamp);
    if (dateKey) {
      availableDateSet.add(dateKey);
    }
    return {
      log,
      effectiveTimestamp,
      effectiveMs: Date.parse(effectiveTimestamp) || Date.parse(log.timestamp) || 0,
      dateKey,
    };
  });

  const availableDates = Array.from(availableDateSet).sort((a, b) => b.localeCompare(a));

  const dayFilteredLogs =
    selectedDate === 'all'
      ? resolvedLogs
      : resolvedLogs.filter((entry) => entry.dateKey === selectedDate);

  const dayDeliveredLogs = dayFilteredLogs
    .filter((entry) => entry.log.action === 'delivered')
    .sort((a, b) => a.effectiveMs - b.effectiveMs);

  const dayUndoneLogs = dayFilteredLogs
    .filter((entry) => entry.log.action === 'undone')
    .sort((a, b) => b.effectiveMs - a.effectiveMs);

  // 1 & 2: Reuse computeEventStats & isPrerequisiteMet
  const baseStats = computeEventStats(participants, event.deliverableItems);

  const dayCountByItemId = new Map<string, number>();
  for (const entry of dayDeliveredLogs) {
    const key = entry.log.itemId || entry.log.itemName;
    dayCountByItemId.set(key, (dayCountByItemId.get(key) ?? 0) + 1);
  }

  const itemStats: DayReportItemStat[] = [];
  const pendingByItem: DayReportPendingItemGroup[] = [];

  for (let idx = 0; idx < event.deliverableItems.length; idx++) {
    const item = event.deliverableItems[idx];
    const base = baseStats[idx];
    const pendingParticipants: PendingParticipantSummary[] = [];
    let readyToReceiveCount = 0;

    for (const p of participants) {
      const isDelivered = p.deliveries?.[item.id]?.status === 'delivered';
      if (!isDelivered) {
        const ready = isPrerequisiteMet(p, item, event.deliverableItems);
        if (ready) {
          readyToReceiveCount += 1;
        }
        const pName = extractParticipantDisplayName(p, event.displayFields, event.nameField);
        const extra = event.displayFields
          .filter((f) => f !== event.nameField && p.dynamicData[f] && p.dynamicData[f] !== pName)
          .slice(0, 2)
          .map((f) => p.dynamicData[f])
          .join(' · ');
        pendingParticipants.push({
          barcode: p.barcode,
          name: pName,
          extra,
          isReady: ready,
        });
      }
    }

    itemStats.push({
      itemId: item.id,
      itemName: item.name,
      delivered: base.delivered,
      total: base.total,
      remaining: Math.max(0, base.total - base.delivered),
      percentage: base.percentage,
      prerequisiteName: base.prerequisiteName,
      readyToReceiveCount,
      dayDeliveredCount: dayCountByItemId.get(item.id) ?? 0,
    });

    pendingByItem.push({
      itemId: item.id,
      itemName: item.name,
      pendingCount: pendingParticipants.length,
      readyCount: readyToReceiveCount,
      participants: pendingParticipants,
    });
  }

  // Overall completion percentage across all deliverable items
  const overallDeliveredUnits = itemStats.reduce((sum, s) => sum + s.delivered, 0);
  const overallTotalUnits = itemStats.reduce((sum, s) => sum + s.total, 0);
  const overallCompletionPercent =
    overallTotalUnits > 0
      ? Math.min(100, Math.round((overallDeliveredUnits / overallTotalUnits) * 100))
      : 0;

  // Hourly distribution & global peak hour
  const hourMap = new Map<
    number,
    Map<string, { itemId: string; itemName: string; count: number }>
  >();
  const globalHourTotals = new Map<number, number>();
  const uniqueDeliveredBarcodes = new Set<string>();
  let offlineDeliveriesCount = 0;

  for (const entry of dayDeliveredLogs) {
    uniqueDeliveredBarcodes.add(entry.log.barcode);
    if (entry.log.viaOffline) {
      offlineDeliveriesCount += 1;
    }

    const hour = getCairoHour(entry.effectiveTimestamp);
    globalHourTotals.set(hour, (globalHourTotals.get(hour) ?? 0) + 1);

    let itemMap = hourMap.get(hour);
    if (!itemMap) {
      itemMap = new Map();
      hourMap.set(hour, itemMap);
    }
    const itemId = entry.log.itemId || entry.log.itemName;
    const itemName = entry.log.itemName || itemId;
    const existing = itemMap.get(itemId);
    if (existing) {
      existing.count += 1;
    } else {
      itemMap.set(itemId, { itemId, itemName, count: 1 });
    }
  }

  let peakHour: { hour: number; count: number } | null = null;
  for (const [hour, count] of globalHourTotals.entries()) {
    if (!peakHour || count > peakHour.count || (count === peakHour.count && hour < peakHour.hour)) {
      peakHour = { hour, count };
    }
  }

  const hourlyBuckets: DayReportHourlyBucket[] = [];
  let maxHourlyCount = 0;
  if (hourMap.size > 0) {
    const hoursPresent = Array.from(hourMap.keys());
    const minHour = Math.min(...hoursPresent);
    const maxHour = Math.max(...hoursPresent);

    for (let h = minHour; h <= maxHour; h++) {
      const segMap = hourMap.get(h);
      const rawSegments = segMap ? Array.from(segMap.values()) : [];
      const segments = rawSegments
        .map((seg) => {
          const knownIdx = itemIndexMap.get(seg.itemId);
          return {
            ...seg,
            colorIndex: knownIdx !== undefined ? knownIdx : 0,
          };
        })
        .sort((a, b) => a.colorIndex - b.colorIndex);

      const total = segments.reduce((sum, s) => sum + s.count, 0);
      if (total > maxHourlyCount) maxHourlyCount = total;

      hourlyBuckets.push({
        hour: h,
        label: formatCairoHourRange(h),
        total,
        segments,
      });
    }
  }

  // 3: Per Organizer / Booth stats
  const orgBuckets = new Map<string, typeof dayDeliveredLogs>();
  for (const entry of dayDeliveredLogs) {
    const orgKey = entry.log.organizerId || entry.log.organizerName || 'unknown';
    const arr = orgBuckets.get(orgKey);
    if (arr) {
      arr.push(entry);
    } else {
      orgBuckets.set(orgKey, [entry]);
    }
  }

  const organizerStats: DayReportOrganizerStat[] = [];
  for (const [orgKey, entries] of orgBuckets.entries()) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const orgProfile = organizerById.get(orgKey);

    const itemCountMap = new Map<string, { itemId: string; itemName: string; count: number }>();
    const orgHourCounts = new Map<number, number>();
    const validGapsMs: number[] = [];

    for (let i = 0; i < entries.length; i++) {
      const cur = entries[i];
      const itemId = cur.log.itemId || cur.log.itemName;
      const itemName = cur.log.itemName || itemId;
      const existing = itemCountMap.get(itemId);
      if (existing) {
        existing.count += 1;
      } else {
        itemCountMap.set(itemId, { itemId, itemName, count: 1 });
      }

      const h = getCairoHour(cur.effectiveTimestamp);
      orgHourCounts.set(h, (orgHourCounts.get(h) ?? 0) + 1);

      if (i > 0) {
        const gapMs = cur.effectiveMs - entries[i - 1].effectiveMs;
        if (gapMs >= 0 && gapMs <= THIRTY_MINUTES_MS) {
          validGapsMs.push(gapMs);
        }
      }
    }

    let orgPeakHour: { hour: number; count: number } | null = null;
    for (const [h, cnt] of orgHourCounts.entries()) {
      if (
        !orgPeakHour ||
        cnt > orgPeakHour.count ||
        (cnt === orgPeakHour.count && h < orgPeakHour.hour)
      ) {
        orgPeakHour = { hour: h, count: cnt };
      }
    }

    const avgSecondsBetweenDeliveries =
      validGapsMs.length > 0
        ? validGapsMs.reduce((sum, g) => sum + g, 0) / validGapsMs.length / 1000
        : null;

    organizerStats.push({
      organizerId: orgKey,
      organizerName: orgProfile?.name || first.log.organizerName,
      boothName: orgProfile?.boothName || undefined,
      deliveriesCount: entries.length,
      itemsBreakdown: Array.from(itemCountMap.values()),
      firstActionAt: first.effectiveTimestamp,
      lastActionAt: last.effectiveTimestamp,
      avgSecondsBetweenDeliveries,
      peakHour: orgPeakHour,
    });
  }

  organizerStats.sort((a, b) => b.deliveriesCount - a.deliveriesCount);

  // 6: Audit (undone entries for selected date, offline count, open conflicts across event)
  const detectedConflicts = detectDeliveryConflicts(logs, organizers);
  const openConflictsCount = detectedConflicts.filter((conflict) => {
    const res = conflictResolutions[conflict.conflictKey];
    return !(res && res.status === 'resolved' && conflict.deliveries.length <= res.resolvedLogCount);
  }).length;

  const undoneEntries: DayReportUndoneEntry[] = dayUndoneLogs.map((entry) => ({
    logId: entry.log.id,
    participantName: entry.log.participantName || entry.log.barcode,
    barcode: entry.log.barcode,
    itemId: entry.log.itemId,
    itemName: entry.log.itemName,
    organizerName: entry.log.organizerName,
    timestamp: entry.effectiveTimestamp,
  }));

  return {
    selectedDate,
    availableDates,
    summary: {
      totalParticipants: participants.length,
      dayDeliveriesCount: dayDeliveredLogs.length,
      uniqueParticipantsDeliveredCount: uniqueDeliveredBarcodes.size,
      overallDeliveredUnits,
      overallTotalUnits,
      overallCompletionPercent,
      firstDeliveryAt: dayDeliveredLogs[0]?.effectiveTimestamp ?? null,
      lastDeliveryAt:
        dayDeliveredLogs.length > 0
          ? dayDeliveredLogs[dayDeliveredLogs.length - 1].effectiveTimestamp
          : null,
      peakHour,
    },
    itemStats,
    organizerStats,
    hourlyBuckets,
    maxHourlyCount,
    pendingByItem,
    audit: {
      undoneCount: undoneEntries.length,
      undoneEntries,
      offlineDeliveriesCount,
      openConflictsCount,
    },
  };
}

export function buildWhatsAppDayReportSummary(
  report: DayReport,
  event: Pick<MarathonEvent, 'name' | 'date'>
): string {
  const dateLabel =
    report.selectedDate === 'all' ? `كل الأيام (${event.date})` : report.selectedDate;

  const lines: string[] = [
    `📊 *ملخص تقرير نهاية اليوم — ${event.name}*`,
    `📅 التاريخ: ${dateLabel}`,
    `✅ تسليمات اليوم: ${report.summary.dayDeliveriesCount} | الإنجاز الكلي: ${report.summary.overallCompletionPercent}%`,
    '',
    '📦 *إنجاز العناصر:*',
  ];

  if (report.itemStats.length === 0) {
    lines.push('- لا توجد مهام مسجلة');
  } else {
    for (const item of report.itemStats) {
      lines.push(
        `- ${item.itemName}: ${item.delivered}/${item.total} (${item.percentage}%) · متبقي: ${item.remaining}`
      );
    }
  }

  const topOrg = report.organizerStats[0];
  if (topOrg) {
    const boothLabel = topOrg.boothName ? ` (${topOrg.boothName})` : '';
    lines.push('');
    lines.push(
      `🏆 أنشط بوث/منظم: ${topOrg.organizerName}${boothLabel} — ${topOrg.deliveriesCount} عملية`
    );
  }

  const totalRemainingUnits = report.itemStats.reduce((sum, s) => sum + s.remaining, 0);
  lines.push(`⏳ إجمالي المتبقي عبر العناصر: ${totalRemainingUnits}`);

  return lines.join('\n');
}
