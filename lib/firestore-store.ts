'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
  MarathonEvent,
  Organizer,
  Participant,
} from './types';

function toIsoString(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function mapEventDoc(id: string, data: Record<string, unknown>): MarathonEvent {
  return {
    id: String(data.id ?? id),
    name: String(data.name ?? ''),
    date: String(data.date ?? ''),
    isActive: Boolean(data.isActive),
    deliverableItems: Array.isArray(data.deliverableItems)
      ? (data.deliverableItems as DeliverableItem[])
      : [],
    displayFields: Array.isArray(data.displayFields) ? (data.displayFields as string[]) : [],
    displayLabels:
      data.displayLabels && typeof data.displayLabels === 'object'
        ? (data.displayLabels as Record<string, string>)
        : undefined,
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

export function subscribeEventParticipants(
  eventId: string,
  onParticipants: (participants: Participant[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!eventId) return () => {};
  const { db } = getFirebaseServices();
  const q = collection(db, 'events', eventId, 'participants');
  return onSnapshot(
    q,
    (snap) => {
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
      const list: ActivityLog[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          eventId,
          participantName: String(data.participantName ?? ''),
          barcode: String(data.barcode ?? ''),
          itemId: String(data.itemId ?? ''),
          itemName: String(data.itemName ?? ''),
          organizerId: String(data.organizerId ?? ''),
          organizerName: String(data.organizerName ?? ''),
          action: data.action === 'undone' ? 'undone' : 'delivered',
          timestamp: toIsoString(data.timestamp),
        };
      });
      onLogs(list);
    },
    (err) => {
      console.warn('Activity logs listener warning:', err.message);
    }
  );
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

  batch.set(doc(db, 'events', id), {
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
  });

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
      'name' | 'date' | 'deliverableItems' | 'displayFields' | 'displayLabels' | 'searchFields' | 'totalParticipants'
    >
  >
): Promise<void> {
  const { db } = getFirebaseServices();
  const cleanPatch = { ...patch };
  if (cleanPatch.deliverableItems) {
    cleanPatch.deliverableItems = sanitizeDeliverableItems(cleanPatch.deliverableItems);
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
  searchFields: string[];
  displayFields: string[];
  displayLabels: Record<string, string>;
  onProgress: (percent: number, processed: number, total: number) => void;
}): Promise<number> {
  const { eventId, rows, barcodeField, searchFields, displayFields, displayLabels, onProgress } = params;
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
  allItems?: DeliverableItem[];
  isOnline: boolean;
}) {
  const { eventId, participant, organizer, item, displayFields, allItems, isOnline } = params;
  const localCheck = attemptLocalDelivery({
    eventId,
    participant,
    organizer,
    item,
    displayFields,
    allItems,
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
  try {
    const batch = writeBatch(db);
    batch.update(participantRef, {
      deliveries: {
        ...participant.deliveries,
        [item.id]: localCheck.deliveryRecord,
      },
    });
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
    });
    await batch.commit();
    return localCheck;
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
}): Promise<void> {
  const { eventId, participant, item, adminName, displayFields } = params;
  const { updatedParticipant, logEntry } = adminUndoDelivery({
    eventId,
    participant,
    item,
    adminName,
    displayFields,
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
