// Heuristic slop scorer (specs/001). Judges prose quality, not provenance:
// formulaic engagement-farming patterns score points whether a human or an
// LLM wrote them. Pure — no DOM, no chrome.* — so node can load it for tests.
//
// Signals group into families; each family fires its own badge chip when its
// points cross SLOP_FAMILY_THRESHOLD, independent of the aggregate score
// (spec R1, amended). The aggregate still gates the judge call: 40–69 gets a
// second opinion. Weights are calibrated against the labeled eval set in
// specs/001-slop-badge/eval/ (test/slop.test.js); tune there, not by vibes.

const SLOP_FAMILIES = [
  { key: 'broetry', label: 'Broetry' },
  { key: 'bait',    label: 'Engagement bait' },
  { key: 'ad',      label: 'Ad spam' },
];

const SLOP_FAMILY_THRESHOLD = 20;

const SLOP_BUZZWORDS =
  /game-?changer|paradigm shift|deep dive|double[- ]down|unlock(?:ing)? (?:your|the)|superpower|10x|rocket ?ship|grindset|thought leader|personal brand|hot take|unpopular opinion|i['’]?m (?:humbled|thrilled|excited) to (?:announce|share)|elevate your|masterclass in|let['’]?s be honest|read that again|the hard truth|nobody talks about/gi;

// Hard bait is a manipulation mechanic (reshare/follow farming); soft bait
// ("Thoughts?") is at least shaped like a question. Weighted accordingly.
const SLOP_BAIT_HARD =
  /let that sink in|who['’]?s with me|repost (?:if|this|to)|follow (?:me )?for more|share (?:if|this)|♻️|comment ["“']?\w+["”']? below/gi;
const SLOP_BAIT_SOFT =
  /\b(?:agree|thoughts|what do you think)\s*\?/gi;

const SLOP_EMOJI_BULLET =
  /^[\s]*[✅❌➡️👉🔥🚀💡✨📌📈🎯🧵→•·▪️◾️]/u;

// "It's not X, it's Y" and kin — the load-bearing rhetorical tic of the
// genre, in present ("it's not about X, it's about Y") and past tense
// ("wasn't about X. It was about Y").
const SLOP_NOT_BUT =
  /\b(?:it|this|that)['’]?s not (?:just |only |about )?[^.!?\n]{2,60}?[.,;—–-] *(?:it|this|that)['’]?s\b|\bnot because [^.!?\n]{2,60}?, but because\b|\b(?:is|was|are|were)n['’]?t (?:just |only )?about [^.!?\n]{2,60}?[.!?;,—–-] *(?:it|this|that|they)(?:['’]s|['’]re| was| is| were)[^.!?\n]{0,40}?\babout\b/gi;

const SLOP_SIGNALS = [
  {
    key: 'broetry',
    family: 'broetry',
    label: 'Broetry line-stacking',
    detect: (text, ctx) => {
      if (ctx.lines.length < 6) return null;
      const short = ctx.lines.filter((l) => l.split(/\s+/).length <= 16).length;
      if (short / ctx.lines.length < 0.75) return null;
      return { points: 25, detail: `${short} one-line paragraphs` };
    },
  },
  {
    key: 'notbut',
    family: 'broetry',
    label: '"It\'s not X, it\'s Y"',
    detect: (text) => {
      const n = (text.match(SLOP_NOT_BUT) || []).length;
      return n ? { points: Math.min(15 * n, 30), detail: `×${n}` } : null;
    },
  },
  {
    key: 'emojibullets',
    family: 'broetry',
    label: 'Emoji-bullet list',
    detect: (text, ctx) => {
      const n = ctx.lines.filter((l) => SLOP_EMOJI_BULLET.test(l)).length;
      return n >= 3 ? { points: 20, detail: `${n} bulleted lines` } : null;
    },
  },
  {
    key: 'baitcloser',
    family: 'bait',
    label: 'Engagement-bait closer',
    detect: (text) => {
      const tail = text.slice(-220);
      const hard = tail.match(SLOP_BAIT_HARD) || [];
      const soft = tail.match(SLOP_BAIT_SOFT) || [];
      if (!hard.length && !soft.length) return null;
      const points = Math.min(20 * hard.length + 12 * soft.length, 35);
      return { points, detail: (hard[0] || soft[0]).trim() };
    },
  },
  {
    key: 'emdash',
    family: 'broetry',
    label: 'Em-dash density',
    detect: (text, ctx) => {
      const n = (text.match(/[—–]/g) || []).length;
      const density = (n / ctx.words) * 100;
      if (n < 2 || density < 1.2) return null;
      return {
        points: density >= 2.5 ? 25 : 15,
        detail: `${density.toFixed(1)}/100w`,
      };
    },
  },
  {
    key: 'buzzwords',
    family: 'broetry',
    label: 'Buzzword lexicon',
    detect: (text) => {
      const hits = [...new Set((text.match(SLOP_BUZZWORDS) || []).map((h) => h.toLowerCase()))];
      if (!hits.length) return null;
      return { points: Math.min(5 * hits.length, 20), detail: hits.slice(0, 3).join(', ') };
    },
  },
  // The next three target the classified-ad genre (SHOUTING, link piles,
  // contact blocks) — a different slop species than engagement-bait prose,
  // caught by neither buzzwords nor bait closers.
  {
    key: 'shouting',
    family: 'ad',
    label: 'ALL-CAPS shouting',
    detect: (text, ctx) => {
      // ≥5 letters so acronyms (API, JSON, HTTP) don't convict tech posts.
      const caps = (text.match(/\b[A-Z]{5,}\b/g) || []).length;
      if (caps < 4 || caps / ctx.words < 0.05) return null;
      return { points: 20, detail: `${caps} shouted words` };
    },
  },
  {
    key: 'linkpile',
    family: 'ad',
    label: 'Link pile',
    detect: (text) => {
      const n = (text.match(/https?:\/\/|\bwww\.|\blnkd\.in\//g) || []).length;
      return n >= 2 ? { points: 15, detail: `×${n}` } : null;
    },
  },
  {
    key: 'contactblock',
    family: 'ad',
    label: 'Contact block',
    detect: (text) => {
      const phone = /(?:^|\s)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]?\d{4}\b/.test(text);
      const label = /\b(?:tel|phone|call us|whatsapp|dm me)\b/i.test(text);
      if (!phone && !label) return null;
      return { points: phone && label ? 15 : 10, detail: phone ? 'phone number' : 'contact CTA' };
    },
  },
  {
    key: 'rhetq',
    family: 'broetry',
    label: 'Rhetorical-question pileup',
    detect: (text) => {
      const n = (text.match(/\?/g) || []).length;
      return n >= 3 ? { points: 12, detail: `×${n}` } : null;
    },
  },
  {
    key: 'hashtags',
    family: 'bait',
    label: 'Hashtag pileup',
    detect: (text) => {
      const n = (text.match(/#[A-Za-z0-9_]+/g) || []).length;
      if (n < 4) return null;
      return { points: n >= 10 ? 25 : n >= 6 ? 20 : 10, detail: `×${n}` };
    },
  },
];

function scoreSlop(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean).length;
  // Too short to have a rhythm — one-liners can't be slop, only wrong.
  if (words < 25) return { score: 0, offenses: [], families: [] };

  const ctx = { lines, words };
  const offenses = [];
  const perFamily = {};
  let score = 0;
  for (const s of SLOP_SIGNALS) {
    const hit = s.detect(text, ctx);
    if (!hit) continue;
    score += hit.points;
    offenses.push({ label: s.label, detail: hit.detail, points: hit.points });
    const fam = perFamily[s.family] || (perFamily[s.family] = { points: 0, offenses: [] });
    fam.points += hit.points;
    fam.offenses.push({ label: s.label, detail: hit.detail });
  }
  offenses.sort((a, b) => b.points - a.points);

  const families = SLOP_FAMILIES
    .filter((f) => (perFamily[f.key] || { points: 0 }).points >= SLOP_FAMILY_THRESHOLD)
    .map((f) => ({
      key: f.key,
      label: f.label,
      points: perFamily[f.key].points,
      offenses: perFamily[f.key].offenses,
    }));

  return {
    score: Math.min(100, score),
    offenses: offenses.map(({ label, detail }) => ({ label, detail })),
    families,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { SLOP_SIGNALS, SLOP_FAMILIES, SLOP_FAMILY_THRESHOLD, scoreSlop };
}
