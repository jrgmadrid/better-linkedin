// Plain-node test for the fig-leaf commentary lexicon (filters.js). The DOM
// half of the detector (two-Visibility embed signature) is exercised by the
// harvest replay, not here. Run with `node test/figleaf.test.js`.

const { DP_FILTERS, isFigleafCommentary } = require('../filters.js');

let failures = 0;
function check(name, cond) {
  if (cond) return console.log(`  ok  ${name}`);
  failures += 1;
  console.error(`FAIL  ${name}`);
}

console.log('fig leaves (convict):');
check('wholehearted agreement', isFigleafCommentary('I wholeheartedly agree. Same rules for everyone. 👏🏼👏🏼👏🏼'));
check('couldn’t agree more', isFigleafCommentary('Couldn’t agree more with this take.'));
check('emoji + name prefix', isFigleafCommentary('💯 David I couldn’t agree more'));
check('amen', isFigleafCommentary('Amen to this. Academia is so overrated.'));
check('shouted agreement', isFigleafCommentary('AGREE !! Nothing worst then a "leader" sending you this.'));
check('bare this', isFigleafCommentary('THIS 👇'));
check('emoji only', isFigleafCommentary('👏👏🔥'));
check('agree with name', isFigleafCommentary('Agree with Joan! (Of course) 🇨🇦'));
check('great post', isFigleafCommentary('Great post!'));
check('so true', isFigleafCommentary('So true, Priya.'));
check('pseudo-bold costume unmasked', isFigleafCommentary('𝗖𝗼𝘂𝗹𝗱𝗻\'𝘁 𝗮𝗴𝗿𝗲𝗲 𝗺𝗼𝗿𝗲!'));

console.log('perspective (walk):');
check('this + actual sentence', !isFigleafCommentary('This is the thought process of the Liberal / Socialist!!!!!!'));
check('agreement + adversative', !isFigleafCommentary('Agree, but the third point misses how procurement actually works.'));
check('couldn’t agree more + but', !isFigleafCommentary('Couldn’t agree more, but watch the rollout timing on this one.'));
check('anchored absolutely only', !isFigleafCommentary('Absolutely the wrong lesson to take from this launch.'));
check('over the word cap', !isFigleafCommentary('I agree fully with the premise here and yet the middle section keeps skipping over the deployment story entirely.'));
check('substantive short take', !isFigleafCommentary('This changed how we run standups.'));
check('empty commentary is bare-repost turf', !isFigleafCommentary(''));
check('unrelated one-liner', !isFigleafCommentary('Interesting dataset.'));

// ---- spillover header patterns: singular AND plural actors match ----------

console.log('header patterns:');
const pat = (key) => DP_FILTERS.find((f) => f.key === key).pattern;
check('reactions: one actor', pat('reactions').test('Saad Malik likes this'));
check('reactions: two actors', pat('reactions').test('Colin Perepelken and William Katae like this'));
check('reactions: plural celebrate', pat('reactions').test('Ana Silva and 3 others celebrate this'));
check('reactions: no body-text reach', !pat('reactions').test('Josh Andrews'));
check('follows: one actor', pat('follows').test('Jane Doe follows Acme Corp'));
check('follows: two actors', pat('follows').test('Jane Doe and Joe Bloggs follow Acme Corp'));
check('follows: verb runs into the next node', pat('follows').test('Jane Doe followsAcme Corp'));
check('follows: "follower" never matches', !pat('follows').test('Acme Corp follower spotlight'));

console.log(failures ? `\n${failures} failure(s)` : '\nall green');
process.exit(failures ? 1 : 0);
