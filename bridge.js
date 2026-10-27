"use strict";

// The interception script runs in the page's world, where chrome.runtime does
// not exist. This bridge runs in the extension's isolated world: it listens
// for measures and passes them to the service worker.
//
// It only carries numbers. If a message ever contained anything else, that
// would be a bug to fix right here.

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

function reportDetachment() {
  if (detachmentReported) return;
  detachmentReported = true;
  console.info("[optidome] extension reloaded. Reload the page to resume counting.");
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const measure = event.data;
  if (measure?.source !== "optidome-measure") return;

  if (!isAttached()) {
    reportDetachment();
    return;
  }

  try {
    const sending = chrome.runtime.sendMessage({
      source: "optidome-measure",
      provider: measure.provider,
      model: measure.model,
      conversation: measure.conversation,
      firstTurn: measure.firstTurn === true,
      tokensSent: Number(measure.tokensSent) || 0,
      tokensReceived: Number(measure.tokensReceived) || 0,
      justThanks: measure.justThanks === true,
    });
    // MV3 returns a promise, but not in every Chrome version.
    if (sending && typeof sending.catch === "function") sending.catch(reportDetachment);
  } catch (error) {
    // The service worker is restarting, or the extension was just reloaded.
    // A lost measure is better than an error shown on the site.
    reportDetachment();
  }
});
