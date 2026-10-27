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
  // Model: gpt-6.1-sol, the public price closest to the "gpt-6" that ChatGPT
  // says it uses (read in its answers on 2026-10-22). In dollars per million
  // tokens.
  const PRICES = { model: "gpt-6.1-sol", input: 2, cachedInput: 0.1, output: 10, recordedOn: "2026-10-01" };
  const DOLLARS_PER_EURO = 1.1355;
  const RATE_DATE = "2026-09-30";
  // The count estimates tokens within 15% (intercept.js).
  const MARGIN = 0.15;

  // Range in euros. The low end assumes the company pays the reduced price for
  // what the model rereads from a conversation already under way (cache), the
  // high end that it pays full price for everything; both are widened by the
  // count's margin.
  function range({ typed, billed, output }) {
    const reread = Math.max(0, billed - typed);
    const low = (typed * PRICES.input + reread * PRICES.cachedInput + output * PRICES.output) / 1e6;
    const high = (billed * PRICES.input + output * PRICES.output) / 1e6;
    return {
      low: (low * (1 - MARGIN)) / DOLLARS_PER_EURO,
      high: (high * (1 + MARGIN)) / DOLLARS_PER_EURO,
    };
  }

  // registry: { "chatgpt:<id>": { seenOn: "2026-10-22", ... } }. A
  // conversation counts for the month the person last wrote in it.
  function usageForMonth(journal, registry, month) {
    const sum = { messages: 0, typed: 0, billed: 0, output: 0 };
    for (const [day, providers] of Object.entries(journal ?? {})) {
      if (!day.startsWith(month)) continue;
      for (const models of Object.values(providers)) {
        for (const totals of Object.values(models)) {
          sum.messages += totals.turns ?? 0;
          sum.typed += totals.typed ?? 0;
          sum.billed += totals.billed ?? 0;
          sum.output += totals.output ?? 0;
        }
      }
    }
    const conversations = Object.values(registry ?? {}).filter((tracked) => tracked.seenOn?.startsWith(month)).length;
    return {
      messages: sum.messages,
      conversations,
      euros: sum.messages > 0 ? range(sum) : null,
    };
  }

  return { gradeForMonth, usageForMonth, letter, SCALE, MIN_MESSAGES, PRICES, DOLLARS_PER_EURO, RATE_DATE };
})();

if (typeof module !== "undefined") module.exports = Grade;
