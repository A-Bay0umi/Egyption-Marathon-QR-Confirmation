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
});
