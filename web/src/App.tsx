import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { AppCtx, Me, Meta } from './state';
import { startTracking, stopTracking } from './tracker';
import { startVoiceGuard, stopVoiceGuard } from './voiceGuard';
import Home from './pages/Home';
import Report from './pages/Report';
import MyReports from './pages/MyReports';
import SafetyMap from './pages/SafetyMap';
import Circles from './pages/Circles';
import Trip from './pages/Trip';
import Share from './pages/Share';
import Sos from './pages/Sos';
import Evidence from './pages/Evidence';
import Events from './pages/Events';
import Contacts from './pages/Contacts';
import Settings from './pages/Settings';
import Alerts from './pages/Alerts';
import TrackView from './pages/TrackView';
import Authority from './pages/Authority';
import More from './pages/More';

type Toast = { id: number; msg: string; kind: 'ok' | 'err' | 'info' };
const URGENT = /^(sos$|trip_help|trip_overdue|trip_urgent|checkin_missed|nudge_help|event_help|event_risk|contacts_manual|nudge$)/;

export default function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/t/')) {
    return (
      <Routes>
        <Route path="/t/:token" element={<TrackView />} />
      </Routes>
    );
  }
  if (loc.pathname.startsWith('/authority')) return <Authority />;
  return <MainApp />;
}

function MainApp() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nav = useNavigate();
  const loc = useLocation();
  const lastAlertAt = useRef<number | null>(null);

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 4000);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch {
      /* offline – keep last */
    }
  }, []);

  useEffect(() => {
    api<Meta>('/meta', { auth: false }).then(setMeta).catch(() => toast('Cannot reach the Raksha server', 'err'));
    refreshMe();
    const t = setInterval(refreshMe, 8000);
    return () => clearInterval(t);
  }, [refreshMe, toast]);

  // Keep GPS running only while something (trip / share / SOS) needs it.
  useEffect(() => {
    if (me?.trackingNeeded) startTracking();
    else if (me) stopTracking();
  }, [me?.trackingNeeded]); // eslint-disable-line react-hooks/exhaustive-deps

  // In-app alert feed: shows a toast (and a local notification if allowed) for each new alert.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const since = lastAlertAt.current ?? 0;
        const r = await api<{ alerts: any[] }>(`/alerts?since=${since}&limit=10`);
        if (stop) return;
        if (lastAlertAt.current === null) {
          lastAlertAt.current = r.alerts[0]?.createdAt ?? 0;
          return;
        }
        if (r.alerts.length) {
          lastAlertAt.current = Math.max(...r.alerts.map((a) => a.createdAt));
          for (const a of [...r.alerts].reverse()) {
            toast(`${a.title}${a.body ? ' — ' + a.body : ''}`, URGENT.test(a.kind) ? 'err' : 'info');
            if (URGENT.test(a.kind) && navigator.vibrate) navigator.vibrate([300, 100, 300]);
          }
          refreshMe();
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, meta?.demoMode ? 3000 : 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [meta?.demoMode, toast, refreshMe]);

  // Voice Guard
  const vg = me?.settings?.voiceGuard;
  useEffect(() => {
    if (vg?.enabled && vg.keywords?.length) {
      startVoiceGuard(vg.keywords, (word) => {
        toast(`Voice Guard heard “${word}” – starting SOS`, 'err');
        nav('/sos?trigger=voice');
      });
    } else stopVoiceGuard();
    return () => stopVoiceGuard();
  }, [vg?.enabled, JSON.stringify(vg?.keywords ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <AppCtx.Provider value={{ meta, me, refreshMe, toast }}>
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            <img src="/icons/icon.svg" alt="" /> Raksha
          </Link>
          {meta?.demoMode && <span className="demo-pill" title="Timers run 60× faster: 1 minute = 1 second">DEMO ⏩</span>}
          <span className="spacer" />
          {me?.activeSos && (
            <Link to="/sos" className="iconbtn" style={{ background: '#dc2626' }}>
              🚨 SOS
            </Link>
          )}
          <Link to="/alerts" className="iconbtn" aria-label="Alerts">
            🔔{me?.unreadAlerts ? <span className="dot">{me.unreadAlerts > 99 ? '99+' : me.unreadAlerts}</span> : null}
          </Link>
          <Link to="/settings" className="iconbtn" aria-label="Settings">
            ⚙️
          </Link>
        </header>
        {me?.trackingNeeded && (
          <div style={{ background: '#fef3c7', color: '#78350f', fontSize: '0.8rem', padding: '6px 14px' }}>
            📡 Live location is being shared ({[me.activeSos && 'SOS', me.activeTrip && 'trip', me.activeShares && `${me.activeShares} link(s)`].filter(Boolean).join(', ')}). Keep this tab open.
          </div>
        )}
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/report" element={<Report />} />
            <Route path="/reports" element={<MyReports />} />
            <Route path="/reports/:id" element={<MyReports />} />
            <Route path="/map" element={<SafetyMap />} />
            <Route path="/circles" element={<Circles />} />
            <Route path="/trip" element={<Trip />} />
            <Route path="/share" element={<Share />} />
            <Route path="/sos" element={<Sos />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<Events />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<div className="empty">Page not found. <Link to="/">Go home</Link></div>} />
          </Routes>
        </main>
        <nav className="bottomnav">
          <div className="inner">
            <NavLink to="/" end>
              <span className="ic">🏠</span>Home
            </NavLink>
            <NavLink to="/report">
              <span className="ic">📝</span>Report
            </NavLink>
            <NavLink to="/sos" className="sosnav">
              <span className="ic">SOS</span>
            </NavLink>
            <NavLink to="/trip">
              <span className="ic">🚶</span>Trip
            </NavLink>
            <NavLink to="/more">
              <span className="ic">☰</span>More
            </NavLink>
          </div>
        </nav>
        <div className="toast-wrap">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}
