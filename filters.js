const DP_HARVEST_MSG = 'dp-harvest';
const DP_JUDGE_MSG = 'dp-judge';
const DP_JUDGE_TEST = 'dp-judge-test';
const DP_JUDGE_CFG = 'dpJudgeConfig';

// Popup sections, in display order. Feed filters group by who injected the
// noise: LinkedIn itself, your network's activity, or the reposter.
const DP_SECTIONS = [
  { key: 'injected',  title: 'Hide ads & recommendations' },
  { key: 'spillover', title: 'Hide network spillover' },
  { key: 'reposts',   title: 'Hide reposts' },
  { key: 'slop',      title: 'Slop' },
];

// Rows without a `mode` hide the post behind a placeholder; mode: 'badge'
// leaves the post visible and pins a verdict pill on it instead.
const DP_FILTERS = [
  { key: 'promoted',  label: 'Promoted posts',      hint: null,                            reasonLabel: 'Promoted',           pattern: null,                                                         enabled: true,  section: 'injected' },
  { key: 'suggested', label: 'Suggested posts',     hint: '"Recommended for you"',         reasonLabel: 'Suggested post',     pattern: /suggested for you|recommended for you/i,                    enabled: false, section: 'injected' },
  // Rail widgets, not feed posts: hidden outright by sweepWidgets(), no placeholder.
  { key: 'railwidgets', label: 'News & games',      hint: '"LinkedIn News", "Today’s puzzles"', reasonLabel: 'News & games', pattern: null,                                                 enabled: false, section: 'injected' },
  { key: 'reactions', label: 'Reaction spillover',  hint: '"Jane Doe likes this"',         reasonLabel: 'Reaction spillover', pattern: /(?:likes|loves|celebrates|supports|finds) this|reacted to/,  enabled: false, section: 'spillover' },
  // No trailing \b on comments/reposts/follows: the DOM concatenates text nodes
  // without whitespace, so the verb runs straight into the author's name
  // ("commentedMikey Taylor").
  { key: 'comments',  label: 'Comment spillover',   hint: '"Jane Doe commented"',          reasonLabel: 'Comment spillover',  pattern: /\bcommented|\breplied/,                                      enabled: false, section: 'spillover' },
  { key: 'follows',   label: 'Follow spillover',    hint: '"Jane Doe follows Acme Corp"',  reasonLabel: 'Follow spillover',   pattern: /\bfollows/,                                                  enabled: false, section: 'spillover' },
  { key: 'reposts',   label: 'Reposts',             hint: '"Jane Doe reposted this"',      reasonLabel: 'Repost',             pattern: /\breposted/,                                                 enabled: false, section: 'reposts' },
  { key: 'figleaf',   label: 'Fig-leaf reposts',    hint: '"Couldn’t agree more" + repost', reasonLabel: 'Fig-leaf repost',   pattern: null,                                                         enabled: true,  section: 'reposts' },
  { key: 'slop',      label: 'Slop chips',          hint: 'Verdict chips with offense receipts', reasonLabel: 'Likely slop', pattern: null,                                     enabled: true,  mode: 'badge', section: 'slop' },
  // mode: 'slophide' rows (spec R10) hide posts wearing the matching chip
  // instead of matching the surfacing header. The popup groups them under a
  // "Hide chipped posts" subheading, so labels are bare chip names. Judge-
  // minted chips (promotion, certified) land asynchronously, so those posts
  // collapse — or a judge clear un-collapses them — after render. Opt-in,
  // hence default off.
  { key: 'broetry',   label: 'Broetry',             hint: null,                                          reasonLabel: 'Broetry',           pattern: null,                                   enabled: false, mode: 'slophide', section: 'slop' },
  { key: 'bait',      label: 'Engagement bait',     hint: null,                                          reasonLabel: 'Engagement bait',   pattern: null,                                   enabled: false, mode: 'slophide', section: 'slop' },
  { key: 'ad',        label: 'Ad spam',             hint: null,                                          reasonLabel: 'Ad spam',           pattern: null,                                   enabled: false, mode: 'slophide', section: 'slop' },
  { key: 'promotion', label: 'Undisclosed promo',   hint: 'Judge verdict, lands after render', reasonLabel: 'Undisclosed promo', pattern: null,                                   enabled: false, mode: 'slophide', section: 'slop' },
  { key: 'certified', label: 'Certified slop',      hint: 'Judge verdict, lands after render', reasonLabel: 'Certified slop',    pattern: null,                                   enabled: false, mode: 'slophide', section: 'slop' },
];

const DP_DEFAULTS = Object.fromEntries(DP_FILTERS.map((f) => [f.key, f.enabled]));

// Fig-leaf commentary: a generic reaction pasted on a repost — agreement
// without perspective. Anchored against normalized text so "This." convicts
// and "This is why X fails" walks; the one non-anchored idiom ("couldn't
// agree more") survives a leading "💯 <name>" prefix. Deliberately
// precision-first: a missed fig leaf costs feed space, a false hide costs
// the user a click on the placeholder.
const DP_FIGLEAF_MAX_WORDS = 15;
// An adversative after the agreement ("Agree, but the third point misses…")
// signals actual perspective, so those walk.
const DP_FIGLEAF_ADVERSATIVE = /\b(?:but|however|though|although|except|unless)\b/i;
const DP_FIGLEAF_PATTERN =
  /^(?:(?:yes|yep|yup) )?(?:i |we )?(?:whole ?heartedly |completely |fully |totally |absolutely |couldn ?t |could not )?agree\b|^(?:so true|well said|spot on|exactly(?: this)?$|absolutely$|amen|this$|100$|love this|great (?:post|take|point|share|advice)|nailed it|facts$|preach$|no notes$)|\bcouldn ?t agree more\b|\bcould not agree more\b/i;

function isFigleafCommentary(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words || words > DP_FIGLEAF_MAX_WORDS) return false;
  // NFKC folds pseudo-bold math alphanumerics to ASCII so "𝗔𝗴𝗿𝗲𝗲" can't
  // sneak past the lexicon in a costume.
  const norm = text.normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (norm === '') return true;
  return DP_FIGLEAF_PATTERN.test(norm) && !DP_FIGLEAF_ADVERSATIVE.test(norm);
}

if (typeof module !== 'undefined') {
  module.exports = { DP_SECTIONS, DP_FILTERS, DP_DEFAULTS, isFigleafCommentary };
}
