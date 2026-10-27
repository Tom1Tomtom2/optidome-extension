"use strict";

// The popup's figures: the grade for the month, from A to E, then the month's
// exchanges and what they would cost a company, in euros.
//
// The grade for the month, from A to E. A single criterion, written under the
// grade in the popup: the share of messages sent in a conversation that is
// too long (more than 30,000 tokens reread, the threshold of the "long
// conversation" tip).

const Grade = (() => {
  const SCALE = [
    ["A", 0.1],
    ["B", 0.25],
    ["C", 0.4],
    ["D", 0.6],
  ];
  // Below this, a single long conversation would make the whole grade.
  const MIN_MESSAGES = 10;

  function letter(share) {
    for (const [name, threshold] of SCALE) if (share < threshold) return name;
    return "E";
  }

  // journal: { "2026-10-22": { chatgpt: { model: { turns, longTurns } } } }
  function gradeForMonth(journal, month) {
    let turns = 0;
    let longTurns = 0;
    for (const [day, providers] of Object.entries(journal ?? {})) {
      if (!day.startsWith(month)) continue;
      for (const models of Object.values(providers)) {
        for (const totals of Object.values(models)) {
          turns += totals.turns ?? 0;
          longTurns += totals.longTurns ?? 0;
        }
      }
    }
    if (turns < MIN_MESSAGES) return { letter: null, turns, longTurns };
    const share = longTurns / turns;
    return { letter: letter(share), share, turns, longTurns };
  }

  // --- The month's exchanges, and what they would have cost a company --------
  //
  // Prices and rate copied from optidome's public price list.
  // shortcut: copied by hand, reread at each monthly price review.
  // shortcut: one model per assistant, the one it uses by default; per model prices once the model menu is read.
  // ChatGPT: gpt-6.1-sol, the public price closest to the "gpt-6" that
  // ChatGPT says it uses (read in its answers on 2026-10-22). In dollars per
  // million tokens.
  const PRICES = {
    chatgpt: { assistant: "ChatGPT", model: "gpt-6.1-sol", input: 2, cachedInput: 0.1, output: 10 },
    claude: { assistant: "Claude", model: "Claude Sonnet 5.5", input: 2, cachedInput: 0.2, output: 10 },
    gemini: { assistant: "Gemini", model: "Gemini 3.8 Flash", input: 0.75, cachedInput: 0.075, output: 3.75 },
    mistral: { assistant: "Le Chat", model: "Mistral Medium 3.5", input: 1.5, cachedInput: 0.15, output: 7.5 },
  };
  const PRICES_RECORDED_ON = "2026-10-01";
  const DOLLARS_PER_EURO = 1.1355;
  const RATE_DATE = "2026-09-30";
  // The count estimates tokens within 15% (intercept.js).
  const MARGIN = 0.15;

  // Range in dollars for one assistant. The low end assumes the company pays
  // the reduced price for what the model rereads from a conversation already
  // under way (cache), the high end that it pays full price for everything.
  function range({ typed = 0, billed = 0, output = 0 }, prices) {
    const reread = Math.max(0, billed - typed);
    return {
      low: (typed * prices.input + reread * prices.cachedInput + output * prices.output) / 1e6,
      high: (billed * prices.input + output * prices.output) / 1e6,
    };
  }

  // registry: { "chatgpt:<id>": { seenOn: "2026-10-22", ... } }. A
  // conversation counts for the month the person last wrote in it.
  // Returns the range in euros, widened by the count's margin, and the
  // assistants used, whose prices the popup names.
  function usageForMonth(journal, registry, month) {
    let messages = 0;
    const dollars = { low: 0, high: 0 };
    const providers = new Set();
    for (const [day, byProvider] of Object.entries(journal ?? {})) {
      if (!day.startsWith(month)) continue;
      for (const [provider, models] of Object.entries(byProvider)) {
        providers.add(PRICES[provider] ? provider : "chatgpt");
        for (const totals of Object.values(models)) {
          messages += totals.turns ?? 0;
          const { low, high } = range(totals, PRICES[provider] ?? PRICES.chatgpt);
          dollars.low += low;
          dollars.high += high;
        }
      }
    }
    const conversations = Object.values(registry ?? {}).filter((tracked) => tracked.seenOn?.startsWith(month)).length;
    return {
      messages,
      conversations,
      providers: [...providers],
      euros:
        messages > 0
          ? { low: (dollars.low * (1 - MARGIN)) / DOLLARS_PER_EURO, high: (dollars.high * (1 + MARGIN)) / DOLLARS_PER_EURO }
          : null,
    };
  }

  return { gradeForMonth, usageForMonth, letter, SCALE, MIN_MESSAGES, PRICES, PRICES_RECORDED_ON, DOLLARS_PER_EURO, RATE_DATE };
})();

if (typeof module !== "undefined") module.exports = Grade;
