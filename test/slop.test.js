// Plain-node test for the slop scorer: per-signal cases plus a calibration
// run over the labeled eval set (specs/001-slop-badge/eval/). No framework —
// run with `node test/slop.test.js`; exits non-zero on any failure.

const fs = require('fs');
const path = require('path');
const { SLOP_SIGNALS, SLOP_FAMILIES, SLOP_FAMILY_THRESHOLD, scoreSlop } = require('../slop.js');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) return console.log(`  ok  ${name}`);
  failures += 1;
  console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
}

const signal = (key) => SLOP_SIGNALS.find((s) => s.key === key);
const ctxFor = (text) => ({
  lines: text.split('\n').map((l) => l.trim()).filter(Boolean),
  words: text.split(/\s+/).filter(Boolean).length,
  raw: text,
});
const hit = (key, text) => signal(key).detect(text, ctxFor(text));

// ---- per-signal: one positive, one negative -------------------------------

const BROETRY = Array(8).fill('Short punchy line about success.').join('\n\n');
const PROSE = 'A single flowing paragraph that keeps going with normal clause structure, subordinate thoughts, and no dramatic pauses, the way people write when they are explaining something rather than performing it, which is most of the time.';

console.log('signals:');
check('broetry +', hit('broetry', BROETRY) !== null);
check('broetry -', hit('broetry', PROSE) === null);

check('notbut +', hit('notbut', "It's not about the money, it's about the mission.") !== null);
check('notbut past +', hit('notbut', "The biggest AI deal this week wasn't about AI. It was about plumbing.") !== null);
check('notbut noun subject +', hit('notbut', 'Project management is not task management. It is tension management.') !== null);
check('notbut -', hit('notbut', 'The refactor was not what we planned but it worked out.') === null);
check('notbut noun subject -', hit('notbut', 'The fix is not complete yet but the tests already pass locally.') === null);
check('notbut past -', hit('notbut', "The outage wasn't about capacity. It turned out the failover config had drifted.") === null);

const BULLETS = '✅ First thing\n✅ Second thing\n🚀 Third thing\nplus a normal line';
check('emojibullets +', hit('emojibullets', BULLETS) !== null);
check('emojibullets -', hit('emojibullets', '✅ One bullet alone\nthen prose\nmore prose') === null);

check('baitcloser +', hit('baitcloser', PROSE + '\n\nAgree? Repost if this resonated.') !== null);
check('baitcloser -', hit('baitcloser', PROSE) === null);
check('baitcloser hard > soft',
  hit('baitcloser', PROSE + '\n\nRepost if this resonated. ♻️').points >
  hit('baitcloser', PROSE + '\n\nThoughts?').points);

const DASHY = 'Growth — real growth — is painful — and that pain — that exact pain — is the point — always.';
check('emdash +', hit('emdash', DASHY) !== null);
check('emdash -', hit('emdash', 'We measured latency — p99 dropped from 900ms to 210ms after the index change, mostly from skipping the sort.') === null);

check('buzzwords +', hit('buzzwords', 'This is a game-changer for your personal brand. Read that again.') !== null);
check('buzzwords -', hit('buzzwords', 'We changed the game loop timing and rebranded the settings panel.') === null);

check('shouting +', hit('shouting', 'PROMOTIONAL PRODUCTS for your TRADE SHOWS and GOLF TOURNAMENTS — QUALITY GUARANTEED for every order.') !== null);
check('shouting -', hit('shouting', 'The JSON API returns HTTP 200 with a YAML payload when the CDN cache is warm, which surprised nobody on the team.') === null);

check('linkpile +', hit('linkpile', 'Check these out: https://lnkd.in/abc and https://lnkd.in/def plus www.example.com') !== null);
check('linkpile -', hit('linkpile', 'Full write-up here: https://blog.example.com/post') === null);

check('contactblock +', hit('contactblock', 'Great deals this month. Tel: (514) 695-9001 for a quote.') !== null);
check('contactblock -', hit('contactblock', 'We shipped 514 units in Q3, up 9001 from the 695 baseline in 2026.') === null);

check('commandbait say +', hit('commandbait', 'If you agree, say AMEN 🙏 Stay faithful.') !== null);
check('commandbait vote +', hit('commandbait', 'AGREE ❤️ or DISAGREE 💔? Drop your take below.') !== null);
check('commandbait emoji +', hit('commandbait', 'THIS 👇 👍/ 🔄 if you agree.') !== null);
check('commandbait -', hit('commandbait', 'Readers will agree or disagree with the framework, and that is healthy.') === null);

check('reachhack link +', hit('reachhack', 'Full breakdown is free. Link in the first comment!') !== null);
check('reachhack article +', hit('reachhack', 'How much should you be spending on AI? Article in comments...') !== null);
check('reachhack noun wardrobe +', hit('reachhack', 'Full guide in the pinned comments for anyone who wants it.') !== null);
check('reachhack dm +', hit('reachhack', 'DM me for the link and I will send it right over.') !== null);
check('reachhack dm noun +', hit('reachhack', 'DM me for the template and I will send it over.') !== null);
check('reachhack code +', hit('reachhack', 'Use code LAUNCH20 at checkout this week only.') !== null);
check('reachhack -', hit('reachhack', 'I linked the docs in a comment yesterday; the code uses standard retries.') === null);

const STYLED = '𝗗𝗼𝗻\'𝘁 𝘁𝗿𝘆 𝘁𝗼 𝘀𝗼𝘂𝗻𝗱 𝗶𝗺𝗽𝗿𝗲𝘀𝘀𝗶𝘃𝗲. 𝗕𝗲 𝗿𝗲𝗮𝗹, 𝘀𝗵𝗼𝘄 𝘆𝗼𝘂𝗿 𝘄𝗼𝗿𝗸, 𝗮𝗻𝗱 𝗹𝗲𝘁 𝘆𝗼𝘂𝗿 𝗽𝗿𝗼𝗷𝗲𝗰𝘁𝘀 𝘀𝗽𝗲𝗮𝗸 𝗳𝗼𝗿 𝘆𝗼𝘂.';
check('fakebold +', hit('fakebold', STYLED) !== null);
check('fakebold escalates on styled sentences', hit('fakebold', STYLED).points === 25);
check('fakebold spares actual math', hit('fakebold', 'Let 𝑥 and 𝑦 be variables where 𝑥 + 𝑦 = 10 and 𝑥 > 0.') === null);
check('fakebold -', hit('fakebold', PROSE) === null);

check('rhetq +', hit('rhetq', 'Why? Because. Why not? Who knows? It works.') !== null);
check('rhetq -', hit('rhetq', 'Anyone know a good fix for this? Happy to share details.') === null);

check('hashtags +', hit('hashtags', 'text #one #two #three #four') !== null);
check('hashtags -', hit('hashtags', 'text #one #two #three') === null);
check('hashtags escalate',
  hit('hashtags', 'text #a #b #c #d #e #f #g').points >
  hit('hashtags', 'text #a #b #c #d').points);

// ---- scoreSlop shape ------------------------------------------------------

console.log('scoreSlop:');
const short = scoreSlop('Too short to judge.');
check('short posts score 0', short.score === 0 && short.offenses.length === 0);
const scored = scoreSlop(BROETRY + "\n\nIt's not about luck, it's about grit.\n\nAgree?");
check('offenses sorted by weight', scored.offenses.length >= 2);
check('score clamped to 100', scoreSlop(Array(30).fill('✅ Win — daily — always. Agree? #a #b #c #d').join('\n')).score <= 100);

// ---- families (chips) -----------------------------------------------------

console.log('families:');
check('every signal maps to a declared family', SLOP_SIGNALS.every(
  (s) => SLOP_FAMILIES.some((f) => f.key === s.family)));

const famKeys = (text) => scoreSlop(text).families.map((f) => f.key);

check('broetry fires alone', JSON.stringify(famKeys(BROETRY)) === '["broetry"]');
check('ad family fires on ad spam', famKeys(
  'PROMOTIONAL PRODUCTS for TRADE SHOWS and GOLF TOURNAMENTS — QUALITY GUARANTEED every time. '
  + 'Call today for a written quote from our sales office in Montreal. Tel: (514) 695-9001. '
  + 'https://lnkd.in/abc https://lnkd.in/def',
).includes('ad'));
check('below-threshold family stays quiet', !famKeys(
  PROSE + ' More context here: https://blog.example.com/a and https://blog.example.com/b',
).includes('ad'));
check('multi-family post fires multiple chips', famKeys(
  BROETRY + "\n\nIt's not about luck, it's about grit.\n\nRepost if this resonated. ♻️\n#a #b #c #d #e #f",
).length >= 2);
check('clean prose fires nothing', famKeys(PROSE).length === 0);
check('family offenses carry receipts', scoreSlop(BROETRY).families[0].offenses[0].detail.length > 0);

// ---- promotion (spec R9): suspicion widens the trigger, only the judge
// ---- convicts --------------------------------------------------------------

console.log('promo (R9):');
check('promotion family is declared', SLOP_FAMILIES.some((f) => f.key === 'promotion'));
check('no heuristic signal maps to promotion', SLOP_SIGNALS.every((s) => s.family !== 'promotion'));

const PROMO = PROSE + ' Register now to save your seat, this free webinar covers all of it.';
check('promo markers set promoSuspect', scoreSlop(PROMO).promoSuspect === true);
check('markers alone score nothing', scoreSlop(PROMO).score === 0);
check('clean prose is not promo-suspect', scoreSlop(PROSE).promoSuspect === false);
check('short posts are never promo-suspect', scoreSlop('Register now!').promoSuspect === false);

const HIRING = 'We are hiring two senior backend engineers for our payments team in Vancouver. '
  + 'Hybrid, base range posted in the listing. If the work sounds interesting, apply '
  + 'through the careers page or reach out directly and I will route you.';
check('hiring posts are not promo-suspect', scoreSlop(HIRING).promoSuspect === false);

// Widened 2026-07-06 (decision: maintainer, stricter): free-value funnels with an
// intervening noun, scarcity counts, and DM-availability all earn a hearing.
const FUNNEL = 'Update on free resume reviews. I have three remaining spots open this week. '
  + 'Having trouble securing interviews? The number one reason is your resume. '
  + 'My DMs are open, they are always open.';
check('free-noun funnel is promo-suspect', scoreSlop(FUNNEL).promoSuspect === true);
check('DM-availability is promo-suspect', scoreSlop(PROSE + ' My DMs are always open.').promoSuspect === true);
check('scarcity count is promo-suspect', scoreSlop(PROSE + ' Only three spots left for this cohort.').promoSuspect === true);

check('reach hack alone fires the bait chip',
  famKeys(PROSE + ' Link in the first comment.').includes('bait'));

// ---- word floor (amended 2026-07-03): mechanics pierce it, rhythm doesn't --

console.log('word floor:');
check('bait mechanics pierce the floor',
  famKeys('If you agree, say AMEN 🙏 Stay faithful.').includes('bait'));
check('sub-floor soft closer escalates to a chip',
  famKeys('AI is just a machine. Agree?').includes('bait'));
check('short reach hack chips',
  famKeys('Use code LUX20 at checkout today!').includes('bait'));
check('earnest short agreement stays clean',
  famKeys("Couldn't agree more with this take.").length === 0);
check('above-floor soft closer stays at 12 pts',
  !famKeys(PROSE + ' Thoughts?').includes('bait'));
check('rhythm signals still floored',
  famKeys('Win.\n\nGrind.\n\nRepeat.\n\nEvery day.\n\nNo excuses.\n\nStay hungry.').length === 0);

// ---- NFKC unmasking: styled text can't hide from the lexicons -------------

console.log('unicode costume:');
check('styled sentence chips as bait through the floor', famKeys(STYLED).includes('bait'));
check('NFKC unmasks buzzwords under pseudo-bold',
  scoreSlop(PROSE + ' This is a 𝗴𝗮𝗺𝗲-𝗰𝗵𝗮𝗻𝗴𝗲𝗿 for your 𝗽𝗲𝗿𝘀𝗼𝗻𝗮𝗹 𝗯𝗿𝗮𝗻𝗱. Read that again.')
    .offenses.some((o) => o.label === 'Buzzword lexicon'));

// ---- registry (spec R10): slop-hide rows ↔ chips stay in lockstep ---------

console.log('registry:');
const { DP_FILTERS, DP_SECTIONS } = require('../filters.js');
const sectionKeys = new Set(DP_SECTIONS.map((s) => s.key));
check('every filter row belongs to a declared section',
  DP_FILTERS.every((f) => sectionKeys.has(f.section)));
check('no declared section is empty',
  DP_SECTIONS.every((s) => DP_FILTERS.some((f) => f.section === s.key)));
const chipKeys = new Set([...SLOP_FAMILIES.map((f) => f.key), 'certified']);
const slopHideRows = DP_FILTERS.filter((f) => f.mode === 'slophide');
check('every slop-hide row targets a real chip', slopHideRows.every((f) => chipKeys.has(f.key)));
check('every chip has a slop-hide row', [...chipKeys].every((k) => slopHideRows.some((f) => f.key === k)));
check('slop-hide rows default off', slopHideRows.every((f) => f.enabled === false));

// ---- eval-set calibration (T4 fixtures) -----------------------------------

const EVAL_DIR = path.join(__dirname, '..', 'specs', '001-slop-badge', 'eval');
const readSet = (f) => {
  const p = path.join(EVAL_DIR, f);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split(/^---$/m)
    .map((s) => s.replace(/^\s*# heuristic:.*$/m, '').trim())
    .filter(Boolean);
};

const slopSet = readSet('slop.txt');
const cleanSet = readSet('clean.txt');

if (!slopSet || !cleanSet) {
  console.log('eval: SKIP — fixtures missing (close T4: eval/slop.txt + eval/clean.txt)');
} else {
  console.log(`eval: ${slopSet.length} slop / ${cleanSet.length} clean`);
  const falseLikely = cleanSet.filter((t) => scoreSlop(t).score >= 70);
  const caught = slopSet.filter((t) => scoreSlop(t).score >= 40);
  check('zero clean posts score >= 70', falseLikely.length === 0,
    `${falseLikely.length} false positives`);
  check('>= 80% of slop posts score >= 40', caught.length / slopSet.length >= 0.8,
    `${caught.length}/${slopSet.length}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall green');
process.exit(failures ? 1 : 0);
