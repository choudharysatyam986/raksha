import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { ErrorBox, Loading } from '../components';
import { useApi, useApp } from '../state';
import { ago } from '../util';

export default function Alerts() {
  const { refreshMe } = useApp();
  const { data, error, reload, loading } = useApi<{ alerts: any[]; unread: number }>('/alerts?limit=100', 5000);

  useEffect(() => {
    if (data?.unread) post('/alerts/read', {}).then(refreshMe).catch(() => undefined);
  }, [data?.unread, refreshMe]);

  return (
    <div>
      <h1>🔔 Alerts</h1>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Loading />}
      {data && !data.alerts.length && <div className="empty">No alerts yet.</div>}
      <div className="card">
        <ul className="list">
          {data?.alerts.map((a) => {
            const url: string | undefined = a.data?.url;
            const body = (
              <>
                <div className="row between nowrap">
                  <b className="grow">
                    {!a.read && <span className="badge b-danger" style={{ marginRight: 6 }}>new</span>}
                    {a.title}
                  </b>
                  <small>{ago(a.createdAt)}</small>
                </div>
                {a.body && <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>{a.body}</p>}
              </>
            );
            return (
              <li key={a.id}>
                {url ? (
                  <Link to={url} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
