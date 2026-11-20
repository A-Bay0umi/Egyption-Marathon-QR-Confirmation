import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppsScriptPayload,
  computeParticipantDeliveriesFingerprint,
  formatDeliveryTime12hEn,
  generateGoogleAppsScriptCode,
  isValidAppsScriptUrl,
} from './sheets-sync';
import type { MarathonEvent, Organizer, Participant } from './types';

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
    'id' | 'name' | 'deliverableItems' | 'displayFields' | 'nameField' | 'sheetsWebhookSecret'
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
});

test('generateGoogleAppsScriptCode embeds secret, English headers, and orange/centered formatting', () => {
  const code = generateGoogleAppsScriptCode("my'secret");
  assert.equal(code.includes("const SECRET = 'my\\'secret';"), true);
  assert.equal(code.includes('LockService.getScriptLock()'), true);
  assert.equal(code.includes('function doPost(e)'), true);
  assert.equal(code.includes("headers = ['Tkt Number', 'Name'];"), true);
  assert.equal(code.includes("item.name + ' - Status'"), true);
  assert.equal(code.includes("item.name + ' - Delivery Time'"), true);
  assert.equal(code.includes("item.name + ' - Organizer'"), true);
  assert.equal(code.includes(".setFontColor('#000000')"), true);
  assert.equal(code.includes(".setFontWeight('bold')"), true);
  assert.equal(code.includes(".setBackground('#FF9800')"), true);
  assert.equal(code.includes(".setHorizontalAlignment('center')"), true);
  assert.equal(code.includes(".setVerticalAlignment('middle')"), true);
});
