# Optidome Companion

A free, open source Chrome extension (Optidome compagnon in French). It gives you tips while you use
ChatGPT, Claude, Gemini or Le Chat, and a summary of your month.

**Nothing leaves your browser.** The extension talks to no server, not even
Optidome's. The text of your conversations is read on the spot, then
forgotten. It only keeps numbers, in Chrome's storage.

It works on chatgpt.com, claude.ai, gemini.google.com and chat.mistral.ai.
It speaks English and French, and follows the language of your browser.

---

## What the extension does

### Tips at the right moment

A small card shows up in a corner of the page when a tip applies to you.
When it can, a button does the work for you.

| You | The extension suggests |
|---|---|
| type an IBAN, a card number, a French social security number or several email addresses | replacing the data with an example, which will get you the same answer |
| paste a secret key (an API key, for instance) | removing it from the draft, and changing it to be safe |
| ask for sources, citations or legal articles | checking every reference before you reuse it, because AI models sometimes make them up |
| paste a long text already present earlier in the conversation | referring to it, instead of having it reread twice |
| keep going in a conversation that has become very long | preparing a summary to start over in a new conversation |
| send "thank you" on its own | nothing serious, but the AI reread the whole conversation to answer you |
| send a one-line question with deep reasoning on | the quick mode, which answers as well and faster |
| redo the same answer three times | saying what is wrong with it instead |
| answer "no", "shorter" or "try again" | saying the format you want from the first request |
| just installed the extension | checking whether your conversations are used to train the AI |

Your draft is never sent or changed unless you click.

Two of these tips depend on a setting each site stores its own way. Where
the extension does not read it yet, the tip stays silent rather than guess:

| | ChatGPT | Claude | Gemini | Le Chat |
|---|---|---|---|---|
| deep reasoning on | read | not yet | not yet | read, to confirm |
| answer redone | read | not yet | not yet | not yet |

The test mode below is how the missing ones get filled in.

### The popup

One screen, in three parts:

- **To do now**: your longest conversation of the week, opened in one click
  to prepare a summary, and the number of one-line questions sent with deep
  reasoning over the last seven days.
- **Your good habits**: sensitive data removed before sending, new
  conversations started at the right time.
- **The month in figures**: messages, conversations, assistants, and what
  they would have cost a company that pays for AI by usage. It is an order
  of magnitude, calculated from the public price of each assistant's default
  model (gpt-6.1-sol, Claude Sonnet 5.5, Gemini 3.8 Flash, Mistral Medium 3.5).

The settings turn the sensitive data alerts and the other tips on or off,
export your figures and erase them, and turn on the test mode.

---

## Install

The extension is not on the Chrome Web Store yet. To try it:

1. Download or clone this repository. There is nothing to build.
2. Open `chrome://extensions` in Chrome.
3. Turn on "Developer mode", top right.
4. Click "Load unpacked" and choose the repository folder.
5. Open ChatGPT, Claude, Gemini or Le Chat, or reload the tab if it was
   already open.

The Optidome icon shows up in Chrome's toolbar (if needed, pin it from the
puzzle piece icon).

---

## What the extension does not see

The extension counts what goes through Chrome. It does not see the desktop
or phone apps of these assistants.

It estimates the number of tokens from the number of characters (3.8
characters per token, which matches ordinary English and French text). The
error is about 15%, either way.

It does not see what the assistant adds on its own to each message either
(its instructions, the web pages it looks up, its reasoning). The figures
shown are therefore a minimum.

A conversation started before installing is only counted from the
installation on.

---

## For developers

### The files

Chrome isolates extensions from the pages they visit. To read the exchanges,
a script has to run in the page itself, where it has no access to the rest of
the extension. Hence the split into several scripts.

| File | Role |
|---|---|
| [intercept.js](intercept.js) | runs in the page. Reads each exchange as it goes by (`fetch`), counts on the spot, and only passes on numbers |
| [bridge.js](bridge.js) | receives these numbers and hands them to the service worker |
| [background.js](background.js) | service worker. Keeps the registry of each conversation, the month's journal, and decides on the tips that follow a send |
| [rules.js](rules.js) | the rules applied to the draft (sensitive data, secret keys, references) |
| [tips.js](tips.js) | shows the cards in the page and runs their buttons |
| [usage.js](usage.js) | the public prices, and the order of magnitude in euros |
| [providers.js](providers.js) | the four sites, shared by the service worker and the tests |
| [popup.html](popup.html), [popup.js](popup.js) | the popup and its settings |
| [dome.js](dome.js) | the logo, shared by the cards and the popup |
| [_locales/](_locales) | the text, in English (default) and French |

The extension asks for a single permission, `storage`.

### Languages

The text follows the language of the browser, through Chrome's own
translation system (`chrome.i18n`). English is the default; French is used
when Chrome is in French. To add a language, copy `_locales/en/messages.json`
into `_locales/<code>/messages.json` and translate the `message` fields.

### Absolute rule

If the extension fails, the assistant's page must keep working.
`intercept.js` guards every step, always hands the site the original
response (`response.clone()`), and gives up counting when in doubt.

### Checking without a browser

The draft rules and the translations:

```bash
node rules.check.js
```

The adapters, run unchanged on exchanges captured on the real sites
(`fixtures/`):

```bash
node intercept.check.js
```

### Test mode

To check the extension on a site, open the popup, then Settings, then turn
on "Test mode". A panel shows up at the bottom left of each assistant's page:

- one step per tip, ticked as soon as the extension sees it happen (send a
  message, redo an answer, type the example IBAN...);
- the last exchange read: model, reasoning, answer redone, size;
- "Preview" shows every card in turn, to check how it looks on the site;
- "Copy the report" puts what the extension read on this site in the
  clipboard, as JSON.

In test mode, the tips come back at every occasion, and a conversation counts
as long after a page of text. Each send also records the shape of its
request: the field names and short settings ("high", "variant"), with the
message replaced by `<message>` and any other text by its length. That is
what shows where a site keeps a setting the extension does not read yet.
Turning the test mode off erases its log.

### When a site changes

Sites change the shape of their exchanges without notice. To see what the
extension receives, open the site's console and turn on diagnostic mode:

```js
localStorage.setItem("optidome-diagnostic", "1")
```

Reload the page and send a message. The console shows every send from the
page (`[optidome] POST`), the body of the matched request (`[optidome] sent`)
and each piece of the answer (`[optidome] received`). The expected format is
described in comments in `intercept.js`.

### Adding a site

Each site has its adapter in `intercept.js`: the route that sends a message,
and how to read the answer. The four sites do it four different ways:

| Site | Request | Answer |
|---|---|---|
| ChatGPT | JSON | server-sent events, a log of changes |
| Claude | protocol buffers (Connect RPC), in a call of its own | a stream kept open, also in protocol buffers |
| Gemini | a form holding JSON in a string | blocks of JSON, each repeating the whole answer |
| Le Chat | JSON | lines of JSON patches |

To add a site, add an object to `ADAPTERS` modeled on the closest one, the
site's domain to the `matches` blocks of `manifest.json`, its name to `SITE`
in `tips.js`, and its default model to `prices` in `usage.js`, its domain to `providers.js`. Then capture
one real exchange into `fixtures/` (keep only the fields the adapter reads)
so `intercept.check.js` covers it.

Everything at once, including the service worker tests: `npm test`. The
same command runs on every push (`.github/workflows/ci.yml`), which also
builds the package for the Chrome Web Store: the zip is attached to the run,
without the tests, the captured exchanges and the check scripts.

---

## License

The code is under the Apache 2.0 license (see [LICENSE](LICENSE)). The
Optidome name and logo are not covered by this license.

To report a security issue, see [SECURITY.md](SECURITY.md).

The Onest font is under the SIL Open Font License 1.1
([fonts/OFL-onest.txt](fonts/OFL-onest.txt)).
