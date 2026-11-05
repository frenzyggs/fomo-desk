// Plan B client: polls static JSON instead of SSE. No secrets in source:
// DATA_PATH (d) and APP_TOKEN (t) come from the URL hash once, then localStorage.
(function () {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("d")) localStorage.setItem("desk_d", h.get("d"));
  if (h.get("t")) localStorage.setItem("desk_t", h.get("t"));
  if (location.hash) history.replaceState(null, "", location.pathname + location.search); // drop secrets from URL bar
  const d = localStorage.getItem("desk_d");
  const $ = id => document.getElementById(id);
  const base = new URL("./", location.href); // works at domain root or a project subpath
  const url = f => new URL("d/" + encodeURIComponent(d) + "/" + f + "?_=" + Date.now(), base);

  async function get(f) { const r = await fetch(url(f), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); }

  async function poll() {
    if (!d) { $("conn").textContent = "Open the private link once to connect"; return; }
    try {
      const s = await get("state.json");
      const age = Math.round(Date.now() / 1000 - s.heartbeat);
      $("conn").textContent = age < 60 ? "Live" : "Stale (" + age + "s)";
      $("conn").className = "pill " + (age < 60 ? "ok" : "bad");
      $("hb").textContent = new Date(s.heartbeat * 1000).toLocaleTimeString() + " (" + age + "s ago)";
      $("mode").textContent = s.mode; $("notifier").textContent = s.notifier; $("handle").textContent = s.handle;
      $("agents").textContent = Object.entries(s.agents || {}).map(([k, v]) => k + ":" + v).join("  ");
      const [c, a] = await Promise.all([get("chart.json"), get("activity.json")]);
      DeskChart.draw($("chart"), c.points);
      $("activity").innerHTML = "";
      (a.items || []).slice().reverse().forEach(it => {
        const li = document.createElement("li");
        li.textContent = new Date(it.ts * 1000).toLocaleTimeString() + "  " + it.text;
        $("activity").appendChild(li);
      });
    } catch (e) { $("conn").textContent = "Cannot reach desk data"; $("conn").className = "pill bad"; }
  }
  DeskChart.draw($("chart"), []);
  poll(); setInterval(poll, 15000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
