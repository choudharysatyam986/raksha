import { networkInterfaces } from 'node:os';
import { buildApp } from './app.js';
import { loadDotEnv } from './config.js';

loadDotEnv();

const { app, cfg } = await buildApp();

try {
  await app.listen({ port: cfg.port, host: cfg.host });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i!.address}:${cfg.port}`);

console.log(`
  🛡️  Raksha is running
  ─────────────────────────────────────────────
  Local:          http://localhost:${cfg.port}
  ${lan.length ? `Network:        ${lan.join(', ')}` : ''}
  Public URL:     ${cfg.publicUrl || '(auto-detected from requests; set PUBLIC_URL when hosting)'}
  Demo mode:      ${cfg.demoMode ? 'ON  (1 "minute" = 1 second for live demos)' : 'off'}
  Data dir:       ${cfg.dataDir}
  Authority key:  ${cfg.authorityApiKey}
  Telegram:       ${cfg.telegram.token ? 'enabled' : 'disabled (set TELEGRAM_BOT_TOKEN)'}
  AI:             ${cfg.openai.apiKey || cfg.openai.azureKey ? 'LLM + offline fallback' : 'offline multilingual engine'}
  ─────────────────────────────────────────────
  Tip: GPS, notifications and install-to-home-screen need HTTPS on phones.
       Use a tunnel or deploy (see README.md).
`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
