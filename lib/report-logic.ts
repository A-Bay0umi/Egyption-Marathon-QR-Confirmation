import {
  computeEventStats,
  extractParticipantDisplayName,
  isPrerequisiteMet,
} from './marathon-logic';
import type { ActivityLog, MarathonEvent, Participant } from './types';

export interface GeneralReportItemStat {
  itemId: string;
  itemName: string;
  delivered: number;
  total: number;
  remaining: number;
  percentage: number;
  prerequisiteName?: string;
  readyToReceiveCount: number;
}

export interface PendingParticipantSummary {
  barcode: string;
  name: string;
  extra: string;
  isReady: boolean;
}

export interface GeneralReportPendingItemGroup {
  itemId: string;
  itemName: string;
  pendingCount: number;
  readyCount: number;
  participants: PendingParticipantSummary[];
}

export interface GeneralReportUndoneEntry {
  logId: string;
  participantName: string;
  barcode: string;
  itemId: string;
  itemName: string;
  organizerName: string;
  timestamp: string;
}

export interface GeneralReportAuditSection {
  undoneCount: number;
  undoneEntries: GeneralReportUndoneEntry[];
  offlineDeliveriesCount: number;
}

export interface GeneralReport {
  totalParticipants: number;
  itemStats: GeneralReportItemStat[];
  pendingByItem: GeneralReportPendingItemGroup[];
  audit: GeneralReportAuditSection;
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

export interface BuildGeneralReportParams {
  event: MarathonEvent;
  participants: Participant[];
  logs: ActivityLog[];
}

export function buildGeneralReport(params: BuildGeneralReportParams): GeneralReport {
  const { event, participants, logs } = params;

  const participantByBarcode = new Map<string, Participant>();
  for (const p of participants) {
    participantByBarcode.set(p.barcode, p);
  }

  const baseStats = computeEventStats(participants, event.deliverableItems);
  const itemStats: GeneralReportItemStat[] = [];
  const pendingByItem: GeneralReportPendingItemGroup[] = [];

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
    });

    pendingByItem.push({
      itemId: item.id,
      itemName: item.name,
      pendingCount: pendingParticipants.length,
      readyCount: readyToReceiveCount,
      participants: pendingParticipants,
    });
  }

  let offlineDeliveriesCount = 0;
  const undoneWithMs: Array<{ entry: GeneralReportUndoneEntry; ms: number }> = [];

  for (const log of logs) {
    if (log.action === 'delivered' && log.viaOffline) {
      offlineDeliveriesCount += 1;
    } else if (log.action === 'undone') {
      const ts = resolveLogEffectiveTimestamp(log, participantByBarcode);
      undoneWithMs.push({
        ms: Date.parse(ts) || Date.parse(log.timestamp) || 0,
        entry: {
          logId: log.id,
          participantName: log.participantName || log.barcode,
          barcode: log.barcode,
          itemId: log.itemId,
          itemName: log.itemName,
          organizerName: log.organizerName,
          timestamp: ts,
        },
      });
    }
  }

  undoneWithMs.sort((a, b) => b.ms - a.ms);
  const undoneEntries = undoneWithMs.map((u) => u.entry);

  return {
    totalParticipants: participants.length,
    itemStats,
    pendingByItem,
    audit: {
      undoneCount: undoneEntries.length,
      undoneEntries,
      offlineDeliveriesCount,
    },
  };
}

export function buildWhatsAppGeneralReportSummary(
  report: GeneralReport,
  event: Pick<MarathonEvent, 'name' | 'date'>
): string {
  const lines: string[] = [
    `📊 *التقرير العام — ${event.name}*`,
    `👥 إجمالي المتسابقين: ${report.totalParticipants}`,
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

  const totalRemainingUnits = report.itemStats.reduce((sum, s) => sum + s.remaining, 0);
  lines.push('');
  lines.push(`⏳ إجمالي المتبقي عبر العناصر: ${totalRemainingUnits}`);

  return lines.join('\n');
}
