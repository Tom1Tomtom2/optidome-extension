# Optional local analysis — experimental prototype

Based on upstream commit `2b5b5324fdafc0c3bf9c96e8131edbf3afe179cf` (0.4.0).
Work is isolated on local branch `codex/analyse-locale`. No provider adapters,
usage calculation or existing advice rules have been rewritten.

## User behaviour

- A small “Choose a reasoning level” button is shown when the ChatGPT composer
  exists. No model runs and this new module does not read text while typing.
- A trusted click takes a snapshot of the draft and opens an extension window.
  A one-use capability allows that window to retrieve it from the content
  script. The service worker never receives the draft.
- Only the separate “Analyse on this computer” button starts MiniLM. The
  result suggests light, standard or deeper reasoning, or abstains.
- No automatic sending, rewriting, model selection, history reading, prompt
  logging, telemetry, prompt storage or runtime network requests.
- Editing the analysis copy does not edit the actual chat. Results are
  invalidated when this copy changes. The copy is explicitly labelled as a
  snapshot, not the live composer.
- Cancel terminates the worker. Closing the window also releases it. An idle
  worker is terminated after one minute. Hiding the chat button is persistent;
  the analyser remains available from the extension popup for manual input.
- Existing automatic privacy/reference tips and usage accounting are unchanged.
  The manual-only guarantee concerns this new model-based feature.

## What the model does, and what it does not prove

The quantized multilingual MiniLM encoder maps short requests to vectors.
The routing policy compares these with 24 authored French/English examples,
then applies conservative abstention thresholds. This is an **experimental
semantic baseline**, not a trained optimal-model selector and not an equivalent
of Jev's general typed decision system. Cosine similarity is not a calibrated
probability and is never shown as a confidence percentage.

The model weights are 118,308,126 bytes. The tokenizer and WASM runtime add
to download size and runtime RAM. No claim about measured PC RAM is made.
CPU/WASM is used with one thread; a dedicated GPU is not required.

The model accepts at most 128 tokens for this prototype. Character length is
checked before loading; tokenizer length is checked before embedding. Longer
requests abstain without silent truncation. Previous messages, images and
attachments are not read. A checkbox lets the user declare context dependence.
Keyword guards for consequential decisions and sources are limited heuristics,
not a safety classifier. A long or short prompt is not itself a difficulty score.

The UI does not know the actual model menu, subscription or selected effort.
It recommends a category only. Mapping these categories to real available
models is a separate provider adapter responsibility. Do not claim that this
prototype selects the best specific model or optimises subscription charges.

## Build and install

Node.js and npm are developer tools only; users need only Chrome and the built
extension folder. The ordinary upstream extension still loads from the repo
root, but the new model feature needs the built `dist/` folder.

```sh
npm ci --ignore-scripts
node scripts/download-model.mjs
npm run build
npm test
```

Load `dist/` through Chrome → Extensions → Developer mode → Load unpacked.
Reload ChatGPT. The model and runtime are included in this folder. No additional
download occurs when users analyse a request. Distribution is therefore much
larger than the existing extension; an optional separately installed language
pack could be explored later, with explicit download consent and revised copy.

The pinned model revision and SHA-256 digests are in `scripts/model-files.json`.
Model: Apache-2.0. Runtime licences are included in the build. The sharp override
fixes audited native development dependency advisories; sharp is not bundled
into the browser inference worker.

## Tests

`npm test` runs the existing rules/grade/translation checks and routing-policy
edge cases. `node tests/browser.mjs` loads the actual built extension in an
isolated Chromium profile and serves a synthetic ChatGPT composer fixture.
Set `CHROMIUM_PATH` for your installed test Chromium. It exercises real local
WASM inference, deliberate activation, text import, edits, cancellation,
context/length abstention, unchanged chat input and absence of network/storage
leaks. It writes `test-results/report.json` and a screenshot.

This does **not** validate a logged-in live ChatGPT account or all its editor
variants. Browser selectors must be checked on real accounts before release.
The authored development prompts are not an independent test set and do not
measure the quality of downstream assistant responses. Full PC RAM consumption
and Windows performance remain to be measured.

Observed on 2026-10-27: 311 existing checks and 5 added policy tests passed.
The browser integration test passed on macOS ARM64 / Chromium 139, CPU/WASM
with one thread. On the authored set of 28 requests (24 task labels and 4
abstention cases), the analyser gave 20 recommendations matching the authored
labels, abstained on 4 other tasks and abstained on the 4 intended guard cases.
No difficult task in that sample was routed to light reasoning. The initial
load plus analysis took 1.324 s; answered subsequent cases took 46–109 ms
(median 49 ms), including browser automation overhead. These are development
observations, not population accuracy estimates or PC performance guarantees.

## Integration with the other provider session

New code is under `analyse/`; small integration points are `manifest.json`, one
`importScripts` in `background.js`, one popup button and prefixed locale keys.
`intercept.js`, `bridge.js`, `rules.js`, `tips.js` and `grade.js` are untouched.

The policy contract is `{ level: 'quick' | 'standard' | 'deep' | null,
reason: string, notes: string[] }`. Keep provider availability, effort names,
editor access and eventual user-confirmed selection outside this policy.
Do not assume a service's “fast model” and “low reasoning effort” are equivalent.
The other session can implement Claude/Mistral/Gemini adapters independently.

## Audit of the existing design

1. **The grade is a context-length indicator, not quality of AI use.**
   `grade.js:27` only counts long turns. An essential long analysis gets a worse
   grade than a useless short interaction. Rename the metric and avoid
   “Excellent usage” unless a validated broader rubric supports it. Preserve
   useful context rather than encouraging a reset merely to improve a grade.
2. **Costs are a scenario, not an observed bill or guaranteed lower bound.**
   `grade.js:51` applies one model's price to all collected providers/models;
   `background.js:60` accumulates all observed turns. It does not reconstruct
   branches, retries, removals, summarisation or actual cache use. Rephrase as
   “illustrative API equivalent with these assumptions”; never infer savings
   on a fixed-price chat subscription from those figures. A model's own claim
   about its identity is not a verified pricing reference.
3. **Monthly conversation counts change retroactively.** `grade.js:86` counts
   each registry entry using its latest `seenOn`. A conversation used in October
   and November disappears from October's count. Store per-month conversation
   membership if historical reports are intended to remain stable.
4. **The measurement bridge trusts page-originated values.** `bridge.js:42`
   forwards provider/model/id fields without type/length validation and accepts
   negative or non-finite counts. Scripts in the page can forge these messages.
   Validate and bound fields again in the background; consider metrics from the
   page untrusted. The new draft transfer uses a separate extension-only channel.
5. **Privacy copy overpromises semantic equivalence.** “An example will get the
   same answer” is not universally true. Say that masking can preserve enough
   context, and let the user verify. Similarly, a conversation that looks long
   is not an environmental measurement; the fixed ±15% token margin has no
   calibration evidence in the supplied tests.
6. **Several recommendations lack contextual exceptions.** A repeated paste
   can be intentional; a long conversation can be necessary; training settings
   depend on the user's account. Keep advice optional and avoid treating these
   actions as universally incorrect. The new analyser is independent of the
   one-tip-per-conversation gate, so reference tips cannot hide it.

These audit findings are recorded, not silently fixed along with the analyser.
That keeps this branch reviewable and limits conflicts with the provider work.

## Evidence needed before recommending production use

Collect a few hundred representative, voluntarily supplied and anonymised
requests. Separate training/calibration/evaluation sets and include French,
English, code, short hard tasks, long easy tasks, ambiguous follow-ups and
attachments. Compare this baseline against simple rules, always-standard and
a trained lightweight classifier. Evaluate the answers of the actual target
models at each effort setting, preferably blind to the routing decision.

Track coverage/abstention, harmful under-routing, response quality, latency,
peak RAM and cold-start time. A practical go/no-go target should prioritise
avoiding under-routing on difficult work, rather than just overall agreement.
Do not display numerical confidence until it is calibrated on held-out data.

## Prompt rewriting, phase two

MiniLM is an encoder, so it cannot rewrite text. Start with an optional
structured editor: goal, necessary context, constraints, expected format,
missing information. Show a before/after diff and require user acceptance.
Never invent facts or constraints. Preserve code, identifiers, quoted text,
privacy masking, negations and technical requirements.

Free-form rewriting requires a separate generative model or an explicitly
chosen external service. Its footprint, latency and privacy trade-offs differ
from the tiny classifier. Evaluate actual downstream answer quality, not just
prompt length: fewer words can cause worse answers and more follow-up turns.
