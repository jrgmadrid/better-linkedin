// Slop-judge service worker (specs/001). Owns the API key: config.local.js
// is loaded here and only here, so page-context code never sees it. Content
// scripts send DP_JUDGE_MSG with a post's body text; the worker answers with
// a cached or fresh verdict, or {ok: false} — callers treat any failure as
// "the heuristic verdict stands" and never block on us.

importScripts('filters.js');

// Fresh clones have no config.local.js; the judge tier just stays off.
let judge = null;
try {
  importScripts('config.local.js');
  if (typeof DEEPSEEK_API_KEY === 'string' && !DEEPSEEK_API_KEY.includes('REPLACE')) {
    judge = { key: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, base: API_BASE };
  }
} catch {
  // no-op — heuristics-only mode
}

const CACHE_KEY = 'dpSlopCache';
const CACHE_MAX = 2000;
const MAX_CONCURRENT = 2;

const RUBRIC = `You judge LinkedIn posts for "slop": formulaic engagement-farming prose. This is an aesthetic judgment about the text, NOT a guess about whether an AI wrote it.

High-slop signals: broetry (stacked one-sentence paragraphs for fake gravitas), "It's not X, it's Y" constructions, emoji-bullet listicles, engagement-bait closers ("Agree?", "Thoughts?", "repost if..."), hollow buzzwords, humble-brag arcs, manufactured vulnerability that resolves into a sales pitch, "Let that sink in".

Low-slop signals: specific concrete detail, genuine information density, natural paragraph rhythm, the author saying something they could be wrong about.

Score 0-100 (0 = genuine writing, 100 = certified slop). Sincere but plainly-written posts (job news, grief, personal milestones) are NOT slop — style alone doesn't convict; the tells above must actually be present.

Respond with strict JSON: {"score": <0-100>, "offenses": [{"label": "<short name>", "detail": "<specific evidence, quoted if possible>"}]} with at most 4 offenses, worst first. Empty offenses array if score < 40.`;

async function callJudge(text) {
  const res = await fetch(`${judge.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${judge.key}`,
    },
    body: JSON.stringify({
      model: judge.model,
      messages: [
        { role: 'system', content: RUBRIC },
        { role: 'user', content: text.slice(0, 4000) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 250,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data = await res.json();
  const verdict = JSON.parse(data.choices[0].message.content);

  const score = Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0)));
  const offenses = (Array.isArray(verdict.offenses) ? verdict.offenses : [])
    .slice(0, 4)
    .map((o) => ({
      label: String(o.label || '').slice(0, 60),
      detail: String(o.detail || '').slice(0, 120),
    }));
  return { score, offenses };
}

async function cacheGet(id) {
  const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
  return cache[id] || null;
}

async function cachePut(id, verdict) {
  const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
  cache[id] = { ...verdict, t: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].t - cache[b].t);
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

// In-flight dedupe and the concurrency gate live in worker memory: a sleep
// wipes them, worst case one duplicate API call. The cache is what persists.
const inflight = new Map();
let active = 0;
const waiting = [];

const acquire = () =>
  active < MAX_CONCURRENT
    ? (active += 1, Promise.resolve())
    : new Promise((resolve) => waiting.push(resolve));

function release() {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

async function verdictFor(id, text) {
  const cached = await cacheGet(id);
  if (cached) return { ok: true, score: cached.score, offenses: cached.offenses };
  if (!judge) return { ok: false };

  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      await acquire();
      try {
        const verdict = await callJudge(text);
        await cachePut(id, verdict);
        return { ok: true, ...verdict };
      } finally {
        release();
        inflight.delete(id);
      }
    })());
  }
  return inflight.get(id).catch(() => ({ ok: false }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== DP_JUDGE_MSG) return;
  verdictFor(msg.id, msg.text).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});
