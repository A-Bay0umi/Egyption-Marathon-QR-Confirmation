import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayReport,
  buildWhatsAppDayReportSummary,
  getCairoDateKey,
  getCairoHour,
  resolveLogEffectiveTimestamp,
} from './report-logic';
import type { ActivityLog, MarathonEvent, Organizer, Participant } from './types';

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

const organizers: Organizer[] = [
  {
    id: 'org_1',
    eventId: 'evt_report_1',
    name: 'كريم طارق',
    boothName: 'بوث A',
    assignedItems: ['reg', 'tshirt'],
    magicToken: 'TOK1',
    isActive: true,
    deliveredCount: 3,
    createdAt: '2026-11-19T08:00:00Z',
  },
  {
    id: 'org_2',
    eventId: 'evt_report_1',
    name: 'ندى سمير',
    boothName: 'بوث B',
    assignedItems: ['tshirt'],
    magicToken: 'TOK2',
    isActive: true,
    deliveredCount: 1,
    createdAt: '2026-11-19T08:00:00Z',
  },
];

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
        deliveredAt: '2026-11-20T08:00:00Z', // 10:00 Cairo
      },
      tshirt: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'كريم طارق',
        deliveredAt: '2026-11-20T08:05:00Z', // 10:05 Cairo
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
        deliveredAt: '2026-11-20T09:10:00Z', // 11:10 Cairo (after 65m break)
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

test('getCairoDateKey and getCairoHour use Africa/Cairo timezone accurately via Intl', () => {
  // 2026-11-20T22:30:00Z is 2026-11-21T00:30:00 in Africa/Cairo (UTC+2 in November)
  assert.equal(getCairoDateKey('2026-11-20T22:30:00Z'), '2026-11-21');
  assert.equal(getCairoHour('2026-11-20T22:30:00Z'), 0);
  assert.equal(getCairoDateKey('2026-11-20T08:05:00Z'), '2026-11-20');
  assert.equal(getCairoHour('2026-11-20T08:05:00Z'), 10);
});

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

  // Legacy log without clientDeliveredAt uses participant record's deliveredAt instead of delayed sync timestamp
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

  // Undone or missing delivery record falls back to timestamp
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

test('buildDayReport computes summary, prerequisite readiness, organizer average excluding >30m breaks, hourly chart, pending list, and audit stats', () => {
  const logs: ActivityLog[] = [
    // Organizer 1: 10:00, 10:05 (5 min gap), then 11:10 (65 min break -> ignored!)
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
      timestamp: '2026-11-20T08:00:00Z',
      clientDeliveredAt: '2026-11-20T08:00:00Z',
      viaOffline: false,
    },
    {
      id: 'log_2',
      eventId: 'evt_report_1',
      participantName: 'محمد عادل',
      barcode: 'R-101',
      itemId: 'tshirt',
      itemName: 'التيشيرت',
      organizerId: 'org_1',
      organizerName: 'كريم طارق',
      action: 'delivered',
      timestamp: '2026-11-20T08:05:00Z',
      clientDeliveredAt: '2026-11-20T08:05:00Z',
      viaOffline: true,
    },
    {
      id: 'log_3',
      eventId: 'evt_report_1',
      participantName: 'سلمى حسام',
      barcode: 'R-102',
      itemId: 'reg',
      itemName: 'التسجيل',
      organizerId: 'org_1',
      organizerName: 'كريم طارق',
      action: 'delivered',
      timestamp: '2026-11-20T09:10:00Z',
      clientDeliveredAt: '2026-11-20T09:10:00Z',
      viaOffline: true,
    },
    // Duplicate offline conflict on R-101 tshirt from Organizer 2 at 11:20 (hour 13:20 Cairo? 11:20Z -> 13:20 Cairo)
    {
      id: 'log_4',
      eventId: 'evt_report_1',
      participantName: 'محمد عادل',
      barcode: 'R-101',
      itemId: 'tshirt',
      itemName: 'التيشيرت',
      organizerId: 'org_2',
      organizerName: 'ندى سمير',
      action: 'delivered',
      timestamp: '2026-11-20T12:00:00Z', // Synced later
      clientDeliveredAt: '2026-11-20T08:06:00Z', // Delivered offline at 10:06 Cairo!
      viaOffline: true,
    },
    // Undone log on that day
    {
      id: 'log_5',
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
    // Different day log (excluded when filtering 2026-11-20; later undone by log_5)
    {
      id: 'log_prev',
      eventId: 'evt_report_1',
      participantName: 'يوسف نبيل',
      barcode: 'R-103',
      itemId: 'reg',
      itemName: 'التسجيل',
      organizerId: 'org_1',
      organizerName: 'كريم طارق',
      action: 'delivered',
      timestamp: '2026-11-19T08:00:00Z',
      clientDeliveredAt: '2026-11-19T08:00:00Z',
    },
  ];

  const report = buildDayReport({
    event: sampleEvent,
    participants,
    organizers,
    logs,
    conflictResolutions: {},
    selectedDate: '2026-11-20',
  });

  // Summary checks
  assert.equal(report.summary.totalParticipants, 3);
  assert.equal(report.summary.dayDeliveriesCount, 4);
  assert.equal(report.summary.firstDeliveryAt, '2026-11-20T08:00:00Z');
  assert.equal(report.summary.lastDeliveryAt, '2026-11-20T09:10:00Z');
  // Hour 10 Cairo had 3 deliveries (08:00Z, 08:05Z, 08:06Z), Hour 11 Cairo had 1 delivery (09:10Z)
  assert.deepEqual(report.summary.peakHour, { hour: 10, count: 3 });

  // Item stats + readyToReceiveCount (R-102 completed reg so ready for tshirt; R-103 pending for reg)
  assert.equal(report.itemStats[0].delivered, 2);
  assert.equal(report.itemStats[0].total, 3);
  assert.equal(report.itemStats[0].remaining, 1);
  assert.equal(report.itemStats[0].readyToReceiveCount, 1); // R-103

  assert.equal(report.itemStats[1].delivered, 1);
  assert.equal(report.itemStats[1].total, 2); // R-101 & R-102 eligible
  assert.equal(report.itemStats[1].remaining, 1);
  assert.equal(report.itemStats[1].readyToReceiveCount, 1); // R-102

  // Organizer 1 stats: gaps are 5m (300s) and 65m (>30m break ignored) => avg = 300s!
  assert.equal(report.organizerStats[0].organizerId, 'org_1');
  assert.equal(report.organizerStats[0].boothName, 'بوث A');
  assert.equal(report.organizerStats[0].deliveriesCount, 3);
  assert.equal(report.organizerStats[0].avgSecondsBetweenDeliveries, 300);
  assert.deepEqual(report.organizerStats[0].peakHour, { hour: 10, count: 2 });

  // Pending list per item
  assert.equal(report.pendingByItem[0].pendingCount, 1);
  assert.equal(report.pendingByItem[0].participants[0].name, 'يوسف نبيل');
  assert.equal(report.pendingByItem[1].pendingCount, 2); // R-102 & R-103 haven't received tshirt

  // Audit checks
  assert.equal(report.audit.undoneCount, 1);
  assert.equal(report.audit.offlineDeliveriesCount, 3);
  assert.equal(report.audit.openConflictsCount, 1);

  // WhatsApp summary contains event name, date, items, top booth
  const waText = buildWhatsAppDayReportSummary(report, sampleEvent);
  assert.equal(waText.includes('ماراثون الساحل 2026'), true);
  assert.equal(waText.includes('2026-11-20'), true);
  assert.equal(waText.includes('كريم طارق'), true);
  assert.equal(waText.includes('بوث A'), true);

  // All-days filter includes log_prev as well
  const allDays = buildDayReport({
    event: sampleEvent,
    participants,
    organizers,
    logs,
    conflictResolutions: {},
    selectedDate: 'all',
  });
  assert.equal(allDays.summary.dayDeliveriesCount, 5);
  assert.deepEqual(allDays.availableDates, ['2026-11-20', '2026-11-19']);
});
