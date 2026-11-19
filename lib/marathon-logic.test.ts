import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminUndoDelivery,
  attemptLocalDelivery,
  autoSuggestColumnMapping,
  computeEventStats,
  extractParticipantDisplayName,
  generateSearchKeywords,
  isPrerequisiteMet,
  matchesSearchQuery,
  normalizeBarcode,
  wouldCreateDependencyCycle,
} from './marathon-logic';
import {
  buildOrganizerMagicUrl,
  buildOrganizerWhatsAppHref,
  buildOrganizerWhatsAppMessage,
  normalizeWhatsAppPhone,
  parseOrganizerMagicInput,
  verifyAdminPasscode,
} from './admin-auth';
import type { DeliverableItem, MarathonEvent, Organizer, Participant } from './types';

const sampleOrganizer: Organizer = {
  id: 'org_1',
  eventId: 'evt_1',
  name: 'أحمد حسن',
  boothName: 'بوث A - تيشيرتات',
  assignedItems: ['tshirt', 'bib'],
  magicToken: 'TOKEN_A',
  isActive: true,
  deliveredCount: 10,
  createdAt: '2026-11-18T10:00:00Z',
};

const sampleParticipant: Participant = {
  barcode: 'RUN-1042',
  searchKeywords: generateSearchKeywords(
    {
      الاسم: 'علي محمد إبراهيم',
      'رقم الصدر': '1042',
      'رقم الموبايل': '01012348891',
      'مقاس التيشيرت': 'L',
    },
    ['الاسم', 'رقم الصدر', 'رقم الموبايل'],
    'RUN-1042'
  ),
  dynamicData: {
    الاسم: 'علي محمد إبراهيم',
    'رقم الصدر': '1042',
    'رقم الموبايل': '01012348891',
    'مقاس التيشيرت': 'L',
  },
  deliveries: {},
};

const tshirtItem: DeliverableItem = { id: 'tshirt', name: 'التيشيرت' };
const bagItem: DeliverableItem = { id: 'bag', name: 'شنطة المتسابق' };

test('normalizeBarcode converts Eastern Arabic digits and strips invalid chars', () => {
  assert.equal(normalizeBarcode('  ١٠٤٢  '), '1042');
  assert.equal(normalizeBarcode('RUN 1042!'), 'RUN-1042');
});

test('matchesSearchQuery matches by 3-char Arabic prefix, bib, barcode, and last 4 phone digits', () => {
  assert.equal(matchesSearchQuery(sampleParticipant, 'علي'), true);
  assert.equal(matchesSearchQuery(sampleParticipant, '8891'), true);
  assert.equal(matchesSearchQuery(sampleParticipant, '1042'), true);
  assert.equal(matchesSearchQuery(sampleParticipant, 'RUN-1042'), true);
  assert.equal(matchesSearchQuery(sampleParticipant, '9999'), false);
});

test('attemptLocalDelivery succeeds for undelivered assigned item and increments counter', () => {
  const res = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: sampleParticipant,
    organizer: sampleOrganizer,
    item: tshirtItem,
    displayFields: ['الاسم', 'مقاس التيشيرت'],
    nowIso: '2026-11-18T11:00:00Z',
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.updatedParticipant.deliveries.tshirt.status, 'delivered');
    assert.equal(res.updatedParticipant.deliveries.tshirt.deliveredByOrganizerName, 'أحمد حسن');
    assert.equal(res.updatedOrganizer.deliveredCount, 11);
    assert.equal(res.logEntry.action, 'delivered');
    assert.equal(res.logEntry.participantName, 'علي محمد إبراهيم');
  }
});

test('attemptLocalDelivery blocks duplicate delivery (anti-fraud check)', () => {
  const first = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: sampleParticipant,
    organizer: sampleOrganizer,
    item: tshirtItem,
    displayFields: ['الاسم'],
    nowIso: '2026-11-18T11:00:00Z',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: first.updatedParticipant,
    organizer: first.updatedOrganizer,
    item: tshirtItem,
    displayFields: ['الاسم'],
    nowIso: '2026-11-18T11:05:00Z',
  });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, 'already_delivered');
    assert.equal(second.existingDelivery?.deliveredByOrganizerName, 'أحمد حسن');
  }
});

test('attemptLocalDelivery blocks frozen organizer and unassigned item', () => {
  const frozenRes = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: sampleParticipant,
    organizer: { ...sampleOrganizer, isActive: false },
    item: tshirtItem,
    displayFields: ['الاسم'],
  });
  assert.equal(frozenRes.ok, false);
  if (!frozenRes.ok) assert.equal(frozenRes.reason, 'organizer_frozen');

  const unassignedRes = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: sampleParticipant,
    organizer: sampleOrganizer,
    item: bagItem,
    displayFields: ['الاسم'],
  });
  assert.equal(unassignedRes.ok, false);
  if (!unassignedRes.ok) assert.equal(unassignedRes.reason, 'unauthorized_item');
});

test('adminUndoDelivery clears delivery status and records undone audit log', () => {
  const delivered: Participant = {
    ...sampleParticipant,
    deliveries: {
      tshirt: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'أحمد حسن',
        deliveredAt: '2026-11-18T11:00:00Z',
      },
    },
  };
  const { updatedParticipant, logEntry } = adminUndoDelivery({
    eventId: 'evt_1',
    participant: delivered,
    item: tshirtItem,
    adminName: 'مدير النظام',
    displayFields: ['الاسم'],
  });
  assert.equal(updatedParticipant.deliveries.tshirt, undefined);
  assert.equal(logEntry.action, 'undone');
});

test('computeEventStats and autoSuggestColumnMapping return accurate output', () => {
  const p2: Participant = {
    ...sampleParticipant,
    barcode: 'RUN-1043',
    deliveries: {
      tshirt: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'أحمد حسن',
        deliveredAt: '2026-11-18T11:00:00Z',
      },
    },
  };
  const stats = computeEventStats([sampleParticipant, p2], [tshirtItem, bagItem]);
  assert.equal(stats[0].delivered, 1);
  assert.equal(stats[0].percentage, 50);
  assert.equal(stats[1].delivered, 0);

  const mapping = autoSuggestColumnMapping([
    'Barcode',
    'الاسم الكامل',
    'رقم الموبايل',
    'مقاس التيشيرت',
    'رقم الصدر',
  ]);
  assert.equal(mapping.barcodeField, 'Barcode');
  assert.equal(mapping.nameField, 'الاسم الكامل');
  assert.equal(mapping.searchFields.includes('الاسم الكامل'), true);
  assert.equal(mapping.displayFields.includes('مقاس التيشيرت'), true);

  const customParticipant: Participant = {
    barcode: 'RUN-200',
    searchKeywords: [],
    dynamicData: {
      'Event Name': 'Cairo Marathon',
      Runner: 'سارة علي',
      'Full Name': 'Sara Ali',
    },
    deliveries: {},
  };
  assert.equal(
    extractParticipantDisplayName(customParticipant, ['Runner'], 'Runner'),
    'سارة علي'
  );
  assert.equal(
    extractParticipantDisplayName(customParticipant, ['Runner'], 'Full Name'),
    'Sara Ali'
  );
});

test('verifyAdminPasscode validates NR@2026 strictly', () => {
  assert.equal(verifyAdminPasscode('NR@2026'), true);
  assert.equal(verifyAdminPasscode('  NR@2026  '), true);
  assert.equal(verifyAdminPasscode('NR@2026'), false);
  assert.equal(verifyAdminPasscode('wrong'), false);
});

test('normalizeWhatsAppPhone and organizer event magic links build cleanly with Arabic text', () => {
  assert.equal(normalizeWhatsAppPhone('01012345678'), '201012345678');
  assert.equal(normalizeWhatsAppPhone('+20 101-234-5678'), '201012345678');
  assert.equal(normalizeWhatsAppPhone('123'), '');

  const evt: MarathonEvent = {
    id: 'evt_1',
    name: 'ماراثون الإسكندرية',
    date: '2026-12-01',
    isActive: true,
    deliverableItems: [tshirtItem, bagItem],
    displayFields: ['الاسم'],
    searchFields: ['الاسم'],
    totalParticipants: 100,
    ownerUid: 'admin',
    createdAt: '2026-11-18T10:00:00Z',
  };
  const orgWithPhone: Organizer = {
    ...sampleOrganizer,
    assignedItems: ['tshirt', 'bag'],
    whatsappPhone: '201012345678',
  };

  const url = buildOrganizerMagicUrl('https://example.com/', orgWithPhone, 'evt_1');
  assert.equal(url, 'https://example.com/?event=evt_1&token=TOKEN_A');

  const msg = buildOrganizerWhatsAppMessage(url, orgWithPhone, evt);
  assert.equal(msg.includes('ماراثون الإسكندرية'), true);
  assert.equal(msg.includes('التيشيرت، شنطة المتسابق'), true);
  assert.equal(msg.includes(url), true);

  const waHref = buildOrganizerWhatsAppHref(url, orgWithPhone, evt);
  assert.equal(waHref.startsWith('https://wa.me/201012345678?text='), true);

  // Test standalone PWA paste parser on full URL, WhatsApp message, and compact code
  assert.deepEqual(parseOrganizerMagicInput(url), { eventId: 'evt_1', token: 'TOKEN_A' });
  assert.deepEqual(parseOrganizerMagicInput(msg), { eventId: 'evt_1', token: 'TOKEN_A' });
  assert.deepEqual(parseOrganizerMagicInput('evt_123:ORG-XYZ999'), {
    eventId: 'evt_123',
    token: 'ORG-XYZ999',
  });
  assert.equal(parseOrganizerMagicInput('random invalid text'), null);
});

test('sequential task prerequisites block premature delivery and chain progress counters', () => {
  const regItem: DeliverableItem = { id: 'reg', name: 'التسجيل' };
  const chainedTshirt: DeliverableItem = {
    id: 'tshirt',
    name: 'التيشيرت',
    dependsOnItemId: 'reg',
  };
  const chainedMedal: DeliverableItem = {
    id: 'medal',
    name: 'الميدالية',
    dependsOnItemId: 'tshirt',
  };
  const allItems = [regItem, chainedTshirt, chainedMedal];

  assert.equal(wouldCreateDependencyCycle(allItems, 'reg', 'medal'), true);
  assert.equal(wouldCreateDependencyCycle(allItems, 'medal', 'reg'), false);
  assert.equal(isPrerequisiteMet(sampleParticipant, chainedTshirt, allItems), false);

  const blocked = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: sampleParticipant,
    organizer: sampleOrganizer,
    item: chainedTshirt,
    displayFields: ['الاسم'],
    allItems,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.reason, 'prerequisite_not_met');
    assert.equal(blocked.missingItemName, 'التسجيل');
  }

  // Participant 1 completes Registration + T-shirt; Participant 2 completes Registration only; Participant 3 nothing
  const p1: Participant = {
    ...sampleParticipant,
    barcode: 'RUN-1',
    deliveries: {
      reg: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'أحمد حسن',
        deliveredAt: '2026-11-18T10:00:00Z',
      },
      tshirt: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'أحمد حسن',
        deliveredAt: '2026-11-18T10:05:00Z',
      },
    },
  };
  const p2: Participant = {
    ...sampleParticipant,
    barcode: 'RUN-2',
    deliveries: {
      reg: {
        status: 'delivered',
        deliveredByOrganizerId: 'org_1',
        deliveredByOrganizerName: 'أحمد حسن',
        deliveredAt: '2026-11-18T10:01:00Z',
      },
    },
  };
  const p3: Participant = { ...sampleParticipant, barcode: 'RUN-3', deliveries: {} };

  // Now p2 CAN receive T-shirt because reg is complete
  const allowed = attemptLocalDelivery({
    eventId: 'evt_1',
    participant: p2,
    organizer: sampleOrganizer,
    item: chainedTshirt,
    displayFields: ['الاسم'],
    allItems,
  });
  assert.equal(allowed.ok, true);

  const stats = computeEventStats([p1, p2, p3], allItems);
  // Registration: 2 / 3 total participants (67%)
  assert.equal(stats[0].delivered, 2);
  assert.equal(stats[0].total, 3);
  // T-shirt: 1 / 2 who completed Registration (50%)
  assert.equal(stats[1].delivered, 1);
  assert.equal(stats[1].total, 2);
  assert.equal(stats[1].percentage, 50);
  assert.equal(stats[1].prerequisiteName, 'التسجيل');
  // Medal: 0 / 1 who completed T-shirt (0%)
  assert.equal(stats[2].delivered, 0);
  assert.equal(stats[2].total, 1);
  assert.equal(stats[2].prerequisiteName, 'التيشيرت');
});



