import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../../src/db/index.ts';
import {
  activityLogs,
  events,
  organizers,
  participants,
  type DeliveryRecordRow,
} from '../../../../src/db/schema.ts';
import { verifyRequestAuth } from '../../../../src/middleware/auth.ts';

export async function POST(req: NextRequest) {
  const decoded = await verifyRequestAuth(req);
  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { action, payload } = (await req.json()) as {
      action: string;
      payload: Record<string, unknown>;
    };

    if (action === 'upsert_event') {
      const ev = payload as {
        id: string;
        name: string;
        date: string;
        isActive: boolean;
        deliverableItems: Array<{ id: string; name: string }>;
        displayFields: string[];
        displayLabels?: Record<string, string>;
        searchFields: string[];
        totalParticipants: number;
      };

      if (ev.isActive) {
        await db.update(events).set({ isActive: false }).where(eq(events.ownerUid, decoded.uid));
      }

      await db
        .insert(events)
        .values({
          id: ev.id,
          ownerUid: decoded.uid,
          name: ev.name,
          date: ev.date,
          isActive: ev.isActive,
          deliverableItems: ev.deliverableItems,
          displayFields: ev.displayFields,
          displayLabels: ev.displayLabels ?? {},
          searchFields: ev.searchFields,
          totalParticipants: ev.totalParticipants ?? 0,
        })
        .onConflictDoUpdate({
          target: events.id,
          set: {
            name: ev.name,
            date: ev.date,
            isActive: ev.isActive,
            deliverableItems: ev.deliverableItems,
            displayFields: ev.displayFields,
            displayLabels: ev.displayLabels ?? {},
            searchFields: ev.searchFields,
            totalParticipants: ev.totalParticipants ?? 0,
            updatedAt: new Date(),
          },
        });

      return NextResponse.json({ ok: true });
    }

    if (action === 'upsert_organizer') {
      const org = payload as {
        id: string;
        eventId: string;
        name: string;
        boothName: string;
        assignedItems: string[];
        magicToken: string;
        isActive: boolean;
        deliveredCount: number;
      };

      await db
        .insert(organizers)
        .values({
          id: org.id,
          eventId: org.eventId,
          name: org.name,
          boothName: org.boothName ?? '',
          assignedItems: org.assignedItems,
          magicToken: org.magicToken,
          isActive: org.isActive,
          deliveredCount: org.deliveredCount ?? 0,
        })
        .onConflictDoUpdate({
          target: organizers.id,
          set: {
            name: org.name,
            boothName: org.boothName ?? '',
            assignedItems: org.assignedItems,
            isActive: org.isActive,
            deliveredCount: org.deliveredCount ?? 0,
          },
        });

      return NextResponse.json({ ok: true });
    }

    if (action === 'toggle_organizer') {
      const { organizerId, isActive } = payload as { organizerId: string; isActive: boolean };
      await db.update(organizers).set({ isActive }).where(eq(organizers.id, organizerId));
      return NextResponse.json({ ok: true });
    }

    if (action === 'import_participants') {
      const { eventId, displayFields, displayLabels, searchFields, participants: rows } =
        payload as {
          eventId: string;
          displayFields: string[];
          displayLabels: Record<string, string>;
          searchFields: string[];
          participants: Array<{
            barcode: string;
            searchKeywords: string[];
            dynamicData: Record<string, string>;
            deliveries: Record<string, DeliveryRecordRow>;
          }>;
        };

      await db
        .update(events)
        .set({
          displayFields,
          displayLabels,
          searchFields,
          totalParticipants: rows.length,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId));

      for (const p of rows) {
        await db
          .insert(participants)
          .values({
            eventId,
            barcode: p.barcode,
            searchKeywords: p.searchKeywords,
            dynamicData: p.dynamicData,
            deliveries: p.deliveries ?? {},
          })
          .onConflictDoUpdate({
            target: [participants.eventId, participants.barcode],
            set: {
              searchKeywords: p.searchKeywords,
              dynamicData: p.dynamicData,
              updatedAt: new Date(),
            },
          });
      }

      return NextResponse.json({ ok: true, count: rows.length });
    }

    if (action === 'deliver') {
      const d = payload as {
        eventId: string;
        barcode: string;
        itemId: string;
        itemName: string;
        organizerId: string;
        organizerName: string;
        participantName: string;
        deliveryRecord: DeliveryRecordRow;
      };

      const existing = await db
        .select()
        .from(participants)
        .where(and(eq(participants.eventId, d.eventId), eq(participants.barcode, d.barcode)));

      if (existing[0]) {
        const nextDeliveries = {
          ...(existing[0].deliveries ?? {}),
          [d.itemId]: d.deliveryRecord,
        };
        await db
          .update(participants)
          .set({ deliveries: nextDeliveries, updatedAt: new Date() })
          .where(eq(participants.id, existing[0].id));
      }

      await db
        .update(organizers)
        .set({ deliveredCount: sql`${organizers.deliveredCount} + 1` })
        .where(eq(organizers.id, d.organizerId));

      await db.insert(activityLogs).values({
        eventId: d.eventId,
        participantName: d.participantName,
        barcode: d.barcode,
        itemId: d.itemId,
        itemName: d.itemName,
        organizerId: d.organizerId,
        organizerName: d.organizerName,
        action: 'delivered',
      });

      return NextResponse.json({ ok: true });
    }

    if (action === 'undo') {
      const u = payload as {
        eventId: string;
        barcode: string;
        itemId: string;
        itemName: string;
        adminName: string;
        participantName: string;
        deliveries: Record<string, DeliveryRecordRow>;
      };

      await db
        .update(participants)
        .set({ deliveries: u.deliveries, updatedAt: new Date() })
        .where(and(eq(participants.eventId, u.eventId), eq(participants.barcode, u.barcode)));

      await db.insert(activityLogs).values({
        eventId: u.eventId,
        participantName: u.participantName,
        barcode: u.barcode,
        itemId: u.itemId,
        itemName: u.itemName,
        organizerId: decoded.uid,
        organizerName: u.adminName,
        action: 'undone',
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Cloud SQL sync route warning:', error);
    return NextResponse.json(
      { ok: false, error: 'Database sync deferred to Firestore offline cache.' },
      { status: 503 }
    );
  }
}
