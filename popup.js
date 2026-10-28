"use strict";

// The popup: what to do now, the good habits, the month's figures, a tip.
// One screen, plus the settings. No technical terms on screen: token totals
// stay in the export.

const NS = "http://www.w3.org/2000/svg";
// The text follows Chrome's language (_locales), English by default; numbers
// and dates follow the same language.
const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions.map(String));
const LANG = chrome.i18n.getUILanguage();
const $ = (id) => document.getElementById(id);
const DAY_MS = 86400000;
const thisMonth = Usage.dateKey().slice(0, 7);

const HABITS = ["newConversation", "dataRemoved"];
const WEEKLY_TIPS = ["weeklyTip1", "weeklyTip2", "weeklyTip3", "weeklyTip4"];
// Same threshold as the "long conversation" tip (background.js).
const LONG_CONVERSATION_THRESHOLD = 30000;
// shortcut: Gemini and Le Chat addresses inferred from their ids, never opened on a signed-in account; check before publishing.
const CONVERSATION_URL = {
  chatgpt: (id) => `https://chatgpt.com/c/${id}`,
  claude: (id) => `https://claude.ai/chat/${id}`,
  gemini: (id) => `https://gemini.google.com/app/${id.replace(/^c_/, "")}`,
  mistral: (id) => `https://chat.mistral.ai/chat/${id}`,
};

let data = {};
let month = thisMonth;

function drawLogo() {
  for (const logo of document.querySelectorAll(".logo")) {
    logo.setAttribute("viewBox", DOME_VIEWBOX);
    for (const [d, attributes] of [
      [DOME_PATH, { fill: "currentColor", stroke: "currentColor", "stroke-width": "1.1", "stroke-linejoin": "round" }],
      [DOME_LINE, { fill: "none", stroke: "#FF6D00", "stroke-width": "4.572", "stroke-linecap": "round" }],
    ]) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, value);
      logo.append(path);
    }
  }
}

const monthName = (key) =>
  new Date(`${key}-15T12:00:00`).toLocaleDateString(LANG, key.startsWith(thisMonth.slice(0, 4)) ? { month: "long" } : { month: "long", year: "numeric" });
const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(LANG, { day: "numeric", month: "long", year: "numeric" });
const daysOf = (key) => Object.entries(data.journal ?? {}).filter(([day]) => day.startsWith(key));

// --- What to do now ---------------------------------------------------------

// The heaviest conversation of the last seven days, if it is too long.
function longestConversation() {
  const since = Usage.dateKey(new Date(Date.now() - 6 * DAY_MS));
  let best = null;
  for (const [key, tracked] of Object.entries(data.registry ?? {})) {
    const split = key.indexOf(":");
    const provider = key.slice(0, split);
    const id = key.slice(split + 1);
    if (!CONVERSATION_URL[provider] || id === "unknown" || !(tracked.seenOn >= since)) continue;
    if (tracked.total > LONG_CONVERSATION_THRESHOLD && tracked.total > (best?.tracked.total ?? 0)) best = { provider, id, tracked };
  }
  return best;
}

// One line sent with deep reasoning, over the last seven days.
function shortDeepWeek() {
  const since = Usage.dateKey(new Date(Date.now() - 6 * DAY_MS));
  let shortDeep = 0;
  let turns = 0;
  for (const [day, providers] of Object.entries(data.journal ?? {})) {
    if (day < since) continue;
    for (const models of Object.values(providers)) {
      for (const totals of Object.values(models)) {
        shortDeep += totals.shortDeep ?? 0;
        turns += totals.turns ?? 0;
      }
    }
  }
  return { shortDeep, turns };
}

function showTodo() {
  $("todo-section").hidden = month !== thisMonth;
  const longest = longestConversation();
  $("todo-long").hidden = !longest;
  if (longest) {
    const site = Usage.prices[longest.provider].name;
    const { turns, complete } = longest.tracked;
    $("todo-long-text").textContent = t(complete ? "todoLongText" : "todoLongTextAtLeast", turns, site);
    $("todo-long-open").onclick = async () => {
      await chrome.storage.local.set({ openSummary: { conversation: longest.id, turns, at: Date.now() } });
      chrome.tabs.create({ url: CONVERSATION_URL[longest.provider](longest.id) });
      window.close();
    };
  }
  const week = shortDeepWeek();
  const seen = Date.now() - (data.modeTodoSeen ?? 0) < 7 * DAY_MS;
  $("todo-mode").hidden = week.shortDeep < 3 || seen;
  $("todo-mode-text").textContent = t("todoModeText", week.shortDeep, week.turns);
  $("todo-empty").hidden = !$("todo-long").hidden || !$("todo-mode").hidden;
}

$("todo-mode-ok").addEventListener("click", async () => {
  await chrome.storage.local.set({ modeTodoSeen: Date.now() });
});

// --- Good habits ------------------------------------------------------------

function showHabits() {
  $("habits-title").textContent = t("yourHabits", monthName(month));
  const ofMonth = data.habits?.[month] ?? {};
  const list = $("habits");
  list.textContent = "";
  const rows = HABITS.filter((type) => (ofMonth[type] ?? 0) > 0);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("noHabitsYet");
    list.append(empty);
    return;
  }
  for (const type of rows) {
    const row = document.createElement("div");
    row.className = "habit";
    const check = document.createElement("span");
    check.className = "check";
    const drawing = document.createElementNS(NS, "svg");
    for (const [name, value] of Object.entries({ width: 11, height: 11, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
      drawing.setAttribute(name, value);
    }
    const stroke = document.createElementNS(NS, "path");
    stroke.setAttribute("d", "m3.5 8.5 3 3 6-6.5");
    drawing.append(stroke);
    check.append(drawing);
    const text = document.createElement("span");
    text.textContent = t(`habit_${type}`);
    const count = document.createElement("strong");
    count.textContent = String(ofMonth[type]);
    row.append(check, text, count);
    list.append(row);
  }
}

// --- The month's figures ----------------------------------------------------

// A readable range: two decimals under €1, one under €10.
function euroRange(low, high) {
  const digits = high < 1 ? 2 : high < 10 ? 1 : 0;
  const format = (n) =>
    n.toLocaleString(LANG, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
  return t("costRange", format(low), format(high));
}

function showFigures() {
  $("figures-title").textContent = t("monthFigures", monthName(month));
  const sum = { messages: 0, low: 0, high: 0, unpriced: 0 };
  const assistants = new Set();
  for (const [, providers] of daysOf(month)) {
    const day = Usage.aggregate(providers);
    for (const key of Object.keys(sum)) sum[key] += day[key];
    for (const { provider, messages } of day.breakdown) if (messages > 0) assistants.add(provider);
  }
  // shortcut: days recorded before 0.7 have no conversation list, so a month that old shows fewer conversations than it had.
  const conversations = new Set();
  for (const [day, entry] of Object.entries(data.activity ?? {})) {
    if (!day.startsWith(month)) continue;
    for (const [provider, ids] of Object.entries(entry.conversations ?? {})) for (const id of ids) conversations.add(`${provider}:${id}`);
  }

  const number = new Intl.NumberFormat(LANG);
  $("messages").textContent = number.format(sum.messages);
  $("messages-label").textContent = t(sum.messages > 1 ? "messageMany" : "messageOne");
  $("conversations").textContent = number.format(conversations.size);
  $("conversations-label").textContent = t(conversations.size > 1 ? "conversationMany" : "conversationOne");
  $("assistants").textContent = number.format(assistants.size);
  $("assistants-label").textContent = t(assistants.size > 1 ? "assistantMany" : "assistantOne");

  const priced = sum.messages > 0 && sum.unpriced === 0;
  $("cost").hidden = $("calc").hidden = !priced;
  if (!priced) return;
  $("cost").textContent = t("costLine", number.format(sum.messages), euroRange(sum.low, sum.high));
  $("calc-text").textContent = t(
    "calcText",
    [...assistants].map((provider) => t("modelFor", Usage.prices[provider].model, Usage.prices[provider].name)).join(", "),
    longDate(Usage.priceDate),
    longDate(Usage.rateDate),
    Usage.usdPerEuro.toLocaleString(LANG, { maximumFractionDigits: 4 })
  );
}

function weeklyTip() {
  const week = Math.floor(Date.now() / (7 * DAY_MS));
  return t(WEEKLY_TIPS[week % WEEKLY_TIPS.length]);
}

function showMonths() {
  const months = new Set([thisMonth, ...Object.keys(data.journal ?? {}).map((day) => day.slice(0, 7)), ...Object.keys(data.habits ?? {})]);
  const select = $("month");
  select.textContent = "";
  for (const key of [...months].filter((key) => key <= thisMonth).sort().reverse()) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = monthName(key);
    option.selected = key === month;
    select.append(option);
  }
}

function render() {
  showMonths();
  showTodo();
  showHabits();
  showFigures();
  $("weekly-tip").textContent = weeklyTip();
  $("privacy-alerts").checked = data.privacyAlerts !== false;
  $("tips").checked = data.tips !== false;
  $("test-mode").checked = data.testMode === true;
}

$("month").addEventListener("change", (event) => {
  month = event.target.value;
  render();
});

// --- Settings ---------------------------------------------------------------

let armed = false; // "Clear everything" waits for a second click
const showSettings = (open) => {
  $("home").hidden = open;
  $("settings").hidden = !open;
  armed = false;
  $("clear-confirm").hidden = true;
  $("clear").textContent = t("clearAll");
};
$("open-settings").addEventListener("click", () => showSettings(true));
$("close-settings").addEventListener("click", () => showSettings(false));

$("privacy-alerts").addEventListener("change", (event) => chrome.storage.local.set({ privacyAlerts: event.target.checked }));
$("tips").addEventListener("change", (event) => chrome.storage.local.set({ tips: event.target.checked }));
// Turned off, the test mode leaves nothing behind: its log and checklist go too.
$("test-mode").addEventListener("change", (event) =>
  event.target.checked
    ? chrome.storage.local.set({ testMode: true })
    : chrome.storage.local.set({ testMode: false }).then(() => chrome.storage.local.remove(["testLog", "testChecks"]))
);

$("export").addEventListener("click", () => {
  const { journal = {}, activity = {}, registry = {}, habits = {} } = data;
  const file = new Blob([JSON.stringify({ journal, activity, registry, habits }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `optidome-${Usage.dateKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// Two clicks: the first one says what will be erased.
$("clear").addEventListener("click", async () => {
  armed = !armed;
  $("clear-confirm").hidden = false;
  if (armed) {
    $("clear-confirm").textContent = t("clearConfirm");
    $("clear").textContent = t("clearConfirmButton");
    return;
  }
  // The service worker erases, so no measure being written is lost halfway.
  const reply = await chrome.runtime.sendMessage({ type: "optidome-reset" }).catch(() => null);
  $("clear-confirm").textContent = t(reply?.ok ? "cleared" : "clearFailed");
  $("clear").textContent = t("clearAll");
});

// --- Start ------------------------------------------------------------------

document.documentElement.lang = LANG;
for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
for (const element of document.querySelectorAll("[data-i18n-label]")) element.setAttribute("aria-label", t(element.dataset.i18nLabel));
drawLogo();
chrome.storage.local.get(null).then((values) => {
  data = values;
  render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (newValue === undefined) delete data[key];
    else data[key] = newValue;
  }
  render();
});
