"use strict";

// The interception script runs in the page's world, where chrome.runtime does
// not exist. This bridge runs in the extension's isolated world: it listens
// for measures and passes them to the service worker.
//
// It only carries numbers. If a message ever contained anything else, that
// would be a bug to fix right here. One exception, in test mode only: the
// shape of the request (see shape() in intercept.js), which never holds the
// message.

// When the extension is reloaded, scripts already injected in open tabs lose
// their link to it: chrome.runtime disappears under their feet. They must
// then stay quiet, and above all not throw a red error on the person's site.
// Counting resumes when the page is reloaded.
const isAttached = () => {
  try {
    return Boolean(globalThis.chrome?.runtime?.id);
  } catch (error) {
    return false;
  }
};

let detachmentReported = false;

// Test mode: intercept.js runs in the page and cannot read the extension's
// settings, so the setting is copied into the site's localStorage, which both
// worlds share. Off, the key is removed and nothing about it stays behind.
let testMode = false;
function setTestMode(on) {
  testMode = on === true;
  try {
    if (testMode) localStorage.setItem("optidome-test", "1");
    else localStorage.removeItem("optidome-test");
  } catch (error) {
    // Storage refused by the site: the test mode just records less.
  }
}
try {
  chrome.storage.local.get("testMode").then((values) => setTestMode(values.testMode));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.testMode) setTestMode(changes.testMode.newValue);
  });
} catch (error) {
  // Extension detached.
}

// null passes as null: "the site's setting was not read" is not "no".
const flag = (value) => (value === true ? true : value === false ? false : null);

function send(message) {
  if (!isAttached()) {
    reportDetachment();
    return;
  }
  try {
    const sending = chrome.runtime.sendMessage(message);
    // MV3 returns a promise, but not in every Chrome version.
    if (sending && typeof sending.catch === "function") sending.catch(reportDetachment);
  } catch (error) {
    // The service worker is restarting, or the extension was just reloaded.
    // A lost measure is better than an error shown on the site.
    reportDetachment();
  }
}

function reportDetachment() {
  if (detachmentReported) return;
  detachmentReported = true;
  console.info("[optidome] extension reloaded. Reload the page to resume counting.");
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const measure = event.data;
  if (measure?.source === "optidome-test") {
    if (!testMode) return;
    send({
      source: "optidome-test",
      provider: measure.provider,
      kind: ["route", "answer"].includes(measure.kind) ? measure.kind : "action",
      route: typeof measure.route === "string" ? measure.route.slice(0, 200) : undefined,
      shape: measure.shape,
    });
    return;
  }
  if (measure?.source !== "optidome-measure") return;

  send({
    source: "optidome-measure",
    provider: measure.provider,
    model: measure.model,
    conversation: measure.conversation,
    firstTurn: measure.firstTurn === true,
    tokensSent: Number(measure.tokensSent) || 0,
    tokensReceived: Number(measure.tokensReceived) || 0,
    justThanks: measure.justThanks === true,
    followUpFix: measure.followUpFix === true,
    deep: flag(measure.deep),
    regenerated: flag(measure.regenerated),
    continued: measure.continued === true,
    // The shape of the request goes on in test mode only.
    shape: testMode ? measure.shape : undefined,
  });
});
