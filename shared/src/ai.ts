import { AUTHORITIES, HELPLINES, INCIDENT_TYPES, SEVERITY_LABELS, type AuthorityId, type Frequency, type IncidentType } from './constants.js';
import { scrubPII } from './privacy.js';

export interface StructuredIncident {
  type: IncidentType;
  severity: number;
  frequency: Frequency;
  tags: string[];
  timeHint: string | null;
  occurredAtSuggestion: string | null; // ISO
  placeHint: string | null;
  summary: string;
  language: 'en' | 'hi' | 'hinglish';
  confidence: number;
  source: 'offline' | 'llm';
}

// Keyword lexicon covering English, Devanagari Hindi and romanised Hinglish.
const TYPE_LEXICON: Array<{ type: IncidentType; words: string[]; sev: number }> = [
  { type: 'assault', sev: 5, words: ['assault', 'attack', 'hit me', 'slapped', 'beat', 'rape', 'maara', 'mara', 'peeta', 'hamla', 'हमला', 'मारा', 'बलात्कार'] },
  { type: 'physical', sev: 4, words: ['grope', 'groped', 'touched', 'touch', 'pinched', 'brushed against', 'grabbed', 'molest', 'chhua', 'chua', 'haath lagaya', 'chhed', 'chhedkhani', 'chhedchhad', 'chedkhani', 'chhuaa', 'छुआ', 'छेड़छाड़', 'छेड़'] },
  { type: 'stalking', sev: 4, words: ['follow', 'followed', 'following', 'stalk', 'stalking', 'stalker', 'peecha', 'pichha', 'picha', 'peechha', 'peeche', 'पीछा'] },
  { type: 'indecent_exposure', sev: 4, words: ['flash', 'flashed', 'exposed', 'masturbating', 'masturbated', 'obscene gesture', 'gande ishare', 'ganda ishara', 'अश्लील'] },
  { type: 'photography', sev: 3, words: ['photo', 'video', 'recorded', 'filming', 'clicked', 'camera', 'pic', 'फोटो', 'वीडियो'] },
  { type: 'online', sev: 3, words: ['instagram', 'whatsapp', 'dm', 'online', 'message', 'morphed', 'troll', 'cyber', 'facebook', 'snapchat', 'telegram', 'ऑनलाइन'] },
  { type: 'staring', sev: 2, words: ['stare', 'staring', 'stared', 'ogling', 'ghoor', 'ghur', 'ghoorna', 'ghoora', 'घूर'] },
  { type: 'verbal', sev: 2, words: ['catcall', 'whistle', 'comment', 'abuse', 'abusive', 'called me', 'vulgar', 'lewd', 'gaali', 'gali', 'taana', 'seeti', 'bola', 'kaha', 'टिप्पणी', 'गाली', 'सीटी'] },
];

const SEVERITY_BOOST = ['knife', 'weapon', 'blood', 'injured', 'dragged', 'pulled', 'forced', 'threat', 'kill', 'dhamki', 'chaku', 'zabardasti', 'धमकी', 'चाकू', 'जबरदस्ती'];
const GROUP_WORDS = ['group', 'gang', 'boys', 'men', 'ladke', 'log', 'लड़के', 'कई'];
const REPEAT_WORDS = ['again', 'every day', 'daily', 'everyday', 'repeatedly', 'always', 'roz', 'rozana', 'har din', 'baar baar', 'phir se', 'रोज', 'बार बार', 'हर दिन'];
const ONGOING_WORDS = ['still', 'continues', 'ongoing', 'abhi bhi', 'ab bhi', 'lagatar', 'अभी भी', 'लगातार'];

const PLACE_LEXICON: Array<{ words: string[]; place: string; tags: string[] }> = [
  { words: ['bus stop', 'bus stand', 'busstop'], place: 'Bus stop', tags: ['bus_stop', 'public_transport'] },
  { words: ['bus', 'बस'], place: 'Bus', tags: ['public_transport'] },
  { words: ['metro', 'मेट्रो'], place: 'Metro', tags: ['metro', 'public_transport'] },
  { words: ['train', 'station', 'local', 'platform', 'स्टेशन'], place: 'Railway station / train', tags: ['public_transport'] },
  { words: ['auto', 'rickshaw', 'cab', 'uber', 'ola', 'taxi', 'driver'], place: 'Auto / cab', tags: ['auto_cab', 'public_transport'] },
  { words: ['market', 'bazaar', 'bazar', 'mall', 'shop', 'बाज़ार', 'बाजार'], place: 'Market', tags: ['market'] },
  { words: ['college', 'campus', 'hostel', 'university', 'class', 'कॉलेज'], place: 'College campus', tags: ['campus'] },
  { words: ['office', 'workplace', 'manager', 'colleague', 'boss', 'team lead', 'ऑफिस', 'दफ्तर'], place: 'Workplace', tags: ['workplace'] },
  { words: ['park', 'garden', 'पार्क'], place: 'Park', tags: [] },
  { words: ['lane', 'gali ', 'street', 'road', 'sadak', 'सड़क', 'गली'], place: 'Street / lane', tags: [] },
  { words: ['concert', 'festival', 'mela', 'garba', 'pandal', 'crowd', 'bheed', 'भीड़', 'मेला'], place: 'Crowded event', tags: ['crowd', 'event'] },
];

const TIME_LEXICON: Array<{ words: string[]; hint: string; dayOffset: number; hour: number | null; tags: string[] }> = [
  { words: ['last night', 'kal raat', 'कल रात'], hint: 'Last night', dayOffset: -1, hour: 21, tags: ['night'] },
  { words: ['yesterday', 'kal ', 'कल'], hint: 'Yesterday', dayOffset: -1, hour: null, tags: [] },
  { words: ['this morning', 'aaj subah', 'subah', 'सुबह'], hint: 'Morning', dayOffset: 0, hour: 9, tags: [] },
  { words: ['evening', 'shaam', 'sham ', 'शाम'], hint: 'Evening', dayOffset: 0, hour: 18, tags: [] },
  { words: ['tonight', 'night', 'raat', 'रात'], hint: 'Night', dayOffset: 0, hour: 21, tags: ['night'] },
  { words: ['afternoon', 'dopahar', 'dopehar', 'दोपहर'], hint: 'Afternoon', dayOffset: 0, hour: 14, tags: [] },
  { words: ['today', 'aaj', 'आज'], hint: 'Today', dayOffset: 0, hour: null, tags: [] },
];

const HINDI_ROMAN_MARKERS = ['hai', 'tha', 'thi', 'mujhe', 'mera', 'meri', 'kya', 'nahi', 'raha', 'rahi', 'wala', 'kar', 'ko', 'se', 'ne', 'aur', 'bahut', 'ek'];

function includesWord(text: string, w: string): boolean {
  if (/^[a-z ]+$/.test(w.trim()) && !w.includes(' ')) {
    return new RegExp(`\\b${w}(?:s|es|ed|d|ing|er|ers)?\\b`, 'i').test(text);
  }
  return text.includes(w);
}

export function detectLanguage(text: string): 'en' | 'hi' | 'hinglish' {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  const words = text.toLowerCase().split(/[^a-z]+/);
  const hits = words.filter((w) => HINDI_ROMAN_MARKERS.includes(w)).length;
  return hits >= 2 ? 'hinglish' : 'en';
}

/** Rule-based structuring that works fully offline for English, Hindi and Hinglish. */
export function structureIncidentOffline(raw: string, now: Date = new Date()): StructuredIncident {
  const { text: scrubbed } = scrubPII(raw);
  const t = scrubbed.toLowerCase();
  let type: IncidentType = 'other';
  let sev = 2;
  let matches = 0;
  for (const entry of TYPE_LEXICON) {
    if (entry.words.some((w) => includesWord(t, w))) {
      if (type === 'other' || entry.sev > sev) {
        type = entry.type;
        sev = entry.sev;
      }
      matches++;
    }
  }
  const tags = new Set<string>();
  if (SEVERITY_BOOST.some((w) => includesWord(t, w))) sev = Math.min(5, sev + 1);
  if (GROUP_WORDS.some((w) => includesWord(t, w))) tags.add('group_of_men');
  let frequency: Frequency = 'once';
  if (REPEAT_WORDS.some((w) => includesWord(t, w))) { frequency = 'repeated'; tags.add('repeat_offender'); }
  if (ONGOING_WORDS.some((w) => includesWord(t, w))) frequency = 'ongoing';
  if (/dark|andhera|अंधेरा|no light|street ?light/.test(t)) tags.add('poorly_lit');
  if (/sunsaan|empty|deserted|isolated|सुनसान/.test(t)) tags.add('isolated');

  let placeHint: string | null = null;
  for (const p of PLACE_LEXICON) {
    if (p.words.some((w) => includesWord(t, w))) {
      placeHint ??= p.place;
      p.tags.forEach((x) => tags.add(x));
    }
  }
  if (type === 'online') tags.add('online');

  let timeHint: string | null = null;
  let occurredAt: Date | null = null;
  for (const tl of TIME_LEXICON) {
    if (tl.words.some((w) => includesWord(t, w))) {
      timeHint = tl.hint;
      occurredAt = new Date(now.getTime() + tl.dayOffset * 86_400_000);
      if (tl.hour !== null) occurredAt.setHours(tl.hour, 0, 0, 0);
      tl.tags.forEach((x) => tags.add(x));
      break;
    }
  }
  const clock = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)\b/);
  if (clock) {
    let h = parseInt(clock[1], 10) % 12;
    if (clock[3] === 'pm' || ((clock[3] === 'baje' || clock[3] === 'बजे') && (h <= 6 || /raat|shaam|रात|शाम/.test(t)))) h += 12;
    if (clock[3] === 'am' && h === 12) h = 0;
    occurredAt ??= new Date(now);
    occurredAt.setHours(h, clock[2] ? parseInt(clock[2], 10) : 0, 0, 0);
    timeHint = `${timeHint ? timeHint + ', ' : ''}around ${clock[0]}`;
    if (h >= 20 || h < 5) tags.add('night');
  }
  if (occurredAt && occurredAt.getTime() > now.getTime()) occurredAt = new Date(occurredAt.getTime() - 86_400_000);

  const summary = scrubbed.length > 280 ? scrubbed.slice(0, 277) + '...' : scrubbed;
  return {
    type,
    severity: sev,
    frequency,
    tags: [...tags],
    timeHint,
    occurredAtSuggestion: occurredAt ? occurredAt.toISOString() : null,
    placeHint,
    summary,
    language: detectLanguage(raw),
    confidence: Math.min(0.95, 0.35 + matches * 0.2 + (placeHint ? 0.1 : 0) + (timeHint ? 0.1 : 0)),
    source: 'offline',
  };
}

export interface DraftInput {
  authority: AuthorityId;
  type: string;
  severity: number;
  frequency: string;
  occurredAt?: string | null;
  location?: string | null;
  description: string;
  tags?: string[];
  institution?: string | null; // college / company / transport operator
  vehicleOrRoute?: string | null;
  accusedDescription?: string | null;
  witnesses?: string | null;
  evidence?: string[];
  complainantName?: string | null;
  complainantContact?: string | null;
  language?: 'en' | 'hi';
}

export interface Draft {
  authority: AuthorityId;
  to: string;
  subject: string;
  body: string;
  tips: string[];
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '[date and time of incident]';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

const LEGAL_REFS: Record<string, string> = {
  physical: 'Sections 74/75 of the Bharatiya Nyaya Sanhita, 2023 (assault / sexual harassment)',
  assault: 'Section 74 and other applicable sections of the Bharatiya Nyaya Sanhita, 2023',
  stalking: 'Section 78 of the Bharatiya Nyaya Sanhita, 2023 (stalking)',
  verbal: 'Section 79 of the Bharatiya Nyaya Sanhita, 2023 (words/gestures insulting the modesty of a woman)',
  staring: 'Section 79 of the Bharatiya Nyaya Sanhita, 2023',
  indecent_exposure: 'Sections 75/79 of the Bharatiya Nyaya Sanhita, 2023',
  photography: 'Section 77 of the Bharatiya Nyaya Sanhita, 2023 (voyeurism) and Section 66E of the IT Act, 2000',
  online: 'Sections 75/78 of the Bharatiya Nyaya Sanhita, 2023 and Sections 66E/67 of the IT Act, 2000',
  other: 'applicable provisions of the Bharatiya Nyaya Sanhita, 2023',
};

/** Fill an authority-specific complaint draft. All output is editable by the user. */
export function generateDraft(input: DraftInput): Draft {
  const typeLabel = INCIDENT_TYPES.find((t) => t.id === input.type)?.label ?? input.type;
  const when = fmtDate(input.occurredAt);
  const where = input.location || '[location / landmark]';
  const name = input.complainantName || '[Your name]';
  const contact = input.complainantContact || '[Your phone / email]';
  const desc = input.description?.trim() || '[Describe what happened]';
  const sevLabel = SEVERITY_LABELS[input.severity] ?? '';
  const freqLine = input.frequency === 'once' ? 'This was a single incident.' : input.frequency === 'repeated' ? 'This has happened repeatedly.' : 'This harassment is ongoing.';
  const accused = input.accusedDescription ? `Description of the person(s) involved: ${input.accusedDescription}.` : 'Description of the person(s) involved: [appearance, clothing, vehicle, name if known].';
  const witnesses = input.witnesses ? `Witnesses: ${input.witnesses}.` : 'Witnesses: [names/contacts if any, else "None known"].';
  const evidenceLine = input.evidence?.length
    ? `I am attaching the following evidence (SHA-256 integrity certificates available on request):\n${input.evidence.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`
    : 'Evidence available: [photos / screenshots / recordings / CCTV location].';
  const legal = LEGAL_REFS[input.type] ?? LEGAL_REFS.other;
  const sign = `\nYours sincerely,\n${name}\nContact: ${contact}\nDate: ${fmtDate(new Date().toISOString()).split(',')[0]}`;
  const facts = `Nature of incident: ${typeLabel} (${sevLabel}).\nDate & time: ${when}\nPlace: ${where}\n\nWhat happened:\n${desc}\n\n${freqLine}\n${accused}\n${witnesses}\n\n${evidenceLine}`;

  let to = '';
  let subject = '';
  let body = '';
  let tips: string[] = [];

  switch (input.authority) {
    case 'police':
      to = 'The Station House Officer (SHO),\n[Police Station name], [City]';
      subject = `Complaint regarding ${typeLabel.toLowerCase()} at ${where}`;
      body = `Respected Sir/Madam,\n\nI, ${name}, wish to report the following incident and request that an FIR be registered and necessary action be taken.\n\n${facts}\n\nThe above acts may attract ${legal}. I request you to kindly register my complaint, investigate the matter, and take appropriate action. I also request a copy of the FIR / complaint acknowledgement.\n${sign}`;
      tips = [
        'You can file at any police station; a "Zero FIR" can be registered regardless of jurisdiction.',
        'You are entitled to a free copy of the FIR.',
        `Emergency: ${HELPLINES.emergency}. Women helpline: ${HELPLINES.women}.`,
        'Legal section references are indicative. Confirm with the police or a lawyer.',
      ];
      break;
    case 'college':
      to = `The Chairperson,\nInternal Complaints Committee / Anti-Sexual Harassment Cell,\n${input.institution || '[College / University name]'}`;
      subject = `Complaint of ${typeLabel.toLowerCase()} on/near campus`;
      body = `Respected Madam/Sir,\n\nI am a student of ${input.institution || '[College]'} ([course, year, roll no.]). I am writing to formally report an incident of ${typeLabel.toLowerCase()} and request the Committee to take action as per the UGC (Prevention, Prohibition and Redressal of Sexual Harassment of Women Employees and Students in Higher Educational Institutions) Regulations, 2015.\n\n${facts}\n\nI request that my identity be kept confidential, that interim measures be considered for my safety, and that the matter be inquired into at the earliest.\n${sign}`;
      tips = ['Complaints should ideally be filed within 3 months of the incident.', 'You may request interim relief (change of class/hostel, restraint on the respondent).'];
      break;
    case 'workplace':
      to = `The Presiding Officer,\nInternal Committee (IC),\n${input.institution || '[Company name]'}`;
      subject = `Complaint of sexual harassment at the workplace under the POSH Act, 2013`;
      body = `Dear Presiding Officer,\n\nI, ${name}, [designation, team], am submitting this written complaint under Section 9 of the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.\n\n${facts}\n\nI request the Internal Committee to inquire into this complaint, maintain confidentiality as required under Section 16 of the Act, and consider interim relief under Section 12 (e.g. transfer or leave) during the inquiry.\n${sign}`;
      tips = ['File within 3 months of the last incident (extendable by 3 more months).', 'If your organisation has no IC, approach the Local Committee of your district.', 'Keep copies of all emails, chats and messages.'];
      break;
    case 'transport':
      to = `The Grievance / Vigilance Officer,\n${input.institution || '[Transport operator: e.g. city bus corporation / metro rail / cab company]'}`;
      subject = `Complaint of ${typeLabel.toLowerCase()} during travel${input.vehicleOrRoute ? ` (${input.vehicleOrRoute})` : ''}`;
      body = `Respected Sir/Madam,\n\nI wish to report an incident of ${typeLabel.toLowerCase()} that occurred while travelling.\n\nVehicle / route / trip details: ${input.vehicleOrRoute || '[bus no. / route / metro line & coach / cab trip ID & driver name]'}\n${facts}\n\nI request you to identify the person(s) involved, preserve CCTV / trip records from the above time, take strict action, and inform me of the outcome. If the person involved is your staff/driver, I request disciplinary action as per your policy.\n${sign}`;
      tips = ['Ask the operator to preserve CCTV footage immediately: it is often overwritten within days.', 'Cab apps have an in-app safety/report option; attach this letter there too.', `For immediate danger call ${HELPLINES.emergency}.`];
      break;
    case 'cybercrime':
      to = 'The Officer-in-charge,\nCyber Crime Cell, [City]\n(or file online at https://cybercrime.gov.in, "Report Women/Child related crime")';
      subject = `Complaint regarding online harassment of a woman`;
      body = `Respected Sir/Madam,\n\nI, ${name}, wish to report online harassment.\n\nPlatform(s) / account(s) involved: [platform, profile URL / username of the offender: keep these in your private copy]\n${facts}\n\nThe above acts may attract ${LEGAL_REFS.online}. I request you to register my complaint, direct the platform(s) to preserve and remove the offending content, and take action against the offender.\n${sign}`;
      tips = [
        `National cybercrime helpline: ${HELPLINES.cyber}. Portal: cybercrime.gov.in.`,
        'Take screenshots showing URL, username, date & time before blocking the account.',
        'Note: Raksha removes usernames/URLs from anonymous reports. Add them back only in your private copy of this draft.',
      ];
      break;
  }
  const authLabel = AUTHORITIES.find((a) => a.id === input.authority)?.label ?? input.authority;
  return { authority: input.authority, to, subject, body: `To,\n${to}\n\nSubject: ${subject}\n\n${body}`, tips: [`Draft for: ${authLabel}. Review and edit before sending.`, ...tips] };
}
