import { Link, useNavigate, useParams } from 'react-router-dom';
import { INCIDENT_TYPES, SEVERITY_LABELS } from '@raksha/shared';
import { MapContainer, Rectangle, TileLayer } from 'react-leaflet';
import { post } from '../api';
import { ErrorBox, LevelBadge, Loading, TILE_ATTR, TILE_URL } from '../components';
import { useAction, useApi } from '../state';
import { fmtTime, pretty } from '../util';
import { AreaDetail } from './SafetyMap';

export const typeLabel = (id: string) => INCIDENT_TYPES.find((t) => t.id === id)?.label ?? pretty(id);

export default function MyReports() {
  const { id } = useParams();
  return id ? <ReportDetail id={id} /> : <ReportList />;
}

function ReportList() {
  const { data, error, reload, loading } = useApi<{ reports: any[] }>('/reports/mine');
  return (
    <div>
      <div className="row between">
        <h1>🗂️ My reports</h1>
        <Link className="btn small" to="/report">
          + New
        </Link>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>
        Reports made from this device. Nobody else can see this list.
      </p>
      <ErrorBox error={error} onRetry={reload} />
      {loading && <Loading />}
      {data && !data.reports.length && <div className="empty">You have not filed any reports from this device yet.</div>}
      {data?.reports.map((r) => (
        <Link key={r.id} to={`/reports/${r.id}`} className="card tight" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="row between nowrap">
            <b className="grow">{typeLabel(r.type)}</b>
            {r.status === 'retracted' ? <span className="badge b-muted">Retracted</span> : <span className="badge b-ok">Active</span>}
          </div>
          <small>
            {fmtTime(r.occurredAt)} · Severity {r.severity} · {pretty(r.frequency)}
          </small>
        </Link>
      ))}
    </div>
  );
}

function ReportDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const { busy, run } = useAction();
  const { data, error, reload } = useApi<{ report: any; area: any }>(`/reports/${id}`);
  const r = data?.report;
  const retract = () =>
    run(async () => {
      if (!confirm('Retract this report? It will no longer count towards area risk. This cannot be undone.')) return;
      await post(`/reports/${id}/retract`);
      await reload();
    }, 'Report retracted');

  return (
    <div>
      <button className="link" onClick={() => nav('/reports')}>
        ‹ My reports
      </button>
      <ErrorBox error={error} onRetry={reload} />
      {!r && !error && <Loading />}
      {r && (
        <>
          <div className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>{typeLabel(r.type)}</h2>
              {r.status === 'retracted' ? <span className="badge b-muted">Retracted</span> : <span className="badge b-ok">Active</span>}
            </div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>When</dt>
              <dd>{fmtTime(r.occurredAt)}</dd>
              <dt>Severity</dt>
              <dd>
                {r.severity} – {SEVERITY_LABELS[r.severity]}
              </dd>
              <dt>Frequency</dt>
              <dd>{pretty(r.frequency)}</dd>
              <dt>Tags</dt>
              <dd>{r.tags.length ? r.tags.map(pretty).join(', ') : '—'}</dd>
              <dt>Area</dt>
              <dd>
                ~150 m cell <span className="mono">{r.cellId}</span>
              </dd>
            </dl>
            {r.description && (
              <>
                <div className="hr" />
                <small className="muted">Stored description (personal details removed)</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
              </>
            )}
            <div className="map short" style={{ marginTop: 10 }}>
              <MapContainer center={[r.lat, r.lng]} zoom={16} style={{ height: '100%' }}>
                <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
                <Rectangle bounds={[[r.lat - 0.0007, r.lng - 0.0007], [r.lat + 0.0007, r.lng + 0.0007]]} pathOptions={{ color: '#6d28d9' }} />
              </MapContainer>
            </div>
            {r.status !== 'retracted' && (
              <button className="danger block" style={{ marginTop: 12 }} disabled={busy} onClick={retract}>
                Retract report
              </button>
            )}
          </div>
          {data.area ? (
            <div className="card">
              <div className="row between">
                <h3 style={{ margin: 0 }}>This area right now</h3>
                <LevelBadge level={data.area.level} />
              </div>
              <AreaDetail area={data.area} />
            </div>
          ) : (
            <div className="card alert-info">This area is not shown on the public map yet — fewer than 3 independent people have reported here.</div>
          )}
        </>
      )}
    </div>
  );
}
