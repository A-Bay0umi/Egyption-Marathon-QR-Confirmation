import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeneralReport,
  buildWhatsAppGeneralReportSummary,
  resolveLogEffectiveTimestamp,
} from './report-logic';
import type { ActivityLog, MarathonEvent, Participant } from './types';

const sampleEvent: MarathonEvent = {
  id: 'evt_report_1',
  name: 'ماراثون الساحل 2026',
  date: '2026-11-20',
  isActive: true,
  deliverableItems: [
    { id: 'reg', name: 'التسجيل' },
    { id: 'tshirt', name: 'التيشيرت', dependsOnItemId: 'reg' },
  ],
  displayFields: ['الاسم', 'مقاس التيشيرت'],
  searchFields: ['الاسم'],
  totalParticipants: 3,
  ownerUid: 'admin',
  createdAt: '2026-11-19T08:00:00Z',
};

const participants: Participant[] = [
  {
    barcode: 'R-101',
    searchKeywords: ['محمد'],
    dynamicData: { الاسم: 'محمد عادل', 'مقاس التيشيرت': 'L' },
    deliveries: {
      reg: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'كريم طارق',
        deliveredAt: '2026-11-20T08:00:00Z',
      },
      tshirt: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'كريم طارق',
        deliveredAt: '2026-11-20T08:05:00Z',
      },
    },
  },
  {
    barcode: 'R-102',
    searchKeywords: ['سلمى'],
    dynamicData: { الاسم: 'سلمى حسام', 'مقاس التيشيرت': 'M' },
    deliveries: {
      reg: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'كريم طارق',
        deliveredAt: '2026-11-20T09:10:00Z',
      },
    },
  },
  {
    barcode: 'R-103',
    searchKeywords: ['يوسف'],
    dynamicData: { الاسم: 'يوسف نبيل', 'مقاس التيشيرت': 'XL' },
    deliveries: {},
  },
];

test('resolveLogEffectiveTimestamp falls back from clientDeliveredAt -> participant.deliveries.deliveredAt -> timestamp', () => {
  const pMap = new Map(participants.map((p) => [p.barcode, p]));

  const withClient: ActivityLog = {
    id: 'l1',
    eventId: 'evt_report_1',
    participantName: 'محمد عادل',
    barcode: 'R-101',
    itemId: 'reg',
    itemName: 'التسجيل',
    organizerId: 'org_1',
    organizerName: 'كريم طارق',
    action: 'delivered',
    timestamp: '2026-11-20T15:00:00Z',
    clientDeliveredAt: '2026-11-20T08:00:00Z',
  };
  assert.equal(resolveLogEffectiveTimestamp(withClient, pMap), '2026-11-20T08:00:00Z');

  const legacyWithDeliveryRecord: ActivityLog = {
    id: 'l2',
    eventId: 'evt_report_1',
    participantName: 'محمد عادل',
    barcode: 'R-101',
    itemId: 'tshirt',
    itemName: 'التيشيرت',
    organizerId: 'org_1',
    organizerName: 'كريم طارق',
    action: 'delivered',
    timestamp: '2026-11-20T18:00:00Z',
  };
  assert.equal(resolveLogEffectiveTimestamp(legacyWithDeliveryRecord, pMap), '2026-11-20T08:05:00Z');

  const legacyFallback: ActivityLog = {
    id: 'l3',
    eventId: 'evt_report_1',
    participantName: 'يوسف نبيل',
    barcode: 'R-103',
    itemId: 'reg',
    itemName: 'التسجيل',
    organizerId: 'admin',
    organizerName: 'مدير السباق',
    action: 'undone',
    timestamp: '2026-11-20T12:00:00Z',
  };
  assert.equal(resolveLogEffectiveTimestamp(legacyFallback, pMap), '2026-11-20T12:00:00Z');
});

test('buildGeneralReport computes item stats, prerequisite readiness, pending participants, and general audit across all days', () => {
  const logs: ActivityLog[] = [
    {
      id: 'log_1',
      eventId: 'evt_report_1',
      participantName: 'محمد عادل',
      barcode: 'R-101',
      itemId: 'reg',
      itemName: 'التسجيل',
      organizerId: 'org_1',
      organizerName: 'كريم طارق',
      action: 'delivered',
      timestamp: '2026-11-19T08:00:00Z',
      clientDeliveredAt: '2026-11-19T08:00:00Z',
      viaOffline: true,
    },
    {
      id: 'log_2',
      eventId: 'evt_report_1',
      participantName: 'سلمى حسام',
      barcode: 'R-102',
      itemId: 'reg',
      itemName: 'التسجيل',
      organizerId: 'org_1',
      organizerName: 'كريم طارق',
      action: 'delivered',
      timestamp: '2026-11-20T09:10:00Z',
      viaOffline: true,
    },
    {
      id: 'log_3',
      eventId: 'evt_report_1',
      participantName: 'يوسف نبيل',
      barcode: 'R-103',
      itemId: 'reg',
      itemName: 'التسجيل',
      organizerId: 'admin',
      organizerName: 'مدير السباق',
      action: 'undone',
      timestamp: '2026-11-20T10:00:00Z',
    },
  ];

  const report = buildGeneralReport({
    event: sampleEvent,
    participants,
    logs,
  });

  assert.equal(report.totalParticipants, 3);

  // Item stats + readyToReceiveCount
  assert.equal(report.itemStats[0].delivered, 2);
  assert.equal(report.itemStats[0].total, 3);
  assert.equal(report.itemStats[0].remaining, 1);
  assert.equal(report.itemStats[0].readyToReceiveCount, 1);

  assert.equal(report.itemStats[1].delivered, 1);
  assert.equal(report.itemStats[1].total, 2);
  assert.equal(report.itemStats[1].remaining, 1);
  assert.equal(report.itemStats[1].readyToReceiveCount, 1);

  // Pending list
  assert.equal(report.pendingByItem[0].pendingCount, 1);
  assert.equal(report.pendingByItem[0].participants[0].name, 'يوسف نبيل');
  assert.equal(report.pendingByItem[1].pendingCount, 2);

  // Audit (undone & offline counts, no conflicts)
  assert.equal(report.audit.undoneCount, 1);
  assert.equal(report.audit.offlineDeliveriesCount, 2);

  const waText = buildWhatsAppGeneralReportSummary(report, sampleEvent);
  assert.equal(waText.includes('ماراثون الساحل 2026'), true);
  assert.equal(waText.includes('التيشيرت'), true);
  assert.equal(waText.includes('إجمالي المتسابقين: 3'), true);
});
