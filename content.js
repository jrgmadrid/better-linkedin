// Detection is calibrated against LinkedIn's 2026 frontend (hashed CSS-module
// classes, componentkey attributes), with the classic-DOM selectors kept as
// fallback since LinkedIn A/B tests rendering stacks.
//
// Signals, in order of durability:
// 1. Promoted: [aria-label="View Sponsored Content"] — an accessibility
//    disclosure — or a "Promoted" label leading a p/span outside the body
//    ("Promoted", "Promoted by Acme", "Promoted • Partnership with Acme").
// 2. Spillover: the surfacing header ("Jane Doe commented") is always the
//    first text in the post, after a hidden "Feed post" prefix and before the
//    author block, so patterns are matched only against that head segment.
//
// Each post is classified once into data-dp-reasons. The set of *enabled*
// filters lives in a data-dp-hide attribute on <html>, and CSS rules generated
// from DP_FILTERS intersect the two — so toggling a filter in the popup hides/
// unhides instantly without touching any post again.
//
// Badge-mode filters (slop) use a parallel channel: the verdict lands in
// data-dp-slop instead of data-dp-reasons, and the generated CSS shows a
// pill on the still-visible post rather than collapsing it.

const POST_SELECTOR = [
  'div[role="listitem"][componentkey*="FeedType"]',
  'div[data-id^="urn:li:activity"]',
  'div.feed-shared-update-v2',
].join(', ');

// Build a reason-key → label lookup from the shared filter list.
const REASON_LABEL_MAP = Object.fromEntries(DP_FILTERS.map((f) => [f.key, f.reasonLabel]));

const EYE_OFF_ICON = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;

// The author's name comes from the control-menu accessibility label, which
// every post type carries (and which the hydration gate in sweep() already
// requires). It names the post's author, not the connection whose reaction
// surfaced it.
const AUTHOR_LABEL_PREFIX = 'Open control menu for post by ';

function postAuthor(post) {
  const el = post.querySelector(`[aria-label^="${AUTHOR_LABEL_PREFIX}"]`);
  return el ? el.getAttribute('aria-label').slice(AUTHOR_LABEL_PREFIX.length).trim() : null;
}

// The placeholder names the specific noise, not just "post": the noun comes
// from the highest-priority reason, `who` is the responsible party (the
// surfacing connection when there is one, else the author), and the byline
// credits the original poster when that's a different person. Nouns are
// reserved for observable mechanics; verdicts (slop families, promotion)
// stay in the byline, where "Broetry" reads as the claim it is. Labels the
// noun fully subsumes ("Reaction spillover" under "Hidden reaction") are
// dropped; the rest stay as receipts.
const PLACEHOLDER_NOUNS = {
  promoted: 'ad', reactions: 'reaction', comments: 'comment', follows: 'follow',
  reposts: 'repost', figleaf: 'repost', suggested: 'suggested post',
};
const NOUN_SAYS_IT_ALL = new Set(['promoted', 'reactions', 'comments', 'follows', 'reposts', 'suggested']);

function placeholderText(post) {
  const keys = placeholderKeys(post);
  const noun = PLACEHOLDER_NOUNS[keys[0]] || 'post';
  const who = post.dataset.dpWho || postAuthor(post);
  const original = postAuthor(post);
  const byline = [];
  if (post.dataset.dpWho && original && original !== post.dataset.dpWho) {
    byline.push(`post by ${original}`);
  }
  byline.push(...keys.filter((k) => !NOUN_SAYS_IT_ALL.has(k))
    .map((k) => REASON_LABEL_MAP[k]).filter(Boolean));
  return {
    title: who ? `Hidden ${noun} from ${who}` : `Hidden ${noun}`,
    byline: byline.join(' · '),
  };
}

function buildPlaceholder(post) {
  const box = document.createElement('div');
  box.className = 'dp-placeholder';
  box.innerHTML = `
    ${EYE_OFF_ICON}
    <span class="dp-placeholder-text"><span class="dp-title"></span><small></small></span>
    <button type="button"></button>`;

  const title = box.querySelector('.dp-title');
  const small = box.querySelector('small');
  const button = box.querySelector('button');
  const sync = () => {
    const revealed = 'dpRevealed' in post.dataset;
    const text = placeholderText(post);
    title.textContent = revealed ? 'Post shown' : text.title;
    small.textContent = text.byline;
    button.textContent = revealed ? 'Hide' : 'Show';
  };
  sync();

  button.addEventListener('click', () => {
    if ('dpRevealed' in post.dataset) delete post.dataset.dpRevealed;
    else post.dataset.dpRevealed = '1';
    sync();
  });
  return box;
}

// The ad label is only the *leading* text of its element: thought-leader and
// partnership ads put the advertiser in child nodes ("Promoted by <a>Acme</a>"),
// so leaf-text matching goes blind on them. The match is anchored to the first
// direct text node and never runs inside the body box, where organic prose
// ("Promoted by popular demand…") could convict. The element's remaining text
// names the advertiser — the placeholder's responsible party when present.
function promotedLabel(post) {
  if (post.querySelector('[aria-label="View Sponsored Content"]')) {
    return { advertiser: null };
  }
  for (const el of post.querySelectorAll('p, span')) {
    const lead = [...el.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
    );
    if (!lead || !DP_PROMOTED_PATTERN.test(lead.textContent.trim())) continue;
    if (el.closest(BODY_SELECTOR)) continue;
    const advertiser = el.textContent.replace(lead.textContent, '').trim();
    return { advertiser: advertiser || null };
  }
  return null;
}

// The surfacing header precedes the author block, whose "• 1st/2nd" degree
// marker is the first bullet in the post text — so matching stops there.
function headSegment(post) {
  return post.textContent
    .replace(/\s+/g, ' ')
    .replace(/^\s*Feed post/, '')
    .slice(0, 120)
    .split('•')[0];
}

// Bare reposts render as an embedded original with no "reposted this" header:
// two stacked actor blocks. Signature: a second "Visibility:" disclosure, and
// the reposter's and original's timestamps separated only by the embedded
// author's name. Commentary between the timestamps means a quote-repost,
// which stays visible.
const BARE_REPOST_PATTERN =
  /\d+\s?(?:min|h|d|w|mo|yr)\b\s*•\s*(?:Edited\s*•\s*)?.{0,45}?\s?\d+\s?(?:min|h|d|w|mo|yr)\b/;

// Both repost detectors key on the embed signature: a second "Visibility:"
// disclosure means a post nested inside a post.
const hasEmbeddedRepost = (post) =>
  post.querySelectorAll('[aria-label^="Visibility:"]').length >= 2;

function isBareRepost(post) {
  if (!hasEmbeddedRepost(post)) return false;
  return BARE_REPOST_PATTERN.test(post.textContent.replace(/\s+/g, ' ').slice(0, 400));
}

// Fig-leaf reposts: an embedded original whose outer commentary is a generic
// reaction — "Couldn't agree more with this take." postBody() returns the
// outer commentary box on quote-reposts (first match wins), which is exactly
// the text being judged here.
function isFigleafRepost(post) {
  return hasEmbeddedRepost(post) && isFigleafCommentary(postBody(post));
}

// Returns reasons plus `who`: for spillover posts, the connection whose
// activity surfaced the post — their name is the header text preceding the
// matched verb ("Saad Malik likes this…"). That's the name the user can
// actually judge; the original author is usually a stranger.
function classify(post) {
  const reasons = [];
  let who = null;
  const promo = promotedLabel(post);
  if (promo) {
    reasons.push('promoted');
    who = promo.advertiser;
  }

  const head = headSegment(post);
  for (const f of DP_FILTERS) {
    if (!f.pattern) continue;
    const m = f.pattern.exec(head);
    if (!m) continue;
    reasons.push(f.key);
    if (who === null) who = head.slice(0, m.index).trim() || null;
  }
  if (!reasons.includes('reposts') && isBareRepost(post)) reasons.push('reposts');
  if (!reasons.includes('reposts') && isFigleafRepost(post)) reasons.push('figleaf');
  return { reasons, who };
}

// Post commentary, for the slop scorer. innerText, not textContent: broetry
// detection needs the visual line breaks. First match wins — embedded reposts
// carry a second expandable-text-box, and the outer author's commentary is
// the one being judged.
const BODY_SELECTOR = [
  '[data-testid="expandable-text-box"]',
  '.feed-shared-update-v2__description',
  '.update-components-text',
].join(', ');

// Prefer a rendered box: posts usually carry a hidden twin, and innerText on
// a non-rendered element degrades to textContent — paragraph breaks (which
// broetry detection needs) fuse away.
function postBody(post) {
  const els = [...post.querySelectorAll(BODY_SELECTOR)];
  const el = els.find((e) => e.offsetParent !== null) || els[0];
  return el ? el.innerText.trim() : '';
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Verdict-cache identity: the unique token inside the root componentkey
// ("expanded<token>FeedType_…" — distinct for all 108 posts in the harvest
// set, and derived from the post, not the render pass), else the classic-DOM
// activity URN, else a body-text hash.
function postIdentity(post) {
  const m = (post.getAttribute('componentkey') || '').match(/^expanded(.+?)FeedType/);
  if (m) return m[1];
  return post.getAttribute('data-id') || 'h' + djb2(postBody(post).slice(0, 300));
}

// Families fire chips independently at their own threshold (spec R1,
// amended); the aggregate score only gates the judge call. 40–69 gets a
// second opinion: the judge can certify (adds the filled chip) or clear the
// heuristic chips outright — that's the safety net for sincere posts that
// merely look like slop. ≥70 is a final local conviction; <40 is never
// judged, so its chips stand unappealed (accepted trade, see spec) — unless
// promo-suspected (spec R9), which widens the trigger below the band so the
// judge can mint the promotion chip regex isn't allowed to.
const SLOP_LIKELY = 70;
const SLOP_AMBIGUOUS = 40;
const JUDGE_CERTIFIED = 60;
const JUDGE_CLEAR = 40;

const SLOP_FAMILY_LABEL = Object.fromEntries(SLOP_FAMILIES.map((f) => [f.key, f.label]));

const slopReceipt = (offenses) => offenses
  .map((o) => (o.detail ? `${o.label} (${o.detail})` : o.label))
  .join('; ');

const slopFams = (post) => (post.dataset.dpSlopFams || '').split(' ').filter(Boolean);

// Every reason a post can be hidden, priority-ordered: hide-filter reasons
// first (classify order), then slop chips, then the judge's certification.
function placeholderKeys(post) {
  const keys = (post.dataset.dpReasons || '').split(' ').filter(Boolean).concat(slopFams(post));
  if ('dpSlopCertified' in post.dataset) keys.push('certified');
  return keys;
}

// The placeholder is the single statement of every reason a post can be
// hidden (spec R10). Built on first need, text refreshed as judge verdicts
// change the key set; a revealed post keeps its "Post shown" title.
function syncPlaceholder(post) {
  const ph = post.querySelector(':scope > .dp-placeholder');
  if (!placeholderKeys(post).length) {
    if (ph) ph.remove();
    return;
  }
  if (!ph) {
    post.prepend(buildPlaceholder(post));
    return;
  }
  const text = placeholderText(post);
  if (!('dpRevealed' in post.dataset)) ph.querySelector('.dp-title').textContent = text.title;
  ph.querySelector('small').textContent = text.byline;
}

function slopChip(fam, label, title) {
  const chip = document.createElement('span');
  chip.className = 'dp-slop-chip';
  chip.dataset.fam = fam;
  chip.textContent = label;
  chip.title = title;
  return chip;
}

function syncSlopChips(post) {
  const fams = slopFams(post);
  const certified = 'dpSlopCertified' in post.dataset;
  let box = post.querySelector(':scope > .dp-slop-badge');
  if (!fams.length && !certified) {
    if (box) box.remove();
    syncPlaceholder(post);
    return;
  }
  if (!box) {
    box = document.createElement('span');
    box.className = 'dp-slop-badge';
    post.prepend(box);
  }
  box.textContent = '';
  const why = JSON.parse(post.dataset.dpSlopWhy || '{}');
  for (const fam of fams) {
    box.appendChild(slopChip(fam, SLOP_FAMILY_LABEL[fam], why[fam] || ''));
  }
  if (certified) {
    box.appendChild(slopChip('certified', 'Certified slop', post.dataset.dpSlopJudgeWhy || ''));
  }
  syncPlaceholder(post);
}

function applySlopFamilies(post, families) {
  post.dataset.dpSlopFams = families.map((f) => f.key).join(' ');
  post.dataset.dpSlopWhy = JSON.stringify(
    Object.fromEntries(families.map((f) => [f.key, slopReceipt(f.offenses)])),
  );
  syncSlopChips(post);
}

// One declarative application per verdict — the final chip state is computed
// here, not choreographed across helpers. A clear (<40) wipes the heuristic
// chips but never the promotion chip: the two verdicts are orthogonal (spec
// R9), a well-written stealth ad keeps its low score and wears the chip
// anyway. The badge box's visibility CSS keys on data-dp-slop-fams existing,
// so a certified post keeps the attribute even when its family list is empty.
function applyJudgeVerdict(post, { score, offenses }) {
  const promo = offenses.filter((o) => o.family === 'promotion');
  let fams = slopFams(post);
  let why = JSON.parse(post.dataset.dpSlopWhy || '{}');

  if (score < JUDGE_CLEAR) {
    fams = [];
    why = {};
  }
  if (promo.length && !fams.includes('promotion')) {
    fams.push('promotion');
    why.promotion = slopReceipt(promo);
  }
  if (score >= JUDGE_CERTIFIED) {
    post.dataset.dpSlopCertified = '1';
    post.dataset.dpSlopJudgeWhy = slopReceipt(offenses);
  }

  if (fams.length || 'dpSlopCertified' in post.dataset) {
    post.dataset.dpSlopFams = fams.join(' ');
    post.dataset.dpSlopWhy = JSON.stringify(why);
  } else {
    delete post.dataset.dpSlopFams;
    delete post.dataset.dpSlopWhy;
  }
  syncSlopChips(post);
}

// Fire-and-forget: any failure ({ok: false}, dead worker, timeout) means the
// heuristic chips stand. dpJudged stops re-queueing across sweeps.
function queueJudge(post) {
  post.dataset.dpJudged = '1';
  chrome.runtime.sendMessage(
    { type: DP_JUDGE_MSG, id: postIdentity(post), text: postBody(post) },
    (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      applyJudgeVerdict(post, res);
    },
  );
}

// The judge hears aggregate scores in the ambiguous band, plus promo
// suspects below it (spec R9). Local convictions (≥70) are final.
const judgeworthy = (score, promoSuspect) =>
  (score >= SLOP_AMBIGUOUS || promoSuspect) && score < SLOP_LIKELY;

function scoreSlopPost(post, hidden) {
  const body = postBody(post);
  if (!body) return;
  const { score, families, promoSuspect } = scoreSlop(body);
  post.dataset.dpSlopScore = score;
  if (promoSuspect) post.dataset.dpSlopPromo = '1';
  if (families.length) applySlopFamilies(post, families);
  if (judgeworthy(score, promoSuspect) && !hidden && dpFilters.slop) {
    queueJudge(post);
  }
}

// Posts scored into the ambiguous band while the slop filter was off (or
// hidden by another filter that later got disabled) get their judge call
// when the toggle flips on.
function requeueAmbiguous() {
  for (const post of document.querySelectorAll('[data-dp-slop-score]')) {
    if ('dpJudged' in post.dataset || post.dataset.dpReasons) continue;
    const score = Number(post.dataset.dpSlopScore);
    if (judgeworthy(score, 'dpSlopPromo' in post.dataset)) queueJudge(post);
  }
}

// Rail widgets (LinkedIn News, Today's puzzles) live in the right-hand aside:
// each widget card is a grandchild of the aside, so from the heading we climb
// until the parent's parent is the aside. If the structure shifts and we hit
// the aside's direct child instead, that wrapper holds exactly these widgets,
// so marking it is an acceptable fallback.
const RAIL_WIDGET_HEADING = /^(LinkedIn News|Today['’]s (?:puzzles|games))$/i;

function sweepWidgets() {
  for (const el of document.querySelectorAll('aside p, aside h2, aside h3')) {
    if (el.childElementCount || !RAIL_WIDGET_HEADING.test(el.textContent.trim())) continue;
    const aside = el.closest('aside');
    let node = el;
    while (node.parentElement !== aside && node.parentElement.parentElement !== aside) {
      node = node.parentElement;
    }
    node.dataset.dpWidget = '1';
  }
}

function sweep() {
  sweepWidgets();
  for (const post of document.querySelectorAll(POST_SELECTOR)) {
    if (post.dataset.dpChecked) continue;
    // Hydration gate: every fully-rendered post carries an "Open control menu
    // for post by …" aria-label; skeletons don't. Skipping without stamping
    // lets the MutationObserver naturally re-examine on the next mutation.
    if (!post.querySelector('[aria-label*="control menu"]')) continue;
    post.dataset.dpChecked = '1';
    const { reasons, who } = classify(post);
    if (reasons.length) {
      post.dataset.dpReasons = reasons.join(' ');
      if (who) post.dataset.dpWho = who;
    }
    scoreSlopPost(post, reasons.length > 0);
  }

  // LinkedIn's renderer may reconcile away injected nodes; re-seed any
  // classified post whose placeholder or badge went missing.
  for (const post of document.querySelectorAll('[data-dp-reasons]')) {
    if (!post.querySelector(':scope > .dp-placeholder')) syncPlaceholder(post);
  }
  for (const post of document.querySelectorAll('[data-dp-slop-fams]')) {
    if (!post.querySelector(':scope > .dp-slop-badge')) syncSlopChips(post);
  }
}

let dpFilters = DP_DEFAULTS;

function applyFilters(filters) {
  dpFilters = filters;
  const enabled = Object.keys(filters).filter((key) => filters[key]);
  document.documentElement.dataset.dpHide = enabled.join(' ');
  if (filters.slop) requeueAmbiguous();
}

chrome.storage.sync.get(DP_DEFAULTS, applyFilters);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DP_DEFAULTS, applyFilters);
});

// Inject per-filter hide/show rules — macro-expansions of DP_FILTERS, so the
// CSS stays in sync with the filter list automatically. Slop-hide rows (R10)
// target the badge channel (data-dp-slop-fams / -certified) instead of
// data-dp-reasons; the hide/placeholder pair is otherwise identical.
const dpRuleFor = (f) => {
  if (f.mode === 'badge') {
    return `html[data-dp-hide~="${f.key}"] [data-dp-slop-fams] > .dp-slop-badge { display: inline-flex !important; }`;
  }
  const target = f.mode === 'slophide'
    ? (f.key === 'certified' ? '[data-dp-slop-certified]' : `[data-dp-slop-fams~="${f.key}"]`)
    : `[data-dp-reasons~="${f.key}"]`;
  return [
    `html[data-dp-hide~="${f.key}"] ${target}:not([data-dp-revealed]) > :not(.dp-placeholder) { display: none !important; }`,
    `html[data-dp-hide~="${f.key}"] ${target} > .dp-placeholder { display: flex !important; }`,
  ].join('\n');
};
const dpStyle = document.createElement('style');
dpStyle.textContent = DP_FILTERS.map(dpRuleFor).join('\n');
document.documentElement.appendChild(dpStyle);

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sweep();
  });
});

observer.observe(document.body, { childList: true, subtree: true });
sweep();
