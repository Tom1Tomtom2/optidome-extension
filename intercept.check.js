"use strict";

// Runs intercept.js, unchanged, against exchanges captured on the real sites
// (fixtures/*.json), without a browser: `node intercept.check.js`.
// When a site changes its format, capture a new exchange and add a fixture.

const fs = require("fs");
const vm = require("vm");

const CHARS_PER_TOKEN = 3.8; // same estimate as intercept.js
const tokens = (text) => (text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0);

async function run(fixture) {
  const measures = [];
  const window = {
    // The site's own fetch: answers with the captured response.
    fetch: async () => new Response(fixture.response, { status: 200 }),
    postMessage: (message) => measures.push(message),
    location: { origin: "https://example.test" },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/intercept.js`, "utf8"), {
    window,
    localStorage: { getItem: () => null },
    Request,
    Headers,
    TextDecoderStream,
    URLSearchParams,
    console,
  });

  const request = new Request(fixture.url, { method: "POST", headers: fixture.headers, body: fixture.body });
  const response = await window.fetch(request);
  await response.text(); // the site reads its answer
  for (let i = 0; i < 50 && measures.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return measures[0];
}

(async () => {
  let checked = 0;
  for (const file of fs.readdirSync(`${__dirname}/fixtures`).filter((name) => name.endsWith(".json"))) {
    const fixture = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/${file}`, "utf8"));
    const { sentText, answer, ...expected } = fixture.expect;
    const measure = await run(fixture);
    const actual = measure && {
      provider: measure.provider,
      model: measure.model,
      conversation: measure.conversation,
      firstTurn: measure.firstTurn,
      justThanks: measure.justThanks,
    };
    const wanted = { ...expected, tokensSent: tokens(sentText), tokensReceived: tokens(answer) };
    const got = measure && { ...actual, tokensSent: measure.tokensSent, tokensReceived: measure.tokensReceived };
    if (JSON.stringify(Object.entries(wanted).sort()) !== JSON.stringify(Object.entries(got ?? {}).sort())) {
      throw new Error(`${file}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(got)}`);
    }
    checked += 1;
  }
  console.log(`intercept: ${checked} captured exchanges read correctly`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
