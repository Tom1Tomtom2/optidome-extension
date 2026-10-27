# Optidome 0.7 — coach and daily usage

## What changed

The shared popup and native Chrome side panel provide My usage, Tips, Learn and
Settings. The on-page launcher is available on ChatGPT (including its previous
origin), Claude, Gemini and Le Chat. Chrome 116+ is required. If opening the side
panel fails, the launcher opens an extension window instead.

The A–E grade is no longer the product's main metric. Daily bars display observed
messages or estimated API cost, and show provider counts on selection. Unknown
past dates are hatched, future dates disabled, and a monitored day with no captured
messages is explicitly described as zero **observed**, not proof of no usage.
Opening Optidome marks the current local date as observed. It does not capture
usage when the browser/extension is absent. The month picker includes older local
records; there is no promise to reconstruct activity before installation.

Daily conversation membership is independent of the registry's last-seen date.
Old journal records lack membership data and therefore show an unavailable count.
Updates use local dates; existing UTC-dated rows are not retrospectively shifted.

## Costs

`usage.js` holds named API reference models and dated primary sources. Model prices
were checked on 2026-10-27; EUR conversion uses the ECB's 2026-10-26 rate (1.1188
USD/EUR). The current model menu is not read and these prices are **not** a claim
about the subscription's backend model. Gemini 3.8 Flash introductory prices are
valid through 2026-12-31 and need a catalogue review thereafter.

The range is two illustrative cache scenarios using estimated observed text and
accumulated history. It is not a confidence interval or a lower/upper bound on the
actual bill. Hidden reasoning, tool calls, attachments, system prompts, cache-write
and storage fees, branching and history compaction can change actual cost. Old
±15% accuracy and “minimum actual cost” claims are not used in the new dashboard.
No carbon savings or percentage reductions are claimed.

Sources:
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://platform.claude.com/docs/en/about-claude/pricing
- https://ai.google.dev/gemini-api/docs/pricing
- https://docs.mistral.ai/inference/pricing
- https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html

## Explicit actions and privacy

The optional adviser is disabled by default. Enabling it does not load the model.
Only Analyze starts a worker. Leaving its screen, cancelling, or 60 seconds idle
terminates the worker. It recommends a **model type** and reasoning level, never
inventing a precise model available in the user's subscription.

Privacy alerts remain independent, local rules and can be disabled. Educational
popovers default to manual access; occasional tips are an explicit preference.
The on-page launcher reads a draft only when clicked. A short-lived, single-use
capability transfers text directly from its content script to the extension page;
the service worker sees no draft text. Copying and modifying a draft are explicit
and never send a message. A write capability expires after five minutes, is bound
to the conversation path and rejects replacement if the current draft changed.
Replacement and undo are verified against the active editor; the copy action is
the fallback for changed/unsupported editors. No draft or analysis is stored in
chrome.storage, analytics or a server. The assistant website can still read its
own input field; local extension processing does not guarantee website privacy.

The model assets are included in the ~85 MB compressed package. Activation is not
an on-demand remote download. Inference uses CPU/WASM on one thread.

## Long requests

Full-text inference retains the conservative 128-token limit. The coach accepts
up to 200,000 characters so a user can instead describe the task, or explicitly
select beginning/end sampling. Each excerpt is independently token-bounded and
classified. Disagreement, high-stakes terms, missing context or a proposed quick
level produces abstention; partial analysis never recommends quick. Matching
standard/deep results remain visibly partial. This does not validate accuracy on
long tasks and can miss middle instructions. A task description is preferred.

## Guided writing and learning

The prompt helper is a deterministic goal/context/format form, with preview,
explicit replacement or copy and undo. It is not generative rewriting. Three
short quizzes retain progress locally without streaks, usage rewards or a score.
Stored data, export and confirmed deletion are in Settings only. Reset and usage
writes are serialized in the service worker. The files of the installed model and
provider-side conversations are not removed by local reset.

## Validation and limitations

`npm test` covers legacy stream/rule checks, calendar boundaries, unknown/zero
observations, multi-provider costs, conversation membership across months,
legacy gaps and partial-analysis abstention. `npm run test:browser` runs real local
WASM inference and the coach on synthetic editor fixtures for all five origins.
It checks preview/replacement/undo, stale-write rejection, optional activation,
worker disposal, partial/description input, charts, preferences, quizzes, reset,
no outgoing network calls and 320px dark layout.

Fresh test profiles avoid caching an older unpacked service worker. Native Chrome
side-panel rendering is not exercised by the headless runner; its fallback window
is tested. Authenticated provider pages and React/ProseMirror changes still need
manual checks. The original 28-case development set is not an independent quality
benchmark: 20 recommendations matched its labels, 8 abstentions, 0 deep-to-quick
recommendations. No new claim of routing accuracy is made.
