export const INCIDENT_TYPES = [
  { id: 'verbal', label: 'Verbal harassment / catcalling', hi: 'अभद्र टिप्पणी' },
  { id: 'stalking', label: 'Stalking / following', hi: 'पीछा करना' },
  { id: 'physical', label: 'Groping / unwanted touch', hi: 'छेड़छाड़ / गलत स्पर्श' },
  { id: 'staring', label: 'Staring / intimidation', hi: 'घूरना / डराना' },
  { id: 'indecent_exposure', label: 'Indecent exposure / gestures', hi: 'अश्लील इशारे' },
  { id: 'photography', label: 'Non-consensual photo / video', hi: 'बिना अनुमति फोटो/वीडियो' },
  { id: 'online', label: 'Online / cyber harassment', hi: 'ऑनलाइन उत्पीड़न' },
  { id: 'assault', label: 'Assault / violence', hi: 'हमला / हिंसा' },
  { id: 'other', label: 'Other', hi: 'अन्य' },
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number]['id'];
export const INCIDENT_TYPE_IDS = INCIDENT_TYPES.map((t) => t.id) as [IncidentType, ...IncidentType[]];

export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor discomfort',
  2: 'Unsettling',
  3: 'Threatening',
  4: 'Severe',
  5: 'Dangerous / violent',
};

export const FREQUENCIES = ['once', 'repeated', 'ongoing'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const REPORT_TAGS = [
  'night',
  'public_transport',
  'bus_stop',
  'metro',
  'auto_cab',
  'market',
  'campus',
  'workplace',
  'poorly_lit',
  'isolated',
  'group_of_men',
  'repeat_offender',
  'crowd',
  'event',
  'online',
] as const;

export const AUTHORITIES = [
  { id: 'police', label: 'Police (FIR / complaint)' },
  { id: 'college', label: 'College ICC / Anti-harassment cell' },
  { id: 'workplace', label: 'Workplace Internal Committee (POSH)' },
  { id: 'transport', label: 'Transport authority (bus / metro / cab)' },
  { id: 'cybercrime', label: 'Cybercrime cell (cybercrime.gov.in)' },
] as const;
export type AuthorityId = (typeof AUTHORITIES)[number]['id'];
export const AUTHORITY_IDS = AUTHORITIES.map((a) => a.id) as [AuthorityId, ...AuthorityId[]];

export const RISK_LEVELS = ['low', 'moderate', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const HELPLINES = {
  emergency: '112',
  women: '181',
  cyber: '1930',
};

export const TRIP_STATES = ['ok', 'delayed', 'help'] as const;
