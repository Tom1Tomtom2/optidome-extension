"use strict";

// Shows the tips on ChatGPT. Runs in the extension's isolated world, after
// rules.js and dome.js (same scope).
//
// Two sources of tips:
// - the draft, read in the message box after a pause in typing
//   (secret key, sensitive data, references, text already pasted);
// - the service worker, after a send (long conversation, thanks on its own).
//
// Shared rules: one tip at a time, one per conversation except sensitive data,
// "Later" pushes a tip back seven days and three times stop it. Sending is
// never blocked. Focus only moves when the person clicks a button that writes
// in the message box.

(() => {
  const BOX = '[contenteditable="true"][role="textbox"], textarea';
  const PAUSE_MS = 1000;
  const PASTE_MIN = 2000;
  const DAY_MS = 86400000;

  // The text follows Chrome's language (_locales), English by default.
  const t = (key, ...substitutions) => {
    try {
      return chrome.i18n.getMessage(key, substitutions.map(String));
    } catch (error) {
      return ""; // extension detached
    }
  };

  // --- The cards -------------------------------------------------------------
  //
  // No technical terms on screen: no "tokens", no energy figures.
  // "free": no limit per conversation, no lasting "Later".

  const CARDS = {
    key: () => ({
      free: true,
      icon: "shield",
      category: t("catPrivacy"),
      title: t("keyTitle"),
      text: t("keyText"),
      primary: [t("keyRemove"), "replace"],
      secondary: [t("keep"), "close"],
    }),
    data: ({ kind, excerpt }) => ({
      free: true,
      icon: "shield",
      category: t("catPrivacy"),
      title: t(`dataTitle_${kind}`),
      text: t(kind === "emails" ? "dataTextMany" : "dataTextOne"),
      primary: excerpt ? [t("replaceWithExample"), "replace"] : [t("gotIt"), "close"],
      secondary: excerpt ? [t("keep"), "close"] : null,
    }),
    references: () => ({
      icon: "book",
      category: t("catReliability"),
      title: t("refTitle"),
      text: t("refText"),
      primary: [t("gotIt"), "close"],
      secondary: [t("dontShowAgain"), "stop"],
    }),
    alreadyPasted: () => ({
      icon: "copy",
      category: t("catLongConversation"),
      title: t("pastedTitle"),
      text: t("pastedText"),
      primary: [t("gotIt"), "close"],
    }),
    long: () => ({
      icon: "layers",
      category: t("catLongConversation"),
      title: t("longTitle"),
      text: t("longText"),
      bars: true,
      primary: [t("prepareSummary"), "summarize"],
      secondary: [t("later"), "snooze"],
      note: t("longNote"),
    }),
    thanks: () => ({
      icon: "bubble",
      category: t("catDidYouKnow"),
      title: t("thanksTitle"),
      text: t("thanksText"),
      primary: [t("gotIt"), "close"],
      secondary: [t("dontShowAgain"), "stop"],
    }),
    // shortcut: the French menu name "Gestion des données" was never seen on screen, check before publishing.
    training: () => ({
      free: true,
      icon: "dome",
      category: t("catWelcome"),
      title: t("trainingTitle"),
      text: t("trainingText"),
      primary: [t("gotIt"), "close"],
      note: t("trainingNote"),
    }),
    habit: ({ title, text, count }) => ({
      free: true,
      icon: "check",
      category: t("catGoodHabit"),
      title,
      text,
      progress: count,
    }),
  };

  // --- Storage ---------------------------------------------------------------
  //
  // When the extension is reloaded, chrome.* disappears under this script's
  // feet: we stay quiet rather than show an error on the site.

  async function load(key, fallback) {
    try {
      const values = await chrome.storage.local.get(key);
      return values[key] ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  async function save(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      // Extension detached: the setting is lost, the page keeps going.
    }
  }

  // The month's good habits, shown by the popup. Returns the month's total.
  async function countHabit(type) {
    const month = new Date().toISOString().slice(0, 7);
    const habits = await load("habits", {});
    const ofMonth = (habits[month] ??= {});
    ofMonth[type] = (ofMonth[type] ?? 0) + 1;
    await save("habits", habits);
    return Object.values(ofMonth).reduce((sum, n) => sum + n, 0);
  }

  // --- Current conversation --------------------------------------------------
  //
  // The first send moves the address from "/" to "/c/<id>": it is the same
  // conversation. Any other change opens a new one.
  // shortcut: page memory only, a reload resets the counters.

  let path = location.pathname;
  let shown = new Set();
  let pastes = new Set();
  let longIn = null; // conversation where the "long" tip was shown

  function followConversation() {
    if (location.pathname === path) return;
    const before = path;
    if (path !== "/") {
      shown = new Set();
      pastes = new Set();
    }
    path = location.pathname;
    // The "long" tip was followed: the person starts over in a new conversation.
    if (longIn && before === longIn && path === "/") {
      longIn = null;
      countHabit("newConversation").then((count) =>
        show("habit", { title: t("newConvTitle"), text: t("newConvText"), count }, "habit")
      );
    }
  }

  // --- Drawings --------------------------------------------------------------

  const NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    shield: ["M8 1.5 2.5 3.5v4c0 3.2 2.3 5.7 5.5 7 3.2-1.3 5.5-3.8 5.5-7v-4z"],
    layers: ["M8 2 1.5 5.5 8 9l6.5-3.5z", "m1.5 8.5 6.5 3.5 6.5-3.5", "m1.5 11.5 6.5 3.5 6.5-3.5"],
    book: ["M2.5 3h4A1.5 1.5 0 0 1 8 4.5V14a1.5 1.5 0 0 0-1.5-1.5h-4z", "M13.5 3h-4A1.5 1.5 0 0 0 8 4.5V14a1.5 1.5 0 0 1 1.5-1.5h4z"],
    bubble: ["M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"],
    copy: ["M5.5 5.5h8v8h-8z", "M2.5 10.5v-8h8"],
    check: ["m3.5 8.5 3 3 6-6.5"],
    cross: ["m4 4 8 8M12 4l-8 8"],
  };

  function svg(attributes, paths) {
    const s = document.createElementNS(NS, "svg");
    for (const [name, value] of Object.entries({ "aria-hidden": "true", ...attributes })) s.setAttribute(name, value);
    for (const p of paths) {
      const element = document.createElementNS(NS, "path");
      for (const [name, value] of Object.entries(p)) element.setAttribute(name, value);
      s.append(element);
    }
    return s;
  }

  const icon = (name, size = 16) =>
    svg(
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" },
      ICONS[name].map((d) => ({ d }))
    );

  const dome = (size) =>
    svg({ width: size, height: size, viewBox: DOME_VIEWBOX }, [
      { d: DOME_PATH, fill: "currentColor", stroke: "currentColor", "stroke-width": "1.1", "stroke-linejoin": "round" },
      { d: DOME_LINE, fill: "none", stroke: "#FF6D00", "stroke-width": "4.572", "stroke-linecap": "round" },
    ]);

  function el(tag, className, ...children) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    e.append(...children.filter((child) => child != null));
    return e;
  }

  // --- The card --------------------------------------------------------------

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  // Built element by element: ChatGPT may enforce Trusted Types, which refuse
  // innerHTML.
  // shortcut: system font in the page (loading Onest in ChatGPT would mean exposing it to the site), Onest stays in the popup.
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .card {
      --bg: #FFFFFF; --border: #ECEBE8; --ink: #131312; --soft: #5A5955; --line: #D9D8D3;
      --badge: #FFF1E6; --icon: #B54D00; --button: #131312; --button-text: #FFFFFF;
      --bar: #D9D8D3; --shadow: rgba(19, 19, 18, 0.10);
      position: fixed; right: 16px; bottom: 112px; z-index: 2147483000;
      width: 360px; max-width: calc(100vw - 32px); box-sizing: border-box;
      padding: 16px 16px 14px; display: flex; flex-direction: column; gap: 10px;
      background: var(--bg); color: var(--ink);
      border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 10px 30px var(--shadow);
      font: 13.5px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .card[data-theme="dark"] {
      --bg: #26262A; --border: #38383E; --ink: #ECEBE8; --soft: #C9C8C2; --line: #45454C;
      --badge: rgba(255, 109, 0, 0.16); --icon: #FF9A4D; --button: #FFFFFF; --button-text: #131312;
      --bar: #45454C; --shadow: rgba(0, 0, 0, 0.35);
    }
    .card[hidden] { display: none; }
    .header { display: flex; align-items: center; gap: 10px; }
    .badge { width: 28px; height: 28px; flex-shrink: 0; border-radius: 999px; background: var(--badge); color: var(--icon); display: flex; align-items: center; justify-content: center; }
    .badge.filled { background: #FF6D00; color: #131312; }
    .badge.logo { background: transparent; color: var(--ink); }
    .category { flex-grow: 1; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); }
    .close { width: 28px; height: 28px; border: none; background: transparent; color: var(--soft); border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
    .title { font-size: 15.5px; font-weight: 600; line-height: 1.35; }
    p { margin: 0; color: var(--soft); }
    .bars { display: flex; align-items: flex-end; gap: 5px; height: 40px; padding: 2px 0; }
    .bars span { width: 22px; border-radius: 3px; background: var(--bar); }
    .bars span:last-child { background: #FF6D00; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
    .primary { border: none; background: var(--button); color: var(--button-text); font: inherit; font-size: 13px; font-weight: 600; padding: 9px 15px; border-radius: 999px; cursor: pointer; }
    .secondary { border: 1px solid var(--line); background: transparent; color: var(--soft); font: inherit; font-size: 13px; font-weight: 500; padding: 8px 14px; border-radius: 999px; cursor: pointer; }
    button:focus-visible { outline: 2px solid #FF6D00; outline-offset: 2px; }
    .note { font-size: 11.5px; line-height: 1.45; color: var(--soft); }
    .progress { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--soft); }
    .dots { display: flex; gap: 4px; }
    .dots span { width: 18px; height: 6px; border-radius: 3px; background: var(--bar); }
    .dots span.full { background: #FF6D00; }`;
  const card = el("div", "card");
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.hidden = true;
  shadow.append(style, card);
  let displayed = null; // { id, origin, values }

  // ChatGPT puts a "dark" or "light" class on the page; otherwise, the system.
  function isDark() {
    const classes = document.documentElement.classList;
    if (classes.contains("dark")) return true;
    if (classes.contains("light")) return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function hide() {
    card.hidden = true;
    displayed = null;
  }

  function button(className, [label, action]) {
    const b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", () => act(action));
    return b;
  }

  function draw(id, content) {
    const badge = el("div", "badge" + (content.icon === "check" ? " filled" : content.icon === "dome" ? " logo" : ""));
    badge.append(content.icon === "dome" ? dome(26) : icon(content.icon));
    const close = el("button", "close", icon("cross", 14));
    close.type = "button";
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", () => act(content.free ? "close" : "snooze"));

    let bars = null;
    if (content.bars) {
      bars = el("div", "bars");
      for (const height of [5, 8, 12, 17, 23, 30, 38]) {
        const bar = el("span");
        bar.style.height = `${height}px`;
        bars.append(bar);
      }
    }

    let progress = null;
    if (content.progress) {
      const dots = el("div", "dots");
      for (let i = 0; i < 5; i += 1) dots.append(el("span", i < content.progress ? "full" : ""));
      progress = el("div", "progress", dots, content.progress === 1 ? t("habitFirst") : t("habitNth", content.progress));
    }

    let actions = null;
    if (content.primary) {
      actions = el("div", "actions", button("primary", content.primary), content.secondary ? button("secondary", content.secondary) : null);
    }

    card.replaceChildren(
      ...[
        el("div", "header", badge, el("span", "category", content.category), close),
        el("div", "title", content.title),
        el("p", null, content.text),
        bars,
        progress,
        actions,
        content.note ? el("div", "note", content.note) : null,
      ].filter(Boolean)
    );
  }

  async function show(id, values = {}, origin = "send") {
    followConversation();
    if (!CARDS[id]) return;
    const content = CARDS[id](values);
    if (!content.free) {
      if (shown.size > 0) return; // one tip per conversation
      const snoozed = (await load("snoozes", {}))[id];
      if (snoozed && (snoozed.times >= 3 || snoozed.until > Date.now())) return;
      shown.add(id);
    }
    if (id === "long") longIn = location.pathname;
    draw(id, content);
    card.dataset.theme = isDark() ? "dark" : "light";
    displayed = { id, origin, values };
    if (!host.isConnected) document.documentElement.append(host);
    card.hidden = false;
  }

  // --- The buttons -----------------------------------------------------------

  async function act(action) {
    const { id, values } = displayed ?? {};
    hide();
    if (!id) return;

    if (action === "snooze" || action === "stop") {
      const snoozes = await load("snoozes", {});
      const times = action === "stop" ? 3 : (snoozes[id]?.times ?? 0) + 1;
      snoozes[id] = { times, until: Date.now() + 7 * DAY_MS };
      await save("snoozes", snoozes);
    } else if (action === "replace") {
      if (!replaceInBox(values.excerpt, values.example)) return;
      const count = await countHabit("dataRemoved");
      show("habit", {
        title: t("wellDone"),
        text: id === "key" ? t("keyRemovedText") : t("dataRemovedText"),
        count,
      }, "habit");
    } else if (action === "summarize") {
      writeInBox(t("summaryPrompt"));
    }
  }

  // Writes as if the person were typing: ChatGPT then keeps its draft up to
  // date (a direct change of the text would be ignored, then erased by the site).
  function replaceInBox(search, replacement) {
    const box = currentBox();
    if (!box || !search) return false;
    // Trap of 2026-10-22: changing the textarea's value (setRangeText) makes
    // the site inject the whole draft again. Selecting then "typing" works.
    if (box.tagName === "TEXTAREA") {
      const start = box.value.indexOf(search);
      if (start < 0) return false;
      box.focus();
      box.setSelectionRange(start, start + search.length);
      return document.execCommand("insertText", false, replacement);
    }
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.data.indexOf(search);
      if (start < 0) continue;
      box.focus();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + search.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand("insertText", false, replacement);
    }
    // shortcut: text split across two paragraphs is not found, the card closes without changing anything.
    return false;
  }

  function writeInBox(text) {
    const box = currentBox();
    if (!box) return;
    box.focus();
    if (box.tagName === "TEXTAREA") {
      box.setSelectionRange(box.value.length, box.value.length);
      document.execCommand("insertText", false, text);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, text);
  }

  // --- Draft -----------------------------------------------------------------

  let timer = null;
  let lastBox = null;

  const readBox = (box) => (box.tagName === "TEXTAREA" ? box.value : box.innerText) ?? "";

  // The box the person typed in last, otherwise the first visible one. Trap of
  // 2026-10-22: when signed out, ChatGPT keeps another hidden box before the
  // real one, and the first one found is not the right one.
  const currentBox = () =>
    (lastBox?.isConnected ? lastBox : null) ??
    [...document.querySelectorAll(BOX)].find((box) => box.offsetParent !== null) ??
    null;

  document.addEventListener(
    "input",
    (event) => {
      const box = event.target?.closest?.(BOX);
      if (!box) return;
      lastBox = box;
      // The tip on display was about the old text: remove it right away.
      if (displayed?.origin === "draft") hide();
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const tip = TipRules.tipForDraft(readBox(box));
          if (tip) show(tip.id, tip, "draft");
        } catch (error) {
          // A failing rule must never disturb typing.
        }
      }, PAUSE_MS);
    },
    true
  );

  // After sending, the box empties: a tip about the draft no longer applies.
  // The same observer sees conversation changes go by.
  new MutationObserver(() => {
    followConversation();
    if (displayed?.origin !== "draft" && displayed?.origin !== "paste") return;
    const box = currentBox();
    if (!box || readBox(box).trim() === "") hide();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  document.addEventListener(
    "paste",
    (event) => {
      if (!event.target?.closest?.(BOX)) return;
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (pasted.length < PASTE_MIN) return;
      followConversation();
      const mark = TipRules.fingerprint(pasted);
      // Separate origin: the paste also triggers an input, which must not
      // erase this tip right after it is shown.
      if (pastes.has(mark)) show("alreadyPasted", {}, "paste");
      pastes.add(mark);
    },
    true
  );

  // --- After sending, from the service worker --------------------------------

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.source !== "optidome-tip") return;
      show(message.id, message.values ?? {}, "send");
    });
  } catch (error) {
    // Extension detached.
  }

  // --- Only once, on the first visit -----------------------------------------

  setTimeout(async () => {
    if (displayed || (await load("trainingShown", false))) return;
    await save("trainingShown", true);
    show("training", {}, "welcome");
  }, 4000);
})();
