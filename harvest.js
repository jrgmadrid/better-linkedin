// Temporary debug harvester, v3: targeted at LinkedIn's new frontend
// (hashed classes, componentkey/data-testid hooks). Dumps per-post structure
// from div[role=listitem] feed items. Triggered from the popup; remove once
// detection signals are locked.

function harvestListItem(li) {
  const clean = (text) => text.trim().replace(/\s+/g, ' ');

  let promotedLeaf = null;
  for (const el of li.querySelectorAll('p, span')) {
    if (el.childElementCount === 0 && /^(Promoted|Sponsored)$/.test(el.textContent.trim())) {
      promotedLeaf = el.textContent.trim();
      break;
    }
  }

  // Full commentary text for slop-scorer calibration (specs/001). innerText,
  // not textContent: broetry detection needs the visual line breaks — but
  // innerText degrades to textContent on non-rendered elements, and most
  // posts carry a hidden expandable-text-box twin. Prefer a rendered one,
  // and dump structure diagnostics to pin down the paragraph markup.
  const bodyEls = [...li.querySelectorAll('[data-testid="expandable-text-box"]')];
  const bodyEl = bodyEls.find((el) => el.offsetParent !== null) || bodyEls[0] || null;

  return {
    componentkey: li.getAttribute('componentkey'),
    headText: clean(li.textContent).slice(0, 260),
    body: bodyEl ? bodyEl.innerText.trim().slice(0, 6000) : null,
    bodyRendered: bodyEl ? bodyEl.offsetParent !== null : null,
    bodyHtml: bodyEl ? bodyEl.innerHTML.slice(0, 1500) : null,
    promoted: promotedLeaf,
    testids: [...li.querySelectorAll('[data-testid]')]
      .slice(0, 40)
      .map((el) => el.getAttribute('data-testid')),
    componentkeys: [...li.querySelectorAll('[componentkey]')]
      .slice(0, 50)
      .map((el) => el.getAttribute('componentkey').slice(0, 100)),
    ariaLabels: [...li.querySelectorAll('[aria-label]')]
      .slice(0, 15)
      .map((el) => el.getAttribute('aria-label').slice(0, 100)),
  };
}

function testidCensus() {
  const counts = {};
  for (const el of document.querySelectorAll('[data-testid]')) {
    const id = el.getAttribute('data-testid');
    counts[id] = (counts[id] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 80)
  );
}

// Rail widgets (LinkedIn News, games) aren't feed posts — find their heading
// text and walk up the ancestor chain to reveal the widget container.
const WIDGET_HEADING = /^(LinkedIn News|Today['’]s (?:puzzles|games)|Games|Puzzles)$/i;

function dpChainUp(el, depth = 10) {
  const chain = [];
  let node = el;
  while (node && node !== document.body && chain.length < depth) {
    chain.push({
      tag: node.tagName.toLowerCase(),
      attrs: Object.fromEntries([...node.attributes].map((a) => [a.name, a.value.slice(0, 160)])),
      childCount: node.childElementCount,
    });
    node = node.parentElement;
  }
  return chain;
}

function dpWidgetChains() {
  const hits = [];
  for (const el of document.querySelectorAll('h1, h2, h3, h4, span, p, div, a')) {
    if (el.childElementCount === 0 && WIDGET_HEADING.test(el.textContent.trim())) {
      hits.push({ text: el.textContent.trim(), chain: dpChainUp(el) });
      if (hits.length >= 8) break;
    }
  }
  return hits;
}

function dpHarvest() {
  const items = [...document.querySelectorAll('div[role="listitem"]')];
  const payload = {
    url: location.href,
    collectedAt: new Date().toISOString(),
    listItemCount: items.length,
    testidCensus: testidCensus(),
    widgetChains: dpWidgetChains(),
    posts: items.map(harvestListItem),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'li-feed-markers-v6.json';
  link.click();
  URL.revokeObjectURL(link.href);

  return items.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg !== DP_HARVEST_MSG) return;
  sendResponse({ count: dpHarvest() });
});
