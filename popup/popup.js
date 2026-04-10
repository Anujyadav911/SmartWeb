// ═══════════════════════════════════════════════════════════════════
// SmartWeb Form Assistant — Popup Controller (Production)
//
// Features:
//  - Editable suggestion fields (user can modify before applying)
//  - Tier filter tabs (All / HIGH / MEDIUM / LOW)
//  - Category-grouped field cards
//  - Per-card apply (uses live textarea/input value)
//  - Apply All High-Confidence shortcut
//  - DOM-change notice + re-scan
//  - Hover → highlight field on page
//  - Confidence tier badges (HIGH / MEDIUM / LOW)
//  - Toast notifications
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── State ─────────────────────────────────────────────────────────
let _fields      = [];          // full field list from last scan
let _skipped     = new Set();   // skipped field IDs
let _activeTab   = 'all';       // current tier filter
let _tabId       = null;        // active Chrome tab ID

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const views = {
  initial: $('view-initial'),
  loading: $('view-loading'),
  results: $('view-results'),
  error:   $('view-error'),
  empty:   $('view-empty'),
};
const footer      = $('footer');
const fieldList   = $('field-list');
const statTotal   = $('stat-total');
const statCats    = $('stat-cats');
const loaderMsg   = $('loader-msg');
const domBanner   = $('dom-banner');
const toast       = $('toast');

// ── View switch ───────────────────────────────────────────────────
function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    el.style.display = k === name ? (name === 'results' ? 'block' : 'flex') : 'none';
  }
  footer.style.display = (name === 'results' && _fields.length > 0) ? 'block' : 'none';
}

// ── Toast ─────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, ms = 2400) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

// ── Chrome helpers ────────────────────────────────────────────────
async function getTab() {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  return tab;
}

async function msg(message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(_tabId, message, res => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

// Inject content script if not already running
async function ensureScript(tab) {
  const pong = await msg({ action:'ping' });
  if (pong?.status === 'ready') return true;
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['content.js'] });
    await new Promise(r => setTimeout(r, 350));
    return true;
  } catch { return false; }
}

// ── SCAN ──────────────────────────────────────────────────────────
async function doScan() {
  _skipped.clear();
  domBanner.style.display = 'none';
  showView('loading');
  loaderMsg.textContent = 'Detecting form fields…';

  try {
    const tab = await getTab();
    _tabId = tab.id;

    if (!tab?.url || /^chrome(|-extension):/.test(tab.url)) {
      $('error-msg').textContent = 'SmartWeb cannot run on Chrome internal pages. Navigate to a regular website.';
      showView('error');
      return;
    }

    const ok = await ensureScript(tab);
    if (!ok) {
      $('error-msg').textContent = 'Could not inject the content script. Try refreshing the page.';
      showView('error');
      return;
    }

    loaderMsg.textContent = 'Classifying fields with AI heuristics…';
    const res = await msg({ action:'scan' });

    if (!res?.fields) {
      $('error-msg').textContent = 'No response from content script. Please refresh the page and try again.';
      showView('error');
      return;
    }

    _fields = res.fields;
    if (!_fields.length) { showView('empty'); return; }

    renderResults();
    showView('results');

  } catch (err) {
    $('error-msg').textContent = err.message || 'Unexpected error. Please try again.';
    showView('error');
  }
}

// ── RENDER: Stats row ─────────────────────────────────────────────
function renderStats() {
  statTotal.textContent = _fields.length;

  const counts = {};
  for (const f of _fields) {
    const key = normCat(f.category);
    counts[key] = (counts[key] || 0) + 1;
  }

  const chips = [
    { key:'personal',     label:'Personal',     icon:'👤' },
    { key:'professional', label:'Professional', icon:'💼' },
    { key:'open',         label:'Open-ended',   icon:'✍️' },
    { key:'unknown',      label:'Unknown',      icon:'❓' },
  ];

  statCats.innerHTML = chips
    .filter(c => counts[c.key] > 0)
    .map(c =>
      `<span class="cat-chip ${c.key}" title="${c.label}">${c.icon} ${counts[c.key]}</span>`
    ).join('');
}

// ── RENDER: Group headers ─────────────────────────────────────────
const CAT_ORDER = [
  'Personal Information',
  'Professional Information',
  'Open-ended',
  'Unknown',
];

const CAT_META = {
  'Personal Information':   { icon:'👤', cls:'personal',     tagCls:'personal' },
  'Professional Information':{ icon:'💼', cls:'professional', tagCls:'professional' },
  'Open-ended':             { icon:'✍️', cls:'open',         tagCls:'open-ended' },
  'Unknown':                { icon:'❓', cls:'unknown',      tagCls:'unknown' },
};

function normCat(cat) {
  if (cat === 'Personal Information') return 'personal';
  if (cat === 'Professional Information') return 'professional';
  if (cat === 'Open-ended') return 'open';
  return 'unknown';
}

function typeLabel(type, tag) {
  if (tag === 'select')   return 'SELECT';
  if (tag === 'textarea') return 'TEXTAREA';
  return (type || 'TEXT').toUpperCase();
}

// ── RENDER: Full results ──────────────────────────────────────────
function renderResults() {
  renderStats();
  renderFieldCards();
  applyTierFilter(_activeTab);
}

function renderFieldCards() {
  fieldList.innerHTML = '';

  // Group fields by category in defined order
  const groups = {};
  for (const f of _fields) {
    const key = f.category || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  // Render groups in order
  const orderedKeys = [
    ...CAT_ORDER.filter(k => groups[k]),
    ...Object.keys(groups).filter(k => !CAT_ORDER.includes(k)),
  ];

  orderedKeys.forEach((cat, gi) => {
    const meta  = CAT_META[cat] || CAT_META['Unknown'];
    const cards = groups[cat];

    // Group header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.dataset.groupCat = normCat(cat);
    header.innerHTML = `
      <span>${meta.icon} ${cat}</span>
      <div class="group-header-line"></div>
      <span style="font-variant-numeric:tabular-nums;color:var(--t3)">${cards.length}</span>`;
    fieldList.appendChild(header);

    // Cards
    cards.forEach((field, idx) => {
      fieldList.appendChild(buildCard(field, gi * 10 + idx));
    });
  });
}

// ── BUILD a single field card ─────────────────────────────────────
function buildCard(field, idx) {
  const meta    = CAT_META[field.category] || CAT_META['Unknown'];
  const confPct = Math.round(field.confidence * 100);
  const isLong  = field.category === 'Open-ended' || field.tag === 'textarea';
  const hasSug  = !!(field.suggestion && field.suggestion.trim());

  const card = document.createElement('div');
  card.className   = 'field-card';
  card.id          = `card-${field.id}`;
  card.dataset.fieldId  = field.id;
  card.dataset.tier     = field.tier;
  card.dataset.category = normCat(field.category);
  card.style.animationDelay = `${idx * 0.03}s`;

  // Build suggest input — textarea for long fields, input for short
  const suggestEl = isLong
    ? `<textarea class="suggest-field${hasSug ? '' : ' no-suggest'}"
          id="sug-${field.id}"
          rows="3"
          placeholder="No suggestion available"
        >${esc(field.suggestion || '')}</textarea>`
    : `<input class="suggest-field${hasSug ? '' : ' no-suggest'}"
         type="text"
         id="sug-${field.id}"
         value="${escAttr(field.suggestion || '')}"
         placeholder="No suggestion available"/>`;

  card.innerHTML = `
    <div class="card-top">
      <div class="card-cat-icon cci-${normCat(field.category)}">${meta.icon}</div>
      <div class="card-meta">
        <div class="card-label" title="${esc(field.label)}">${esc(trunc(field.label, 46))}</div>
        <div class="card-tags">
          <span class="ctag ctag-type">${typeLabel(field.type, field.tag)}</span>
          <span class="ctag ctag-cat ${meta.tagCls}">${esc(field.subCategory)}</span>
        </div>
      </div>
      <span class="tier-badge tier-${field.tier}">${field.tier}</span>
    </div>

    <div class="conf-row">
      <span class="conf-lbl">Confidence</span>
      <div class="conf-track">
        <div class="conf-fill ${field.tier}" style="width:${confPct}%"></div>
      </div>
      <span class="conf-pct ${field.tier}">${confPct}%</span>
    </div>

    <div class="suggest-area">
      <span class="suggest-lbl">Suggested Value — <em style="font-style:normal;color:var(--t2)">editable</em></span>
      ${suggestEl}
    </div>

    <div class="card-actions">
      <button class="btn-apply${hasSug ? '' : ''}" id="apply-${field.id}"
        data-field-id="${field.id}"
        ${!hasSug ? 'disabled' : ''}>
        ✓ Apply
      </button>
      <div class="sp"></div>
      <button class="btn-skip" id="skip-${field.id}" data-field-id="${field.id}">
        Skip
      </button>
    </div>`;

  // ── Hover → highlight field on page ────────────────────────────
  card.addEventListener('mouseenter', () => {
    msg({ action:'highlight', fieldId: field.id });
  });

  // ── Click card body (not buttons) → highlight ──────────────────
  card.addEventListener('click', e => {
    if (!e.target.closest('button, .suggest-field')) {
      msg({ action:'highlight', fieldId: field.id });
    }
  });

  // ── Apply button ───────────────────────────────────────────────
  const applyBtn = card.querySelector(`#apply-${field.id}`);
  applyBtn.addEventListener('click', e => {
    e.stopPropagation();
    const sugEl = document.getElementById(`sug-${field.id}`);
    const value = sugEl ? sugEl.value.trim() : '';
    applyField(field.id, value, applyBtn);
  });

  // ── Skip button ───────────────────────────────────────────────
  const skipBtn = card.querySelector(`#skip-${field.id}`);
  skipBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleSkip(field.id, card, skipBtn);
  });

  return card;
}

// ── APPLY a single field ──────────────────────────────────────────
async function applyField(fieldId, value, btn) {
  if (!value) { showToast('⚠️ No value to apply — edit the suggestion first'); return; }

  const prev = btn.innerHTML;
  btn.innerHTML = '…';
  btn.disabled  = true;

  const res = await msg({ action:'apply', fieldId, value });

  if (res?.success) {
    btn.innerHTML = '✓ Applied';
    btn.classList.add('is-applied');
    btn.disabled  = false;
    showToast('✅ Field filled!');
  } else {
    btn.innerHTML = '✗ Failed';
    btn.disabled  = false;
    showToast('❌ ' + (res?.error || 'Could not fill field'));
    setTimeout(() => { btn.innerHTML = '✓ Apply'; }, 2000);
  }
}

// ── TOGGLE SKIP ───────────────────────────────────────────────────
function toggleSkip(fieldId, card, btn) {
  if (_skipped.has(fieldId)) {
    _skipped.delete(fieldId);
    card.classList.remove('is-skipped');
    btn.textContent = 'Skip';
    showToast('↩ Un-skipped');
  } else {
    _skipped.add(fieldId);
    card.classList.add('is-skipped');
    btn.textContent = 'Un-skip';
    showToast('⏭ Skipped');
  }
}

// ── APPLY ALL HIGH-CONFIDENCE ─────────────────────────────────────
async function applyAll() {
  const toApply = _fields.filter(f =>
    !_skipped.has(f.id) && f.tier === 'HIGH' && f.suggestion
  );

  if (!toApply.length) {
    showToast('⚠️ No HIGH-confidence fields with suggestions to apply');
    return;
  }

  const btn = $('btn-apply-all');
  btn.disabled  = true;
  btn.textContent = `Applying ${toApply.length} fields…`;

  let n = 0;
  for (const field of toApply) {
    const sugEl  = document.getElementById(`sug-${field.id}`);
    const value  = sugEl ? sugEl.value.trim() : field.suggestion;
    const applyBtn = document.getElementById(`apply-${field.id}`);

    const res = await msg({ action:'apply', fieldId:field.id, value });
    if (res?.success) {
      n++;
      if (applyBtn) { applyBtn.innerHTML = '✓ Applied'; applyBtn.classList.add('is-applied'); }
    }
    await sleep(90); // small gap between fills for stability
  }

  btn.disabled  = false;
  btn.textContent = '✨ Apply All High-Confidence';
  showToast(`✅ Applied ${n} of ${toApply.length} high-confidence fields`, 3000);
}

// ── TIER FILTER TABS ──────────────────────────────────────────────
function applyTierFilter(filter) {
  _activeTab = filter;

  // Update tab active state
  document.querySelectorAll('.tier-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });

  // Show/hide cards
  document.querySelectorAll('.field-card').forEach(card => {
    const tier = card.dataset.tier;
    const show = filter === 'all' || tier === filter;
    card.style.display = show ? 'block' : 'none';
  });

  // Show/hide group headers
  document.querySelectorAll('.group-header').forEach(header => {
    // Check if any cards in this group are visible
    let next = header.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('group-header')) {
      if (next.classList.contains('field-card') && next.style.display !== 'none') {
        hasVisible = true; break;
      }
      next = next.nextElementSibling;
    }
    header.style.display = hasVisible ? 'flex' : 'none';
  });
}

// ── UTILITIES ─────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return String(str || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function trunc(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── DOM-CHANGE NOTICE from content script ─────────────────────────
chrome.runtime.onMessage.addListener(message => {
  if (message.action === 'dom_changed' && _fields.length > 0) {
    domBanner.style.display = 'flex';
  }
});

// ── EVENT BINDINGS ────────────────────────────────────────────────
$('btn-scan').addEventListener('click', doScan);
$('btn-retry').addEventListener('click', doScan);
$('btn-retry-empty').addEventListener('click', doScan);
$('btn-rescan').addEventListener('click', doScan);
$('btn-rescan-banner').addEventListener('click', doScan);
$('btn-apply-all').addEventListener('click', applyAll);

// Tier filter tabs
document.querySelectorAll('.tier-tab').forEach(tab => {
  tab.addEventListener('click', () => applyTierFilter(tab.dataset.filter));
});

// ── INIT ──────────────────────────────────────────────────────────
showView('initial');
