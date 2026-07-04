// Detection is calibrated against LinkedIn's 2026 frontend (hashed CSS-module
// classes, componentkey attributes), with the classic-DOM selectors kept as
// fallback since LinkedIn A/B tests rendering stacks.
//
// Signals, in order of durability:
// 1. Promoted: [aria-label="View Sponsored Content"] — an accessibility
//    disclosure — or a standalone "Promoted" label leaf.
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

const PROMOTED_LABELS = new Set([
  'Promoted',        // en
  'Promocionado',    // es
  'Sponsorisé',      // fr
  'Anzeige',         // de
  'Promosso',        // it
  'Patrocinado',     // pt
  'プロモーション',    // ja
  '推广',             // zh-CN
]);

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

function buildPlaceholder(post, reasons) {
  const box = document.createElement('div');
  box.className = 'dp-placeholder';
  const labels = reasons.map((r) => REASON_LABEL_MAP[r]).filter(Boolean).join(', ');
  box.innerHTML = `
    ${EYE_OFF_ICON}
    <span class="dp-placeholder-text"><span class="dp-title"></span><small>${labels}</small></span>
    <button type="button"></button>`;

  const title = box.querySelector('.dp-title');
  const button = box.querySelector('button');
  const author = post.dataset.dpWho || postAuthor(post);
  const sync = () => {
    const revealed = 'dpRevealed' in post.dataset;
    title.textContent = revealed
      ? 'Post shown'
      : author ? `Hidden post from ${author}` : 'Hidden post';
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

function isPromoted(post) {
  if (post.querySelector('[aria-label="View Sponsored Content"]')) return true;
  for (const el of post.querySelectorAll('p, span')) {
    if (el.childElementCount === 0 && PROMOTED_LABELS.has(el.textContent.trim())) {
      return true;
    }
  }
  return false;
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

function isBareRepost(post) {
  if (post.querySelectorAll('[aria-label^="Visibility:"]').length < 2) return false;
  return BARE_REPOST_PATTERN.test(post.textContent.replace(/\s+/g, ' ').slice(0, 400));
}

// Returns reasons plus `who`: for spillover posts, the connection whose
// activity surfaced the post — their name is the header text preceding the
// matched verb ("Saad Malik likes this…"). That's the name the user can
// actually judge; the original author is usually a stranger.
function classify(post) {
  const reasons = [];
  let who = null;
  if (isPromoted(post)) reasons.push('promoted');

  const head = headSegment(post);
  for (const f of DP_FILTERS) {
    if (!f.pattern) continue;
    const m = f.pattern.exec(head);
    if (!m) continue;
    reasons.push(f.key);
    if (who === null) who = head.slice(0, m.index).trim() || null;
  }
  if (!reasons.includes('reposts') && isBareRepost(post)) reasons.push('reposts');
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
// judged, so its chips stand unappealed (accepted trade, see spec).
const SLOP_LIKELY = 70;
const SLOP_AMBIGUOUS = 40;
const JUDGE_CERTIFIED = 60;
const JUDGE_CLEAR = 40;

const SLOP_FAMILY_LABEL = Object.fromEntries(SLOP_FAMILIES.map((f) => [f.key, f.label]));

const slopReceipt = (offenses) => offenses
  .map((o) => (o.detail ? `${o.label} (${o.detail})` : o.label))
  .join('; ');

function syncSlopChips(post) {
  let box = post.querySelector(':scope > .dp-slop-badge');
  if (!box) {
    box = document.createElement('span');
    box.className = 'dp-slop-badge';
    post.prepend(box);
  }
  box.textContent = '';
  const why = JSON.parse(post.dataset.dpSlopWhy || '{}');
  for (const fam of (post.dataset.dpSlopFams || '').split(' ').filter(Boolean)) {
    const chip = document.createElement('span');
    chip.className = 'dp-slop-chip';
    chip.dataset.fam = fam;
    chip.textContent = SLOP_FAMILY_LABEL[fam];
    chip.title = why[fam] || '';
    box.appendChild(chip);
  }
  if ('dpSlopCertified' in post.dataset) {
    const chip = document.createElement('span');
    chip.className = 'dp-slop-chip';
    chip.dataset.fam = 'certified';
    chip.textContent = 'Certified slop';
    chip.title = post.dataset.dpSlopJudgeWhy || '';
    box.appendChild(chip);
  }
}

function applySlopFamilies(post, families) {
  post.dataset.dpSlopFams = families.map((f) => f.key).join(' ');
  post.dataset.dpSlopWhy = JSON.stringify(
    Object.fromEntries(families.map((f) => [f.key, slopReceipt(f.offenses)])),
  );
  syncSlopChips(post);
}

function certifySlop(post, offenses) {
  post.dataset.dpSlopCertified = '1';
  post.dataset.dpSlopJudgeWhy = slopReceipt(offenses);
  if (!post.dataset.dpSlopFams) post.dataset.dpSlopFams = '';
  syncSlopChips(post);
}

function clearSlop(post) {
  delete post.dataset.dpSlopFams;
  delete post.dataset.dpSlopWhy;
  delete post.dataset.dpSlopCertified;
  delete post.dataset.dpSlopJudgeWhy;
  const box = post.querySelector(':scope > .dp-slop-badge');
  if (box) box.remove();
}

// Fire-and-forget: any failure ({ok: false}, dead worker, timeout) means the
// heuristic chips stand. dpJudged stops re-queueing across sweeps.
function queueJudge(post) {
  post.dataset.dpJudged = '1';
  chrome.runtime.sendMessage(
    { type: DP_JUDGE_MSG, id: postIdentity(post), text: postBody(post) },
    (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) return;
      if (res.score >= JUDGE_CERTIFIED) certifySlop(post, res.offenses);
      else if (res.score < JUDGE_CLEAR) clearSlop(post);
    },
  );
}

function scoreSlopPost(post, hidden) {
  const body = postBody(post);
  if (!body) return;
  const { score, families } = scoreSlop(body);
  post.dataset.dpSlopScore = score;
  if (families.length) applySlopFamilies(post, families);
  if (score >= SLOP_AMBIGUOUS && score < SLOP_LIKELY && !hidden && dpFilters.slop) {
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
    if (score >= SLOP_AMBIGUOUS && score < SLOP_LIKELY) queueJudge(post);
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
    if (!post.querySelector(':scope > .dp-placeholder')) {
      post.prepend(buildPlaceholder(post, post.dataset.dpReasons.split(' ')));
    }
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
// CSS stays in sync with the filter list automatically.
const dpStyle = document.createElement('style');
dpStyle.textContent = DP_FILTERS.map((f) => (f.mode === 'badge'
  ? `html[data-dp-hide~="${f.key}"] [data-dp-slop-fams] > .dp-slop-badge { display: inline-flex !important; }`
  : [
    `html[data-dp-hide~="${f.key}"] [data-dp-reasons~="${f.key}"]:not([data-dp-revealed]) > :not(.dp-placeholder) { display: none !important; }`,
    `html[data-dp-hide~="${f.key}"] [data-dp-reasons~="${f.key}"] > .dp-placeholder { display: flex !important; }`,
  ].join('\n'))).join('\n');
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
