import { z } from 'zod';
import { AUTHORITY_IDS, FREQUENCIES, INCIDENT_TYPE_IDS } from './constants.js';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const ReportCreateSchema = z.object({
  type: z.enum(INCIDENT_TYPE_IDS),
  severity: z.number().int().min(1).max(5),
  frequency: z.enum(FREQUENCIES),
  tags: z.array(z.string().max(40)).max(15).default([]),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  lat,
  lng,
  description: z.string().max(4000).default(''),
  eventId: z.string().optional().nullable(),
  subzoneId: z.string().optional().nullable(),
});
export type ReportCreate = z.infer<typeof ReportCreateSchema>;

export const AiStructureSchema = z.object({ text: z.string().min(3).max(4000) });

export const DraftSchema = z.object({
  authority: z.enum(AUTHORITY_IDS),
  type: z.string(),
  severity: z.number().int().min(1).max(5),
  frequency: z.string(),
  occurredAt: z.string().nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(6000),
  tags: z.array(z.string()).optional(),
  institution: z.string().max(200).nullable().optional(),
  vehicleOrRoute: z.string().max(200).nullable().optional(),
  accusedDescription: z.string().max(1000).nullable().optional(),
  witnesses: z.string().max(500).nullable().optional(),
  evidence: z.array(z.string().max(300)).max(20).optional(),
  complainantName: z.string().max(120).nullable().optional(),
  complainantContact: z.string().max(120).nullable().optional(),
});

export const CircleCreateSchema = z.object({ name: z.string().min(1).max(60), displayName: z.string().min(1).max(40) });
export const CircleJoinSchema = z.object({ inviteCode: z.string().min(4).max(12), displayName: z.string().min(1).max(40) });

export const TripStartSchema = z.object({
  destination: z.string().min(1).max(200),
  destLat: lat.optional().nullable(),
  destLng: lng.optional().nullable(),
  etaMinutes: z.number().int().min(1).max(24 * 60),
  checkinIntervalMin: z.number().int().min(1).max(240),
  circleId: z.string().optional().nullable(),
  shareLocation: z.boolean().default(true),
});
export const TripCheckinSchema = z.object({
  kind: z.enum(['safe', 'delayed', 'help']),
  note: z.string().max(300).optional(),
  delayMinutes: z.number().int().min(1).max(240).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
});

export const ShareCreateSchema = z.object({
  label: z.string().max(80).default('My live location'),
  durationMin: z.number().int().min(1).max(24 * 60),
  stopOnArrival: z.boolean().default(false),
  tripId: z.string().optional().nullable(),
  circleIds: z.array(z.string()).default([]),
  contactIds: z.array(z.string()).default([]),
});

export const PingSchema = z.object({ lat, lng, accuracy: z.number().min(0).max(100000).optional() });

export const SosStartSchema = z.object({
  lat: lat.optional(),
  lng: lng.optional(),
  note: z.string().max(300).optional(),
  contactIds: z.array(z.string()).optional(),
  circleIds: z.array(z.string()).optional(),
});

export const ContactSchema = z.object({
  name: z.string().min(1).max(80),
  phone: z.string().max(20).optional().nullable(),
});

export const SubzoneSchema = z.object({ id: z.string().optional(), name: z.string().min(1).max(60), lat, lng, radiusM: z.number().min(20).max(5000) });
export const EventCreateSchema = z.object({
  name: z.string().min(1).max(100),
  centerLat: lat,
  centerLng: lng,
  radiusM: z.number().min(50).max(20000),
  startsAt: z.string(),
  endsAt: z.string(),
  subzones: z.array(SubzoneSchema).max(30).default([]),
  thresholds: z.object({ advisory: z.number().int().min(1), warning: z.number().int().min(1) }).optional(),
  displayName: z.string().min(1).max(40),
});
export const EventJoinSchema = z.object({ code: z.string().min(4).max(12), displayName: z.string().min(1).max(40) });
export const EventStatusSchema = z.object({ status: z.enum(['safe', 'need_help']), subzoneId: z.string().optional().nullable(), lat: lat.optional(), lng: lng.optional() });

export const WatchAreaSchema = z.object({ label: z.string().max(60), lat, lng, radiusM: z.number().min(100).max(10000) });
export const SettingsSchema = z.object({
  displayName: z.string().max(40).optional(),
  voiceGuard: z.object({ enabled: z.boolean(), keywords: z.array(z.string().max(30)).max(10) }).optional(),
  watchAreas: z.array(WatchAreaSchema).max(10).optional(),
  notifications: z.object({ push: z.boolean(), watchAreaAlerts: z.boolean(), eventAlerts: z.boolean(), circleAlerts: z.boolean() }).optional(),
  defaultShareMinutes: z.number().int().min(5).max(24 * 60).optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Required<Settings> = {
  displayName: '',
  voiceGuard: { enabled: false, keywords: ['help me', 'bachao', 'बचाओ', 'raksha'] },
  watchAreas: [],
  notifications: { push: true, watchAreaAlerts: true, eventAlerts: true, circleAlerts: true },
  defaultShareMinutes: 60,
};
