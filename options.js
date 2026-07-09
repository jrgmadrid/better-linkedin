const apiKey = document.getElementById('apiKey');
const apiBase = document.getElementById('apiBase');
const model = document.getElementById('model');
const status = document.getElementById('status');

chrome.storage.local.get(DP_JUDGE_CFG, ({ [DP_JUDGE_CFG]: c }) => {
  if (!c) return;
  apiKey.value = c.apiKey || '';
  apiBase.value = c.apiBase || '';
  model.value = c.model || '';
});

document.getElementById('save').addEventListener('click', () => {
  const key = apiKey.value.trim();
  if (!key) {
    chrome.storage.local.remove(DP_JUDGE_CFG);
    status.textContent = 'Key cleared — file fallback applies, if present.';
    return;
  }
  chrome.storage.local.set({
    [DP_JUDGE_CFG]: {
      apiKey: key,
      apiBase: apiBase.value.trim(),
      model: model.value.trim(),
    },
  });
  status.textContent = 'Saved.';
});

// One real judge call on a canned slop snippet — fail-open hides broken
// keys everywhere else, so this is the only place errors get to speak.
document.getElementById('test').addEventListener('click', async () => {
  status.textContent = 'Judging a test post…';
  try {
    const res = await chrome.runtime.sendMessage({ type: DP_JUDGE_TEST });
    status.textContent = res.ok
      ? `Working — the judge scored the test post ${res.score}/100.`
      : `Failed: ${res.error}`;
  } catch {
    status.textContent = 'Failed: no response from the worker.';
  }
});
