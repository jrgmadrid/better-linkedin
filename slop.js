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
  { key: 'broetry',   label: 'Broetry' },
  { key: 'bait',      label: 'Engagement bait' },
  { key: 'ad',        label: 'Ad spam' },
  // Judge-minted only (spec R9): no signal maps here, so scoreSlop
  // structurally cannot fire it — regex never convicts on intent.
  { key: 'promotion', label: 'Undisclosed promo' },
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

// Command/vote bait (harvest v6-2 misses): ordering readers to perform
// agreement — "if you agree, say AMEN", "AGREE ❤️ or DISAGREE 💔?",
// reaction-emoji CTAs ("👍/🔄 if you agree"). The vote form requires the
// question mark so "people will agree or disagree" discourse walks.
const SLOP_COMMAND_BAIT =
  /\bif you agree,? *(?:say|type|drop|comment|hit|smash)\b|\bagree\b[^\n]{0,8}\bor\b[^\n]{0,8}\bdisagree\b[^\n]{0,8}\?|(?:👍|🔄|♻️|❤️|🔥|💯)[\s/+|]*(?:👍|🔄|♻️|❤️|🔥|💯)*\s*if you (?:agree|relate|believe)/gi;

// Mathematical Alphanumeric Symbols (U+1D400–1D7FF) abused as pseudo-bold/
// italic — a pure attention hack that also breaks screen readers. A run of
// ≥3 means a styled word; single chars are spared so actual math posts
// ("let 𝑥 be…") walk. Detected on the RAW text; everything else scores the
// NFKC-normalized text so the costume can't hide buzzwords from the lexicons.
const SLOP_STYLED_RUN = /[\u{1D400}-\u{1D7FF}]{3,}/gu;

// Mechanical reach-hacks: gaming the algorithm is bait by definition, no
// intent judgment needed. "Link in the first comment" dodges the external-
// link penalty — and the payload noun is a whole wardrobe (article, guide,
// PDF, source…), so it varies freely while the "…in the comments" redirect
// frame stays the crime (recall-leaning by owner decree, 2026-07-15).
// "in a comment" doesn't match: past-tense discussion of comments walks.
// DM-gating trades access for engagement.
const SLOP_REACH_HACK =
  /\b(?:links?|articles?|details|deets|full (?:article|post|story|guide|version|breakdown)|breakdowns?|guides?|templates?|pdfs?|resources?|sources?|reports?|stud(?:y|ies)|papers?|videos?|recordings?|slides|decks?|code|repos?|prompts?|checklists?|cheat ?sheets?)(?: is| are| will be)? in (?:the )?(?:first |1st |pinned )?comments?\b|\bdm me for (?:the )?(?:link|details|access|info|pdf|guide|template|copy)\b|\buse (?:promo )?code\s+[A-Za-z0-9]+/gi;

// Promo-suspicion markers (spec R9). Zero points, no family: promotion is an
// intent judgment and regex never convicts — a hit only widens the judge
// trigger, and the judge walks honest promotion (job posts, launches, event
// invites that say what they are). No bare price mentions: salary-
// transparency and funding posts would drown the trigger.
const SLOP_PROMO_MARKERS =
  /register (?:now|today|here)|sign up (?:now|today|here)|book a (?:call|demo)|save your (?:seat|spot)|limited (?:seats|spots)|early[- ]bird|\d+% off|free (?:[a-z]+ )?(?:trials?|webinars?|masterclass(?:es)?|workshops?|ebooks?|guides?|templates?|reviews?|audits?|consultations?|sessions?|coaching|calls?|checklists?)|(?:just|excited to|thrilled to|proud to) launch(?:ed)?\b|now live on|link in bio|waitlist is open|dms? (?:are )?(?:always )?open|(?:\d+|a few|two|three|four|five) (?:remaining )?(?:spots?|slots?|seats?)\b|spots? (?:are )?(?:open|left|remaining|available)|all spots? claimed/i;

const SLOP_EMOJI_BULLET =
  /^[\s]*[✅❌➡️👉🔥🚀💡✨📌📈🎯🧵→•·▪️◾️]/u;

// "It's not X, it's Y" and kin — the load-bearing rhetorical tic of the
// genre, in present ("it's not about X, it's about Y") and past tense
// ("wasn't about X. It was about Y"). The last alternative catches noun
// subjects ("Project management is not task management. It is tension
// management.") — calibrated from the 2026-07-08 eval labels.
const SLOP_NOT_BUT =
  /\b(?:it|this|that)['’]?s not (?:just |only |about )?[^.!?\n]{2,60}?[.,;—–-] *(?:it|this|that)['’]?s\b|\bnot because [^.!?\n]{2,60}?, but because\b|\b(?:is|was|are|were)n['’]?t (?:just |only )?about [^.!?\n]{2,60}?[.!?;,—–-] *(?:it|this|that|they)(?:['’]s|['’]re| was| is| were)[^.!?\n]{0,40}?\babout\b|\b[\w'’ -]{2,30} (?:is|are) not [\w'’ -]{2,40}[.,;:—–-]\s*(?:it|this|that|they) (?:is|are)\b/gi;

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
    floorExempt: true,
    label: 'Engagement-bait closer',
    detect: (text, ctx) => {
      const tail = text.slice(-220);
      const hard = tail.match(SLOP_BAIT_HARD) || [];
      const soft = tail.match(SLOP_BAIT_SOFT) || [];
      if (!hard.length && !soft.length) return null;
      // Under the word floor the soft closer IS the payload: a sub-25-word
      // "Agree?" post is a vote farm, not a question.
      const softPts = ctx.words < 25 ? 20 : 12;
      const points = Math.min(20 * hard.length + softPts * soft.length, 35);
      return { points, detail: (hard[0] || soft[0]).trim() };
    },
  },
  {
    key: 'commandbait',
    family: 'bait',
    floorExempt: true,
    label: 'Command/vote bait',
    detect: (text) => {
      const hits = text.match(SLOP_COMMAND_BAIT) || [];
      if (!hits.length) return null;
      return { points: Math.min(20 * hits.length, 35), detail: `"${hits[0].trim()}"` };
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
    key: 'fakebold',
    family: 'bait',
    floorExempt: true,
    label: 'Fake-bold styling',
    detect: (text, ctx) => {
      const runs = ctx.raw.match(SLOP_STYLED_RUN) || [];
      if (!runs.length) return null;
      return { points: runs.length >= 3 ? 25 : 15, detail: `${runs.length} styled word${runs.length > 1 ? 's' : ''}` };
    },
  },
  {
    key: 'reachhack',
    family: 'bait',
    floorExempt: true,
    label: 'Reach hack',
    detect: (text) => {
      const hits = text.match(SLOP_REACH_HACK) || [];
      if (!hits.length) return null;
      return { points: Math.min(20 * hits.length, 35), detail: `"${hits[0].trim()}"` };
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
  // Unmask pseudo-bold before scoring (NFKC folds math alphanumerics to
  // ASCII); the raw text rides along in ctx for the styling signal itself.
  const raw = text;
  text = text.normalize('NFKC');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean).length;
  // Rhythm signals need length to mean anything, so the word floor guards
  // them — but bait mechanics convict at any size ("say AMEN if you agree"
  // is a complete crime at eight words). floorExempt signals always run.
  const underFloor = words < 25;

  const ctx = { lines, words, raw };
  const offenses = [];
  const perFamily = {};
  let score = 0;
  for (const s of SLOP_SIGNALS) {
    if (underFloor && !s.floorExempt) continue;
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
    promoSuspect: !underFloor && SLOP_PROMO_MARKERS.test(text),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { SLOP_SIGNALS, SLOP_FAMILIES, SLOP_FAMILY_THRESHOLD, scoreSlop };
}
