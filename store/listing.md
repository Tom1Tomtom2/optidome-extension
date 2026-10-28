# Chrome Web Store listing

Everything to paste into the developer dashboard, in the order of its tabs.
Version 1.0.0. Package: the zip built by the CI (`optidome-companion-1.0.0`).

## Store listing tab

**Name** (from the manifest, not editable here): Optidome Companion
(French: Optidome compagnon)

**Summary** (132 characters max, from the manifest):

- en: Tips at the right moment to protect your data and use ChatGPT, Claude, Gemini and Mistral better. Nothing leaves your browser.
- fr: Conseils au bon moment pour protéger vos données et mieux utiliser ChatGPT, Claude, Gemini et Mistral. Rien ne quitte le navigateur.

**Category**: Productivity

**Languages**: English (default), French

**Official URL / homepage**: https://optidome.app/extension (French), https://optidome.app/en/extension (English)

**Support URL**: https://github.com/Tom1Tomtom2/optidome-extension/issues

### Description, English

Optidome Companion gives you a tip at the right moment while you use ChatGPT, Claude, Gemini or Mistral. A small card appears in a corner of the page only when a tip applies to you, and a button does the work for you when it can.

What it notices:

• You type an IBAN, a card number, a French social security number or several email addresses: it suggests replacing them with an example, which gets you the same answer.
• You paste a secret key, such as an API key: it offers to remove it from your draft, and reminds you to change it.
• You ask for sources or legal articles: it reminds you to check every reference, because AI models sometimes make them up.
• Your conversation has become very long: it prepares a summary so you can start over in a new conversation.
• You send a one-line question with deep reasoning on: it points to the quick mode, which answers as well and faster.
• You redo the same answer three times, or answer "no" or "shorter": it helps you say what you want from the first request.

The popup shows one thing to do now, your good habits, and your month in figures: messages, conversations, and the order of magnitude of what they would cost a company that pays for AI by usage.

Nothing leaves your browser. The extension talks to no server, not even ours. The text of your conversations is read on the spot, then forgotten. It only keeps numbers, in Chrome's own storage, and you can export or erase them from the settings. Your draft is never sent or changed unless you click.

Free and open source (Apache 2.0). The code is at github.com/Tom1Tomtom2/optidome-extension.

It works on chatgpt.com, claude.ai, gemini.google.com and chat.mistral.ai, in English and French. It counts what goes through Chrome only: the desktop and phone apps are not seen, and the figures are a minimum.

### Description, French

Optidome compagnon vous donne un conseil au bon moment quand vous utilisez ChatGPT, Claude, Gemini ou Mistral. Une petite carte apparaît dans un coin de la page seulement quand un conseil vous concerne, et un bouton fait le travail à votre place quand il le peut.

Ce qu'elle remarque :

• Vous tapez un IBAN, un numéro de carte, un numéro de sécurité sociale ou plusieurs adresses email : elle propose de les remplacer par un exemple, qui vous donnera la même réponse.
• Vous collez une clé secrète, par exemple une clé d'API : elle propose de la retirer du brouillon, et rappelle de la changer.
• Vous demandez des sources ou des articles de loi : elle rappelle de vérifier chaque référence, car les modèles d'IA en inventent parfois.
• Votre conversation est devenue très longue : elle prépare un résumé pour repartir dans une nouvelle conversation.
• Vous envoyez une question d'une ligne avec la réflexion approfondie : elle indique le mode rapide, qui répond aussi bien et plus vite.
• Vous refaites trois fois la même réponse, ou répondez « non » ou « plus court » : elle vous aide à dire ce que vous voulez dès la première demande.

Le popup montre une chose à faire maintenant, vos bonnes habitudes, et votre mois en chiffres : messages, conversations, et l'ordre de grandeur de ce qu'ils coûteraient à une entreprise qui paie l'IA à l'usage.

Rien ne quitte votre navigateur. L'extension ne parle à aucun serveur, pas même le nôtre. Le texte de vos conversations est lu sur le moment, puis oublié. Elle ne garde que des nombres, dans le stockage de Chrome, et vous pouvez les exporter ou les effacer depuis les réglages. Votre brouillon n'est jamais envoyé ni modifié sans votre clic.

Gratuite et open source (Apache 2.0). Le code est sur github.com/Tom1Tomtom2/optidome-extension.

Elle fonctionne sur chatgpt.com, claude.ai, gemini.google.com et chat.mistral.ai, en français et en anglais. Elle ne compte que ce qui passe par Chrome : les applications de bureau et de téléphone ne sont pas vues, et les chiffres sont un minimum.

### Graphic assets

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon-128.png` (already in the package) |
| Small promo tile | 440×280 | `store/assets/tile-en.png`, `tile-fr.png` |
| Screenshots | 1280×800 | `store/assets/screenshot-1..4-en.png`, `-fr.png` |

The screenshots are the real cards, captured from the extension, set on a plain
page. They are not mock-ups of the sites. Regenerate with `store/make-assets.py`.

## Privacy tab

**Single purpose**: Show tips while the person uses ChatGPT, Claude, Gemini or Mistral, to protect their data and help them use the assistant better, and summarize their usage in a popup.

**Permission justifications**

- `storage`: keeps, on the computer only, the counters shown in the popup (messages, conversations, tips shown), the settings, and the opt-in test log. Nothing else is stored, and nothing is transmitted.
- Host access to chatgpt.com, chat.openai.com, claude.ai, gemini.google.com and chat.mistral.ai (declared as content script matches): the extension reads the draft in the message box to spot sensitive data before it is sent, reads each exchange as it goes by to count messages and tokens, and shows its tip card in the page. It runs on these five addresses only.

**Remote code**: No. All the code is in the package. No `eval`, no script loaded from a server.

**Data usage** (the dashboard's checkboxes). The extension reads website content (the draft and the exchanges) and keeps only counts. Nothing is transmitted off the device. Declare conservatively: tick "Website content", and "User activity" for the counters. Then tick all three certifications: the data is not sold, not used for anything unrelated to the single purpose, not used for creditworthiness or lending.

**Privacy policy URL**:

- https://optidome.app/en/extension-privacy (English)
- https://optidome.app/extension-confidentialite (French)

The dashboard takes one address. Give the English one: the page links to its French twin.

## Test instructions (for the reviewer)

No account on our side, no login. The extension needs a session on one of the
four assistants, a free account is enough.

1. Install, open https://chatgpt.com (or claude.ai, gemini.google.com, chat.mistral.ai) and sign in.
2. Type an example IBAN in the message box, for instance FR76 3000 6000 0112 3456 7890 189. A card "This message contains an IBAN" appears after a moment, with a "Replace with an example" button. Nothing is sent until you press Enter.
3. Click the toolbar icon to see the popup.
4. In the popup's settings, "Test mode" lists the checks and shows what the extension reads. The report it copies holds measures only, never the text of a message.

## Before pressing "Submit for review"

1. CI green on `main` for 1.0.0, then download the zip from the run's artifacts.
2. Upload the zip, fill the tabs above, attach the assets.
3. Set the visibility to **Public**, and the publication to **Deferred** (publish by hand after approval), so the site and the store go live together.
4. Repository `optidome-extension` still private until the store accepts the extension.
