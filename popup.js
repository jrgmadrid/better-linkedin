// Sections come from the registry (DP_SECTIONS + each row's section key),
// so a new filter row lands in the right group without touching this file.
// Within a section, slophide rows render as the "Hide chipped posts"
// subgroup; everything else is a plain row.
const GROUPS = DP_SECTIONS.map((s) => {
  const rows = DP_FILTERS.filter((f) => f.section === s.key);
  const chipHides = rows.filter((f) => f.mode === 'slophide');
  return {
    title: s.title,
    rows: rows.filter((f) => f.mode !== 'slophide'),
    sub: chipHides.length ? { title: 'Hide chipped posts', rows: chipHides } : null,
  };
});

function buildRow(f) {
  const li = document.createElement('li');
  const lbl = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.filter = f.key;
  const span = document.createElement('span');
  span.textContent = f.label;
  if (f.hint) {
    const small = document.createElement('small');
    small.textContent = f.hint;
    span.appendChild(small);
  }
  lbl.append(input, span);
  li.appendChild(lbl);
  return li;
}

// Groups of two or more rows get a header checkbox that toggles the whole
// group; indeterminate shows a mixed state. A group of one would just be
// the row's own toggle wearing a hat, so it gets a plain heading.
function buildHeading(tag, title, rows) {
  const h = document.createElement(tag);
  if (rows.length < 2) {
    h.textContent = title;
    return h;
  }
  const lbl = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.groupKeys = rows.map((f) => f.key).join(' ');
  lbl.append(box, document.createTextNode(title));
  h.appendChild(lbl);
  return h;
}

const main = document.getElementById('sections');
for (const g of GROUPS) {
  const section = document.createElement('section');
  const ul = document.createElement('ul');
  for (const f of g.rows) ul.appendChild(buildRow(f));
  section.append(buildHeading('h2', g.title, g.rows), ul);
  if (g.sub) {
    const subUl = document.createElement('ul');
    subUl.className = 'sub';
    for (const f of g.sub.rows) subUl.appendChild(buildRow(f));
    section.append(buildHeading('h3', g.sub.title, g.sub.rows), subUl);
  }
  main.appendChild(section);
}

const checkboxes = document.querySelectorAll('input[data-filter]');
const rowBox = (key) => document.querySelector(`input[data-filter="${key}"]`);

function syncGroupBoxes() {
  for (const box of document.querySelectorAll('input[data-group-keys]')) {
    const kids = box.dataset.groupKeys.split(' ').map(rowBox);
    const on = kids.filter((k) => k.checked).length;
    box.checked = on === kids.length;
    box.indeterminate = on > 0 && on < kids.length;
  }
}

chrome.storage.sync.get(DP_DEFAULTS, (filters) => {
  for (const box of checkboxes) {
    box.checked = filters[box.dataset.filter];
  }
  syncGroupBoxes();
});

for (const box of checkboxes) {
  box.addEventListener('change', () => {
    chrome.storage.sync.set({ [box.dataset.filter]: box.checked });
    syncGroupBoxes();
  });
}

for (const box of document.querySelectorAll('input[data-group-keys]')) {
  box.addEventListener('change', () => {
    const updates = {};
    for (const key of box.dataset.groupKeys.split(' ')) {
      rowBox(key).checked = box.checked;
      updates[key] = box.checked;
    }
    chrome.storage.sync.set(updates);
    syncGroupBoxes();
  });
}

const status = document.getElementById('harvest-status');

// The worker's onInstalled listener refreshes LinkedIn tabs once the new
// version boots, so this one call is the whole dev loop.
document.getElementById('reload').addEventListener('click', () => {
  chrome.runtime.reload();
});

document.getElementById('judge-cfg').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('harvest').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, DP_HARVEST_MSG);
    status.textContent = `${res.count} posts exported`;
  } catch {
    status.textContent = 'Open a LinkedIn feed tab first';
  }
});
