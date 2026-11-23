/* Consent banner + Google Tag Manager (loaded only after "Accept"). Author: Kishan Tiwari */
(() => {
  const KEY = "lithopt-analytics", ID = "GTM-KDBH7657";
  let choice = null;
  try { choice = localStorage.getItem(KEY); } catch (e) {}
  const load = () => {
    window.dataLayer = window.dataLayer || [];
    dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtm.js?id=" + ID;
    document.head.appendChild(s);
  };
  if (choice === "yes") load();
  const show = () => {
    if (document.getElementById("consentBanner")) return;
    const b = document.createElement("div");
    b.id = "consentBanner"; b.setAttribute("role", "region"); b.setAttribute("aria-label", "Cookie consent");
    b.style.cssText = "position:fixed;left:1rem;right:1rem;bottom:" + (innerWidth < 768 ? "5rem" : "1rem") + ";z-index:9999;max-width:34rem;margin:0 auto;padding:0.9rem 1rem;" +
      "background:var(--surface);color:inherit;border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);font-size:0.9rem";
    b.innerHTML = '<p style="margin:0 0 0.7rem">LithoPT can use Google Analytics cookies to count visits. Your mineral data never leave your browser. ' +
      '<a href="https://github.com/kishangeo/LithoPT#privacy" target="_blank" rel="noopener">Privacy</a></p>' +
      '<div style="display:flex;gap:0.5rem;justify-content:flex-end"><button class="btn btn-secondary" data-c="no">Decline</button>' +
      '<button class="btn btn-primary" data-c="yes">Accept</button></div>';
    b.addEventListener("click", (e) => {
      const c = e.target.dataset && e.target.dataset.c;
      if (!c) return;
      try { localStorage.setItem(KEY, c); } catch (err) {}
      b.remove();
      if (c === "yes" && !window.google_tag_manager) load();
      if (c === "no" && window.google_tag_manager) location.reload();   // unload GTM
    });
    document.body.appendChild(b);
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (!choice) show();
    const l = document.getElementById("cookieSettings");
    if (l) l.addEventListener("click", (e) => { e.preventDefault(); show(); });
  });
})();
