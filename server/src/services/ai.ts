import { INCIDENT_TYPE_IDS, FREQUENCIES, scrubPII, structureIncidentOffline, type StructuredIncident } from '@raksha/shared';
import type { Ctx } from '../context.js';

const SYSTEM = `You structure harassment incident descriptions written in English, Hindi or Hinglish for an Indian women-safety app.
Return ONLY JSON with keys: type (one of ${INCIDENT_TYPE_IDS.join(', ')}), severity (1-5), frequency (one of ${FREQUENCIES.join(', ')}),
tags (array of short lowercase tags like bus, metro, night, group, workplace, college), timeHint (string or null), placeHint (string or null),
summary (one neutral English sentence, no names or phone numbers). Never invent facts.`;

function llmConfigured(ctx: Ctx) {
  const o = ctx.cfg.openai;
  return !!(o.apiKey || (o.azureEndpoint && o.azureKey && o.azureDeployment));
}

async function callLlm(ctx: Ctx, text: string): Promise<any> {
  const o = ctx.cfg.openai;
  const body = { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }], temperature: 0, response_format: { type: 'json_object' } };
  let url: string;
  let headers: Record<string, string>;
  if (o.azureEndpoint && o.azureKey && o.azureDeployment) {
    url = `${o.azureEndpoint.replace(/\/$/, '')}/openai/deployments/${o.azureDeployment}/chat/completions?api-version=${o.azureApiVersion}`;
    headers = { 'api-key': o.azureKey, 'content-type': 'application/json' };
  } else {
    url = `${o.baseUrl}/chat/completions`;
    headers = { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' };
    (body as any).model = o.model;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const j: any = await r.json();
    const content: string = j.choices?.[0]?.message?.content ?? '{}';
    // Some OpenAI-compatible providers wrap JSON in ```json fences or add prose; take the outermost object.
    const s = content.indexOf('{');
    const e = content.lastIndexOf('}');
    return JSON.parse(s >= 0 && e > s ? content.slice(s, e + 1) : content);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Structure free text into editable report suggestions. Uses an LLM when configured (text is PII-scrubbed first),
 * and always falls back to the offline multilingual rule engine.
 */
export async function structureIncident(ctx: Ctx, text: string): Promise<StructuredIncident> {
  const offline = structureIncidentOffline(text, new Date(ctx.now()));
  if (!llmConfigured(ctx)) return offline;
  try {
    const j = await callLlm(ctx, scrubPII(text).text);
    return {
      ...offline,
      type: INCIDENT_TYPE_IDS.includes(j.type) ? j.type : offline.type,
      severity: Number.isInteger(j.severity) && j.severity >= 1 && j.severity <= 5 ? j.severity : offline.severity,
      frequency: FREQUENCIES.includes(j.frequency) ? j.frequency : offline.frequency,
      tags: Array.isArray(j.tags) ? [...new Set([...offline.tags, ...j.tags.filter((t: any) => typeof t === 'string').map((t: string) => t.toLowerCase().slice(0, 30))])].slice(0, 10) : offline.tags,
      timeHint: typeof j.timeHint === 'string' ? j.timeHint : offline.timeHint,
      placeHint: typeof j.placeHint === 'string' ? j.placeHint : offline.placeHint,
      summary: typeof j.summary === 'string' && j.summary ? scrubPII(j.summary).text : offline.summary,
      confidence: Math.max(offline.confidence, 0.8),
      source: 'llm',
    };
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'LLM structuring failed, using offline engine');
    return offline;
  }
}

export function aiMode(ctx: Ctx) {
  return llmConfigured(ctx) ? 'llm' : 'offline';
}
