import type { Ctx } from './context.js';
import { recomputeAll } from './services/risk.js';
import { processShares, processTrips } from './services/safety.js';

/** Background loop: staged check-in escalation, share expiry, Telegram linking and periodic risk decay refresh. */
export function startScheduler(ctx: Ctx) {
  let running = false;
  let lastFull = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTick(ctx);
      if (ctx.now() - lastFull > 10 * 60_000) {
        lastFull = ctx.now();
        await recomputeAll(ctx);
      }
    } catch (e) {
      ctx.log.error({ err: e }, 'scheduler tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, ctx.cfg.tickMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function runTick(ctx: Ctx) {
  await processTrips(ctx);
  await processShares(ctx);
  await ctx.notify.telegramPoll();
}
