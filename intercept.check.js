"use strict";

// Runs intercept.js, unchanged, against exchanges captured on the real sites
// (fixtures/*.json), without a browser: `node intercept.check.js`.
// When a site changes its format, capture a new exchange and add a fixture.

const fs = require("fs");
const vm = require("vm");

const CHARS_PER_TOKEN = 3.8; // same estimate as intercept.js
const tokens = (text) => (text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0);

// A fixture holds one exchange, or several calls in the order the site made
// them ("requests"). Bodies are text, or base64 when binary.
const calls = (fixture) =>
  (fixture.requests ?? [fixture]).map((call) => ({
    url: call.url,
    headers: call.headers,
    body: call.bodyBase64 !== undefined ? Buffer.from(call.bodyBase64, "base64") : call.body,
    response: call.responseBase64 !== undefined ? Buffer.from(call.responseBase64, "base64") : call.response,
  }));

async function run(fixture) {
  const measures = [];
  let allSent;
  const sent = new Promise((resolve) => (allSent = resolve));
  const window = {
    // The site's own fetch: answers with the captured response, once every
    // call has gone out (Claude's answer stream is opened before the send).
    fetch: async (input) => {
      const { response } = calls(fixture).find((call) => call.url === input.url) ?? {};
      const stream = new ReadableStream({
        async start(controller) {
          await sent;
          controller.enqueue(typeof response === "string" ? new TextEncoder().encode(response) : new Uint8Array(response ?? []));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    },
    postMessage: (message) => measures.push(message),
    location: { origin: "https://example.test" },
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/intercept.js`, "utf8"), {
    window,
    localStorage: { getItem: () => null },
    Request,
    Response,
    Headers,
    URL,
    DataView,
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    TextDecoderStream,
    URLSearchParams,
    console,
  });

  const responses = [];
  for (const call of calls(fixture)) {
    responses.push(await window.fetch(new Request(call.url, { method: "POST", headers: call.headers, body: call.body })));
  }
  allSent();
  await Promise.all(responses.map((response) => response.arrayBuffer())); // the site reads its answers
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
