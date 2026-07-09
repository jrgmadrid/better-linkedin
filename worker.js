// Slop-judge service worker (specs/001). Owns the API key: config.local.js
// is loaded here and only here, so page-context code never sees it. Content
// scripts send DP_JUDGE_MSG with a post's body text; the worker answers with
// a cached or fresh verdict, or {ok: false} — callers treat any failure as
// "the heuristic verdict stands" and never block on us.

importScripts('filters.js');

// Judge config resolves lazily: a key entered on the options page
// (storage.local, machine-local) wins; config.local.js is the dev
// fallback; neither means the judge tier stays off (R5, amended).
const JUDGE_DEFAULTS = { base: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };

let fileJudge = null;
try {
  importScripts('config.local.js');
  if (typeof DEEPSEEK_API_KEY === 'string' && !DEEPSEEK_API_KEY.includes('REPLACE')) {
    fileJudge = { key: DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, base: API_BASE };
  }
} catch {
  // no-op — storage config or heuristics-only mode
}

let judgePromise = null;
function judgeConfig() {
  judgePromise ??= chrome.storage.local.get(DP_JUDGE_CFG).then(({ [DP_JUDGE_CFG]: c }) => {
    if (c?.apiKey) {
      return { key: c.apiKey, base: c.apiBase || JUDGE_DEFAULTS.base, model: c.model || JUDGE_DEFAULTS.model };
    }
    return fileJudge;
  });
  return judgePromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[DP_JUDGE_CFG]) judgePromise = null;
});

const JUDGE_FAMILIES = new Set(['broetry', 'bait', 'ad', 'promotion']);

const CACHE_KEY = 'dpSlopCache';
const CACHE_MAX = 2000;
const MAX_CONCURRENT = 2;

const RUBRIC = `You judge LinkedIn posts for "slop": formulaic engagement-farming prose. This is an aesthetic judgment about the text, NOT a guess about whether an AI wrote it.

High-slop signals: broetry (stacked one-sentence paragraphs for fake gravitas), "It's not X, it's Y" constructions, emoji-bullet listicles, engagement-bait closers ("Agree?", "Thoughts?", "repost if..."), hollow buzzwords, humble-brag arcs, manufactured vulnerability that resolves into a sales pitch, "Let that sink in".

Low-slop signals: specific concrete detail, genuine information density, natural paragraph rhythm, the author saying something they could be wrong about.

Separately, flag undisclosed promotion: an ad presenting itself as personal content or free value — a manufactured story that resolves into a pitch, a "free" webinar/guide/masterclass funnel, a product plug dressed as a lesson learned. A free offer wrapped in fear hooks ("your resume is failing you"), manufactured scarcity ("3 spots left"), or a DM-funnel close is promotion disguised as generosity — the freebie being real does not clear it. Promotion honestly being promotion is NOT an offense: job posts, launch announcements, and event invites that say what they are walk. Undisclosed promotion is independent of the score — a well-written stealth ad keeps a low score and still gets a "promotion" offense.

Score 0-100 (0 = genuine writing, 100 = certified slop). Sincere but plainly-written posts (job news, grief, personal milestones) are NOT slop — style alone doesn't convict; the tells above must actually be present.

Family guide: "broetry" = performative prose mechanics; "bait" = engagement mechanics (closers, hooks, vote-farming); "ad" = formatting spam (shouting, link piles, contact blocks); "promotion" = ANY disguised-promotion offense, including free-value funnels — when in doubt between "ad" and "promotion", disguise means "promotion".

Respond with strict JSON: {"score": <0-100>, "offenses": [{"family": "<broetry|bait|ad|promotion>", "label": "<short name>", "detail": "<specific evidence, quoted if possible>"}]} with at most 4 offenses, worst first. Empty offenses array if score < 40 and no undisclosed promotion found.`;

async function callJudge(judge, text) {
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
      // deepseek-v4-flash reasons before answering, and reasoning spends
      // from this same budget — at 250 it routinely emitted zero content
      // (finish_reason: length, probed 2026-07-04). The verdict JSON itself
      // is ~120 tokens; the rest is thinking room.
      max_tokens: 1500,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data = await res.json();
  const verdict = JSON.parse(data.choices[0].message.content);

  const score = Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0)));
  const offenses = (Array.isArray(verdict.offenses) ? verdict.offenses : [])
    .slice(0, 4)
    .map((o) => {
      const offense = {
        label: String(o.label || '').slice(0, 60),
        detail: String(o.detail || '').slice(0, 120),
      };
      // Invalid family → field omitted → never mints a chip (spec R9).
      if (JUDGE_FAMILIES.has(o.family)) offense.family = o.family;
      return offense;
    });
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
  const judge = await judgeConfig();
  if (!judge) return { ok: false };

  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      await acquire();
      try {
        const verdict = await callJudge(judge, text);
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

// The options page's test button: one real, uncached judge call on a canned
// slop snippet. The only surface where a failure is allowed to say why —
// fail-open makes a broken key silent everywhere else. Never echoes the key.
const JUDGE_TEST_TEXT =
  'Repost if you agree! Follow for more insights like this. '
  + 'Link in the first comment. Agree? #growth #mindset #hustle #grindset';

async function testJudge() {
  const judge = await judgeConfig();
  if (!judge) return { ok: false, error: 'no key configured' };
  try {
    const verdict = await callJudge(judge, JUDGE_TEST_TEXT);
    return { ok: true, score: verdict.score };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === DP_JUDGE_MSG) {
    verdictFor(msg.id, msg.text).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === DP_JUDGE_TEST) {
    testJudge().then(sendResponse);
    return true;
  }
});

// Dev loop: reloading the extension (popup button or chrome://extensions)
// leaves stale content scripts in open tabs — they only re-inject on tab
// load. The fresh worker boots with onInstalled, so refresh LinkedIn tabs
// here and the new scripts arrive without touching the browser. Reason is
// gated so a browser update doesn't yank tabs out from under the user.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
    for (const tab of tabs) chrome.tabs.reload(tab.id);
  });
});
