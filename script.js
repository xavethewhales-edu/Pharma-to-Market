// === Origin gate — allow SCORM/LMS, block random mirrors ===
const GH_USERS = ["xavethewhales-edu"];   // your GH Pages host: xavethewhales-edu.github.io
const CUSTOM_DOMAINS = [];                // add custom domains here if you get one

(function originGate(){
  const h = (location.host || "").toLowerCase();
  const okLocal  = /^localhost(:\d+)?$/.test(h) || /^127\.0\.0\.1(:\d+)?$/.test(h);
  const okGh     = GH_USERS.some(u => h === (u.toLowerCase() + ".github.io"));
  const okCustom = CUSTOM_DOMAINS.includes(h);

  // --- SCORM/LMS detection — if launched from an LMS, do not block
  const hasScormFlag = /[?&]scorm=1\b/i.test(location.search);
  const hasApiHere   = !!(window.API || window.API_1484_11);
  const hasApiParent = (() => {
    try { return !!(window.parent && (parent.API || parent.API_1484_11)); }
    catch { return false; }
  })();
  const isLMS = hasScormFlag || hasApiHere || hasApiParent;
  if (isLMS) return;

  if (!(okLocal || okGh || okCustom)) {
    document.documentElement.innerHTML =
      "<style>body{font-family:system-ui;background:#000;color:#0ff;padding:2rem}</style>" +
      "<h1>Unauthorized mirror</h1><p>This build is locked to the author’s domains.</p>";
    throw new Error("Unauthorized origin: " + h);
  }
})();
// --- Harden the awards set: always merge, never clobber ---
function hardenAwardSet() {
  if (window.__awardHardenerInstalled) return;
  window.__awardHardenerInstalled = true;

  let S = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));

  window.mergeAwards = function mergeAwards(list) {
    const arr = Array.isArray(list) ? list
              : (list instanceof Set) ? Array.from(list)
              : Array.from(list || []);
    arr.forEach(x => S.add(x));
    return S;
  };

  window.getAwardArray = () => Array.from(S);

  Object.defineProperty(window, "__awarded", {
    configurable: true,
    get() { return S; },
    set(v) {
      try {
        const incoming = (v instanceof Set) ? Array.from(v)
                      : Array.isArray(v)    ? v
                      : [];
        incoming.forEach(x => S.add(x));
        console.log("[__awarded harden] Merge instead of overwrite; size:", S.size);
      } catch (_) {}
    }
  });
}

// Install immediately (BEFORE any loads that might assign to __awarded)
hardenAwardSet();

// Course mastery (fallback if LMS doesn't provide one)
window.__MASTERY = 75;

// --- Awards storage (unify key + migrate) ---
const AWARD_KEY = 'awarded_scenes_v2';

// Merge (never overwrite) awards into the in-memory set
function mergeAwards(list) {
  const s = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));
  (Array.isArray(list) ? list : []).forEach(x => s.add(x));
  window.__awarded = s;     // keep the same Set instance if possible
}




(function migrateAwardKeys(){
  try {
    const v2 = localStorage.getItem(AWARD_KEY);
    const v1a = localStorage.getItem('awarded_scenes_v1');
    const v1b = localStorage.getItem('awarded_v1');
    if (!v2) {
      const use = v1a || v1b;
      if (use) localStorage.setItem(AWARD_KEY, use);
    }
  } catch(_) {}
})();

// === Detect LMS context (pure detection; no SCORM.init) ===
function inLMS() {
  // 1) Explicit query hint
  try { if (/[?&]scorm=1\b/i.test(location.search)) return true; } catch (_) {}

  // 2) Walk up parent frames (SCORM API is usually in a parent)
  try {
    let w = window, hops = 0;
    while (w && hops++ < 20) {
      if (w.API || w.API_1484_11) return true;
      if (!w.parent || w.parent === w) break;
      w = w.parent;
    }
  } catch (_) {}

  // 3) Check opener chain (SCORM Cloud often opens a child window)
  try {
    let o = window.opener, hops = 0;
    while (o && hops++ < 5) {
      if (o.API || o.API_1484_11) return true;
      if (!o.parent || o.parent === o) break;
      o = o.parent;
    }
  } catch (_) {}

  // 4) Known hostnames as a last hint
  try { if (/\bscormcloud\.com$|\bscorm\.com$/i.test(location.hostname)) return true; } catch(_) {}

  // 5) Adapter flag if already set
  if (typeof window.__IS_SCORM__ === "boolean") return window.__IS_SCORM__;

  return false;
}
// (optional) expose for other modules that expect a global
window.inLMS = window.inLMS || inLMS;


// === Awards persistence (merge-only, LMS-safe) ===
// Place after inLMS()/hardener, before scoring bootstrap

// Single source-of-truth local key
window.AWARD_KEY = window.AWARD_KEY || 'awarded_scenes_v2';

// Helper: array view of the awards Set
if (typeof window.getAwardArray !== 'function') {
  window.getAwardArray = function getAwardArray() {
    if (window.__awarded instanceof Set) return Array.from(window.__awarded);
    return Array.from(new Set(window.__awarded || []));
  };
}

// Helper: merge (never overwrite) into the awards Set
if (typeof window.mergeAwards !== 'function') {
  window.mergeAwards = function mergeAwards(list) {
    const s = (window.__awarded instanceof Set)
      ? window.__awarded
      : new Set(Array.from(window.__awarded || []));
    (Array.isArray(list) ? list : []).forEach(x => s.add(x));
    window.__awarded = s; // keep a Set
  };
}

// Loader: prefer LMS; ignore local in LMS launches; merge legacy once
window.awardPersistLoad = function awardPersistLoad() {
  try {
    if (window.__HYDRATED_FROM_LMS__) return; // already hydrated from LMS
  } catch (_) {}

  // If launched inside an LMS, do NOT bring in browser carryover
  try {
    if (typeof inLMS === 'function' && inLMS()) {
      console.log('[SCORM] Ignored local awards bootstrap in LMS.');
      return;
    }
  } catch (_) {}

  // Merge current (v2) key
  try {
    const v2 = JSON.parse(localStorage.getItem(window.AWARD_KEY) || '[]');
    if (Array.isArray(v2)) window.mergeAwards(v2);
  } catch (_) {}

  // Optional one-time migration from legacy key
  try {
    const v1 = JSON.parse(localStorage.getItem('awarded_scenes_v1') || '[]');
    if (Array.isArray(v1) && v1.length) {
      window.mergeAwards(v1);
      // Uncomment if you want to clean up after migrating:
      // localStorage.removeItem('awarded_scenes_v1');
    }
  } catch (_) {}
};

function awardPersistSave() {
  try {
    localStorage.setItem(AWARD_KEY, JSON.stringify(getAwardArray()));
  } catch (_) {}
}


// Run the loader once on startup (outside LMS this merges local awards)
window.awardPersistLoad();



// --- Healing shim for __awarded: merge on any attempted overwrite ---
(function () {
  // Start from whatever we have (Set or array or null)
  let _awarded = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));

  function toArray(x) {
    if (!x) return [];
    if (x instanceof Set) return Array.from(x);
    if (Array.isArray(x)) return x;
    return []; // unknown shape
  }

  Object.defineProperty(window, '__awarded', {
    configurable: true,
    get() { return _awarded; },
    set(v) {
      // Heals overwrites by merging instead of replacing
      const incoming = toArray(v);
      incoming.forEach(item => _awarded.add(item));
      console.warn('[__awarded heal] Overwrite attempt merged.', { size: _awarded.size, incomingCount: incoming.length });

      // Optional: one-time stack to find the caller
      try {
        if (!window.__awardedHealTracedOnce) {
          window.__awardedHealTracedOnce = true;
          console.trace('[__awarded heal] First overwrite stack trace');
        }
      } catch {}
    }
  });

  // Ensure the getter returns a Set
  if (!(_awarded instanceof Set)) _awarded = new Set(toArray(_awarded));
})();

// === FUNDAE / SCORM thresholds ===
window.__MASTERY = 75;                  // default pass threshold (overridden by LMS masteryscore if present)
window.__AUTO_PASS_ON_THRESHOLD = true; // pass immediately at/over threshold (mid-course)





// === Minimal score model (fixed denominator) ===
window.score = window.score || { cur: 0, max: 0 };

function publishScoreToLMS() {
  try {
    if (!SCORM.init()) return;
    const cur = Number(window.score?.cur || 0);
    const max = Number(window.score?.max || 0);
    const raw = (max > 0) ? Math.round((cur / max) * 100) : 0;  // <-- no fallback to 1
    SCORM.set("cmi.core.score.raw", String(raw));
    SCORM.commit();
    console.log("[SCORM] score updated →", raw, "% (", cur, "/", max, ")");
  } catch (e) {
    console.warn("[SCORM] score push failed:", e);
  }
}

window.scoreAdd = function (delta = 0) {
  const add = Math.max(0, Number(delta) || 0);
  window.score.cur = (window.score.cur || 0) + add;
  publishScoreToLMS();
};

window.scoreReset = function (max = null) {
  window.score.cur = 0;
  if (max != null) window.score.max = Number(max) || 0;
  publishScoreToLMS();
};

window.scoreCurrent = () => Number(window.score.cur || 0);
window.scoreMax     = () => Number(window.score.max || 0);


// Set/lock the denominator and push 0% to LMS
function scoreBootstrap(total) {
  const t = Number(total || 0);
  window.__TOTAL_AWARD_MAX = t;
  window.score.max = t;
  if (!SCORM.init()) return;
  const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
  if (!status || status === "not attempted" || status === "unknown") {
    SCORM.set("cmi.core.lesson_status", "incomplete");
  }
  SCORM.set("cmi.core.score.raw", "0");
  SCORM.commit();
  console.log("[SCORM] bootstrap: max =", t, "status=incomplete");
}

// Add points. If max isn’t set yet but the global total exists, latch it.
window.scoreAdd = function (delta = 0) {
  const add = Math.max(0, Number(delta) || 0);
  window.score.cur = (window.score.cur || 0) + add;
  if (!(window.score.max > 0) && (window.__TOTAL_AWARD_MAX > 0)) {
    window.score.max = window.__TOTAL_AWARD_MAX;
  }
  publishScoreToLMS();
};

// Reset score (rarely needed)
window.scoreReset = function (max = null) {
  window.score.cur = 0;
  if (max != null) window.score.max = Number(max) || 0;
  publishScoreToLMS();
};

// Helpers (used by logs)
window.scoreCurrent = () => Number(window.score.cur || 0);
window.scoreMax     = () => Number(window.score.max || 0);





// === Runtime signature (brand/evidence) ===
const __XAVETHEWHALES_SIGNATURE__ = Object.freeze({
  brand: "xavethewhales-games",
  build: "2025-09-05",
  site: "https://xavethewhales-edu.github.io"
});
(function showSigOnce(){
  if (!window.__XTW_SIG_SHOWN__) {
    window.__XTW_SIG_SHOWN__ = true;
    try {
      console.info(
        "%c" + __XAVETHEWHALES_SIGNATURE__.brand + " — " + __XAVETHEWHALES_SIGNATURE__.build,
        "color:#0ff;font-weight:700"
      );
    } catch {}
  }
})();


/* =========================
   SCORM 1.2 adapter (safe no-op outside LMS)
   ========================= */
(function () {
  const SC = {
    api: null,
    inited: false,
    finished: false,
    start: null
  };

  function findAPI(win) {
    let w = win, hops = 0;
    while (w && !w.API && w.parent && w.parent !== w && hops < 20) {
      hops++; w = w.parent;
    }
    return w && w.API ? w.API : null;
  }

  SC.findAPI = (w) => findAPI(w) || (w.opener ? findAPI(w.opener) : null);

  SC.init = function () {
    if (SC.inited) return true;
    SC.api = SC.findAPI(window);
    if (!SC.api) return false;
    try {
      const ok = SC.api.LMSInitialize("") === "true" || SC.api.LMSInitialize("") === true;
      if (ok) {
        SC.inited = true;
        SC.start = Date.now();
        const st = SC.get("cmi.core.lesson_status");
        if (!st || st === "not attempted") SC.set("cmi.core.lesson_status", "incomplete");
      }
      return ok;
    } catch (_) { return false; }
  };

  SC.set = function (k, v) {
    try { if (!SC.init()) return false; return SC.api.LMSSetValue(k, String(v)) === "true"; }
    catch (_) { return false; }
  };
  SC.get = function (k) {
    try { if (!SC.init()) return null; return SC.api.LMSGetValue(k); }
    catch (_) { return null; }
  };
  SC.commit = function () {
    try { if (!SC.init()) return false; return SC.api.LMSCommit("") === "true"; }
    catch (_) { return false; }
  };

  function hhmmss(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(t / 3600)).padStart(2, "0");
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
    const s = String(t % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  SC.finish = function (opts = {}) {
    try {
      if (!SC.init() || SC.finished) return;
      const dur = SC.start ? Date.now() - SC.start : 0;
      SC.set("cmi.core.session_time", hhmmss(dur));
      if (opts.status) SC.set("cmi.core.lesson_status", opts.status);
      if (typeof opts.score === "number") SC.set("cmi.core.score.raw", Math.max(0, Math.min(100, Math.round(opts.score))));
      SC.commit();
      SC.api.LMSFinish("");
      SC.finished = true;
    } catch (_) {}
  };

  SC.setStatus      = s => SC.set("cmi.core.lesson_status", s);
  SC.setScoreRaw    = n => SC.set("cmi.core.score.raw", n);
  SC.setLocation    = loc => SC.set("cmi.core.lesson_location", loc);
  SC.setSuspendData = data => SC.set("cmi.suspend_data", typeof data === "string" ? data : JSON.stringify(data).slice(0, 4000));
  SC.getSuspendData = () => {
    const v = SC.get("cmi.suspend_data");
    try { return v ? JSON.parse(v) : null; } catch { return v || null; }
  };

  window.__scorm = SC;
  window.__IS_SCORM__ = !!SC.findAPI(window);

  // --- Adapter bridge: make SCORM and __scorm the same API (whichever exists) ---
(function bridgeScormAPIs(){
  try {
    // If __scorm exists but SCORM doesn't, map SCORM to __scorm
    if (window.__scorm && !window.SCORM) {
      window.SCORM = {
        init:        () => window.__scorm.init(),
        get:         (k) => window.__scorm.get(k),
        set:         (k,v) => window.__scorm.set(k,v),
        commit:      () => window.__scorm.commit(),
        finish:      (arg1, arg2) => {
          // allow legacy finish("completed", 85) as well as finish({status, score})
          if (typeof arg1 === "string") {
            window.__scorm.finish({ status: arg1, score: arg2 });
          } else {
            window.__scorm.finish(arg1 || {});
          }
        }
      };
    }
    // If SCORM exists but __scorm doesn't, mirror the other way (optional)
    if (window.SCORM && !window.__scorm) {
      window.__scorm = {
        init:   () => window.SCORM.init(),
        get:    (k) => window.SCORM.get(k),
        set:    (k,v) => window.SCORM.set(k,v),
        commit: () => window.SCORM.commit(),
        finish: (opts={}) => {
          const s = opts && opts.status;
          const n = (typeof opts.score === "number") ? opts.score : undefined;
          if (s) window.SCORM.set("cmi.core.lesson_status", s);
          if (typeof n === "number") window.SCORM.set("cmi.core.score.raw", String(n));
          window.SCORM.commit();
        }
      };
    }
  } catch(_) {}
})();


  if (window.__IS_SCORM__) {
    SC.init();
    window.addEventListener("beforeunload", () => SC.finish({}));
  }
})();
// Alias so existing code using SCORM.* keeps working
window.SCORM = window.SCORM || window.__scorm;



const scenes = {
/* =========================
   ACT I — “Product & Guardrails”
   ========================= */
   
scene1: {
  type: "text",
  text: "Tap Continue to begin.",   // minimal stub to satisfy validator
  image: "images/1.png",
  awardOnEnter: 2,
  render: function (container) {
    const t = document.getElementById("scene-text");
    if (t) { t.style.display = "none"; t.innerHTML = ""; }

    container.style.display = "block";
    container.innerHTML = `
      <div style="
        max-width:900px;margin:12px auto 0;padding:14px 16px;
        border-radius:12px;background:#07131a;border:1px solid #00bcd455;
        box-shadow:0 6px 18px #0008;color:#9fe8ff;font:600 1.02rem/1.55 system-ui;">
        
        <div style="font-weight:800;letter-spacing:.02em;color:#00e6ff;margin-bottom:8px;">Prologue</div>
        <p style="margin:0;">
          Stacy Darby, Associate Product Manager at C1+ Pharma, is stepping into her first
          cross-functional launch lead… timelines are tight, budgets tighter, and having outmost clarity counts.
        </p>

        <hr style="border:none;border-top:1px solid rgba(0,230,255,.25);margin:10px 0 8px;">

        <div style="font-weight:700;color:#8be9fd;margin-bottom:6px;">Quick Acronyms (EN → ES)</div>
        <ul style="margin:0 0 6px 16px;padding:0;line-height:1.45;">
          <li><strong>PK/PD</strong> — Pharmacokinetics/Pharmacodynamics <em>(ES: FC/FD)</em></li>
          <li><strong>HF</strong> — Human Factors (device usability) <em>(ES: Factores Humanos)</em></li>
          <li><strong>SOP</strong> — Standard Operating Procedure <em>(ES: PNT)</em></li>
          <li><strong>GDPR</strong> — EU data protection regulation <em>(ES: RGPD)</em></li>
          <li><strong>DPA</strong> — Data Processing Agreement <em>(ES: Acuerdo de Encargado de Tratamiento)</em></li>
          <li><strong>PV</strong> — Pharmacovigilance <em>(ES: Farmacovigilancia)</em></li>
          <li><strong>QA</strong> — Quality Assurance <em>(ES: Garantía de Calidad)</em></li>
          <li><strong>MA</strong> — Medical Affairs <em>(ES: Departamento Médico)</em></li>
        </ul>
        <div style="font-weight:600;color:#8be9fd;opacity:.95;margin-top:6px;">
          Before playing it will be a wise move to note this terminology down or take a screenshot of it.
        </div>
      </div>

      <div style="text-align:center;margin-top:14px;">
        <button id="prologue-continue" style="
          padding:10px 14px;border:none;border-radius:10px;background:#00ffff;color:#001517;font-weight:800;cursor:pointer;">
          Continue
        </button>
      </div>
    `;
    const btn = container.querySelector('#prologue-continue');
    if (btn) btn.onclick = () => loadScene("scene2_dashboard");
  }
},


// S1 — DASHBOARD (instructional text; sets context fast)
scene2_dashboard: {
  type: "text",
  awardOnEnter: 3,
  text: " ", // validator requirement
  render: function (container) {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
        ${tile("Product", [
          "Anti-TNF biosimilar | hospital-only",
          "Prefilled pen | citrate-free/latex-free",
          "Cold chain 2–8 °C | low volume | end-of-dose cue"
        ])}
        ${tile("Timeline", [
          "10 weeks to launch",
          "Regulatory tables due this week",
          "Tender window opens in 3 weeks"
        ])}
        ${tile("Market", [
          "Spain | hospital tenders",
          "Price + continuity of care",
          "Implementation friction matters"
        ])}
        ${tile("Alerts", [
          "Comparability language only",
          "Supply reliability (cold chain)",
          "Field training assets in progress"
        ])}
      </div>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;">
        <button onclick="loadScene('scene2')" style="
          background:#121417;color:#e8faff;border:1px solid #16f2ff;border-radius:8px;
          padding:8px 12px;font-size:.9em;box-shadow:0 0 8px rgba(22,242,255,.35);">
          Continue
        </button>
      </div>
    `;

    function tile(title, lines){
      return `
        <div style="
          background:#1e2127;color:#ffffff;border:1px solid #2b3038;border-radius:10px;
          padding:12px;min-height:120px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03);">
          <div style="font-weight:600;color:#8be9fd;margin-bottom:6px;">${title}</div>
          <ul style="margin:0;padding-left:16px;line-height:1.35;">
            ${lines.map(l=>`<li style="margin:0 0 4px 0;">${l}</li>`).join("")}
          </ul>
        </div>
      `;
    }
  }
},


scene2: {
  type: "text",
  text: " ", // required by validator
  render: function (container) {
    container.innerHTML = `
      <div style="
        background:#1e2127;
        color:#ffffff;
        border:1px solid #16f2ff;
        border-radius:12px;
        padding:14px;
        line-height:1.35;
        font-size:.92em;
        box-shadow:
          0 0 6px rgba(22,242,255,.6),
          0 0 16px rgba(22,242,255,.35),
          inset 0 0 0 1px rgba(22,242,255,.15);
      ">
        <div style="margin:0 0 6px 0;">
          <div><span style="color:#8be9fd;"><strong>Subject:</strong></span> C1-AB17 — Messaging Guardrails</div>
          <div><span style="color:#8be9fd;"><strong>From:</strong></span> marta.lopez@c1pluspharma.com (Medical Affairs)</div>
          <div><span style="color:#8be9fd;"><strong>To:</strong></span> stacy.darby@c1pluspharma.com</div>
        </div>
        <hr style="border:none;border-top:1px solid #2b3038;margin:6px 0;">
        <p style="margin:0;">Dear Stacy,</p>
        <p style="margin:0;">Please keep all claims aligned with comparability: PK/PD, immunogenicity, and device human-factors.</p>
        <p style="margin:0;"><strong>No superiority wording.</strong></p>
        <p style="margin:0;">“Comparable efficacy and safety; no clinically meaningful differences.”</p>
        <p style="margin:6px 0 0 0;">Best,<br>Marta</p>
      </div>

      <div style="margin-top:10px;display:flex;justify-content:flex-end;">
        <button
          onclick="loadScene('scene3')"
          style="
            background:#121417;
            color:#e8faff;
            border:1px solid #16f2ff;
            border-radius:8px;
            padding:8px 12px;
            font-size:.9em;
            box-shadow:0 0 8px rgba(22,242,255,.35);
          "
        >Continue</button>
      </div>
    `;
  }
}
,




// S3 — PERSPECTIVE CHOICE (instructional text only; branches rejoin)
scene3: {
  type: "text",
  text:
"Choose which perspective to address first.",
  choices: [
    { text: "Medical — wording discipline", next: "scene4_med" },
    { text: "Sales — field realities",      next: "scene4_sales" }
  ]
},

// S4A — MICRO EMAIL (Medical path): one body line in chunks
scene4_med: {
  type: "scramble",
  // scene4_med
awardOnEnter: 5,

  text: "Arrange the internal email lines in the correct order.",
  scramble: [
    "Best,",
    "to say we are lining up",
    "Dear Marta,",
    "the comparability materials.",
    "I hope this email finds you well.",
    "Just a quick note",
    "Stacy"
  ],
  correct: [
    "Dear Marta,",
    "I hope this email finds you well.",
    "Just a quick note",
    "to say we are lining up",
    "the comparability materials.",
    "Best,",
    "Stacy"
  ],

  next: "scene5"
},

// S4B — MC (Sales path): neutral vs hype
scene4_sales: {
  type: "text",
  // scene4_med


  text: "Select the safest opener for field use.",
  choices: [
    { text: "Our pen is better and patients love it.", next: "scene4_sales_fb_hype" },
    { text: "The pen is comparable in use, with training available.", next: "scene4_sales_fb_correct" }, // correct
    { text: "Switch now; the originator is outdated.", next: "scene4_sales_fb_switch" }
  ]
},

// ❌ Feedback for “better / patients love it”
scene4_sales_fb_hype: {
  type: "text",
  text:
    "Why this is risky:\n" +
    "• “Better” implies superiority and requires head-to-head substantiation that’s usually not permitted in biosimilar launch talk tracks.\n" +
    "• “Patients love it” is a broad, subjective claim (testimonials) and can be seen as promotional.\n\n" +
    "Safer pattern: neutral comparability + support offer (e.g., training).",
  choices: [{ text: "Try again", next: "scene4_sales" }]
},

// ❌ Feedback for “Switch now / originator outdated”
scene4_sales_fb_switch: {
  type: "text",
  text:
    "Why this is risky:\n" +
    "• “Switch now” is a hard call-to-action that can be viewed as aggressive promotion.\n" +
    "• Calling the originator “outdated” is disparaging and implies superiority without fair balance.\n\n" +
    "Safer pattern: keep to approved comparability language and offer resources if the HCP requests.",
  choices: [{ text: "Try again", next: "scene4_sales" }]
},

// ✅ Feedback for the correct choice
scene4_sales_fb_correct: {
  type: "text",
  // scene4_med
awardOnEnter: 5,

  text:
    "Why this is best:\n" +
    "• Uses approved comparability positioning (neutral, non-superiority).\n" +
    "• Focuses on practical support (training) rather than promotional hype.\n" +
    "• Avoids subjective claims and disparagement.\n\n" +
    "Model opener:\n" +
    "“Based on the approved information, the pen is comparable in use; if helpful, we can arrange brief device training for your staff.”",
  choices: [{ text: "Continue", next: "scene5" }]
},


// S5 — REGULATORY VOICEMAIL (instructional bridge)
scene5: {
  type: "text",
  text: "Play the voicemail from Regulatory and answer in reported speech.",
  choices: [{ text: "Play voicemail", next: "scene6" }]
},

// S6 — AUDIO MC (reported speech), balanced options
scene6: {
  type: "interaction-audio-mc",
  text: "Choose the best reported-speech version.",
  audio: "audio/1.mp3",
  options: [
    // A — ✅ Accurate + grammatically correct (tell + obj + to-inf / say + that-clause)
    "Ana said that the agency requires clearer comparability tables this week, no superiority claims, a single PK/PD plus immunogenicity overlay, the device human-factors summary, and delivery by Friday 5 p.m. GMT; if not feasible, we must tell them today.",
    // B — ❌ Grammar errors + accuracy drift
    "Ana said us to submit clearer comparability tables and we must to avoid superiority claims; they want PK/PD and immunogenicity things and device factors, and the deadline can be Friday or later.",
    // C — ❌ Too vague + grammar slip
    "Ana told that the agency wants a clearer table, maybe a PK overlay, and we should email if we can’t; the deadline is sometime this week."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 25,
  endings: { wrong: "scene6_fb", timeout: "scene6_fb" },
  next: "scene7"
},

// S6 feedback — show the two-factor rubric
scene6_fb: {
  type: "text",
  text:
    "Two-factor check:\n\n" +
    "• Accuracy (content): The best answer includes ALL of these: clearer comparability tables (this week); no superiority claims with neutral phrasing; one overlay combining PK/PD + immunogenicity; device human-factors summary; deadline Friday 5 p.m. GMT; and the conditional instruction to notify TODAY if timing is at risk.\n" +
    "• Grammar (form): Prefer “said that …” or “told + object + to-infinitive”. Avoid “said us …” and “must to …”. Keep tense/backshift consistent.\n\n" +
    "Best model answer:\n" +
    "“Ana said that the agency requires clearer comparability tables this week, no superiority claims, a single PK/PD plus immunogenicity overlay, the device human-factors summary, and delivery by Friday 5 p.m. GMT; if not feasible, we must tell them today.”",
  choices: [{ text: "Continue", next: "scene7" }]
}

,

// S7 — ACT I RECAP (concise, mixed grammar, non-linear options)
// S7 — ACT I RECAP (concise, mixed grammar, fixed phrasing)
// S7 — ACT I RECAP (concise, mixed grammar, non-linear options)
scene7: {
  type: "fill-in-the-blank",
  awardOnEnter: 6,
  text: "Act I recap — drag the best words to complete the summary.",
  sentence: [
    "Act I recap: Stacy is ",
    "__________",
    " for launch messaging aligned ",
    "__________",
    " Medical Affairs. She uses ",
    "__________",
    " efficacy and safety language, with ",
    "__________",
    " clinically meaningful differences. The agency requested a single ",
    "__________",
    " overlay; materials are due ",
    "__________",
    " Friday 5 p.m. GMT."
  ],
  blanks: [1, 3, 5, 7, 9, 11],
  options: [
    "under", "PK/PD + immunogenicity", "neutral", "by", "with",
    "no", "responsible", "on", "comparable", "at"
  ],
  correct: [
    "responsible",        // Stacy is responsible …
    "with",               // aligned with Medical Affairs
    "comparable",         // comparable efficacy and safety
    "no",                 // with no clinically meaningful differences
    "PK/PD + immunogenicity", // single overlay requested
    "by"                  // due by Friday 5 p.m. GMT
  ],

  next: "scene8"
},

/* =========================
   ACT II — “Formulary Fit & Tender Readiness”
   (from scene8 onward)
   ========================= */

// =============== ACT II (from scene8 to end of act) ===============

// S8 — Survivor Round 1 (intro)

// =========================
// ACT II — from scene8 on
// =========================

// =========================
// ACT II — from scene8 on
// =========================

/* =========================
   ACT II — continues from scene7 -> scene8
   ========================= */

// S8 — Intro to Survivor Round 1

scene8: {
  type: "text",
  awardOnEnter: 0,
  text: "Survivor Round 1 — Field Openers\n\nYou’ll see three possible openers for a field conversation. Pick the safest tender-compatible line (neutral, non-promotional). A timer will start on the challenge.",
  image: "images/2.png",
  choices: [{ text: "Continue", next: "scene9_quiz1" }]
},

// Survivor Quiz 1 (timed MC) — neutral vs subtly promotional
scene9_quiz1: {
  type: "text",
  text: "Choose the safest opener for field use (tender-safe, non-superiority).",
  timer: 20,
  choices: [
    {
      text: "Preliminary feedback suggests the pen may offer improved ease-of-use; many teams are seeing strong patient acceptance.",
      next: "scene9_quiz1_fb_wrong_hype"
    },
    {
      text: "The pen is comparable in use; training is available on request.",
      next: "scene9_quiz1_fb_correct" // ✅ correct
    },
    {
      text: "Given the originator’s maturity, many centers are transitioning; we can support a quick switch if helpful.",
      next: "scene9_quiz1_fb_wrong_switch"
    }
  ]
},

// ❌ Wrong feedback: subtle “better/patient-preference” hype
scene9_quiz1_fb_wrong_hype: {
  type: "text",
  text:
    "Why it’s risky:\n" +
    "• “Improved ease-of-use” and “strong patient acceptance” imply advantage/testimonial without the needed substantiation for tender contexts.\n" +
    "• Even hedging (“may offer”, “preliminary feedback”) is still promotional drift.\n\n" +
    "Safer pattern: stick to neutral comparability and offer support only on request.",
  choices: [{ text: "Retry", next: "scene9_quiz1" }]
},

// ❌ Wrong feedback: soft push to switch / disparagement-by-implication
scene9_quiz1_fb_wrong_switch: {
  type: "text",
  text:
    "Why it’s risky:\n" +
    "• “Many centers are transitioning” + “quick switch” is a call-to-action and creates peer-pressure implication.\n" +
    "• Calling the originator “mature” to justify change is indirect disparagement.\n\n" +
    "Use neutral comparability language and only offer resources (e.g., training) if requested.",
  choices: [{ text: "Retry", next: "scene9_quiz1" }]
},

// ✅ Correct feedback (unchanged logic)
scene9_quiz1_fb_correct: {
  type: "text",
  awardOnEnter: 5,
  text:
    "Spot on:\n" +
    "• Neutral comparability framing (non-superiority).\n" +
    "• Practical support framed as optional (“available on request”).\n" +
    "• No hype, no disparagement.",
  choices: [{ text: "Continue", next: "scene9a_hangman_tender" }]
},


/* HANGMAN — no retry, no Hub; always proceeds to remedial lesson */
scene9a_hangman_tender: {
  type: "hangman",
  hint: "Hospital purchasing process where suppliers bid under specific terms.",
  target: "tender",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene9a_remedial_tender",      // on win
  onLoseNext: "scene9a_remedial_tender" // on fail
},

scene9a_remedial_tender: {
  type: "text",
  text: "TENDER: A formal hospital/health-system purchasing process with defined criteria and deadlines.\nExample: “Our bid meets tender specifications for supply reliability and training support.”",
  choices: [{ text: "Continue", next: "scene9b_hangman_comparability" }]
},

scene9b_hangman_comparability: {
  type: "hangman",
  hint: "Regulatory concept: similar efficacy/safety; no clinically meaningful differences.",
  target: "comparability",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene9b_remedial_comparability",
  onLoseNext: "scene9b_remedial_comparability"
},

scene9b_remedial_comparability: {
  type: "text",
  text: "COMPARABILITY: The biosimilar shows no clinically meaningful differences in efficacy/safety vs. the reference.\nModel phrasing: “Comparable efficacy and safety; no clinically meaningful differences.”",
  choices: [{ text: "Continue", next: "scene9c_hangman_attestation" }]
},

scene9c_hangman_attestation: {
  type: "hangman",
  hint: "A formal written statement confirming something is true (e.g., supply).",
  target: "attestation",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene9c_remedial_attestation",
  onLoseNext: "scene9c_remedial_attestation"
},

scene9c_remedial_attestation: {
  type: "text",
  text: "ATTESTATION: A signed confirmation (e.g., supply capacity, quality).\nExample: “Please attach the supply attestation to the tender response.”",
  choices: [{ text: "Continue", next: "scene10_buckets" }]
},

scene10_buckets: {
  type: "buckets",
  awardOnEnter: 8,
  text: "Bucket each line: Tender-safe vs Risky/Promotional.",
  buckets: [
    { id: "safe",  label: "Tender-safe" },
    { id: "risky", label: "Risky/Promotional" }
  ],
  tokens: [
    "Comparable efficacy and safety; no clinically meaningful differences.",
    "Training is available on request.",
    "Aligned with Medical Affairs guidance.",
    "Preliminary experience suggests superior ease-of-use.",
    "Many centers are moving away from the originator—consider a rapid transition.",
    "Clinicians report better outcomes with our device."
  ],
  answers: {
    safe: [
      "Comparable efficacy and safety; no clinically meaningful differences.",
      "Training is available on request.",
      "Aligned with Medical Affairs guidance."
    ],
    risky: [
      "Preliminary experience suggests superior ease-of-use.",
      "Many centers are moving away from the originator—consider a rapid transition.",
      "Clinicians report better outcomes with our device."
    ]
  },
  allowExtraInBank: true,
  showAnswerOnWrong: true,

  next: "scene11_bridge_audio2"
},
scene11_bridge_audio2: {
  type: "text",
  text: "Voicemail #2 — Procurement & Regulatory Check-in\n\nListen and then report it back in accurate reported speech: capture all items and keep form correct (said that… / told + object + to-infinitive).",
  choices: [{ text: "Play voicemail", next: "scene12_audio2_mc" }]
},

scene12_audio2_mc: {
  type: "interaction-audio-mc",
  text: "Choose the best reported-speech version.",
  audio: "audio/2.mp3",
  options: [
    "Ana said that for the hospital tender we must keep neutral comparability language, include the PK/PD plus immunogenicity overlay, attach the device human-factors summary, confirm labeling alignment, and submit the supply attestation by Wednesday 12:00 GMT; if any item is at risk, we should tell her today.",
    "Ana said that we must keep neutral comparability language, include PK/PD and immunogenicity as separate overlays, attach the device human-factors summary, confirm labeling alignment, and submit the supply attestation by Wednesday 5 p.m. GMT; if any item is tight, we can update her tomorrow.",
    "Ana said to keep the tone neutral and include the PK/PD overlay, attach a brief device usability note, ensure labeling is aligned, and aim to file by midweek; if timing slips, we should inform the agency."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 30,
  suppressHub: true,
  endings: { wrong: "scene12_fb", timeout: "scene12_fb" },
  next: "scene13_followup_mc"
},

scene12_fb: {
  type: "text",
  text: "Two-factor check:\n\n• Accuracy: Include ALL — neutral comparability; a SINGLE PK/PD + immunogenicity overlay; device human-factors summary; labeling alignment; supply attestation; deadline Wednesday 12:00 GMT; and “tell Ana today” if at risk.\n• The other options miss or distort items (split overlays, wrong time, late/incorrect escalation, or swap HF summary for a generic usability note).",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene12_audio2_mc" }]
},

scene13_followup_mc: {
  type: "text",
  text: "Pick the best follow-up confirmation to send Ana (concise, neutral, action-oriented).",
  choices: [
    {
      // ❌ Professional but non-committal; hedges on scope/timing; no clear actions
      text: "Noted—I'll aim to incorporate most items and circle back if constraints arise; we can revisit the Friday timing depending on stakeholder availability.",
      next: "scene13_followup_fb_wrong_soft"
    },
    {
      // ✅ Clear actions + deadline + same-day risk alert; fully neutral
      text: "Please confirm that wording remains neutral; I’ll ask Evidence to finalize the PK/PD + immunogenicity overlay and attach the device human-factors summary. I’ll also confirm labeling and submit the supply attestation by Wednesday 12:00 GMT; if timing is at risk, I’ll tell you today.",
      next: "scene13_followup_fb_correct"
    },
    {
      // ❌ Subtle superiority + deadline drift masked as pragmatism
      text: "Given emerging clinician preference, we can reflect improved usability in positioning; if the HF review runs long, we’ll adjust and send remaining items early next week.",
      next: "scene13_followup_fb_wrong_hype"
    }
  ]
},

scene13_followup_fb_wrong_soft: {
  type: "text",
  text: "Too vague and non-committal. You hedge on scope and timing and give no concrete actions. Use precise verbs (confirm/check/attach/submit) and keep the Friday deadline with a same-day risk alert (“tell you today if at risk”).",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene13_followup_mc" }]
},

scene13_followup_fb_wrong_hype: {
  type: "text",
  text: "Subtle superiority (“improved usability”) and casual deadline drift are unsafe. Keep strictly neutral comparability language and meet the mandated timeline, escalating **today** if risk persists.",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene13_followup_mc" }]
},

scene13_followup_fb_correct: {
  type: "text",
  awardOnEnter: 6,
  text: "Good: clear actions (confirm, ask, attach, confirm, submit) + exact deadline + same-day escalation if at risk. Tone stays neutral and non-promotional.",
  choices: [{ text: "Continue", next: "scene14_grammar_intro" }]
},

scene14_grammar_intro: {
  type: "text",
  text: "Grammar Run — Recap Act II\n\nYou’ll answer by typing/tapping in 10 second-timed, one-line prompts. Hints appear under each prompt.\nPress Continue when ready.",
  choices: [{ text: "Continue", next: "scene14_grammar_run" }]
},

/* GRAMMAR RUN — retry only, no Hub */
// Replace your current scene14_grammar_run with this
scene14_grammar_run: {
  type: "conjugation-race",
  text: "Timed recap: type the exact word(s). Hints shown under each prompt.",
  timerPer: 10,
  shuffle: true,
  showAnswerOnWrong: true,
  caseInsensitive: true,
  acceptPunctuationVariants: true,
  suppressHub: true,                 // keep users in the gate (no Hub on fail)
  // Scoring gates for your loader’s finish():
  // >= high → endings.high ; >= medium → endings.medium ; else → endings.low
  scoring: { high: 12, medium: 9 },  // pass threshold = 9, perfect = 12
  endings: {
    high:   "scene15_recap_fib",
    medium: "scene15_recap_fib",
    low:    "scene14_grammar_retry"  // FAIL → Retry
  },
  questions: [
    { prompt: "The dossier phrasing implies similarity ___ intended use rather than mechanism.", answers: ["in"], hint: "(at / for / in)" },
    { prompt: "The cover memo should explicitly ___ the overlay combining PK/PD and immunogenicity results.", answers: ["include"], hint: "(attach / include / add)" },
    { prompt: "Clarify the timeline: submissions must reach the portal ___ the close of business Friday (GMT).", answers: ["by"], hint: "(on / at / by)" },
    { prompt: "Phrase the summary neutrally: Comparable efficacy and safety, with ___ signal of clinical relevance.", answers: ["no"], hint: "(not / without / no)" },
    { prompt: "In feedback, the agency explicitly ___ the team to delete any reference to “superiority.”", answers: ["told"], hint: "(said / asked / told)" },
    { prompt: "During review, Ana remarked ___ the device’s HF summary needed to accompany the package.", answers: ["that"], hint: "(about / to / that)" },
    { prompt: "There’s no flexibility here—we ___ alert the agency today if Friday’s delivery might slip.", answers: ["must"], hint: "(should / could / must)" },
    { prompt: "The communication style should stay consistent ___ guidance issued by Medical Affairs.", answers: ["with"], hint: "(by / to / with)" },
    { prompt: "Make sure staff know: training can be arranged ___ request rather than automatically.", answers: ["on"], hint: "(upon / by / on)" },
    { prompt: "When drafting tenders, maintain ___ comparability language rather than evaluative terms.", answers: ["neutral"], hint: "(better / superior / neutral)" },
    { prompt: "Ana later ___ us to verify final wording alignment with Medical Affairs before release.", answers: ["told"], hint: "(told / told to us / said)" },
    { prompt: "The reviewer’s comment was clear: we were asked ___ provide more legible tables this week.", answers: ["to"], hint: "(that / for / to)" }
  ]
},



scene14_grammar_retry: {
  type: "text",
  text: "Quick tip: Watch prepositions (in/by/on/with), keep comparability wording neutral, and use reported speech patterns (said that / told + object + to-infinitive). Try the Grammar Run again.",
  choices: [{ text: "Retry Grammar Run", next: "scene14_grammar_run" }]
},

scene15_recap_fib: {
  type: "fill-in-the-blank",
  awardOnEnter: 15,
  text: "Act II recap — complete the summary.",
  sentence: [
    "Act II recap — obscure edition: For the tender dossier, tone remains ",
    "__________",
    "; assertions make ",
    "__________",
    " reference to superiority. A single ",
    "__________",
    " overlay will be provided, the device ",
    "__________",
    " summary appended, labeling checked for concordance, and the ",
    "__________",
    " filed before the cutoff."
  ],
  blanks: [1, 3, 5, 7, 9],
  options: [
    "human-factors",
    "no",
    "supply attestation",
    "PK/PD + immunogenicity",
    "neutral",
    "with",
    "against",
    "due"
  ],
  correct: [
    "neutral",
    "no",
    "PK/PD + immunogenicity",
    "human-factors",
    "supply attestation"
  ],

  next: "scene16_intro"
},

/* =========================
   ACT III — “Go/No-Go & Escalations”
   ========================= */

// S16 — Dashboard challenge gate (uses loadDashboardScene)
/* =========================
   ACT III — “Go/No-Go & Escalations”
   ========================= */

/* =========================
   ACT III — “Go/No-Go & Escalations”
   ========================= */

scene16_intro: {
  type: "text",
  awardOnEnter: 1,
  text: "Ops triage: identify today’s risks and commit to a compliant plan.\n\nTap Start to open the live dashboard.",
  image: "images/3.png",
  choices: [{ text: "Start", next: "scene16_dashboard" }]
},

scene16_dashboard: {
  type: "dashboard",
  awardOnEnter: 10,
  text: "Act III gate — Identify the critical risks and the safest plan for Friday 17:00 GMT.",
  widgets: [
    { type: "kpi", id: "deadline", label: "Tender Deadline", value: "Fri 17:00 GMT" },
    { type: "kpi", id: "hours",    label: "Hours Remaining", value: "54" },
    { type: "kpi", id: "crit",     label: "Critical Items",  value: "3" },
    { type: "kpi", id: "risk",     label: "Risk Flags",      value: "2 (HF, Attestation)" },
    {
      type: "table",
      id: "workstream",
      label: "Workstreams",
      columns: ["Workstream", "Owner", "Due", "Status", "Risk", "Notes"],
      rows: [
        ["Supply attestation",             "Procurement",  "Today 12:00", "Draft; needs signature", "MED",  "VP sign-off pending; courier ready"],
        ["Device human-factors summary",   "HF/Usability", "Fri 12:00",   "Under external review",  "HIGH", "Validation may slip; contingency needed"],
        ["PK/PD + immunogenicity overlay", "Evidence",     "Today 12:00", "In design",              "MED",  "MA sign-off at 11:30"],
        ["Labeling alignment (wording)",   "Reg Affairs",  "Today 11:00", "Synced",                 "LOW",  "Neutral comparability only"],
        ["Cold-chain SOP confirmation",    "QA",           "Fri 09:00",   "Ready",                  "LOW",  "Attach SOP to packet"]
      ]
    }
  ],
  questions: [
    {
      text: "Which item warrants **same-day escalation** if still at risk by 14:00 **today**?",
      options: [
        "PK/PD + immunogenicity overlay (Evidence)",
        "Device human-factors summary (HF/Usability)",
        "Cold-chain SOP confirmation (QA)",
        "Labeling alignment (Reg Affairs)"
      ],
      correct: 1
    },
    {
      text: "Choose the **compliant plan** that best fits these data.",
      options: [
        "Send everything Friday 17:00; if HF slips, claim superior usability to justify a 24-hour delay.",
        "Keep neutral comparability wording; deliver the overlay by 12:00 today; file the attestation once signed today; if HF still HIGH at 14:00, notify the agency and propose a split (HF within 1 business day).",
        "Combine overlay and attestation into a single PDF Friday afternoon; escalate only if Procurement misses today’s signature.",
        "Ask Evidence for two separate overlays (PK/PD and immunogenicity) to show more detail; push the deadline to Monday."
      ],
      correct: 1
    }
  ],
  suppressHub: true,
  next: "scene17_audio_intro"
},

scene17_audio_intro: {
  type: "text",
  text: "Voicemails — Report back in accurate reported speech. Capture content + form (said that … / told + object + to-infinitive).",
  choices: [{ text: "Play voicemail #1", next: "scene18_audio1_mc" }]
},

/* Extra audio challenge added before branching */
scene18_audio1_mc: {
  type: "interaction-audio-mc",
  text: "Voicemail #1 — Choose the best reported-speech version.",
  audio: "audio/3.mp3",
  options: [
    "Ana said that we must keep neutral comparability wording, deliver the single PK/PD + immunogenicity overlay by 12:00 today, send the signed supply attestation today, and—if human-factors remains high risk by 14:00—notify the agency before close of business and propose a split with human-factors within one business day.",
    "Ana said to keep the tone neutral and submit separate PK/PD and immunogenicity overlays; escalate to the agency tomorrow morning if human-factors is still risky, and send the attestation by Friday 17:00.",
    "Ana told us to keep a neutral tone overall; we can attach a short usability note instead of human-factors, and update the agency later this week if anything slips."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 30,
  suppressHub: true,
  endings: { wrong: "scene18_fb", timeout: "scene18_fb" },
  next: "scene18b_audio2_mc"
},

scene18_fb: {
  type: "text",
  text:
    "Two-factor check:\n\n" +
    "• Accuracy: SINGLE PK/PD + immunogenicity overlay by 12:00 today; attestation **today**; if HF still HIGH by 14:00, notify **today** and propose split (HF within 1 business day).\n" +
    "• Form: reported speech (“said that … / told + object + to-infinitive”).",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene18_audio1_mc" }]
},

scene18b_audio2_mc: {
  type: "interaction-audio-mc",
  text: "Voicemail #2 — Supply attestation dependency.",
  audio: "audio/4.mp3",
  options: [
    // ✅ Correct: same-day signature; courier ready; escalate by 12:00 for delegated signer
    "Procurement said the attestation is drafted and needs VP signature today; courier is ready for physical copy. If the VP is not available by 12:00, Ana told us to notify her immediately so she can arrange a delegated signer.",
    // ❌ Polished but wrong: accepts Friday signature; proposes admin workaround instead of escalation
    "Procurement confirmed the attestation is drafted; if the VP is tied up, we’ll slot the signature for Friday and coordinate courier collection accordingly—no immediate escalation required.",
    // ❌ Sounds practical but wrong: proposes sending an unsigned or placeholder version and defers the actual signature
    "Procurement indicated we can transmit a placeholder (unsigned) attestation for the packet today and forward the fully executed copy early next week, avoiding same-day escalation."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 28,
  suppressHub: true,
  endings: { wrong: "scene18b_fb", timeout: "scene18b_fb" },
  next: "scene19_branch_pick"
},

scene18b_fb: {
  type: "text",
  text:
    "Lock the dependency:\n" +
    "• Signature is **required today**; courier is already staged.\n" +
    "• If the VP isn’t available by **12:00**, escalate immediately for a **delegated signer**.\n" +
    "• Do not accept a Friday slot or send an unsigned/placeholder version.",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene18b_audio2_mc" }]
},


scene19_branch_pick: {
  type: "text",
  awardOnEnter: 4,
  text: "Which follow-up do you tackle first?",
  choices: [
    { text: "A) Agency escalation plan (HF contingency)", next: "scene20_escalation_audio" },
    { text: "B) Evidence alignment (overlay sign-off)",   next: "scene20b_evidence_audio" }
  ],
  suppressHub: true
},

scene20_escalation_audio: {
  type: "interaction-audio-mc",
  text: "Agency briefing — pick the best reported-speech version.",
  audio: "audio/5.mp3",
  options: [
    // ✅ Correct: neutral briefing, on-time packet, SINGLE overlay, HF within 1 business day, same-day 16:00 update
    "Ana told Stacy to brief the agency neutrally: submit the tables, labeling confirmation, the single PK/PD + immunogenicity overlay, and the attestation on time; if needed, send the human-factors summary within one business day; confirm no superiority language and provide a same-day update by 16:00.",
    // ❌ Polished but wrong: slips into superiority and pushes timing to Monday; no same-day update
    "Ana asked for a confident briefing that highlights usability advantages and consolidates delivery early Monday to preserve completeness; an end-of-day recap today isn’t necessary as long as the agency gets a comprehensive package next week.",
    // ❌ Professional tone but wrong: splits the overlay and defers the update; HF timing off
    "Ana said to provide separate PK and immunogenicity overlays for transparency, keep the tone neutral, and forward the attestation with the packet; if human-factors runs late, send it within 48 hours and share a status summary the next business day rather than today at 16:00."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 28,
  suppressHub: true,
  endings: { wrong: "scene20_fb", timeout: "scene20_fb" },
  next: "scene21_merge"
},

scene20_fb: {
  type: "text",
  text:
    "Lock the brief:\n" +
    "• On-time packet: tables, label confirmation, **single** PK/PD + immunogenicity overlay, attestation.\n" +
    "• HF may follow **within 1 business day** (not 48h or Monday).\n" +
    "• **Same-day update by 16:00** (not next business day).\n" +
    "• No superiority language.",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene20_escalation_audio" }]
}
,

scene20b_evidence_audio: {
  type: "interaction-audio-mc",
  text: "Evidence/MA timing — choose the best reported-speech version.",
  audio: "audio/6.mp3",
  options: [
    "Ana said the overlay reaches Medical Affairs at 11:30 and can finalize by 12:00 if wording is unchanged; axis labels and immunogenicity rates must match the label; if MA edits extend past noon, we must notify her to decide between hold or split.",
    "Ana told us to finalize by 17:00 regardless of MA input, split the PK and immunogenicity into two charts, and adjust rates even if they differ from the label.",
    "Ana said MA will look at it today and we can send a version later this week; no need to flag timing unless it becomes critical."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 28,
  suppressHub: true,
  endings: { wrong: "scene20b_fb", timeout: "scene20b_fb" },
  next: "scene21_merge"
},

scene20b_fb: {
  type: "text",
  text:
    "Details matter: MA review 11:30 → finalize 12:00 **if unchanged**; labels/rates must mirror label; if edits push past noon, escalate immediately (hold vs split).",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene20b_evidence_audio" }]
},

scene21_merge: {
  type: "text",
  awardOnEnter: 5,
  text:
    "Alignment check complete. Keep comparability language neutral, hit today’s milestones (overlay + attestation), and be ready to escalate HF at 14:00 if risk persists.\n\nContinue to a quick phrasing check.",
  image: "images/5.png",
    suppressHub: true,
  choices: [{ text: "Continue", next: "scene22_alignment_mc" }]
},
scene22_alignment_mc: {
  type: "text",
  text: "Pick the safest line for the agency update (one sentence).",
  choices: [
    {
      text: "To aid clarity, we’ll provide separate PK and immunogenicity visuals and adjust rates for readability; if Medical Affairs requests refinements, we may extend delivery to ensure accuracy.",
      next: "scene22_alignment_fb"   // ❌ splits overlay + opens door to delay
    },
    {
      text: "We’ll highlight observed usability advantages and, given reviewer bandwidth, target early next week for the human-factors memo while we finalize remaining materials.",
      next: "scene22_alignment_fb"   // ❌ superiority vibe + delays HF
    },
    {
      text: "We’ll submit all materials on time and, if needed, send the human-factors summary within one business day; no clinically meaningful differences are claimed.",
      next: "scene23_live_intro"     // ✅ neutral comparability + on-time + HF split
    }
  ],
  suppressHub: true
},


scene22_alignment_fb: {
  type: "text",
  text: "Avoid superiority, deadline drift, and splitting the overlay. Keep neutral comparability language and the HF one-business-day contingency.",
  suppressHub: true,
  choices: [{ text: "Retry", next: "scene22_alignment_mc" }]
},

/* ===== 4-step, timed interactive sequence — Stacy’s responses ===== */

scene23_live_intro: {
  type: "text",
  text: "LIVE CALL — Agency reviewer on the line. Choose Stacy’s responses. Timed.",
  image: "images/6.png",
  suppressHub: true,
  choices: [{ text: "Begin", next: "scene24_live1" }]
},

// 1/4 — Opening
/* -------- 24/27 — LIVE CALL: Claims stance -------- */
/* -------- 24/27 — LIVE CALL: Claims stance -------- */
scene24_live1: {
  type: "interaction-audio-mc",
  text: "Reviewer speaks; confirm claims stance (timer starts after audio).",
  audio: "audio/7.mp3",                    // Reviewer prompt
  options: ["audio/8.mp3","audio/9.mp3","audio/10.mp3"], // Stacy replies
  correct: 1,                               // CORRECT = audio/9.mp3
  shuffleOptions: true,
  timer: 14,
  suppressHub: true,
  endings: { wrong: "scene24_live1_wrong", timeout: "scene24_live1_timeout" },
  next: "scene25_live2"
},
scene24_live1_wrong: {
  type: "text",
  text: "Tip: Keep to neutral comparability (no superiority). Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},
scene24_live1_timeout: {
  type: "text",
  text: "Time’s up. Confirm neutral comparability quickly next time. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},

/* -------- 25/27 — LIVE CALL: Timing + portal constraint -------- */
scene25_live2: {
  type: "interaction-audio-mc",
  text: "Reviewer speaks; confirm timing & 10 MB single-PDF limit (timer starts after audio).",
  audio: "audio/11.mp3",                   // Reviewer prompt
  options: ["audio/12.mp3","audio/13.mp3","audio/14.mp3"], // Stacy replies
  correct: 2,                               // CORRECT = audio/14.mp3
  shuffleOptions: true,
  timer: 14,
  suppressHub: true,
  endings: { wrong: "scene25_live2_wrong", timeout: "scene25_live2_timeout" },
  next: "scene26_live3"
},
scene25_live2_wrong: {
  type: "text",
  text: "Tip: Single PDF (<10 MB) today; overlay by 12:00; signed attestation today; 14:00 HF escalation rule. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},
scene25_live2_timeout: {
  type: "text",
  text: "Time’s up. Lock the 12:00/14:00 specifics and the single-PDF limit. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},

/* -------- 26/27 — LIVE CALL: HF contingency + risky phrase request -------- */
scene26_live3: {
  type: "interaction-audio-mc",
  text: "Reviewer speaks; handle HF contingency & the ‘easy to use’ request (timer starts after audio).",
  audio: "audio/15.mp3",                   // Reviewer prompt
  options: ["audio/16.mp3","audio/17.mp3","audio/18.mp3"], // Stacy replies
  correct: 2,                               // CORRECT = audio/18.mp3
  shuffleOptions: true,
  timer: 14,
  suppressHub: true,
  endings: { wrong: "scene26_live3_wrong", timeout: "scene26_live3_timeout" },
  next: "scene27_live4"
},
scene26_live3_wrong: {
  type: "text",
  text: "Tip: Don’t adopt ‘easy to use.’ Keep neutral; commit to HF within 1 business day + same-day update. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},
scene26_live3_timeout: {
  type: "text",
  text: "Time’s up. Use the neutral phrasing and the one-business-day HF split. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},

/* -------- 27/27 — LIVE CALL: One-sentence commitment -------- */
scene27_live4: {
  type: "interaction-audio-mc",
  text: "Reviewer speaks; give a one-sentence commitment (timer starts after audio).",
  audio: "audio/19.mp3",                   // Reviewer prompt
  options: ["audio/20.mp3","audio/21.mp3","audio/22.mp3"], // Stacy replies
  correct: 1,                               // CORRECT = audio/21.mp3
  shuffleOptions: true,
  timer: 14,
  suppressHub: true,
  endings: { wrong: "scene27_live4_wrong", timeout: "scene27_live4_timeout" },
  next: "scene28_live_outcome"
},
scene27_live4_wrong: {
  type: "text",
  text: "Tip: One sentence: on-time packet, neutral wording, HF within 1 business day, same-day notice. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},
scene27_live4_timeout: {
  type: "text",
  text: "Time’s up. Deliver the concise commitment with the HF contingency. Restart the live call.",
  suppressHub: true,
  choices: [{ text: "Restart live call", next: "scene23_live_intro" }]
},

scene28_live_outcome: {
  type: "text",
  text: "Reviewer: “Acknowledged. Proceed as committed.”\n\nAct III complete — you aligned timing, scope, and contingency without promotional drift.",
  image: "images/7.png",
  suppressHub: true,
  choices: [{ text: "Continue", next: "scene29_intro" }]
},


/* =========================
   ACT IV — “Operational Proof & Live Review”
   Prep (hangman → scramble → FIB → dashboard) → Live multi-clip challenge
   ========================= */

scene29_intro: {
  type: "text",
  image: "images/4.png",
  text: "Act IV — Final Review Prep\n\nYou’ll face a live, multi-clip review with the agency. First, a rapid warm-up on key contingencies: cold-chain excursions, serialization/traceability, PV vs. use-error, and GDPR. Then you’ll enter the real-time exchange.",
  choices: [{ text: "Begin prep", next: "scene29a_hangman_excursion" }]
},

/* ---- HANGMAN (no retries, always proceeds to remedial) ---- */
scene29a_hangman_excursion: {
  type: "hangman",
  hint: "Cold-chain: a brief temperature deviation from the qualified range.",
  target: "excursion",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene29a_remedial_excursion",
  onLoseNext: "scene29a_remedial_excursion"
},
scene29a_remedial_excursion: {
  type: "text",
  text: "EXCURSION: A documented temperature deviation assessed against stability data.\nProtocol: quarantine → assess vs. qualified excursion window → document CAPA → replace stock if out of window → attach the excursion report.",
  choices: [{ text: "Continue", next: "scene30_scramble" }]
},

/* ---- SCRAMBLE (soft-skills + agenda clarity) ---- */
/* ---- SCRAMBLE (soft skills + grammar: forced order via dependencies) ---- */
scene30_scramble: {
  type: "scramble",
  text: "Arrange Stacy’s agenda. Look for grammatical dependencies (which → which in turn → then → finally).",
  scramble: [
    "which in turn informs pharmacovigilance for device use-error reporting,",
    "In today’s review, we’ll first confirm cold-chain excursion handling,",
    "then we’ll note GDPR compliance for staff lists,",
    "which supports serialization and recall traceability,",
    "and, finally, we’ll close with a quick boundary check."
  ],
  correct: [
    "In today’s review, we’ll first confirm cold-chain excursion handling,",
    "which supports serialization and recall traceability,",
    "which in turn informs pharmacovigilance for device use-error reporting,",
    "then we’ll note GDPR compliance for staff lists,",
    "and, finally, we’ll close with a quick boundary check."
  ],

  next: "scene31_fib"
},


/* ---- FIB (target terminology, non-linear options) ---- */
scene31_fib: {
  type: "fill-in-the-blank",
  text: "Complete the contingency statements.",
  sentence: [
    "A brief 9.1 °C spike is logged as an ",
    "__________",
    " and assessed against ",
    "__________",
    ". We commit to ",
    "__________",
    " stock if outside the window, and attach the report."
  ],
  blanks: [1, 3, 5],
  options: [
    "excursion",
    "qualified stability data",
    "replacing",
    "tamper-evident seal",
    "DataMatrix",
    "minimum necessary"
  ],
  correct: ["excursion", "qualified stability data", "replacing"],

  next: "scene32_dashboard_intro"
},

/* ---- DASHBOARD (read & reason) ---- */
/* ---- DASHBOARD INTRO ---- */
scene32_dashboard_intro: {
  type: "text",
  awardOnEnter: 1,
  text: "Prep dashboard — confirm you can read the contingencies at a glance, then answer one gate.\n\nTap Continue to open the board.",
  choices: [{ text: "Continue", next: "scene33_dashboard" }]
},

/* ---- DASHBOARD (one gate) ---- */
scene33_dashboard: {
  type: "dashboard",
  awardOnEnter: 9,
  text: "Final prep gate — choose the safest plan given these exhibits/timelines.",
  widgets: [
    { type: "kpi", id: "deadline", label: "Tender Deadline", value: "Fri 17:00 GMT" },
    { type: "kpi", id: "hfRisk",   label: "HF Risk",         value: "HIGH (review external)" },
    { type: "kpi", id: "gdpr",     label: "GDPR Check",      value: "DPA in place; min data" },
    // 👇 Added KPI so the table sits below the KPIs on a new row
    { type: "kpi", id: "today",    label: "Today Milestones", value: "Overlay + Attestation" },

    {
      type: "table",
      id: "exhibits",
      label: "Exhibits to prepare",
      columns: ["Exhibit", "Owner", "Due", "Status", "Notes"],
      rows: [
        ["PK/PD + immunogenicity overlay", "Evidence", "Today 12:00", "Finalizing", "Mirror label; MA sign-off 11:30"],
        ["Supply attestation (signed)",     "Procure.", "Today 12:00", "Pending sig", "Delegated signer if VP absent"],
        ["HF summary",                      "Usability","+1 business day", "At risk", "Escalate 14:00 if still HIGH"],
        ["GDPR consent line (training)",    "Compliance","Today", "Ready", "Use minimum necessary; DPA active"]
      ]
    }
  ],
  questions: [
    {
      text: "Which plan is compliant and lowest risk *today*?",
      options: [
        "Send an unsigned attestation now; promise signature next week.",
        "Split the overlay into two charts to look more detailed.",
        "Escalate HF at 14:00 if still HIGH; submit signed attestation and single overlay today; keep GDPR to minimum necessary data under DPA.", // correct
        "Promise better pricing than the reference in the narrative to offset risk."
      ],
      correct: 2
    }
  ],
  next: "scene34_video_intro"
},


/* =========================
   LIVE VIDEO CHALLENGE (reviewer on video, Stacy’s replies as TEXT)
   Pattern: video-choice → on wrong: reviewer wrong-nudge video → text explain → back to intro
   ========================= */

scene34_video_intro: {
  type: "text",
  image: "images/5.png",
  text: "Live review — on record.\n\nHow it works:\n• The reviewer appears on video.\n• You have 14 seconds to choose Stacy’s best *text* reply.\n• Wrong or timeout → brief correction video → note → restart from here.\n• Clear all four in a row to finish Act IV.",
  choices: [{ text: "Begin live review", next: "scene35_v1" }]
},

/* ------- V1: Pricing & promotional neutrality ------- */
/* Prompt video */
/* ========= V1 — Pricing & neutrality ========= */
scene35_v1: {
  type: "video-choice",
  videoSrc: "videos/1.mp4",         // Reviewer prompt
  timer: 14,
  shuffleOptions: true,             // <-- randomize order
  timeoutNext: "scene35_timeout",   // <-- dedicated timeout
  choices: [
    // WRONG 1 → videos/2.mp4
    {
      text: "We’ll present pricing contextually to highlight competitive value while avoiding overt superiority language; this way the narrative reflects our market positioning alongside the formal forms.",
      next: "scene35_wrong1"
    },
    // CORRECT → proceeds to V2
    {
      text: "We’ll keep pricing strictly within the procurement forms and maintain a neutral narrative—no comparative or superiority framing in any text outside those forms.",
      next: "scene36_v2"
    },
    // WRONG 2 → videos/3.mp4
    {
      text: "We plan to indicate that we can match or beat reference pricing where feasible, noting this explicitly in the narrative so evaluators have a transparent view of our competitiveness.",
      next: "scene35_wrong2"
    }
  ]
},
scene35_wrong1: { type: "video", videoSrc: "videos/2.mp4", next: "scene35_wrong1_text" },
scene35_wrong1_text: {
  type: "text",
  text: "“Competitive value” in the narrative reads as comparative positioning. In tenders, keep pricing in the official forms; the narrative must remain non-promotional and neutral.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene35_wrong2: { type: "video", videoSrc: "videos/3.mp4", next: "scene35_wrong2_text" },
scene35_wrong2_text: {
  type: "text",
  text: "“Match or beat” is promotional. Pricing belongs in the forms; do not make comparative commitments in the narrative.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene35_timeout: {
  type: "text",
  text: "Time’s up. Keep answers concise and compliant, then try again.",
  suppressHub: true,
  choices: [{ text: "Try again", next: "scene34_video_intro" }]
},

/* ========= V2 — Serialization & recall traceability ========= */
scene36_v2: {
  type: "video-choice",
  videoSrc: "videos/5.mp4",         // Reviewer prompt
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene36_timeout",
  choices: [
    // WRONG 1 → videos/6.mp4
    {
      text: "We’ll underscore that our recall pathways are faster than the reference product by leveraging real-time dashboards to expedite actions across sites.",
      next: "scene36_wrong1"
    },
    // CORRECT → proceeds to V3
    {
      text: "We’ll mirror the label and our validated SOPs for serialization and recall traceability without implying performance advantages; statements stay scope-accurate and evidence-based.",
      next: "scene37_v3"
    },
    // WRONG 2 → videos/7.mp4
    {
      text: "We’ll state that we can provide real-time product traceability across all hospitals, ensuring universal dashboard coverage regardless of local implementation.",
      next: "scene36_wrong2"
    }
  ]
},
scene36_wrong1: { type: "video", videoSrc: "videos/6.mp4", next: "scene36_wrong1_text" },
scene36_wrong1_text: {
  type: "text",
  text: "Claiming a faster recall pathway is a performance comparison. Keep wording label-consistent and SOP-based—no implied advantage.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene36_wrong2: { type: "video", videoSrc: "videos/7.mp4", next: "scene36_wrong2_text" },
scene36_wrong2_text: {
  type: "text",
  text: "Universal real-time traceability overreaches validated scope. Limit statements to implemented, documented capability.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene36_timeout: {
  type: "text",
  text: "Time’s up. Keep it label-consistent and SOP-true. Try again.",
  suppressHub: true,
  choices: [{ text: "Try again", next: "scene34_video_intro" }]
},

/* ========= V3 — Cold-chain excursions ========= */
scene37_v3: {
  type: "video-choice",
  videoSrc: "videos/9.mp4",         // Reviewer prompt
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene37_timeout",
  choices: [
    // CORRECT → proceeds to V4
    {
      text: "We’ll notify the hospital pharmacy immediately within the SOP window and, where required, the competent authority; a preliminary notice precedes the RCA/CAPA, which follows per procedure.",
      next: "scene38_v4"
    },
    // WRONG 1 → videos/10.mp4
    {
      text: "We’ll complete the full root-cause analysis to ensure accuracy, then notify stakeholders once the CAPA plan is finalized and approved.",
      next: "scene37_wrong1"
    },
    // WRONG 2 → videos/11.mp4
    {
      text: "We’ll coordinate first with our distributor to verify details and consolidate information; broader notifications can follow after we have a complete picture.",
      next: "scene37_wrong2"
    }
  ]
},
scene37_wrong1: { type: "video", videoSrc: "videos/10.mp4", next: "scene37_wrong1_text" },
scene37_wrong1_text: {
  type: "text",
  text: "Initial notice must occur within the SOP window—before a full RCA/CAPA is finished. RCA/CAPA follows; notice cannot wait.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene37_wrong2: { type: "video", videoSrc: "videos/11.mp4", next: "scene37_wrong2_text" },
scene37_wrong2_text: {
  type: "text",
  text: "Distributor-only escalation is insufficient. Notify the hospital pharmacy and, where required, the authority—on time per SOP.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene37_timeout: {
  type: "text",
  text: "Time’s up. Lead with SOP-timed notifications, then RCA/CAPA. Try again.",
  suppressHub: true,
  choices: [{ text: "Try again", next: "scene34_video_intro" }]
},

/* ========= V4 — GDPR for staff lists ========= */
scene38_v4: {
  type: "video-choice",
  videoSrc: "videos/13.mp4",        // Reviewer prompt
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene38_timeout",
  choices: [
    // WRONG 1 → videos/14.mp4
    {
      text: "We’ll request the full training roster by email and retain it for follow-on coordination across markets; this will streamline future sessions with the same teams.",
      next: "scene38_wrong1"
    },
    // CORRECT → final ack
    {
      text: "We’ll rely on a documented lawful basis under a DPA, limit access to the minimum necessary for scheduling, and avoid repurposing any personal data beyond training logistics.",
      next: "scene39_final_ack"
    },
    // WRONG 2 → videos/15.mp4
    {
      text: "We’ll assume consent from attendance at sessions and circulate staff lists to partners so scheduling and communications can be broadly coordinated.",
      next: "scene38_wrong2"
    }
  ]
},
scene38_wrong1: { type: "video", videoSrc: "videos/14.mp4", next: "scene38_wrong1_text" },
scene38_wrong1_text: {
  type: "text",
  text: "Emailing a full roster and reusing it breaches data-minimization and purpose-limitation. Use a lawful basis under a DPA and keep access minimum-necessary.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene38_wrong2: { type: "video", videoSrc: "videos/15.mp4", next: "scene38_wrong2_text" },
scene38_wrong2_text: {
  type: "text",
  text: "Consent can’t be assumed. Limit use to training logistics with a lawful basis and strict access controls.",
  suppressHub: true,
  choices: [{ text: "Return to video start", next: "scene34_video_intro" }]
},
scene38_timeout: {
  type: "text",
  text: "Time’s up. Think: lawful basis, minimum necessary, purpose limitation. Try again.",
  suppressHub: true,
  choices: [{ text: "Try again", next: "scene34_video_intro" }]
},

/* ========= Final acknowledgment (success) ========= */
scene39_final_ack: {
  type: "video",
  awardOnEnter: 13,
  videoSrc: "videos/16.mp4",
  next: "scene40_v4_wrap"
},
scene40_v4_wrap: {
  type: "text",
  text: "Reviewer: “Thank you, Stacy. That addresses our concerns.”\n\nAct IV complete — you managed pricing neutrality, label-consistent serialization, SOP-timed cold-chain notifications, and GDPR-compliant logistics.",
  image: "images/8.png",
  suppressHub: true,
  choices: [{ text: "Continue", next: "scene41_email" }]
},

/* ===== WRAP-UP — Email to Instructor (engine-native) ===== */

/* If your current final video outcome scene doesn't point here yet,
   update its next to: "scene41_email" */

scene41_email: {
  type: "email",
  awardOnEnter: 2,
  text: "Final task — send a short reflection to your instructor (what happened, why it mattered, and what you’d do next time). Aim for ~180–250 words.",
  teacherEmail: "soniaalvarez@atribord.com",
  emailSubject: "Pharma to Market — Launch Review Reflection (Act I–IV)",
  emailBody: "",
  next: "email_sent_confirm"
},


email_sent_confirm: {
  type: "text",
  text: "✅ Email sent! Thanks for your reflection.",
  image: "images/9.png",
  choices: [{ text: "Continue", next: "thank_you_scene" }]
},

thank_you_scene: {
  type: "text",
  image: "images/10.png",
  text: "Thank you for playing *Pharma to Market*. You can replay scenes to improve time or accuracy, or for a general review!",
  endOfCourse: true,
  finishOnEnter: false,
  scoreRaw: 100,
  choices: [{ text: "Play again", next: "scene1" }]
}




};









// Try to attach "fresh start" to whatever your start/play control is
function attachPlayHandlers(firstSceneId = "scene1") {
  const selectors = [
    '#play-btn',       // common id
    '#start-btn',
    '#start',
    '[data-action="play"]',
    '[data-role="play"]',
    '.js-play',
    '.js-start',
    'button[href="#play"]',    // sometimes used
  ];

  let hooked = false;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.addEventListener('click', (e) => {
      try { e.preventDefault(); } catch(_) {}
      window.startFreshAttempt(firstSceneId);
    }, { once:false });
    hooked = true;
  }

  // Intercept common inline/global starters if your HTML uses them
  window.playNow   = () => window.startFreshAttempt(firstSceneId);
  window.startGame = () => window.startFreshAttempt(firstSceneId);
  window.start     = () => window.startFreshAttempt(firstSceneId);

  // Return whether we actually found something to hook
  return hooked;
}

// === Start a brand-new LMS attempt (wipe score, status, awards, bookmark) ===
window.startFreshAttempt = function(firstSceneId = "scene1") {
  try {
    // Tell hydrator not to pull existing awards this time
    window.__FRESH_START__ = true;

    // Local state
    try { localStorage.removeItem("awarded_scenes_v2"); } catch {}
    try { localStorage.removeItem("awarded_scenes_v1"); } catch {}
    try { localStorage.removeItem("game_progress_v1"); } catch {}
    window.__awarded = new Set();
    // Ensure denominator
    let total = 0;
    for (const sc of Object.values(window.scenes || {})) {
      const pts = Number(sc?.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    }
    window.__TOTAL_AWARD_MAX = total;
    window.score = { cur: 0, max: total };

    // LMS reset
    if (window.SCORM && SCORM.init && SCORM.init()) {
      SCORM.set("cmi.suspend_data", "");                // drop saved awards
      SCORM.set("cmi.core.score.raw", "0");             // reset % to 0
      // “incomplete” is a safe initial status for SCORM 1.2 fresh runs
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.set("cmi.core.lesson_location", String(firstSceneId));
      SCORM.commit();
    }

    // Do NOT reconcile/publish here—wait until gameplay
    if (typeof hideHome === "function") hideHome();
    if (typeof window.loadScene === "function") window.loadScene(firstSceneId);
  } catch (e) {
    console.warn("[FreshAttempt] reset failed:", e);
    // As a fallback, still try to launch
    if (typeof hideHome === "function") hideHome();
    if (typeof window.loadScene === "function") window.loadScene(firstSceneId);
  }
};


// --- Single source of truth: merge + write LMS state ---
window.writeLMSState = function ({ sceneId, awarded }) {
  try {
    if (!(window.SCORM && SCORM.init && SCORM.init())) return;

    // 1) read existing
    let existing = [];
    try {
      const prev = SCORM.get("cmi.suspend_data");
      if (prev && prev.trim()) {
        const j = JSON.parse(prev);
        if (j && Array.isArray(j.awarded)) existing = j.awarded;
      }
    } catch (_) {}

    // 2) merge LMS + in-memory + explicit
    const merged = new Set(existing);
    if (window.__awarded instanceof Set) window.__awarded.forEach(x => merged.add(x));
    if (awarded instanceof Set) awarded.forEach(x => merged.add(x));
    else if (Array.isArray(awarded)) awarded.forEach(x => merged.add(x));

    // 3) bookmark + write back + commit
    if (sceneId) SCORM.set("cmi.core.lesson_location", String(sceneId));
    const sd = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
    SCORM.set("cmi.suspend_data", sd);
    SCORM.commit();

    console.log("[SCORM] suspend_data merged; awards count:", merged.size);
  } catch (e) {
    console.warn("[SCORM] writeLMSState failed:", e);
  }
};



/* ===== Scoring bootstrap (runs once, right after scenes) ===== */

// 1) Minimal score model
window.score = window.score || { cur: 0, max: 0 };

// 2) Sum TOTAL points from all scenes that have awardOnEnter
window.__computeAwardTotalOnce = function () {
  try {
    const all = window.scenes || {};
    let total = 0;
    Object.entries(all).forEach(([id, sc]) => {
      const pts = Number(sc && sc.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    });
    window.__TOTAL_AWARD_MAX = total;
    window.score.max = total;           // lock denominator
    console.log("[Score bootstrap] TOTAL_AWARD_MAX =", total);
  } catch (e) { console.warn("computeAwardTotalOnce failed", e); }
};

// === Self-healing reconciler (FUNDAE: pass at/over 75%; anti-demotion; force 100% when max hit) ===
window.__reconcileAwardsToScore = function () {
  try {
    // --- Ensure denominator from scenes ---
    let total = Number(window.__TOTAL_AWARD_MAX || 0);
    if (!(Number.isFinite(total) && total > 0)) {
      total = 0;
      const allScenes = window.scenes || {};
      for (const sc of Object.values(allScenes)) {
        const pts = Number(sc && sc.awardOnEnter);
        if (Number.isFinite(pts) && pts > 0) total += pts;
      }
      window.__TOTAL_AWARD_MAX = total;
    }

    if (!window.score) window.score = { cur: 0, max: 0 };
    if (!(Number.isFinite(window.score.max) && window.score.max > 0)) {
      window.score.max = total;
    }

    // --- Rebuild current from awarded set ---
    let cur = 0;
    const awardedSet = new Set(Array.from(window.__awarded || []));
    const all = window.scenes || {};
    for (const sid of awardedSet) {
      const pts = Number(all[sid]?.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) cur += pts;
    }
    window.score.cur = cur;

    // --- Compute % ---
    const max = Math.max(0, Number(window.score.max || 0));
    let raw = (max > 0) ? Math.round(100 * cur / max) : 0;

    if (window.SCORM && SCORM.init && SCORM.init()) {
      // (A) Anti-demotion: never publish lower than what LMS already has
      try {
        const r = SCORM.get && SCORM.get("cmi.core.score.raw");
        if (r && !isNaN(+r)) {
          const lmsRaw = +r;
          if (lmsRaw > raw) raw = lmsRaw;
        }
      } catch(_) {}

      // (B) Force 100 + passed when cur>=max
      if (max > 0 && cur >= max) {
        raw = 100;
      }

      // score
      SCORM.set("cmi.core.score.raw", String(raw));

      // mastery: LMS masteryscore wins; else default 75 (FUNDAE baseline)
      let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;
      try {
        const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
        if (m && !isNaN(+m)) mastery = +m;
      } catch (_) {}

      // status: pass automatically when raw ≥ mastery; never demote if already passed
      const st = (SCORM.get && SCORM.get("cmi.core.lesson_status")) || "not attempted";
      if (raw >= mastery) {
        if (st !== "passed") SCORM.set("cmi.core.lesson_status", "passed");
      } else {
        if (st === "not attempted" || st === "unknown") {
          SCORM.set("cmi.core.lesson_status", "incomplete");
        }
        // do not demote if already passed
      }

      // bookmark
      if (window.currentSceneId) {
        SCORM.set("cmi.core.lesson_location", String(window.currentSceneId));
      }

      // merge awards into suspend_data (never drop older awards)
      try {
        let existing = [];
        const prev = SCORM.get && SCORM.get("cmi.suspend_data");
        if (prev) {
          try {
            const pj = JSON.parse(prev);
            if (pj && Array.isArray(pj.awarded)) existing = pj.awarded;
          } catch(_) {}
        }
        const merged = new Set(existing);
        for (const x of awardedSet) merged.add(x);
        const sd = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
        SCORM.set("cmi.suspend_data", sd);
      } catch(_) {}

      SCORM.commit();
    }

    console.log(`[SCORM][reconcile] cur/max: ${cur} / ${max} raw: ${raw}% ; TOTAL_AWARD_MAX: ${window.__TOTAL_AWARD_MAX}`);
  } catch (e) {
    console.warn("[SCORM][reconcile] failed:", e);
  }
};






// 4) Run both immediately (no waiting on anything else)
if (!Number.isFinite(window.score?.max) || window.score.max === 0) {
  window.__computeAwardTotalOnce();
}
/* --- SCORM fresh-attempt guard: ignore stale web awards in LMS --- */
try {
  if (window.SCORM && SCORM.init && SCORM.init()) {
    const st = SCORM.get && SCORM.get("cmi.core.lesson_status");
    const sd = SCORM.get && SCORM.get("cmi.suspend_data");
    const fresh = (!sd || sd === "") && (!st || st === "not attempted" || st === "unknown" || st === "");
    if (fresh) {
      window.__awarded = new Set();                   // drop local carryover
      if (typeof awardPersistSave === 'function') awardPersistSave();
      const max = Number(window.__TOTAL_AWARD_MAX || window.score?.max || 0);
      window.score = { cur: 0, max: max > 0 ? max : 0 };
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.set("cmi.core.score.raw", "0");
      SCORM.commit();
      console.log("[SCORM] Fresh LMS attempt: cleared awards; score reset to 0%");
    }
  }
} catch (_) {}
window.__reconcileAwardsToScore();

// after: const scenes = { ... all your scenes ... };
window.scenes = window.scenes || scenes;   // <-- make scenes visible to bootstraps/debuggers


// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
(function bootstrapScoringFromAwards(all) {
  // ⛳ Skip localStorage bootstrap when running in an LMS
  try { if (window.SCORM && SCORM.init && SCORM.init()) {
    console.log("[SCORM] Skipping localStorage awards bootstrap (LMS is source of truth).");
    return;
  }} catch {}

  // …keep the rest exactly as-is…

  // If we're in an LMS, do NOT overwrite __awarded from localStorage.
  let usingLMS = false;
  try { usingLMS = !!(window.SCORM && SCORM.init && SCORM.init()); } catch {}

  if (!usingLMS) {
    // Web play: keep using localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('awarded_scenes_v1') || '[]');
      window.__awarded = new Set(saved);
    } catch (_) {
      window.__awarded = new Set();
    }
  }

  let total = 0, cur = 0;
  Object.entries(all || {}).forEach(([id, sc]) => {
    const pts = Number(sc && sc.awardOnEnter);
    if (Number.isFinite(pts) && pts > 0) {
      total += pts;
      if (window.__awarded && window.__awarded.has && window.__awarded.has(id)) cur += pts;
    }
  });

  window.__TOTAL_AWARD_MAX = total;
  window.score = window.score || { cur: 0, max: 0 };
  window.score.cur = cur;
  window.score.max = total;

  try {
    if (usingLMS) {
      const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
      if (!status || status === "not attempted" || status === "unknown") {
        SCORM.set("cmi.core.lesson_status", "incomplete");
      }
      const raw = (total > 0) ? Math.round(100 * cur / total) : 0;
      SCORM.set("cmi.core.score.raw", String(raw));
      SCORM.commit();
      console.log("[SCORM][bootstrap] cur/max:", cur, "/", total, "→", raw, "%");
    }
  } catch (_) {}

  console.log("[Score bootstrap] cur/max:", cur, "/", total, "awarded:", Array.from(window.__awarded || []));
})(window.scenes);





(function __computeAwardTotalOnce(){
  if (window.__TOTAL_AWARD_MAX_COMPUTED) return;

  let total = 0;
  Object.entries(window.scenes || {}).forEach(([id, sc]) => {
    const pts = Number(sc && sc.awardOnEnter);
    if (Number.isFinite(pts) && pts > 0) total += pts;
  });

  window.scoreReset(total); // sets score.max = total, cur = 0, pushes 0% to LMS
  window.__TOTAL_AWARD_MAX_COMPUTED = true;

  console.log("[Score bootstrap] TOTAL_AWARD_MAX =", total);
})();






















// ✅ Step A: make scenes available globally
window.scenes = scenes;



// Make sure text+video scenes have a truthy `text` so the validator passes
(function ensureVideoText(sc){
  Object.values(sc || {}).forEach(s => {
    if (s && s.type === "text" && s.source && (s.text == null || s.text === "")) {
      s.text = " "; // visually empty, satisfies validator
    }
  });
})(window.scenes);


// === GitHub Pages asset fixer ===
// Put AFTER: window.scenes = scenes;
(function fixAssetPathsForPages(){
  const isPages = /github\.io$/.test(location.hostname);
  // If you host at https://user.github.io/repo/, PREFIX becomes "/repo/"
  const prefix = isPages
    ? (location.pathname.replace(/\/index\.html?$/,'').replace(/\/$/,'') + '/')
    : '';

  function add(p){
    if (!p) return p;
    // leave external/relative/data URIs alone
    if (/^(https?:|data:|\.{1,2}\/)/i.test(p)) return p;
    // strip leading slash so "/images/x.png" becomes "images/x.png"
    const clean = p.replace(/^\//,'');
    return prefix + clean;
  }

  const A = (arr, fn) => Array.isArray(arr) ? arr.map(fn) : arr;

  (Object.values(window.scenes || {})).forEach(sc => {
    if (!sc || typeof sc !== 'object') return;
    if (sc.image) sc.image = add(sc.image);
    if (Array.isArray(sc.images)) sc.images = sc.images.map(add);
    if (sc.audio) sc.audio = add(sc.audio);
    if (sc.videoSrc) sc.videoSrc = add(sc.videoSrc);
    if (sc.poster) sc.poster = add(sc.poster);


    if (Array.isArray(sc.options)) {
      sc.options = sc.options.map(o => (typeof o === 'string' && /\.(mp3|wav|ogg|m4a|mp4)$/i.test(o)) ? add(o) : o);
    }
    if (Array.isArray(sc.interactions)) {
      sc.interactions.forEach(it => {
        if (it.audio) it.audio = add(it.audio);
        if (Array.isArray(it.options)) {
          it.options = it.options.map(o => (typeof o === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(o)) ? add(o) : o);
        }
      });
    }
  });
})();

// Resolve relative assets against <base> reliably
function resolveSrc(p){
  try { return new URL(p, document.baseURI).href; }
  catch { return p || ''; }
}



















// === UNIVERSAL SCENE NORMALIZER (v1) ===
(function normalizeForEngine(){
  function tokensFromText(t){ return String(t||'').trim().split(/\s+/).filter(Boolean); }
  function sentenceFromTextWithBlanks(text){
    const out=[]; const blanks=[];
    const parts = String(text||'').split('___');
    parts.forEach((seg,i)=>{
      if (seg) out.push(...tokensFromText(seg));
      if (i < parts.length-1){ blanks.push(out.length); out.push('___'); }
    });
    return { sentence: out, blanks };
  }

  Object.values(scenes).forEach(sc=>{
    if (!sc || typeof sc !== 'object') return;

    if (sc.type === "dashboard" && Array.isArray(sc.widgets)) {
  sc.widgets = sc.widgets.map((w, i) => {
    const ww = { ...w };
    if (!ww.type && ww.kind) ww.type = ww.kind;   // accept `kind` alias
    if (!ww.id) ww.id = `w_${ww.type || 'widget'}_${i}`;
    return ww;
  });
}

    // SCRAMBLE: accept words/sentence/correct(string)
    if (sc.type === 'scramble'){
      if (!Array.isArray(sc.scramble)) {
        sc.scramble =
          Array.isArray(sc.words)    ? sc.words.slice() :
          Array.isArray(sc.sentence) ? sc.sentence.slice() :
          tokensFromText(sc.text);
      }
      if (typeof sc.correct === 'string') sc.correct = tokensFromText(sc.correct);
      if (!Array.isArray(sc.correct) && Array.isArray(sc.sentence)) sc.correct = sc.sentence.slice();
    }

    // FIB: build sentence/blanks from "___" if missing; normalize correct to array
    if (sc.type === 'fill-in-the-blank'){
      if (!Array.isArray(sc.sentence) || !Array.isArray(sc.blanks)) {
        const { sentence, blanks } = sentenceFromTextWithBlanks(sc.text || '');
        sc.sentence = sentence;
        sc.blanks = blanks.length ? blanks : [Math.max(0, sentence.indexOf('___'))];
      }
      if (typeof sc.correct === 'string') sc.correct = [sc.correct];
      if (!Array.isArray(sc.correct)) sc.correct = [];
      if (!Array.isArray(sc.options)) sc.options = [];
    }

    // AUDIO MC: allow audioSrc + text options + correct as string
    if (sc.type === 'interaction-audio-mc'){
      if (!sc.audio && sc.audioSrc) sc.audio = sc.audioSrc;
      if (typeof sc.correct === 'string' && Array.isArray(sc.options)) {
        const idx = sc.options.findIndex(o =>
          (typeof o === 'string' ? o : o.text).trim().toLowerCase() === sc.correct.trim().toLowerCase()
        );
        if (idx >= 0) sc.__correctIndex = idx;
      } else if (Number.isInteger(sc.correct)) {
        sc.__correctIndex = sc.correct;
      }
    }
    
  });
})();

// --- Scene Normalizer & Validator (global) ---

function normalizeScenes(rawScenes) {
  // Accept either array or object-map; always return array
  const arr = Array.isArray(rawScenes)
    ? rawScenes
    : Object.values(rawScenes || {});

  return arr.map(sc => {
    const s = { ...sc };

    // Normalize casing/aliases
    if ('ken_burns' in s && !('kenBurns' in s)) s.kenBurns = !!s.ken_burns;

    // FIB: normalize correct for single blank
    if (s.type === 'fill-in-the-blank') {
      // never allow empty-token options like "—"
      if (Array.isArray(s.options)) {
        s.options = s.options.map(o =>
          (o === '—' || o === '–' || o === '— (none)') ? 'no preposition' : o
        );
      }
      // if correct provided as array with one entry, flatten to string
      if (Array.isArray(s.correct) && s.correct.length === 1) {
        s.correct = s.correct[0];
      }
    }

    // Scramble: if correct provided as single string, split to tokens
    if (s.type === 'scramble') {
      if (typeof s.correct === 'string') {
        s.correct = s.correct.trim().split(/\s+/);
      }
      if (typeof s.sentence === 'string') {
        s.sentence = s.sentence.trim().split(/\s+/);
      }
    }

    // Hard rule: no custom "timed" type; normalize legacy data
    if (s.type === 'timed') {
      throw new Error(
        `Legacy type "timed" found in ${s.id}. Use a supported type (e.g., fill-in-the-blank) and add "timer".`
      );
    }

    return s;
  });
}

function validateScenesContract(scenesArr) {
  const ids = new Set(scenesArr.map(x => x.id));
  const problems = [];

  const must = (cond, msg) => { if (!cond) problems.push(msg); };

  for (const sc of scenesArr) {
    must(!!sc.id, `Scene missing id.`);
    must(!!sc.type, `${sc.id}: missing type.`);

    // forward links
    if (sc.next) must(ids.has(sc.next), `${sc.id}: next -> "${sc.next}" not found.`);
    if (Array.isArray(sc.choices)) {
      sc.choices.forEach((c, i) => must(ids.has(c.next), `${sc.id}: choices[${i}].next -> "${c.next}" not found.`));
    }

    switch (sc.type) {
      case 'text':
        must((Array.isArray(sc.choices) && sc.choices.length) || !!sc.next,
            `${sc.id}: text scene needs choices[] or next.`);
        break;

      case 'scramble':
        must(Array.isArray(sc.sentence) && sc.sentence.length > 0,
            `${sc.id}: scramble needs sentence[].`);
        must(Array.isArray(sc.correct) && sc.correct.length > 0,
            `${sc.id}: scramble needs correct[].`);
        must(sc.sentence.length === sc.correct.length,
            `${sc.id}: sentence[] and correct[] length mismatch.`);
        break;

      case 'fill-in-the-blank':
        must(typeof sc.text === 'string' && sc.text.includes('___'),
            `${sc.id}: FIB text must include ___ placeholder.`);
        must(Array.isArray(sc.options) && sc.options.length > 0,
            `${sc.id}: FIB requires non-empty options[].`);
        must(sc.correct !== undefined && sc.correct !== null && sc.correct !== '',
            `${sc.id}: FIB missing correct answer.`);
        // if multiple blanks, enforce array
        const blanks = (sc.text.match(/___/g) || []).length;
        if (blanks > 1) {
          must(Array.isArray(sc.correct) && sc.correct.length === blanks,
              `${sc.id}: FIB has ${blanks} blanks; correct must be array of ${blanks}.`);
        } else {
          must(typeof sc.correct === 'string',
              `${sc.id}: FIB (single blank) correct must be a string.`);
        }
        break;

      case 'interaction-audio-mc':
        must(!!sc.audioSrc, `${sc.id}: audioSrc missing.`);
        must(Array.isArray(sc.options) && sc.options.length >= 2,
            `${sc.id}: audio MC needs options[].`);
        must(typeof sc.correct === 'string',
            `${sc.id}: audio MC correct must be a string.`);
        break;

      case 'video-multiple-choice':
        must(!!sc.videoSrc, `${sc.id}: videoSrc missing.`);
        must(Array.isArray(sc.options) && sc.options.length >= 2,
            `${sc.id}: video MC needs options[].`);
        sc.options.forEach((o, i) => {
          must(typeof o.text === 'string', `${sc.id}: options[${i}].text missing.`);
          must(typeof o.correct === 'boolean', `${sc.id}: options[${i}].correct missing.`);
          must(ids.has(o.next), `${sc.id}: options[${i}].next -> "${o.next}" not found.`);
        });
        break;

      case 'email':
        must(!!sc.teacherEmail, `${sc.id}: email needs teacherEmail.`);
        must(!!sc.next, `${sc.id}: email needs next (usually thank_you_scene).`);
        break;

      default:
        problems.push(`${sc.id}: Unsupported type "${sc.type}".`);
    }
  }
  return problems;
}

// ===== Engine Hardening v2 =====
window.ENGINE_VERSION = '2.0.0';

// 0) Make transient registry visible to helpers (prevents ReferenceError)
window.__transients = window.__transients || { nodes:new Set(), timers:new Set(), cleaners:new Set(), listeners:new Set() };
const __transients = window.__transients; // <-- critical alias used by helpers

// 1) Global error overlay so crashes never look like a black screen
(function installErrorOverlay(){
  if (window.__errorOverlayInstalled) return; window.__errorOverlayInstalled=true;
  function showOverlay(title, detail){
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#000b;color:#0ff;z-index:999999;display:grid;place-items:center;padding:20px;';
    const card = document.createElement('pre');
    card.style.cssText = 'background:#0a0a0f;border:1px solid #00ffff55;border-radius:12px;max-width:90vw;max-height:80vh;overflow:auto;padding:16px;font:12px/1.5 monospace;white-space:pre-wrap;';
    card.textContent = `[A-State Engine]\n${title}\n\n${detail}`;
    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }
  window.addEventListener('error', e => showOverlay('Runtime Error', (e.error && e.error.stack) || e.message));
  window.addEventListener('unhandledrejection', e => showOverlay('Unhandled Promise Rejection', (e.reason && e.reason.stack) || String(e.reason)));
})();

// 2) Strict validator (lightweight, no external libs)
function validateScenesStrict(all){
  const ids = new Set(Object.keys(all||{}));
  const errors = [];
  const warns  = [];
  function req(cond, id, msg){ if(!cond) errors.push(`[${id}] ${msg}`); }
  function w(cond, id, msg){ if(!cond) warns.push(`[${id}] ${msg}`); }

  for (const [id, sc] of Object.entries(all||{})) {
    req(sc && typeof sc === 'object', id, 'scene must be an object');
    const t = sc.type || 'text';

    // Common forward-refs
    if (sc.next) w(ids.has(sc.next), id, `next → "${sc.next}" not found`);
    if (sc.endings) {
      ['high','medium','low'].forEach(key => { if (sc.endings[key]) w(ids.has(sc.endings[key]), id, `endings.${key} → "${sc.endings[key]}" not found`); });
    }
    if (Array.isArray(sc.choices)) sc.choices.forEach(c => w(ids.has(c.next), id, `choice "${c.text}" → "${c.next}" not found`));

    // Per-type checks (subset; extend as needed)
    switch (t) {
      case 'text':
        req(!!sc.text, id, 'text scene needs "text"');
        break;

      case 'scramble': {
  const src =
    (Array.isArray(sc.scramble) && sc.scramble) ||
    (Array.isArray(sc.words) && sc.words) ||
    (Array.isArray(sc.sentence) && sc.sentence) ||
    null;

  req(Array.isArray(src) && src.length, id, 'scramble needs tokens in scramble[]/words[]/sentence[]');

  const corr = Array.isArray(sc.correct)
    ? sc.correct
    : (typeof sc.correct === 'string' ? sc.correct.trim().split(/\s+/) : null);

  req(Array.isArray(corr) && corr.length, id, 'scramble needs correct[] (or string)');
  req(!!sc.next, id, 'scramble needs next');
  break;
}


      case 'fill-in-the-blank':
      case 'interaction-fill-in-the-blank':
        req(Array.isArray(sc.sentence), id, 'needs sentence[]');
        req(Array.isArray(sc.blanks), id, 'needs blanks[]');
        req(Array.isArray(sc.options), id, 'needs options[]');
        req(Array.isArray(sc.correct), id, 'needs correct[]');
        req(sc.correct.length === sc.blanks.length, id, 'correct length must equal blanks length');
        req(!!sc.next, id, 'needs next');
        break;

      case 'interaction':
        req(Array.isArray(sc.interactions) && sc.interactions.length, id, 'needs interactions[]');
        sc.interactions.forEach((it, i)=>{
          req(typeof it.audio === 'string' && it.audio.length, id, `interactions[${i}] needs audio`);
          req(Array.isArray(it.options) && it.options.length, id, `interactions[${i}] needs options[]`);
          req(typeof it.correct !== 'undefined', id, `interactions[${i}] needs correct (index or scoring)`);
        });
        req(sc.scoring && typeof sc.scoring === 'object', id, 'needs scoring{high,medium}');
        req(sc.endings && typeof sc.endings === 'object', id, 'needs endings{high,medium,low}');
        break;

      case 'interaction-scramble':
        req(Array.isArray(sc.scramble) && sc.scramble.length, id, 'needs scramble[]');
        req(Array.isArray(sc.correct) && sc.correct.length, id, 'needs correct[]');
        req(typeof sc.audio === 'string' && sc.audio.length, id, 'needs audio');
        req(sc.next, id, 'needs next');
        break;

      case 'interaction-audio-mc':
  req( (typeof sc.audio === 'string' && sc.audio.length) ||
       (typeof sc.audioSrc === 'string' && sc.audioSrc.length),
       id, 'needs prompt audio (audio or audioSrc)');
  req(Array.isArray(sc.options) && sc.options.length >= 2,
      id, 'needs options[]');
  // allow either numeric index or string match
  req(Number.isInteger(sc.correct) || typeof sc.correct === 'string' || Number.isInteger(sc.__correctIndex),
      id, 'needs correct (index or matching string)');
  req(sc.next, id, 'needs next');
  break;


      case 'video':
      case 'video-scramble':
      case 'video-fill-in-the-blank':
      case 'video-multi-question':
      case 'video-multi-audio-choice':
        req(typeof sc.videoSrc === 'string' && sc.videoSrc.length, id, `${t} needs videoSrc`);
        // question/fields validated inside loader, but we warn:
        if (t==='video-multi-question') w(Array.isArray(sc.questions) && sc.questions.length, id, 'video-multi-question expects questions[]');
        break;

      case 'email':
        req(typeof sc.teacherEmail === 'string' && sc.teacherEmail.includes('@'), id, 'needs teacherEmail');
        req(typeof sc.emailSubject === 'string', id, 'needs emailSubject');
        break;

      // Mini-games
      case 'hangman':
        req(typeof sc.target === 'string' && sc.target.length, id, 'hangman needs target');
        break;

      case 'survivor-quiz':
      case 'conjugation-race':
      case 'image-hotspots':
      case 'buckets':
      case 'particle-swapper':
      case 'comic-bubbles':
      case 'dashboard':
        // Keep loose; these scenes vary. Rely on loader internals.
        break;

      default:
        w(false, id, `unknown type "${t}" — engine will treat as text`);
    }
  }
  return { errors, warns };
}

// 3) Asset preloader (quietly warms images/audio/video for next scene)
function listAssetsForScene(sc){
  const imgs = new Set(), auds = new Set(), vids = new Set();
  if (!sc || typeof sc !== 'object') return {imgs,auds,vids};
  if (sc.image) imgs.add(sc.image);
  if (sc.poster) imgs.add(sc.poster); // ✅ preload video poster too
  if (Array.isArray(sc.images)) sc.images.forEach(x=>imgs.add(x));
  if (sc.audio) auds.add(sc.audio);
  if (Array.isArray(sc.interactions)) sc.interactions.forEach(it=>{
    if (it.audio) auds.add(it.audio);
    if (Array.isArray(it.options)) it.options.forEach(opt=>{
      if (typeof opt === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(opt)) auds.add(opt);
    });
  });
  if (typeof sc.videoSrc === 'string') vids.add(sc.videoSrc);
  return {imgs,auds,vids};
}
const __preloaded = new Set();
function preloadAssetsFor(id){
  const sc = (window.scenes||{})[id];
  if (!sc) return;

  const {imgs,auds,vids} = listAssetsForScene(sc);

  imgs.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const i = new Image();
    // small wins for faster decode
    i.decoding = 'async';
    i.loading  = 'eager';
    i.src = url;
    __preloaded.add(url);
  });

  auds.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.src = url;
    try { a.load(); } catch(_) {}
    __preloaded.add(url);
  });

  vids.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.playsInline = true;
    v.src = url;
    try { v.load(); } catch(_) {}
    __preloaded.add(url);
  });
}


// 4) Safe start: clean data → validate → preload → start or show errors
(function safeBootstrap(){
  try {
 // sanitize unicode quirks
if (typeof cleanScenesData === 'function') cleanScenesData(window.scenes);

// 🔧 normalize scene shapes BEFORE validating/using
if (typeof window.normalizeScenesForEngine === 'function') {
  // (not needed because we used an IIFE above)
} // kept for clarity

const {errors, warns} = validateScenesStrict(window.scenes);

    warns.forEach(w => console.warn('[Scene Warning]', w));
    if (errors.length){
      console.error('[Scene Errors]', errors);
      const detail = errors.join('\n');
      const evt = new Error('Scene validation failed:\n' + detail);
      throw evt; // triggers overlay
    }

    // Preload first scene + immediate next(s)
    if (window.scenes && window.scenes.scene1) {
      preloadAssetsFor('scene1');
      if (window.scenes.scene1.next) preloadAssetsFor(window.scenes.scene1.next);
      if (Array.isArray(window.scenes.scene1.choices)) window.scenes.scene1.choices.forEach(c=>preloadAssetsFor(c.next));
    }

    // expose a safeStart you already call from the Play button
    window.safeStartGame = function(){
      try { startGame(); } catch(err) { console.error(err); throw err; }
    };

    // optional: make the homepage button call safeStartGame instead
    const btn = document.querySelector('#overlay-content .button-group button');
    if (btn && !btn.__wired) { btn.onclick = () => window.safeStartGame(); btn.__wired = true; }

  } catch(e) {
    // overlay installs in (1); rethrow for visibility
    console.error('[Bootstrap]', e);
    throw e;
  }
})();



























































// --- Usage (do this once where you load scenes) ---
// const raw = scenes; // your imported scenes (object or array)
// const normalized = normalizeScenes(raw);
// const errs = validateScenesContract(Array.isArray(normalized) ? normalized : Object.values(normalized));
// if (errs.length) { console.error(errs); alert("Scene errors:\n\n" + errs.join("\n")); throw new Error("Invalid scenes."); }
// window.scenes = Array.isArray(normalized) ? normalized : Object.values(normalized);



const ENABLE_TEST_HUB = false; // flip to true only while testing




// --- Transient registry (one-time, keep above loadScene) ---
// --- Transient registry (one-time, keep above loadScene) ---
window.__transients = window.__transients || { nodes:new Set(), timers:new Set(), cleaners:new Set(), listeners:new Set() };


function registerNode(node){
  node.dataset.transient = "1";
  __transients.nodes.add(node);
  return node;
}
function registerTimer(id){
  __transients.timers.add(id);
  return id;
}
function registerCleanup(fn){
  __transients.cleaners.add(fn);
  return fn;
}
function registerListener(target, evt, handler, opts){
  target.addEventListener(evt, handler, opts);
  __transients.listeners.add(() => target.removeEventListener(evt, handler, opts));
  return handler;
}
function cleanupTransients(){
  __transients.timers.forEach(t => { try { clearInterval(t); clearTimeout(t); } catch(_){} });
  __transients.timers.clear();

  __transients.cleaners.forEach(fn => { try { fn(); } catch(_){} });
  __transients.cleaners.clear();

  __transients.listeners.forEach(off => { try { off(); } catch(_){} });
  __transients.listeners.clear();

  document.querySelectorAll('[data-transient="1"]').forEach(n => n.remove());
  __transients.nodes.clear();
}

// --- Scene hero (image-on-top) helper ---
function renderSceneHeader(sc, root) {
  // image (if provided)
  if (sc.image) {
    const wrap = document.createElement('div');
    wrap.className = 'scene-hero';
    const img = document.createElement('img');
    img.src = sc.image;
    img.alt = sc.alt || '';
    img.loading = 'eager';
    wrap.appendChild(img);
    root.appendChild(wrap);
  }
  // title/lead text (optional if your loader already shows sc.text)
  if (sc.text) {
    const p = document.createElement('div');
    p.className = 'scene-lead';
    p.innerHTML = sc.text; // if you already render sc.text elsewhere, remove this
    root.appendChild(p);
  }
}


// ===== Persistence V2 (resume last scene + tallies) =====
// === Robust Resume Game (safe + validated) ===
(function () {
  const SAVE_KEY = 'game_progress_v1';

  const qs  = sel => document.querySelector(sel);
  const $id = id  => document.getElementById(id);

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch { return null; }
  }
  function writeSave(obj) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch {}
  }

  function showHome() {
    const overlay = $id('overlay') || qs('#overlay-content')?.parentElement;
    const game    = $id('game-container');
    if (game)    game.style.display = 'none';
    if (overlay) overlay.style.display = ''; // let CSS decide (block/grid)
  }
  function hideHome() {
    const overlay = $id('overlay') || qs('#overlay-content')?.parentElement;
    const game    = $id('game-container');
    if (overlay) overlay.style.display = 'none';
    if (game)    game.style.display = 'block';
  }

  function sceneExists(id) {
    const s = (window.scenes || {});
    // support both object map and array-of-scenes (rare)
    if (Array.isArray(s)) return s.some(x => x && x.id === id);
    return !!s[id];
  }

  function whenLoadSceneReady(run) {
    if (typeof window.loadScene === 'function') { run(); return; }
    let tries = 0;
    (function tick() {
      if (typeof window.loadScene === 'function') { run(); return; }
      if (tries++ > 200) { // ~6s safety
        console.warn('[Resume] loadScene never became available; showing home.');
        showHome();
        return;
      }
      setTimeout(tick, 30);
    })();
  }

  function tryResume() {
    const saved = readSave();
    const last  = saved?.lastScene;

    // Validate saved target
    if (!last || !sceneExists(last)) {
      console.warn('[Resume] No valid lastScene. Showing home.');
      showHome();
      return;
    }

    hideHome();

    // Call loadScene defensively
    whenLoadSceneReady(() => {
      try {
        window.loadScene(last);

        // Post-check: if the scene didn’t mount anything, bail back home
        setTimeout(() => {
          const game = $id('game-container');
          const hasContent =
            game && (
              game.children.length > 0 ||
              ($id('scene-text') && $id('scene-text').textContent.trim().length) ||
              $id('scene-video') || $id('scene-image')
            );
          if (!hasContent) {
            console.warn('[Resume] Scene did not render; falling back to home.');
            showHome();
          }
        }, 100);
      } catch (err) {
        console.error('[Resume] loadScene threw:', err);
        showHome();
      }
    });
  }
window.addEventListener('DOMContentLoaded', () => {
  try { if (SCORM && SCORM.init) SCORM.init(); } catch(_){}
  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}
  showHome();
  updateResumeButton(); // leave your existing one in place (no rename)
});

  // NEW: bind fresh-run to any existing start/play control
  const hooked = attachPlayHandlers("scene1");

function updateResumeButton() {
  const btn = $id('resume-btn');
  if (!btn) return;

  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}



  let sceneId = null;
  let awarded = null;

  // 1) Prefer LMS resume (location + awards in suspend_data)
  try {
    if (inLMS() && SCORM && SCORM.init && SCORM.init()) {
      const loc = SCORM.get && SCORM.get("cmi.core.lesson_location");
      const sd  = SCORM.get && SCORM.get("cmi.suspend_data");
      if (sd) {
        try {
          const j = JSON.parse(sd);
          if (j && Array.isArray(j.awarded)) awarded = j.awarded;
        } catch(_) {}
      }
      if (loc && sceneExists(loc)) sceneId = loc;
    }
  } catch(_) {}

  // 2) Fallback: local save
  if (!sceneId) {
    const saved = readSave && readSave();
    if (saved?.lastScene && sceneExists(saved.lastScene)) {
      sceneId = saved.lastScene;
      if (Array.isArray(saved.awarded)) awarded = saved.awarded;
    }
  }

  const ok = !!sceneId;
  btn.disabled = !ok;
  btn.textContent = 'Resume game';

  if (!ok) { btn.onclick = null; return; }

  // 3) Click → apply awards (so % is correct), then resume
btn.onclick = () => {
  try {
    // keep local mirror in sync for non-LMS use
    const saved = (readSave && readSave()) || {};
    saved.lastScene = sceneId;
    if (Array.isArray(awarded)) saved.awarded = awarded;
    else if (window.__awarded instanceof Set) saved.awarded = Array.from(window.__awarded);
    if (typeof writeSave === 'function') writeSave(saved);
  } catch(_) {}
  // then call your existing resume path (you already had this)
  if (typeof window.tryResume === 'function') return window.tryResume(sceneId, awarded);
  if (typeof hideHome === 'function') hideHome();
  if (typeof window.loadScene === 'function') window.loadScene(sceneId);
};

}



  // Hook loadScene to keep lastScene fresh
  (function installLoadSceneHook() {
    const original = window.loadScene;
    if (typeof original !== 'function') {
      // If this runs before loadScene is defined, try again later.
      let tries = 0;
      (function wait() {
        if (typeof window.loadScene === 'function') {
          install(); return;
        }
        if (tries++ > 200) return; // give up silently
        setTimeout(wait, 30);
      })();
      return;
    }
    install();

    function install() {
      const orig = window.loadScene;
      window.loadScene = function (id) {
        const r = orig.apply(this, arguments);
        const saved = readSave() || {};
        saved.lastScene = id;
        if (window.progress) {
          saved.flags    = window.progress.flags || saved.flags || {};
          saved.unlocked = Array.from(window.progress.unlocked || saved.unlocked || []);
        }
        writeSave(saved);
        try { updateResumeButton(); } catch {}
        return r;
      };
    }
  })();

  // Expose a quick dev reset (optional)
  window.resetProgressToHome = function() {
    localStorage.removeItem(SAVE_KEY);
    showHome();
  };
})();



// === Add-ons: persistence + QA overlay + scene validator ===
(function () {
  const STORAGE_KEY = 'game_progress_v1';

  // 1) Ensure a progress object exists (and normalize types)
  if (!window.progress) {
    window.progress = { flags: {}, unlocked: new Set(['scene1']) };
  } else if (!(progress.unlocked instanceof Set)) {
    progress.unlocked = new Set(progress.unlocked || ['scene1']);
  }

  // 2) Load saved progress
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      progress.flags = saved.flags || {};
      progress.unlocked = new Set(saved.unlocked || ['scene1']);
    }
  } catch (e) { console.warn('Progress load failed:', e); }

  function saveProgress() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ flags: progress.flags, unlocked: Array.from(progress.unlocked) })
      );
    } catch (e) { console.warn('Progress save failed:', e); }
  }

  // 3) Ensure/augment helpers (wrap existing to add auto-save)
  if (typeof window.setFlag !== 'function') {
    window.setFlag = function setFlag(name, val = true) {
      progress.flags[name] = !!val;
      saveProgress();
    };
  } else {
    const _setFlag = window.setFlag;
    window.setFlag = function (name, val = true) { _setFlag(name, val); saveProgress(); };
  }

  if (typeof window.unlockScene !== 'function') {
    window.unlockScene = function unlockScene(id) {
      if (id) progress.unlocked.add(id);
      saveProgress();
    };
  } else {
    const _unlockScene = window.unlockScene;
    window.unlockScene = function (id) { _unlockScene(id); saveProgress(); };
  }

  window.hasFlag = window.hasFlag || function hasFlag(name) { return !!progress.flags[name]; };
  window.isUnlocked = window.isUnlocked || function isUnlocked(id) { return progress.unlocked.has(id); };



// 4) QA overlay (Shift+Q to toggle)
(function () {
  let visible = false;
  window.toggleQA = function toggleQA() {
    visible = !visible;
    let el = document.getElementById('qa-overlay');
    if (visible) {
      if (!el) {
        el = document.createElement('pre');
        el.id = 'qa-overlay';
        el.style.cssText =
          'position:fixed;right:8px;bottom:8px;max-width:40vw;max-height:40vh;overflow:auto;' +
          'background:#000a;color:#0ff;padding:8px;border:1px solid #0ff;font:12px/1.4 monospace;z-index:99999;';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify({
        currentSceneId: window.currentSceneId,
        flags: progress.flags,
        unlocked: Array.from(progress.unlocked)
      }, null, 2);
    } else if (el) {
      el.remove();
    }
  };
})();

// === Resume Game (drop-in) ===
(function () {
  const SAVE_KEY = 'game_progress_v1';

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch { return null; }
  }
  function writeSave(obj) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); }
    catch {}
  }

  function hideHome() {
    const overlay = document.getElementById('overlay') || document.querySelector('#overlay-content')?.parentElement;
    const game = document.getElementById('game-container');
    if (overlay) overlay.style.display = 'none';
    if (game) game.style.display = 'block';
  }
  function showHome() {
    const overlay = document.getElementById('overlay') || document.querySelector('#overlay-content')?.parentElement;
    const game = document.getElementById('game-container');
    if (game) game.style.display = 'none';
    if (overlay) overlay.style.display = 'grid'; // or 'block' depending on your CSS
  }
  window.showHome = window.showHome || showHome; // expose for convenience

  function updateResumeButton() {
    const btn = document.getElementById('resume-btn');
    if (!btn) return;
    const saved = readSave();
    const last = saved?.lastScene;
    if (last) {
      btn.disabled = false;
      btn.textContent = 'Resume game';
      btn.onclick = () => { hideHome(); loadScene(last); };
    } else {
      btn.disabled = true;
      btn.textContent = 'Resume game';
      btn.onclick = null;
    }
  }

// --- Hydrate awards from LMS once per session ---
(function hydrateAwardsOnce(){
  if (window.__awardsHydrated) return;
  window.__awardsHydrated = true;

  try {
    if (window.SCORM && SCORM.init && SCORM.init()) {
      const sd = SCORM.get && SCORM.get("cmi.suspend_data");
      if (sd) {
        try {
          const j = JSON.parse(sd);
          if (j && Array.isArray(j.awarded) && j.awarded.length) {
            window.__awarded = new Set(j.awarded);
            // make sure current % reflects hydrated awards
            if (typeof window.__reconcileAwardsToScore === "function") {
              window.__reconcileAwardsToScore();
            }
            console.log("[Resume] Hydrated awards from LMS:", j.awarded.length);
          }
        } catch(_) {}
      }
    }
  } catch(_) {}
})();
 
  // Always land on homepage on fresh load (no auto-start)
 window.addEventListener('DOMContentLoaded', () => {
  try { SCORM.init(); } catch(_) {}
  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}

  showHome();
  updateResumeButton();
});


  // Hook loadScene so every scene change updates the save (incl. lastScene)
  (function installLoadSceneHook() {
    const original = window.loadScene;
    if (typeof original !== 'function') return; // will still work once loadScene exists if you move this below its def.

    window.loadScene = function (id) {
      const result = original.apply(this, arguments);

      // Persist lastScene + flags/unlocked if available
      const saved = readSave() || {};
      saved.lastScene = id;
      if (window.progress) {
        saved.flags = window.progress.flags || saved.flags || {};
        saved.unlocked = Array.from(window.progress.unlocked || saved.unlocked || []);
      }
      writeSave(saved);

      // Keep the homepage Resume button fresh if user returns there later
      try { updateResumeButton(); } catch {}
      return result;
    };
  })();

  // Optional: if your Play button isn’t already wired, you can do:
  // document.querySelector('#overlay-content .button-group button.play')
  //   ?.addEventListener('click', () => { hideHome(); window.safeStartGame ? safeStartGame() : startGame(); });

})();

(function addQAShortcut() {
  if (window.__qaShortcutAdded) return;
  window.__qaShortcutAdded = true;
  document.addEventListener('keydown', function (e) {
    if (e.shiftKey && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      window.toggleQA();
    }
  });
})();

// === CRM mini-store (state + persistence + pub/sub) ===
(function initCRM() {
  const KEY = 'crm_state_v1';

  const defaultState = {
    kpis: { revenue: 0, churn: 0, satisfaction: 50 },
    bars: { satisfaction: [ { label: 'Eng', value: 68 }, { label: 'Sales', value: 74 }, { label: 'Ops', value: 62 } ] },
    pies: { satisfactionSplit: [ { label: 'Satisfied', value: 60 }, { label: 'Neutral', value: 25 }, { label: 'Dissatisfied', value: 15 } ] },
    tables: { tickets: [['#812','Resolved','5m'], ['#905','Escalated','24h']] }
  };

  const listeners = new Set();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return raw ? deepMerge(structuredClone(defaultState), raw) : structuredClone(defaultState);
    } catch { return structuredClone(defaultState); }
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(window.crm.state)); } catch {} }
  function notify() { listeners.forEach(fn => { try { fn(window.crm.state); } catch {} }); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function setByPath(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function apply(delta) {
    if (!delta) return;
    const st = window.crm.state;

    if (delta.kpis && typeof delta.kpis === 'object') {
      for (const [k, v] of Object.entries(delta.kpis)) {
        st.kpis[k] = (Number(st.kpis[k]) || 0) + Number(v || 0);
      }
    }
    if (delta.set && typeof delta.set === 'object') {
      for (const [path, val] of Object.entries(delta.set)) setByPath(st, path, val);
    }
    if (delta.appendRows && typeof delta.appendRows === 'object') {
      for (const [tableId, rows] of Object.entries(delta.appendRows)) {
        if (!Array.isArray(st.tables[tableId])) st.tables[tableId] = [];
        st.tables[tableId].push(...rows);
      }
    }
    save();
    notify();
  }

  function deepMerge(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return b.slice();
    if (a && typeof a === 'object' && b && typeof b === 'object') {
      for (const k of Object.keys(b)) a[k] = deepMerge(a[k], b[k]);
      return a;
    }
    return b === undefined ? a : b;
  }

  window.crm = {
    state: load(),
    apply,
    subscribe,
    reset() { window.crm.state = structuredClone(defaultState); save(); notify(); },
    save
  };
})();


  (function addQAShortcut() {
    if (window.__qaShortcutAdded) return;
    window.__qaShortcutAdded = true;
    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        window.toggleQA();
      }
    });
  })();

  // 5) Scene graph validator (warns only)
  window.validateScenes = window.validateScenes || function validateScenes() {
    if (!window.scenes) return;
    const ids = new Set(Object.keys(window.scenes));
    for (const [id, sc] of Object.entries(window.scenes)) {
      (sc.choices || []).forEach(c => {
        if (c.next && !ids.has(c.next)) console.warn(`[validateScenes] Missing choice target: ${id} → ${c.next}`);
      });
      if (sc.next && !ids.has(sc.next)) console.warn(`[validateScenes] Missing next: ${id} → ${sc.next}`);
      if (sc.endings) {
        ['high', 'medium', 'low'].forEach(k => {
          const dest = sc.endings[k];
          if (dest && !ids.has(dest)) console.warn(`[validateScenes] Missing ending target: ${id}.${k} → ${dest}`);
        });
      }
    }
  };

  // Run once after scenes load
  window.validateScenes();
})();


// === Game start setup ===
let currentSceneId = "scene1";

function startGame() {
  const overlay = document.getElementById("overlay-content");
  const gameContainer = document.getElementById("game-container");
  if (overlay) overlay.style.display = "none";
  if (gameContainer) gameContainer.style.display = "block";
  if (window.BGM) window.BGM.pauseForGameStart(); // NEW: stop homepage music when game starts
  loadScene(currentSceneId);
}

// === Utilities ===
function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}
// Helper to clean words of problematic Unicode characters
function cleanWord(word) {
  // Replace non-breaking spaces and remove non-ASCII chars
  return word.replace(/\u00A0/g, ' ').replace(/[^\x00-\x7F]/g, '');
}
// Helper to clean words of problematic Unicode characters
function cleanWord(word) {
  return word.replace(/\u00A0/g, ' ').replace(/[^\x00-\x7F]/g, '');
}

// Clean all relevant arrays in all scenes
function cleanScenesData(scenesObj) {
  for (const key in scenesObj) {
    if (!scenesObj.hasOwnProperty(key)) continue;
    const scene = scenesObj[key];
    if (!scene) continue;

    if (scene.sentence && Array.isArray(scene.sentence)) {
      scene.sentence = scene.sentence.map(word => cleanWord(word));
    }
    if (scene.options && Array.isArray(scene.options)) {
      scene.options = scene.options.map(word => cleanWord(word));
    }
    if (scene.correct && Array.isArray(scene.correct)) {
      scene.correct = scene.correct.map(word => cleanWord(word));
    }
    if (scene.scramble && Array.isArray(scene.scramble)) {
      scene.scramble = scene.scramble.map(word => cleanWord(word));
    }
  }
}
// --- SCORM compatibility shim (bridges to __scorm if SCORM not present) ---
(function(){
  if (!window.SCORM && window.__scorm) {
    window.SCORM = {
      init:   () => __scorm.init(),
      set:    (k,v) => __scorm.set(k,v),
      get:    (k) => __scorm.get(k),
      commit: () => __scorm.commit(),
      finish: (status, raw) => __scorm.finish({ status, score: raw })
    };
    console.log("[SCORM shim] window.SCORM bridged to __scorm");
  }
})();







// === One-time hydrate from LMS (DON'T reconcile/publish here) ===
(function(){
  let done = false;
  window.hydrateResumeFromLMSOnce = function(){
    if (done) return;
    if (window.__FRESH_START__) { return; } 
    try {
      if (typeof inLMS === "function" && inLMS() && SCORM && SCORM.init && SCORM.init()) {
        const loc = SCORM.get && SCORM.get("cmi.core.lesson_location");
        const sd  = SCORM.get && SCORM.get("cmi.suspend_data");

        // read awards from LMS
        let fromLMS = null;
        if (sd && sd.trim()) {
          try {
            const j = JSON.parse(sd);
            if (j && Array.isArray(j.awarded)) fromLMS = new Set(j.awarded);
          } catch(_) {}
        }

        // merge LMS awards with any local awards WITHOUT publishing
        if (fromLMS) {
          let merged = new Set();
          try {
            const raw = localStorage.getItem(typeof AWARD_KEY === "string" ? AWARD_KEY : "awarded_scenes_v2");
            if (raw) {
              const arr = JSON.parse(raw);
              if (Array.isArray(arr)) arr.forEach(x => merged.add(x));
            }
          } catch(_) {}
          fromLMS.forEach(x => merged.add(x));

          // set in-memory only — no SCORM.set(), no reconcile here
          window.__awarded = merged;

          // cache locally for your non-LMS resume button
          try {
            if (typeof awardPersistSave === 'function') awardPersistSave();
            if (typeof writeLocalProgress === 'function') {
              writeLocalProgress({
                awarded: Array.from(merged),
                lastScene: (typeof sceneExists === 'function' && sceneExists(loc)) ? loc : (window.currentSceneId || 'scene1')
              });
            }
          } catch(_) {}

          console.log("[Resume] Hydrated (quiet) from LMS:", merged.size, "bookmark:", loc || "(none)");
          window.__HYDRATED_FROM_LMS__ = true;
        } else {
          console.log("[Resume] No LMS awards to hydrate (quiet).");
        }
      }
    } catch(_){}
    done = true;
  };
})();





// === Main scene loader ===
function loadScene(id) {
  console.log(`\n>>> loadScene called with ID: "${id}"`);
  const scene = scenes[id];
  // Mark as 'incomplete' on first playable scene of the course
try {
  if (SCORM.init()) {
    const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
    if (!status || status === "not attempted" || status === "unknown") {
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.commit();
    }
  }
} catch (_) {}


  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }
  currentSceneId = id;


// --- DENOMINATOR FIRST, THEN PUBLISH CURRENT % ONCE ---
try {
  // Ensure denominator exists
  if (!(window.score && Number.isFinite(window.score.max) && window.score.max > 0)) {
    let total = 0;
    const all = window.scenes || {};
    for (const sc of Object.values(all)) {
      const pts = Number(sc && sc.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    }
    window.__TOTAL_AWARD_MAX = total;
    window.score = window.score || { cur: 0, max: 0 };
    window.score.max = total;
    console.log("[Score] denominator set in loadScene →", total);
  }

  // Publish whatever the current % is (even if 0%)
  if (typeof window.__reconcileAwardsToScore === "function") {
    window.__reconcileAwardsToScore();
  }
} catch (_) {}




/* SCORM resume point */
try {
  if (SCORM.init()) {
    // Always save resume point
    SCORM.set("cmi.core.lesson_location", id);
    // Mirror awards to LMS (merge, don’t clobber)
    try {
      if (typeof writeLMSState === 'function') {
        // Helper will merge existing LMS awards + in-memory awards, then commit
        writeLMSState({ sceneId: id, awarded: window.__awarded });
      } else {
        // Inline fallback merge (safe if helper isn’t present)
        let existing = [];
        try {
          const sd = SCORM.get("cmi.suspend_data");
          if (sd) {
            const j = JSON.parse(sd);
            if (j && Array.isArray(j.awarded)) existing = j.awarded;
          }
        } catch (_) {}

        const merged = new Set(existing);
        for (const x of Array.from(window.__awarded || [])) merged.add(x);

        const payload = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
        SCORM.set("cmi.suspend_data", payload);
        // Keep the bookmark aligned too
        SCORM.set("cmi.core.lesson_location", String(id));
        SCORM.commit();
        console.log("[SCORM] suspend_data merged; awards:", merged.size);
      }
    } catch (_) {}

// If this scene is marked as the end, post completion + score
// HARD GATE: only allow finish on the true final scene id
// --- FINALIZATION GATE (replaces your old block completely) ---
const isFinalScene  = (id === "thank_you_scene");
const isEndish      = !!(scene && (scene.endOfCourse === true || scene.completeOnEnter === true));
const finishOnEnter = (scene && scene.finishOnEnter !== false); // default true; set false in scene to defer finish

function computeRawPercent() {
  try {
    const cur = Number(window.score?.cur ?? (window.scoreCurrent ? window.scoreCurrent() : 0));
    const max = Number(window.score?.max ?? (window.scoreMax ? window.scoreMax() : 0));
    if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) return Math.round((cur / max) * 100);
    if (Number.isFinite(scene?.scoreRaw)) return Number(scene.scoreRaw);
  } catch(_) {}
  return Number.isFinite(scene?.scoreRaw) ? Number(scene.scoreRaw) : 100;
}

// Mastery (threshold) reader: prefer LMS, else course default, else 75
function readMastery() {
  // Course-level default you set elsewhere: window.__MASTERY = 75;
  let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;

  try {
    const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
    if (m !== undefined && m !== null && m !== "" && !isNaN(+m)) {
      return +m; // LMS wins if it provides a number
    }
  } catch (_) {}

  return mastery; // fallback (75 by default)
}


function finalizeAttempt() {
  // Recompute % fresh
  let raw = 0;
  try {
    const cur = Number(window.score?.cur ?? (window.scoreCurrent ? window.scoreCurrent() : 0));
    const max = Number(window.score?.max ?? (window.scoreMax ? window.scoreMax() : 0));
    raw = (Number.isFinite(cur) && Number.isFinite(max) && max > 0) ? Math.round((cur / max) * 100) : 0;
  } catch(_) {}

  // mastery: LMS > default(75)
  let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;
  try {
    const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
    if (m && !isNaN(+m)) mastery = +m;
  } catch(_) {}

  const already = (SCORM.get && SCORM.get("cmi.core.lesson_status")) || "unknown";
  const passNow = (raw >= mastery);

  // Score first
  SCORM.set("cmi.core.score.raw", String(raw));

  // Never demote a previously-passed attempt
  if (already === "passed") {
    // leave as passed
  } else if (passNow) {
    SCORM.set("cmi.core.lesson_status", "passed");
  } else {
    SCORM.set("cmi.core.lesson_status", "failed");
  }

  // final bookmark
  if (window.currentSceneId) {
    SCORM.set("cmi.core.lesson_location", String(window.currentSceneId));
  }

  // finish
  if (typeof SCORM.finish === "function") {
    SCORM.finish({ status: SCORM.get("cmi.core.lesson_status"), score: raw });
  } else {
    SCORM.commit();
  }
}

// call finalize when we enter the true end scene
if (isEndish && isFinalScene) {
  if (finishOnEnter) {
    finalizeAttempt();
  } else {
    // if you ever set finishOnEnter:false on the scene, just bookmark/commit here
    SCORM.commit();
  }
}




  } else {
    console.warn("[SCORM] init() returned false (API not found in this launch)");
  }
} catch (e) {
  console.warn("[SCORM] error in loadScene hook:", e);
}


// --- Milestone award-on-enter (fires once per scene id) ---
try {
  const pts = Number(scene && scene.awardOnEnter);  // e.g., 2
  const wasAwarded = !!(window.__awarded && window.__awarded.has && window.__awarded.has(id));
  console.log("[AWARD?] enter", id, "awardOnEnter:", pts, "alreadyAwarded:", wasAwarded);

  if (pts > 0 && !wasAwarded) {
    // 1) update in-memory points
    if (window.__awarded && window.__awarded.add) window.__awarded.add(id);
    scoreAdd(pts);

    // 2) persist local overlay resume (optional)
    if (typeof awardPersistSave === 'function') awardPersistSave();
    try {
      if (typeof writeLocalProgress === 'function') {
        writeLocalProgress({
          awarded: Array.from(window.__awarded || []),
          lastScene: id
        });
      }
    } catch (_) {}

    // 3) ✅ single helper merges awards + bookmarks to LMS (no manual SCORM.set/commit here)
    writeLMSState({ sceneId: id, awarded: window.__awarded });

    // 4) publish % to LMS/UI
    if (typeof window.__reconcileAwardsToScore === "function") {
      window.__reconcileAwardsToScore();
    }

    console.log("[AWARD✅]", id, "→ now cur/max:", window.scoreCurrent(), "/", window.scoreMax());
  } else {
    console.log("[AWARD…skip]", id, "cur/max:", window.scoreCurrent(), "/", window.scoreMax());
  }
} catch (e) {
  console.warn("[AWARD ERR]", e);
}




// (leave everything below as you already have it)
try { progress.lastSceneId = id; if (typeof saveProgressNow === 'function') saveProgressNow(); } catch(_){}

if (Array.isArray(scene.onEnterUnlockScenes)) scene.onEnterUnlockScenes.forEach(unlockScene);
if (Array.isArray(scene.onEnterSetFlags)) scene.onEnterSetFlags.forEach(setFlag);

// Apply CRM deltas on enter (optional per scene)
try {
  if (scene.applyCrm) window.crm && window.crm.apply(scene.applyCrm);
} catch (e) { console.warn('CRM apply (onEnter) failed', e); }


  // === UNIVERSAL CLEANUP AT START ===
  console.log('[onEnter]', {
    sceneId: id,
    setFlags: scene.onEnterSetFlags || [],
    unlockScenes: scene.onEnterUnlockScenes || [],
    flagsNow: { ...progress.flags },
    unlockedNow: Array.from(progress.unlocked || [])
  });

  // Remove and clean audio player if present
  const audioElem = document.getElementById("scene-audio");
  if (audioElem) {
    audioElem.pause();
    audioElem.src = "";
    audioElem.load();
    audioElem.remove();
  }

  // Grab all containers safely
  const sceneImage = document.getElementById("scene-image");
  const sceneText = document.getElementById("scene-text");
  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const infoDiv = document.getElementById("challenge-info");
  const choicesDiv = document.getElementById("choices-container");
  const scene6UI = document.getElementById("scene6-ui");
  const gameContainer = document.getElementById("game-container");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");

  // Clear and hide all relevant containers to prevent UI seepage
  [
    container,
    sceneImage,
    sceneText,
    infoDiv,
    choicesDiv,
    scrambleDiv,
    feedbackDiv,
    fillBlankContainer,
    scene6UI
  ].forEach(el => {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  });

  // Clear video multi-question UI if present
  const questionUI = document.getElementById("video-question-ui");
  if (questionUI) {
    questionUI.style.display = "none";
    questionUI.innerHTML = "";
  }

  // Remove or hide video player if present
  const videoElem = document.getElementById("scene-video");
  if (videoElem) {
    videoElem.pause();
    videoElem.src = "";
    videoElem.load();
    videoElem.remove(); // completely remove from DOM
  }

  // --- Hangman teardown (prevents elements seeping across scenes) ---
  const hm = document.getElementById('hangman');
  if (hm) hm.remove();
  if (window.__hmKeyHandler) {
    document.removeEventListener('keydown', window.__hmKeyHandler);
    window.__hmKeyHandler = null;
  }

  // --- Survivor teardown (prevents seepage) ---
  if (window.__svCleanup) { window.__svCleanup(); window.__svCleanup = null; }
  const svWrap = document.getElementById('survivor-quiz');
  if (svWrap) svWrap.remove();

  // --- Conjugation Race teardown (prevents seepage) ---
  if (window.__crCleanup) { window.__crCleanup(); window.__crCleanup = null; }
  const crWrap = document.getElementById('conj-race');
  if (crWrap) crWrap.remove();

  // --- Hotspots teardown (prevents seepage) ---
  if (window.__hsCleanup) { window.__hsCleanup(); window.__hsCleanup = null; }
  const hsWrap = document.getElementById('hotspots');
  if (hsWrap) hsWrap.remove();

  // --- Buckets teardown (prevents seepage) ---
  if (window.__bkCleanup) { window.__bkCleanup(); window.__bkCleanup = null; }
  const bkWrap = document.getElementById('buckets');
  if (bkWrap) bkWrap.remove();

  // --- Particle Swapper teardown (prevents seepage) ---
  if (window.__psCleanup) { window.__psCleanup(); window.__psCleanup = null; }
  const psWrap = document.getElementById('particle-swapper');
  if (psWrap) psWrap.remove();

  // --- Comic Bubbles teardown (prevents seepage) ---
  if (window.__cbCleanup) { window.__cbCleanup(); window.__cbCleanup = null; }
  const cbWrap = document.getElementById('comic-bubbles');
  if (cbWrap) cbWrap.remove();

  // --- Dashboard teardown (prevents seepage) ---
  if (window.__dashCleanup) { window.__dashCleanup(); window.__dashCleanup = null; }
  const dashWrap = document.getElementById('dashboard-wrap');
  if (dashWrap) dashWrap.remove();

    // === TRANSIENTS: nuke anything registered by loaders (Step 2) ===
  if (window.cleanupTransients) cleanupTransients();

  // Extra: destroy any global Sortable handle we might have left around
  try {
    if (window.scrambleSortable && typeof window.scrambleSortable.destroy === 'function') {
      window.scrambleSortable.destroy();
    }
  } catch(_) {}
  window.scrambleSortable = null;

  // Extra: kill common stray UI blocks some loaders create
  [
    'video-question',
    'video-multi-audio-question-ui',
    'video-multi-question-options',
    'video-multi-question-timer',
    'video-multi-question-feedback'
  ].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });

  // HARD SWEEPER: keep only the canonical containers under #game-container
  (function sweepGameContainer(){
    const gc = document.getElementById('game-container');
    if (!gc) return;
    const keep = new Set([
      'scene-image',
      'scene-text',
      'challenge-info',
      'choices-container',
      'scene6-ui',
      'sentence-scramble',
      'scramble-feedback',
      'sceneFillInTheBlank',
      'scene-container',
      'email-challenge-container'
    ]);
    Array.from(gc.children).forEach(child => {
      // remove anything not in the canonical set
      if (!keep.has(child.id)) child.remove();
    });
  })();


  // === TRANSIENTS: nuke anything registered by loaders (Step 2) ===
  if (window.cleanupTransients) cleanupTransients();

  // Special handling for emailContainer:
  // Clear and hide only if scene.type !== 'email'
  if (emailContainer) {
    if (scene.type !== "email") {
      emailContainer.style.display = "none";
      emailContainer.innerHTML = "";
    } else {
      // For email scenes, keep it visible and intact
      emailContainer.style.display = "block";
    }
  }

  if (gameContainer) gameContainer.style.display = "block";

 // === Unified hero image (works for ALL scene types) ===
{
  const imgHost = sceneImage || document.getElementById("scene-image");
  if (imgHost) {
    if (scene.image) {
      imgHost.style.display = "block";
      const cls = scene.imageClass ? ` class="${scene.imageClass}"` : "";
      imgHost.innerHTML = `<img src="${scene.image}" alt="Scene Image"${cls}>`;
    } else {
      imgHost.style.display = "none";
      imgHost.innerHTML = "";
    }
  }
}


  // Dispatch by scene type
  switch (scene.type) {
    case "interaction":
      loadInteractionScene(id);
      return;

    case "interaction-scramble":
      loadInteractionScrambleScene(id);
      return;

    case "interaction-fill-in-the-blank":
      if (fillBlankContainer) {
        fillBlankContainer.style.display = "block";
        loadInteractionFillBlankScene(id);
      }
      return;

    case "interaction-audio-mc":
      loadInteractionAudioMCScene(id);
      return;

    case "fill-in-the-blank":
      if (fillBlankContainer) {
        fillBlankContainer.style.display = "block";
        loadFillInTheBlankScene(id, fillBlankContainer);
      }
      return;

    case "video":
      loadVideoScene(id);
      return;

    case "video-multi-question":
      loadVideoMultiQuestionScene(id);
      return;

    case "video-multi-audio-choice":
      loadVideoMultiAudioChoiceScene(id);
      return;

    case "video-scramble":
      loadVideoScrambleScene(id);
      return;

    case "video-fill-in-the-blank":
      loadVideoFillBlankScene(id);
      return;

    case "hangman":
      loadHangmanScene(id);
      return;

    case "survivor-quiz":
      loadSurvivorQuizScene(id);
      return;

    case "conjugation-race":
      loadConjugationRaceScene(id);
      return;

    case "image-hotspots":
      loadHotspotsScene(id);
      return;

    case "buckets":
      loadBucketsScene(id);
      return;

    case "particle-swapper":
      loadParticleSwapperScene(id);
      return;

    case "comic-bubbles":
      loadComicBubblesScene(id);
      return;

    case "dashboard":
      loadDashboardScene(id);
      return;

    case "classify-buckets":
      loadBucketsScene(id);
      return;

    case "email":
      loadEmailChallengeScene(id);
      return;

    default:
      break;

      case "video-choice":
  loadVideoChoiceScene(id);
  return;

  }

  // Show text or hide
  if (sceneText) {
    if (scene.text) {
      sceneText.style.display = "block";
      sceneText.textContent = scene.text;
    } else if (scene.render) {
      sceneText.style.display = "none";
    } else {
      sceneText.innerHTML = "";
    }
  }

  // Show image or hide
  if (sceneImage) {
    if (scene.image) {
      sceneImage.style.display = "block";
      const cls = scene.imageClass ? ` class="${scene.imageClass}"` : '';
      sceneImage.innerHTML = `<img src="${scene.image}" alt="Scene Image"${cls}>`;
    } else {
      sceneImage.style.display = "none";
      sceneImage.innerHTML = "";
    }
  }

  // Scramble challenge (existing scramble logic)
 // Scramble challenge (universal scramble logic)
// Scramble challenge (robust + back-compat)
if (
  (scene.type === "scramble" ||
    ((scene.scramble || scene.words || scene.sentence) && scene.correct && scene.next)) &&
  scene.type !== "fill-in-the-blank" &&
  scene.type !== "interaction-scramble"
) {
  if (scrambleDiv && feedbackDiv) {
    scrambleDiv.style.display = "block";
    feedbackDiv.style.display = "block";
    scrambleDiv.innerHTML = "";
    feedbackDiv.innerText = "";

    const instruction = document.createElement("p");
    instruction.className = "scramble-instructions";
    instruction.textContent = "🧩 Drag the words into the correct order:";
    scrambleDiv.appendChild(instruction);

    // Accept any of: scramble[] | words[] | sentence[]
    const source =
      (Array.isArray(scene.scramble) && scene.scramble) ||
      (Array.isArray(scene.words) && scene.words) ||
      (Array.isArray(scene.sentence) && scene.sentence) ||
      [];

    // Normalize correct → array of tokens
    const correctArr = Array.isArray(scene.correct)
      ? scene.correct
      : (typeof scene.correct === "string" ? scene.correct.trim().split(/\s+/) : []);

    if (!source.length || !correctArr.length) {
      console.warn("[Scramble] Missing tokens/correct for:", scene.id);
      feedbackDiv.textContent = "⚠️ This scramble is missing data.";
      feedbackDiv.style.color = "orange";
      return;
    }

    const scrambleContainer = document.createElement("div");
    scrambleContainer.id = "scramble-words";

    const shuffled = shuffleArray(source.slice());
    shuffled.forEach((token) => {
      const span = document.createElement("span");
      span.className = "scramble-word";
      span.textContent = token;
      scrambleContainer.appendChild(span);
    });
    scrambleDiv.appendChild(scrambleContainer);

    try { Sortable.create(scrambleContainer, { animation: 150 }); }
    catch (e) { console.warn("Sortable unavailable; drag disabled.", e); }

    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.onclick = () => checkScrambleAnswer(correctArr, scene.next);
    scrambleDiv.appendChild(checkBtn);
  }
  return;
}



// Choices buttons (with optional gating + CRM apply) + hide "Play again" on final scene in LMS
if (scene.choices && scene.choices.length > 0 && choicesDiv) {
  // If we're on the final scene in an LMS, filter out the "Play again" option
  const hideInFinal = (currentSceneId === "thank_you_scene" && inLMS());
  const list = hideInFinal
    ? scene.choices.filter(c => {
        const label = String(c.text || "").toLowerCase().trim();
        // Hide by label OR by known target scene if you prefer
        return !(label.includes("play again") || c.next === "sceneU");
      })
    : scene.choices;

  if (!list.length) {
    // Nothing to show (e.g., only "Play again" was present) → hide the container
    choicesDiv.style.display = "none";
    choicesDiv.innerHTML = "";
    return;
  }

  choicesDiv.style.display = "block";
  choicesDiv.innerHTML = "";

  list.forEach((choice) => {
    const reqFlags = choice.requiresFlags || [];
    const reqScenes = choice.requiresScenes || [];
    const okFlags = reqFlags.every(hasFlag);
    const okScenes = reqScenes.every(isUnlocked);
    const available = okFlags && okScenes;

    const btn = document.createElement("button");
    btn.textContent = available ? choice.text : `🔒 ${choice.text}`;
    btn.disabled = !available;
    btn.onclick = () => {
      if (!available) return;
      try { if (choice.applyCrm) window.crm && window.crm.apply(choice.applyCrm); }
      catch (e) { console.warn('CRM apply (choice) failed', e); }
      loadScene(choice.next);
    };
    choicesDiv.appendChild(btn);
  });
  return;
}


  // Render function fallback
  if (scene.render && sceneText) {
    sceneText.innerHTML = "";
    scene.render(sceneText);
    return;
  }

  // Text only fallback
  if (scene.text && sceneText) {
    sceneText.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = scene.text;
    sceneText.appendChild(p);
  }




  // Add Play Again button only on final thank you scene (outside switch, after all rendering)
  if (id === "thank_you_scene" && container) {
    container.style.display = "block"; // ensure container visible
    if (!document.getElementById("play-again")) {
      console.log(">>> Adding Play Again button now!");
      const message = document.createElement('p');
      message.textContent = "Thank you for playing! Please click below to play again.";
      container.appendChild(message);

      const playAgainBtn = document.createElement('button');
      playAgainBtn.id = "play-again";
      playAgainBtn.textContent = "Play Again";
      playAgainBtn.style.cssText = `
        margin-top: 20px;
        font-size: 1.2rem;
        padding: 10px 20px;
        background-color: #0ff;
        color: #000;
        border: none;
        cursor: pointer;
      `;
      playAgainBtn.onclick = () => {
        currentSceneId = "scene1"; // Reset to first scene
        loadScene(currentSceneId);
      };
      container.appendChild(playAgainBtn);
    } else {
      console.log(">>> Play Again button already exists.");
    }
  } else {
    console.log(`>>> No Play Again button added on scene "${id}".`);
  }
}























// === Scramble answer check ===
function checkScrambleAnswer(correctOrder, nextSceneId) {
  const words = Array.from(document.querySelectorAll("#scramble-words .scramble-word"));
  const userOrder = words.map((w) => w.textContent.trim());
  const feedback = document.getElementById("scramble-feedback");
  const container = document.getElementById('scene-container');
  const scene = scenes[currentSceneId];  // get current scene

  if (!feedback) return;

  if (arraysEqual(userOrder, correctOrder)) {
    feedback.textContent = "✅ Correct! Moving on...";
    feedback.style.color = "lightgreen";

       // ✅ award unlocks/flags defined on the current scene
    if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
    if (Array.isArray(scene.setFlags)) scene.setFlags.forEach(setFlag);

    setTimeout(() => {
      const nextScene = scenes[nextSceneId];
      if (nextScene && nextScene.type === "interaction") {
        loadInteractionScene(nextSceneId);
      } else {
        loadScene(nextSceneId);
      }
    }, 1000);
  } else {
    feedback.textContent = "❌ Not quite. Try again.";
    feedback.style.color = "salmon";
  }

  if (scene.playAgain && container && !document.getElementById("play-again")) {
    const playAgainBtn = document.createElement('button');
    playAgainBtn.textContent = "Play Again";
    playAgainBtn.id = "play-again";
    playAgainBtn.style.cssText = `
      margin-top: 20px;
      font-size: 1.2rem;
      padding: 10px 20px;
      background-color: #0ff;
      color: #000;
      border: none;
      cursor: pointer;
    `;
    playAgainBtn.addEventListener('click', () => {
      // Reset game variables/state here if needed
      loadScene('scene1');
    });
    container.appendChild(playAgainBtn);
  }
}


// === Drag-and-drop Fill-in-the-Blank (pink-magenta theme) ===
function loadFillInTheBlankScene(sceneId, container) {
  const infoDiv = document.getElementById("challenge-info");
  if (infoDiv) {
    infoDiv.style.display = "none";
    infoDiv.innerHTML = "";
  }

  const scene = scenes[sceneId];

  // --- Defensive: build sentence/blanks from "___" if not provided ---
  if (!Array.isArray(scene.sentence) || !Array.isArray(scene.blanks)) {
    const parts = String(scene.text || '').split('___');
    const toks = []; const blanks = [];
    const toWords = s => String(s).trim().split(/\s+/).filter(Boolean);
    parts.forEach((seg, i) => {
      if (seg) toks.push(...toWords(seg));
      if (i < parts.length - 1) { blanks.push(toks.length); toks.push('___'); }
    });
    scene.sentence = Array.isArray(scene.sentence) ? scene.sentence : toks;
    scene.blanks   = Array.isArray(scene.blanks)   ? scene.blanks   : blanks;
  }
  // normalize correct to array
  if (typeof scene.correct === 'string') scene.correct = [scene.correct];

  if (!scene) {
    console.error(`Scene ${sceneId} not found.`);
    return;
  }

  // Inject HTML structure into container
  container.innerHTML = `
    <h2>Fill in the Blanks Challenge</h2>
    <p>${scene.text || "Fill in the blanks by dragging the correct options below."}</p>
    <p id="fill-blank-sentence" style="font-size: 1.2rem; line-height: 1.5; margin-bottom: 20px;"></p>
    <div id="fill-blank-options" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
    <button id="check-fill-blank-answer">Check Answer</button>
    <div id="fill-blank-feedback" style="margin-top: 10px; font-weight: bold;"></div>
  `;

  const sentenceEl = container.querySelector("#fill-blank-sentence");
  const optionsEl = container.querySelector("#fill-blank-options");
  const feedbackEl = container.querySelector("#fill-blank-feedback");

  // Style heading and intro to match pink theme & readability
  const h2 = container.querySelector("h2");
  if (h2) {
    h2.style.cssText = `
      display:inline-block;
      color: var(--accent-pink-700);
      background: var(--accent-pink-50);
      border: 1px solid var(--accent-pink);
      border-radius: 10px;
      padding: 6px 10px;
      font-weight: 800;
      margin: 0 0 8px 0;
    `;
  }
  const pIntro = container.querySelector("p");
  if (pIntro) pIntro.style.color = "var(--text-default)";

  // Destroy any existing Sortable instances before creating new ones
  if (container._sortableBlanks) {
    container._sortableBlanks.forEach(s => s.destroy());
    container._sortableBlanks = null;
  }
  if (container._sortableOptions) {
    container._sortableOptions.destroy();
    container._sortableOptions = null;
  }

  // Render the sentence with blanks as droppable zones (pink styling)
  let html = "";
  for (let i = 0; i < scene.sentence.length; i++) {
    if (scene.blanks.includes(i)) {
      html += `<span class="fill-blank-dropzone" data-index="${i}" style="
        display:inline-block;
        min-width: 88px;
        padding: 4px 6px;
        margin: 0 4px;
        vertical-align: bottom;
        border-radius: 10px;
        background: var(--accent-pink-50);
        border: 2px dashed var(--accent-pink);
        cursor: pointer;
      "></span> `;
    } else {
      html += `<span style="margin: 0 4px; color: var(--text-default);">${scene.sentence[i]}</span> `;
    }
  }
  sentenceEl.innerHTML = html;

  // Render draggable options (pink outline; fills on hover)
  optionsEl.innerHTML = "";
  scene.options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.className = "fill-blank-option";
    btn.style.cssText = `
      padding: 8px 12px;
      border-radius: 10px;
      border: 2px solid var(--accent-pink);
      background: #fff;
      color: var(--accent-pink);
      font-weight: 800;
      cursor: grab;
      user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    `;
    btn.onmouseenter = () => { btn.style.background = "var(--accent-pink)"; btn.style.color = "#fff"; };
    btn.onmouseleave = () => { btn.style.background = "#fff";               btn.style.color = "var(--accent-pink)"; };
    optionsEl.appendChild(btn);
  });

  // Style the "Check Answer" button to match pink theme
  const checkBtn = container.querySelector("#check-fill-blank-answer");
  if (checkBtn) {
    checkBtn.style.cssText = `
      padding: 10px 16px;
      border-radius: 12px;
      border: 2px solid var(--accent-pink);
      background: #fff;
      color: var(--accent-pink);
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    `;
    checkBtn.onmouseenter = () => { checkBtn.style.background = "var(--accent-pink)"; checkBtn.style.color = "#fff"; };
    checkBtn.onmouseleave = () => { checkBtn.style.background = "#fff";               checkBtn.style.color = "var(--accent-pink)"; };
  }

  // Setup SortableJS for blanks (droppable zones)
  const dropzones = sentenceEl.querySelectorAll(".fill-blank-dropzone");
  container._sortableBlanks = Array.from(dropzones).map(zone => {
    return Sortable.create(zone, {
      group: "fillInTheBlank",
      animation: 150,
      sort: false,
      onAdd: evt => {
        const dragged = evt.item;
        // Remove dragged from options pool when dropped into blank
        if (dragged.parentNode === optionsEl) {
          dragged.parentNode.removeChild(dragged);
        }
        // Ensure only one child in each dropzone
        if (evt.to.children.length > 1) {
          Array.from(evt.to.children).forEach(child => {
            if (child !== dragged) {
              evt.to.removeChild(child);
              optionsEl.appendChild(child);
            }
          });
        }
      },
      onRemove: evt => {
        // Append dragged item back to options pool when removed from blank
        optionsEl.appendChild(evt.item);
      }
    });
  });

  // Setup SortableJS for options container
  container._sortableOptions = Sortable.create(optionsEl, {
    group: "fillInTheBlank",
    animation: 150,
  });

  // Check answer button logic (accessible feedback colors)
  container.querySelector("#check-fill-blank-answer").onclick = () => {
    const userAnswers = [];
    let allFilled = true;
    dropzones.forEach(zone => {
      if (zone.children.length === 1) {
        userAnswers.push(zone.children[0].textContent.trim());
      } else {
        allFilled = false;
      }
    });

    if (!allFilled) {
      feedbackEl.textContent = "⚠️ Please fill all blanks.";
      feedbackEl.style.color = "#B36B00"; // darker amber for readability
      return;
    }

    // Compare user answers to correct answers case-insensitively
    const allCorrect = userAnswers.every(
      (ans, i) => ans.toLowerCase() === scene.correct[i].toLowerCase()
    );

    if (allCorrect) {
      feedbackEl.textContent = "✅ Correct! Well done.";
      feedbackEl.style.color = "#1E7F3B"; // accessible green
      // ✅ award unlocks/flags for this scene
      if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
      if (Array.isArray(scene.setFlags)) scene.setFlags.forEach(setFlag);
      if (scene.next) {
        setTimeout(() => loadScene(scene.next), 1500);
      }
    } else {
      feedbackEl.textContent = "❌ Not quite. Try again.";
      feedbackEl.style.color = "#C0392B"; // accessible red
    }
  };
}




// --- Video helpers ---
function normalizeMediaPath(src) {
  // Avoid leading "/" (breaks on GitHub Pages); return relative path
  return String(src || "").replace(/^\//, "");
}

function attachTapToPlay(videoEl, label = "▶ Tap to play") {
  const btn = document.createElement("button");
  btn.id = "video-tap-overlay";
  btn.textContent = label;
  btn.style.cssText =
    "display:none;margin:6px auto 0;padding:6px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer;";
  videoEl.after(btn);

  const tryPlay = () => {
    // try muted autoplay; if blocked, show overlay
    videoEl.muted = true;
    videoEl.play().catch(() => { btn.style.display = "inline-block"; });
  };

  btn.onclick = () => {
    btn.style.display = "none";
    // user gesture now in place; allow audio
    videoEl.muted = false;
    videoEl.play().catch(()=>{ /* best effort */ });
  };

  return { btn, tryPlay };
}





// === Video challenge loader ===
function loadVideoScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Safe helpers
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  // Base containers
  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");

  // Clean any stale UI for video scenes
  ["scene-video","video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
    const n = document.getElementById(id); if (n) n.remove();
  });

  if (game) game.style.display = "block";

  // Hide text overlay for video (keeps it clean)
  if (sceneText) { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  if (sceneImage) { sceneImage.style.display = "none"; sceneImage.innerHTML = ""; }

  // Build video element
  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.src = scene.videoSrc || scene.source || ""; // support both keys
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.style.maxWidth = "100%";
  video.style.maxHeight = "420px";
  video.style.display = "block";
  video.style.margin = "0 auto 16px";
  video.style.borderRadius = "12px";
  video.style.backgroundColor = "black";
  if (scene.poster) video.poster = scene.poster;

  regNode(video);
  game.appendChild(video);

  // Choice/timer panel (created lazily after video ends)
  let timerId = null;
  function clearTimer(){ if (timerId) { clearInterval(timerId); timerId = null; } }

  function buildChoicesPanel(fromScene) {
    // Remove old panel if any
    ["video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
      const n = document.getElementById(id); if (n) n.remove();
    });

    const choicesSrc = Array.isArray(fromScene.choices) ? fromScene : null;
    if (!choicesSrc) {
      // No inline choices -> behave like classic video: go to next
      if (scene.next) return loadScene(scene.next);
      return; // nothing else to do
    }

    // Timer (optional): prefer fromScene.timer, fallback to scene.timer
    const rawSec = (typeof choicesSrc.timer === "number" || choicesSrc.timer === true)
      ? choicesSrc.timer
      : scene.timer;

    const seconds = (rawSec === true) ? 15
                   : (Number.isFinite(rawSec) && rawSec > 0 ? Math.floor(rawSec) : null);

    // Timer row
    let timerDiv = null;
    if (seconds) {
      let timeLeft = seconds;
      timerDiv = document.createElement("div");
      timerDiv.id = "video-choices-timer";
      timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:8px 0;";
      timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
      game.appendChild(timerDiv);

      clearTimer();
      timerId = setInterval(() => {
        timeLeft -= 1;
        if (timerDiv) timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`;
        if (timeLeft <= 0) {
          clearTimer();
          const timeoutDest =
            (choicesSrc.endings && choicesSrc.endings.timeout) ||
            (scene.endings && scene.endings.timeout) ||
            scene.next;
          if (timeoutDest) return loadScene(timeoutDest);
        }
      }, 1000);
    }

    // Choices wrap
    const wrap = document.createElement("div");
    wrap.id = "video-choices";
    wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;margin:10px 0;";
    game.appendChild(wrap);

    // Feedback (optional)
    const fb = document.createElement("div");
    fb.id = "video-choices-feedback";
    fb.style.cssText = "margin-top:6px;font-weight:700;";
    game.appendChild(fb);

    // Gate helper (matches your main choices gating)
    const hasFlag    = (f) => window.progress && window.progress.flags && !!window.progress.flags[f];
    const isUnlocked = (s) => window.progress && window.progress.unlocked && window.progress.unlocked.has && window.progress.unlocked.has(s);

    (choicesSrc.choices || []).forEach(choice => {
      const reqFlags = choice.requiresFlags || [];
      const reqScenes = choice.requiresScenes || [];
      const okFlags = reqFlags.every(hasFlag);
      const okScenes = reqScenes.every(isUnlocked);
      const available = okFlags && okScenes;

      const btn = document.createElement("button");
      btn.textContent = available ? choice.text : `🔒 ${choice.text}`;
      btn.disabled = !available;
      btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      btn.onmouseenter = () => (btn.style.background = "#00cccc");
      btn.onmouseleave = () => (btn.style.background = "#00ffff");

      regListener(btn, "click", () => {
        clearTimer();
        if (!available) return;
        if (choice.applyCrm) {
          try { window.crm && window.crm.apply(choice.applyCrm); } catch(_) {}
        }
        loadScene(choice.next);
      });

      wrap.appendChild(btn);
    });

    // Cleanup on leave
    regCleanup(() => { clearTimer(); const n = document.getElementById("video-choices"); if (n) n.remove(); const t = document.getElementById("video-choices-timer"); if (t) t.remove(); const f = document.getElementById("video-choices-feedback"); if (f) f.remove(); });
  }

  function onEnded() {
    // After video ends: show inline choices from self or from a referenced scene
    const refId = scene.inlineChoicesFrom;
    const src = (refId && scenes[refId]) ? scenes[refId] : scene;
    buildChoicesPanel(src);
  }

  regListener(video, "ended", onEnded);
  // If you need a “Skip” (optional): press Enter to skip to choices
  // regListener(document, "keydown", (e)=>{ if(e.key==="Enter"){ try{ video.pause(); }catch(_){} onEnded(); } });

  // Cleanup when leaving this scene
  regCleanup(() => {
    clearTimer();
    try { video.pause(); } catch(_) {}
    const v = document.getElementById("scene-video"); if (v) v.remove();
    ["video-choices","video-choices-timer","video-choices-feedback"].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });
  });
}









// === Audio negotiation interaction loader ===
function loadInteractionScene(id) {
  const infoDiv = document.getElementById("challenge-info");
if (infoDiv) {
  infoDiv.style.display = "none";
  infoDiv.innerHTML = "";
}

  console.log(`Loading interaction scene: ${id}`);
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scramble = document.getElementById("sentence-scramble");
  const feedback = document.getElementById("scramble-feedback");
  const interactionUI = document.getElementById("scene6-ui");

  if (gameContainer) gameContainer.style.display = "block";
  if (interactionUI) interactionUI.style.display = "block";

  // Show text if present
  if (sceneText) {
    if (scene.text) {
      sceneText.style.display = "block";
      sceneText.textContent = scene.text;
    } else {
      sceneText.style.display = "none";
    }
  }

  // Show image if present
  if (sceneImage) {
    if (scene.image) {
      sceneImage.style.display = "block";
  const imgClass = scene.imageClass ? ` class="${scene.imageClass}"` : '';
sceneImage.innerHTML = `<img src="${scene.image}" alt="Scene Image"${imgClass}>`;

    } else {
      sceneImage.style.display = "none";
      sceneImage.innerHTML = "";
    }
  }

  // Hide scramble and feedback
  if (scramble) scramble.style.display = "none";
  if (feedback) feedback.style.display = "none";

  if (interactionUI) {
    interactionUI.innerHTML = `
      <h2>Negotiation</h2>
      <p>🎙️ Listen carefully. Press play when ready. Once the audio ends, you’ll have <strong>30 seconds</strong> to choose your reply.</p>
      <div id="interaction"></div>
    `;
  }

  let score = 0;
  let index = 0;

  function showInteraction() {
    
    console.log(`showInteraction called, index = ${index}`);

    if (index >= scene.interactions.length) {
      const ending =
        score >= scene.scoring.high ? scene.endings.high :
        score >= scene.scoring.medium ? scene.endings.medium :
        scene.endings.low;

      console.log("All interactions done, loading ending:", ending);

      // Show back regular UI containers
      if (sceneText) sceneText.style.display = "block";
      if (sceneImage) sceneImage.style.display = "block";
      if (scramble) scramble.style.display = "block";
      if (feedback) feedback.style.display = "block";

      if (interactionUI) {
        interactionUI.style.display = "none";
        interactionUI.innerHTML = "";
      }

      loadScene(ending);
      return;
    }

    const interaction = scene.interactions[index];
    const interactionDiv = document.getElementById("interaction");
    if (!interactionDiv) return;

    interactionDiv.innerHTML = `
      <audio id="interaction-audio" controls>
        <source src="${interaction.audio}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
      <div id="timer">⏳ Waiting for audio to finish...</div>
      <div id="options" style="margin-top: 10px;"></div>
      <div id="feedback" style="margin-top: 10px;"></div>
    `;

    const audio = document.getElementById("interaction-audio");

    audio.onplay = () => {
      console.log("Audio started playing");
    };

    audio.onerror = (e) => {
      console.error("Audio error:", e);
    };

    audio.onended = () => {
      console.log("Audio ended");

      let timeLeft = 30;
      const timerEl = document.getElementById("timer");
      if (timerEl) timerEl.textContent = `⏳ ${timeLeft} seconds remaining...`;

      const countdown = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = `⏳ ${timeLeft} seconds remaining...`;
        if (timeLeft <= 0) {
          clearInterval(countdown);
          const feedbackDiv = document.getElementById("feedback");
          if (feedbackDiv) feedbackDiv.textContent = "⌛ Time expired. No reply sent.";
          index++;
          setTimeout(showInteraction, 2000);
        }
      }, 1000);

      const optionsDiv = document.getElementById("options");
      if (!optionsDiv) return;
      optionsDiv.innerHTML = "";

      interaction.options.forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.textContent = typeof opt === "string" ? opt : opt.text;
        btn.onclick = () => {
          clearInterval(countdown);
          console.log(`Option clicked: ${btn.textContent}`);
          const isCorrect = (typeof opt === "string") ? (i === interaction.correct) : (opt.score === 1);
          const feedbackDiv = document.getElementById("feedback");
          if (feedbackDiv) {
            if (isCorrect) {
              score++;
              feedbackDiv.textContent = "✅ Response recorded.";
              feedbackDiv.style.color = "lightgreen";
            } else {
              feedbackDiv.textContent = "⚠️ Response recorded.";
              feedbackDiv.style.color = "orange";
            }
          }
          index++;
          setTimeout(showInteraction, 1500);
        };
        optionsDiv.appendChild(btn);
      });
    };
  }

  showInteraction();
}

// === Email writing challenge loader ===
function loadEmailChallengeScene(sceneId) {
  const scene = scenes[sceneId];
  if (!scene) {
    console.error(`Scene ${sceneId} not found.`);
    return;
  }

  // Clear and hide the scene image container to prevent lingering images from previous scenes
  const sceneImage = document.getElementById("scene-image");
  if (sceneImage) {
    sceneImage.style.display = "none";
    sceneImage.innerHTML = "";
  }

  const emailContainer = document.getElementById("email-challenge-container");
  if (!emailContainer) {
    console.error("Email challenge container not found");
    return;
  }

  // Use scene.text explicitly, with a console warning if missing
  if (!scene.text || scene.text.trim() === "") {
    console.warn(`Scene ${sceneId} missing 'text' property or it is empty.`);
  }

  emailContainer.innerHTML = `
    <h2>Final Assignment</h2>
    <p style="white-space: pre-wrap; font-weight: 600;">${scene.text || "Please write an email to your teacher below."}</p>
    <form id="email-form" style="margin-top: 20px;">
      <label for="email-to">To:</label><br/>
      <input type="email" id="email-to" name="email-to" value="${scene.teacherEmail || ''}" style="width: 100%;" readonly /><br/><br/>
      
      <label for="email-subject">Subject:</label><br/>
      <input type="text" id="email-subject" name="email-subject" value="${scene.emailSubject || 'Assignment Submission'}" style="width: 100%;" /><br/><br/>
      
      <label for="email-body">Message:</label><br/>
      <textarea id="email-body" name="email-body" rows="8" style="width: 100%;">${scene.emailBody || ''}</textarea><br/><br/>
      
      <button type="button" id="send-email-btn">Send Email</button>
    </form>
    <div id="email-feedback" style="margin-top: 15px; font-weight: bold;"></div>
  `;

  const form = emailContainer.querySelector("#email-form");
  const toInput = emailContainer.querySelector("#email-to");
  const subjectInput = emailContainer.querySelector("#email-subject");
  const bodyInput = emailContainer.querySelector("#email-body");
  const feedback = emailContainer.querySelector("#email-feedback");
  const sendBtn = emailContainer.querySelector("#send-email-btn");

// Inside loadEmailChallengeScene(sceneId) — replace ONLY the click handler
sendBtn.onclick = () => {
  // Resolve the current scene safely (works even if the param name differs)
  const sid = typeof sceneId !== "undefined" ? sceneId : window.currentSceneId;
  const sc  = (window.scenes && window.scenes[sid]) || null;
  if (!sc) { console.error("Email scene not found for", sid); return; }

  const to  = (sc.teacherEmail || "").trim();
  const sub = encodeURIComponent(sc.emailSubject || "");

  // Try to read the body from UI; fall back to scene.emailBody
  const bodyEl =
    document.getElementById("email-body") ||
    document.getElementById("emailBody") ||
    document.querySelector("#email-challenge-container textarea");

  const uiBodyRaw = (bodyEl && bodyEl.value) || sc.emailBody || "";
  const body = encodeURIComponent(uiBodyRaw.replace(/\r?\n/g, "\r\n"));

  const href = `mailto:${to}?subject=${sub}&body=${body}`;

  // Try opening the mail client, but ALWAYS advance to next scene
  try { window.open(href, "_blank"); } catch (_) { location.href = href; }

  const nextId = sc.next;
  if (nextId) {
    try { window.unlockScene && window.unlockScene(nextId); } catch {}
    setTimeout(() => window.loadScene(nextId), 150);
  }
};


}
function loadInteractionScrambleScene(id) {
  console.log(`Loading interaction-scramble scene: ${id}`);
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }

  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const infoDiv = document.getElementById("challenge-info");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const choicesDiv = document.getElementById("choices-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scene6UI = document.getElementById("scene6-ui");

  // Clear unrelated UI containers
  [container, emailContainer, fillBlankContainer, choicesDiv, sceneText, sceneImage, scene6UI].forEach(el => {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  });

  // Setup scramble UI
  scrambleDiv.style.display = "block";
  scrambleDiv.innerHTML = "";
  feedbackDiv.style.display = "none";
  feedbackDiv.innerHTML = "";

  // Show info text if present
  if (infoDiv) {
    if (scene.emailFromClient) {
      infoDiv.style.display = "block";
      infoDiv.innerHTML = scene.emailFromClient;
    } else if (scene.contextText) {
      infoDiv.style.display = "block";
      infoDiv.textContent = scene.contextText;
    } else {
      infoDiv.style.display = "none";
      infoDiv.innerHTML = "";
    }
  }

  // Instruction
  const instruction = document.createElement("p");
  instruction.className = "scramble-instructions";
  instruction.textContent = "🧩 Drag the words into the correct order after listening to the audio:";
  scrambleDiv.appendChild(instruction);

  // Scramble words container
  const scrambleContainer = document.createElement("div");
  scrambleContainer.id = "scramble-words";
  const shuffled = shuffleArray(scene.scramble);
  shuffled.forEach(word => {
    const span = document.createElement("span");
    span.className = "scramble-word";
    span.textContent = word;
    scrambleContainer.appendChild(span);
  });
  scrambleDiv.appendChild(scrambleContainer);

  // Destroy old Sortable instance
  if (window.scrambleSortable) {
    window.scrambleSortable.destroy();
  }
  window.scrambleSortable = Sortable.create(scrambleContainer, { animation: 150 });

  // Audio player
  let audioElem = document.getElementById("scene-audio");
  if (audioElem) {
    audioElem.pause();
    audioElem.src = "";
    audioElem.load();
    audioElem.remove();
  }
  audioElem = document.createElement("audio");
  audioElem.id = "scene-audio";
  audioElem.controls = true;
  audioElem.src = scene.audio;
  document.getElementById("game-container").appendChild(audioElem);
  audioElem.load();

  // Submit button
  let submitBtn = document.getElementById("scramble-submit-btn");
  if (submitBtn) {
    submitBtn.removeEventListener('click', submitBtn._listener);
    submitBtn.remove();
  }
  submitBtn = document.createElement("button");
  submitBtn.id = "scramble-submit-btn";
  submitBtn.textContent = "Submit Answer";
  submitBtn.style.marginTop = "15px";
  scrambleDiv.appendChild(document.createElement("br"));
  scrambleDiv.appendChild(submitBtn);

  const onSubmit = () => {
    const arrangedWords = Array.from(scrambleContainer.querySelectorAll('.scramble-word')).map(el => el.textContent);
    if (arraysEqual(arrangedWords, scene.correct)) {
      alert("Correct! Moving to next scene.");
      currentSceneId = scene.next;
      loadScene(currentSceneId);
    } else {
      alert("Not quite right. Try again.");
    }
  };
  submitBtn.addEventListener('click', onSubmit);
  submitBtn._listener = onSubmit;
}

function loadInteractionFillBlankScene(id) {
  console.log(`Loading interaction-fill-in-the-blank scene: ${id}`);
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }

  // Containers
  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const infoDiv = document.getElementById("challenge-info");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const choicesDiv = document.getElementById("choices-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scene6UI = document.getElementById("scene6-ui");

  // Clear unrelated UI containers
  [container, emailContainer, scrambleDiv, feedbackDiv, choicesDiv, sceneText, sceneImage, scene6UI].forEach(el => {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  });

  if (fillBlankContainer) {
    fillBlankContainer.style.display = "block";
    fillBlankContainer.innerHTML = "";
  }

  // Show info text if present
  if (infoDiv) {
    if (scene.emailFromClient) {
      infoDiv.style.display = "block";
      infoDiv.innerHTML = scene.emailFromClient;
    } else if (scene.contextText) {
      infoDiv.style.display = "block";
      infoDiv.textContent = scene.contextText;
    } else {
      infoDiv.style.display = "none";
      infoDiv.innerHTML = "";
    }
  }

  // Audio player
  let audioElem = document.getElementById("scene-audio");
  if (audioElem) {
    audioElem.pause();
    audioElem.src = "";
    audioElem.load();
    audioElem.remove();
  }
  audioElem = document.createElement("audio");
  audioElem.id = "scene-audio";
  audioElem.controls = true;
  audioElem.src = scene.audio;
  document.getElementById("game-container").appendChild(audioElem);
  audioElem.load();

  // Build fill-in-the-blank UI
  fillBlankContainer.innerHTML = `
    <h2>Fill in the Blanks Challenge</h2>
    <p>${scene.text || "Fill in the blanks by dragging the correct options below."}</p>
    <p id="fill-blank-sentence" style="font-size: 1.2rem; line-height: 1.5; margin-bottom: 20px;"></p>
    <div id="fill-blank-options" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
    <button id="check-fill-blank-answer">Check Answer</button>
    <div id="fill-blank-feedback" style="margin-top: 10px; font-weight: bold;"></div>
  `;

  const sentenceEl = fillBlankContainer.querySelector("#fill-blank-sentence");
  const optionsEl = fillBlankContainer.querySelector("#fill-blank-options");
  const feedbackEl = fillBlankContainer.querySelector("#fill-blank-feedback");

  // Render sentence with blanks
  let html = "";
  for (let i = 0; i < scene.sentence.length; i++) {
    if (scene.blanks.includes(i)) {
      html += `<span class="fill-blank-dropzone" data-index="${i}" style="
        display: inline-block;
        min-width: 80px;
        border-bottom: 2px solid #00ffff;
        margin: 0 4px;
        vertical-align: bottom;
        padding: 4px 6px;
        cursor: pointer;
        background-color: #111;
      "></span> `;
    } else {
      html += `<span style="margin: 0 4px;">${scene.sentence[i]}</span> `;
    }
  }
  sentenceEl.innerHTML = html;

  // Render draggable options
  optionsEl.innerHTML = "";
  scene.options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.className = "fill-blank-option";
    btn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: 2px solid #00ffff;
      background: #000;
      color: #0ff;
      font-weight: bold;
      cursor: grab;
      user-select: none;
    `;
    optionsEl.appendChild(btn);
  });

  // Cleanup Sortable instances if any
  if (fillBlankContainer._sortableBlanks) {
    fillBlankContainer._sortableBlanks.forEach(s => s.destroy());
    fillBlankContainer._sortableBlanks = null;
  }
  if (fillBlankContainer._sortableOptions) {
    fillBlankContainer._sortableOptions.destroy();
    fillBlankContainer._sortableOptions = null;
  }

  // Setup SortableJS droppable blanks
  const dropzones = sentenceEl.querySelectorAll(".fill-blank-dropzone");
  fillBlankContainer._sortableBlanks = Array.from(dropzones).map(zone => {
    return Sortable.create(zone, {
      group: "fillInTheBlank",
      animation: 150,
      sort: false,
      onAdd: evt => {
        const dragged = evt.item;
        if (dragged.parentNode === optionsEl) {
          dragged.parentNode.removeChild(dragged);
        }
        if (evt.to.children.length > 1) {
          Array.from(evt.to.children).forEach(child => {
            if (child !== dragged) {
              evt.to.removeChild(child);
              optionsEl.appendChild(child);
            }
          });
        }
      },
      onRemove: evt => {
        optionsEl.appendChild(evt.item);
      }
    });
  });

  // Setup SortableJS options container
  fillBlankContainer._sortableOptions = Sortable.create(optionsEl, {
    group: "fillInTheBlank",
    animation: 150,
  });

  // Check answer logic
  const checkBtn = fillBlankContainer.querySelector("#check-fill-blank-answer");
  checkBtn.removeEventListener('click', checkBtn._listener);
  const onCheck = () => {
    const userAnswers = [];
    let allFilled = true;
    dropzones.forEach(zone => {
      if (zone.children.length === 1) {
        userAnswers.push(zone.children[0].textContent.trim());
      } else {
        allFilled = false;
      }
    });

    if (!allFilled) {
      feedbackEl.textContent = "⚠️ Please fill all blanks.";
      feedbackEl.style.color = "orange";
      return;
    }

    const allCorrect = userAnswers.every(
      (ans, i) => ans.toLowerCase() === scene.correct[i].toLowerCase()
    );

    if (allCorrect) {
      feedbackEl.textContent = "✅ Correct! Well done.";
      feedbackEl.style.color = "lightgreen";
      if (scene.next) {
        setTimeout(() => loadScene(scene.next), 1500);
      }
    } else {
      feedbackEl.textContent = "❌ Not quite. Try again.";
      feedbackEl.style.color = "red";
    }
  };
  checkBtn.addEventListener('click', onCheck);
  checkBtn._listener = onCheck;
}

function loadInteractionAudioMCScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Optional: reset a cross-scene tally at the START of a block
  try {
    if (scene.tallyKey && scene.tallyReset && typeof tallyReset === 'function') {
      const max = (scene.tallyMax != null) ? scene.tallyMax : null;
      tallyReset(scene.tallyKey, max);
    }
  } catch(_) {}

  // Shorthands
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  // Base containers
  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  // Clear any prior UI for this loader
  const old = document.getElementById("iamc-ui");
  if (old) old.remove();

  // Build UI shell
  const ui = document.createElement("div");
  ui.id = "iamc-ui";
  ui.style.cssText = "margin-top:10px;";
  regNode(ui);
  game.appendChild(ui);

  // Prompt audio (the clip you listen to before answering)
  let prompt = null;
  if (scene.audio) {
    prompt = document.createElement("audio");
    prompt.id = "iamc-prompt";
    prompt.controls = true;
    prompt.src = scene.audio;
    prompt.style.cssText = "width:100%;max-width:640px;display:block;margin:0 auto 12px;";
    regNode(prompt);
    ui.appendChild(prompt);
  }

  // Timer UI (starts only when the prompt audio ENDS)
  let timerId = null, timeLeft = 0;
  const DEFAULT_SECONDS = 15;
  const timerDiv = document.createElement("div");
  timerDiv.id = "iamc-timer";
  timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:6px 0;display:none;";
  ui.appendChild(timerDiv);

  function computeSeconds() {
    return (scene.timer === true) ? DEFAULT_SECONDS
         : (Number.isFinite(scene.timer) ? Number(scene.timer) : null);
  }

  function clearTimer(){ if (timerId) { clearInterval(timerId); timerId = null; } }

  function startTimer(onTimeout) {
    const sec = computeSeconds();
    if (!sec || sec <= 0) return; // no timer configured
    timeLeft = sec;
    timerDiv.style.display = "block";
    timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
    timerId = setInterval(() => {
      timeLeft--;
      timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`;
      if (timeLeft <= 0) {
        clearInterval(timerId); timerId = null;
        // route as TIMEOUT
        finish(false, 'timeout');
      }
    }, 1000);
  }

  // Helpers
  const looksLikeAudio = s => typeof s === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(s);
  const optToLabel = (opt, idx) => looksLikeAudio(opt) ? `▶ Option ${idx+1}` : String(opt);
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

  // Normalize options (preserve original index for correctness)
  const rawOptions = Array.isArray(scene.options) ? scene.options.slice() : [];
  let items = rawOptions.map((opt, i) => ({ opt, i }));
  if (scene.shuffleOptions) shuffle(items);

  // Correctness (index or string)
  const correctIndex = Number.isInteger(scene.correct) ? Number(scene.correct) : null;
  const correctString = (typeof scene.correct === 'string') ? scene.correct.trim().toLowerCase() : null;
  function isCorrectIndex(chosenOriginalIndex){
    if (correctIndex != null) return chosenOriginalIndex === correctIndex;
    if (correctString != null) {
      const raw = rawOptions[chosenOriginalIndex];
      const asLabel = optToLabel(raw, chosenOriginalIndex).trim().toLowerCase();
      const asRaw   = String(raw || '').trim().toLowerCase();
      return (asLabel === correctString) || (asRaw === correctString);
    }
    return false;
  }

  // Feedback area
  const feedback = document.createElement("div");
  feedback.id = "iamc-feedback";
  feedback.style.cssText = "margin-top:10px;font-weight:700;";
  ui.appendChild(feedback);

  // End routing
  function branchByScoreOrNext() {
    if (scene.scoring && scene.endings) {
      let total = 0;
      try { if (scene.tallyKey && typeof tallyGet === 'function') total = Number(tallyGet(scene.tallyKey)) || 0; } catch(_) {}
      const hi = (scene.scoring.high ?? Infinity);
      const md = (scene.scoring.medium ?? -Infinity);
      let dest = scene.endings.low;
      if (total >= hi) dest = scene.endings.high;
      else if (total >= md) dest = scene.endings.medium;
      if (dest) return loadScene(dest);
      console.warn('interaction-audio-mc: endings present but missing a destination.');
    }
    if (scene.next) return loadScene(scene.next);
    console.warn('interaction-audio-mc: no next/endings; staying here.');
  }

  let locked = false;
  function finish(isCorrect, reason) {
    if (locked) return; locked = true;
    clearTimer();

    // tally
    try {
      if (scene.tallyKey && typeof tallyAdd === 'function') {
        tallyAdd(scene.tallyKey, isCorrect ? (scene.tallyWeight || 1) : 0);
      }
    } catch(_) {}

    // route with precedence: timeout → wrong → (score/next)
    let dest = null;
    if (reason === 'timeout' && scene.endings && scene.endings.timeout) {
      dest = scene.endings.timeout;
    } else if (!isCorrect && scene.endings && scene.endings.wrong) {
      dest = scene.endings.wrong;
    }

    feedback.textContent = isCorrect ? "✅ Correct! Moving on..." :
                          (reason === 'timeout' ? "⌛ Time's up. Restarting..." : "❌ Not quite. Restarting...");
    feedback.style.color = isCorrect ? "lightgreen" : (reason === 'timeout' ? "orange" : "salmon");

    setTimeout(() => {
      if (dest) return loadScene(dest);
      return branchByScoreOrNext();
    }, 800);
  }

  // Build options
  const optionsWrap = document.createElement("div");
  optionsWrap.id = "iamc-options";
  optionsWrap.style.cssText = "display:flex;flex-direction:column;gap:10px;margin:10px 0;";
  ui.appendChild(optionsWrap);

  items.forEach(({opt, i: originalIndex}, idxShown) => {
    if (looksLikeAudio(opt)) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
      const au = document.createElement("audio");
      au.controls = true;
      au.src = opt;
      au.style.cssText = "flex:1 1 280px;min-width:220px;";
      const btn = document.createElement("button");
      btn.textContent = `Choose ${idxShown+1}`;
      btn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      btn.onmouseenter = () => (btn.style.background = "#00cccc");
      btn.onmouseleave = () => (btn.style.background = "#00ffff");
      regListener(btn, "click", () => finish(isCorrectIndex(originalIndex)));
      row.appendChild(au); row.appendChild(btn);
      optionsWrap.appendChild(row);
    } else {
      const btn = document.createElement("button");
      btn.textContent = optToLabel(opt, idxShown);
      btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      btn.onmouseenter = () => (btn.style.background = "#00cccc");
      btn.onmouseleave = () => (btn.style.background = "#00ffff");
      regListener(btn, "click", () => finish(isCorrectIndex(originalIndex)));
      optionsWrap.appendChild(btn);
    }
  });

  // Start timer ONLY after the prompt audio ends; if no prompt clip, start now.
  if (prompt) {
    regListener(prompt, 'ended', () => startTimer(() => finish(false, 'timeout')));
  } else {
    startTimer(() => finish(false, 'timeout'));
  }

  // Cleanup on leave
  regCleanup(() => { clearTimer(); const node = document.getElementById("iamc-ui"); if (node) node.remove(); });
}






 
// ─────────────────────────────────────────────────────────────────────────────
// Mobile-safe VIDEO → MULTI QUESTION
// ─────────────────────────────────────────────────────────────────────────────
function loadVideoMultiQuestionScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Optional cross-scene tally reset
  try {
    if (scene.tallyKey && scene.tallyReset && typeof tallyReset === 'function') {
      tallyReset(scene.tallyKey, scene.tallyMax ?? (scene.questions?.length || null));
    }
  } catch(_) {}

  const VMQ_DEFAULT_SECONDS = 15;

  // Safe shorthands
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  // Clear stale UI
  ["vmq-wrap","scene-video","video-multi-question-timer","video-multi-question-options","video-multi-question-feedback"]
    .forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });

  // Wrapper + video (inline-safe)
  const wrap = document.createElement("div");
  wrap.id = "vmq-wrap";
  wrap.style.cssText = "position:relative;max-width:100%;margin:0 auto 16px;";
  game.appendChild(wrap);

const video = document.createElement("video");
video.id = "scene-video";
video.controls = true;
video.preload = "metadata";

// ✅ resolve URLs so GitHub Pages + <base> work
video.src = resolveSrc(scene.videoSrc);
if (scene.poster) video.poster = resolveSrc(scene.poster);

// inline-friendly on iOS/mobile
video.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;";
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");
video.playsInline = true;

regNode(video);

// (optional while testing)
// video.addEventListener("error", () => console.log("VMQ video error =", video.error && video.error.code), { once:true });

  regNode(video);

  const overlay = document.createElement("button");
  overlay.textContent = "▶ Tap to Play";
  overlay.style.cssText = "position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:180px;height:48px;background:#00ffff;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer";
  overlay.onclick = async () => { try { await video.play(); overlay.remove(); } catch(_){} };
  video.addEventListener("play", () => { if (overlay.parentNode) overlay.remove(); });

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip video";
  skipBtn.style.cssText = "margin-top:8px;padding:8px 12px;border:none;border-radius:8px;background:#222;color:#eee;cursor:pointer;font-weight:700";
  skipBtn.onclick = () => startQuestions();

  const errorMsg = () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.target = "_blank";
    a.textContent = "Open video in a new tab";
    a.style.cssText = "display:inline-block;margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    wrap.appendChild(msg);
  };
  video.addEventListener("error", errorMsg);

  wrap.appendChild(video);
  wrap.appendChild(overlay);
  wrap.appendChild(skipBtn);

  // State
  const questions = Array.isArray(scene.questions) ? scene.questions : [];
  let qIndex = 0, score = 0, timerInterval = null, timeLeft = 0;

  function resolveTimerSeconds(scene, q) {
    const pick = (v) => {
      if (v === false || v == null) return null;
      if (v === true) return VMQ_DEFAULT_SECONDS;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    const perQ = pick(q && q.timer);
    const perScene = pick(scene && scene.timer);
    return (perQ != null) ? perQ : (perScene != null ? perScene : VMQ_DEFAULT_SECONDS);
  }
  function clearTimer(){ if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

  function finish() {
    // cleanup
    ["video-multi-question-timer","video-multi-question-options","video-multi-question-feedback"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });
    clearTimer();
    try { video.pause(); } catch(_){}
    if (wrap && wrap.parentNode) wrap.remove();

    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      const dest = (score >= high) ? scene.endings.high
                 : (score >= medium) ? scene.endings.medium
                 : scene.endings.low;
      if (dest) return loadScene(dest);
    }
    if (scene.next) return loadScene(scene.next);
    console.warn("video-multi-question: No endings or next specified.");
  }

  function startQuestions() {
    wrap.style.display = "none";
    try { video.pause(); } catch(_){}
    qIndex = 0; score = 0;
    renderQuestion();
  }

  function renderQuestion() {
    if (qIndex >= questions.length) return finish();

    // clear old
    ["video-multi-question-timer","video-multi-question-options","video-multi-question-feedback"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });
    clearTimer();

    const q = questions[qIndex];
    if (!q) { console.error(`Question ${qIndex} missing`); return finish(); }
    if (sceneText) sceneText.textContent = q.text || "";

    // Timer
    const seconds = resolveTimerSeconds(scene, q);
    if (seconds && seconds > 0) {
      timeLeft = seconds;
      const timerDiv = document.createElement("div");
      timerDiv.id = "video-multi-question-timer";
      timerDiv.style.cssText = "font-weight:700;font-size:1.1rem;color:#00ffff;margin-top:10px;";
      timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
      game.appendChild(timerDiv);

      timerInterval = setInterval(() => {
        timeLeft -= 1;
        if (timerDiv) timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`;
        if (timeLeft <= 0) {
          clearTimer();
          // count a miss in cross-scene tally if enabled
          try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, 0); } catch(_){}
          feedback("⏲️ Time's up. Moving on...", "orange", false, true);
        }
      }, 1000);
    }

    // Options
    const optionsDiv = document.createElement("div");
    optionsDiv.id = "video-multi-question-options";
    optionsDiv.style.marginTop = "15px";
    game.appendChild(optionsDiv);

    const feedbackDiv = document.createElement("div");
    feedbackDiv.id = "video-multi-question-feedback";
    feedbackDiv.style.cssText = "margin-top:15px;font-weight:700;";
    game.appendChild(feedbackDiv);

    function disable(){ [...optionsDiv.children].forEach(b => b.disabled = true); }
    function feedback(msg, color, isCorrect, timedOut=false) {
      clearTimer(); disable();
      feedbackDiv.textContent = msg;
      feedbackDiv.style.color = color;
      if (isCorrect) score++;
      setTimeout(() => { qIndex++; renderQuestion(); }, timedOut ? 900 : 700);
    }

    const opts = Array.isArray(q.options) ? q.options.slice() : [];
    const correctIndex = Number(q.correct);

    // optional shuffle
    if (scene.shuffleOptions) {
      for (let i=opts.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [opts[i],opts[j]]=[opts[j],opts[i]]; }
    }

    opts.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.textContent = (typeof opt === "string") ? opt : String(opt);
      btn.style.cssText = "margin:5px;padding:8px 16px;font-weight:700;background:#00ffff;border:none;border-radius:8px;cursor:pointer";
      btn.onmouseenter = () => (btn.style.backgroundColor = "#00cccc");
      btn.onmouseleave = () => (btn.style.backgroundColor = "#00ffff");
      regListener(btn, "click", () => {
        const ok = (i === correctIndex);
        // cross-scene tally (optional)
        try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, ok ? (scene.tallyWeight || 1) : 0); } catch(_){}
        feedback(ok ? "✅ Correct! Moving on..." : "❌ Not quite. Moving on...", ok ? "lightgreen" : "salmon", ok);
      });
      optionsDiv.appendChild(btn);
    });
  }

  regListener(video, "ended", startQuestions);
}


// ─────────────────────────────────────────────────────────────────────────────
// Mobile-safe VIDEO → MULTI *AUDIO* CHOICE (each option is an audio clip)
// ─────────────────────────────────────────────────────────────────────────────
function loadVideoMultiAudioChoiceScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene data not found for ID: ${id}`); return; }

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const container = document.getElementById("scene-container");

  [sceneImage, container].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }
  if (gameContainer) gameContainer.style.display = "block";

  // Remove stale UI
  const prevUI = document.getElementById("video-multi-audio-question-ui");
  if (prevUI) prevUI.remove();
  const oldVid = document.getElementById("scene-video");
  if (oldVid) oldVid.remove();

  // Video (mobile-safe)
  const videoWrap = document.createElement("div");
  videoWrap.style.cssText = "position:relative;max-width:100%;margin:0 auto 16px;";

  const videoElem = document.createElement("video");
  videoElem.id = "scene-video";
  videoElem.controls = true;
  videoElem.preload = "metadata";
  videoElem.src = resolveSrc(scene.videoSrc);
  if (scene.poster) videoElem.poster = resolveSrc(scene.poster);
  videoElem.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;";
  videoElem.setAttribute("playsinline", "");
  videoElem.setAttribute("webkit-playsinline", "");
  videoElem.playsInline = true;

  const playOverlay = document.createElement("button");
  playOverlay.textContent = "▶ Tap to Play";
  playOverlay.style.cssText = "position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:180px;height:48px;" +
                              "background:#00ffff;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer";
  playOverlay.onclick = async () => {
    try { await videoElem.play(); playOverlay.remove(); } catch(e) { console.warn("User play failed:", e); }
  };
  videoElem.addEventListener("play", () => playOverlay.remove());

  videoElem.addEventListener("error", () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.target = "_blank";
    a.textContent = "Open video in a new tab";
    a.style.cssText = "display:inline-block;margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    videoWrap.appendChild(msg);
  });

  // Optional SKIP button
  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip video";
  skipBtn.style.cssText = "margin-top:8px;padding:8px 12px;border:none;border-radius:8px;background:#222;color:#eee;cursor:pointer;font-weight:700";
  skipBtn.onclick = () => showQuestion();
  videoWrap.appendChild(skipBtn);

  videoWrap.appendChild(videoElem);
  videoWrap.appendChild(playOverlay);
  gameContainer.appendChild(videoWrap);

  // Question UI (hidden until video ends or skip)
  let questionUI = document.createElement("div");
  questionUI.id = "video-multi-audio-question-ui";
  questionUI.style.maxWidth = "700px";
  questionUI.style.margin = "0 auto";
  questionUI.style.color = "#eee";
  questionUI.style.fontSize = "1.1rem";
  questionUI.style.display = "none";
  gameContainer.appendChild(questionUI);

  let index = 0;
  let score = 0;

  function cleanupQuestionUI() {
    questionUI.style.display = "none";
    questionUI.innerHTML = "";
  }

  function finishBlock() {
    cleanupQuestionUI();
    try { videoElem.pause(); } catch(_) {}
    if (videoWrap.parentNode) videoWrap.remove();

    if (scene.scoring && scene.endings) {
      let endingScene;
      if (score >= scene.scoring.high) endingScene = scene.endings.high;
      else if (score >= scene.scoring.medium) endingScene = scene.endings.medium;
      else endingScene = scene.endings.low;
      if (endingScene) return loadScene(endingScene);
    }
    if (scene.next) return loadScene(scene.next);
    console.warn("video-multi-audio-choice: no next/endings specified.");
  }

  function showQuestion() {
    // hide video area once questions start
    videoWrap.style.display = "none";

    if (index >= (scene.questions?.length || 0)) return finishBlock();

    const question = scene.questions[index];
    questionUI.style.display = "block";
    questionUI.innerHTML = `
      <p><strong>Question ${index + 1}:</strong> ${question.text || ""}</p>
      <div id="audio-options-container" style="margin-top: 12px;"></div>
      <div id="video-multi-audio-feedback" style="margin-top: 10px; font-weight: bold;"></div>
    `;

    const optionsContainer = document.getElementById("audio-options-container");
    const feedbackDiv = document.getElementById("video-multi-audio-feedback");

    optionsContainer.innerHTML = "";

    (question.options || []).forEach((audioSrc, i) => {
      const optionLabel = document.createElement("label");
      optionLabel.style.display = "block";
      optionLabel.style.marginBottom = "12px";
      optionLabel.style.cursor = "pointer";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "audio-choice";
      radio.value = i;
      radio.style.marginRight = "10px";

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = resolveSrc(audioSrc);
      audio.style.verticalAlign = "middle";

      optionLabel.appendChild(radio);
      optionLabel.appendChild(audio);
      optionsContainer.appendChild(optionLabel);
    });

    // Submit button (fresh each q)
    let submitBtn = document.getElementById("video-multi-audio-submit-btn");
    if (submitBtn) submitBtn.remove();

    submitBtn = document.createElement("button");
    submitBtn.id = "video-multi-audio-submit-btn";
    submitBtn.textContent = "Submit Answer";
    submitBtn.style.cssText = "margin-top: 15px; padding: 8px 16px; font-weight: 700; background: #00ffff; border: none; border-radius: 8px; cursor: pointer";
    submitBtn.onmouseover = () => (submitBtn.style.backgroundColor = "#00cccc");
    submitBtn.onmouseout  = () => (submitBtn.style.backgroundColor = "#00ffff");
    questionUI.appendChild(submitBtn);

    submitBtn.onclick = () => {
      const selected = document.querySelector('input[name="audio-choice"]:checked');
      if (!selected) {
        feedbackDiv.textContent = "⚠️ Please select an answer.";
        feedbackDiv.style.color = "orange";
        return;
      }
      const answerIndex = parseInt(selected.value, 10);
      if (answerIndex === question.correct) {
        score++;
        feedbackDiv.textContent = "✅ Correct! Moving on...";
        feedbackDiv.style.color = "lightgreen";
      } else {
        feedbackDiv.textContent = "❌ Not quite. Moving on...";
        feedbackDiv.style.color = "salmon";
      }
      submitBtn.disabled = true;
      setTimeout(() => { index++; showQuestion(); }, 900);
    };
  }

  // Start questions after video ends (or on Skip)
  videoElem.addEventListener("ended", showQuestion);
}
// ─────────────────────────────────────────────────────────────────────────────
// Video → Scramble scene (inline-safe + GitHub Pages-safe URLs)
// ─────────────────────────────────────────────────────────────────────────────
function loadVideoScrambleScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  const gameContainer = document.getElementById("game-container");
  const sceneText     = document.getElementById("scene-text");
  const sceneImage    = document.getElementById("scene-image");
  const infoDiv       = document.getElementById("challenge-info");
  const scrambleDiv   = document.getElementById("sentence-scramble");
  const feedbackDiv   = document.getElementById("scramble-feedback");

  // Hide unrelated UI; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (gameContainer) gameContainer.style.display = "block";
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }

  // Clear any previous video
  let old = document.getElementById("scene-video");
  if (old) { try { old.pause(); } catch(_){} old.src = ""; old.load(); old.remove(); }

  // Build video (resolved URL + inline-safe)
  const videoElem = document.createElement("video");
  videoElem.id = "scene-video";
  videoElem.controls = true;
  videoElem.preload  = "metadata";
  videoElem.setAttribute("playsinline", "");
  videoElem.setAttribute("webkit-playsinline", "");
  videoElem.playsInline = true;
  videoElem.src = resolveSrc(scene.videoSrc);
  if (scene.poster) videoElem.poster = resolveSrc(scene.poster);
  videoElem.style.cssText = "max-width:100%;max-height:360px;display:block;margin:0 auto 20px;border-radius:12px;background:#000;";

  // Graceful fallback if inline playback fails
  videoElem.addEventListener("error", () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700;text-align:center";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.target = "_blank";
    a.textContent = "Open video in a new tab";
    a.style.cssText = "margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    gameContainer.appendChild(msg);
  }, { once:true });

  // Insert video into DOM
  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(videoElem, sceneText.nextSibling);
  } else {
    gameContainer.appendChild(videoElem);
  }

  // After video ends, show scramble UI
  videoElem.onended = () => {
    if (!scrambleDiv || !feedbackDiv) return;

    scrambleDiv.style.display = "block";
    feedbackDiv.style.display = "block";
    scrambleDiv.innerHTML = "";
    feedbackDiv.textContent = "";

    // Instruction
    const instruction = document.createElement("p");
    instruction.className = "scramble-instructions";
    instruction.textContent = "🧩 Drag the words into the correct order:";
    scrambleDiv.appendChild(instruction);

    // Scramble container
    const scrambleContainer = document.createElement("div");
    scrambleContainer.id = "scramble-words";
    const source = Array.isArray(scene.scramble) ? scene.scramble.slice() : [];
    const shuffled = shuffleArray(source);
    shuffled.forEach(token => {
      const span = document.createElement("span");
      span.className = "scramble-word";
      span.textContent = token;
      scrambleContainer.appendChild(span);
    });
    scrambleDiv.appendChild(scrambleContainer);

    // Enable drag/drop
    try {
      if (window.scrambleSortable && typeof window.scrambleSortable.destroy === "function") {
        window.scrambleSortable.destroy();
      }
      window.scrambleSortable = Sortable.create(scrambleContainer, { animation: 150 });
    } catch (e) { console.warn("Sortable unavailable; drag disabled.", e); }

    // Check button
    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.style.marginTop = "15px";
    scrambleDiv.appendChild(checkBtn);

    checkBtn.onclick = () => {
      const words = Array.from(document.querySelectorAll("#scramble-words .scramble-word"));
      const userOrder = words.map(w => w.textContent.trim());
      const correctArr = Array.isArray(scene.correct)
        ? scene.correct
        : (typeof scene.correct === "string" ? scene.correct.trim().split(/\s+/) : []);

      if (arraysEqual(userOrder, correctArr)) {
        feedbackDiv.textContent = "✅ Correct! Moving on...";
        feedbackDiv.style.color = "lightgreen";
        if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
        if (Array.isArray(scene.setFlags))     scene.setFlags.forEach(setFlag);
        setTimeout(() => { if (scene.next) loadScene(scene.next); }, 1200);
      } else {
        feedbackDiv.textContent = "❌ Not quite. Try again.";
        feedbackDiv.style.color = "salmon";
      }
    };
  };
}
 





// --- Video → Fill-in-the-Blank loader ---
function loadVideoFillBlankScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Safe shorthands
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  // Clear stale UI
  ["vfb-wrap","vfb-ui","scene-video"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });

  // ---- Inline-safe video wrapper
  const wrap = document.createElement("div");
  wrap.id = "vfb-wrap";
  wrap.style.cssText = "position:relative;max-width:100%;margin:0 auto 16px;";
  game.appendChild(wrap);

  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.preload = "metadata";
  if (scene.poster) video.poster = resolveSrc(scene.poster);
  video.src = resolveSrc(scene.videoSrc);
  video.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.playsInline = true;
  regNode(video);

  const overlay = document.createElement("button");
  overlay.textContent = "▶ Tap to Play";
  overlay.style.cssText = "position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:180px;height:48px;background:#00ffff;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer";
  overlay.onclick = async () => { try { await video.play(); overlay.remove(); } catch(_){} };
  video.addEventListener("play", () => { if (overlay.parentNode) overlay.remove(); });

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip video";
  skipBtn.style.cssText = "margin-top:8px;padding:8px 12px;border:none;border-radius:8px;background:#222;color:#eee;cursor:pointer;font-weight:700";
  skipBtn.onclick = () => startFIB();

  const errorMsg = () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.textContent = "Open video in a new tab";
    a.style.cssText = "display:inline-block;margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    wrap.appendChild(msg);
  };
  video.addEventListener("error", errorMsg);

  wrap.appendChild(video);
  wrap.appendChild(overlay);
  wrap.appendChild(skipBtn);

  // ---- FIB UI
  function startFIB() {
    wrap.style.display = "none";
    try { video.pause(); } catch(_) {}

    const ui = document.createElement("div");
    ui.id = "vfb-ui";
    ui.style.cssText = "max-width:900px;margin:0 auto;color:#eee";
    game.appendChild(ui);

    const sentEl = document.createElement("p");
    sentEl.id = "vfb-sentence";
    sentEl.style.cssText = "font-size:1.2rem;line-height:1.5;margin-bottom:14px;";
    ui.appendChild(sentEl);

    const optsEl = document.createElement("div");
    optsEl.id = "vfb-options";
    optsEl.style.cssText = "margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;";
    ui.appendChild(optsEl);

    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    ui.appendChild(ctrl);

    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
    checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
    ctrl.appendChild(checkBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#333;color:#eee;font-weight:700;cursor:pointer";
    ctrl.appendChild(resetBtn);

    const fb = document.createElement("div");
    fb.id = "vfb-feedback";
    fb.style.cssText = "margin-top:10px;font-weight:700;";
    ui.appendChild(fb);

    // Data prep — build sentence/blanks if not provided
    const toWords = s => String(s||"").trim().split(/\s+/).filter(Boolean);
    if (!Array.isArray(scene.sentence) || !Array.isArray(scene.blanks)) {
      const parts = String(scene.text || "").split("___");
      const toks = []; const blanks = [];
      parts.forEach((seg, i) => {
        if (seg) toks.push(...toWords(seg));
        if (i < parts.length - 1) { blanks.push(toks.length); toks.push("___"); }
      });
      scene.sentence = scene.sentence || toks;
      scene.blanks   = scene.blanks   || blanks;
    }

    const sentence = Array.isArray(scene.sentence) ? scene.sentence.slice() : [];
    const blanks   = Array.isArray(scene.blanks) ? scene.blanks.slice() : [];
    const options  = Array.isArray(scene.options) ? scene.options.slice() : [];
    const correct  = Array.isArray(scene.correct) ? scene.correct.slice()
                    : (typeof scene.correct === "string" ? [scene.correct] : []);

    // Render sentence with dropzones
    function paintSentence() {
      let html = "";
      for (let i = 0; i < sentence.length; i++) {
        if (blanks.includes(i)) {
          html += `<span class="vfb-zone" data-idx="${i}" style="display:inline-block;min-width:86px;border-bottom:2px solid #00ffff;margin:0 4px;vertical-align:bottom;padding:4px 6px;background:#111"></span> `;
        } else {
          html += `<span style="margin:0 4px;">${sentence[i]}</span> `;
        }
      }
      sentEl.innerHTML = html;
    }
    paintSentence();

    // Render options
    function paintOptions() {
      optsEl.innerHTML = "";
      options.forEach(opt => {
        const b = document.createElement("button");
        b.textContent = opt;
        b.className = "vfb-opt";
        b.style.cssText = "padding:6px 12px;border-radius:6px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:grab;user-select:none";
        optsEl.appendChild(b);
      });
    }
    paintOptions();

    // Enable drag/drop with Sortable
    const zones = Array.from(sentEl.querySelectorAll(".vfb-zone"));
    const sortZones = [];
    zones.forEach(zone => {
      try {
        const srt = Sortable.create(zone, { group:"vfb", animation:150, sort:false,
          onAdd: (evt) => {
            const dragged = evt.item;
            // ensure one token per zone
            if (zone.children.length > 1) {
              Array.from(zone.children).forEach((c,idx) => { if (idx>0) { optsEl.appendChild(c); } });
            }
          },
          onRemove: (evt) => { optsEl.appendChild(evt.item); }
        });
        sortZones.push(srt);
      } catch(e) { console.warn("Sortable missing?", e); }
    });
    let sortOpts;
    try { sortOpts = Sortable.create(optsEl, { group:"vfb", animation:150 }); } catch(e){}

    function sameToken(a,b){
      const norm = s => String(s||"")
        .replace(/[’']/g,"")        // ignore apostrophes
        .replace(/\s+/g," ")
        .toLowerCase().trim();
      return norm(a) === norm(b);
    }

    checkBtn.onclick = () => {
      const user = [];
      let filled = true;
      zones.forEach((zone, zi) => {
        if (zone.children.length === 1) user.push(zone.children[0].textContent.trim());
        else filled = false;
      });
      if (!filled) { fb.textContent = "⚠️ Please fill all blanks."; fb.style.color = "orange"; return; }

      const ok = (user.length === correct.length) && user.every((t,i) => sameToken(t, correct[i]));
      if (ok) {
        fb.textContent = "✅ Correct! Moving on...";
        fb.style.color = "lightgreen";
        try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, scene.tallyWeight || 1); } catch(_){}
        setTimeout(() => scene.next ? loadScene(scene.next) : console.warn("video-fill-in-the-blank: no next"), 900);
      } else {
        fb.textContent = "❌ Not quite. Try again.";
        fb.style.color = "salmon";
      }
    };

    resetBtn.onclick = () => {
      zones.forEach(z => { Array.from(z.children).forEach(ch => optsEl.appendChild(ch)); });
      paintOptions();
      fb.textContent = "";
    };

    regCleanup(() => { const n = document.getElementById("vfb-ui"); if (n) n.remove(); });
  }

  regListener(video, "ended", startFIB);
}

function loadVideoChoiceScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Safe shorthands (don’t break if helpers aren’t present)
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");

  // Hide unrelated UI
  [sceneImage].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; }});
  if (sceneText) { sceneText.style.display = "none"; sceneText.textContent = ""; }
  if (game) game.style.display = "block";

  // Remove any prior instance
  const stale = document.getElementById("vc-wrap");
  if (stale) stale.remove();

  // Wrapper
  const wrap = document.createElement("div");
  wrap.id = "vc-wrap";
  wrap.style.cssText = "max-width:840px;margin:0 auto;padding:8px;";
  regNode(wrap);
  game.appendChild(wrap);

  // Video
  const video = document.createElement("video");
  video.id = "vc-video";
  video.controls = true;               // user-controlled (avoids autoplay policies)
  video.preload = "metadata";
  video.playsInline = true;            // iOS inline
  video.setAttribute("webkit-playsinline","true");
  video.muted = false;                 // don’t trigger autoplay attempts
  video.src = scene.videoSrc || "";
  video.style.cssText = "width:100%;max-height:45vh;border-radius:12px;background:#000;display:block;margin:0 auto;";
  wrap.appendChild(video);

  // “Tap to play” overlay to guarantee a user gesture
  const overlay = document.createElement("button");
  overlay.id = "vc-overlay";
  overlay.textContent = "▶ Tap to play";
  overlay.style.cssText = `
    position:relative; display:block; width:100%;
    margin:10px auto 0; padding:10px 14px;
    border:none; border-radius:10px;
    background:#00ffff; color:#000; font-weight:700; cursor:pointer;
  `;
  wrap.appendChild(overlay);

  // Choice panel (hidden until video ends or user skips)
  const panel = document.createElement("div");
  panel.id = "vc-panel";
  panel.style.cssText = "display:none;margin-top:12px;";
  wrap.appendChild(panel);

  // Timer
  const timerDiv = document.createElement("div");
  timerDiv.id = "vc-timer";
  timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:6px 0;";
  panel.appendChild(timerDiv);

  // Options
  const opts = document.createElement("div");
  opts.id = "vc-choices";
  opts.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
  panel.appendChild(opts);

  // Feedback
  const fb = document.createElement("div");
  fb.id = "vc-feedback";
  fb.style.cssText = "margin-top:10px;font-weight:700;";
  panel.appendChild(fb);

  // Build choices
  (scene.choices || []).forEach(choice => {
    const btn = document.createElement("button");
    btn.textContent = choice.text || "";
    btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    btn.onmouseenter = () => (btn.style.background = "#00cccc");
    btn.onmouseleave = () => (btn.style.background = "#00ffff");
    regListener(btn, "click", () => {
      clearTimer();
      fb.textContent = "→";
      fb.style.color = "#aaa";
      loadScene(choice.next);
    });
    opts.appendChild(btn);
  });

  // Timer logic (starts AFTER video ends or when user skips)
  const DEFAULT_SECONDS = 15;
  let timeLeft = 0;
  let iv = null;

  function clearTimer() {
    if (iv) { clearInterval(iv); iv = null; }
  }
  function startTimer() {
    const sec = (scene.timer === true)
      ? DEFAULT_SECONDS
      : (Number.isFinite(scene.timer) ? Number(scene.timer) : DEFAULT_SECONDS);
    timeLeft = sec;
    timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
    iv = setInterval(() => {
      timeLeft -= 1;
      timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`;
      if (timeLeft <= 0) {
        clearTimer();
        fb.textContent = "⏲️ Time's up. Returning...";
        fb.style.color = "orange";
        const to = scene.timeoutNext || scene.next || null;
        setTimeout(() => { if (to) loadScene(to); }, 800);
      }
    }, 1000);
  }

  function revealPanelAndStartTimer() {
    panel.style.display = "block";
    startTimer();
  }

  // Play flow — only on explicit tap
  regListener(overlay, "click", async () => {
    overlay.disabled = true;
    try {
      await video.play();            // user gesture → should be allowed
      overlay.remove();              // playing OK
    } catch (err) {
      // If play still fails, show graceful fallback: show choices + timer immediately
      console.warn("[video-choice] play() rejected:", err);
      overlay.textContent = "▶ Open video in a new tab";
      overlay.disabled = false;
      overlay.onclick = () => window.open(video.src, "_blank");

      // Also add a Skip button
      const skip = document.createElement("button");
      skip.textContent = "Skip video";
      skip.style.cssText = "margin-left:8px;padding:10px 14px;border:none;border-radius:10px;background:#222;color:#eee;font-weight:700;cursor:pointer";
      overlay.parentNode.insertBefore(skip, overlay.nextSibling);
      skip.onclick = () => {
        overlay.remove();
        skip.remove();
        revealPanelAndStartTimer();
      };
    }
  });

  // When the video ends → reveal panel and start timer
  regListener(video, "ended", () => {
    revealPanelAndStartTimer();
  });

  // Cleanup on leave
  regCleanup(() => {
    clearTimer();
    const w = document.getElementById("vc-wrap");
    if (w) w.remove();
  });
}





// === Hangman loader (updated: no seepage, defensive keyboard cleanup) ===
function loadHangmanScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Pre-clean any previous hangman instance + key handler
  const stale = document.getElementById('hangman');
  if (stale) stale.remove();
  if (window.__hmKeyHandler) {
    document.removeEventListener('keydown', window.__hmKeyHandler);
    window.__hmKeyHandler = null;
  }

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  const oldVideo = document.getElementById("scene-video");
  if (oldVideo) { oldVideo.pause(); oldVideo.src = ""; oldVideo.load(); oldVideo.remove(); }
  let audioElem = document.getElementById("scene-audio");
  if (audioElem) { audioElem.pause(); audioElem.src = ""; audioElem.load(); audioElem.remove(); }

  // Config
  const rawTarget = scene.target || "";
  const target = rawTarget.toUpperCase();
  const alphabet = (scene.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZ").split("");
  const maxWrong = Number.isFinite(scene.maxWrong) ? scene.maxWrong : 6;

  // State
  const guessed = new Set();
  let wrong = 0;
  let solved = false;

  // Build UI
  const wrap = document.createElement("div");
  wrap.id = "hangman";
  wrap.style.maxWidth = "720px";
  wrap.style.margin = "0 auto";
  wrap.style.padding = "12px 8px";
  wrap.style.textAlign = "center";
  wrap.style.color = "var(--text-default)"; // strong dark text on white


  wrap.innerHTML = `
    <div id="hm-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="hm-lives" style="font-weight:bold;">❤️ Lives: <span id="hm-lives-num">${maxWrong - wrong}</span></div>
      ${scene.hint ? `<div id="hm-hint" style="opacity:.85;">💡 ${scene.hint}</div>` : `<div></div>`}
    </div>

    <div id="hm-word"
         style="margin:18px 0;font:700 28px/1.4 system-ui,Segoe UI,Arial,Helvetica,Apple Color Emoji,Segoe UI Emoji;letter-spacing:.08em;"></div>

    <div id="hm-letters" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;"></div>

    <div id="hm-feedback" style="margin-top:14px;font-weight:700;"></div>
    <div id="hm-ctrl" style="margin-top:12px;"></div>
  `;

  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  } else if (gameContainer) {
    gameContainer.appendChild(wrap);
  }

  const livesNum = wrap.querySelector("#hm-lives-num");
  const wordEl = wrap.querySelector("#hm-word");
  const lettersEl = wrap.querySelector("#hm-letters");
  const feedbackEl = wrap.querySelector("#hm-feedback");
  const ctrlEl = wrap.querySelector("#hm-ctrl");

  // Helpers
  function isLetter(ch) { return /[A-Z]/.test(ch); }
  function displayWord() {
    const out = [];
    for (const ch of target) out.push(isLetter(ch) ? (guessed.has(ch) ? ch : "_") : ch);
    wordEl.textContent = out.join(" ");
  }
  function allRevealed() {
    for (const ch of target) if (isLetter(ch) && !guessed.has(ch)) return false;
    return true;
  }
  function disableAll() { lettersEl.querySelectorAll("button").forEach(b => b.disabled = true); }

  function finishWin() {
    solved = true;
    feedbackEl.textContent = "✅ Correct! You solved it.";
    feedbackEl.style.color = "lightgreen";
    disableAll();

    if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

    if (scene.next) {
      setTimeout(() => loadScene(scene.next), 900);
    } else {
      ctrlEl.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = "Continue";
      btn.onclick = () => loadScene("scene1");
      ctrlEl.appendChild(btn);
    }
  }

  function finishLose() {
    feedbackEl.textContent = `❌ Out of lives. The answer was: "${rawTarget}"`;
    feedbackEl.style.color = "salmon";
    disableAll();
    ctrlEl.innerHTML = "";

    // Retry is okay to keep here
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.style.marginRight = "8px";
    retry.onclick = () => loadScene(id);
    ctrlEl.appendChild(retry);

    // 👇 Hub button ONLY if NOT suppressed
    if (!scene.suppressHub) {
      const back = document.createElement("button");
      back.textContent = "Back to Hub";
      back.onclick = () => loadScene("scene1");
      ctrlEl.appendChild(back);
    }

    // Continue to remedial if provided
    if (scene.onLoseNext) {
      const nextBtn = document.createElement("button");
      nextBtn.textContent = "Continue";
      nextBtn.style.marginLeft = "8px";
      nextBtn.onclick = () => loadScene(scene.onLoseNext);
      ctrlEl.appendChild(nextBtn);
    }
  }

  function guessLetter(letter) {
    if (guessed.has(letter) || solved) return;
    guessed.add(letter);

    const btn = lettersEl.querySelector(`button[data-letter="${letter}"]`);
    if (btn) btn.disabled = true;

    if (target.includes(letter)) {
      displayWord();
      if (allRevealed()) finishWin();
    } else {
      wrong++;
      livesNum.textContent = String(maxWrong - wrong);
      if (wrong >= maxWrong) finishLose();
    }
  }

  // Render alphabet
  alphabet.forEach(ch => {
    const b = document.createElement("button");
    b.textContent = ch;
    b.dataset.letter = ch;
    b.style.cssText = "min-width:34px;padding:8px;border-radius:8px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    b.onmouseenter = () => (b.style.background = "#00cccc");
    b.onmouseleave = () => (b.style.background = "#00ffff");
    b.onclick = () => guessLetter(ch);
    lettersEl.appendChild(b);
  });

  // Keyboard support
  if (window.__hmKeyHandler) {
    document.removeEventListener('keydown', window.__hmKeyHandler);
    window.__hmKeyHandler = null;
  }
  const keyHandler = (e) => {
    const k = (e.key || "").toUpperCase();
    if (/^[A-Z]$/.test(k)) { e.preventDefault(); guessLetter(k); }
  };
  document.addEventListener("keydown", keyHandler);
  window.__hmKeyHandler = keyHandler;

  const observer = new MutationObserver(() => {
    const alive = document.getElementById('hangman');
    if (!alive && window.__hmKeyHandler) {
      document.removeEventListener('keydown', window.__hmKeyHandler);
      window.__hmKeyHandler = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  displayWord();
}



// === Grammar Survivor (seepage-proof) ===
function loadSurvivorQuizScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Pre-clean any previous instance + timers
  if (window.__svCleanup) { try { window.__svCleanup(); } catch(_){} window.__svCleanup = null; }
  const stale = document.getElementById('survivor-quiz');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated UI; show prompt/instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config
  const qs = Array.isArray(scene.questions) ? scene.questions.slice() : [];
  const livesStart = Number.isFinite(scene.lives) ? scene.lives : 3;
  const defaultTimer = Number.isFinite(scene.timer) && scene.timer > 0 ? scene.timer : 0;

  // State
  let qIndex = 0;
  let lives = livesStart;
  let score = 0;
  let timer = 0;
  let interval = null;

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'survivor-quiz';
  wrap.style.maxWidth = '760px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '12px 8px';
  wrap.style.color = 'var(--text-default)'; // strong dark text on white


  wrap.innerHTML = `
    <div id="sv-top" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="sv-progress" style="font-weight:700;">Q 1/${qs.length}</div>
      <div id="sv-lives" style="font-weight:700;">❤️ ${'❤'.repeat(lives)}<span style="opacity:.4">${'♡'.repeat(Math.max(0, livesStart - lives))}</span></div>
      <div id="sv-timer" style="min-width:120px;text-align:right;font-weight:700;"></div>
    </div>
    <div id="sv-question" style="margin:14px 0 8px;font:600 20px/1.35 system-ui,Segoe UI,Arial,Helvetica;"></div>
    <div id="sv-options" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div id="sv-feedback" style="margin-top:12px;font-weight:700;"></div>
    <div id="sv-ctrl" style="margin-top:14px;"></div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else if (gameContainer) gameContainer.appendChild(wrap);

  const elProgress = wrap.querySelector('#sv-progress');
  const elLives    = wrap.querySelector('#sv-lives');
  const elTimer    = wrap.querySelector('#sv-timer');
  const elQ        = wrap.querySelector('#sv-question');
  const elOpts     = wrap.querySelector('#sv-options');
  const elFB       = wrap.querySelector('#sv-feedback');
  const elCtrl     = wrap.querySelector('#sv-ctrl');

  function paintLives() {
    elLives.innerHTML = `❤️ ${'❤'.repeat(lives)}<span style="opacity:.4">${'♡'.repeat(Math.max(0, livesStart - lives))}</span>`;
  }
  function stopTimer() { if (interval) { clearInterval(interval); interval = null; } elTimer.textContent = ''; }
  function startTimer(seconds) {
    stopTimer();
    if (!seconds || seconds <= 0) return;
    timer = seconds;
    elTimer.textContent = `⏳ ${timer}s`;
    interval = setInterval(() => {
      timer--;
      if (timer >= 0) elTimer.textContent = `⏳ ${timer}s`;
      if (timer <= 0) { stopTimer(); handleAnswer(-1, true); }
    }, 1000);
  }
  function disableButtons() { [...elOpts.querySelectorAll('button')].forEach(b => b.disabled = true); }

  // local cleanup used before navigating away
  function cleanup() {
    try { stopTimer(); } catch(_) {}
    const node = document.getElementById('survivor-quiz');
    if (node) node.remove();
  }
  // safe navigation: cleanup first, then go
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  function nextQuestion() { qIndex++; (qIndex >= qs.length) ? finish() : renderQuestion(); }

  function finishLose() {
    stopTimer();
    elFB.textContent = "❌ You ran out of lives.";
    elFB.style.color = "#C0392B";   // error / timeout
    elCtrl.innerHTML = "";

    if (Array.isArray(scene.setFlagsOnLose)) scene.setFlagsOnLose.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnLose)) scene.unlockScenesOnLose.forEach(unlockScene);

    // Retry
    const retry = document.createElement('button');
    retry.textContent = scene.retryLabel || "Retry";
    retry.style.marginRight = "8px";
    retry.onclick = () => goNext(id);
    elCtrl.appendChild(retry);

    // Hub only if NOT suppressed
    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }

    // Optional remedial/continue
    if (scene.onLoseNext) {
      const cont = document.createElement('button');
      cont.textContent = "Continue";
      cont.style.marginLeft = "8px";
      cont.onclick = () => goNext(scene.onLoseNext);
      elCtrl.appendChild(cont);
    }
  }

  function finish() {
    stopTimer();

    // Endings map (score-based) first
    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      let dest;
      if (score >= high) dest = scene.endings.high;
      else if (score >= medium) dest = scene.endings.medium;
      else dest = scene.endings.low;
      if (dest) return goNext(dest);
    }

    if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

    if (scene.next) return goNext(scene.next);

    // Neutral summary; only show Hub if not suppressed
    elFB.textContent = `🏁 Done! Score: ${score}/${qs.length}`;
    elFB.style.color = "var(--brand-blue)"; // summary
    elCtrl.innerHTML = "";

    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }
  }

  function handleAnswer(choiceIndex, timedOut = false) {
    stopTimer();
    disableButtons();
    const q = qs[qIndex];
    const correct = (choiceIndex === q.correct);

    if (correct) {
      score++;
      elFB.textContent = "✅ Correct!";
      elFB.style.color = "#1E7F3B";   // correct
    } else {
      lives--;
      paintLives();
      elFB.textContent = timedOut ? "⌛ Time’s up!" : "❌ Not quite.";
      elFB.style.color = "#C0392B";   // error / timeout
      if (q.explain) {
        const exp = document.createElement('div');
        exp.style.marginTop = "6px";
        exp.style.opacity = ".85";
        exp.textContent = `Hint: ${q.explain}`;
        elFB.appendChild(exp);
      }
    }

    if (lives <= 0) setTimeout(finishLose, 700);
    else setTimeout(nextQuestion, 800);
  }

  function renderQuestion() {
    elCtrl.innerHTML = "";
    elFB.textContent = "";
    const q = qs[qIndex];

    elProgress.textContent = `Q ${qIndex + 1}/${qs.length}`;
    elQ.textContent = q.text || "";

    elOpts.innerHTML = "";
    (q.options || []).forEach((opt, i) => {
      const b = document.createElement('button');
      b.textContent = opt;
      b.style.cssText = [
  "text-align:left",
  "padding:12px 14px",
  "border-radius:12px",
  "border:2px solid var(--brand-blue)",
  "background:#fff",
  "color:var(--brand-blue)",
  "font-weight:800",                 // bolder blue
  "cursor:pointer",
  "box-shadow:0 2px 8px rgba(0,0,0,0.06)",
  "filter:none"
].join(";");

b.onmouseenter = () => { b.style.background = "var(--brand-blue)"; b.style.color = "#fff"; };
b.onmouseleave = () => { b.style.background = "#fff";            b.style.color = "var(--brand-blue)"; };

      b.onclick = () => handleAnswer(i, false);
      elOpts.appendChild(b);
    });

    const perQ = Number.isFinite(q.timer) && q.timer > 0 ? q.timer : defaultTimer;
    startTimer(perQ);
  }

  // Global cleanup hook
  window.__svCleanup = function () { cleanup(); };

  // Auto-clean timers if wrapper disappears
  const mo = new MutationObserver(() => {
    const alive = document.getElementById('survivor-quiz');
    if (!alive) { stopTimer(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Kick off
  paintLives();
  renderQuestion();
  function finish() {
  stopTimer();

  // Endings map (score-based) first
  if (scene.scoring && scene.endings) {
    const { high = Infinity, medium = -Infinity } = scene.scoring;
    let dest;
    if (score >= high) dest = scene.endings.high;
    else if (score >= medium) dest = scene.endings.medium;
    else dest = scene.endings.low;
    if (dest) return goNext(dest);
  }

  if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
  if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

  // If a next is defined, go there
  if (scene.next) return goNext(scene.next);

  // Otherwise show a summary + buttons that make sense for gating
  elFB.textContent = `🏁 Done! Score: ${score}/${qs.length}`;
  elFB.style.color = "var(--brand-blue)"; // summary
  elCtrl.innerHTML = "";

  // Always offer Retry in the no-route case
  const retry = document.createElement('button');
  retry.textContent = scene.retryLabel || "Retry";
  retry.style.marginRight = "8px";
  retry.onclick = () => goNext(id);
  elCtrl.appendChild(retry);

  // Only show Hub if NOT suppressed
  if (!scene.suppressHub) {
    const back = document.createElement('button');
    back.textContent = "Back to Hub";
    back.onclick = () => goNext("scene1");
    elCtrl.appendChild(back);
  }
}

}


// === Conjugation Race (timed typing drill; seepage-proof) ===
function loadConjugationRaceScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Pre-clean any previous instance
  if (window.__crCleanup) { try { window.__crCleanup(); } catch(_){} window.__crCleanup = null; }
  const stale = document.getElementById('conj-race');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config
  const items = Array.isArray(scene.questions) ? scene.questions.slice() : [];
  const shuffle = !!scene.shuffle;
  const timerOverall = Number.isFinite(scene.timerOverall) ? scene.timerOverall : null;
  const timerPer = Number.isFinite(scene.timerPer) ? scene.timerPer : null;
  const showAnswerOnWrong = scene.showAnswerOnWrong !== false;
  const acceptPunctuationVariants = scene.acceptPunctuationVariants !== false;
  const caseInsensitive = scene.caseInsensitive !== false;

  if (shuffle) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  // State
  let qIndex = 0;
  let score = 0;
  let tRemaining = timerOverall || 0;
  let tItem = timerPer || 0;
  let intervalOverall = null;
  let intervalPer = null;

  // Build UI
  const wrap = document.createElement('div');
  wrap.id = 'conj-race';
  wrap.style.maxWidth = '760px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '12px 8px';
  wrap.style.color = 'var(--text-default)'; // strong dark text on white


  wrap.innerHTML = `
    <div id="cr-top" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="cr-progress" style="font-weight:700;">Q 1/${items.length}</div>
      <div id="cr-score" style="font-weight:700;">Score: 0</div>
      <div id="cr-timer" style="min-width:140px;text-align:right;font-weight:700;"></div>
    </div>

    <div id="cr-prompt" style="margin:16px 0 8px;font:600 20px/1.35 system-ui,Segoe UI,Arial,Helvetica;"></div>

    <div id="cr-inputrow" style="display:flex;gap:8px;align-items:center;">
      <input id="cr-input" type="text" autocomplete="off"
             style="flex:1;min-width:140px;padding:10px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700"/>
      <button id="cr-submit" style="padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer">Submit</button>
    </div>

    <div id="cr-feedback" style="margin-top:10px;font-weight:700;"></div>
    <div id="cr-ctrl" style="margin-top:14px;"></div>
  `;

  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  } else if (gameContainer) {
    gameContainer.appendChild(wrap);
  }

  const elProgress = wrap.querySelector('#cr-progress');
  const elScore    = wrap.querySelector('#cr-score');
  const elTimer    = wrap.querySelector('#cr-timer');
  const elPrompt   = wrap.querySelector('#cr-prompt');
  const elInput    = wrap.querySelector('#cr-input');
  const elSubmit   = wrap.querySelector('#cr-submit');
  const elFB       = wrap.querySelector('#cr-feedback');
  const elCtrl     = wrap.querySelector('#cr-ctrl');

  // Helpers
  const norm = (s) => {
    if (s == null) return '';
    let x = String(s).trim();
    if (caseInsensitive) x = x.toLowerCase();
    if (acceptPunctuationVariants) {
      x = x
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/\u00A0/g, ' ');
    }
    return x;
  };

  function stopOverallTimer() { if (intervalOverall) { clearInterval(intervalOverall); intervalOverall = null; } }
  function stopPerTimer() { if (intervalPer) { clearInterval(intervalPer); intervalPer = null; } }

  function startOverallTimer(seconds) {
    stopOverallTimer();
    if (!seconds || seconds <= 0) return;
    tRemaining = seconds;
    elTimer.textContent = `⏳ ${tRemaining}s total`;
    intervalOverall = setInterval(() => {
      tRemaining--;
      if (tRemaining >= 0) elTimer.textContent = `⏳ ${tRemaining}s total`;
      if (tRemaining <= 0) { stopPerTimer(); stopOverallTimer(); finish(); }
    }, 1000);
  }

  function startPerTimer(seconds) {
    stopPerTimer();
    if (!seconds || seconds <= 0) { elTimer.textContent = ''; return; }
    tItem = seconds;
    elTimer.textContent = `⏳ ${tItem}s`;
    intervalPer = setInterval(() => {
      tItem--;
      if (tItem >= 0) elTimer.textContent = `⏳ ${tItem}s`;
      if (tItem <= 0) { stopPerTimer(); checkAnswer('', true); }
    }, 1000);
  }

  function paintScore() { elScore.textContent = `Score: ${score}`; }
  function paintProgress() { elProgress.textContent = `Q ${Math.min(qIndex+1, items.length)}/${items.length}`; }

  function setPrompt(q) {
    elPrompt.textContent = q.prompt || '';
    if (q.hint) {
  elFB.textContent = `💡 ${q.hint}`;
  elFB.style.color = "var(--brand-blue-700)";   // darker brand blue
  elFB.style.fontWeight = "800";                // heavier
  elFB.style.fontSize = "0.95rem";              // slightly larger
} else {
  elFB.textContent = "";
  elFB.style.color = "";
  elFB.style.fontWeight = "";
  elFB.style.fontSize = "";
}

  }

  function disableInput() { elInput.disabled = true; elSubmit.disabled = true; }
  function enableInput() { elInput.disabled = false; elSubmit.disabled = false; }

  function finish() {
    stopPerTimer(); stopOverallTimer();
    disableInput();

    const summary = `🏁 Done! Score: ${score}/${items.length}`;
    elFB.textContent = summary;
    elFB.style.color = "var(--brand-blue)"; // summary
    elCtrl.innerHTML = "";

    // Branching endings support
    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      let dest;
      if (score >= high) dest = scene.endings.high;
      else if (score >= medium) dest = scene.endings.medium;
      else dest = scene.endings.low;
      if (dest) {
        const btn = document.createElement('button');
        btn.textContent = "Continue";
        btn.onclick = () => goNext(dest);
        elCtrl.appendChild(btn);
        return;
      }
    }

    // Respect scene.next if provided
    if (scene.next) {
      const btn = document.createElement('button');
      btn.textContent = "Continue";
      btn.onclick = () => goNext(scene.next);
      elCtrl.appendChild(btn);
      return;
    }

    // Final fallback — only show Hub if not suppressed
    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }
  }

  function checkAnswer(userRaw, timedOut=false) {
    stopPerTimer();
    const q = items[qIndex] || {};
    const answers = Array.isArray(q.answers) ? q.answers : (q.answer ? [q.answer] : []);
    const user = norm(userRaw);
    const ok = answers.some(a => norm(a) === user);

    if (ok && !timedOut) {
      score++; paintScore();
      elFB.textContent = "✅ Correct!"; elFB.style.color = "#1E7F3B";   // correct
      setTimeout(() => { qIndex++; (qIndex >= items.length) ? finish() : renderQuestion(); }, 600);
    } else {
      elFB.textContent = timedOut ? "⌛ Time’s up." : "❌ Not quite.";
      elFB.style.color = "#C0392B";   // error / timeout
      if (showAnswerOnWrong && answers.length) {
        const ans = document.createElement('div');
        ans.style.marginTop = "6px"; ans.style.opacity = ".9";
        ans.textContent = `Answer: ${answers[0]}`;
        elFB.appendChild(ans);
      }
      setTimeout(() => { qIndex++; (qIndex >= items.length) ? finish() : renderQuestion(); }, 900);
    }
  }

  function renderQuestion() {
    paintProgress();
    enableInput();
    elInput.value = ""; elInput.focus();
    const q = items[qIndex];
    setPrompt(q);
    if (timerPer) startPerTimer(timerPer);
    else if (timerOverall) elTimer.textContent = `⏳ ${tRemaining}s total`;
    else elTimer.textContent = "";
  }

  elSubmit.onclick = () => checkAnswer(elInput.value, false);
  elInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); checkAnswer(elInput.value, false); }
  });

  function cleanup() {
    try { stopPerTimer(); } catch(_) {}
    try { stopOverallTimer(); } catch(_) {}
    const node = document.getElementById('conj-race');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  window.__crCleanup = function () { cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('conj-race');
    if (!alive) { stopPerTimer(); stopOverallTimer(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  if (timerOverall) startOverallTimer(timerOverall);
  renderQuestion();
  function finish() {
  stopPerTimer(); 
  stopOverallTimer();
  disableInput();

  const summary = `🏁 Done! Score: ${score}/${items.length}`;
  elFB.textContent = summary;
  elFB.style.color = "var(--brand-blue)"; // summary
  elCtrl.innerHTML = "";

  // If using scoring + endings
  if (scene.scoring && scene.endings) {
    const { high = Infinity, medium = -Infinity } = scene.scoring;
    let dest;
    if (score >= high) {
      dest = scene.endings.high;
    } else if (score >= medium) {
      dest = scene.endings.medium;
    } else {
      // FAILED branch → offer Retry
      const retry = document.createElement('button');
      retry.textContent = "Retry";
      retry.style.marginRight = "8px";
      retry.onclick = () => goNext(id);
      elCtrl.appendChild(retry);

      if (!scene.suppressHub) {
        const hub = document.createElement('button');
        hub.textContent = "Back to Hub";
        hub.onclick = () => goNext("scene1");
        elCtrl.appendChild(hub);
      }
      return; // stop here
    }
    if (dest) return goNext(dest);
  }

  // Respect scene.next if provided
  if (scene.next) {
    const btn = document.createElement('button');
    btn.textContent = "Continue";
    btn.onclick = () => goNext(scene.next);
    elCtrl.appendChild(btn);
    return;
  }

  // Neutral fallback
  if (!scene.suppressHub) {
    const back = document.createElement('button');
    back.textContent = "Back to Hub";
    back.onclick = () => goNext("scene1");
    elCtrl.appendChild(back);
  }
}

}


// === Image Hotspots → drag tokens onto pins (seepage-proof) ===
function loadHotspotsScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__hsCleanup) { try { window.__hsCleanup(); } catch(_){} window.__hsCleanup = null; }
  const stale = document.getElementById('hotspots');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config shape:
  // image: 'images/…'
  // pins: [{ id:'p1', x:25, y:60, answers:['look up'] }, ...]  // x/y = % (relative to image box)
  // tokens: ['look up','pick up','put down','get over']
  // next: 'scene1' (optional)
  const pins = Array.isArray(scene.pins) ? scene.pins : [];
  const tokens = Array.isArray(scene.tokens) ? scene.tokens.slice() : [];
  const bankTitle = scene.bankTitle || 'Choices';

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'hotspots';
  wrap.style.maxWidth = '980px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="hs-grid" style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;">
      <div id="hs-stage" style="position:relative;border-radius:12px;overflow:hidden;background:#000;">
        <img id="hs-img" src="${scene.image}" alt="scene" style="display:block;width:100%;height:auto;"/>
        <div id="hs-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
      </div>
      <div id="hs-side">
        <div style="font-weight:700;margin-bottom:8px;">${bankTitle}</div>
        <div id="hs-bank" style="display:flex;flex-wrap:wrap;gap:8px;min-height:48px;"></div>
        <div id="hs-feedback" style="margin-top:12px;font-weight:700;"></div>
        <div id="hs-ctrl" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;"></div>
      </div>
    </div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const layer = wrap.querySelector('#hs-layer');
  const bank  = wrap.querySelector('#hs-bank');
  const fb    = wrap.querySelector('#hs-feedback');
  const ctrl  = wrap.querySelector('#hs-ctrl');

  // Build token chips in bank
  tokens.forEach(val => {
    const chip = document.createElement('div');
    chip.className = 'hs-chip';
    chip.textContent = val;
    chip.dataset.value = val;
    chip.style.cssText = "pointer-events:auto;user-select:none;padding:8px 10px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:grab";
    bank.appendChild(chip);
  });

  // Make bank sortable (source list)
  const bankSortable = Sortable.create(bank, {
    group: { name: 'hs', pull: 'clone', put: true },
    animation: 150,
    sort: false
  });

  // Build pins (droppable 1-item targets)
  const dropSortables = {};
  pins.forEach(pin => {
    const pinWrap = document.createElement('div');
    pinWrap.className = 'hs-pin';
    pinWrap.style.cssText = `
      position:absolute;left:${pin.x}%;top:${pin.y}%;
      transform:translate(-50%,-50%);
      width:48px;height:48px;border-radius:50%;
      background:radial-gradient(circle at 30% 30%, #5ff, #09a);
      box-shadow:0 0 0 3px rgba(0,255,255,.3), 0 0 12px rgba(0,255,255,.6);
      display:flex;align-items:center;justify-content:center;
      pointer-events:auto;`;
    pinWrap.title = pin.label || '';

    const slot = document.createElement('div');
    slot.id = `hs-slot-${pin.id}`;
    slot.dataset.pin = pin.id;
    slot.style.cssText = `
      width:36px;min-height:24px;max-width:80px;
      pointer-events:auto;background:#000d;border:2px dashed #bdf;
      border-radius:8px;padding:2px;display:flex;align-items:center;justify-content:center;`;
    pinWrap.appendChild(slot);

    // label below (optional)
    if (pin.caption) {
      const cap = document.createElement('div');
      cap.textContent = pin.caption;
      cap.style.cssText = "position:absolute;top:54px;left:50%;transform:translateX(-50%);font:600 12px/1.2 system-ui;white-space:nowrap;background:#000a;padding:2px 6px;border-radius:6px;border:1px solid #00bcd4";
      pinWrap.appendChild(cap);
    }

    layer.appendChild(pinWrap);

    dropSortables[pin.id] = Sortable.create(slot, {
      group: { name: 'hs', pull: true, put: true },
      animation: 150,
      sort: false,
      onAdd: (evt) => {
        const to = evt.to;
        // keep only one chip in the slot
        while (to.children.length > 1) {
          bank.appendChild(to.children[0]);
        }
      },
      onRemove: () => {}
    });
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#333;color:#eee;cursor:pointer;font-weight:700";
  resetBtn.onclick = () => {
    // move all chips back to bank
    const chips = layer.querySelectorAll('.hs-chip');
    chips.forEach(ch => bank.appendChild(ch));
    fb.textContent = "";
  };
  ctrl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Check";
  checkBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;cursor:pointer;font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    let ok = true;
    let filled = true;
    pins.forEach(pin => {
      const slot = document.getElementById(`hs-slot-${pin.id}`);
      const chip = slot && slot.firstElementChild;
      if (!chip) { filled = false; ok = false; return; }
      const val = (chip.dataset.value || "").trim();
      const answers = Array.isArray(pin.answers) ? pin.answers : [pin.answer].filter(Boolean);
      const match = answers.some(a => (a || "").trim().toLowerCase() === val.toLowerCase());
      if (!match) ok = false;
    });

    if (!filled) {
      fb.textContent = "⚠️ Place a token on every pin.";
      fb.style.color = "orange";
      return;
    }
    if (ok) {
      fb.textContent = "✅ Correct! Moving on...";
      fb.style.color = "lightgreen";

      // optional rewards
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

      setTimeout(() => {
        if (scene.next) goNext(scene.next);
      }, 900);
    } else {
      fb.textContent = "❌ Not quite. Try again.";
      fb.style.color = "salmon";
    }
  };
  ctrl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#222;color:#eee;cursor:pointer;font-weight:700";
  backBtn.onclick = () => goNext("scene1");
  ctrl.appendChild(backBtn);

  // Cleanup helpers
  function cleanup() {
    const node = document.getElementById('hotspots');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  // Expose global cleanup for Universal Cleanup
  window.__hsCleanup = function(){ cleanup(); };

  // Auto-stop if wrapper disappears
  const mo = new MutationObserver(() => {
    const alive = document.getElementById('hotspots');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Buckets / Kanban Sort (seepage-proof) ===
// === Buckets (pink-magenta theme; readable on white) ===
function loadBucketsScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill previous instance if any
  if (window.__bkCleanup) { try { window.__bkCleanup(); } catch(_){} window.__bkCleanup = null; }
  const stale = document.getElementById('buckets');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Scene shape:
  // buckets: [{ id:'separable', label:'Separable' }, ...]
  // tokens:  ['take off','turn on', ...]
  // answers: { separable:[...], inseparable:[...] }
  const buckets = Array.isArray(scene.buckets) ? scene.buckets : [];
  const tokens  = Array.isArray(scene.tokens) ? scene.tokens.slice() : [];
  const answers = scene.answers || {};
  const allowExtraInBank   = scene.allowExtraInBank !== false; // default true: distractors can stay in bank
  const showAnswerOnWrong  = scene.showAnswerOnWrong !== false; // default true

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'buckets';
  wrap.style.maxWidth = '1100px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = 'var(--text-default)';

  // grid: bank on top, buckets below
  wrap.innerHTML = `
    <div id="bk-bank-wrap" style="margin-bottom:14px;">
      <div style="font-weight:800;margin-bottom:8px;color:var(--accent-pink-700);">Tokens</div>
      <div id="bk-bank" style="
        display:flex;flex-wrap:wrap;gap:8px;min-height:54px;
        border:2px dashed var(--accent-pink);
        background: var(--accent-pink-50);
        border-radius:12px;padding:10px;"></div>
    </div>

    <div id="bk-buckets" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:start;"></div>

    <div id="bk-feedback" style="margin-top:14px;font-weight:700;"></div>
    <div id="bk-ctrl" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;"></div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const bank  = wrap.querySelector('#bk-bank');
  const panel = wrap.querySelector('#bk-buckets');
  const fb    = wrap.querySelector('#bk-feedback');
  const ctrl  = wrap.querySelector('#bk-ctrl');

  // Build chips (pink outline, fill on hover)
  tokens.forEach(txt => {
    const chip = document.createElement('div');
    chip.className = 'bk-chip';
    chip.dataset.value = txt;
    chip.textContent = txt;
    chip.style.cssText = [
      "pointer-events:auto","user-select:none",
      "padding:8px 10px","border-radius:10px",
      "border:2px solid var(--accent-pink)",
      "background:#fff","color:var(--accent-pink)",
      "font-weight:800","cursor:grab",
      "box-shadow:0 2px 8px rgba(0,0,0,0.06)"
    ].join(";");
    chip.onmouseenter = () => { chip.style.background = "var(--accent-pink)"; chip.style.color = "#fff"; };
    chip.onmouseleave = () => { chip.style.background = "#fff";               chip.style.color = "var(--accent-pink)"; };
    bank.appendChild(chip);
  });

  // Bank Sortable
  const bankSortable = Sortable.create(bank, {
    group: { name: 'classify', pull: true, put: true },
    animation: 150,
    sort: false
  });

  // Buckets UIs + Sortables
  const bucketSortables = {};
  buckets.forEach(b => {
    const col = document.createElement('div');
    col.className = 'bk-col';
    col.style.cssText = "background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px;min-height:140px;box-shadow:var(--shadow);";

    col.innerHTML = `
      <div class="bk-title" style="font-weight:800;margin-bottom:8px;color:var(--accent-pink-700)">${b.label || b.id}</div>
      <div class="bk-drop" id="bk-drop-${b.id}" data-bucket="${b.id}"
           style="display:flex;flex-wrap:wrap;gap:8px;min-height:54px;
                  background: var(--accent-pink-50); border:2px dashed var(--accent-pink); border-radius:10px; padding:8px;"></div>
      <div class="bk-hint" style="opacity:1;margin-top:6px;font-size:.95rem;color:var(--text-default);"></div>
    `;
    if (b.hint) col.querySelector('.bk-hint').textContent = b.hint;
    panel.appendChild(col);

    const drop = col.querySelector(`#bk-drop-${b.id}`);
    bucketSortables[b.id] = Sortable.create(drop, {
      group: { name: 'classify', pull: true, put: true },
      animation: 150,
      sort: false
    });
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = [
    "padding:10px 14px","border-radius:12px",
    "border:2px solid var(--border)","background:#fff",
    "color:var(--text-default)","cursor:pointer","font-weight:700",
    "box-shadow:0 2px 8px rgba(0,0,0,0.06)"
  ].join(";");
  resetBtn.onclick = () => {
    // send all chips back to bank
    wrap.querySelectorAll('.bk-drop .bk-chip').forEach(ch => bank.appendChild(ch));
    fb.textContent = "";
    // clear highlights
    wrap.querySelectorAll('.bk-chip').forEach(ch => ch.style.borderColor = 'var(--accent-pink)');
    // clear per-bucket hints
    wrap.querySelectorAll('.bk-col .bk-hint').forEach(h => { h.textContent = ""; h.style.color = "var(--text-default)"; h.style.fontWeight = "700"; });
  };
  ctrl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Check";
  checkBtn.style.cssText = [
    "padding:10px 14px","border-radius:12px",
    "border:2px solid var(--accent-pink)","background:#fff",
    "color:var(--accent-pink)","cursor:pointer","font-weight:800",
    "box-shadow:0 2px 8px rgba(0,0,0,0.06)"
  ].join(";");
  checkBtn.onmouseenter = () => { checkBtn.style.backgroundColor = "var(--accent-pink)"; checkBtn.style.color = "#fff"; };
  checkBtn.onmouseleave = () => { checkBtn.style.backgroundColor = "#fff";               checkBtn.style.color = "var(--accent-pink)"; };
  ctrl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = [
    "padding:10px 14px","border-radius:12px",
    "border:2px solid var(--border)","background:#fff",
    "color:var(--text-default)","cursor:pointer","font-weight:700",
    "box-shadow:0 2px 8px rgba(0,0,0,0.06)"
  ].join(";");
  backBtn.onclick = () => goNext("scene1");
  ctrl.appendChild(backBtn);

  checkBtn.onclick = () => {
    // Clear previous highlights
    wrap.querySelectorAll('.bk-chip').forEach(ch => ch.style.borderColor = 'var(--accent-pink)');
    wrap.querySelectorAll('.bk-col .bk-hint').forEach(h => { h.textContent = ""; h.style.color = "var(--text-default)"; h.style.fontWeight = "700"; });

    // build placed map
    const placed = {};
    buckets.forEach(b => {
      const drop = document.getElementById(`bk-drop-${b.id}`);
      placed[b.id] = Array.from(drop.querySelectorAll('.bk-chip')).map(c => c.dataset.value);
    });

    // If not allowing extra in bank, require that every token left the bank
    if (!allowExtraInBank) {
      const leftovers = Array.from(bank.querySelectorAll('.bk-chip')).length;
      if (leftovers > 0) {
        fb.textContent = "⚠️ Sort all tokens into a bucket.";
        fb.style.color = "#B36B00"; // darker amber
        return;
      }
    }

    // Validate: each bucket should contain exactly the expected items (order irrelevant)
    let allOk = true;
    buckets.forEach(b => {
      const want = new Set((answers[b.id] || []).map(s => s.toLowerCase()));
      const got  = placed[b.id].map(s => s.toLowerCase());

      // Wrong if: any missing target OR any extra not in want
      let ok = true;
      want.forEach(w => { if (!got.includes(w)) ok = false; });
      got.forEach(g => { if (!want.has(g)) ok = false; });

      if (!ok) {
        allOk = false;
        // highlight wrong chips in this bucket
        const drop = document.getElementById(`bk-drop-${b.id}`);
        Array.from(drop.querySelectorAll('.bk-chip')).forEach(ch => {
          const val = (ch.dataset.value || "").toLowerCase();
          if (!want.has(val)) ch.style.borderColor = '#C0392B'; // accessible red for wrong
        });
        if (showAnswerOnWrong && want.size) {
          const hintEl = drop.parentElement.querySelector('.bk-hint');
          hintEl.textContent = `Expected: ${Array.from(want).join(', ')}`;
          hintEl.style.color = "var(--accent-pink-700)";
          hintEl.style.fontWeight = "800";
        }
      }
    });

    if (allOk) {
      fb.textContent = "✅ Correct! Moving on...";
      fb.style.color = "#1E7F3B"; // accessible green
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fb.textContent = "❌ Some items are misplaced. Adjust and try again.";
      fb.style.color = "#C0392B"; // accessible red
    }
  };

  // cleanup + navigation
  function cleanup() {
    const node = document.getElementById('buckets');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  window.__bkCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('buckets');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

function loadParticleSwapperScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__psCleanup) { try { window.__psCleanup(); } catch(_){} window.__psCleanup = null; }
  const stale = document.getElementById('particle-swapper');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // shape
  const mode = (scene.mode === 'particle') ? 'particle' : 'full';
  const template = scene.template || 'Please {{CHOICE}} the object.';
  const options = Array.isArray(scene.options) ? scene.options : [];
  const correctIndex = Number.isInteger(scene.correct) ? scene.correct : 0;
  const previews = scene.previews || {};
  const verb = scene.verb || ''; // only for particle mode helper text

  // Build UI
  const wrap = document.createElement('div');
  wrap.id = 'particle-swapper';
  wrap.style.maxWidth = '840px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="ps-sentence" style="font:700 26px/1.5 system-ui,Segoe UI,Arial;letter-spacing:.02em;margin-bottom:12px;"></div>
    <div id="ps-note" style="opacity:.9;margin-bottom:12px;"></div>
    <div id="ps-options" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;"></div>
    <div id="ps-feedback" style="font-weight:700;margin-top:4px;"></div>
    <div id="ps-ctrl" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;"></div>
  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const sentenceEl = wrap.querySelector('#ps-sentence');
  const noteEl = wrap.querySelector('#ps-note');
  const optsEl = wrap.querySelector('#ps-options');
  const fbEl = wrap.querySelector('#ps-feedback');
  const ctrlEl = wrap.querySelector('#ps-ctrl');

  let selectedIndex = null;

  function renderSentence() {
    let s = template;
    if (mode === 'particle') {
      const particle = (selectedIndex != null) ? options[selectedIndex] : '___';
      s = s.replace('{{PARTICLE}}', particle);
      // If the template did not include PARTICLE, fall back to a reasonable preview
      if (s === template) {
        s = `Please ${verb ? (verb + ' ') : ''}${particle} the object.`;
      }
    } else {
      const choice = (selectedIndex != null) ? options[selectedIndex] : '_____';
      s = s.replace('{{CHOICE}}', choice);
      if (s === template) {
        s = `Please ${choice} the object.`;
      }
    }
    sentenceEl.textContent = s;
  }

  function renderNote() {
    if (selectedIndex == null) { noteEl.textContent = ''; return; }
    const val = options[selectedIndex];
    // Build key for previews
    let key = val;
    if (mode === 'particle' && verb) key = `${verb} ${val}`;
    const note = previews[key] || previews[val] || '';
    noteEl.textContent = note;
  }

  // Build option buttons
  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'ps-opt';
    btn.textContent = opt;
    btn.dataset.index = i;
    btn.style.cssText = "padding:8px 12px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:pointer";
    btn.onmouseenter = () => (btn.style.background = "#001a1a");
    btn.onmouseleave = () => (btn.style.background = "#000");
    btn.onclick = () => {
      // clear selection
      optsEl.querySelectorAll('.ps-opt').forEach(b => { b.style.borderColor = '#00ffff'; b.style.opacity = '1'; });
      selectedIndex = i;
      btn.style.borderColor = '#9effa0';
      renderSentence();
      renderNote();
      fbEl.textContent = '';
    };
    optsEl.appendChild(btn);
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#333;color:#eee;cursor:pointer;font-weight:700";
  resetBtn.onclick = () => {
    selectedIndex = null;
    optsEl.querySelectorAll('.ps-opt').forEach(b => { b.style.borderColor = '#00ffff'; b.style.opacity = '1'; });
    fbEl.textContent = '';
    noteEl.textContent = '';
    renderSentence();
  };
  ctrlEl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Submit";
  checkBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;cursor:pointer;font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    if (selectedIndex == null) {
      fbEl.textContent = '⚠️ Select an option first.';
      fbEl.style.color = 'orange';
      return;
    }
    const correct = (selectedIndex === correctIndex);
    if (correct) {
      fbEl.textContent = '✅ Correct! Moving on...';
      fbEl.style.color = 'lightgreen';
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fbEl.textContent = '❌ Not quite. Try another particle.';
      fbEl.style.color = 'salmon';
      // nudge UI
      optsEl.querySelectorAll('.ps-opt').forEach((b, idx) => {
        if (idx === selectedIndex) b.style.borderColor = 'salmon';
      });
    }
  };
  ctrlEl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#222;color:#eee;cursor:pointer;font-weight:700";
  backBtn.onclick = () => goNext('scene1');
  ctrlEl.appendChild(backBtn);

  function cleanup() {
    const node = document.getElementById('particle-swapper');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }
  window.__psCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('particle-swapper');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Initial paint
  renderSentence();
  renderNote();
}

// === Comic Bubbles (speech/thought over image) — seepage-proof ===
// Scene shape:
//   type: 'comic-bubbles',
//   image: 'images/whatever.png',
//   text: 'instructions...',
//   bubbles: [
//     { x: 22, y: 28, kind: 'speech', prompt: 'Can you ___ the word?', options: ['look up','pick up','put down'], correct: 0 },
//     { x: 72, y: 62, kind: 'thought', prompt: 'We should ___ the TV.', options: ['turn up','turn down','turn off'], correct: 2 }
//   ],
//   next: 'scene1', setFlagsOnWin:[], unlockScenesOnWin:[]
function loadComicBubblesScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__cbCleanup) { try { window.__cbCleanup(); } catch(_){} window.__cbCleanup = null; }
  const stale = document.getElementById('comic-bubbles');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  const bubbles = Array.isArray(scene.bubbles) ? scene.bubbles : [];

  // Wrapper with the image and overlay layer
  const wrap = document.createElement('div');
  wrap.id = 'comic-bubbles';
  wrap.style.maxWidth = '980px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '8px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="cb-figure" style="position:relative; width:100%; border-radius:12px; overflow:hidden; background:#000;">
      <img id="cb-img" src="${scene.image || ''}" alt="scene" style="width:100%; height:auto; display:block;"/>
      <div id="cb-overlay" style="position:absolute; inset:0;"></div>
    </div>
    <div id="cb-feedback" style="margin-top:12px; font-weight:700;"></div>
    <div id="cb-ctrl" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"></div>
  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const overlay = wrap.querySelector('#cb-overlay');
  const fbEl = wrap.querySelector('#cb-feedback');
  const ctrlEl = wrap.querySelector('#cb-ctrl');

  // Create bubbles
  const state = { chosen: Array(bubbles.length).fill(null) };

  function bubbleShellStyles(kind) {
    const base = "position:absolute; transform:translate(-50%,-50%); max-width:46%;";
    const pad = "padding:10px 12px; border-radius:16px;";
    const common = "background:#111; color:#0ff; border:2px solid #00ffff; box-shadow:0 2px 10px #0008;";
    const tail =
      kind === 'thought'
        ? ``
        : ``;
    return `${base} ${pad} ${common} ${tail}`;
  }

  function renderBubble(i, b) {
    const el = document.createElement('div');
    el.className = 'cb-bubble';
    el.style.cssText = bubbleShellStyles(b.kind || 'speech');
    el.style.left = (b.x || 50) + '%';
    el.style.top = (b.y || 50) + '%';
    el.style.cursor = 'default';

    const prompt = document.createElement('div');
    prompt.textContent = b.prompt || '';
    prompt.style.fontWeight = '700';
    prompt.style.marginBottom = '8px';
    el.appendChild(prompt);

    const optWrap = document.createElement('div');
    optWrap.className = 'cb-options';
    optWrap.style.display = 'flex';
    optWrap.style.flexWrap = 'wrap';
    optWrap.style.gap = '6px';
    el.appendChild(optWrap);

    (b.options || []).forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.textContent = optText;
      btn.dataset.index = idx;
      btn.style.cssText = "padding:6px 10px; border-radius:10px; border:2px solid #00ffff; background:#000; color:#0ff; font-weight:700; cursor:pointer;";
      btn.onmouseenter = () => (btn.style.background = "#001a1a");
      btn.onmouseleave = () => (btn.style.background = "#000");
      btn.onclick = () => {
        state.chosen[i] = idx;
        // reset all buttons border in this bubble
        optWrap.querySelectorAll('button').forEach(bn => bn.style.borderColor = '#00ffff');
        btn.style.borderColor = '#9effa0';
        fbEl.textContent = '';
      };
      optWrap.appendChild(btn);
    });

    // inline result area for this bubble
    const note = document.createElement('div');
    note.className = 'cb-note';
    note.style.marginTop = '6px';
    note.style.opacity = '.95';
    el.appendChild(note);

    overlay.appendChild(el);
  }

  bubbles.forEach((b, i) => renderBubble(i, b));

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#333; color:#eee; cursor:pointer; font-weight:700";
  resetBtn.onclick = () => {
    state.chosen = Array(bubbles.length).fill(null);
    overlay.querySelectorAll('.cb-bubble .cb-options button').forEach(b => b.style.borderColor = '#00ffff');
    overlay.querySelectorAll('.cb-bubble .cb-note').forEach(n => { n.textContent = ''; n.style.color = '#eee'; });
    fbEl.textContent = '';
  };
  ctrlEl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Submit";
  checkBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#00ffff; color:#000; cursor:pointer; font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    let allAnswered = true;
    let allCorrect = true;

    bubbles.forEach((b, i) => {
      const note = overlay.querySelectorAll('.cb-bubble .cb-note')[i];
      const chosen = state.chosen[i];
      if (chosen == null) { allAnswered = false; note.textContent = '⚠️ Choose an option.'; note.style.color = 'orange'; return; }
      if (chosen !== b.correct) { allCorrect = false; note.textContent = '❌ Try another option.'; note.style.color = 'salmon'; }
      else { note.textContent = '✅'; note.style.color = 'lightgreen'; }
    });

    if (!allAnswered) {
      fbEl.textContent = "⚠️ Answer all bubbles before submitting.";
      fbEl.style.color = "orange";
      return;
    }

    if (allCorrect) {
      fbEl.textContent = "✅ Perfect! Moving on…";
      fbEl.style.color = "lightgreen";
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fbEl.textContent = "❌ Some bubbles are incorrect. Adjust and submit again.";
      fbEl.style.color = "salmon";
    }
  };
  ctrlEl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#222; color:#eee; cursor:pointer; font-weight:700";
  backBtn.onclick = () => goNext('scene1');
  ctrlEl.appendChild(backBtn);

  // cleanup + navigation
  function cleanup() {
    const node = document.getElementById('comic-bubbles');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }
  window.__cbCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('comic-bubbles');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Dashboard (universal CRM-style widgets + data MCQs) ===
// Scene shape:
//   type: 'dashboard',
//   text: 'instructions...',
//   widgets: [
//     { type:'kpi', id:'rev', label:'Revenue', value:'$1.2M', delta:+8 },
//     { type:'bar', id:'perf', label:'Quarterly Performance', data:[{label:'Q1',value:20},...], max:100 },
//     { type:'pie', id:'mix', label:'Product Mix', data:[{label:'A',value:50},...], colors:['#0ff','#9f0','#f90'] },
//     { type:'table', id:'top', label:'Top Accounts', columns:['Client','MRR','Status'], rows:[['Acme','$50k','Active'], ...] }
//   ],
//   questions: [
//     { text:'Which product leads the mix?', options:['A','B','C'], correct:0 },
//     { text:'Which quarter was best?', options:['Q1','Q2','Q3','Q4'], correct:3 }
//   ],
//   next:'scene1' OR {scoring:{high:2,medium:1}, endings:{high:'id',medium:'id',low:'id'}}
// === Dashboard loader (binds to crm.state + live updates) ===
// === Dashboard (narrative CRM) loader ===
function loadDashboardScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  const regNode     = window.registerNode     || function(){};
  const regCleanup  = window.registerCleanup  || function(){};

  // Kill any previous instance
  const stale = document.getElementById('dashboard-wrap');
  if (stale) stale.remove();

  const game       = document.getElementById('game-container');
  const sceneText  = document.getElementById('scene-text');
  const sceneImage = document.getElementById('scene-image');
  const infoDiv    = document.getElementById('challenge-info');

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = 'block'; sceneText.textContent = scene.text; }
    else { sceneText.style.display = 'none'; sceneText.innerHTML = ''; }
  }
  if (game) game.style.display = 'block';

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'dashboard-wrap';
  wrap.style.maxWidth = '1100px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '8px 6px';
  wrap.style.color = 'var(--text-default)'; // strong dark text on white

  regNode(wrap);

  const questions = Array.isArray(scene.questions) ? scene.questions : [];

  wrap.innerHTML = `
    <div id="dash-grid" style="
      display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
      gap:12px;align-items:start;">
    </div>
    ${questions.length ? `<div id="dash-qa" style="margin-top:16px;border-top:1px solid var(--brand-blue-50);padding-top:12px;"></div>` : ``}

  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else game.appendChild(wrap);

  regCleanup(() => { const n = document.getElementById('dashboard-wrap'); if (n) n.remove(); });

  const grid = wrap.querySelector('#dash-grid');
  const qa   = wrap.querySelector('#dash-qa');

  // --- Card helpers
  function card(title) {
    const c = document.createElement('div');
    c.className = 'dash-card';
    c.style.cssText = 'background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px;box-shadow:var(--shadow);';
    if (title) {
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = 'font-weight:800;margin-bottom:8px;color:var(--brand-blue);';
      c.appendChild(h);
    }
    regNode(c);
    return c;
  }
  function renderKPI(w) {
    const c = card(w.label);
    const val = document.createElement('div');
    val.textContent = w.value ?? '';
    val.style.cssText = 'font-size:28px;font-weight:900;letter-spacing:.02em;margin-bottom:6px;';
    const d = document.createElement('div');
    const delta = Number(w.delta || 0);
    const sign = delta > 0 ? '+' : '';
    d.textContent = `${sign}${delta}% vs prev`;
    d.style.cssText = `font-weight:700;${delta>=0?'color:#1E7F3B;':'color:#C0392B;'}`;

    c.appendChild(val); c.appendChild(d);
    return c;
  }
  function renderBar(w) {
    const c = card(w.label);
    const max = Number.isFinite(w.max) ? w.max : Math.max(...(w.data||[]).map(d=>d.value||0), 1);
    (w.data||[]).forEach(row=>{
      const line = document.createElement('div');
      line.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0;';
      const label = document.createElement('div');
      label.textContent = row.label ?? '';
      label.style.cssText='min-width:64px;opacity:.9;color:var(--text-default);';
      const barBox = document.createElement('div');
      barBox.style.cssText='flex:1;background:var(--brand-blue-50);border-radius:8px;overflow:hidden;border:1px solid var(--border);';
      const bar = document.createElement('div');
      const pct = Math.max(0, Math.min(100, (row.value||0)/max*100));
      bar.style.cssText=`height:14px;width:${pct}%;background:linear-gradient(90deg,var(--brand-blue),var(--brand-blue-700));`;
      barBox.appendChild(bar);
      const val = document.createElement('div');
      val.textContent = row.value ?? '';
      val.style.cssText='min-width:44px;text-align:right;color:var(--text-default);opacity:.9;';
      line.appendChild(label); line.appendChild(barBox); line.appendChild(val);
      c.appendChild(line);
    });
    return c;
  }
  function renderPie(w) {
    const total = (w.data||[]).reduce((a,b)=>a+(b.value||0),0) || 1;
    let acc = 0;
    const colors = ['var(--brand-blue)','rgba(30,127,59,.9)','#f9c74f','#f8961e','#577590','#f94144','#90be6d']; // keeps variety, first = brand
    const stops = (w.data||[]).map((seg,i)=>{
      const start = acc/total*360; acc += (seg.value||0);
      const end = acc/total*360;
      const col = (w.colors && w.colors[i]) || colors[i%colors.length];
      return `${col} ${start}deg ${end}deg`;
    }).join(', ');
    const c = card(w.label);
    const ring = document.createElement('div');
    ring.style.cssText=`width:140px;height:140px;border-radius:50%;margin:6px auto;background:conic-gradient(${stops});`;
    const hole = document.createElement('div');
    hole.style.cssText='width:80px;height:80px;border-radius:50%;background:#fff;margin:-110px auto 8px;border:1px solid var(--border);';
    c.appendChild(ring); c.appendChild(hole);
    (w.data||[]).forEach((seg,i)=>{
      const row=document.createElement('div');
      const col=(w.colors && w.colors[i]) || colors[i%colors.length];
      row.innerHTML=`<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col};margin-right:6px;"></span>${seg.label ?? ''} — ${seg.value ?? 0}`;
      row.style.margin='4px 0'; row.style.opacity='.9';
      c.appendChild(row);
    });
    return c;
  }
  function renderTable(w) {
    const c = card(w.label);
    const tbl = document.createElement('table');
    tbl.style.cssText='width:100%;border-collapse:collapse;font-size:14px;';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    (w.columns||[]).forEach(h=>{
      const th=document.createElement('th');
      th.textContent=h; th.style.cssText='text-align:left;border-bottom:1px solid var(--border);padding:6px;color:var(--brand-blue);';
      trh.appendChild(th);
    });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tbody=document.createElement('tbody');
    (w.rows||[]).forEach(r=>{
      const tr=document.createElement('tr');
      (r||[]).forEach(cell=>{
        const td=document.createElement('td');
        td.textContent=cell; td.style.cssText='padding:6px;border-bottom:1px dashed var(--border);color:var(--text-default);';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    c.appendChild(tbl);
    return c;
  }

  // Render widgets
  (scene.widgets||[]).forEach(w=>{
    let node=null;
    if (w.type==='kpi') node=renderKPI(w);
    else if (w.type==='bar') node=renderBar(w);
    else if (w.type==='pie') node=renderPie(w);
    else if (w.type==='table') node=renderTable(w);
    if (node) { node.dataset.id = w.id || ''; grid.appendChild(node); }
  });

  // --- Questions (auto-advance on correct) OR auto-skip if none
  if (questions.length && qa) {
    let qIndex = 0;

    function renderDashQuestion(i) {
      const q = questions[i];
      qa.innerHTML = '';
      const cardQ = card(`Question ${i+1} of ${questions.length}`);
      const p = document.createElement('div');
      p.textContent = q.text || '';
      p.style.marginBottom = '10px';
      cardQ.appendChild(p);

      const opts = document.createElement('div');
      opts.style.display = 'flex';
      opts.style.flexDirection = 'column';
      opts.style.gap = '8px';

      (q.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
        btn.onmouseenter = () => (btn.style.background = "#00cccc");
        btn.onmouseleave = () => (btn.style.background = "#00ffff");
        btn.onclick = () => {
          const correct = (idx === q.correct);
          // disable all to avoid double clicks
          Array.from(opts.children).forEach(b => b.disabled = true);
          if (correct) {
            // brief feedback flash
            const fb = document.createElement('div');
            fb.textContent = "✅ Correct!";
            fb.style.cssText = "margin-top:8px;font-weight:800;color:lightgreen;";
            cardQ.appendChild(fb);

            setTimeout(() => {
              // next question or navigate
              if (i + 1 < questions.length) {
                renderDashQuestion(i + 1);
              } else if (scene.endings && scene.scoring) {
                // optional scoring path (count corrects)
                // minimal: treat all answered correctly path
                const dest = scene.endings.high || scene.next;
                if (dest) loadScene(dest);
              } else if (scene.next) {
                loadScene(scene.next);
              }
            }, 700);
          } else {
            // allow retry on wrong
            btn.style.background = '#ff9e9e';
            btn.style.color = '#000';
            // re-enable others so they can try again
            Array.from(opts.children).forEach(b => { if (b !== btn) b.disabled = false; });
          }
        };
        opts.appendChild(btn);
      });

      cardQ.appendChild(opts);
      qa.appendChild(cardQ);
    }

    renderDashQuestion(qIndex);
  } else if (scene.next) {
    // No questions: jump straight to the next scene
    setTimeout(() => loadScene(scene.next), 0);
  }
}

/* SCORM: ensure time/commit on unload */
window.addEventListener("beforeunload", () => {
  try {
    if (SCORM.init() && typeof SCORM.finish === 'function') {
      // Finishes without changing status/score
      SCORM.finish({});
    } else if (SCORM.init()) {
      SCORM.commit();
    }
  } catch (_) {}
});


(function makeDebug(){
  const box = document.createElement('div');
  box.id = 'scorm-debug';
  box.style.cssText = 'position:fixed;bottom:10px;right:10px;background:#000a;color:#0ff;padding:8px 10px;border:1px solid #0ff;border-radius:8px;font:12px/1.3 monospace;z-index:99999;display:none;';
  document.body.appendChild(box);
  function refresh(){
    let status = 'n/a', score='n/a', loc='n/a';
    try { if (SCORM && SCORM.init()) {
      status = SCORM.get("cmi.core.lesson_status") || 'n/a';
      score  = SCORM.get("cmi.core.score.raw") || 'n/a';
      loc    = SCORM.get("cmi.core.lesson_location") || 'n/a';
    }} catch(_){}
    box.innerHTML =
      `scene: ${window.currentSceneId || 'n/a'}<br>`+
      `cur/max: ${window.scoreCurrent?.()||0}/${window.scoreMax?.()||0}<br>`+
      `raw: ${Math.round((window.scoreCurrent?.()||0)/(window.scoreMax?.()||1)*100)}%<br>`+
      `SCORM status: ${status}<br>`+
      `SCORM score: ${score}<br>`+
      `location: ${loc}<br>`;
  }
  setInterval(() => { if (box.style.display !== 'none') refresh(); }, 700);
  window.addEventListener('keydown', e => {
    if (e.key === 'F9') {
      box.style.display = (box.style.display === 'none') ? 'block' : 'none';
      refresh();
    }
  });
})();

window._dbgScore = () => {
  const cur = (window.scoreCurrent && window.scoreCurrent()) || 0;
  const max = (window.scoreMax && window.scoreMax()) || 0;
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0;
  let scInit=false, scStatus="n/a", scRaw="n/a";
  try { scInit = !!(SCORM && SCORM.init && SCORM.init()); } catch {}
  try { scStatus = SCORM && SCORM.get ? SCORM.get("cmi.core.lesson_status") : "n/a"; } catch {}
  try { scRaw    = SCORM && SCORM.get ? SCORM.get("cmi.core.score.raw")    : "n/a"; } catch {}
  return { cur, max, pct, scInit, scStatus, scRaw, TOTAL_AWARD_MAX: window.__TOTAL_AWARD_MAX };
};





