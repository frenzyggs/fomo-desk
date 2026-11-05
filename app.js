// STEP 8 iPhone app, Plan B: polls static JSON (no public API, no SSE, no write-back).
// No secrets in this file. The data folder (d) and token (t) arrive in the URL hash and
// stay there, so Add to Home Screen can save a launch URL that still has them. They are
// also mirrored into localStorage and a first-party cookie: iOS standalone does not share
// Safari localStorage, but since iOS 17.2 it copies cookies once when the icon is created.
// d and t are never put in the query string (that would hit GitHub Pages logs). Every FOMO
// URL shown comes from the JSON (coin_url / profile_url / signup_url, built by links.py
// on the desk). None is built here.
(function () {
  "use strict";
  // ---------------------------------------------------------------- connect
  const STORE_D = "desk_d";
  const STORE_T = "desk_t";
  function appCookiePath() {
    const path = location.pathname;
    return (path.endsWith("/") ? path : path.replace(/[^/]+$/, "")) || "/";
  }
  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function readCookie(name) {
    const prefix = name + "=";
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].lastIndexOf(prefix, 0) === 0) {
        try { return decodeURIComponent(parts[i].slice(prefix.length)); } catch (e) { return null; }
      }
    }
    return null;
  }
  function writeCookie(name, value) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = name + "=" + encodeURIComponent(value) + "; Path=" + appCookiePath() + "; Max-Age=31536000; SameSite=Lax" + secure;
  }
  function remember(key, value) {
    if (!value) return;
    writeStore(key, value);
    writeCookie(key, value);
  }
  // Hash wins. Otherwise localStorage, otherwise the cookie copied into a home-screen app.
  function recall(key) {
    const local = readStore(key);
    const baked = readCookie(key);
    if (local) { if (local !== baked) writeCookie(key, local); return local; }
    if (baked) { writeStore(key, baked); return baked; }
    return null;
  }
  const h = new URLSearchParams(location.hash.slice(1));
  const hashD = h.get("d");
  const hashT = h.get("t");
  if (hashD) remember(STORE_D, hashD);
  if (hashT) remember(STORE_T, hashT);
  const D = hashD || recall(STORE_D);
  const T = hashT || recall(STORE_T);
  // Bare URL (bookmark, or an icon saved before the hash was kept): put d/t back on the
  // hash so the next Add to Home Screen captures them. Never as a query string.
  if (D && !hashD) {
    const next = new URLSearchParams();
    next.set("d", D);
    if (T) next.set("t", T);
    history.replaceState(null, "", location.pathname + location.search + "#" + next.toString());
  }
  const base = new URL("./", location.href);
  const url = f => new URL("d/" + encodeURIComponent(D) + "/" + f + "?_=" + Date.now(), base);
  async function get(f) {
    const r = await fetch(url(f), { cache: "no-store" });
    if (!r.ok) { const e = new Error(String(r.status)); e.status = r.status; throw e; }
    return r.json();
  }
  async function tryGet(f) { try { return await get(f); } catch (e) { if (e.status === 404) return null; throw e; } }

  // ---------------------------------------------------------------- state
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const NAMES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  const COLOR = { scanner: "var(--cyan)", auditor: "var(--text)", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)" };
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const S = {
    loaded: false, error: false, lastGood: null, nextPoll: 0, poll: 15,
    state: null, chart: null, chartAll: null, activity: null, account: null, settings: null, events: null,
    decisions: {}, lastAudit: null, range: "LIVE", tab: "home", screen: null, lastSignalKey: null,
  };
  const $ = id => document.getElementById(id);
  const view = $("view");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const money = v => v == null ? "–" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
  const isoSec = s => s ? Date.parse(s) / 1000 : null;
  const hhmm = t => t ? new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–";
  const isPaper = () => (S.state && S.state.mode) === "PAPER";
  const ext = (href, inner, cls) => href ? `<a class="${cls || ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;

  // Night start = most recent 12:00 Europe/Amsterdam (same boundary the desk uses).
  function nightStart(now) {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(now * 1000)).reduce((o, x) => (o[x.type] = +x.value, o), {});
    return now - (((p.hour - 12 + 24) % 24) * 3600 + p.minute * 60 + p.second);
  }

  // ---------------------------------------------------------------- polling
  async function poll() {
    if (!D) { render(); return; }
    try {
      const st = await get("state.json");
      S.poll = st.poll_seconds || 15;
      const [ch, all, act, acc, set, ev, ...dec] = await Promise.all([
        get(`chart/${S.range}.json`).catch(() => get("chart.json")), get("chart/ALL.json"), get("activity.json"),
        get("account.json"), get("settings.json"), tryGet("events.json"),
        ...AGENTS.map(a => tryGet(`agents/${a}/decisions.json`))]);
      AGENTS.forEach((a, i) => S.decisions[a] = (dec[i] && dec[i].items) || []);
      const la = S.decisions.auditor[0];
      S.lastAudit = la ? await tryGet(`audit/${la.mint}.json`) : null;
      Object.assign(S, { state: st, chart: ch, chartAll: all, activity: act, account: acc, settings: set, events: ev, loaded: true });
      // Plan B republishes a few times a day, so a healthy snapshot is often minutes or
      // hours old. Remember its heartbeat anyway. The red banner is a failed fetch, or a
      // payload that itself says the desk is down — not a stale timestamp.
      if (Number.isFinite(Number(st.heartbeat))) S.lastGood = Number(st.heartbeat);
      S.error = payloadSaysDown(st);
      if (S.screen) await loadScreen(S.screen);
    } catch (e) {
      S.error = true;
    }
    S.nextPoll = Date.now() + S.poll * 1000;
    render();
    setTimeout(poll, S.poll * 1000);
  }
  setInterval(renderError, 1000);

  // status "ok" (and anything else that isn't an explicit down) is a loaded snapshot.
  function payloadSaysDown(st) {
    const s = String(st && st.status != null ? st.status : "").trim().toLowerCase();
    return s === "down" || s === "offline" || s === "stopped" || s === "error" || s === "dead";
  }
  function snapshotText(ts) {
    const d = new Date(ts * 1000), now = new Date();
    const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (same) return "Snapshot from " + time;
    return "Snapshot from " + d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time;
  }
  function renderError() {
    const row = $("error-row");
    const snap = $("snapshot-row");
    if (S.error) {
      if (snap) snap.hidden = true;
      const n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
      row.hidden = false;
      row.textContent = `Desk offline · retrying in ${n}s · last update ${S.lastGood ? new Date(S.lastGood * 1000).toLocaleTimeString() : "never"}`;
      return;
    }
    row.hidden = true;
    if (!snap) return;
    const stale = S.loaded && Number.isFinite(S.lastGood) && (Date.now() / 1000 - S.lastGood) > Math.max(60, S.poll * 4);
    if (!stale) { snap.hidden = true; return; }
    snap.hidden = false;
    snap.textContent = snapshotText(S.lastGood);
  }

  // ---------------------------------------------------------------- navigation
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => go(b.dataset.tab));
  $("nav-avatar").onclick = () => go("account");
  $("nav-title").onclick = () => go("account");
  $("nav-bell").onclick = () => { localStorage.setItem("desk_seen", String(Date.now() / 1000)); go("activity"); };
  $("nav-search").onclick = () => { const b = $("search-bar"); b.hidden = !b.hidden; if (!b.hidden) $("search-input").focus(); };
  $("search-input").oninput = renderSearch;
  function go(tab) { S.tab = tab; S.screen = null; built = null; render(); scrollTo(0, 0); }
  async function openScreen(sc) { S.screen = sc; built = null; render(); scrollTo(0, 0); await loadScreen(sc); render(); }
  async function loadScreen(sc) {
    try {
      if (sc.type === "coin") { sc.coin = await tryGet(`coin/${sc.mint}.json`); sc.audit = await tryGet(`audit/${sc.mint}.json`); }
      if (sc.type === "audit") {
        if (!sc.mint) { const la = (S.decisions.auditor || [])[0]; sc.mint = la && la.mint; }
        sc.audit = sc.mint ? await tryGet(`audit/${sc.mint}.json`) : null;
        sc.coin = sc.mint ? await tryGet(`coin/${sc.mint}.json`) : null;
      }
      sc.loaded = true;
    } catch (e) { sc.loaded = true; S.error = true; }
  }
  view.addEventListener("click", e => {
    const t = e.target.closest("[data-coin],[data-audit],[data-go],[data-act]");
    if (!t || e.target.closest("a[href]")) return;
    if (t.dataset.coin) openScreen({ type: "coin", mint: t.dataset.coin, url: t.dataset.url });
    else if (t.dataset.audit !== undefined) openScreen({ type: "audit", mint: t.dataset.audit || null, url: t.dataset.url });
    else if (t.dataset.go) { go(t.dataset.go); if (t.dataset.anchor) setTimeout(() => { const a = document.getElementById(t.dataset.anchor); a && a.scrollIntoView(); }, 50); }
    else if (t.dataset.act) ACTIONS[t.dataset.act](t);
  });

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3500);
  }
  const PLAN_B = "Not saved: on Plan B the app can't change the desk. Ask in the desk chat instead (STEP 9).";

  // ---------------------------------------------------------------- render root
  let built = null;
  function render() {
    renderError();
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab && !S.screen));
    $("bell-dot").hidden = !unread();
    if (!D) { view.innerHTML = `<div class="page"><p class="empty">Open the private link once to connect</p></div>`; return; }
    if (S.screen) return S.screen.type === "coin" ? renderCoin(S.screen) : renderAudit(S.screen);
    ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount })[S.tab]();
  }

  function unread() {
    const seen = +(localStorage.getItem("desk_seen") || 0);
    return ((S.events && S.events.items) || []).some(e => (e.type === "signal" || e.type === "exit") && isoSec(e.ts) > seen);
  }

  // ---------------------------------------------------------------- odometer
  function setOdo(el, text) {
    const chars = [...text];
    if (el.dataset.len !== String(chars.length) || el.dataset.shape !== text.replace(/\d/g, "0")) {
      el.innerHTML = chars.map(ch => /\d/.test(ch)
        ? `<span class="d"><span class="strip">${"0123456789".split("").map(n => `<span>${n}</span>`).join("")}</span></span>`
        : `<span>${esc(ch)}</span>`).join("");
      el.dataset.len = String(chars.length); el.dataset.shape = text.replace(/\d/g, "0");
      el.querySelectorAll(".strip").forEach(s => s.style.transition = "none");
    }
    const strips = [...el.querySelectorAll(".strip")];
    const digits = chars.filter(ch => /\d/.test(ch));
    strips.forEach((s, i) => {
      const fromRight = strips.length - 1 - i;
      s.style.transitionDelay = reduced() ? "0ms" : `${fromRight * 30}ms`;   // 30ms stagger right to left
      s.style.transform = `translateY(-${+digits[i] * 1.05}em)`;
    });
    requestAnimationFrame(() => strips.forEach(s => { if (!reduced()) s.style.transition = ""; }));
  }

  // ---------------------------------------------------------------- HOME
  function nightStartBalance() {
    const pts = (S.chartAll && S.chartAll.points) || [];
    const ns = nightStart(Date.now() / 1000);
    const p = pts.find(p => p[0] >= ns);
    return p ? p[1] : null;
  }
  function todayAndMult() {
    const st = S.state, bal = st && st.balance;
    if (st && st.todayPct != null && st.multiplier != null) return { today: st.todayPct, mult: st.multiplier };
    const start = nightStartBalance();
    if (bal == null || start == null || start === 0) return { today: null, mult: null };
    return { today: (bal / start - 1) * 100, mult: bal / start };   // multiplier = balance / balance at night start
  }

  function chartMarks() {
    const acts = (S.activity && S.activity.items) || [];
    return ((S.chart && S.chart.marks) || []).map((m, i) => {
      const a = acts.find(x => x.mint === m.mint && x.kind === m.kind && Math.abs(x.ts - m.ts) < 2);
      const name = a ? a.title.replace(/^(Bought|Sold|Stopped) /, "") : m.mint.slice(0, 4);
      let label, color;
      if (m.kind === "bought") { label = `Bought ${name}`; color = "#0a84ff"; }
      else if (m.kind === "sold") { label = a ? a.value.split(" ")[0] : "Sold"; color = "#00d35a"; }
      else { const stp = a && /-(\d+(?:\.\d+)?)% stop/.exec(a.subtitle); label = `${stp ? "-" + stp[1] + "%" : "stop"} · ${a ? a.value : ""}`; color = "#ff453a"; }
      return { ts: m.ts, label, color, key: `${m.kind}${m.mint}${m.ts}${i}` };
    });
  }

  function renderHome() {
    if (!S.loaded) {
      view.innerHTML = `<div class="page"><div class="sk big-sk"></div><div class="sk line-sk"></div><div class="sk card-sk"></div>${'<div class="sk row-sk"></div>'.repeat(5)}</div>`;
      built = null; return;
    }
    if (built !== "home") {
      view.innerHTML = `<div class="page">
        <div class="balance-row"><span class="big odo" id="bal"></span><span id="paper"></span></div>
        <div class="today" id="today"></div>
        <div class="chart-wrap"><canvas class="line" id="line"></canvas><div class="chart-empty" id="chart-empty" hidden>Waiting for the first trade</div></div>
        <div class="ranges" id="ranges">${RANGES.map(r => `<button class="tap" data-range="${r}">${r}</button>`).join("")}</div>
        <div class="section-h"><span id="agents-h">Agents</span></div>
        <div class="carousel" id="carousel"></div>
        <div class="section-h"><span>Activity</span><button data-go="activity">See all</button></div>
        <ul class="rows" id="home-act"></ul></div>`;
      built = "home";
      $("ranges").onclick = async e => {
        const r = e.target.dataset.range; if (!r) return;
        S.range = r; try { S.chart = await get(`chart/${r}.json`); } catch (err) { S.error = true; } render();
      };
    }
    const st = S.state;
    if (st.balance == null) { $("bal").textContent = "$–"; delete $("bal").dataset.len; } else setOdo($("bal"), money(st.balance));
    $("paper").innerHTML = isPaper() ? `<span class="badge-paper">PAPER</span>` : "";
    const tm = todayAndMult();
    $("today").innerHTML = tm.today == null ? `<span class="sec">Today –</span>`
      : `<span class="${tm.today >= 0 ? "green" : "red"}">${pct(tm.today)}</span><span class="mult">${tm.mult.toFixed(2)}×</span>`;
    document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.range === S.range));
    const pts = (S.chart && S.chart.points) || [];
    $("chart-empty").hidden = pts.length > 0;
    DeskChart.line($("line"), pts, chartMarks(), { startValue: nightStartBalance() });
    const running = Object.values(st.agents || {}).filter(v => v === "running").length;
    $("agents-h").textContent = `Agents · ${running} running`;
    const sl = $("carousel").scrollLeft;
    $("carousel").innerHTML = AGENTS.map(cardHTML).join("");
    $("carousel").scrollLeft = sl;
    afterCards();
    const items = ((S.activity && S.activity.items) || []).slice().reverse().slice(0, 5);
    $("home-act").innerHTML = items.length ? items.map(actRow).join("") : `<li class="empty">Nothing yet tonight</li>`;
  }

  // ---------------------------------------------------------------- agent cards
  function cardHTML(a) {
    const c = ((S.state && S.state.cards) || {})[a] || {};
    const head = `<div class="who"><i style="background:${COLOR[a]}"></i>${NAMES[a]}</div>`;
    let title = c.title || "", body = "", foot = "";
    if (a === "scanner") {
      const feed = ((S.state && S.state.feed) || []).filter(f => f.kind === "scan").slice(-4).reverse();
      body = feed.length ? `<ul class="feed">${feed.map(f => {
        const killed = / · killed · /.test(f.text);
        const [n, r] = killed ? f.text.split(" · killed · ") : [f.text.replace(/ · → auditor$/, ""), "→ auditor"];
        return `<li class="${killed ? "killed" : "passed"}"><span class="n">${esc(n)}</span><span class="r">${esc(r)}</span></li>`;
      }).join("")}</ul>` : `<p class="sec">Listening for graduations</p>`;
    } else if (a === "auditor") {
      const la = S.lastAudit, layers = la ? la.layers : [];
      body = `<div class="strips">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => {
        const l = layers.find(x => x.n === n), cls = !l || l.pass == null ? "" : l.pass ? "ok" : "bad";
        return `<div class="strip-l ${cls}">${n}</div>`; }).join("")}</div>
        <div>${!la ? `<span class="sec">No coin taken apart yet</span>` : la.passed ? `<span class="green">8/8 → Executor</span>`
          : la.reason ? `<span class="red">${esc(la.reason)}</span>` : `<span class="cyan">taking apart...</span>`}</div>`;
      foot = esc(c.rejectedText || "");
    } else if (a === "analyst") {
      body = `<canvas class="ring" id="ring"></canvas>`;
    } else if (a === "executor") {
      body = c.last ? `<div>${esc(c.last)}</div><div class="bar"><i id="exbar"></i></div><div id="exlabel" class="sec"></div>` : `<p class="sec">No trade yet tonight</p>`;
    } else if (a === "risk") {
      title = c.title || (c.open ? "Guarding" : "Nothing open");
      body = `<div style="display:flex;gap:8px;flex-wrap:wrap">${(c.pills || []).map(p => `<span class="pill mono ${p.color}">${esc(p.text)}</span>`).join("")}</div>`;
    }
    const tap = a === "auditor" ? `data-audit=""` : `data-go="agents"`;
    return `<div class="acard" ${tap}>${head}<h3>${esc(title)}</h3><div class="body">${body}</div><div class="foot">${foot}</div></div>`;
  }

  function afterCards() {
    const c = (S.state && S.state.cards) || {};
    const ring = $("ring"); if (ring) DeskChart.ring(ring, c.analyst && c.analyst.score, c.analyst && c.analyst.green);
    const bar = $("exbar"), lab = $("exlabel"), ex = c.executor || {};
    if (!bar) return;
    const key = ex.last + "|" + ex.status;
    if (ex.status === "✓ Filled") {
      if (S.lastSignalKey && S.lastSignalKey !== key && !reduced() && isPaper()) {
        const t0 = performance.now();                                  // PAPER bar 1.2s
        const step = now => {
          const k = Math.min(1, (now - t0) / 1200), b = $("exbar"), l = $("exlabel"); if (!b) return;
          b.style.width = (k * 100) + "%"; l.textContent = k < 1 ? `Executing... ${Math.round(k * 100)}%` : "✓ Filled";
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      } else { bar.style.width = "100%"; lab.textContent = "✓ Filled"; }
    } else if (ex.status === "Executing") { bar.style.width = "0%"; lab.textContent = "Executing... waiting for your tap on FOMO"; }
    S.lastSignalKey = key;
  }

  // ---------------------------------------------------------------- ACTIVITY
  function actRow(it) {
    const cls = it.kind === "sold" ? "green" : it.kind === "stopped" ? "red" : it.kind === "rejected" ? "sec" : "";
    const tap = it.kind === "rejected" ? `data-audit="${esc(it.mint)}"` : `data-coin="${esc(it.mint)}"`;
    return `<li class="row link" ${tap} data-url="${esc(it.coin_url || "")}"><div class="main"><div class="t">${esc(it.title)}</div>
      <div class="s">${esc(it.subtitle)}</div></div><div class="v ${cls}">${esc(it.value)}</div></li>`;
  }
  function renderActivity() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk row-sk"></div>'.repeat(8)}</div>`; return; }
    const items = ((S.activity && S.activity.items) || []).slice().reverse();
    const more = S.activity && S.activity.cursor && S.activity.cursor.has_more;
    view.innerHTML = `<div class="page"><div class="section-h"><span>Activity</span></div>
      <ul class="rows">${items.length ? items.map(actRow).join("") : `<li class="empty">Nothing yet tonight</li>`}</ul>
      ${more ? `<p class="note">Showing the latest 30. Older pages aren't published on Plan B yet.</p>` : ""}</div>`;
  }

  // ---------------------------------------------------------------- AGENTS
  function decRow(a, d) {
    const t = a === "risk" ? (d.closed_at || d.opened_at) : (d.ts || d.opened_at);
    let verdict = "", reason = "";
    if (a === "scanner") { verdict = d.verdict; reason = d.reason || ""; }
    if (a === "auditor") { verdict = d.passed ? "8/8" : d.reason ? "red" : "running"; reason = d.reason || ""; }
    if (a === "analyst") { verdict = d.pass ? `pass ${d.score}` : "reject"; reason = d.reason || ""; }
    if (a === "executor") { verdict = d.status; reason = d.size_usd != null ? money(d.size_usd) : ""; }
    if (a === "risk") { verdict = d.exit_reason; reason = d.pnl_usd != null ? money(d.pnl_usd) : ""; }
    const coin = ext(d.coin_url, esc(d.name || (d.mint || "").slice(0, 6) + "…"));
    return `<li class="row"><div class="main"><div class="t">${coin}</div><div class="s">${hhmm(isoSec(t))} · ${esc(reason)}</div></div>
      <div class="v">${esc(verdict || "")}</div></li>`;
  }
  function renderAgents() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk card-sk"></div>'.repeat(5)}</div>`; return; }
    const ns = nightStart(Date.now() / 1000), open = ((S.state.cards || {}).risk || {}).open || 0;
    view.innerHTML = `<div class="page">` + AGENTS.map(a => {
      const status = (S.state.agents || {})[a] || "stopped", decs = S.decisions[a] || [];
      const today = decs.filter(d => isoSec(d.ts || d.opened_at) >= ns).length;
      const locked = a === "risk" && open > 0;
      return `<section class="fcard"><div class="hd"><span class="status-dot ${esc(status)}"></span><span class="name">${NAMES[a]}</span>
        <span class="sec num">${today} today</span>
        <button class="switch-hit" data-act="pause" data-agent="${a}" aria-label="Pause or resume ${NAMES[a]}">
          <span class="switch ${status === "paused" ? "" : "on"}" ${locked ? 'aria-disabled="true"' : ""}></span></button></div>
        <div class="sec" style="font-size:13px">${status}${locked ? " · locked while a position is open" : ""}</div>
        <ul class="rows dec">${decs.length ? decs.slice(0, 20).map(d => decRow(a, d)).join("") : `<li class="empty">${a === "scanner" ? "Listening for graduations" : a === "auditor" ? "No coin taken apart yet" : "Nothing yet tonight"}</li>`}</ul>
        <button class="smallbtn" data-go="account" data-anchor="set-${a}">Settings</button></section>`;
    }).join("") + `</div>`;
  }

  const ACTIONS = {
    pause(t) {
      const a = t.dataset.agent, sw = t.querySelector(".switch");
      if (sw.getAttribute("aria-disabled") === "true") { toast("Risk can't be paused while a position is open."); return; }
      sw.classList.toggle("on");
      setTimeout(() => { sw.classList.toggle("on"); toast(PLAN_B); }, 250);   // snaps back: nothing was saved
    },
    mode(t) {
      const m = t.dataset.mode;
      if (m === (S.account || {}).mode) return;
      if (m === "LIVE") { $("live-confirm").hidden = false; $("live-input").focus(); return; }
      toast(PLAN_B);
    },
    liveConfirm() {
      if ($("live-input").value !== "LIVE") { toast('Type LIVE to confirm.'); return; }
      $("live-input").value = ""; $("live-confirm").hidden = true; toast(PLAN_B);
    },
    async invite() {
      const u = (S.account || {}).signup_url; if (!u) return;
      if (navigator.share) { try { await navigator.share({ url: u }); } catch (e) { /* cancelled */ } return; }
      try { await navigator.clipboard.writeText(u); toast("Link copied"); } catch (e) { toast("Couldn't copy the link"); }
    },
    auditToggle(t) {
      const sw = t.querySelector(".switch");
      sw.classList.toggle("on");
      setTimeout(() => { sw.classList.toggle("on"); toast(PLAN_B); }, 250);
    },
    readonly() { toast(PLAN_B); },
  };

  // ---------------------------------------------------------------- AUDITOR screen
  function renderAudit(sc) {
    built = null;
    const back = `<button class="back tap" data-go="${S.tab}">‹ Back</button>`;
    if (!sc.loaded) { view.innerHTML = back + `<div class="page">${'<div class="sk row-sk"></div>'.repeat(8)}</div>`; return; }
    const a = sc.audit;
    if (!a) { view.innerHTML = back + `<div class="page"><p class="empty">No coin taken apart yet</p></div>`; return; }
    const name = (sc.coin && sc.coin.name) || a.mint.slice(0, 6) + "…";
    const link = (sc.coin && sc.coin.coin_url) || sc.url;
    const sig = (S.decisions.executor || []).find(d => d.mint === a.mint && d.size_usd != null);
    const verdict = a.passed ? `<div class="verdict green">Cleared · 8/8 parts</div><div class="sec">Sent to Executor${sig ? " · " + money(sig.size_usd) : ""}</div>`
      : a.reason ? `<div class="verdict red">Rejected · ${esc(a.reason)}</div><div class="sec">Grok Bot won't buy ${esc(name)}</div>`
      : `<div class="verdict cyan">taking apart...</div>`;
    view.innerHTML = back + `<div class="page"><div class="coin-h"><span class="nm">${esc(name)}</span></div>
      <div class="discs" id="discs">${a.layers.map(l => `<div class="disc" data-n="${l.n}">${esc(l.name || "Layer " + l.n)}</div>`).join("")}<div class="beam" id="beam"></div></div>
      <ul class="rows">${a.layers.map(l => `<li class="row"><div class="main"><div class="t">${esc(l.name || "Layer " + l.n)}</div></div>
        <div class="v ${l.pass == null ? "ter" : l.pass ? "green" : "red"}">${esc(l.value)}</div></li>`).join("")}</ul>
      ${verdict}
      <div class="group" style="margin-top:20px"><div class="row"><div class="main"><div class="t">Take apart before buying</div><div class="s">On (default). Read-only on Plan B.</div></div>
        <button class="switch-hit" data-act="auditToggle"><span class="switch on"></span></button></div></div>
      ${link ? ext(link, "Open on FOMO", "btn") : ""}</div>`;
    beam(a);
  }

  // cyan beam: 350ms per layer top to bottom, then 150ms to green or red. Waits on a layer the desk hasn't sent.
  function beam(a) {
    const discs = [...document.querySelectorAll("#discs .disc")], b = $("beam");
    const paint = (d, l) => { if (l.pass == null) d.classList.add("grey"); else d.classList.add(l.pass ? "ok" : "bad"); d.textContent = (l.pass ? "✓ " : l.pass === false ? "✕ " : "") + (l.name || ""); };
    if (reduced()) { a.layers.forEach((l, i) => paint(discs[i], l)); return; }
    let i = 0; b.style.opacity = 1;
    const next = () => {
      if (!document.body.contains(b)) return;
      const l = a.layers[i];
      if (i >= a.layers.length || l.pass == null) {     // no result from the server: the beam waits here
        if (i < a.layers.length && !a.reason) { b.style.top = discs[i].offsetTop + "px"; } else b.style.opacity = 0;
        for (let j = i; j < a.layers.length; j++) if (a.reason || a.passed) paint(discs[j], a.layers[j]);
        return;
      }
      b.style.top = discs[i].offsetTop + "px";
      setTimeout(() => { paint(discs[i], l); setTimeout(() => { if (l.pass === false) { b.style.opacity = 0; for (let j = i + 1; j < a.layers.length; j++) paint(discs[j], a.layers[j]); return; } i++; next(); }, 150); }, 350);
    };
    b.style.top = discs[0].offsetTop + "px"; requestAnimationFrame(next);
  }

  // ---------------------------------------------------------------- COIN screen
  function renderCoin(sc) {
    built = null;
    const back = `<button class="back tap" data-go="${S.tab}">‹ Back</button>`;
    if (!sc.loaded) { view.innerHTML = back + `<div class="page"><div class="sk big-sk"></div><div class="sk line-sk"></div>${'<div class="sk row-sk"></div>'.repeat(3)}</div>`; return; }
    const c = sc.coin;
    if (!c) { view.innerHTML = back + `<div class="page"><p class="empty">This coin isn't published yet</p>${sc.url ? ext(sc.url, "Open on FOMO", "btn") : ""}</div>`; return; }
    const pos = c.position && !c.position.closed_at ? c.position : null;
    const migrated = isoSec(c.stats && c.stats.migratedAt);
    const ageH = migrated ? Math.floor((Date.now() / 1000 - migrated) / 3600) : null;
    const chip = sc.audit && sc.audit.passed ? `<span class="shield">🛡 8/8</span>` : "";
    const since = pos && c.price != null ? (c.price / pos.entry_price - 1) * 100 : null;
    const exitLine = c.exit_lines ? (c.exit_lines.trail != null ? Math.max(c.exit_lines.trail, c.exit_lines.stop || 0) : c.exit_lines.stop) : null;
    const timeoutH = ((S.settings || {}).trading || {}).timeout_h;
    let left = null;
    if (pos && timeoutH != null) { const s = isoSec(pos.opened_at) + timeoutH * 3600 - Date.now() / 1000; left = s > 0 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : "due now"; }
    const st = c.stats || {}, usd = v => v == null ? "n/a" : "$" + Math.round(v).toLocaleString("en-US");
    view.innerHTML = back + `<div class="page">
      <div class="coin-h"><span class="nm">${esc(c.name || c.mint.slice(0, 6) + "…")}</span>${isPaper() ? `<span class="badge-paper">PAPER</span>` : ""}${chip}</div>
      <div class="sec">${esc(c.symbol || "–")} · Solana${ageH != null ? ` · ${ageH}h old` : ""}</div>
      <div class="big num" style="margin-top:10px">${c.price == null ? "–" : "$" + Number(c.price).toPrecision(4)}</div>
      ${since != null ? `<div class="${since >= 0 ? "green" : "red"}">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
      <div class="chart-wrap"><canvas class="candles" id="candles"></canvas></div>
      <div class="stats">
        <div class="stat"><div class="k">Market cap</div><div class="v">n/a</div></div>
        <div class="stat"><div class="k">Liquidity</div><div class="v">${usd(st.liquidityUsd)}</div></div>
        <div class="stat"><div class="k">24h volume</div><div class="v">n/a</div></div>
        <div class="stat"><div class="k">Holders</div><div class="v">${st.holders == null ? "n/a" : Number(st.holders).toLocaleString("en-US")}</div></div>
      </div>
      ${pos ? `<div class="section-h"><span>Your position · ${money(pos.size_usd)} in · Executor</span></div>
        <div class="exitcard"><div class="kv"><span class="sec">Stop line</span><span class="red">${c.exit_lines && c.exit_lines.stop != null ? "$" + Number(c.exit_lines.stop).toPrecision(4) : "–"}</span></div>
        <div class="kv"><span class="sec">Trail line</span><span class="green">${c.exit_lines && c.exit_lines.trail != null ? "$" + Number(c.exit_lines.trail).toPrecision(4) : "not on yet"}</span></div>
        <div class="kv"><span class="sec">Time left to timeout</span><span>${left || "–"}</span></div></div>` : ""}
      ${ext(c.coin_url, pos ? "Sell on FOMO" : "Buy on FOMO", "btn " + (pos ? "red" : "green"))}</div>`;
    DeskChart.candles($("candles"), c.candles || [], pos ? exitLine : null);
  }

  // ---------------------------------------------------------------- ACCOUNT
  // STEP 10 public names/labels; values still read from internal trading keys (aliases).
  // [internalKey, publicLabel, unit, transform?]  transform "abs" = show positive drop for flush.
  const GROUPS = {
    scanner: [
      ["min_liquidity_usd", "min_liquidity_usd", "$"],
      ["max_top10_pct", "max_top10_pct", "%"],
      ["max_h1_change_pct", "max_h1_change_pct", "%"],
      ["waiting_room_poll_s", "poll_s", "s"],
      ["min_pool_age_min", "min_pool_age_min", "min"],
      ["waiting_room_max_min", "max_wait_min", "min"],
      ["copycat_h24_pct", "runner_h24_pct", "%"],
    ],
    auditor: [
      ["max_dev_pct", "max_dev_pct", "%"],
      ["max_top10_pct", "max_top10_pct", "%"],
      ["min_lp_burned_or_locked_pct", "min_lp_locked_pct", "%"],
      ["min_pool_age_min", "min_pool_age_min", "min"],
      ["max_bundled", "max_bundled", ""],
      ["max_delegate_accounts", "max_delegated_accounts", ""],
      ["source_retries", "retries", ""],
    ],
    analyst: [
      ["gate_alive_6h", "min_alive_6h", ""],
      ["gate_organic", "min_organic", ""],
      ["gate_chase", "max_chase", ""],
      ["gate_score", "min_score", ""],
      ["http_timeout_s", "timeout_s", "s"],
      ["rules_alive_volume_h1", "alive_volume_h1", "$"],
      ["rules_organic_buys_h1", "organic_buys_h1", ""],
      ["rules_organic_bundled_factor", "bundled_penalty", "×"],
      ["rules_flush_m5_pct", "flush_drop_m5_pct", "%", "abs"],
      ["rules_chase_h1_pct", "chase_h1_pct", "%"],
    ],
    executor: [
      ["size_stack_pct", "stack_pct", "% of stack"],
      ["size_max_pool_liq_pct", "max_pool_pct", "%"],
      ["min_size_usd", "min_ticket_usd", "$"],
      ["recheck_liq_drop_pct", "recheck_liq_drop_pct", "%"],
      ["recheck_price_run_pct", "recheck_price_up_pct", "%"],
      ["live_missed_min", "confirm_window_min", "min"],
    ],
    risk: [
      ["poll_s", "poll_s", "s"],
      ["stop_pct", "stop_pct", "%"],
      ["trail_on_pct", "trail_start_pct", "%"],
      ["trail_giveback_pct", "trail_pct", "%"],
      ["timeout_h", "timeout_h", "h"],
      ["timeout_min_gain_pct", "timeout_min_gain_pct", "%"],
      ["live_sold_repush_min", "confirm_window_min", "min"],
    ],
  };
  function settingRow(key, label, unit, v, transform) {
    let shown = v;
    if (transform === "abs" && v != null) shown = Math.abs(Number(v));
    const val = shown == null ? "" : shown;
    const max = shown == null ? 100 : Math.max(Math.abs(shown) * 3, 1);
    const min = 0;
    const stepv = Math.abs(shown) < 2 && shown % 1 !== 0 ? 0.01 : 1;
    return `<div class="setting"><div class="top"><span>${esc(label)}</span><span class="sec">${esc(unit)}</span></div>
      <div style="display:flex;gap:10px;align-items:center"><input type="range" min="${min}" max="${max}" step="${stepv}" value="${val}" disabled aria-label="${esc(label)}">
      <input type="number" value="${val}" disabled aria-label="${esc(label)} value"></div></div>`;
  }
  function renderAccount() {
    built = null;
    if (!S.loaded) { view.innerHTML = `<div class="page">${'<div class="sk row-sk"></div>'.repeat(8)}</div>`; return; }
    const acc = S.account || {}, set = S.settings || {}, tr = set.trading || {};
    const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
    view.innerHTML = `<div class="page">
      <div class="group-h">Mode</div>
      <div class="group"><div class="row"><div class="main"><div class="t">Trading mode</div><div class="s">LIVE asks you to type LIVE (rule in STEP 11)</div></div>
        <div class="seg">${["PAPER", "LIVE"].map(m => `<button data-act="mode" data-mode="${m}" class="${acc.mode === m ? "on" : ""}">${m}</button>`).join("")}</div></div>
        <div class="row" id="live-confirm" hidden><input class="field" id="live-input" placeholder="LIVE" style="width:120px" autocapitalize="characters">
          <button class="smallbtn" data-act="liveConfirm">Confirm</button></div>
        <div class="row"><div class="main"><div class="t">Stack</div><div class="s">${acc.mode === "LIVE" ? "Set with “stack N”" : "PAPER balance (default paper_start_stack $200)"}</div></div>
          <input class="field" value="${acc.stack == null ? "" : esc(acc.stack)}" placeholder="not set" disabled></div></div>
      <div class="group">
        ${acc.profile_url ? `<div class="row">${ext(acc.profile_url, `<div class="main"><div class="t">Your FOMO profile</div><div class="s">@${esc(acc.handle)}</div></div>`, "main")}<span class="ter">›</span></div>` : ""}
        <div class="row link" data-act="invite"><div class="main"><div class="t">Invite a friend</div><div class="s">Share your FOMO invite link</div></div><span class="ter">›</span></div></div>
      <div class="group-h">Notifications</div>
      <div class="group"><div class="row"><div class="main"><div class="t">Discord</div><div class="s">${(S.state || {}).notifier === "discord" ? "Connected" : "Not connected"}</div></div>
        <span class="status-dot ${(S.state || {}).notifier === "discord" ? "running" : ""}"></span></div>
        <div class="row"><div class="main"><div class="t">Send test push</div><div class="s">Not available from the app on Plan B (no write path)</div></div></div>
        ${standalone ? `<div class="row"><div class="main"><div class="t">Enable notifications</div><div class="s">Plan B has no /api/push, so there's no web push here. Pushes go to Discord.</div></div></div>` : ""}</div>
      <div class="group-h">Desk</div>
      <div class="group">
        <div class="row"><div class="main"><div class="t">below_min</div><div class="s">bump or skip when ticket under min</div></div><span class="sec">${esc(set.below_min || "bump")}</span></div>
        <div class="row"><div class="main"><div class="t">paper_start_stack</div><div class="s">PAPER night starting stack</div></div><span class="sec">${set.paper_start_stack == null ? "200" : "$" + Number(set.paper_start_stack).toFixed(2)}</span></div>
        <div class="row"><div class="main"><div class="t">report_time</div><div class="s">Europe/Amsterdam</div></div><span class="sec">${esc(set.report_time || "08:00")}</span></div>
        <div class="row"><div class="main"><div class="t">push_rejects</div></div><span class="sec">${set.push_rejects ? "true" : "false"}</span></div>
        <div class="row"><div class="main"><div class="t">fees_ref_discount</div></div><span class="sec">${set.fees_ref_discount == null ? "0.1" : esc(set.fees_ref_discount)}</span></div>
        <div class="row"><div class="main"><div class="t">Analyst mode</div></div><span class="sec">${esc(set.analyst_mode || "–")}</span></div>
        <div class="row"><div class="main"><div class="t">Notifier</div></div><span class="sec">${esc(set.notifier || "–")}</span></div>
        <div class="row"><div class="main"><div class="t">rpc_url</div></div><span class="sec" style="max-width:55%;overflow:hidden;text-overflow:ellipsis">${esc(set.rpc_url || "–")}</span></div></div>
      <p class="note">Settings are read-only in the app on Plan B. Change them in the desk chat (STEP 9).</p>
      ${AGENTS.map(a => `<div class="group-h" id="set-${a}">${NAMES[a]}</div><div class="group">
        ${a === "auditor" ? `<div class="row"><div class="main"><div class="t">enabled</div><div class="s">Take apart before buying</div></div><button class="switch-hit" data-act="auditToggle"><span class="switch ${set.auditor_enabled === false ? "" : "on"}"></span></button></div>` : ""}
        ${a === "analyst" ? `<div class="row"><div class="main"><div class="t">mode</div></div><span class="sec">${esc(set.analyst_mode || "jev")}</span></div>` : ""}
        ${GROUPS[a].map(([k, l, u, t]) => settingRow(k, l, u, tr[k], t)).join("")}</div>`).join("")}
    </div>`;
  }

  // ---------------------------------------------------------------- search (coins the desk already knows)
  function knownCoins() {
    const m = new Map();
    AGENTS.forEach(a => (S.decisions[a] || []).forEach(d => d.mint && !m.has(d.mint) && m.set(d.mint, { mint: d.mint, name: d.name, symbol: d.symbol, url: d.coin_url })));
    ((S.activity && S.activity.items) || []).forEach(i => i.mint && !m.has(i.mint) && m.set(i.mint, { mint: i.mint, name: i.title.replace(/^\w+ /, ""), url: i.coin_url }));
    return [...m.values()];
  }
  function renderSearch() {
    const q = $("search-input").value.trim().toLowerCase(), out = $("search-results");
    if (!q) { out.innerHTML = ""; return; }
    const hits = knownCoins().filter(c => [c.name, c.symbol, c.mint].some(x => x && x.toLowerCase().includes(q))).slice(0, 20);
    out.innerHTML = hits.length ? hits.map(c => `<li class="row link" data-s="${esc(c.mint)}" data-url="${esc(c.url || "")}"><div class="main"><div class="t">${esc(c.name || c.mint.slice(0, 6) + "…")}</div>
      <div class="s">${esc(c.symbol || "")} ${esc(c.mint)}</div></div></li>`).join("") : `<li class="empty">No coin the desk knows matches</li>`;
  }
  $("search-results").onclick = e => {
    const r = e.target.closest("[data-s]"); if (!r) return;
    $("search-bar").hidden = true; $("search-input").value = ""; $("search-results").innerHTML = "";
    openScreen({ type: "coin", mint: r.dataset.s, url: r.dataset.url });
  };

  render();
  poll();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
