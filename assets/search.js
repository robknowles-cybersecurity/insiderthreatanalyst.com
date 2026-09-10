/* PE-168: site search. Lazy-loads the vendored Pagefind UI (/pagefind/) on
   first open, so an ordinary page view pays for nothing beyond this file.
   Keyboard: "/" or Ctrl/Cmd+K opens, Escape closes. All assets are
   same-origin; nothing is fetched from a third party.

   PE-247: also owns anchor navigation for the whole site. It is the one script
   the shared nav puts on every page, so the hash hook lives here rather than in
   a new asset that would mean regenerating all 21 navs. Two jobs:
     - close the overlay when a result is clicked, because a result that points
       at THIS page changes only the hash: nothing navigates, and without this
       the panel stays up covering the section it just jumped to;
     - scroll to location.hash once the target exists. clusters, framework and
       matrix paint their sections from inline data, so the browser can run its
       own fragment scroll before the element is in the document — the anchors
       are dead on exactly the pages the deep links matter most on.

   PE-248: term highlighting on the landing page. Pagefind's core appends
   ?highlight=<term> to every result URL when highlightParam is set (see
   loadUI), and the vendored pagefind-highlight.js wraps those terms in <mark>
   here. Both are the same-origin vendored copies; no new origin, no inline
   script, no CSP change. The landing sequence is ONE hook, not two: the PE-247
   observer that waits for a client-rendered anchor now also waits for the
   marks, and the mark scroll always happens after the anchor scroll.
   No new origins, no inline script, no CSP change. */
(function () {
  "use strict";

  var overlay = null, uiLoaded = false, uiLoading = false, lastFocus = null;

  /* Must match the highlightParam handed to PagefindUI below: the core writes
     this key into result URLs, the highlighter reads it back off the landing
     page. One constant so they cannot drift. */
  var HL_PARAM = "highlight";

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "ita-search-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="ita-search-panel" role="dialog" aria-modal="true" aria-label="Site search">' +
      '<div class="ita-search-head"><span class="ita-search-title">Search the site</span>' +
      '<button type="button" class="ita-search-close" aria-label="Close search">Esc</button></div>' +
      '<div class="ita-search-status" hidden></div>' +
      '<div id="ita-search-ui"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector(".ita-search-close").addEventListener("click", close);
    /* Capture phase: run before Pagefind UI sees the click, and before the
       browser acts on the href, so the panel is already down when the jump
       happens. Same-page hash links do not reload, so nothing else would
       close it. */
    overlay.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !overlay.contains(a)) return;
      close();
      var href = a.getAttribute("href") || "";
      var hash = href.indexOf("#") === -1 ? "" : href.slice(href.indexOf("#"));
      var base = href.slice(0, href.length - hash.length);
      /* PE-248: result hrefs now carry ?highlight=… , so the query has to be
         split off before the paths can be compared — otherwise every same-page
         result looks like a different page and reloads it. */
      var qi = base.indexOf("?");
      var search = qi === -1 ? "" : base.slice(qi);
      if (qi !== -1) base = base.slice(0, qi);
      /* Only intercept when the link targets the page we are already on;
         otherwise let the browser navigate and the load-time hook take over. */
      var here = location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "");
      var there = base.replace(/^https?:\/\/[^/]+/, "").replace(/\/index\.html$/, "/").replace(/\/$/, "");
      if (base !== "" && there !== here) return;
      /* Nothing to change on this page: let the browser have the click. */
      if (!hash && !search) return;
      /* A modified click is the user asking for a new tab. Leave it alone. */
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      /* The href differs from the current URL only in the query and the hash,
         so navigating would be a full reload of the page already on screen.
         Rewrite the address instead and re-run the landing sequence. */
      e.preventDefault();
      try { history.replaceState(null, "", location.pathname + search + hash); } catch (err) { }
      unmark();
      hlTerms = readHighlightTerms();
      land(hash);
    }, true);
    /* PE-248: Pagefind's Clear button empties the input and then suppresses
       itself, which drops focus to <body> — the next keystroke goes nowhere.
       Bubble phase and a task tick, so this runs after the UI's own handler and
       after Svelte has applied the DOM update it queues; focusing before that
       would be undone by the button's removal. */
    overlay.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".pagefind-ui__search-clear") : null;
      if (b && overlay.contains(b)) setTimeout(focusInput, 0);
    });
  }

  function status(msg) {
    var el = overlay.querySelector(".ita-search-status");
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function focusInput() {
    var input = overlay.querySelector("#ita-search-ui input");
    if (input) input.focus();
  }

  function loadUI() {
    if (uiLoaded || uiLoading) return;
    uiLoading = true;
    status("Loading search…");
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/pagefind/pagefind-ui.css";
    document.head.appendChild(css);
    var s = document.createElement("script");
    s.src = "/pagefind/pagefind-ui.js";
    s.onload = function () {
      try {
        new PagefindUI({
          element: "#ita-search-ui",
          bundlePath: "/pagefind/",
          showImages: false,
          showSubResults: true,
          autofocus: true,
          /* Not a documented PagefindUI option: the UI strips the keys it owns
             and forwards whatever is left to pagefind.options(), where the core
             uses it in processedUrl() to stamp each term onto the result and
             sub-result URLs, ahead of the anchor. */
          highlightParam: HL_PARAM
        });
        uiLoaded = true;
        status("");
        focusInput();
      } catch (err) {
        status("Search failed to start — hard-refresh and try again.");
      }
    };
    s.onerror = function () {
      uiLoading = false;
      status("Search assets did not load. Check your connection and try again.");
    };
    document.head.appendChild(s);
  }

  function open() {
    if (!overlay) buildOverlay();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    var btn = document.getElementById("ita-search-open");
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (uiLoaded) focusInput(); else loadUI();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    var btn = document.getElementById("ita-search-open");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* --- PE-247/PE-248: landing on an anchor, then on the term ------------- */

  var HASH_WAIT_MS = 4000;   /* bounded: a target that never appears must not
                                leave an observer running for the session. */
  var HL_TRIES = 6;          /* the explorer pages mutate dozens of times while
                                they render; marking the page on every one of
                                those would be the jank this ticket removes. */
  var pending = null;
  var hlTerms = null;        /* the ?highlight= terms for THIS page view. */
  var Highlighter = null;    /* pagefind-highlight.js default export, once in. */
  var hlAsked = false;

  function cancelPending() {
    if (!pending) return;
    if (pending.obs) pending.obs.disconnect();
    clearTimeout(pending.timer);
    pending = null;
  }

  /* The sticky nav wraps to two rows on narrow viewports, so its height is not
     a constant. Publish the measured value; search.css carries a fallback so a
     failure here degrades to a reasonable guess rather than to zero. */
  function syncAnchorOffset() {
    var nav = document.querySelector(".site-nav");
    if (!nav) return;
    var h = Math.round(nav.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--ita-anchor-offset", (h + 8) + "px");
  }

  function readHighlightTerms() {
    if (!window.URLSearchParams) return null;
    var got;
    try { got = new URLSearchParams(location.search).getAll(HL_PARAM); }
    catch (err) { return null; }
    return got && got.length ? got : null;
  }

  /* Load the vendored highlighter on demand — only a visitor arriving from a
     search result ever pays for it. Dynamic import() of a same-origin module is
     script-src 'self'; nothing here needs a CSP change. */
  function wantHighlighter() {
    if (hlAsked) return;
    hlAsked = true;
    import("/pagefind/pagefind-highlight.js").then(function (mod) {
      Highlighter = mod && mod.default;
      /* The module can resolve after the last DOM mutation, so the observer
         may never fire again. Poke the sequence that is already waiting. */
      if (pending && pending.look) pending.look();
    })["catch"](function () { /* no highlight; the anchor jump still works */ });
  }

  function marks(root) {
    return (root || document).querySelectorAll("main mark.pagefind-highlight");
  }

  /* Unwrap our own marks, so re-landing on the same page for a new query does
     not stack <mark> inside <mark>. Only our class is touched; a <mark> written
     by a page author is left alone. */
  function unmark() {
    var ms = marks(), i, m, p;
    for (i = 0; i < ms.length; i++) {
      m = ms[i]; p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      if (p.normalize) p.normalize();
    }
  }

  /* The first mark at or after the anchor, so a section deep link is not
     yanked back to an earlier match on the same page. */
  function firstMark(anchorEl) {
    var ms = marks(), i;
    if (!ms.length) return null;
    if (!anchorEl || !anchorEl.compareDocumentPosition) return ms[0];
    for (i = 0; i < ms.length; i++) {
      if (anchorEl === ms[i] ||
          (anchorEl.compareDocumentPosition(ms[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return ms[i];
    }
    return ms[0];
  }

  function landAnchor(el) {
    syncAnchorOffset();
    el.scrollIntoView();
    /* Move keyboard focus too, so the deep link is usable without a mouse.
       tabindex is set only if the element cannot already take focus. */
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
  }

  /* Already on screen? Then the anchor scroll put the reader where they need to
     be and moving again would only push the heading out of view. */
  function landMark(m) {
    var r = m.getBoundingClientRect();
    var top = 0;
    try { top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0; }
    catch (err) { }
    if (r.top >= top && r.bottom <= (window.innerHeight || document.documentElement.clientHeight))
      return;
    try { m.scrollIntoView({ block: "center" }); } catch (err) { m.scrollIntoView(); }
  }

  /* ONE landing sequence, driven by ONE observer. The anchor is resolved first
     and only once; the marks are applied and scrolled to afterwards, both of
     them retried until the client-rendered pages (clusters, framework, matrix)
     have painted the section the result pointed at. */
  function land(hash) {
    cancelPending();
    var id = hash && hash.charAt(0) === "#" ? hash.slice(1) : (hash || "");
    if (id) { try { id = decodeURIComponent(id); } catch (err) { /* keep raw */ } }
    if (hlTerms) wantHighlighter();
    if (!id && !hlTerms) return;

    var landed = false, tries = 0, anchorEl = null;

    function attempt() {
      if (id && !landed) {
        anchorEl = document.getElementById(id);
        if (!anchorEl) return false;
        landAnchor(anchorEl);
        landed = true;
      }
      if (!hlTerms) return true;
      if (!Highlighter) return false;
      var m = firstMark(anchorEl);
      if (!m) {
        if (++tries > HL_TRIES) return true;   /* the term is not on this page */
        new Highlighter({
          highlightParam: HL_PARAM,
          markContext: "main",   /* the nav and footer are not the content */
          addStyles: false       /* styled in ita.css, not by an injected tag */
        });
        m = firstMark(anchorEl);
        if (!m) return false;
      }
      landMark(m);
      return true;
    }

    if (attempt()) return;
    if (!window.MutationObserver) return;

    var state = { obs: null, timer: 0, look: null };
    pending = state;
    state.look = function () {
      if (pending !== state) return;
      if (attempt()) cancelPending();
    };
    state.obs = new MutationObserver(state.look);
    state.obs.observe(document.documentElement, { childList: true, subtree: true });
    state.timer = setTimeout(function () { if (pending === state) cancelPending(); }, HASH_WAIT_MS);
  }

  function jumpToHash(hash) { land(hash); }

  window.addEventListener("hashchange", function () { jumpToHash(location.hash); });

  function isTyping(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { close(); return; }
    var combo = ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) ||
                (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target));
    if (combo && (!overlay || overlay.hidden)) { e.preventDefault(); open(); }
  });

  function wire() {
    var btn = document.getElementById("ita-search-open");
    if (btn) btn.addEventListener("click", open);
    syncAnchorOffset();
    hlTerms = readHighlightTerms();
    if (location.hash || hlTerms) land(location.hash);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
