(() => {
  const PRODUCTS = [
    { id: "FFDEC", label: "Fed funds" },
    { id: "CPIC", label: "CPI" },
    { id: "CPIY", label: "CPI YoY" },
    { id: "PCEY", label: "PCE YoY" },
    { id: "UNR", label: "Unemployment" },
    { id: "CAUNR", label: "Canada UNR" }
  ];
  const KNOWN_STATES = ["QUOTING", "BOUND", "DARK", "HALTED", "FLAT", "UNKNOWN"];
  const SESSION_KEY = "torus-status-unlock";
  const cfg = window.STATUS_CONFIG || {};
  const expectedHash = String(cfg.passwordSha256 || "").trim().toLowerCase();
  const dataUrl = cfg.dataUrl || "data.json";
  const refreshMs = Number(cfg.refreshMs) || 20000;

  const gateEl = document.getElementById("gate");
  const dashEl = document.getElementById("dash");
  const navSide = document.getElementById("nav-side");
  const form = document.getElementById("unlock-form");
  const passwordInput = document.getElementById("password");
  const unlockError = document.getElementById("unlock-error");
  const bookStateEl = document.getElementById("book-state");
  const bookMetaEl = document.getElementById("book-meta");
  const productsEl = document.getElementById("products");
  const feedStampEl = document.getElementById("feed-stamp");
  const sampleBanner = document.getElementById("sample-banner");
  const feedError = document.getElementById("feed-error");
  const refreshBtn = document.getElementById("refresh-btn");
  const lockBtn = document.getElementById("lock-btn");

  let timer = null;
  let lastFeed = null;

  function hex(buffer) {
    return [...new Uint8Array(buffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256hex(value) {
    const bytes = new TextEncoder().encode(value);
    return hex(await crypto.subtle.digest("SHA-256", bytes));
  }

  function hashesEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function unlocked() {
    return sessionStorage.getItem(SESSION_KEY) === expectedHash && expectedHash.length === 64;
  }

  function showDash() {
    gateEl.hidden = true;
    dashEl.hidden = false;
    navSide.hidden = false;
  }

  function showGate() {
    dashEl.hidden = true;
    navSide.hidden = true;
    gateEl.hidden = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function lock() {
    sessionStorage.removeItem(SESSION_KEY);
    lastFeed = null;
    showGate();
    passwordInput.value = "";
    passwordInput.focus();
  }

  function fmtNum(value, digits) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, {
      maximumFractionDigits: digits == null ? 1 : digits,
      minimumFractionDigits: Number.isInteger(n) && (digits == null || digits === 0) ? 0 : undefined
    });
  }

  function parseTs(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtWhen(date) {
    if (!date) return "—";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function fmtIsoShort(value) {
    const d = parseTs(value);
    if (!d) return value || "—";
    return d.toISOString().replace(".000", "");
  }

  function ageSeconds(fromDate, now) {
    if (!fromDate) return null;
    return Math.max(0, (now - fromDate.getTime()) / 1000);
  }

  function fmtAge(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
    const s = Math.max(0, Number(seconds));
    if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 172800) return `${(s / 3600).toFixed(1)}h`;
    return `${Math.round(s / 86400)}d`;
  }

  function normalizeState(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "UNKNOWN";
    return KNOWN_STATES.includes(raw) ? raw : raw;
  }

  function stateClass(state) {
    const known = KNOWN_STATES.includes(state) ? state.toLowerCase() : "unknown";
    return `is-${known}`;
  }

  function knownForHealth(state) {
    return KNOWN_STATES.includes(state) ? state : "UNKNOWN";
  }

  function fairsSummary(product) {
    if (!product) return { label: "—", kind: "unknown" };
    if (typeof product.fairs_stale === "boolean") {
      return product.fairs_stale
        ? { label: "Stale", kind: "stale" }
        : { label: "Fresh", kind: "fresh" };
    }
    const alt = String(product.fairs || "").trim().toLowerCase();
    if (alt === "stale") return { label: "Stale", kind: "stale" };
    if (alt === "fresh") return { label: "Fresh", kind: "fresh" };
    return { label: "—", kind: "unknown" };
  }

  function presencePct(product, now) {
    if (!product) return null;
    if (product.presence_pct != null && Number.isFinite(Number(product.presence_pct))) {
      return Number(product.presence_pct);
    }
    if (product.absent_s_today == null) return null;
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const elapsed = Math.max(1, (now.getTime() - start) / 1000);
    const absent = Math.max(0, Number(product.absent_s_today));
    return Math.max(0, Math.min(100, (1 - absent / elapsed) * 100));
  }

  function productSnapshotAge(product, feed, now) {
    if (!product) return ageSeconds(parseTs(feed && feed.ts), now);
    if (product.snapshot_age_s != null && Number.isFinite(Number(product.snapshot_age_s))) {
      return Number(product.snapshot_age_s);
    }
    const own = parseTs(product.ts);
    if (own) return ageSeconds(own, now);
    return ageSeconds(parseTs(feed && feed.ts), now);
  }

  function sessionHint(product) {
    if (!product) return "—";
    const bits = [product.session || product.auth];
    if (product.pid != null) bits.push(`pid ${product.pid}`);
    return bits.filter(Boolean).join(" · ") || "—";
  }

  function armHint(value, now) {
    if (!value) return { text: "—", muted: true };
    const until = parseTs(value);
    if (!until) return { text: String(value), muted: false };
    const delta = (until.getTime() - now.getTime()) / 1000;
    const rel = delta >= 0 ? `in ${fmtAge(delta)}` : `expired ${fmtAge(-delta)} ago`;
    return { text: `${fmtIsoShort(value)} · ${rel}`, muted: delta < 0 };
  }

  function bookHealth(feed, now) {
    const reasons = [];
    let level = "green";
    const raise = (next, reason) => {
      const rank = { green: 0, amber: 1, red: 2 };
      if (rank[next] > rank[level]) level = next;
      if (reason) reasons.push(reason);
    };

    if (!feed) return { level: "red", reasons: ["No feed"] };

    const feedAge = ageSeconds(parseTs(feed.ts), now);
    const poller = feed.poller || {};
    const pollerAge = poller.age_s != null ? Number(poller.age_s) : null;

    if (poller.ok === false) raise("red", "Poller down");
    if (pollerAge != null && pollerAge > 60) raise("red", "Poller stale");
    else if (pollerAge != null && pollerAge > 15) raise("amber", "Poller aging");
    if (feedAge != null && feedAge > 90) raise("red", "Feed stale");
    else if (feedAge != null && feedAge > 30) raise("amber", "Feed aging");

    PRODUCTS.forEach((meta) => {
      const product = (feed.products || {})[meta.id];
      if (!product) {
        raise("amber", `${meta.id} missing`);
        return;
      }
      const state = knownForHealth(normalizeState(product.engine_state));
      if (state === "HALTED") raise("red", `${meta.id} halted`);
      if (state === "DARK" || state === "FLAT" || state === "UNKNOWN") {
        raise("amber", `${meta.id} ${state.toLowerCase()}`);
      }
      if (fairsSummary(product).kind === "stale") raise("amber", `${meta.id} fairs stale`);
    });

    return { level, reasons };
  }

  function metric(label, value, muted) {
    const ddClass = muted ? " class=\"muted\"" : "";
    return `<div class="metric"><dt>${label}</dt><dd${ddClass}>${value}</dd></div>`;
  }

  function renderProducts(feed, now) {
    productsEl.innerHTML = PRODUCTS.map((meta) => {
      const product = (feed.products || {})[meta.id];
      const state = normalizeState(product && product.engine_state);
      const fairs = fairsSummary(product);
      const arm = armHint(product && product.arm_valid_until, now);
      const presence = presencePct(product, now);
      const snapAge = productSnapshotAge(product, feed, now);
      const fairsBadge = fairs.kind === "unknown"
        ? fairs.label
        : `<span class="badge is-${fairs.kind}">${fairs.label}</span>`;
      return `
        <article class="card">
          <div class="card-head">
            <h2>${meta.id}</h2>
            <span class="badge ${stateClass(knownForHealth(state))}">${state}</span>
          </div>
          <p class="sub">${meta.label} · ${sessionHint(product)}</p>
          <dl class="metrics">
            ${metric("Resting", fmtNum(product && product.resting, 0))}
            ${metric("Absent today", product && product.absent_s_today != null ? fmtAge(product.absent_s_today) : "—")}
            ${metric("Presence", presence == null ? "—" : `${fmtNum(presence, 1)}%`)}
            ${metric("Collateral", fmtNum(product && product.collateral, 0))}
            ${metric("Locked", fmtNum(product && product.locked, 0))}
            ${metric("Arm valid until", arm.text, arm.muted)}
            ${metric("Fairs", fairsBadge)}
            ${metric("Snapshot age", fmtAge(snapAge))}
          </dl>
        </article>`;
    }).join("");
  }

  function renderBook(feed, now) {
    const health = bookHealth(feed, now);
    bookStateEl.textContent = health.level;
    bookStateEl.className = `book-state is-${health.level}`;

    const poller = (feed && feed.poller) || {};
    const pollerLabel = poller.ok === false
      ? "Down"
      : poller.ok === true
        ? "Up"
        : "—";
    const sha = feed && feed.release_sha ? String(feed.release_sha) : "—";
    const shaShort = sha.length > 12 ? `${sha.slice(0, 7)}` : sha;
    const rows = [
      ["Poller", `${pollerLabel}${poller.age_s != null ? ` · ${fmtAge(poller.age_s)}` : ""}`],
      ["Release", shaShort],
      ["Feed age", fmtAge(ageSeconds(parseTs(feed && feed.ts), now))],
      ["Refresh", `${Math.round(refreshMs / 1000)}s`]
    ];
    bookMetaEl.innerHTML = rows
      .map(([k, v]) => `<div><strong>${k}</strong> ${v}</div>`)
      .join("");

    const stamp = parseTs(feed && feed.ts);
    feedStampEl.textContent = stamp
      ? `Last feed ${fmtWhen(stamp)}`
      : "Feed timestamp unavailable";
    sampleBanner.hidden = !(feed && feed.sample);
  }

  function render(feed) {
    const now = new Date();
    lastFeed = feed;
    renderBook(feed, now);
    renderProducts(feed, now);
  }

  async function loadFeed() {
    feedError.hidden = true;
    try {
      const url = `${dataUrl}${dataUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
      const feed = await res.json();
      render(feed);
    } catch (err) {
      feedError.hidden = false;
      feedError.textContent = lastFeed
        ? `Could not refresh feed. Showing last snapshot. ${err.message}`
        : `Could not load status/data.json. ${err.message}`;
      if (lastFeed) render(lastFeed);
    }
  }

  function startPolling() {
    showDash();
    loadFeed();
    if (timer) clearInterval(timer);
    timer = setInterval(loadFeed, refreshMs);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    unlockError.hidden = true;
    if (!expectedHash || expectedHash.length !== 64) {
      unlockError.textContent = "Status password hash is not configured.";
      unlockError.hidden = false;
      return;
    }
    const digest = await sha256hex(passwordInput.value);
    if (!hashesEqual(digest, expectedHash)) {
      unlockError.textContent = "That password does not match.";
      unlockError.hidden = false;
      return;
    }
    sessionStorage.setItem(SESSION_KEY, expectedHash);
    passwordInput.value = "";
    startPolling();
  });

  refreshBtn.addEventListener("click", () => { loadFeed(); });
  lockBtn.addEventListener("click", lock);

  if (unlocked()) startPolling();
  else passwordInput.focus();
})();
