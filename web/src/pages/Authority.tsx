import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import { api } from '../api';
import { DEFAULT_CENTER, LevelBadge, TILE_ATTR, TILE_URL } from '../components';
import { fmtTime, LEVEL_COLORS, pretty } from '../util';
import { typeLabel } from './MyReports';

const KEY = 'raksha.authorityKey';
type Tab = 'patterns' | 'escalations' | 'graph' | 'analytics' | 'events';

function useAuthority<T>(path: string, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path, { auth: false, headers: { 'x-authority-key': key } }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path, key]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);
  return { data, error, reload };
}

function Bars({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} className="row nowrap" style={{ gap: 8, margin: '3px 0' }}>
          <small style={{ width: 120, flexShrink: 0 }}>{r.label}</small>
          <div style={{ flex: 1, background: '#eee', borderRadius: 4 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, background: '#6a1b9a', height: 14, borderRadius: 4 }} />
          </div>
          <small style={{ width: 28, textAlign: 'right' }}>{r.count}</small>
        </div>
      ))}
    </div>
  );
}

const toRows = (m: Record<string, number>, label: (k: string) => string = (k) => k) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: label(k), count: n }));

function CellMap({ cells, edges, height = 'tall' }: { cells: any[]; edges?: Array<{ from: string; to: string }>; height?: string }) {
  const byId = new Map(cells.map((c) => [c.cellId ?? c.id, c]));
  const center: [number, number] = cells.length ? [cells[0].lat, cells[0].lng] : DEFAULT_CENTER;
  return (
    <div className={`map ${height}`}>
      <MapContainer center={center} zoom={13} style={{ height: '100%' }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {edges?.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          return a && b ? <Polyline key={i} positions={[[a.lat, a.lng], [b.lat, b.lng]]} pathOptions={{ color: '#6a1b9a', weight: 3, dashArray: '6 6' }} /> : null;
        })}
        {cells.map((c) => (
          <CircleMarker key={c.cellId ?? c.id} center={[c.lat, c.lng]} radius={8 + Math.min(16, (c.score ?? 1) * 2)} pathOptions={{ color: LEVEL_COLORS[c.level], fillColor: LEVEL_COLORS[c.level], fillOpacity: 0.5 }}>
            <Tooltip>
              {c.cellId ?? c.id} · {c.level} · score {Math.round((c.score ?? 0) * 10) / 10}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function Patterns({ k }: { k: string }) {
  const [minLevel, setMinLevel] = useState('low');
  const [pattern, setPattern] = useState('');
  const { data, error } = useAuthority<any>(`/authority/patterns?minLevel=${minLevel}${pattern ? `&pattern=${pattern}` : ''}`, k);
  if (error) return <div className="card alert-danger">{error}</div>;
  if (!data) return <div className="spinner" />;
  return (
    <div>
      <div className="row">
        <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
          {['low', 'moderate', 'high', 'critical'].map((l) => (
            <option key={l} value={l}>
              ≥ {l}
            </option>
          ))}
        </select>
        <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
          <option value="">All patterns</option>
          <option value="recurring">Recurring (same time of day)</option>
          <option value="burst">Active bursts</option>
        </select>
      </div>
      <div className="grid3" style={{ margin: '10px 0' }}>
        <div className="tile">
          <div className="big-num">{data.cells.length}</div>
          <small>Areas</small>
        </div>
        <div className="tile">
          <div className="big-num">{data.summary.recurring}</div>
          <small>Recurring</small>
        </div>
        <div className="tile">
          <div className="big-num">{data.summary.activeBursts}</div>
          <small>Active bursts</small>
        </div>
      </div>
      <CellMap cells={data.cells} />
      <table className="simple">
        <thead>
          <tr>
            <th>Area</th>
            <th>Level</th>
            <th>Reports / devices</th>
            <th>Pattern</th>
          </tr>
        </thead>
        <tbody>
          {data.cells.map((c: any) => (
            <tr key={c.cellId}>
              <td className="mono">{c.cellId}</td>
              <td>
                <LevelBadge level={c.level} />
              </td>
              <td>
                {c.reportCount} / {c.independentDevices}
              </td>
              <td>
                <small>
                  {c.patterns.recurring && `🔁 ${c.patterns.recurring.label} (${c.patterns.recurring.days} days) `}
                  {c.patterns.burst?.active && `⚡ burst ×${c.patterns.burst.count} `}
                  {c.patterns.dominantType && `· mostly ${typeLabel(c.patterns.dominantType)}`}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Escalations({ k }: { k: string }) {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useAuthority<any>(`/authority/escalations${status ? `?status=${status}` : ''}`, k);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const ack = async (id: string, s: string) => {
    try {
      await api(`/authority/escalations/${id}/ack`, { method: 'POST', auth: false, headers: { 'x-authority-key': k }, body: { status: s, note: notes[id] || undefined } });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  if (error) return <div className="card alert-danger">{error}</div>;
  if (!data) return <div className="spinner" />;
  return (
    <div>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="open">Open</option>
        <option value="acknowledged">Acknowledged</option>
        <option value="actioned">Actioned</option>
        <option value="dismissed">Dismissed</option>
        <option value="">All</option>
      </select>
      {!data.escalations.length && <p className="empty">No escalations.</p>}
      {data.escalations.map((e: any) => (
        <div key={e.id} className={`card ${e.status === 'open' ? 'alert-warn' : ''}`}>
          <div className="row between nowrap">
            <b>
              <LevelBadge level={e.level} /> Area {e.cellId}
            </b>
            <span className="badge b-muted">{e.status}</span>
          </div>
          <small className="muted">
            {fmtTime(e.createdAt)} · {e.reportCount} reports from {e.independentDevices} independent devices · now {e.currentLevel ?? '—'}
          </small>
          <p style={{ margin: '6px 0' }}>{e.reason}</p>
          {e.note && <p className="muted">Note: {e.note}</p>}
          {e.lat && (
            <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" className="link">
              Open area on map ↗
            </a>
          )}
          <input type="text" placeholder="Action note (e.g. patrol scheduled 9–11 pm)" value={notes[e.id] ?? ''} onChange={(x) => setNotes({ ...notes, [e.id]: x.target.value })} style={{ marginTop: 6 }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="small" onClick={() => ack(e.id, 'acknowledged')}>
              Acknowledge
            </button>
            <button className="small ok" onClick={() => ack(e.id, 'actioned')}>
              Actioned
            </button>
            <button className="small ghost" onClick={() => ack(e.id, 'dismissed')}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Graph({ k }: { k: string }) {
  const [minLevel, setMinLevel] = useState('moderate');
  const { data, error } = useAuthority<any>(`/authority/zone-graph?minLevel=${minLevel}`, k);
  if (error) return <div className="card alert-danger">{error}</div>;
  if (!data) return <div className="spinner" />;
  return (
    <div>
      <p className="muted">Adjacent elevated areas are linked into hotspot corridors — useful for planning patrol routes, lighting and transport stops.</p>
      <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
        {['low', 'moderate', 'high', 'critical'].map((l) => (
          <option key={l} value={l}>
            ≥ {l}
          </option>
        ))}
      </select>
      <CellMap cells={data.nodes} edges={data.edges} />
      <table className="simple">
        <thead>
          <tr>
            <th>Cluster</th>
            <th>Areas</th>
            <th>Max level</th>
            <th>Total score</th>
          </tr>
        </thead>
        <tbody>
          {data.clusters.map((c: any) => (
            <tr key={c.id}>
              <td>
                <a href={`https://www.google.com/maps?q=${c.centroid.lat},${c.centroid.lng}`} target="_blank" rel="noreferrer">
                  {c.id}
                </a>
              </td>
              <td>{c.size}</td>
              <td>
                <LevelBadge level={c.maxLevel} />
              </td>
              <td>{c.totalScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analytics({ k }: { k: string }) {
  const [days, setDays] = useState(30);
  const { data, error } = useAuthority<any>(`/authority/analytics?days=${days}`, k);
  if (error) return <div className="card alert-danger">{error}</div>;
  if (!data) return <div className="spinner" />;
  return (
    <div>
      <select value={days} onChange={(e) => setDays(+e.target.value)}>
        {[7, 30, 90, 365].map((d) => (
          <option key={d} value={d}>
            Last {d} days
          </option>
        ))}
      </select>
      <div className="grid3" style={{ margin: '10px 0' }}>
        <div className="tile">
          <div className="big-num">{data.totalReports}</div>
          <small>Reports</small>
        </div>
        <div className="tile">
          <div className="big-num">{data.escalations.open}</div>
          <small>Open escalations</small>
        </div>
        <div className="tile">
          <div className="big-num">{data.areas.visible}</div>
          <small>Visible areas ({data.areas.hiddenBelowK} hidden)</small>
        </div>
      </div>
      <div className="card">
        <b>By type</b>
        <Bars rows={toRows(data.byType, typeLabel)} />
      </div>
      <div className="card">
        <b>By time of day</b>
        <Bars rows={data.byTimeOfDay.map((b: any) => ({ label: b.label, count: b.count }))} />
      </div>
      <div className="card">
        <b>By severity</b>
        <Bars rows={toRows(data.bySeverity, (s) => `Severity ${s}`)} />
      </div>
      <div className="card">
        <b>Top tags</b>
        <Bars rows={data.topTags.map((t: any) => ({ label: pretty(t.tag), count: t.count }))} />
      </div>
      <div className="card">
        <b>Per day</b>
        <Bars rows={data.byDay.slice(-14).map((d: any) => ({ label: d.day, count: d.count }))} />
      </div>
      <small className="muted">
        {data.retracted} retracted reports excluded · {data.eventAlerts} event alerts · generated {fmtTime(data.generatedAt)}
      </small>
    </div>
  );
}

function EventsTab({ k }: { k: string }) {
  const { data, error } = useAuthority<any>('/authority/events', k);
  if (error) return <div className="card alert-danger">{error}</div>;
  if (!data) return <div className="spinner" />;
  if (!data.events.length) return <p className="empty">No events.</p>;
  return (
    <div>
      {data.events.map((e: any) => (
        <div key={e.id} className={`card ${e.needHelp ? 'alert-danger' : ''}`}>
          <div className="row between nowrap">
            <b>{e.name}</b>
            {e.needHelp > 0 && <span className="badge b-danger">{e.needHelp} need help</span>}
          </div>
          <small className="muted">
            {fmtTime(e.startsAt)} – {fmtTime(e.endsAt)}
          </small>
          <table className="simple">
            <tbody>
              {e.subzones.map((z: any) => {
                const lvl = e.alerts.find((a: any) => a.subzone_id === z.id)?.level;
                return (
                  <tr key={z.id}>
                    <td>{z.name}</td>
                    <td>{z.reportCount} reports</td>
                    <td>{lvl ? <span className={`badge ${lvl === 'warning' ? 'b-danger' : 'b-warn'}`}>{lvl}</span> : <span className="badge b-ok">ok</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function Authority() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY) ?? '');
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<Tab>('patterns');
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const login = async () => {
    setChecking(true);
    setErr(null);
    try {
      await api('/authority/analytics?days=1', { auth: false, headers: { 'x-authority-key': input.trim() } });
      localStorage.setItem(KEY, input.trim());
      setKey(input.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const header = (
    <div className="topbar">
      <b>🛡️ Raksha · Authority dashboard</b>
      {key ? (
        <button className="small ghost" onClick={() => { localStorage.removeItem(KEY); setKey(''); }}>
          Sign out
        </button>
      ) : (
        <Link to="/" className="link" style={{ color: 'inherit' }}>
          App
        </Link>
      )}
    </div>
  );

  if (!key)
    return (
      <div className="app">
        {header}
        <main style={{ padding: 16 }}>
          <div className="card">
            <h2>Authority access</h2>
            <p className="muted">For police, campus and municipal safety teams. Shows only aggregated, k-anonymous areas — never individual reports, descriptions or devices.</p>
            <label>Authority API key</label>
            <input type="password" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
            {err && <p className="card alert-danger tight">{err}</p>}
            <button className="block" style={{ marginTop: 10 }} disabled={checking || !input} onClick={login}>
              Open dashboard
            </button>
            <small className="muted">The key is printed when the server starts and stored in server/data/authority.key (or set AUTHORITY_API_KEY).</small>
          </div>
        </main>
      </div>
    );

  const tabs: Array<[Tab, string]> = [
    ['patterns', 'Patterns'],
    ['escalations', 'Escalations'],
    ['graph', 'Zone graph'],
    ['analytics', 'Analytics'],
    ['events', 'Events'],
  ];
  return (
    <div className="app" style={{ maxWidth: 1000 }}>
      {header}
      <main style={{ padding: 12 }}>
        <div className="tabs">
          {tabs.map(([t, l]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'patterns' && <Patterns k={key} />}
        {tab === 'escalations' && <Escalations k={key} />}
        {tab === 'graph' && <Graph k={key} />}
        {tab === 'analytics' && <Analytics k={key} />}
        {tab === 'events' && <EventsTab k={key} />}
      </main>
    </div>
  );
}
