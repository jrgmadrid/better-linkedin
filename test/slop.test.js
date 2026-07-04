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
check('notbut -', hit('notbut', 'The refactor was not what we planned but it worked out.') === null);
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
