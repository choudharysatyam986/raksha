import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AUTHORITIES, FREQUENCIES, INCIDENT_TYPES, REPORT_TAGS, SEVERITY_LABELS, scrubPII } from '@raksha/shared';
import { api, post } from '../api';
import { Chips, LocationPicker, Radio, Section } from '../components';
import { useAction, useApi, useApp } from '../state';
import { copyText, pretty, shareOrCopy } from '../util';

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Report() {
  const { toast } = useApp();
  const [params] = useSearchParams();
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [type, setType] = useState<string>('verbal');
  const [severity, setSeverity] = useState(2);
  const [frequency, setFrequency] = useState<string>('once');
  const [tags, setTags] = useState<string[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [when, setWhen] = useState(toLocalInput(new Date()));
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [eventId, setEventId] = useState<string>(params.get('event') ?? '');
  const [subzoneId, setSubzoneId] = useState<string>('');
  const [ai, setAi] = useState<any>(null);
  const [aiMode, setAiMode] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const events = useApi<{ events: any[] }>('/events');
  const eventDetail = useApi<{ event: any }>(eventId ? `/events/${eventId}` : null);

  const preview = useMemo(() => scrubPII(text), [text]);

  useEffect(() => {
    const ev = eventDetail.data?.event;
    if (ev && !where) setWhere({ lat: ev.centerLat, lng: ev.centerLng });
  }, [eventDetail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const structure = () =>
    run(async () => {
      const r = await post<{ suggestion: any; mode: string }>('/ai/structure', { text });
      const s = r.suggestion;
      setAi(s);
      setAiMode(r.mode);
      setType(s.type);
      setSeverity(s.severity);
      setFrequency(s.frequency);
      setTags((t) => Array.from(new Set([...t, ...s.tags.filter((x: string) => (REPORT_TAGS as readonly string[]).includes(x))])));
      setSuggestedTags(s.tags);
      if (s.occurredAtSuggestion) setWhen(toLocalInput(new Date(s.occurredAtSuggestion)));
      toast('Suggestions applied — review and edit anything before submitting.', 'ok');
    });

  const submit = () =>
    run(async () => {
      if (!where) throw new Error('Please mark the approximate location on the map.');
      const occurred = new Date(when);
      if (isNaN(occurred.getTime())) throw new Error('Please enter when it happened.');
      if (occurred.getTime() > Date.now() + 60_000) throw new Error('The incident time cannot be in the future.');
      const r = await api('/reports', {
        method: 'POST',
        body: { type, severity, frequency, tags, occurredAt: occurred.toISOString(), lat: where.lat, lng: where.lng, description: text, eventId: eventId || null, subzoneId: subzoneId || null },
      });
      setResult(r);
      window.scrollTo(0, 0);
    });

  if (result) {
    return (
      <div>
        <div className="card alert-ok">
          <h2>✅ Report submitted anonymously</h2>
          <p>Thank you. Your report helps make this area safer for others.</p>
          {result.redactions?.length > 0 && <p>🛡️ We removed personal details before storing: {result.redactions.map(pretty).join(', ')}.</p>}
          <p>
            📍 Location stored only as an approximate ~150 m area.{' '}
            {result.area?.visible ? (
              <>
                This area is now shown as <b>{pretty(result.area.level)}</b> risk on the map.
              </>
            ) : (
              <>It will appear on the map once enough independent people report there (privacy threshold).</>
            )}
          </p>
          {result.eventAlerts?.length > 0 && <p>📣 Event attendees were alerted ({result.eventAlerts.join(', ')}).</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <Link className="btn small" to={`/reports/${result.report.id}`}>
              View report
            </Link>
            <Link className="btn small secondary" to="/map">
              See safety map
            </Link>
            <button
              className="small ghost"
              onClick={() => {
                setResult(null);
                setText('');
                setAi(null);
                setTags([]);
              }}
            >
              New report
            </button>
          </div>
        </div>
        <DraftPanel base={{ type, severity, frequency, tags, occurredAt: new Date(when).toISOString(), description: text, where }} />
      </div>
    );
  }

  const myEvents = events.data?.events ?? [];

  return (
    <div>
      <h1>📝 Report harassment</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Anonymous — no account, name or phone needed. You can report as a victim or a bystander.
      </p>

      <Section title="1. What happened?">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe in English, Hindi or Hinglish. e.g. “Kal raat 9 baje Majestic bus stop pe ek aadmi roz peecha karta hai”"
          maxLength={4000}
        />
        <div className="row between" style={{ marginTop: 6 }}>
          <small>{text.length}/4000</small>
          <button className="small" disabled={busy || text.trim().length < 3} onClick={structure}>
            ✨ AI: fill the form for me
          </button>
        </div>
        {ai && (
          <div className="card alert-info tight" style={{ marginTop: 8, marginBottom: 0 }}>
            <small>
              <b>AI suggestion</b> ({aiMode === 'llm' ? 'language model' : 'offline rules'}, {Math.round(ai.confidence * 100)}% confident, language: {ai.language})
            </small>
            <p style={{ margin: '4px 0' }}>{ai.summary}</p>
            {ai.timeHint && <small>Time mentioned: “{ai.timeHint}”. </small>}
            {ai.placeHint && <small>Place mentioned: “{ai.placeHint}” — mark it on the map below.</small>}
          </div>
        )}
        {preview.redactions.length > 0 && (
          <p style={{ fontSize: '0.85rem' }}>
            🛡️ Personal details detected and will be removed when stored: <b>{preview.redactions.map(pretty).join(', ')}</b>.
          </p>
        )}
      </Section>

      <Section title="2. Details">
        <label>Type of incident</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {INCIDENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.hi}
            </option>
          ))}
        </select>
        <label>How serious? — {SEVERITY_LABELS[severity]}</label>
        <Radio options={[1, 2, 3, 4, 5] as const} value={severity as 1} onChange={(v) => setSeverity(v)} labels={(v) => `${v}`} />
        <label>How often?</label>
        <Radio options={FREQUENCIES} value={frequency as any} onChange={setFrequency} labels={(f) => ({ once: 'Once', repeated: 'Happened before', ongoing: 'Ongoing / daily' } as Record<string, string>)[f] ?? f} />
        <label>Tags</label>
        <Chips options={REPORT_TAGS} value={tags as any} onChange={setTags} suggested={suggestedTags as any} />
        <label>When did it happen?</label>
        <input type="datetime-local" value={when} max={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
      </Section>

      <Section title="3. Where? (approximate)">
        {myEvents.length > 0 && (
          <>
            <label>At an event? (alerts other attendees)</label>
            <select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setSubzoneId('');
              }}
            >
              <option value="">Not at an event</option>
              {myEvents.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            {eventId && eventDetail.data?.event?.subzones?.length > 0 && (
              <>
                <label>Zone</label>
                <select value={subzoneId} onChange={(e) => setSubzoneId(e.target.value)}>
                  <option value="">Detect from map location</option>
                  {eventDetail.data!.event.subzones.map((z: any) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}
        <div style={{ marginTop: 8 }}>
          <LocationPicker value={where} onChange={setWhere} />
        </div>
      </Section>

      <button className="block" disabled={busy} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit anonymous report'}
      </button>
      <p className="center">
        <small>
          In danger right now? <Link to="/sos">Use SOS</Link> or call <a href="tel:112">112</a>.
        </small>
      </p>

      <DraftPanel base={{ type, severity, frequency, tags, occurredAt: when ? new Date(when).toISOString() : null, description: text, where }} />
    </div>
  );
}

/** Generates an editable complaint letter for a chosen authority. Drafts are never stored on the server. */
function DraftPanel({ base }: { base: { type: string; severity: number; frequency: string; tags: string[]; occurredAt: string | null; description: string; where: { lat: number; lng: number } | null } }) {
  const { toast } = useApp();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [authority, setAuthority] = useState<string>('police');
  const [extra, setExtra] = useState({ location: '', institution: '', vehicleOrRoute: '', accusedDescription: '', witnesses: '', evidence: '', complainantName: '', complainantContact: '' });
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string; tips: string[] } | null>(null);
  const [body, setBody] = useState('');
  const set = (k: keyof typeof extra) => (e: any) => setExtra({ ...extra, [k]: e.target.value });

  const generate = () =>
    run(async () => {
      if (base.description.trim().length < 3) throw new Error('Write what happened first (step 1).');
      const r = await post<{ draft: any }>('/ai/draft', {
        authority,
        type: base.type,
        severity: base.severity,
        frequency: base.frequency,
        tags: base.tags,
        occurredAt: base.occurredAt,
        description: base.description,
        location: extra.location || (base.where ? `Near ${base.where.lat.toFixed(4)}, ${base.where.lng.toFixed(4)}` : null),
        institution: extra.institution || null,
        vehicleOrRoute: extra.vehicleOrRoute || null,
        accusedDescription: extra.accusedDescription || null,
        witnesses: extra.witnesses || null,
        evidence: extra.evidence ? extra.evidence.split(',').map((s) => s.trim()).filter(Boolean) : [],
        complainantName: extra.complainantName || null,
        complainantContact: extra.complainantContact || null,
      });
      setDraft(r.draft);
      setBody(`Subject: ${r.draft.subject}\n\n${r.draft.body}`);
    });

  const download = () => {
    const blob = new Blob([`To: ${draft?.to}\n${body}`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `complaint-${authority}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!open) {
    return (
      <div className="card">
        <div className="row between">
          <div className="grow">
            <b>📄 Need to file a formal complaint?</b>
            <br />
            <small>Generate an editable draft for police, college ICC, workplace POSH committee, transport or cybercrime.</small>
          </div>
          <button className="small secondary" onClick={() => setOpen(true)}>
            Create draft
          </button>
        </div>
      </div>
    );
  }

  return (
    <Section title="📄 Complaint draft generator" right={<button className="small ghost" onClick={() => setOpen(false)}>Close</button>}>
      <p style={{ fontSize: '0.85rem' }} className="muted">
        The draft is created for you only and is <b>not saved</b>. You may add your name and contact here – they are not stored in the anonymous report.
      </p>
      <label>Send to</label>
      <select value={authority} onChange={(e) => setAuthority(e.target.value)}>
        {AUTHORITIES.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <label>Place / address (optional)</label>
      <input type="text" value={extra.location} onChange={set('location')} placeholder="e.g. Majestic bus stand, platform 4" />
      {(authority === 'college' || authority === 'workplace') && (
        <>
          <label>{authority === 'college' ? 'College / university' : 'Organisation'}</label>
          <input type="text" value={extra.institution} onChange={set('institution')} />
        </>
      )}
      {authority === 'transport' && (
        <>
          <label>Vehicle number / route</label>
          <input type="text" value={extra.vehicleOrRoute} onChange={set('vehicleOrRoute')} placeholder="e.g. BMTC 500D, KA-01-F-1234" />
        </>
      )}
      <label>Description of the person (optional)</label>
      <input type="text" value={extra.accusedDescription} onChange={set('accusedDescription')} placeholder="Appearance, clothing, name if known" />
      <label>Witnesses (optional)</label>
      <input type="text" value={extra.witnesses} onChange={set('witnesses')} />
      <label>Evidence you have (comma separated)</label>
      <input type="text" value={extra.evidence} onChange={set('evidence')} placeholder="screenshots, photo, CCTV location" />
      <div className="grid2">
        <div>
          <label>Your name (optional)</label>
          <input type="text" value={extra.complainantName} onChange={set('complainantName')} />
        </div>
        <div>
          <label>Your contact (optional)</label>
          <input type="text" value={extra.complainantContact} onChange={set('complainantContact')} />
        </div>
      </div>
      <button className="block" style={{ marginTop: 12 }} disabled={busy} onClick={generate}>
        {busy ? 'Generating…' : draft ? 'Regenerate draft' : 'Generate draft'}
      </button>
      {draft && (
        <div style={{ marginTop: 12 }}>
          <small>
            <b>To:</b> {draft.to}
          </small>
          <textarea style={{ minHeight: 320, marginTop: 6 }} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="small" onClick={async () => toast((await copyText(body)) ? 'Draft copied' : 'Copy failed', 'ok')}>
              Copy
            </button>
            <button className="small secondary" onClick={() => shareOrCopy(draft.subject, body)}>
              Share
            </button>
            <a className="btn small secondary" href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body.replace(/^Subject:.*\n\n/, ''))}`}>
              Email
            </a>
            <button className="small ghost" onClick={download}>
              Download .txt
            </button>
          </div>
          {draft.tips?.length > 0 && (
            <div className="card alert-info tight" style={{ marginTop: 10 }}>
              <b>Tips</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '0.88rem' }}>
                {draft.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
