// ═══════════════════════════════════════════════════════════════════════
// SmartWeb Form Assistant — Production-Grade Intelligence Engine
// Content Script | Manifest V3
//
// Architecture (6 Layers):
//   L1: SmartWebProfile    — Extensible user profile schema
//   L2: SmartWebDOM        — DOM Intelligence & context extraction
//   L3: SmartWebClassifier — Multi-signal classification engine
//   L4: SmartWebSuggestion — Context-aware suggestion generator
//   L5: SmartWebRegistry   — Field lifecycle & element registry
//   L6: SmartWebInteraction — Fill, highlight, scroll operations
//   +   SmartWebScanner    — Orchestration + MutationObserver
// ═══════════════════════════════════════════════════════════════════════

'use strict';

// ══════════════════════════════════════════════════════════════════════
// LAYER 1 — PROFILE MODULE (Extensible Schema)
// Designed for future: multi-profile, cloud sync, user-editable fields.
// ══════════════════════════════════════════════════════════════════════

const SmartWebProfile = (() => {
  const _schema = {
    personal: {
      name:      'Test User',
      firstName: 'Test',
      lastName:  'User',
      email:     'test@example.com',
      phone:     '9876543210',
    },
    location: {
      address: '123 Main Street, New York, NY 10001',
      city:    'New York',
      state:   'NY',
      zip:     '10001',
      country: 'United States',
    },
    professional: {
      skills:     'JavaScript, React, Node.js',
      experience: '1 year in web development',
      company:    'Self-employed',
      role:       'Frontend Developer',
      degree:     'Bachelor of Computer Science',
      college:    'State University',
      cgpa:       '8.5',
    },
    social: {
      linkedin: 'https://linkedin.com/in/testuser',
      github:   'https://github.com/testuser',
      website:  'https://testuser.dev',
      twitter:  'https://twitter.com/testuser',
    },
  };

  // Flat O(1) lookup map
  const _flat = {};
  for (const group of Object.values(_schema)) Object.assign(_flat, group);

  return {
    get:      (key)        => _flat[key] ?? null,
    getGroup: (name)       => _schema[name] ?? null,
    update:   (key, value) => { _flat[key] = value; }, // future: sync to storage
    schema:   _schema,
  };
})();


// ══════════════════════════════════════════════════════════════════════
// LAYER 2 — DOM INTELLIGENCE
// Extracts rich context from each field, not just flat strings.
// ══════════════════════════════════════════════════════════════════════

const SmartWebDOM = (() => {
  // Memoized Levenshtein distance
  const _lev = new Map();
  function levenshtein(a, b) {
    const k = `${a}|${b}`;
    if (_lev.has(k)) return _lev.get(k);
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    _lev.set(k, dp[m][n]);
    return dp[m][n];
  }

  function fuzzyScore(a, b) {
    if (!a || !b) return 0;
    if (b.includes(a) || a.includes(b)) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : Math.max(0, 1 - levenshtein(a, b) / maxLen);
  }

  function normalize(text) {
    if (!text) return '';
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ── Section Detection ─────────────────────────────────────────────
  // Finds semantic page sections by heading elements.
  // Used to provide ambient contextual bias during classification.

  function detectSections() {
    const headingSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[role="heading"]',
      // Google Forms section titles
      '[class*="freebirdFormviewerViewNavigationPageTitle"]',
      '[class*="freebirdFormviewerViewItemsPagebreakTitle"]',
    ].join(',');

    return [...document.querySelectorAll(headingSelectors)]
      .map(el => ({ el, text: normalize(el.innerText || '') }))
      .filter(s => s.text.length > 0 && s.text.length < 100);
  }

  function getSectionText(el, sections) {
    if (!sections?.length) return '';
    const elTop = el.getBoundingClientRect().top;
    let best = null, bestTop = -Infinity;
    for (const s of sections) {
      const sTop = s.el.getBoundingClientRect().top;
      if (sTop < elTop && sTop > bestTop) { bestTop = sTop; best = s; }
    }
    return best ? best.text : '';
  }

  // ── Label Resolution (9-level priority waterfall) ─────────────────

  function resolveLabel(el) {
    // 1. Explicit <label for="...">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    // 2. aria-label
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    // 3. aria-labelledby
    const alb = el.getAttribute('aria-labelledby');
    if (alb) {
      const t = alb.split(/\s+/)
        .map(id => document.getElementById(id)?.innerText?.trim() || '')
        .filter(Boolean).join(' ');
      if (t) return t;
    }
    // 4. aria-describedby (fallback)
    const adb = el.getAttribute('aria-describedby');
    if (adb) {
      const ref = document.getElementById(adb);
      if (ref) { const t = ref.innerText?.trim(); if (t && t.length < 100) return t; }
    }
    // 5. Wrapping <label>
    const wl = el.closest('label');
    if (wl) {
      const clone = wl.cloneNode(true);
      clone.querySelectorAll('input,select,textarea,button').forEach(c => c.remove());
      const t = clone.innerText.trim();
      if (t) return t;
    }
    // 6. title attribute
    if (el.title) return el.title.trim();
    // 7. Walk DOM ancestors (up to 8 levels) for preceding label-like sibling
    const anc = _findAncestorLabel(el);
    if (anc) return anc;
    // 8. placeholder (skip Google Forms generic "Your answer")
    if (el.placeholder && !/^(your answer|answer|type here|enter here)$/i.test(el.placeholder.trim()))
      return el.placeholder.trim();
    // 9. name/id tokens (skip Google Forms "entry.XXXX" IDs)
    const raw = el.name || el.id || '';
    if (raw && !/^entry\.\d+$/.test(raw) && raw.length < 50)
      return raw.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return '';
  }

  function _findAncestorLabel(el) {
    let node = el;
    let bestLabel = '';
    for (let depth = 0; depth < 8; depth++) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const child of [...parent.children]) {
        if (child === node || child.contains(el)) break; // only look at preceding siblings
        const tag = child.tagName?.toLowerCase();
        if (['input','select','textarea','button','script','style'].includes(tag)) continue;
        const t = child.innerText?.trim();
        // Accept: non-empty, short enough to be a label, not long prose
        if (t && t.length > 0 && t.length < 150) bestLabel = t;
      }
      node = parent;
    }
    return bestLabel;
  }

  // ── Nearby Text (Direct siblings only — no grandparent bleed) ──────

  function getNearbyText(el) {
    const parent = el.parentElement;
    if (!parent) return '';
    const snippets = [];
    for (const sib of [...parent.children]) {
      if (sib === el || sib.contains(el)) continue;
      const t = sib.innerText?.trim();
      if (t && t.length > 0 && t.length < 100) snippets.push(t);
    }
    return snippets.join(' ').slice(0, 150);
  }

  // ── Field Context Graph Node ───────────────────────────────────────
  // Builds a rich context object per field — the input to the classifier.

  function buildFieldContext(el, sections) {
    const tag  = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ||
      (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();

    const label       = resolveLabel(el);
    const placeholder = el.placeholder || '';
    const name        = el.name || '';
    const id          = el.id  || '';
    const nearbyText  = getNearbyText(el);
    const sectionCtx  = getSectionText(el, sections);

    // Name/id tokens: useful semantic signal (e.g. "emailInput" → "email input")
    const nameTokens = normalize(`${name} ${id}`)
      .split(/\s+/)
      .filter(w => w.length > 2 && !/^(entry|field|input|item|el|form|div)\d*$/.test(w));

    return {
      el, tag, type,
      label, placeholder, name, id,
      nearbyText, sectionCtx,
      nameTokenStr: nameTokens.join(' '),
      isMultiline: tag === 'textarea',
      rect: el.getBoundingClientRect(),
    };
  }

  return { normalize, fuzzyScore, levenshtein, detectSections, buildFieldContext };
})();


// ══════════════════════════════════════════════════════════════════════
// LAYER 3 — CLASSIFICATION ENGINE
// Multi-signal scoring: label, placeholder, name, nearby, section.
// MAX-of-signals (not sum) prevents keyword-count bias.
// ══════════════════════════════════════════════════════════════════════

const SmartWebClassifier = (() => {
  // Taxonomy: each entry has weighted keywords, type bonuses, and section bias
  const TAXONOMY = [
    // Personal: Name ──────────────────────────────────────────────────
    {
      c: 'Personal Information', sc: 'Full Name', pk: 'name',
      kw: { 'full name':1.0, 'your name':0.95, 'applicant name':0.9, 'candidate name':0.9,
            'student name':0.85, 'name':0.65, 'firstname':0.85, 'lastname':0.85,
            'surname':0.85, 'given name':0.85, 'nickname':0.7 },
      tb: { text:0.05 },
      sb: { personal:0.15, contact:0.1, about:0.08, basic:0.1 },
      oep: 0.4, // open-ended penalty multiplier when generic label
    },
    {
      c: 'Personal Information', sc: 'First Name', pk: 'firstName',
      kw: { 'first name':1.0, 'firstname':1.0, 'given name':0.9, 'fname':0.85, 'first':0.55 },
      tb: { text:0.05 },
      sb: { personal:0.1, contact:0.1 },
    },
    {
      c: 'Personal Information', sc: 'Last Name', pk: 'lastName',
      kw: { 'last name':1.0, 'lastname':1.0, 'surname':0.95, 'family name':0.9, 'lname':0.85, 'last':0.55 },
      tb: { text:0.05 },
      sb: { personal:0.1, contact:0.1 },
    },
    // Personal: Email ─────────────────────────────────────────────────
    {
      c: 'Personal Information', sc: 'Email', pk: 'email',
      kw: { 'email address':1.0, 'email':1.0, 'e-mail':0.95, 'your email':0.9,
            'contact email':0.9, 'mail':0.65 },
      tb: { email:0.6 }, // type="email" is extremely strong
      sb: { contact:0.15, personal:0.1, email:0.2 },
    },
    // Personal: Phone ─────────────────────────────────────────────────
    {
      c: 'Personal Information', sc: 'Phone', pk: 'phone',
      kw: { 'phone number':1.0, 'mobile number':1.0, 'phone':0.95, 'mobile':0.9,
            'contact number':0.9, 'telephone':0.85, 'cell number':0.85,
            'whatsapp':0.8, 'cell':0.7, 'contact':0.45 },
      tb: { tel:0.6, number:0.05 },
      sb: { contact:0.15, personal:0.1, phone:0.2 },
    },
    // Location ────────────────────────────────────────────────────────
    {
      c: 'Personal Information', sc: 'Address', pk: 'address',
      kw: { 'street address':1.0, 'mailing address':0.95, 'home address':0.95,
            'residential address':0.9, 'address':0.85, 'street':0.7 },
      sb: { location:0.2, address:0.25, contact:0.1 },
    },
    { c: 'Personal Information', sc: 'City',    pk: 'city',
      kw: { 'city':1.0, 'town':0.8, 'locality':0.7, 'municipality':0.7 },
      sb: { location:0.15, address:0.2 } },
    { c: 'Personal Information', sc: 'State',   pk: 'state',
      kw: { 'state':1.0, 'province':0.85, 'region':0.7 },
      sb: { location:0.15, address:0.2 } },
    {
      c: 'Personal Information', sc: 'ZIP Code', pk: 'zip',
      kw: { 'zip code':1.0, 'postal code':1.0, 'pincode':0.95, 'pin code':0.9,
            'zip':0.85, 'postal':0.8, 'pin':0.65 },
      tb: { number:0.1 }, sb: { location:0.15, address:0.15 },
    },
    { c: 'Personal Information', sc: 'Country', pk: 'country',
      kw: { 'country':1.0, 'nation':0.8, 'nationality':0.75 },
      sb: { location:0.1 } },
    // Professional ────────────────────────────────────────────────────
    {
      c: 'Professional Information', sc: 'Skills', pk: 'skills',
      kw: { 'technical skills':1.0, 'tech skills':0.95, 'skills':1.0,
            'technologies':0.9, 'tech stack':0.9, 'expertise':0.85,
            'programming languages':0.9, 'core skills':0.9,
            'proficiency':0.8, 'tools':0.65 },
      sb: { professional:0.15, technical:0.2, skills:0.25 },
    },
    {
      c: 'Professional Information', sc: 'Experience', pk: 'experience',
      kw: { 'years of experience':1.0, 'work experience':1.0, 'professional experience':0.95,
            'total experience':0.9, 'experience':0.85, 'work history':0.8, 'background':0.65 },
      sb: { professional:0.15, work:0.15, experience:0.2 },
    },
    {
      c: 'Professional Information', sc: 'Job Title', pk: 'role',
      kw: { 'current role':1.0, 'job title':1.0, 'current designation':0.95,
            'designation':0.9, 'current position':0.9, 'position':0.8,
            'job role':0.9, 'role':0.7, 'title':0.6 },
      sb: { professional:0.1, work:0.1 },
    },
    {
      c: 'Professional Information', sc: 'Company', pk: 'company',
      kw: { 'current company':1.0, 'company name':1.0, 'organization':0.9,
            'current employer':0.9, 'employer':0.85, 'workplace':0.8,
            'firm':0.75, 'college':0.85, 'university':0.85,
            'institution':0.8, 'school':0.7 },
      sb: { professional:0.1, education:0.15 },
    },
    {
      c: 'Professional Information', sc: 'LinkedIn', pk: 'linkedin',
      kw: { 'linkedin profile':1.0, 'linkedin url':1.0, 'linkedin link':0.95, 'linkedin':0.9 },
      tb: { url:0.3 }, sb: { social:0.2, professional:0.1 },
    },
    {
      c: 'Professional Information', sc: 'GitHub', pk: 'github',
      kw: { 'github profile':1.0, 'github url':1.0, 'github link':0.95, 'github':0.9, 'git':0.55 },
      tb: { url:0.2 }, sb: { social:0.2 },
    },
    {
      c: 'Professional Information', sc: 'Portfolio / Website', pk: 'website',
      kw: { 'portfolio url':1.0, 'portfolio site':0.95, 'personal website':0.95,
            'portfolio':0.85, 'website':0.9, 'url':0.65, 'site':0.6, 'link':0.45 },
      tb: { url:0.2 }, sb: { social:0.15, portfolio:0.2 },
    },
    // Open-ended ──────────────────────────────────────────────────────
    {
      c: 'Open-ended', sc: 'Cover Letter', pk: '_openended_cover',
      kw: { 'cover letter':1.0, 'motivation letter':1.0, 'letter of intent':1.0,
            'why do you want':1.0, 'why are you interested':0.95,
            'why this role':0.95, 'why this company':0.9,
            'why join':0.85, 'reasons for applying':0.9, 'why us':0.8 },
      oeb: 0.35, // open-ended bonus if textarea
      sb:  { motivation:0.2, cover:0.2 },
    },
    {
      c: 'Open-ended', sc: 'About Yourself', pk: '_openended_about',
      kw: { 'tell us about yourself':1.0, 'about yourself':1.0,
            'introduce yourself':0.95, 'brief introduction':0.9,
            'describe yourself':0.9, 'self introduction':0.9,
            'about you':0.85, 'who are you':0.8 },
      oeb: 0.35,
    },
    {
      c: 'Open-ended', sc: 'Response', pk: '_openended_generic',
      kw: { 'additional information':0.9, 'anything else':0.85,
            'elaborate':0.8, 'describe':0.75, 'explain':0.75,
            'achievements':0.75, 'projects':0.7, 'feedback':0.7,
            'comments':0.7, 'goals':0.65, 'aspirations':0.7,
            'expectations':0.65, 'notes':0.6, 'message':0.6,
            'tell us':0.65, 'suggestions':0.6 },
      oeb: 0.45, // strongest textarea bonus — true generic catch-all
    },
  ];

  // Source reliability weights
  const SW = { label:3.0, placeholder:1.5, name:1.2, nearby:0.7, section:0.5 };

  /**
   * Score one text signal against a keyword map.
   * Returns the BEST single keyword score × signal weight.
   * MAX-of-keywords prevents categories with many kws from winning via noise.
   */
  function _scoreSignal(text, kwMap, weight) {
    if (!text || !weight) return 0;
    const norm = SmartWebDOM.normalize(text);
    let best = 0;
    for (const [phrase, kw] of Object.entries(kwMap)) {
      // Exact substring match (most reliable)
      if (norm.includes(phrase)) { best = Math.max(best, kw); continue; }
      // Fuzzy multi-token match
      const pTokens = phrase.split(/\s+/).filter(w => w.length >= 3);
      const tTokens = norm.split(/\s+/).filter(w => w.length >= 3);
      if (!pTokens.length || !tTokens.length) continue;
      let matched = 0, total = 0, tokenScore = 0;
      for (const pt of pTokens) {
        total++;
        let best2 = 0;
        for (const tt of tTokens) {
          const fs = SmartWebDOM.fuzzyScore(tt, pt);
          if (fs > 0.82) best2 = Math.max(best2, fs);
        }
        if (best2 > 0) { matched++; tokenScore += best2; }
      }
      // Only count if all phrase tokens matched (or single token)
      if (matched === total && total > 0) {
        const avg = tokenScore / total;
        best = Math.max(best, kw * avg * 0.72); // fuzzy penalty
      }
    }
    return best * weight;
  }

  function classify(ctx, prevCategory = null) {
    const { label, placeholder, nameTokenStr, nearbyText, sectionCtx, isMultiline, type } = ctx;

    // Detect generic/anonymous field (helps bias Open-ended when label is absent)
    const genericLabel = !label ||
      /^(your answer|answer|text|input|response|field|enter here|type here)$/i.test(label.trim());

    const results = TAXONOMY.map(entry => {
      const { kw, tb, sb, oeb, oep } = entry;

      // 5 independent signals
      const sLabel  = _scoreSignal(label,        kw, SW.label);
      const sPlchldr= _scoreSignal(placeholder,  kw, SW.placeholder);
      const sName   = _scoreSignal(nameTokenStr, kw, SW.name);
      const sNearby = _scoreSignal(nearbyText,   kw, SW.nearby);
      const sSection= _scoreSignal(sectionCtx,   kw, SW.section);

      // Primary score = max of signals (dominant wins)
      const allScores = [sLabel, sPlchldr, sName, sNearby, sSection].sort((a,b) => b-a);
      let score = allScores[0];
      // Secondary boost: strong runner-up adds a diminished contribution
      if (allScores[1] > 0) score += allScores[1] * 0.18;

      // Input type bonus (type="email" → strong Email signal)
      if (tb?.[type]) score += tb[type];

      // Section context bias
      if (sb && sectionCtx) {
        for (const [kword, bias] of Object.entries(sb)) {
          if (sectionCtx.includes(kword)) { score += bias; break; }
        }
      }

      // Textarea open-ended bonus (textareas are almost always long-response)
      if (isMultiline && oeb) score += oeb;

      // Generic label penalty for non-open-ended categories
      if (genericLabel && oep && entry.c !== 'Open-ended') score *= (1 - oep);

      // Mild sequential affinity: same category as previous field
      if (prevCategory && prevCategory === entry.c && score > 0) score += 0.08;

      return { entry, score };
    });

    results.sort((a, b) => b.score - a.score);
    const best   = results[0];
    const second = results[1];

    const topTotal  = best.score + (second?.score || 0);
    const rawConf   = topTotal > 0 ? best.score / topTotal : 0;

    // Low-score fallback
    if (best.score < 0.22) {
      if (isMultiline)
        return { category:'Open-ended', subCategory:'Response', profileKey:'_openended_generic', confidence:0.35, tier:'LOW' };
      return { category:'Unknown', subCategory:'Unknown', profileKey:null, confidence:0, tier:'LOW' };
    }

    const confidence = parseFloat(Math.min(rawConf, 1).toFixed(2));
    const tier = confidence >= 0.72 ? 'HIGH' : confidence >= 0.46 ? 'MEDIUM' : 'LOW';

    return {
      category:    best.entry.c,
      subCategory: best.entry.sc,
      profileKey:  best.entry.pk,
      confidence, tier,
    };
  }

  return { classify };
})();


// ══════════════════════════════════════════════════════════════════════
// LAYER 4 — SUGGESTION ENGINE
// Context-aware suggestions with confidence tier gating.
// ══════════════════════════════════════════════════════════════════════

const SmartWebSuggestion = (() => {
  const TEMPLATES = [
    { pk:'_openended_cover',
      m: ['why do you want','why are you interested','why this role','why this company','why join','motivation','reason for applying'],
      t: "I'm excited about this opportunity as it aligns with my background in frontend development. With hands-on experience in React and JavaScript, I'm confident I can contribute meaningfully and grow with your team." },
    { pk:'_openended_about',
      m: ['about yourself','about you','introduce yourself','who are you','tell us about yourself','brief intro','self introduction'],
      t: "I'm a frontend developer with 1 year of hands-on experience in React and JavaScript. I enjoy building clean, performant interfaces and thrive in collaborative, fast-paced environments." },
    { pk:'_openended_goals',
      m: ['goals','aspirations','where do you see yourself','future plans','five years'],
      t: "My goal is to grow as a full-stack engineer while delivering high-quality solutions. I aim to deepen expertise in system design and contribute to products that create real impact." },
    { pk:'_openended_strength',
      m: ['strength','best quality','what do you bring','why should we hire','what makes you'],
      t: "My key strength is translating complex problems into clean, maintainable solutions. I'm a fast learner who values code quality, clear communication, and collaborative teamwork." },
    { pk:'_openended_projects',
      m: ['project','describe your work','portfolio','what have you built','experience with'],
      t: "I have built several React-based applications including a finance dashboard and a resume parser. I focus on performance, accessibility, and clean architecture in all my projects." },
    { pk:'_openended_generic',
      m: [],
      t: "I'm enthusiastic about this opportunity. My skills in JavaScript and React, combined with my dedication and growth mindset, make me a strong fit for this role." },
  ];

  function pickTemplate(label, placeholder, profileKey) {
    const combined = SmartWebDOM.normalize(`${label} ${placeholder}`);
    // Exact profileKey match first
    for (const t of TEMPLATES) {
      if (t.pk === profileKey && t.pk !== '_openended_generic') return t.t;
    }
    // Context keyword match
    for (const t of TEMPLATES) {
      if (t.m.some(m => combined.includes(m))) return t.t;
    }
    return TEMPLATES[TEMPLATES.length - 1].t;
  }

  function pickSelectOption(el, suggestion) {
    if (!suggestion || el.tagName.toLowerCase() !== 'select') return null;
    const opts = [...el.options];
    const sug  = suggestion.toLowerCase();
    let match = opts.find(o => o.text.toLowerCase() === sug);
    if (match) return match.value;
    match = opts.find(o => o.value.toLowerCase() === sug);
    if (match) return match.value;
    match = opts.find(o => o.text.toLowerCase().includes(sug) || sug.includes(o.text.toLowerCase()));
    if (match) return match.value;
    let bestS = 0, bestOpt = null;
    for (const o of opts) {
      if (!o.value) continue;
      const s = SmartWebDOM.fuzzyScore(o.text.toLowerCase(), sug);
      if (s > bestS) { bestS = s; bestOpt = o; }
    }
    return bestS > 0.55 ? bestOpt?.value ?? null : null;
  }

  function suggest(ctx, cls) {
    const { profileKey, tier } = cls;
    if (!profileKey) return '';
    // LOW confidence with no open-ended → no suggestion
    if (tier === 'LOW' && !profileKey.startsWith('_openended_')) return '';
    if (profileKey.startsWith('_openended_'))
      return pickTemplate(ctx.label, ctx.placeholder, profileKey);
    const value = SmartWebProfile.get(profileKey) || '';
    if (ctx.tag === 'select') {
      const opt = pickSelectOption(ctx.el, value);
      return opt !== null ? opt : value;
    }
    return value;
  }

  return { suggest };
})();


// ══════════════════════════════════════════════════════════════════════
// LAYER 5 — FIELD REGISTRY
// ══════════════════════════════════════════════════════════════════════

const SmartWebRegistry = (() => {
  const _map = new Map();
  let _n = 0;
  return {
    register(el, ctx, cls, suggestion) {
      const id = `swf-${++_n}`;
      _map.set(id, { el, ctx, cls, suggestion });
      return id;
    },
    get:    id  => _map.get(id) ?? null,
    clear:  ()  => { _map.clear(); },
    size:   ()  => _map.size,
  };
})();


// ══════════════════════════════════════════════════════════════════════
// LAYER 6 — INTERACTION ENGINE
// Fill, highlight, scroll. React + Vue + Angular compatible.
// ══════════════════════════════════════════════════════════════════════

const SmartWebInteraction = (() => {
  function _inject() {
    if (document.getElementById('_swf_style')) return;
    const s = document.createElement('style');
    s.id = '_swf_style';
    s.textContent = `
      @keyframes _swf_pulse {
        0%   { box-shadow: 0 0 0 0   rgba(99,102,241,0.65); }
        70%  { box-shadow: 0 0 0 12px rgba(99,102,241,0.0);  }
        100% { box-shadow: 0 0 0 0   rgba(99,102,241,0.0);   }
      }
      ._swf_hl {
        outline: 2.5px solid #6366f1 !important;
        outline-offset: 2px !important;
        border-radius: 4px !important;
        animation: _swf_pulse 1.1s ease-out !important;
      }
      ._swf_ok {
        outline: 2.5px solid #22c55e !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 5px rgba(34,197,94,0.18) !important;
        border-radius: 4px !important;
        transition: all 0.3s ease !important;
      }
    `;
    document.head.appendChild(s);
  }

  _inject();

  function highlight(id) {
    document.querySelectorAll('._swf_hl').forEach(e => e.classList.remove('_swf_hl'));
    const rec = SmartWebRegistry.get(id);
    if (!rec) return false;
    rec.el.classList.add('_swf_hl');
    rec.el.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
    rec.el.focus({ preventScroll:true });
    setTimeout(() => rec.el.classList.remove('_swf_hl'), 3200);
    return true;
  }

  function apply(id, value) {
    const rec = SmartWebRegistry.get(id);
    if (!rec) return { success:false, error:'Field not found in registry' };
    try {
      const el   = rec.el;
      const tag  = el.tagName.toLowerCase();
      const type = el.getAttribute('type')?.toLowerCase();

      if (tag === 'select') {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles:true }));

      } else if (type === 'checkbox') {
        el.checked = (value === true || value === 'true' || value === 'on');
        el.dispatchEvent(new Event('change', { bubbles:true }));

      } else if (type === 'radio') {
        const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
        for (const r of radios) {
          if (r.value === value ||
              r.parentElement?.innerText?.trim().toLowerCase() === value.toLowerCase()) {
            r.checked = true;
            r.dispatchEvent(new Event('change', { bubbles:true }));
            break;
          }
        }

      } else {
        // React/Vue/Angular-compatible native setter
        const proto = tag === 'textarea'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else el.value = value;

        el.dispatchEvent(new Event('input',  { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true, key:'a' }));
      }

      el.classList.remove('_swf_hl');
      el.classList.add('_swf_ok');
      setTimeout(() => el.classList.remove('_swf_ok'), 2500);
      return { success:true };

    } catch (err) {
      return { success:false, error:err.message };
    }
  }

  return { highlight, apply, inject:_inject };
})();


// ══════════════════════════════════════════════════════════════════════
// SCAN ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

const SmartWebScanner = (() => {
  const SKIP = new Set(['submit','button','reset','image','file','hidden','color','range']);

  function _visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.01;
  }

  function scan() {
    SmartWebRegistry.clear();
    SmartWebInteraction.inject();

    const sections = SmartWebDOM.detectSections();
    const selector = "input:not([type='hidden']):not([type='submit']):not([type='button'])" +
      ":not([type='reset']):not([type='image']):not([type='file'])" +
      ":not([type='color']):not([type='range']), textarea, select";

    const elements = [...document.querySelectorAll(selector)];
    const fields   = [];
    let prevCat    = null;

    for (const el of elements) {
      if (!_visible(el) || el.disabled || el.readOnly) continue;
      if (SKIP.has(el.getAttribute('type')?.toLowerCase() || '')) continue;

      const ctx  = SmartWebDOM.buildFieldContext(el, sections);
      const cls  = SmartWebClassifier.classify(ctx, prevCat);
      const sug  = SmartWebSuggestion.suggest(ctx, cls);
      const id   = SmartWebRegistry.register(el, ctx, cls, sug);

      prevCat = cls.category;

      fields.push({
        id,
        tag:         ctx.tag,
        type:        ctx.type,
        label:       ctx.label || ctx.placeholder || ctx.name || `Field ${fields.length + 1}`,
        category:    cls.category,
        subCategory: cls.subCategory,
        confidence:  cls.confidence,
        tier:        cls.tier,
        suggestion:  sug,
        options:     ctx.tag === 'select'
          ? [...el.options].slice(0,60).map(o => ({ value:o.value, text:o.text }))
          : null,
      });
    }
    return fields;
  }

  function scanWithRetry(retries = 3, delayMs = 500) {
    return new Promise(resolve => {
      let n = 0;
      const run = () => {
        const f = scan();
        if (f.length || n >= retries) resolve(f);
        else { n++; setTimeout(run, delayMs); }
      };
      run();
    });
  }

  return { scan, scanWithRetry };
})();


// ══════════════════════════════════════════════════════════════════════
// CONTEXT VALIDITY GUARD
// Chrome throws "Extension context invalidated" when the extension is
// reloaded while a content script is still alive on the page.
// All chrome.runtime calls must be guarded by this check.
// ══════════════════════════════════════════════════════════════════════

function _ctxOk() {
  try { return !!(chrome?.runtime?.id); }
  catch { return false; }
}


// ══════════════════════════════════════════════════════════════════════
// MUTATION OBSERVER — Dynamic form support (SPAs, multi-step forms)
// Disconnects itself automatically when extension context is invalidated.
// ══════════════════════════════════════════════════════════════════════

let _mutTimer = null;
const _mutObserver = new MutationObserver(() => {
  // If extension was reloaded, stop observing and silently exit
  if (!_ctxOk()) { _mutObserver.disconnect(); return; }
  clearTimeout(_mutTimer);
  _mutTimer = setTimeout(() => {
    if (!_ctxOk()) { _mutObserver.disconnect(); return; }
    try {
      chrome.runtime.sendMessage({ action:'dom_changed' }).catch(() => {});
    } catch { _mutObserver.disconnect(); }
  }, 900);
});
_mutObserver.observe(document.body, { childList:true, subtree:true });


// ══════════════════════════════════════════════════════════════════════
// MESSAGE ROUTER
// Wrapped in try-catch: a stale content script (from before extension
// reload) may still receive messages; we handle them gracefully.
// ══════════════════════════════════════════════════════════════════════

try {
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!_ctxOk()) return false; // context gone — ignore
    switch (msg.action) {
      case 'ping':
        respond({ status:'ready', url:location.href });
        return true;
      case 'scan':
        SmartWebScanner.scanWithRetry(3, 500).then(fields => respond({ fields }));
        return true;
      case 'apply':
        respond(SmartWebInteraction.apply(msg.fieldId, msg.value));
        return true;
      case 'highlight':
        SmartWebInteraction.highlight(msg.fieldId);
        respond({ success:true });
        return true;
      default:
        return false;
    }
  });
} catch (e) {
  // Extension context was already invalidated at load time
  console.warn('[SmartWeb] Could not register message listener:', e.message);
}

console.log('[SmartWeb] v2.0 Production engine loaded on', location.hostname);
