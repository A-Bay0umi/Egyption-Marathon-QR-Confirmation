import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('firestore.rules enforces default deny and eight pillars', () => {
  const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /rules_version = '2';/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(rules, /function isValidId\(id\)/);
  assert.match(rules, /function isAdmin\(\)/);
  assert.match(rules, /email_verified == true/);
  assert.match(rules, /allow update, delete: if false;/);
  assert.match(rules, /viaOffline/);
  assert.match(rules, /clientDeliveredAt/);
  assert.match(rules, /deviceId/);
  assert.match(rules, /function isValidDeliveryConflictResolution\(data\)/);
  assert.match(rules, /match \/delivery_conflicts\/\{conflictId\}/);
  assert.match(rules, /data\.resolvedAt == request\.time/);
  assert.match(rules, /data\.note\.size\(\) <= 500/);
  assert.match(rules, /sheetsWebhookUrl/);
  assert.match(rules, /sheetsAutoSync/);
  assert.match(rules, /sheetsColumns/);
});
