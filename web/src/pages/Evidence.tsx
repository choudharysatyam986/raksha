import { useRef, useState } from 'react';
import { api, authedBlob, del } from '../api';
import { ErrorBox, Loading, Section } from '../components';
import { useAction, useApi, useApp } from '../state';
import { fmtBytes, fmtTime, sha256OfFile } from '../util';

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Evidence() {
  const { meta, toast } = useApp();
  const { busy, run } = useAction();
  const list = useApi<{ evidence: any[] }>('/evidence');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [hash, setHash] = useState<string | null | undefined>(undefined);
  const [checks, setChecks] = useState<Record<string, any>>({});

  const pick = async (f: File | null) => {
    setFile(f);
    setHash(undefined);
    if (f) setHash(await sha256OfFile(f));
  };

  const upload = () =>
    run(async () => {
      if (!file) throw new Error('Choose a file first');
      if (meta && file.size > meta.maxEvidenceMb * 1048576) throw new Error(`File is larger than ${meta.maxEvidenceMb} MB`);
      const fd = new FormData();
      if (hash) fd.append('clientSha256', hash);
      if (note) fd.append('note', note);
      fd.append('file', file); // file last so fields are parsed first
      const r = await api<any>('/evidence', { method: 'POST', body: fd });
      setFile(null);
      setNote('');
      setHash(undefined);
      if (fileRef.current) fileRef.current.value = '';
      await list.reload();
      return r;
    }, 'Encrypted and stored ✓');

  const verify = (e: any) =>
    run(async () => {
      // Re-download, hash on this device, and ask the server to recompute from the encrypted copy.
      const { blob } = await authedBlob(`/evidence/${e.id}/download`);
      const local = await sha256OfFile(blob);
      const r = await api<any>(`/evidence/${e.id}/verify`, { method: 'POST', body: local ? { sha256: local } : {} });
      setChecks((c) => ({ ...c, [e.id]: { ...r, local } }));
      return r;
    });

  const download = (e: any) =>
    run(async () => {
      const { blob } = await authedBlob(`/evidence/${e.id}/download`);
      saveBlob(blob, e.filename);
    });

  const certificate = (e: any) => {
    const w = window.open('', '_blank');
    run(async () => {
      const { blob } = await authedBlob(`/evidence/${e.id}/certificate?format=html`);
      const url = URL.createObjectURL(new Blob([await blob.text()], { type: 'text/html' }));
      if (w) w.location.href = url;
      else saveBlob(blob, `certificate-${e.id}.html`);
    }).catch(() => w?.close());
  };

  const remove = (e: any) =>
    confirm(`Permanently delete "${e.filename}"? This cannot be undone.`) &&
    run(async () => {
      await del(`/evidence/${e.id}`);
      await list.reload();
    }, 'Deleted');

  return (
    <div>
      <h1>🔐 Evidence vault</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Photos, screenshots, audio or chats are encrypted (AES-256-GCM) on the server. A SHA-256 fingerprint proves they were not altered.
      </p>
      <Section title="Add evidence">
        <input ref={fileRef} type="file" accept="image/*,audio/*,video/*,application/pdf,text/plain" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        {file && (
          <div className="kv" style={{ marginTop: 8 }}>
            <small>
              {file.name} · {fmtBytes(file.size)}
            </small>
            <small className="mono">{hash === undefined ? 'Computing fingerprint…' : hash ? `SHA-256 ${hash}` : 'Fingerprint will be computed on the server (needs HTTPS to compute on device).'}</small>
          </div>
        )}
        <label>Note (optional, private)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Screenshot of messages from 12 May" />
        <button className="block" style={{ marginTop: 10 }} disabled={busy || !file} onClick={upload}>
          Encrypt & upload
        </button>
        <small className="muted">Max {meta?.maxEvidenceMb ?? 10} MB. Only this device can access its vault.</small>
      </Section>

      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data?.evidence?.length ? (
        list.data.evidence.map((e) => {
          const c = checks[e.id];
          return (
            <div key={e.id} className={`card ${c ? (c.intact && c.providedMatches !== false ? 'alert-ok' : 'alert-danger') : ''}`}>
              <div className="row between nowrap">
                <b style={{ wordBreak: 'break-all' }}>{e.filename}</b>
                <small>{fmtBytes(e.size)}</small>
              </div>
              <small className="muted">
                {fmtTime(e.createdAt)} · {e.mime}
              </small>
              {e.note && <p style={{ margin: '4px 0' }}>{e.note}</p>}
              <div className="mono" style={{ fontSize: '0.7rem' }}>
                SHA-256 {e.sha256}
              </div>
              {c && (
                <p>
                  {c.intact ? '✅ Server copy intact' : '❌ Server copy failed integrity check'}
                  {c.providedMatches === true && ' · ✅ Matches on this device'}
                  {c.providedMatches === false && ' · ❌ Device hash differs'}
                  {c.local === null && ' · (device hash needs HTTPS)'}
                </p>
              )}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="small" disabled={busy} onClick={() => verify(e)}>
                  Verify
                </button>
                <button className="small secondary" disabled={busy} onClick={() => download(e)}>
                  Download
                </button>
                <button className="small secondary" disabled={busy} onClick={() => certificate(e)}>
                  Certificate
                </button>
                <button className="small ghost" disabled={busy} onClick={() => remove(e)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })
      ) : (
        <p className="empty">No evidence stored yet.</p>
      )}
      <button className="link" onClick={() => toast('Tip: the certificate can be printed or saved as PDF and attached to a complaint.', 'info')}>
        How do I use the certificate?
      </button>
    </div>
  );
}
