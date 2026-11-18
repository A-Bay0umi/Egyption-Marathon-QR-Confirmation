import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export interface DeliverableItemRow {
  id: string;
  name: string;
}

export interface DeliveryRecordRow {
  status: 'delivered';
  deliveredByOrganizerId: string;
  deliveredByOrganizerName: string;
  deliveredAt: string;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid').notNull(),
  name: text('name').notNull(),
  date: text('date').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  deliverableItems: jsonb('deliverable_items').$type<DeliverableItemRow[]>().notNull().default([]),
  displayFields: jsonb('display_fields').$type<string[]>().notNull().default([]),
  displayLabels: jsonb('display_labels').$type<Record<string, string>>().notNull().default({}),
  searchFields: jsonb('search_fields').$type<string[]>().notNull().default([]),
  totalParticipants: integer('total_participants').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const organizers = pgTable('organizers', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  boothName: text('booth_name').notNull().default(''),
  assignedItems: jsonb('assigned_items').$type<string[]>().notNull().default([]),
  magicToken: text('magic_token').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  deliveredCount: integer('delivered_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const participants = pgTable(
  'participants',
  {
    id: serial('id').primaryKey(),
    eventId: text('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    barcode: text('barcode').notNull(),
    searchKeywords: jsonb('search_keywords').$type<string[]>().notNull().default([]),
    dynamicData: jsonb('dynamic_data').$type<Record<string, string>>().notNull().default({}),
    deliveries: jsonb('deliveries').$type<Record<string, DeliveryRecordRow>>().notNull().default({}),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('participants_event_barcode_idx').on(table.eventId, table.barcode)]
);

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  eventId: text('event_id')
    .references(() => events.id, { onDelete: 'cascade' })
    .notNull(),
  participantName: text('participant_name').notNull(),
  barcode: text('barcode').notNull(),
  itemId: text('item_id').notNull(),
  itemName: text('item_name').notNull(),
  organizerId: text('organizer_id').notNull(),
  organizerName: text('organizer_name').notNull(),
  action: text('action').notNull(), // 'delivered' | 'undone'
  timestamp: timestamp('timestamp').defaultNow(),
});

export const eventsRelations = relations(events, ({ many }) => ({
  organizers: many(organizers),
  participants: many(participants),
  activityLogs: many(activityLogs),
}));

export const organizersRelations = relations(organizers, ({ one }) => ({
  event: one(events, {
    fields: [organizers.eventId],
    references: [events.id],
  }),
}));

export const participantsRelations = relations(participants, ({ one }) => ({
  event: one(events, {
    fields: [participants.eventId],
    references: [events.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  event: one(events, {
    fields: [activityLogs.eventId],
    references: [events.id],
  }),
}));
