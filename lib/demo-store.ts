'use client';

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  getFirebaseServices,
  handleFirestoreError,
  OperationType,
} from './firebase';
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
  OfflineMutation,
  Organizer,
  Participant,
} from './types';

const STORAGE_KEY = 'marathon_checkin_state_v1';
const CHANNEL_NAME = 'marathon_checkin_sync_v1';

export interface MarathonAppState {
  events: MarathonEvent[];
  organizers: Organizer[];
  participantsByEvent: Record<string, Participant[]>;
  logsByEvent: Record<string, ActivityLog[]>;
  pendingQueue: OfflineMutation[];
}

function buildSeedState(): MarathonAppState {
  const evtId = 'evt_sharm_2026';
  const now = new Date();
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  const deliverableItems: DeliverableItem[] = [
    { id: 'bib', name: 'رقم الصدر (Bib)' },
    { id: 'tshirt', name: 'التيشيرت' },
    { id: 'chip', name: 'شريحة التوقيت' },
    { id: 'bag', name: 'شنطة المتسابق' },
  ];

  const displayFields = ['الاسم', 'رقم الصدر', 'مقاس التيشيرت', 'المسافة', 'رقم الموبايل'];
  const searchFields = ['الاسم', 'رقم الصدر', 'رقم الموبايل'];

  const sampleRows: Array<{
    barcode: string;
    data: Record<string, string>;
    deliveries: Participant['deliveries'];
  }> = [
    {
      barcode: 'SHARM-1042',
      data: {
        الاسم: 'علي حسن محمود',
        'رقم الصدر': '1042',
        'مقاس التيشيرت': 'L',
        المسافة: '21 كم - نصف ماراثون',
        'رقم الموبايل': '01012348891',
      },
      deliveries: {},
    },
    {
      barcode: 'SHARM-1043',
      data: {
        الاسم: 'نورهان طارق السيد',
        'رقم الصدر': '1043',
        'مقاس التيشيرت': 'M',
        المسافة: '10 كم',
        'رقم الموبايل': '01122334455',
      },
      deliveries: {
        tshirt: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(14),
        },
        bib: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(14),
        },
      },
    },
    {
      barcode: 'SHARM-1044',
      data: {
        الاسم: 'كريم عادل فؤاد',
        'رقم الصدر': '1044',
        'مقاس التيشيرت': 'XL',
        المسافة: '42 كم - ماراثون كامل',
        'رقم الموبايل': '01298765432',
      },
      deliveries: {
        bib: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_b',
          deliveredByOrganizerName: 'سارة علي',
          deliveredAt: minsAgo(28),
        },
      },
    },
    {
      barcode: 'SHARM-1045',
      data: {
        الاسم: 'يوسف مصطفى الشريف',
        'رقم الصدر': '1045',
        'مقاس التيشيرت': 'S',
        المسافة: '5 كم - جري عائلي',
        'رقم الموبايل': '01555667788',
      },
      deliveries: {},
    },
    {
      barcode: 'SHARM-1046',
      data: {
        الاسم: 'مريم خالد عبد الله',
        'رقم الصدر': '1046',
        'مقاس التيشيرت': 'M',
        المسافة: '21 كم - نصف ماراثون',
        'رقم الموبايل': '01099887766',
      },
      deliveries: {},
    },
    {
      barcode: 'SHARM-1047',
      data: {
        الاسم: 'عمر سامي المنشاوي',
        'رقم الصدر': '1047',
        'مقاس التيشيرت': 'XXL',
        المسافة: '10 كم',
        'رقم الموبايل': '01033445566',
      },
      deliveries: {
        tshirt: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(5),
        },
        bib: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(5),
        },
        chip: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(5),
        },
        bag: {
          status: 'delivered',
          deliveredByOrganizerId: 'org_booth_a',
          deliveredByOrganizerName: 'أحمد محمد',
          deliveredAt: minsAgo(5),
        },
      },
    },
    {
      barcode: 'SHARM-1048',
      data: {
        الاسم: 'هدى إبراهيم النجار',
        'رقم الصدر': '1048',
        'مقاس التيشيرت': 'S',
        المسافة: '21 كم - نصف ماراثون',
        'رقم الموبايل': '01244556677',
      },
      deliveries: {},
    },
    {
      barcode: 'SHARM-1049',
      data: {
        الاسم: 'طارق أشرف بدر',
        'رقم الصدر': '1049',
        'مقاس التيشيرت': 'L',
        المسافة: '42 كم - ماراثون كامل',
        'رقم الموبايل': '01177889900',
      },
      deliveries: {},
    },
  ];

  const participants: Participant[] = sampleRows.map((row) => ({
    barcode: row.barcode,
    searchKeywords: generateSearchKeywords(row.data, searchFields, row.barcode),
    dynamicData: row.data,
    deliveries: row.deliveries,
  }));

  const event: MarathonEvent = {
    id: evtId,
    name: 'ماراثون شرم الشيخ 2026',
    date: '2026-11-20',
    isActive: true,
    deliverableItems,
    displayFields,
    displayLabels: {
      الاسم: 'اسم المتسابق',
      'رقم الصدر': 'رقم الصدر (Bib)',
      'مقاس التيشيرت': 'مقاس التيشيرت',
      المسافة: 'فئة السباق',
      'رقم الموبايل': 'الموبايل',
    },
    searchFields,
    totalParticipants: participants.length,
    ownerUid: 'demo_admin',
    createdAt: minsAgo(180),
  };

  const organizers: Organizer[] = [
    {
      id: 'org_booth_a',
      eventId: evtId,
      name: 'أحمد محمد',
      boothName: 'بوث A - تسليم شامل',
      assignedItems: ['bib', 'tshirt', 'chip', 'bag'],
      magicToken: 'DEMO-BOOTH-A',
      isActive: true,
      deliveredCount: 6,
      createdAt: minsAgo(150),
    },
    {
      id: 'org_booth_b',
      eventId: evtId,
      name: 'سارة علي',
      boothName: 'بوث B - أرقام الصدر والشنط',
      assignedItems: ['bib', 'bag'],
      magicToken: 'DEMO-BOOTH-B',
      isActive: true,
      deliveredCount: 1,
      createdAt: minsAgo(140),
    },
  ];

  const logs: ActivityLog[] = [
    {
      id: 'seed_log_1',
      eventId: evtId,
      participantName: 'عمر سامي المنشاوي',
      barcode: 'SHARM-1047',
      itemId: 'tshirt',
      itemName: 'التيشيرت',
      organizerId: 'org_booth_a',
      organizerName: 'أحمد محمد',
      action: 'delivered',
      timestamp: minsAgo(5),
    },
    {
      id: 'seed_log_2',
      eventId: evtId,
      participantName: 'نورهان طارق السيد',
      barcode: 'SHARM-1043',
      itemId: 'tshirt',
      itemName: 'التيشيرت',
      organizerId: 'org_booth_a',
      organizerName: 'أحمد محمد',
      action: 'delivered',
      timestamp: minsAgo(14),
    },
    {
      id: 'seed_log_3',
      eventId: evtId,
      participantName: 'كريم عادل فؤاد',
      barcode: 'SHARM-1044',
      itemId: 'bib',
      itemName: 'رقم الصدر (Bib)',
      organizerId: 'org_booth_b',
      organizerName: 'سارة علي',
      action: 'delivered',
      timestamp: minsAgo(28),
    },
  ];

  return {
    events: [event],
    organizers,
    participantsByEvent: { [evtId]: participants },
    logsByEvent: { [evtId]: logs },
    pendingQueue: [],
  };
}

function readLocalState(): MarathonAppState {
  if (typeof window === 'undefined') return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = buildSeedState();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as MarathonAppState;
    if (!parsed.events || parsed.events.length === 0) {
      const seed = buildSeedState();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    return parsed;
  } catch {
    return buildSeedState();
  }
}

function writeLocalState(next: MarathonAppState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage({ type: 'STATE_UPDATED', updatedAt: Date.now() });
      ch.close();
    }
  } catch (err) {
    console.warn('Local storage write warning:', err);
  }
}

export function getStateSnapshot(): MarathonAppState {
  return readLocalState();
}

export function subscribeLocalSync(onUpdate: (state: MarathonAppState) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      onUpdate(readLocalState());
    }
  };
  window.addEventListener('storage', handleStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = () => {
      onUpdate(readLocalState());
    };
  }

  return () => {
    window.removeEventListener('storage', handleStorage);
    channel?.close();
  };
}

export function updateLocalState(updater: (prev: MarathonAppState) => MarathonAppState): MarathonAppState {
  const prev = readLocalState();
  const next = updater(prev);
  writeLocalState(next);
  return next;
}

export function registerInvitedOrganizerLocally(payload: {
  org: Organizer;
  event: MarathonEvent | null;
}): MarathonAppState {
  return updateLocalState((prev) => {
    const existingOrg = prev.organizers.find(
      (o) => o.magicToken === payload.org.magicToken || o.id === payload.org.id
    );
    const nextOrganizers = existingOrg
      ? prev.organizers.map((o) =>
          o.id === existingOrg.id
            ? {
                ...o,
                name: payload.org.name,
                boothName: payload.org.boothName,
                assignedItems: payload.org.assignedItems,
                whatsappPhone: payload.org.whatsappPhone ?? o.whatsappPhone,
              }
            : o
        )
      : [payload.org, ...prev.organizers];

    let nextEvents = prev.events;
    if (payload.event) {
      const hasEvent = prev.events.some((e) => e.id === payload.event?.id);
      nextEvents = hasEvent
        ? prev.events.map((e) => (e.id === payload.event?.id ? { ...e, ...payload.event } : e))
        : [payload.event, ...prev.events];
    }

    return {
      ...prev,
      events: nextEvents,
      organizers: nextOrganizers,
    };
  });
}

export async function syncToCloudSql(
  idToken: string | null,
  action: string,
  payload: unknown
): Promise<void> {
  if (!idToken || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  try {
    await fetch('/api/db/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    // Non-blocking mirror sync
  }
}

export async function executeAtomicDelivery(params: {
  eventId: string;
  barcode: string;
  organizer: Organizer;
  item: DeliverableItem;
  displayFields: string[];
  isOnline: boolean;
  useFirestore: boolean;
  idToken: string | null;
}) {
  const { eventId, barcode, organizer, item, displayFields, isOnline, useFirestore, idToken } = params;
  const state = readLocalState();
  const list = state.participantsByEvent[eventId] ?? [];
  const participant = list.find((p) => p.barcode === barcode);

  if (!participant) {
    return { ok: false as const, reason: 'not_found' as const };
  }

  const latestOrg = state.organizers.find((o) => o.id === organizer.id) ?? organizer;
  const localResult = attemptLocalDelivery({
    eventId,
    participant,
    organizer: latestOrg,
    item,
    displayFields,
  });

  if (!localResult.ok) {
    return localResult;
  }

  if (useFirestore && isOnline) {
    try {
      const { db } = getFirebaseServices();
      const participantRef = doc(db, 'events', eventId, 'participants', barcode);
      const organizerRef = doc(db, 'organizers', organizer.id);
      const logRef = doc(collection(db, 'events', eventId, 'activity_logs'));

      await runTransaction(db, async (tx) => {
        const pSnap = await tx.get(participantRef);
        const oSnap = await tx.get(organizerRef);
        if (oSnap.exists() && oSnap.data().isActive === false) {
          throw new Error('ORGANIZER_FROZEN');
        }
        if (pSnap.exists()) {
          const currentDeliveries = pSnap.data().deliveries ?? {};
          if (currentDeliveries[item.id]?.status === 'delivered') {
            throw new Error('ALREADY_DELIVERED');
          }
          tx.update(participantRef, {
            deliveries: {
              ...currentDeliveries,
              [item.id]: localResult.deliveryRecord,
            },
          });
        } else {
          tx.set(participantRef, localResult.updatedParticipant);
        }

        if (oSnap.exists()) {
          tx.update(organizerRef, {
            deliveredCount: (oSnap.data().deliveredCount ?? 0) + 1,
          });
        }

        tx.set(logRef, {
          participantName: localResult.logEntry.participantName,
          barcode,
          itemName: item.name,
          organizerName: organizer.name,
          action: 'delivered',
          timestamp: serverTimestamp(),
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'ORGANIZER_FROZEN') {
        return { ok: false as const, reason: 'organizer_frozen' as const };
      }
      if (err instanceof Error && err.message === 'ALREADY_DELIVERED') {
        return {
          ok: false as const,
          reason: 'already_delivered' as const,
          existingDelivery: participant.deliveries[item.id],
        };
      }
      // Queue for offline sync if network/permission prevented immediate Firestore commit
      console.warn('Firestore transaction deferred to offline queue:', err);
    }
  }

  // Persist locally immediately (and queue if offline)
  updateLocalState((prev) => {
    const nextParticipants = (prev.participantsByEvent[eventId] ?? []).map((p) =>
      p.barcode === barcode ? localResult.updatedParticipant : p
    );
    const nextOrganizers = prev.organizers.map((o) =>
      o.id === organizer.id ? localResult.updatedOrganizer : o
    );
    const nextLogs = [localResult.logEntry, ...(prev.logsByEvent[eventId] ?? [])].slice(0, 100);
    const nextQueue =
      !isOnline || !useFirestore
        ? [
            ...prev.pendingQueue,
            {
              id: `mut_${Date.now()}`,
              type: 'deliver' as const,
              eventId,
              barcode,
              itemId: item.id,
              itemName: item.name,
              organizerId: organizer.id,
              organizerName: organizer.name,
              participantName: localResult.logEntry.participantName,
              createdAt: localResult.logEntry.timestamp,
            },
          ]
        : prev.pendingQueue;

    return {
      ...prev,
      participantsByEvent: { ...prev.participantsByEvent, [eventId]: nextParticipants },
      organizers: nextOrganizers,
      logsByEvent: { ...prev.logsByEvent, [eventId]: nextLogs },
      pendingQueue: nextQueue,
    };
  });

  void syncToCloudSql(idToken, 'deliver', {
    eventId,
    barcode,
    itemId: item.id,
    itemName: item.name,
    organizerId: organizer.id,
    organizerName: organizer.name,
    participantName: localResult.logEntry.participantName,
    deliveryRecord: localResult.deliveryRecord,
  });

  return localResult;
}

export async function flushOfflineQueue(params: {
  useFirestore: boolean;
  idToken: string | null;
}): Promise<number> {
  const { useFirestore, idToken } = params;
  const state = readLocalState();
  if (state.pendingQueue.length === 0) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  let flushed = 0;
  const remaining: OfflineMutation[] = [];

  for (const mut of state.pendingQueue) {
    if (useFirestore) {
      try {
        const { db } = getFirebaseServices();
        const participantRef = doc(db, 'events', mut.eventId, 'participants', mut.barcode);
        const organizerRef = doc(db, 'organizers', mut.organizerId);
        const logRef = doc(collection(db, 'events', mut.eventId, 'activity_logs'));

        await runTransaction(db, async (tx) => {
          const pSnap = await tx.get(participantRef);
          const oSnap = await tx.get(organizerRef);
          if (pSnap.exists()) {
            const deliveries = pSnap.data().deliveries ?? {};
            if (!deliveries[mut.itemId]) {
              tx.update(participantRef, {
                deliveries: {
                  ...deliveries,
                  [mut.itemId]: {
                    status: 'delivered',
                    deliveredByOrganizerId: mut.organizerId,
                    deliveredByOrganizerName: mut.organizerName,
                    deliveredAt: mut.createdAt,
                  },
                },
              });
            }
          }
          if (oSnap.exists()) {
            tx.update(organizerRef, {
              deliveredCount: (oSnap.data().deliveredCount ?? 0) + 1,
            });
          }
          tx.set(logRef, {
            participantName: mut.participantName,
            barcode: mut.barcode,
            itemName: mut.itemName,
            organizerName: mut.organizerName,
            action: 'delivered',
            timestamp: serverTimestamp(),
          });
        });
        flushed += 1;
      } catch {
        remaining.push(mut);
      }
    } else {
      await syncToCloudSql(idToken, 'deliver', mut);
      flushed += 1;
    }
  }

  updateLocalState((prev) => ({
    ...prev,
    pendingQueue: remaining,
  }));

  return flushed;
}

export async function batchImportParticipants(params: {
  eventId: string;
  rows: Record<string, string>[];
  barcodeField: string;
  searchFields: string[];
  displayFields: string[];
  displayLabels: Record<string, string>;
  useFirestore: boolean;
  idToken: string | null;
  onProgress: (percent: number, processed: number, total: number) => void;
}): Promise<number> {
  const {
    eventId,
    rows,
    barcodeField,
    searchFields,
    displayFields,
    displayLabels,
    useFirestore,
    idToken,
    onProgress,
  } = params;

  const built: Participant[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const rawBarcode = row[barcodeField] ?? '';
    const barcode = normalizeBarcode(String(rawBarcode));
    if (!barcode || seen.has(barcode)) continue;
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
      searchKeywords: generateSearchKeywords(dynamicData, searchFields, barcode),
      dynamicData,
      deliveries: {},
    });
  }

  const total = built.length;
  if (total === 0) return 0;

  if (useFirestore) {
    const { db } = getFirebaseServices();
    const CHUNK_SIZE = 400;
    for (let i = 0; i < built.length; i += CHUNK_SIZE) {
      const chunk = built.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const p of chunk) {
        batch.set(doc(db, 'events', eventId, 'participants', p.barcode), p);
      }
      try {
        await batch.commit();
      } catch (err) {
        console.warn('Firestore batch write fallback to local store:', err);
      }
      const processed = Math.min(i + chunk.length, total);
      onProgress(Math.round((processed / total) * 100), processed, total);
    }

    try {
      await updateDoc(doc(db, 'events', eventId), {
        displayFields,
        displayLabels,
        searchFields,
        totalParticipants: total,
      });
    } catch {
      // Fallback handled locally
    }
  } else {
    onProgress(100, total, total);
  }

  updateLocalState((prev) => ({
    ...prev,
    events: prev.events.map((ev) =>
      ev.id === eventId
        ? {
            ...ev,
            displayFields,
            displayLabels,
            searchFields,
            totalParticipants: total,
          }
        : ev
    ),
    participantsByEvent: {
      ...prev.participantsByEvent,
      [eventId]: built,
    },
  }));

  void syncToCloudSql(idToken, 'import_participants', {
    eventId,
    displayFields,
    displayLabels,
    searchFields,
    participants: built,
  });

  return total;
}

export async function performAdminUndo(params: {
  eventId: string;
  barcode: string;
  item: DeliverableItem;
  adminName: string;
  displayFields: string[];
  useFirestore: boolean;
  idToken: string | null;
}) {
  const { eventId, barcode, item, adminName, displayFields, useFirestore, idToken } = params;
  const state = readLocalState();
  const participant = (state.participantsByEvent[eventId] ?? []).find(
    (p) => p.barcode === barcode
  );
  if (!participant) return;

  const { updatedParticipant, logEntry } = adminUndoDelivery({
    eventId,
    participant,
    item,
    adminName,
    displayFields,
  });

  if (useFirestore) {
    try {
      const { db } = getFirebaseServices();
      await runTransaction(db, async (tx) => {
        const pRef = doc(db, 'events', eventId, 'participants', barcode);
        const logRef = doc(collection(db, 'events', eventId, 'activity_logs'));
        tx.update(pRef, { deliveries: updatedParticipant.deliveries });
        tx.set(logRef, {
          participantName: logEntry.participantName,
          barcode,
          itemName: item.name,
          organizerName: adminName,
          action: 'undone',
          timestamp: serverTimestamp(),
        });
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}/participants/${barcode}`);
    }
  }

  updateLocalState((prev) => ({
    ...prev,
    participantsByEvent: {
      ...prev.participantsByEvent,
      [eventId]: (prev.participantsByEvent[eventId] ?? []).map((p) =>
        p.barcode === barcode ? updatedParticipant : p
      ),
    },
    logsByEvent: {
      ...prev.logsByEvent,
      [eventId]: [logEntry, ...(prev.logsByEvent[eventId] ?? [])].slice(0, 100),
    },
  }));

  void syncToCloudSql(idToken, 'undo', {
    eventId,
    barcode,
    itemId: item.id,
    itemName: item.name,
    adminName,
    participantName: logEntry.participantName,
    deliveries: updatedParticipant.deliveries,
  });
}

export function subscribeFirestoreLiveFeed(
  eventId: string,
  enabled: boolean,
  onLogs: (logs: ActivityLog[]) => void
): () => void {
  if (!enabled || !eventId) return () => {};
  try {
    const { db } = getFirebaseServices();
    const q = query(
      collection(db, 'events', eventId, 'activity_logs'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    return onSnapshot(
      q,
      (snap) => {
        const list: ActivityLog[] = snap.docs.map((d) => {
          const data = d.data();
          const ts =
            data.timestamp && typeof data.timestamp.toDate === 'function'
              ? data.timestamp.toDate().toISOString()
              : String(data.timestamp ?? new Date().toISOString());
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
            timestamp: ts,
          };
        });
        if (list.length > 0) {
          onLogs(list);
        }
      },
      (err) => {
        console.warn('Live feed snapshot fallback:', err.message);
      }
    );
  } catch {
    return () => {};
  }
}

export async function saveEventRemote(
  event: MarathonEvent,
  useFirestore: boolean,
  idToken: string | null
) {
  if (useFirestore) {
    try {
      const { db } = getFirebaseServices();
      await setDoc(doc(db, 'events', event.id), {
        ...event,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Firestore saveEvent deferred:', err);
    }
  }
  void syncToCloudSql(idToken, 'upsert_event', event);
}

export async function saveOrganizerRemote(
  organizer: Organizer,
  useFirestore: boolean,
  idToken: string | null
) {
  if (useFirestore) {
    try {
      const { db } = getFirebaseServices();
      await setDoc(doc(db, 'organizers', organizer.id), {
        ...organizer,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Firestore saveOrganizer deferred:', err);
    }
  }
  void syncToCloudSql(idToken, 'upsert_organizer', organizer);
}

export async function toggleOrganizerFreezeRemote(
  organizerId: string,
  isActive: boolean,
  useFirestore: boolean,
  idToken: string | null
) {
  if (useFirestore) {
    try {
      const { db } = getFirebaseServices();
      await updateDoc(doc(db, 'organizers', organizerId), { isActive });
    } catch (err) {
      console.warn('Firestore toggleOrganizerFreeze deferred:', err);
    }
  }
  void syncToCloudSql(idToken, 'toggle_organizer', { organizerId, isActive });
}

export async function deleteOrganizerRemote(organizerId: string, useFirestore: boolean) {
  if (useFirestore) {
    try {
      const { db } = getFirebaseServices();
      await deleteDoc(doc(db, 'organizers', organizerId));
    } catch {
      // Ignore
    }
  }
}
