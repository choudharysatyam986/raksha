import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { ErrorBox, Loading, Section } from '../components';
import { useAction, useApi, useApp, useNow } from '../state';
import { ago, countdown, shareOrCopy, STATE_LABELS } from '../util';

export default function Circles() {
  const { me, refreshMe, toast } = useApp();
  const [params] = useSearchParams();
  const { busy, run } = useAction();
  const now = useNow(5000);
  const circles = useApi<{ circles: any[] }>('/circles', 5000);
  const nudges = useApi<{ nudges: any[] }>('/nudges', 5000);
  const [name, setName] = useState('');
  const [code, setCode] = useState(params.get('join') ?? '');
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const dn = displayName || me?.displayName || '';

  const create = () =>
    run(async () => {
      if (!dn) throw new Error('Enter the name your circle will see.');
      await post('/circles', { name: name || 'My Safe Circle', displayName: dn });
      setName('');
      await Promise.all([circles.reload(), refreshMe()]);
    }, 'Circle created — share the invite code with friends');

  const join = () =>
    run(async () => {
      if (!dn) throw new Error('Enter the name your circle will see.');
      await post('/circles/join', { inviteCode: code.trim().toUpperCase(), displayName: dn });
      setCode('');
      await circles.reload();
    }, 'Joined circle');

  const nudge = (circleId: string, m: any) =>
    run(async () => {
      await post(`/circles/${circleId}/nudge`, { memberId: m.memberId });
      await nudges.reload();
    }, `Asked ${m.displayName} “Are you okay?”`);

  const respond = (id: string, response: 'ok' | 'need_help') =>
    run(async () => {
      await post(`/nudges/${id}/respond`, { response });
      await Promise.all([nudges.reload(), refreshMe()]);
    }, response === 'ok' ? 'Replied: I’m okay 💚' : 'Your circle has been told you need help and can see your location');

  const leave = (c: any) =>
    run(async () => {
      if (!confirm(`Leave “${c.name}”?`)) return;
      await post(`/circles/${c.id}/leave`);
      await circles.reload();
    });

  const invite = async (c: any) => {
    const url = `${location.origin}/circles?join=${c.inviteCode}`;
    const r = await shareOrCopy('Join my Raksha Safe Circle', `Join my Safe Circle “${c.name}” on Raksha. Invite code: ${c.inviteCode}`, url);
    if (r === 'copied') toast('Invite copied to clipboard', 'ok');
  };

  const incoming = (nudges.data?.nudges ?? []).filter((n) => n.incoming && n.status === 'pending');
  const outgoing = (nudges.data?.nudges ?? []).filter((n) => !n.incoming).slice(0, 5);
  const list = circles.data?.circles ?? [];

  return (
    <div>
      <h1>👭 Safe Circles</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        A small group of friends or colleagues who look out for each other — especially on late commutes.
      </p>

      {incoming.map((n) => (
        <div key={n.id} className="card alert-warn">
          <b>{n.fromName}</b> ({n.circleName}) is asking: <b>“Are you okay?”</b>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="ok" disabled={busy} onClick={() => respond(n.id, 'ok')}>
              💚 I’m okay
            </button>
            <button className="danger" disabled={busy} onClick={() => respond(n.id, 'need_help')}>
              🆘 I need help
            </button>
          </div>
        </div>
      ))}

      <ErrorBox error={circles.error} onRetry={circles.reload} />
      {circles.loading && !circles.data && <Loading />}

      {list.map((c) => (
        <Section
          key={c.id}
          title={c.name}
          right={
            <button className="small secondary" onClick={() => invite(c)}>
              Invite · <span className="mono">{c.inviteCode}</span>
            </button>
          }
        >
          <ul className="list">
            {c.members.map((m: any) => {
              const st = STATE_LABELS[m.state] ?? STATE_LABELS.idle;
              return (
                <li key={m.memberId}>
                  <div className="row between nowrap">
                    <div className="grow">
                      <b>{m.displayName}</b> {m.isMe && <small>(you)</small>} {m.role === 'owner' && <small>· owner</small>}
                      <br />
                      <span className={`badge ${st.cls}`}>{st.label}</span>{' '}
                      {m.trip && (
                        <small>
                          → {m.trip.destination} · ETA {countdown(m.trip.etaAt, now)}
                        </small>
                      )}
                      {m.lastCheckin && (
                        <small className="muted">
                          {' '}
                          · last {m.lastCheckin.kind} {ago(m.lastCheckin.at, now)}
                        </small>
                      )}
                    </div>
                    <div className="row nowrap">
                      {m.sharePath && !m.isMe && (
                        <Link className="btn small danger" to={m.sharePath}>
                          📍 Live
                        </Link>
                      )}
                      {!m.isMe && (
                        <button className="small secondary" disabled={busy} onClick={() => nudge(c.id, m)}>
                          Are you okay?
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="row between" style={{ marginTop: 6 }}>
            <Link className="btn small" to={`/trip?circle=${c.id}`}>
              🚶 Start a trip with this circle
            </Link>
            <button className="small ghost" onClick={() => leave(c)}>
              Leave
            </button>
          </div>
        </Section>
      ))}

      {outgoing.length > 0 && (
        <Section title="Nudges you sent">
          <ul className="list">
            {outgoing.map((n) => (
              <li key={n.id} className="row between nowrap">
                <span className="grow">
                  To {n.toName ?? 'member'} · {ago(n.createdAt, now)}
                </span>
                <span className={`badge ${n.status === 'ok' ? 'b-ok' : n.status === 'need_help' ? 'b-danger' : n.status === 'expired' ? 'b-muted' : 'b-warn'}`}>
                  {n.status === 'ok' ? 'Okay 💚' : n.status === 'need_help' ? 'Needs help' : n.status === 'expired' ? 'No reply' : 'Waiting…'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={list.length ? 'Create or join another circle' : 'Get started'}>
        <label>Your name in circles</label>
        <input type="text" value={displayName || me?.displayName || ''} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Priya" maxLength={40} />
        <div className="grid2" style={{ marginTop: 6 }}>
          <div>
            <label>New circle name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Late-shift buddies" />
            <button className="block" style={{ marginTop: 8 }} disabled={busy} onClick={create}>
              Create
            </button>
          </div>
          <div>
            <label>Invite code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DEMO42" />
            <button className="block secondary" style={{ marginTop: 8 }} disabled={busy || code.trim().length < 4} onClick={join}>
              Join
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
