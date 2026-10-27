# optidome: use your AI better

A free, open source Chrome extension. It gives you tips while you use
ChatGPT, and a grade from A to E every month.

**Nothing leaves your browser.** The extension talks to no server, not even
optidome's. The text of your conversations is read on the spot, then
forgotten. It only keeps numbers, in Chrome's storage.

For now, tips show up on ChatGPT only. The extension speaks English and
French, and follows the language of your browser.

---

## What the extension does

### Tips at the right moment

A small card shows up in a corner of ChatGPT when a tip applies to you. When
it can, a button does the work for you.

| You | The extension suggests |
|---|---|
| type an IBAN, a card number, a French social security number or several email addresses | replacing the data with an example, which will get you the same answer |
| paste a secret key (an API key, for instance) | removing it from the draft, and changing it to be safe |
| ask for sources, citations or legal articles | checking every reference before you reuse it, because AI models sometimes make them up |
| paste a long text already present earlier in the conversation | referring to it, instead of having it reread twice |
| keep going in a conversation that has become very long | preparing a summary to start over in a new conversation |
| send "thank you" on its own | nothing serious, but ChatGPT reread the whole conversation to answer you |
| just installed the extension | checking whether your conversations are used to train ChatGPT |

Your draft is never sent or changed unless you click.

### A grade for the month, from A to E

The grade measures one thing: the share of your messages sent in a
conversation that is too long.

To answer you, ChatGPT rereads the whole conversation from the start, with
every message. A message sent at the end of a long conversation therefore
takes much more work than a message sent in a new one. The extension
considers a conversation too long when ChatGPT has to reread more than
30,000 tokens (about sixty pages of ordinary text) to answer.

| Grade | Share of messages sent in a conversation that is too long |
|---|---|
| A | under 10% |
| B | 10 to 25% |
| C | 25 to 40% |
| D | 40 to 60% |
| E | 60% and over |

The grade shows up after 10 messages in the month.

### A summary to share

The popup also shows your messages and conversations for the month, and what
they would have cost a company that pays for AI by usage. It is an order of
magnitude, calculated from OpenAI's public prices.

The "Share" button draws an image of your grade, in your browser. It contains
no excerpt of your conversations.

---

## Install

The extension is not on the Chrome Web Store yet. To try it:

1. Download this repository ("Code" button, then "Download ZIP") and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on "Developer mode", top right.
4. Click "Load unpacked" and choose the unzipped folder.
5. Open ChatGPT, or reload the tab if it was already open.

The optidome icon shows up in Chrome's toolbar (if needed, pin it from the
puzzle piece icon).

---

## What the extension does not see

The extension counts what goes through Chrome. It does not see the ChatGPT
app on a computer or a phone.

It estimates the number of tokens from the number of characters (3.8
characters per token, which matches ordinary English and French text). The
error is about 15%, either way.

It does not see what ChatGPT adds on its own to each message either (its
instructions, the web pages it looks up, its reasoning). The figures shown
are therefore a minimum.

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
| [grade.js](grade.js) | calculates the grade for the month and the order of magnitude in euros |
| [popup.html](popup.html), [popup.js](popup.js) | the popup and the share image |
| [dome.js](dome.js) | the logo, shared by the cards, the popup and the image |
| [_locales/](_locales) | the text, in English (default) and French |

The extension asks for a single permission, `storage`.

### Languages

The text follows the language of the browser, through Chrome's own
translation system (`chrome.i18n`). English is the default; French is used
when Chrome is in French. To add a language, copy `_locales/en/messages.json`
into `_locales/<code>/messages.json` and translate the `message` fields.

### Absolute rule

If the extension fails, ChatGPT's page must keep working. `intercept.js`
guards every step, always hands the site the original response
(`response.clone()`), and gives up counting when in doubt.

### Checking the rules

The draft rules, the grade and the translations can be checked without a
browser:

```bash
node rules.check.js
```

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
and how to read the answer. To add one, add an object to `ADAPTERS` modeled
on the existing ones, then the site's domain to the `matches` blocks of
`manifest.json`.

---

## License

The code is under the Apache 2.0 license (see [LICENSE](LICENSE)). The
optidome name and logo are not covered by this license.

The Onest font is under the SIL Open Font License 1.1
([fonts/OFL-onest.txt](fonts/OFL-onest.txt)).
