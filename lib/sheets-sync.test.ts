import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppsScriptPayload,
  buildDefaultSheetsColumns,
  computeEventSheetsSnapshot,
  computeParticipantDeliveriesFingerprint,
  formatDeliveryTime12hEn,
  generateGoogleAppsScriptCode,
  getEffectiveSheetsColumns,
  isValidAppsScriptUrl,
} from './sheets-sync';
import type { MarathonEvent, Organizer, Participant, SheetsColumnMapping } from './types';

test('formatDeliveryTime12hEn formats Africa/Cairo time with seconds in 12-hour English digits', () => {
  // 2026-11-20T12:05:33Z = 14:05:33 Cairo = 02:05:33 PM
  assert.equal(formatDeliveryTime12hEn('2026-11-20T12:05:33Z'), '2026-11-20 02:05:33 PM');
  // 2026-11-20T22:09:07Z = 2026-11-21 00:09:07 Cairo = 12:09:07 AM
  assert.equal(formatDeliveryTime12hEn('2026-11-20T22:09:07Z'), '2026-11-21 12:09:07 AM');
  assert.equal(formatDeliveryTime12hEn(''), '');
  assert.equal(formatDeliveryTime12hEn('invalid'), '');
});

test('isValidAppsScriptUrl only allows HTTPS script.google.com endpoints', () => {
  assert.equal(
    isValidAppsScriptUrl('https://script.google.com/macros/s/AKfycb123/exec'),
    true
  );
  assert.equal(isValidAppsScriptUrl('http://script.google.com/macros/s/x/exec'), false);
  assert.equal(isValidAppsScriptUrl('https://evil.example.com/exec'), false);
  assert.equal(isValidAppsScriptUrl(''), false);
});

test('buildAppsScriptPayload prepares item delivery status, 12h English time, and organizer booth label', () => {
  const event: Pick<
    MarathonEvent,
    | 'id'
    | 'name'
    | 'deliverableItems'
    | 'displayFields'
    | 'nameField'
    | 'sheetsWebhookSecret'
    | 'sheetsColumns'
  > = {
    id: 'evt_1',
    name: 'ماراثون القاهرة',
    deliverableItems: [
      { id: 'tshirt', name: 'التيشيرت' },
      { id: 'medal', name: 'الميدالية' },
    ],
    displayFields: ['الاسم'],
    nameField: 'الاسم',
    sheetsWebhookSecret: 'sec_99',
  };

  const organizers: Organizer[] = [
    {
      id: 'org_1',
      eventId: 'evt_1',
      name: 'كريم طارق',
      boothName: 'بوث A',
      assignedItems: ['tshirt'],
      magicToken: 'TOK1',
      isActive: true,
      deliveredCount: 1,
      createdAt: '2026-11-20T08:00:00Z',
    },
  ];

  const participants: Participant[] = [
    {
      barcode: 'R 101',
      searchKeywords: ['R101'],
      dynamicData: { الاسم: 'محمد عادل' },
      deliveries: {
        tshirt: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_1',
          deliveredByOrganizerName: 'كريم طارق',
          deliveredAt: '2026-11-20T12:05:33Z',
        },
      },
    },
  ];

  const payload = buildAppsScriptPayload({
    event,
    organizers,
    participants,
    mode: 'upsert',
  });

  assert.equal(payload.secret, 'sec_99');
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].barcode, 'R-101');
  assert.equal(payload.rows[0].deliveries.tshirt.statusText, 'Delivered');
  assert.equal(payload.rows[0].deliveries.tshirt.deliveredAt12h, '2026-11-20 02:05:33 PM');
  assert.equal(payload.rows[0].deliveries.tshirt.deliveredByLabel, 'كريم طارق (بوث A)');
  assert.equal(payload.rows[0].deliveries.medal.statusText, 'Not Delivered');
  assert.equal(payload.rows[0].deliveries.medal.deliveredAt12h, '');

  const fpBefore = computeParticipantDeliveriesFingerprint(participants[0]);
  assert.equal(fpBefore.includes('tshirt:delivered:org_1:2026-11-20T12:05:33Z'), true);

  const snap1 = computeEventSheetsSnapshot({ event, organizers, participants });
  const snap2 = computeEventSheetsSnapshot({
    event,
    organizers,
    participants: [
      ...participants,
      {
        barcode: 'R-102',
        searchKeywords: ['R102'],
        dynamicData: { الاسم: 'سارة علي' },
        deliveries: {},
      },
    ],
  });
  const snap3 = computeEventSheetsSnapshot({
    event: {
      ...event,
      sheetsColumns: [{ id: 'c1', header: 'Ticket', sourceType: 'barcode' }],
    },
    organizers,
    participants,
  });
  assert.notEqual(snap1, snap2);
  assert.notEqual(snap1, snap3);
});

test('buildDefaultSheetsColumns and getEffectiveSheetsColumns resolve custom vs default column mappings', () => {
  const baseEvent = {
    deliverableItems: [{ id: 'kit', name: 'Race Kit' }],
    displayFields: ['Tkt Number', 'Name', 'Distance', 'Size'],
    nameField: 'Name',
  };

  const defaults = buildDefaultSheetsColumns(baseEvent);
  assert.deepEqual(
    defaults.map((c) => c.header),
    [
      'Tkt Number',
      'Name',
      'Distance',
      'Size',
      'Race Kit - Status',
      'Race Kit - Delivery Time',
      'Race Kit - Organizer',
    ]
  );

  const customCols: SheetsColumnMapping[] = [
    { id: 'c1', header: 'TKT', sourceType: 'barcode' },
    { id: 'c2', header: 'Runner', sourceType: 'participant_name' },
    { id: 'c3', header: 'Size', sourceType: 'dynamic_field', fieldKey: 'Size' },
    { id: 'c4', header: 'Kit State', sourceType: 'item_status', itemId: 'kit' },
  ];
  assert.deepEqual(
    getEffectiveSheetsColumns({ ...baseEvent, sheetsColumns: customCols }),
    customCols
  );
});

test('generateGoogleAppsScriptCode embeds custom SHEET_COLUMNS, full reset, and orange/centered formatting', () => {
  const customCols: SheetsColumnMapping[] = [
    { id: 'c1', header: 'Ticket No', sourceType: 'barcode' },
    { id: 'c2', header: 'Shirt Size', sourceType: 'dynamic_field', fieldKey: 'Size' },
    { id: 'c3', header: 'Booth', sourceType: 'item_booth', itemId: 'kit' },
  ];
  const code = generateGoogleAppsScriptCode("my'secret", customCols);
  assert.equal(code.includes("const SECRET = 'my\\'secret';"), true);
  assert.equal(code.includes('LockService.getScriptLock()'), true);
  assert.equal(code.includes('function resolveColumnValue(col, entry)'), true);
  assert.equal(code.includes('"header": "Ticket No"'), true);
  assert.equal(code.includes('"fieldKey": "Size"'), true);
  assert.equal(code.includes('"sourceType": "item_booth"'), true);
  assert.equal(code.includes("const isReset = data.mode === 'full';"), true);
  assert.equal(code.includes('sheet.clearContents();'), true);
  assert.equal(code.includes('sheet.clearFormats();'), true);
  assert.equal(code.includes(".setFontColor('#000000')"), true);
  assert.equal(code.includes(".setFontWeight('bold')"), true);
  assert.equal(code.includes(".setBackground('#FF9800')"), true);
  assert.equal(code.includes(".setHorizontalAlignment('center')"), true);
  assert.equal(code.includes(".setVerticalAlignment('middle')"), true);
});
