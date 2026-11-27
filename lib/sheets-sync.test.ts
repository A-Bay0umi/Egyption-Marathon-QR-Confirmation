import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppsScriptPayload,
  buildDefaultColorRules,
  buildDefaultSheetsColumns,
  buildSheetsRuleFormula,
  checkColorRulesPriority,
  columnIndexToLetter,
  compileColorRulesForAppsScript,
  computeEventSheetsSnapshot,
  computeParticipantDeliveriesFingerprint,
  evaluateColorRulesForRow,
  formatDeliveryTime12hEn,
  generateGoogleAppsScriptCode,
  getEffectiveSheetsColumns,
  isValidAppsScriptUrl,
  sortColorRulesByPriority,
} from './sheets-sync';
import type {
  MarathonEvent,
  Organizer,
  Participant,
  SheetsColorRule,
  SheetsColumnMapping,
} from './types';

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

test('generateGoogleAppsScriptCode preserves conditional formatting and embeds dynamic SHEET_COLOR_RULES', () => {
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
  // Forbidden format/row wiping calls must never exist
  assert.equal(code.includes('.clear('), false);
  assert.equal(code.includes('clearFormats'), false);
  assert.equal(code.includes('deleteRows'), false);
  assert.equal(code.includes('deleteRow('), false);
  // Required conditional-formatting-safe operations
  assert.equal(code.includes('.clearContent()'), true);
  assert.equal(code.includes('.setValues(outputRows)'), true);
  assert.equal(code.includes('function applyColorRules(sheet, totalCols, rulesToApply)'), true);
  assert.equal(code.includes('applyColorRules(sheet, totalCols, activeColorRules);'), true);
  assert.equal(code.includes('sheet.setConditionalFormatRules(built);'), true);
  assert.equal(code.includes('#B8E0B8'), true);
  assert.equal(code.includes('#FFFF00'), true);
  assert.equal(code.includes('#F5B3B3'), true);
  assert.equal(code.includes("return 'Delivered';"), true);
  assert.equal(code.includes("return 'Not Delivered';"), true);
  assert.equal(code.includes('SpreadsheetApp.flush();'), true);
  assert.equal(code.includes(".setFontColor('#000000')"), true);
  assert.equal(code.includes(".setFontWeight('bold')"), true);
  assert.equal(code.includes(".setBackground('#FF9800')"), true);
  assert.equal(code.includes(".setHorizontalAlignment('center')"), true);
  assert.equal(code.includes(".setVerticalAlignment('middle')"), true);
});

test('columnIndexToLetter, formula TRIM/ISBLANK accuracy, column reordering, and priority sorting', () => {
  assert.equal(columnIndexToLetter(0), 'A');
  assert.equal(columnIndexToLetter(4), 'E');
  assert.equal(columnIndexToLetter(8), 'I');
  assert.equal(columnIndexToLetter(25), 'Z');
  assert.equal(columnIndexToLetter(26), 'AA');

  const cols: SheetsColumnMapping[] = [
    { id: 'c_tkt', header: 'Tkt Number', sourceType: 'barcode' },
    { id: 'c_name', header: 'Full Name', sourceType: 'participant_name' },
    { id: 'c_cat', header: 'Category', sourceType: 'dynamic_field', fieldKey: 'Category' },
    { id: 'c_bib_st', header: 'BIB Status', sourceType: 'item_status', itemId: 'bib' },
    { id: 'c_shirt_st', header: 'T-Shirt Status', sourceType: 'item_status', itemId: 'tshirt' },
  ];

  const rules = buildDefaultColorRules(cols);
  assert.equal(rules.length, 3);
  assert.equal(checkColorRulesPriority(rules).hasIssue, false);

  // Formula uses TRIM and ISBLANK anchor guard and dynamic column letters D and E
  const allFormula = buildSheetsRuleFormula(rules[0], cols, 2);
  assert.equal(
    allFormula,
    '=AND(NOT(ISBLANK($A2)),TRIM($A2)<>"",TRIM($D2)="Delivered",TRIM($E2)="Delivered")'
  );

  // Dynamic start row support (e.g. row 5)
  const row5Formula = buildSheetsRuleFormula(rules[0], cols, 5);
  assert.equal(
    row5Formula,
    '=AND(NOT(ISBLANK($A5)),TRIM($A5)<>"",TRIM($D5)="Delivered",TRIM($E5)="Delivered")'
  );

  // Reordering/inserting a column before status columns recalculates $D2/$E2 -> $E2/$F2 automatically
  const shiftedCols: SheetsColumnMapping[] = [
    cols[0],
    cols[1],
    { id: 'c_extra', header: 'Bib Num', sourceType: 'dynamic_field', fieldKey: 'Bib Num' },
    cols[2],
    cols[3],
    cols[4],
  ];
  const shiftedCompiled = compileColorRulesForAppsScript(shiftedCols, rules, 2);
  assert.equal(
    shiftedCompiled[0].formula,
    '=AND(NOT(ISBLANK($A2)),TRIM($A2)<>"",TRIM($E2)="Delivered",TRIM($F2)="Delivered")'
  );

  // Priority detector catches putting none_delivered before all_delivered and fixes order
  const reversed = [rules[2], rules[1], rules[0]];
  assert.equal(checkColorRulesPriority(reversed).hasIssue, true);
  const fixed = sortColorRulesByPriority(reversed);
  assert.equal(fixed[0].presetType, 'all_delivered');
  assert.equal(fixed[1].presetType, 'partial_delivered');
  assert.equal(fixed[2].presetType, 'none_delivered');

  // Live preview evaluation matches green / yellow / red AND leaves blank row uncolored
  const greenStyles = evaluateColorRulesForRow(rules, cols, [
    'TKT-1',
    'Sara',
    'VIP',
    'Delivered',
    'Delivered',
  ]);
  assert.equal(greenStyles[0]?.backgroundColor, '#B8E0B8');

  const yellowStyles = evaluateColorRulesForRow(rules, cols, [
    'TKT-2',
    'Omar',
    'Standard',
    'Delivered',
    'Not Delivered',
  ]);
  assert.equal(yellowStyles[0]?.backgroundColor, '#FFFF00');
  assert.equal(yellowStyles[0]?.color, '#000000');
  assert.equal(yellowStyles[0]?.fontWeight, 'bold');

  const redStyles = evaluateColorRulesForRow(rules, cols, [
    'TKT-3',
    'Ali',
    'Standard',
    'Not Delivered',
    'Not Delivered',
  ]);
  assert.equal(redStyles[0]?.backgroundColor, '#F5B3B3');

  const blankRowStyles = evaluateColorRulesForRow(rules, cols, ['', '', '', '', '']);
  assert.equal(Object.keys(blankRowStyles).length, 0);

  // Multi-condition OR rule scoped to a single column
  const vipRule: SheetsColorRule = {
    id: 'r_vip',
    name: 'VIP Purple',
    enabled: true,
    mode: 'conditions',
    logic: 'OR',
    conditions: [
      { id: 'c1', columnId: 'c_cat', operator: 'contains', value: 'VIP' },
      { id: 'c2', columnId: 'c_bib_st', operator: 'is_delivered' },
    ],
    requireNonEmptyRow: true,
    backgroundColor: '#E1BEE7',
    fontColor: '#000000',
    bold: true,
    targetScope: 'column',
    targetColumnId: 'c_cat',
  };
  const vipFormula = buildSheetsRuleFormula(vipRule, cols, 2);
  assert.equal(
    vipFormula,
    '=AND(NOT(ISBLANK($A2)),TRIM($A2)<>"",OR(ISNUMBER(SEARCH("VIP",TRIM($C2))),TRIM($D2)="Delivered"))'
  );
  const vipStyles = evaluateColorRulesForRow([vipRule], cols, [
    'TKT-9',
    'Nour',
    'VIP Gold',
    'Not Delivered',
    'Not Delivered',
  ]);
  assert.equal(vipStyles[2]?.backgroundColor, '#E1BEE7');
  assert.equal(vipStyles[0], undefined);
});

test('applyColorRules safely bounds ranges to sheet.getMaxRows()/getMaxColumns() without hardcoding 1000/11', () => {
  const shortCols: SheetsColumnMapping[] = [
    { id: 'c1', header: 'Ticket', sourceType: 'barcode' },
    { id: 'c2', header: 'Name', sourceType: 'participant_name' },
    { id: 'c3', header: 'Notes', sourceType: 'static_text', staticValue: 'OK' },
  ];

  const compiledNoStatus = compileColorRulesForAppsScript(shortCols, undefined, 2);
  assert.equal(compiledNoStatus[0].numCols, 3);

  const sanitized = compileColorRulesForAppsScript(
    shortCols,
    [
      {
        id: 'bad_hex',
        name: 'Sanitized',
        enabled: true,
        mode: 'conditions',
        logic: 'AND',
        conditions: [{ id: 'x', columnId: 'c1', operator: 'is_not_empty' }],
        requireNonEmptyRow: true,
        backgroundColor: 'not-a-color',
        fontColor: 'bad',
        targetScope: 'row',
      },
    ],
    2
  );
  assert.equal(sanitized[0].backgroundColor, '#B8E0B8');
  assert.equal(sanitized[0].fontColor, undefined);

  const code = generateGoogleAppsScriptCode('sec', shortCols);
  assert.equal(code.includes('sheet.getMaxRows()'), true);
  assert.equal(code.includes('sheet.getMaxColumns()'), true);
  assert.equal(code.includes('Math.max(sheet.getLastRow(), 1000)'), false);
  assert.equal(code.includes('Math.max(totalCols || 1, 11)'), false);
});

