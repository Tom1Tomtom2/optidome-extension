"use strict";

importScripts('usage.js', 'providers.js');

// Service worker. It receives numbers, keeps the registry of conversations,
// and updates the daily journal. It never sees any text.
//
// Approximate accumulated history: actual providers can cache, compact, truncate
// or branch it. The cost UI presents reference scenarios, never a measured bill.

const DAYS_KEPT = 90;

// Thresholds of the tips shown after sending, to tune on real conversations.
const LONG_CONVERSATION_THRESHOLD = 30000; // tokens reread on one turn
const THANKS_THRESHOLD = 5000; // history already reread before the thanks
const THANKS_GAP_MS = 30 * 86400000; // the thanks tip, once a month at most
const SHORT_MESSAGE = 30; // tokens typed, about one line of text
const MODE_GAP_MS = 7 * 86400000; // the "quick mode" tip, once a week at most
const FIX_GAP_MS = 30 * 86400000; // the "say the format" tip, once a month at most
const REGENERATIONS = 3; // answers redone in one conversation before the tip

// Test mode: the tips come back at every occasion, and the long conversation
// starts at a pasted page of text, so each tip can be checked in minutes.
const TEST_LONG_THRESHOLD = 3000;
const TEST_LOG_SIZE = 40;

// Messages arrive in bursts. We handle them one at a time so no write is lost:
// chrome.storage is not read and written atomically.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((measure, sender) => {
  if (measure?.source === "optidome-test") {
    const site = OptidomeProviders.forUrl(sender.url);
    if (sender.id !== chrome.runtime.id || !site) return;
    queue = queue.then(() => logTest({ ...measure, provider: site.id })).catch(() => {});
    return;
  }
  if (measure?.source !== "optidome-measure") return;
  if (sender.id !== chrome.runtime.id || !OptidomeProviders.forUrl(sender.url)) return;
  if (!OptidomeProviders.definitions.some(p => p.id === measure.provider) ||
      ![measure.tokensSent, measure.tokensReceived].every(n => Number.isFinite(n) && n >= 0 && n < 1e8)) return;
  queue = queue
    .then(() => record(measure))
    .then((tip) => {
      const tab = sender?.tab?.id;
      if (tip && tab != null) {
        // The tab may have been closed in the meantime: a lost tip, nothing more.
        chrome.tabs.sendMessage(tab, { source: "optidome-tip", ...tip }).catch(() => {});
      }
    })
    .catch((error) => {
      console.warn("[optidome] recording failed", error);
    });
});

// Returns the tip to show after this send, or null.
async function record(measure) {
  const { registry = {}, journal = {}, activity = {}, lastThanks = 0, lastTips = {}, testMode = false } = await chrome.storage.local.get([
    "registry",
    "activity",
    "journal",
    "lastThanks",
    "lastTips",
    "testMode",
  ]);
  const testing = testMode === true;
  if (testing) await logTest({ kind: "measure", ...measure, source: undefined });

  const key = `${measure.provider}:${measure.conversation ?? "unknown"}`;
  const tracked = registry[key] ?? {
    total: 0,
    turns: 0,
    // True only if the extension saw the conversation from its start.
    // Otherwise the total starts too low, and we undercount.
    complete: measure.firstTurn === true,
    seenOn: null,
  };

  // Daily membership is recorded separately: last-seen dates cannot reconstruct
  // historical conversation counts. Existing journal days remain unknown.
  const dayKey = today();
  const entry = activity[dayKey] ?? { conversations: {}, complete: !journal[dayKey] };
  if (measure.conversation) {
    const ids = entry.conversations[measure.provider] ?? [];
    if (!ids.includes(measure.conversation)) ids.push(measure.conversation);
    entry.conversations[measure.provider] = ids;
  }
  activity[dayKey] = entry;
  const alreadyReread = tracked.total;
  const billedInput = tracked.total + measure.tokensSent;
  const output = measure.tokensReceived;
  const now = Date.now();
  // A one-line message sent with deep reasoning: the quick mode answers as well.
  const shortDeep = measure.deep === true && measure.tokensSent > 0 && measure.tokensSent <= SHORT_MESSAGE;
  if (measure.regenerated === true) tracked.regenerations = (tracked.regenerations ?? 0) + 1;

  // Thanks goes first: it is the most telling, and it is rare.
  let tip = null;
  let thanksShown = lastThanks;
  const due = (last, gap) => testing || now - last > gap;
  if (measure.justThanks === true && (testing || alreadyReread >= THANKS_THRESHOLD) && due(lastThanks, THANKS_GAP_MS)) {
    tip = { id: "thanks", values: { tokens: billedInput } };
    thanksShown = now;
  } else if (billedInput > (testing ? TEST_LONG_THRESHOLD : LONG_CONVERSATION_THRESHOLD) && (testing || !tracked.longTipShown)) {
    tip = { id: "long", values: { turns: tracked.turns + 1 } };
    tracked.longTipShown = true;
  } else if (shortDeep && due(lastTips.mode ?? 0, MODE_GAP_MS)) {
    tip = { id: "mode" };
    lastTips.mode = now;
  } else if (measure.regenerated === true && testing) {
    tip = { id: "regenerate" };
  } else if ((tracked.regenerations ?? 0) >= REGENERATIONS && !tracked.regenerateTipShown) {
    tip = { id: "regenerate" };
    tracked.regenerateTipShown = true;
  } else if (measure.followUpFix === true && due(lastTips.fix ?? 0, FIX_GAP_MS)) {
    tip = { id: "fix" };
    lastTips.fix = now;
  }

  tracked.total = billedInput + output;
  tracked.turns += 1;
  tracked.seenOn = today();
  registry[key] = tracked;

  const day = journal[tracked.seenOn] ?? {};
  const byProvider = day[measure.provider] ?? {};
  const modelKey = typeof measure.model === "string" && !["__proto__","constructor","prototype"].includes(measure.model) ? measure.model : "unknown";
  const totals = (Object.hasOwn(byProvider,modelKey) ? byProvider[modelKey] : null) ?? {
    typed: 0, // what the person actually wrote
    billed: 0, // what was sent to the model, history included
    output: 0,
    turns: 0,
    longTurns: 0, // sent in a conversation that is too long
    shortDeep: 0, // one line sent with deep reasoning: the popup's "quick mode" tip
    incompleteConversations: 0,
  };

  totals.typed += measure.tokensSent;
  totals.billed += billedInput;
  totals.output += output;
  totals.turns += 1;
  if (billedInput > LONG_CONVERSATION_THRESHOLD) totals.longTurns += 1;
  if (shortDeep) totals.shortDeep = (totals.shortDeep ?? 0) + 1;
  if (!tracked.complete) totals.incompleteConversations += 1;

  byProvider[modelKey] = totals;
  day[measure.provider] = byProvider;
  journal[tracked.seenOn] = day;

  await chrome.storage.local.set({
    registry: prune(registry),
    activity,
    journal: journal,
    lastThanks: thanksShown,
    lastTips,
  });
  return tip;
}

// Test mode: the last sends, kept for the page's test panel and its report.
// Numbers and shapes only, like everything else here.
async function logTest(event) {
  const { testMode = false, testLog = [] } = await chrome.storage.local.get(["testMode", "testLog"]);
  if (testMode !== true) return;
  // A site's background calls (Gemini's /log) would push the sends out of
  // the log: each route is kept once.
  if (event.kind === "route" && testLog.some((e) => e.kind === "route" && e.provider === event.provider && e.route === event.route)) return;
  const entry = { at: Date.now(), ...event };
  delete entry.source;
  // Claude sends its whole tool list with each message (44,000 characters on
  // 2026-10-28): keep every setting, and only the length of the bulky ones.
  const length = (value) => JSON.stringify(value ?? null).length;
  const request = entry.shape?.request;
  if (length(entry.shape) > 12000 && request && typeof request === "object" && !Array.isArray(request)) {
    entry.shape = {
      ...entry.shape,
      request: Object.fromEntries(Object.entries(request).map(([key, value]) => [key, length(value) > 1000 ? `<${length(value)} chars>` : value])),
    };
  }
  const size = length(entry.shape);
  if (size > 12000) entry.shape = `<${size} chars, too big to keep>`;
  testLog.push(entry);
  await chrome.storage.local.set({ testLog: testLog.slice(-TEST_LOG_SIZE) });
}

function today() {
  return Usage.dateKey();
}

// A conversation left alone for three months will never be picked up again:
// it leaves the registry so the registry does not grow forever.
function prune(registry) {
  const limit = new Date(Date.now() - DAYS_KEPT * 86400000).toISOString().slice(0, 10);
  const kept = {};
  for (const [key, tracked] of Object.entries(registry)) {
    if (!tracked.seenOn || tracked.seenOn >= limit) kept[key] = tracked;
  }
  return kept;
}

// All writes to the journal (including reset) are ordered in this worker.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if(message?.type !== 'optidome-reset') return;
  queue = queue.then(async () => {
    await chrome.storage.local.clear();
    respond({ok:true});
  }).catch(error=>{console.warn("[optidome] storage operation failed", error);respond({ok:false});});
  return true;
});
