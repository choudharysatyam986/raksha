/**
 * Voice Guard: listens for user-chosen distress keywords (e.g. "bachao", "help me") using the browser's
 * Web Speech API while the app is open, then triggers an SOS countdown. Works best on Chrome/Android.
 */
type Listener = (heard: string) => void;

const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const voiceGuardSupported = !!SR;

let rec: any = null;
let wanted = false;
let keywords: string[] = [];
let onMatch: Listener | null = null;
let statusCb: ((s: string) => void) | null = null;

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function startVoiceGuard(words: string[], cb: Listener, onStatus?: (s: string) => void) {
  if (!SR) return false;
  keywords = words.map(norm).filter(Boolean);
  onMatch = cb;
  statusCb = onStatus ?? null;
  wanted = true;
  if (rec) return true;
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-IN';
  rec.onresult = (ev: any) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const said = norm(ev.results[i][0].transcript);
      const hit = keywords.find((k) => said.includes(k));
      if (hit) {
        onMatch?.(hit);
        break;
      }
    }
  };
  rec.onerror = (e: any) => {
    statusCb?.(e.error === 'not-allowed' ? 'Microphone permission denied' : `Paused (${e.error})`);
    if (e.error === 'not-allowed') wanted = false;
  };
  rec.onend = () => {
    if (wanted) {
      setTimeout(() => {
        try {
          rec?.start();
        } catch {
          /* already started */
        }
      }, 400);
    } else {
      rec = null;
      statusCb?.('Off');
    }
  };
  try {
    rec.start();
    statusCb?.('Listening');
  } catch {
    /* ignore */
  }
  return true;
}

export function stopVoiceGuard() {
  wanted = false;
  try {
    rec?.stop();
  } catch {
    /* ignore */
  }
}

export const voiceGuardRunning = () => wanted;
