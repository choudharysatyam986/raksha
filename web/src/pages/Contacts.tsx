import { useState } from 'react';
import { del, post, put } from '../api';
import { ErrorBox, Loading, Modal, Section } from '../components';
import { useAction, useApi, useApp } from '../state';
import { copyText, shareOrCopy, waLink } from '../util';

export default function Contacts() {
  const { toast } = useApp();
  const { busy, run } = useAction();
  const list = useApi<{ contacts: any[]; telegramEnabled: boolean; telegramBot: string | null }>('/contacts', 10000);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [link, setLink] = useState<any>(null);

  const add = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Enter a name');
      await post('/contacts', { name, phone: phone || undefined });
      setName('');
      setPhone('');
      await list.reload();
    }, 'Contact added');

  const save = () =>
    run(async () => {
      await put(`/contacts/${editing.id}`, { name: editing.name, phone: editing.phone || undefined });
      setEditing(null);
      await list.reload();
    }, 'Saved');

  const remove = (c: any) =>
    confirm(`Remove ${c.name} from trusted contacts?`) &&
    run(async () => {
      await del(`/contacts/${c.id}`);
      await list.reload();
    }, 'Removed');

  const telegram = (c: any) =>
    run(async () => {
      const r = await post<any>(`/contacts/${c.id}/telegram-link`);
      setLink({ ...r, name: c.name, phone: c.phone });
    });

  const test = (c: any) =>
    run(async () => {
      await post(`/contacts/${c.id}/telegram-test`);
    }, `Test message sent to ${c.name}`);

  return (
    <div>
      <h1>👥 Trusted contacts</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        People who get your SOS and final-stage missed check-in alerts. Link Telegram for automatic delivery; otherwise Raksha prepares an SMS/WhatsApp message for you to send.
      </p>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && !list.data.telegramEnabled && <div className="card alert-info tight">ℹ️ Telegram alerts are not configured on this server — alerts to contacts will use one-tap SMS/WhatsApp instead.</div>}
      {list.loading && !list.data ? (
        <Loading />
      ) : list.data?.contacts?.length ? (
        <div className="card">
          <ul className="list">
            {list.data.contacts.map((c) => (
              <li key={c.id}>
                <div className="row between nowrap">
                  <span className="grow">
                    <b>{c.name}</b> <small className="muted">{c.phone}</small>
                  </span>
                  {c.telegramLinked ? <span className="badge b-ok">Telegram ✓</span> : <span className="badge b-muted">Manual</span>}
                </div>
                <div className="row" style={{ marginTop: 4 }}>
                  {c.telegramLinked ? (
                    <button className="small secondary" disabled={busy} onClick={() => test(c)}>
                      Send test
                    </button>
                  ) : (
                    <button className="small secondary" disabled={busy} onClick={() => telegram(c)}>
                      Link Telegram
                    </button>
                  )}
                  {c.phone && (
                    <a className="btn small ghost" href={`tel:${c.phone}`}>
                      Call
                    </a>
                  )}
                  <button className="small ghost" onClick={() => setEditing({ ...c })}>
                    Edit
                  </button>
                  <button className="small ghost" disabled={busy} onClick={() => remove(c)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="empty">No trusted contacts yet.</p>
      )}

      <Section title="Add a contact">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Didi" />
        <label>Phone (optional, for SMS/WhatsApp/call)</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxxxx" />
        <button className="block" style={{ marginTop: 10 }} disabled={busy} onClick={add}>
          Add contact
        </button>
      </Section>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2>Edit contact</h2>
          <label>Name</label>
          <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <label>Phone</label>
          <input type="tel" value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={save}>
              Save
            </button>
            <button className="ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {link && (
        <Modal onClose={() => { setLink(null); list.reload(); }}>
          <h2>Link {link.name} on Telegram</h2>
          <p>{link.instructions}</p>
          {link.link ? (
            <>
              <p className="mono">{link.link}</p>
              <div className="row">
                <button className="small" onClick={() => shareOrCopy('Raksha alerts', `Please open this so you get my safety alerts on Telegram:`, link.link)}>
                  Share link
                </button>
                <a className="btn small secondary" href={waLink(`Please open this so you get my Raksha safety alerts on Telegram: ${link.link}`, link.phone)} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
                <button className="small ghost" onClick={async () => toast((await copyText(link.link)) ? 'Copied' : 'Copy failed', 'ok')}>
                  Copy
                </button>
              </div>
            </>
          ) : (
            <p className="mono">Code: {link.code}</p>
          )}
          <button className="block secondary" style={{ marginTop: 12 }} onClick={() => { setLink(null); list.reload(); }}>
            Done
          </button>
        </Modal>
      )}
    </div>
  );
}
