# Marathon Check-in Security Specification (Phase 0)

## 1. Data Invariants
1. Only authenticated, email-verified Admins (`isAdmin()`) may create, edit, activate, or delete `events`, batch-upload `participants`, create/delete/freeze `organizers`, or perform `undone` overrides.
2. Organizers cannot list all organizers or scrape other booths' tokens (`allow list` on `organizers` is strictly Admin-only).
3. Organizers cannot delete any participant, event, or log document.
4. Organizers cannot modify `dynamicData`, `barcode`, or `searchKeywords` on a participant, nor overwrite or remove an already-delivered item in `deliveries`.
5. `activity_logs` are append-only: `update` and `delete` are unconditionally denied (`false`), non-admins can only append `action == 'delivered'` entries, and optional offline sync fields (`viaOffline` bool, `clientDeliveredAt` <= 40 chars, `deviceId` <= 64 chars) are strictly type/size-bounded.
6. `delivery_conflicts` review records (`events/{eventId}/delivery_conflicts/{barcode__itemId}`) require strict schema validation (`hasOnly`, `status == 'resolved'`, `note <= 500` chars, `resolvedLogCount` integer `[2..1000]`, server-enforced `resolvedAt == request.time`, immutable `barcode`/`itemId`, and `delete: false`).
7. Every document ID path variable must satisfy `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars), and every string/array field has strict size bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Event Creation**: Anonymous user attempts `create` on `/events/evt_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Admin Spoof**: User with `email: 'abdallahbayoumi1@gmail.com'` and `email_verified: false` attempts `write` -> `PERMISSION_DENIED`.
3. **Organizer List Scraping**: Non-admin user attempts `list` on `/organizers` -> `PERMISSION_DENIED`.
4. **Participant Deletion by Organizer**: Signed-in non-admin attempts `delete` on `/events/evt_1/participants/1001` -> `PERMISSION_DENIED`.
5. **Admin Undo by Non-Admin**: Non-admin attempts to remove a key from `deliveries` or write `action: 'undone'` in `activity_logs` -> `PERMISSION_DENIED`.
6. **Overwrite Existing Delivery**: Non-admin attempts to overwrite an already-delivered `deliveries.tshirt` map entry -> `PERMISSION_DENIED`.
7. **Shadow Field Injection on Event**: Admin payload includes unexpected key `isSuperAdmin: true` -> `PERMISSION_DENIED` via `hasOnly()`.
8. **ID Poisoning**: Document ID > 128 chars or containing slashes/spaces -> `PERMISSION_DENIED` via `isValidId()`.
9. **Client Timestamp Forgery**: `createdAt`, `timestamp`, or `resolvedAt` set to arbitrary past string instead of `request.time` -> `PERMISSION_DENIED`.
10. **PII Modification by Organizer**: Non-admin updates `dynamicData` or `barcode` during delivery -> `PERMISSION_DENIED` via `affectedKeys().hasOnly(['deliveries'])`.
11. **Audit Log & Conflict History Tampering**: Any user attempts `update` or `delete` on `/events/evt_1/activity_logs/log_1` or `delete` on `/events/evt_1/delivery_conflicts/1001__tshirt` -> `PERMISSION_DENIED`.
12. **Conflict Resolution Schema & Bounds Bypass**: Writing `delivery_conflicts` with mismatched `conflictId`, `note` > 500 chars, or `resolvedLogCount < 2` -> `PERMISSION_DENIED`.
