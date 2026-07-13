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

function buildRow(f, cls) {
  const li = document.createElement('li');
  li.className = cls;
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

// The popup is a two-level checkbox tree: a group of two or more rows gets
// a parent row whose checkbox toggles the whole group (indeterminate when
// mixed), children indent beneath it. A group of one is just a row at
// parent level — its own toggle already is the group toggle.
function buildParentToggle(title, rows) {
  const li = document.createElement('li');
  li.className = 'parent';
  const lbl = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.groupKeys = rows.map((f) => f.key).join(' ');
  lbl.append(box, document.createTextNode(title));
  li.appendChild(lbl);
  return li;
}

const main = document.getElementById('sections');
for (const g of GROUPS) {
  const ul = document.createElement('ul');
  ul.className = 'group';
  if (g.rows.length >= 2) {
    ul.appendChild(buildParentToggle(g.title, g.rows));
    for (const f of g.rows) ul.appendChild(buildRow(f, 'child'));
  } else {
    for (const f of g.rows) ul.appendChild(buildRow(f, 'parent'));
  }
  if (g.sub) {
    ul.appendChild(buildParentToggle(g.sub.title, g.sub.rows));
    for (const f of g.sub.rows) ul.appendChild(buildRow(f, 'child'));
  }
  main.appendChild(ul);
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

// The worker's onInstalled listener refreshes LinkedIn tabs once the new
// version boots, so this one call is the whole dev loop.
document.getElementById('reload').addEventListener('click', () => {
  chrome.runtime.reload();
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
