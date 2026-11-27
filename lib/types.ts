export interface DeliverableItem {
  id: string;
  name: string;
  dependsOnItemId?: string;
}

export interface DeliveryRecord {
  status: 'delivered';
  deliveredByOrganizerId: string;
  deliveredByOrganizerName: string;
  deliveredAt: string;
}

export type SheetsColumnSourceType =
  | 'barcode'
  | 'participant_name'
  | 'dynamic_field'
  | 'item_status'
  | 'item_time'
  | 'item_organizer'
  | 'item_organizer_name'
  | 'item_booth'
  | 'static_text';

export interface SheetsColumnMapping {
  id: string;
  header: string;
  sourceType: SheetsColumnSourceType;
  fieldKey?: string;
  itemId?: string;
  staticValue?: string;
}

export type SheetsRuleOperator =
  | 'is_delivered'
  | 'is_not_delivered'
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty';

export interface SheetsColorCondition {
  id: string;
  columnId: string;
  operator: SheetsRuleOperator;
  value?: string;
}

export type SheetsColorRuleMode = 'preset_delivery' | 'conditions' | 'custom_formula';
export type SheetsDeliveryPresetType = 'all_delivered' | 'partial_delivered' | 'none_delivered';

export interface SheetsColorRule {
  id: string;
  name: string;
  enabled: boolean;
  mode: SheetsColorRuleMode;
  presetType?: SheetsDeliveryPresetType;
  presetColumnIds?: string[];
  logic: 'AND' | 'OR';
  conditions: SheetsColorCondition[];
  customFormula?: string;
  requireNonEmptyRow?: boolean;
  backgroundColor: string;
  fontColor?: string;
  bold?: boolean;
  targetScope: 'row' | 'column';
  targetColumnId?: string;
}

export interface MarathonEvent {
  id: string;
  name: string;
  date: string;
  isActive: boolean;
  registrationStatus?: 'auto' | 'open' | 'closed';
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  sheetsWebhookUrl?: string;
  sheetsWebhookSecret?: string;
  sheetsAutoSync?: boolean;
  sheetsColumns?: SheetsColumnMapping[];
  sheetsColorRules?: SheetsColorRule[];
  deliverableItems: DeliverableItem[];
  displayFields: string[];
  displayLabels?: Record<string, string>;
  nameField?: string;
  searchFields: string[];
  totalParticipants: number;
  ownerUid: string;
  createdAt: string;
}

export interface Organizer {
  id: string;
  eventId: string;
  name: string;
  boothName: string;
  whatsappPhone?: string;
  assignedItems: string[];
  magicToken: string;
  isActive: boolean;
  deliveredCount: number;
  createdAt: string;
}

export interface Participant {
  barcode: string;
  searchKeywords: string[];
  dynamicData: Record<string, string>;
  deliveries: Record<string, DeliveryRecord>;
}

export interface ActivityLog {
  id: string;
  eventId: string;
  participantName: string;
  barcode: string;
  itemId: string;
  itemName: string;
  organizerId: string;
  organizerName: string;
  action: 'delivered' | 'undone';
  timestamp: string;
  viaOffline?: boolean;
  clientDeliveredAt?: string;
  deviceId?: string;
}

export interface ConflictDeliveryEntry {
  logId: string;
  organizerId: string;
  organizerName: string;
  boothName?: string;
  timestamp: string;
  clientDeliveredAt?: string;
  viaOffline: boolean;
  deviceId?: string;
}

export interface DeliveryConflict {
  conflictKey: string;
  barcode: string;
  participantName: string;
  itemId: string;
  itemName: string;
  deliveries: ConflictDeliveryEntry[];
}

export interface DeliveryConflictResolution {
  id: string;
  barcode: string;
  itemId: string;
  status: 'resolved';
  note?: string;
  resolvedLogCount: number;
  resolvedAt: string;
}

export interface ColumnMapping {
  barcodeField: string;
  nameField?: string;
  searchFields: string[];
  displayFields: string[];
  displayLabels: Record<string, string>;
}

export interface OfflineMutation {
  id: string;
  type: 'deliver';
  eventId: string;
  barcode: string;
  itemId: string;
  itemName: string;
  organizerId: string;
  organizerName: string;
  participantName: string;
  createdAt: string;
}

export interface ItemProgressStat {
  itemId: string;
  itemName: string;
  delivered: number;
  total: number;
  totalParticipants: number;
  prerequisiteName?: string;
  percentage: number;
}
