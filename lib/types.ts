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

export interface MarathonEvent {
  id: string;
  name: string;
  date: string;
  isActive: boolean;
  registrationStatus?: 'auto' | 'open' | 'closed';
  registrationOpensAt?: string;
  registrationClosesAt?: string;
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
