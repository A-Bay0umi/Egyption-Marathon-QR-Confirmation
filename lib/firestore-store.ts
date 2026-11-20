'use client';

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  waitForPendingWrites,
  where,
  writeBatch,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirebaseServices, handleFirestoreError, OperationType } from './firebase';
import {
  adminUndoDelivery,
  attemptLocalDelivery,
  generateSearchKeywords,
  normalizeBarcode,
} from './marathon-logic';
import type {
  ActivityLog,
  DeliverableItem,
  DeliveryConflictResolution,
  MarathonEvent,
  Organizer,
  Participant,
} from './types';

const DEVICE_ID_STORAGE_KEY = 'emqr_device_id_v1';

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'srv';
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && existing.trim()) return existing.trim().slice(0, 64);
    const created = `dev_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `dev_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function waitForFirestorePendingWrites(): Promise<void> {
  const { db } = getFirebaseServices();
  await waitForPendingWrites(db);
}

function toIsoString(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function mapEventDoc(id: string, data: Record<string, unknown>): MarathonEvent {
  const regStatus =
    data.registrationStatus === 'auto' ||
    data.registrationStatus === 'open' ||
    data.registrationStatus === 'closed'
      ? data.registrationStatus
      : undefined;

  return {
    id: String(data.id ?? id),
    name: String(data.name ?? ''),
    date: String(data.date ?? ''),
    isActive: Boolean(data.isActive),
    registrationStatus: regStatus,
    registrationOpensAt:
      typeof data.registrationOpensAt === 'string' && data.registrationOpensAt
        ? data.registrationOpensAt
        : undefined,
    registrationClosesAt:
      typeof data.registrationClosesAt === 'string' && data.registrationClosesAt
        ? data.registrationClosesAt
        : undefined,
    deliverableItems: Array.isArray(data.deliverableItems)
      ? (data.deliverableItems as DeliverableItem[])
      : [],
    displayFields: Array.isArray(data.displayFields) ? (data.displayFields as string[]) : [],
    displayLabels:
      data.displayLabels && typeof data.displayLabels === 'object'
        ? (data.displayLabels as Record<string, string>)
        : undefined,
    nameField:
      typeof data.nameField === 'string' && data.nameField ? data.nameField : undefined,
    searchFields: Array.isArray(data.searchFields) ? (data.searchFields as string[]) : [],
    totalParticipants: typeof data.totalParticipants === 'number' ? data.totalParticipants : 0,
    ownerUid: String(data.ownerUid ?? 'admin'),
    createdAt: toIsoString(data.createdAt),
  };
}

function mapOrganizerDoc(id: string, data: Record<string, unknown>): Organizer {
  return {
    id: String(data.id ?? id),
    eventId: String(data.eventId ?? ''),
    name: String(data.name ?? ''),
    boothName: typeof data.boothName === 'string' ? data.boothName : '',
    whatsappPhone: typeof data.whatsappPhone === 'string' ? data.whatsappPhone : undefined,
    assignedItems: Array.isArray(data.assignedItems) ? (data.assignedItems as string[]) : [],
    magicToken: String(data.magicToken ?? ''),
    isActive: data.isActive !== false,
    deliveredCount: typeof data.deliveredCount === 'number' ? data.deliveredCount : 0,
    createdAt: toIsoString(data.createdAt),
  };
}

function mapParticipantDoc(id: string, data: Record<string, unknown>): Participant {
  return {
    barcode: String(data.barcode ?? id),
    searchKeywords: Array.isArray(data.searchKeywords) ? (data.searchKeywords as string[]) : [],
    dynamicData:
      data.dynamicData && typeof data.dynamicData === 'object'
        ? (data.dynamicData as Record<string, string>)
        : {},
    deliveries:
      data.deliveries && typeof data.deliveries === 'object'
        ? (data.deliveries as Participant['deliveries'])
        : {},
  };
}

// ---------- Subscriptions ----------

export function subscribeEvents(
  onEvents: (events: MarathonEvent[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const { db } = getFirebaseServices();
  const q = query(collection(db, 'events'), where('ownerUid', '==', 'admin'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapEventDoc(d.id, d.data()))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      onEvents(list);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'events');
    }
  );
}

export function subscribeActiveEvent(
  onActiveEvent: (event: MarathonEvent | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return subscribeEvents((list) => {
    const active = list.find((ev) => ev.isActive) ?? null;
    onActiveEvent(active);
  }, onError);
}

export function subscribeSingleEvent(
  eventId: string,
  onEvent: (event: MarathonEvent | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!eventId) return () => {};
  const { db } = getFirebaseServices();
  return onSnapshot(
    doc(db, 'events', eventId),
    (snap) => {
      if (!snap.exists()) {
        onEvent(null);
        return;
      }
      onEvent(mapEventDoc(snap.id, snap.data()));
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.GET, `events/${eventId}`);
    }
  );
}

export function subscribeEventOrganizers(
  eventId: string,
  onOrganizers: (organizers: Organizer[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!eventId) return () => {};
  const { db } = getFirebaseServices();
  const q = query(collection(db, 'organizers'), where('eventId', '==', eventId), limit(500));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapOrganizerDoc(d.id, d.data()))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      onOrganizers(list);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'organizers');
    }
  );
}

export function subscribeOrganizerByToken(
  eventId: string,
  magicToken: string,
  onOrganizer: (organizer: Organizer | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!eventId || !magicToken) return () => {};
  const { db } = getFirebaseServices();
  const q = query(
    collection(db, 'organizers'),
    where('eventId', '==', eventId),
    where('magicToken', '==', magicToken),
    limit(1)
  );
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onOrganizer(null);
        return;
      }
      const d = snap.docs[0];
      onOrganizer(mapOrganizerDoc(d.id, d.data()));
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, 'organizers');
    }
  );
}

function mapActivityLogDoc(
  eventId: string,
  id: string,
  data: Record<string, unknown>
): ActivityLog {
  return {
    id,
    eventId,
    participantName: String(data.participantName ?? ''),
    barcode: String(data.barcode ?? ''),
    itemId: String(data.itemId ?? ''),
    itemName: String(data.itemName ?? ''),
    organizerId: String(data.organizerId ?? ''),
    organizerName: String(data.organizerName ?? ''),
    action: data.action === 'undone' ? 'undone' : 'delivered',
    timestamp: toIsoString(data.timestamp),
    viaOffline: typeof data.viaOffline === 'boolean' ? data.viaOffline : undefined,
    clientDeliveredAt:
      typeof data.clientDeliveredAt === 'string' && data.clientDeliveredAt
        ? data.clientDeliveredAt
        : undefined,
    deviceId: typeof data.deviceId === 'string' && data.deviceId ? data.deviceId : undefined,
  };
}

export function subscribeEventParticipants(
  eventId: string,
  onParticipants: (participants: Participant[]) => void,
  onError?: (err: Error) => void,
  onPendingWritesChange?: (hasPendingWrites: boolean) => void
): Unsubscribe {
  if (!eventId) return () => {};
  const { db } = getFirebaseServices();
  const q = collection(db, 'events', eventId, 'participants');
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      onPendingWritesChange?.(snap.metadata.hasPendingWrites);
      const list = snap.docs.map((d) => mapParticipantDoc(d.id, d.data()));
      onParticipants(list);
    },
    (err) => {
      if (onError) onError(err);
      else handleFirestoreError(err, OperationType.LIST, `events/${eventId}/participants`);
    }
  );
}

export function subscribeEventLogs(
  eventId: string,
  onLogs: (logs: ActivityLog[]) => void
): Unsubscribe {
  if (!eventId) return () => {};
  const { db } = getFirebaseServices();
  const q = query(
    collection(db, 'events', eventId, 'activity_logs'),
    orderBy('timestamp', 'desc'),
    limit(30)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: ActivityLog[] = snap.docs.map((d) =>
        mapActivityLogDoc(eventId, d.id, d.data())
      );
      onLogs(list);
    },
    (err) => {
      console.warn('Activity logs listener warning:', err.message);
    }
  );
}

export async function fetchAllEventLogs(eventId: string): Promise<ActivityLog[]> {
  if (!eventId) return [];
  const { db } = getFirebaseServices();
  const PAGE_SIZE = 500;
  const allLogs: ActivityLog[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  try {
    while (true) {
      const q: Query<DocumentData> = lastDoc
        ? query(
            collection(db, 'events', eventId, 'activity_logs'),
            orderBy('timestamp', 'asc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          )
        : query(
            collection(db, 'events', eventId, 'activity_logs'),
            orderBy('timestamp', 'asc'),
            limit(PAGE_SIZE)
          );

      const snap = await getDocs(q);
      for (const d of snap.docs) {
        allLogs.push(mapActivityLogDoc(eventId, d.id, d.data()));
      }
      if (snap.docs.length < PAGE_SIZE) {
        break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return allLogs;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `events/${eventId}/activity_logs`);
  }
}

export async function fetchDeliveryConflictResolutions(
  eventId: string
): Promise<Record<string, DeliveryConflictResolution>> {
  if (!eventId) return {};
  const { db } = getFirebaseServices();
  try {
    const snap = await getDocs(collection(db, 'events', eventId, 'delivery_conflicts'));
    const map: Record<string, DeliveryConflictResolution> = {};
    for (const d of snap.docs) {
      const data = d.data();
      map[d.id] = {
        id: d.id,
        barcode: String(data.barcode ?? ''),
        itemId: String(data.itemId ?? ''),
        status: 'resolved',
        note: typeof data.note === 'string' && data.note ? data.note : undefined,
        resolvedLogCount: typeof data.resolvedLogCount === 'number' ? data.resolvedLogCount : 2,
        resolvedAt: toIsoString(data.resolvedAt),
      };
    }
    return map;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `events/${eventId}/delivery_conflicts`);
  }
}

export async function resolveDeliveryConflictDoc(params: {
  eventId: string;
  barcode: string;
  itemId: string;
  resolvedLogCount: number;
  note?: string;
}): Promise<DeliveryConflictResolution> {
  const { db } = getFirebaseServices();
  const conflictId = `${params.barcode}__${params.itemId}`;
  const cleanNote = params.note?.trim().slice(0, 500);
  const payload: Record<string, unknown> = {
    barcode: params.barcode,
    itemId: params.itemId,
    status: 'resolved',
    resolvedLogCount: Math.max(2, params.resolvedLogCount),
    resolvedAt: serverTimestamp(),
  };
  if (cleanNote) {
    payload.note = cleanNote;
  }

  try {
    await setDoc(doc(db, 'events', params.eventId, 'delivery_conflicts', conflictId), payload);
    return {
      id: conflictId,
      barcode: params.barcode,
      itemId: params.itemId,
      status: 'resolved',
      note: cleanNote || undefined,
      resolvedLogCount: Math.max(2, params.resolvedLogCount),
      resolvedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.WRITE,
      `events/${params.eventId}/delivery_conflicts/${conflictId}`
    );
  }
}

function sanitizeDeliverableItems(items: DeliverableItem[]): DeliverableItem[] {
  return items.map((item) => {
    const clean: DeliverableItem = { id: item.id, name: item.name.trim() };
    if (item.dependsOnItemId) {
      clean.dependsOnItemId = item.dependsOnItemId;
    }
    return clean;
  });
}

// ---------- Event Mutations ----------

export async function createEventDoc(params: {
  name: string;
  date: string;
  deliverableItems: DeliverableItem[];
  setAsActive: boolean;
  existingEvents: MarathonEvent[];
  registrationStatus?: 'auto' | 'open' | 'closed';
  registrationOpensAt?: string;
  registrationClosesAt?: string;
}): Promise<string> {
  const { db } = getFirebaseServices();
  const id = `evt_${Date.now().toString(36)}`;
  const batch = writeBatch(db);

  if (params.setAsActive) {
    for (const ev of params.existingEvents) {
      if (ev.isActive) {
        batch.update(doc(db, 'events', ev.id), { isActive: false });
      }
    }
  }

  const eventPayload: Record<string, unknown> = {
    id,
    name: params.name.trim(),
    date: params.date.trim() || new Date().toISOString().slice(0, 10),
    isActive: params.setAsActive,
    deliverableItems: sanitizeDeliverableItems(params.deliverableItems),
    displayFields: ['الاسم', 'رقم الصدر', 'مقاس التيشيرت', 'رقم الموبايل'],
    searchFields: ['الاسم', 'رقم الصدر', 'رقم الموبايل'],
    totalParticipants: 0,
    ownerUid: 'admin',
    createdAt: serverTimestamp(),
  };

  if (params.registrationStatus) {
    eventPayload.registrationStatus = params.registrationStatus;
  }
  if (params.registrationOpensAt) {
    eventPayload.registrationOpensAt = params.registrationOpensAt;
  }
  if (params.registrationClosesAt) {
    eventPayload.registrationClosesAt = params.registrationClosesAt;
  }

  batch.set(doc(db, 'events', id), eventPayload);

  try {
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `events/${id}`);
  }
}

export async function setActiveEventDoc(eventId: string, existingEvents: MarathonEvent[]): Promise<void> {
  const { db } = getFirebaseServices();
  const batch = writeBatch(db);
  for (const ev of existingEvents) {
    const shouldBeActive = ev.id === eventId;
    if (ev.isActive !== shouldBeActive) {
      batch.update(doc(db, 'events', ev.id), { isActive: shouldBeActive });
    }
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}`);
  }
}

export async function updateEventDoc(
  eventId: string,
  patch: Partial<
    Pick<
      MarathonEvent,
      | 'name'
      | 'date'
      | 'deliverableItems'
      | 'displayFields'
      | 'displayLabels'
      | 'nameField'
      | 'searchFields'
      | 'totalParticipants'
      | 'registrationStatus'
      | 'registrationOpensAt'
      | 'registrationClosesAt'
    >
  >
): Promise<void> {
  const { db } = getFirebaseServices();
  const cleanPatch: Record<string, unknown> = { ...patch };
  if (cleanPatch.deliverableItems) {
    cleanPatch.deliverableItems = sanitizeDeliverableItems(
      cleanPatch.deliverableItems as DeliverableItem[]
    );
  }
  if ('nameField' in patch) {
    cleanPatch.nameField = patch.nameField?.trim() ? patch.nameField.trim() : deleteField();
  }
  if ('registrationOpensAt' in patch) {
    cleanPatch.registrationOpensAt = patch.registrationOpensAt
      ? patch.registrationOpensAt
      : deleteField();
  }
  if ('registrationClosesAt' in patch) {
    cleanPatch.registrationClosesAt = patch.registrationClosesAt
      ? patch.registrationClosesAt
      : deleteField();
  }
  try {
    await updateDoc(doc(db, 'events', eventId), cleanPatch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}`);
  }
}

export async function deleteEventDoc(eventId: string): Promise<void> {
  const { db } = getFirebaseServices();
  try {
    const orgSnap = await getDocs(
      query(collection(db, 'organizers'), where('eventId', '==', eventId), limit(500))
    );
    const partSnap = await getDocs(collection(db, 'events', eventId, 'participants'));

    const allRefs = [...orgSnap.docs.map((d) => d.ref), ...partSnap.docs.map((d) => d.ref)];
    const CHUNK = 400;
    for (let i = 0; i < allRefs.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const ref of allRefs.slice(i, i + CHUNK)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    await deleteDoc(doc(db, 'events', eventId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `events/${eventId}`);
  }
}

// ---------- Organizer Mutations ----------

export async function createOrganizerDoc(params: {
  eventId: string;
  name: string;
  boothName: string;
  whatsappPhone?: string;
  assignedItems: string[];
}): Promise<Organizer> {
  const { db } = getFirebaseServices();
  const id = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const magicToken = `ORG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const payload: Record<string, unknown> = {
    id,
    eventId: params.eventId,
    name: params.name.trim(),
    boothName: params.boothName.trim(),
    assignedItems: params.assignedItems,
    magicToken,
    isActive: true,
    deliveredCount: 0,
    createdAt: serverTimestamp(),
  };
  if (params.whatsappPhone && params.whatsappPhone.trim()) {
    payload.whatsappPhone = params.whatsappPhone.trim();
  }

  try {
    await setDoc(doc(db, 'organizers', id), payload);
    return {
      id,
      eventId: params.eventId,
      name: params.name.trim(),
      boothName: params.boothName.trim(),
      whatsappPhone: params.whatsappPhone?.trim() || undefined,
      assignedItems: params.assignedItems,
      magicToken,
      isActive: true,
      deliveredCount: 0,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `organizers/${id}`);
  }
}

export async function updateOrganizerDoc(
  organizerId: string,
  patch: Partial<Pick<Organizer, 'name' | 'boothName' | 'whatsappPhone' | 'assignedItems' | 'isActive'>>
): Promise<void> {
  const { db } = getFirebaseServices();
  const cleanPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) cleanPatch.name = patch.name.trim();
  if (patch.boothName !== undefined) cleanPatch.boothName = patch.boothName.trim();
  if (patch.whatsappPhone !== undefined) cleanPatch.whatsappPhone = patch.whatsappPhone.trim();
  if (patch.assignedItems !== undefined) cleanPatch.assignedItems = patch.assignedItems;
  if (patch.isActive !== undefined) cleanPatch.isActive = patch.isActive;

  try {
    await updateDoc(doc(db, 'organizers', organizerId), cleanPatch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `organizers/${organizerId}`);
  }
}

export async function deleteOrganizerDoc(organizerId: string): Promise<void> {
  const { db } = getFirebaseServices();
  try {
    await deleteDoc(doc(db, 'organizers', organizerId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `organizers/${organizerId}`);
  }
}

// ---------- Participant Mutations ----------

export async function upsertSingleParticipantDoc(params: {
  event: MarathonEvent;
  barcode: string;
  dynamicData: Record<string, string>;
  currentCount: number;
}): Promise<void> {
  const { db } = getFirebaseServices();
  const cleanBarcode = normalizeBarcode(params.barcode) || `P-${Date.now().toString(36)}`;
  const keys = Object.keys(params.dynamicData).filter((k) => params.dynamicData[k].trim() !== '');
  const mergedDisplayFields = Array.from(new Set([...params.event.displayFields, ...keys])).slice(0, 20);
  const mergedSearchFields = Array.from(new Set([...params.event.searchFields, ...keys])).slice(0, 10);

  const participant: Participant = {
    barcode: cleanBarcode,
    searchKeywords: generateSearchKeywords(params.dynamicData, mergedSearchFields, cleanBarcode),
    dynamicData: params.dynamicData,
    deliveries: {},
  };

  try {
    await setDoc(doc(db, 'events', params.event.id, 'participants', cleanBarcode), participant);
    await updateDoc(doc(db, 'events', params.event.id), {
      displayFields: mergedDisplayFields,
      searchFields: mergedSearchFields,
      totalParticipants: params.currentCount + 1,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `events/${params.event.id}/participants/${cleanBarcode}`);
  }
}

export async function deleteParticipantDoc(
  eventId: string,
  barcode: string,
  nextCount: number
): Promise<void> {
  const { db } = getFirebaseServices();
  try {
    await deleteDoc(doc(db, 'events', eventId, 'participants', barcode));
    await updateDoc(doc(db, 'events', eventId), {
      totalParticipants: Math.max(0, nextCount),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `events/${eventId}/participants/${barcode}`);
  }
}

export async function batchImportParticipantsFirestore(params: {
  eventId: string;
  rows: Record<string, string>[];
  barcodeField: string;
  nameField?: string;
  searchFields: string[];
  displayFields: string[];
  displayLabels: Record<string, string>;
  onProgress: (percent: number, processed: number, total: number) => void;
}): Promise<number> {
  const { eventId, rows, barcodeField, nameField, searchFields, displayFields, displayLabels, onProgress } = params;
  const { db } = getFirebaseServices();

  const built: Participant[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const rawBarcode = row[barcodeField] ?? '';
    let barcode = normalizeBarcode(String(rawBarcode));
    if (!barcode) {
      barcode = `P-${index + 1}`;
    }
    if (seen.has(barcode)) return;
    seen.add(barcode);

    const dynamicData: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const cleanK = String(k).trim();
      if (cleanK) {
        dynamicData[cleanK] = String(v ?? '').trim();
      }
    }

    built.push({
      barcode,
      searchKeywords: generateSearchKeywords(dynamicData, searchFields, barcode).slice(0, 60),
      dynamicData,
      deliveries: {},
    });
  });

  const total = built.length;
  if (total === 0) return 0;

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < built.length; i += CHUNK_SIZE) {
      const chunk = built.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const p of chunk) {
        batch.set(doc(db, 'events', eventId, 'participants', p.barcode), p);
      }
      await batch.commit();
      const processed = Math.min(i + chunk.length, total);
      onProgress(Math.round((processed / total) * 100), processed, total);
    }

    await updateDoc(doc(db, 'events', eventId), {
      displayFields,
      displayLabels,
      searchFields,
      nameField: nameField?.trim() ? nameField.trim() : deleteField(),
      totalParticipants: total,
    });
    return total;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `events/${eventId}/participants`);
  }
}

// ---------- Atomic Delivery & Admin Undo ----------

export async function commitAtomicDelivery(params: {
  eventId: string;
  participant: Participant;
  organizer: Organizer;
  item: DeliverableItem;
  displayFields: string[];
  nameField?: string;
  allItems?: DeliverableItem[];
  isOnline: boolean;
  deviceId?: string;
}) {
  const { eventId, participant, organizer, item, displayFields, nameField, allItems, isOnline } =
    params;
  const clientDeliveredAt = new Date().toISOString();
  const deviceId = params.deviceId ?? getOrCreateDeviceId();

  const localCheck = attemptLocalDelivery({
    eventId,
    participant,
    organizer,
    item,
    displayFields,
    nameField,
    allItems,
    nowIso: clientDeliveredAt,
    viaOffline: !isOnline,
    clientDeliveredAt,
    deviceId,
  });

  if (!localCheck.ok) {
    return localCheck;
  }

  const { db } = getFirebaseServices();
  const participantRef = doc(db, 'events', eventId, 'participants', participant.barcode);
  const organizerRef = doc(db, 'organizers', organizer.id);
  const logRef = doc(collection(db, 'events', eventId, 'activity_logs'));

  if (isOnline) {
    try {
      await runTransaction(db, async (tx) => {
        const pSnap = await tx.get(participantRef);
        const oSnap = await tx.get(organizerRef);
        if (oSnap.exists() && oSnap.data().isActive === false) {
          throw new Error('ORGANIZER_FROZEN');
        }
        if (oSnap.exists() && Array.isArray(oSnap.data().assignedItems) && !oSnap.data().assignedItems.includes(item.id)) {
          throw new Error('UNAUTHORIZED_ITEM');
        }
        if (!pSnap.exists()) {
          throw new Error('NOT_FOUND');
        }
        const currentDeliveries = pSnap.data().deliveries ?? {};
        if (
          item.dependsOnItemId &&
          currentDeliveries[item.dependsOnItemId]?.status !== 'delivered'
        ) {
          throw new Error('PREREQUISITE_NOT_MET');
        }
        if (currentDeliveries[item.id]?.status === 'delivered') {
          throw new Error('ALREADY_DELIVERED');
        }

        tx.update(participantRef, {
          deliveries: {
            ...currentDeliveries,
            [item.id]: localCheck.deliveryRecord,
          },
        });
        if (oSnap.exists()) {
          tx.update(organizerRef, {
            deliveredCount: (oSnap.data().deliveredCount ?? 0) + 1,
          });
        }
        tx.set(logRef, {
          participantName: localCheck.logEntry.participantName,
          barcode: participant.barcode,
          itemId: item.id,
          itemName: item.name,
          organizerId: organizer.id,
          organizerName: organizer.name,
          action: 'delivered',
          timestamp: serverTimestamp(),
          viaOffline: false,
          clientDeliveredAt,
          deviceId,
        });
      });
      return localCheck;
    } catch (err) {
      if (err instanceof Error && err.message === 'ORGANIZER_FROZEN') {
        return { ok: false as const, reason: 'organizer_frozen' as const };
      }
      if (err instanceof Error && err.message === 'UNAUTHORIZED_ITEM') {
        return { ok: false as const, reason: 'unauthorized_item' as const };
      }
      if (err instanceof Error && err.message === 'PREREQUISITE_NOT_MET') {
        const missingItemName =
          allItems?.find((i) => i.id === item.dependsOnItemId)?.name ?? 'الخطوة السابقة';
        return {
          ok: false as const,
          reason: 'prerequisite_not_met' as const,
          missingItemId: item.dependsOnItemId,
          missingItemName,
        };
      }
      if (err instanceof Error && err.message === 'ALREADY_DELIVERED') {
        return {
          ok: false as const,
          reason: 'already_delivered' as const,
          existingDelivery: participant.deliveries[item.id],
        };
      }
      // If transaction failed due to transient offline drop, fall through to offline writeBatch
    }
  }

  // Offline / Persistent Local Cache writeBatch (automatically queues & syncs on reconnect)
  // Updates only deliveries.<item.id> via FieldPath so concurrent offline deliveries of other items are never overwritten.
  try {
    const batch = writeBatch(db);
    batch.update(
      participantRef,
      new FieldPath('deliveries', item.id),
      localCheck.deliveryRecord
    );
    batch.update(organizerRef, {
      deliveredCount: increment(1),
    });
    batch.set(logRef, {
      participantName: localCheck.logEntry.participantName,
      barcode: participant.barcode,
      itemId: item.id,
      itemName: item.name,
      organizerId: organizer.id,
      organizerName: organizer.name,
      action: 'delivered',
      timestamp: serverTimestamp(),
      viaOffline: true,
      clientDeliveredAt,
      deviceId,
    });
    await batch.commit();
    return {
      ...localCheck,
      logEntry: {
        ...localCheck.logEntry,
        viaOffline: true,
      },
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}/participants/${participant.barcode}`);
  }
}

export async function commitAdminUndo(params: {
  eventId: string;
  participant: Participant;
  item: DeliverableItem;
  adminName: string;
  displayFields: string[];
  nameField?: string;
}): Promise<void> {
  const { eventId, participant, item, adminName, displayFields, nameField } = params;
  const { updatedParticipant, logEntry } = adminUndoDelivery({
    eventId,
    participant,
    item,
    adminName,
    displayFields,
    nameField,
  });

  const { db } = getFirebaseServices();
  const batch = writeBatch(db);
  batch.update(doc(db, 'events', eventId, 'participants', participant.barcode), {
    deliveries: updatedParticipant.deliveries,
  });
  batch.set(doc(collection(db, 'events', eventId, 'activity_logs')), {
    participantName: logEntry.participantName,
    barcode: participant.barcode,
    itemId: item.id,
    itemName: item.name,
    organizerId: 'admin',
    organizerName: adminName,
    action: 'undone',
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}/participants/${participant.barcode}`);
  }
}
