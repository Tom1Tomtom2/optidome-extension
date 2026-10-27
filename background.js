"use strict";

// Service worker. It receives numbers, keeps the registry of conversations,
// and updates the daily journal. It never sees any text.
//
// The key calculation lives here. On every turn, the site sends the model the
// whole history of the conversation, and pays for it again. The input billed
// at turn k is therefore everything already exchanged, plus the message just
// typed. That is why the cost of a conversation grows with the square of its
// length, and that is what the registry below rebuilds.

const DAYS_KEPT = 90;

// Thresholds of the tips shown after sending, to tune on real conversations.
const LONG_CONVERSATION_THRESHOLD = 30000; // tokens reread on one turn
const THANKS_THRESHOLD = 5000; // history already reread before the thanks
const THANKS_GAP_MS = 30 * 86400000; // the thanks tip, once a month at most

// Messages arrive in bursts. We handle them one at a time so no write is lost:
// chrome.storage is not read and written atomically.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((measure, sender) => {
  if (measure?.source !== "optidome-measure") return;
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
  const { registry = {}, journal = {}, lastThanks = 0 } = await chrome.storage.local.get([
    "registry",
    "journal",
    "lastThanks",
  ]);

  const key = `${measure.provider}:${measure.conversation ?? "unknown"}`;
  const tracked = registry[key] ?? {
    total: 0,
    turns: 0,
    // True only if the extension saw the conversation from its start.
    // Otherwise the total starts too low, and we undercount.
    complete: measure.firstTurn === true,
    seenOn: null,
  };

  const alreadyReread = tracked.total;
  const billedInput = tracked.total + measure.tokensSent;
  const output = measure.tokensReceived;

  // Thanks goes first: it is the most telling, and it is rare.
  let tip = null;
  let thanksShown = lastThanks;
  if (measure.justThanks === true && alreadyReread >= THANKS_THRESHOLD && Date.now() - lastThanks > THANKS_GAP_MS) {
    tip = { id: "thanks", values: { tokens: billedInput } };
    thanksShown = Date.now();
  } else if (billedInput > LONG_CONVERSATION_THRESHOLD && !tracked.longTipShown) {
    tip = { id: "long", values: { tokens: billedInput } };
    tracked.longTipShown = true;
  }

  tracked.total = billedInput + output;
  tracked.turns += 1;
  tracked.seenOn = today();
  registry[key] = tracked;

  const day = journal[tracked.seenOn] ?? {};
  const byProvider = day[measure.provider] ?? {};
  const totals = byProvider[measure.model] ?? {
    typed: 0, // what the person actually wrote
    billed: 0, // what was sent to the model, history included
    output: 0,
    turns: 0,
    longTurns: 0, // sent in a conversation that is too long: the popup's grade
    incompleteConversations: 0,
  };

  totals.typed += measure.tokensSent;
  totals.billed += billedInput;
  totals.output += output;
  totals.turns += 1;
  if (billedInput > LONG_CONVERSATION_THRESHOLD) totals.longTurns += 1;
  if (!tracked.complete) totals.incompleteConversations += 1;

  byProvider[measure.model] = totals;
  day[measure.provider] = byProvider;
  journal[tracked.seenOn] = day;

  await chrome.storage.local.set({
    registry: prune(registry),
    journal: journal,
    lastThanks: thanksShown,
  });
  return tip;
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
