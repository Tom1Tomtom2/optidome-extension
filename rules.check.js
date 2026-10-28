"use strict";

// Checks the rules and the translations, without a browser:
// `node rules.check.js`.

const fs = require("fs");
const R = require("./rules.js");

let checks = 0;
const check = (expected, actual, name) => {
  checks += 1;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// What the card shows; the excerpt and the example are checked separately.
const shown = (tip) => tip && { id: tip.id, ...(tip.kind ? { kind: tip.kind } : {}) };

// Builds a valid French social security number from its first 13 characters.
const nirWithKey = (body) => {
  let rest = 0;
  for (const c of body.replace("2A", "19").replace("2B", "18")) rest = (rest * 10 + Number(c)) % 97;
  return body + String(97 - rest).padStart(2, "0");
};

const cases = [
  ["draft too short", null, "merci"],
  ["OpenAI key", { id: "key" }, "Pourquoi ma cle sk-proj-abcdefghijklmnopqrstuvwxyz123456 ne marche pas ?"],
  ["AWS key", { id: "key" }, "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE puis la commande"],
  ["valid IBAN", { id: "data", kind: "iban" }, "Mon IBAN est FR76 3000 6000 0112 3456 7890 189, fais le courrier"],
  ["wrong IBAN", null, "Mon IBAN est FR76 3000 6000 0112 3456 7890 188, fais le courrier"],
  ["valid card", { id: "data", kind: "card" }, "Le client a paye avec la carte 4111 1111 1111 1111 hier"],
  ["wrong card", null, "Le client a paye avec la carte 4111 1111 1111 1112 hier"],
  ["order number", null, "Ma commande 1234567890123456 n'est pas arrivee, ecris au vendeur"],
  ["social security", { id: "data", kind: "ssn" }, `Remplis le formulaire avec ${nirWithKey("1850578006084")} stp`],
  ["social security, Corsica", { id: "data", kind: "ssn" }, `Numero ${nirWithKey("28507" + "2A" + "123456")} a verifier`],
  ["three emails", { id: "data", kind: "emails" }, "Ecris a a.b@x.fr, c@y.com et d@z.org pour la reunion"],
  ["two emails", null, "Ecris a a.b@x.fr et c@y.com pour la reunion de demain"],
  ["sources", { id: "references" }, "Donne-moi des sources recentes sur la semaine de quatre jours"],
  ["legal article", { id: "references" }, "Quel article du code du travail encadre les astreintes ?"],
  ["source code", null, "Corrige le code source de ma fonction de tri"],
  ["rewording", null, "Reformule cet email pour le rendre plus professionnel"],
  ["English references", { id: "references" }, "Give me references on the four day work week"],
  ["English case law", { id: "references" }, "What case law covers on-call time in the UK?"],
  ["English source code", null, "Fix the source code of my sorting function"],
  ["English card", { id: "data", kind: "card" }, "The customer paid with card 4111 1111 1111 1111 yesterday"],
];

for (const [name, expected, text] of cases) check(expected, shown(R.tipForDraft(text)), name);

// The "Replace with an example" button finds the exact text, and the example
// does not trigger the tip again.
const iban = R.tipForDraft("Mon IBAN est FR76 3000 6000 0112 3456 7890 189, fais le courrier");
check("FR76 3000 6000 0112 3456 7890 189", iban.excerpt, "IBAN excerpt");
for (const text of [
  "Mon IBAN est FR76 3000 6000 0112 3456 7890 189, fais le courrier",
  "Le client a paye avec la carte 4111 1111 1111 1111 hier",
  `Remplis le formulaire avec ${nirWithKey("1850578006084")} stp`,
  "Pourquoi ma cle sk-proj-abcdefghijklmnopqrstuvwxyz123456 ne marche pas ?",
]) {
  const tip = R.tipForDraft(text);
  check(null, R.tipForDraft(text.replace(tip.excerpt, tip.example)), `neutral example (${tip.id})`);
}

check(R.fingerprint("abc"), R.fingerprint("abc"), "stable fingerprint");
check(false, R.fingerprint("abc") === R.fingerprint("abd"), "different fingerprint");

// The translations: both languages have the same keys, and every key the
// code asks for exists. Keys built from a variable are listed by hand.
const en = JSON.parse(fs.readFileSync(`${__dirname}/_locales/en/messages.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${__dirname}/_locales/fr/messages.json`, "utf8"));
check(Object.keys(en).sort(), Object.keys(fr).sort(), "same keys in en and fr");
const code = ["tips.js", "popup.js", "popup.html", "manifest.json"].map((file) => fs.readFileSync(`${__dirname}/${file}`, "utf8")).join("\n");
const used = [
  ...[...code.matchAll(/\bt\("(\w+)"/g)].map((m) => m[1]),
  ...[...code.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]),
  ...[...code.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
  ...["iban", "card", "ssn", "emails"].map((kind) => `dataTitle_${kind}`),
  // Keys picked by a condition.
  ...["longText", "longTextCount", "todoLongText", "todoLongTextAtLeast", "messageOne", "messageMany"],
  ...["conversationOne", "conversationMany", "assistantOne", "assistantMany", "cleared", "clearFailed", "dataTextOne", "dataTextMany"],
  "habit_newConversation",
  "habit_dataRemoved",
  "weeklyTip1",
  "weeklyTip2",
  "weeklyTip3",
  "weeklyTip4",
  // The test panel's steps, built from STEPS in tips.js.
  ...["testStep_read", "testStep_follow", "testStep_deep", "testStep_redo", "testStep_thanks", "testStep_fix"],
  ...["testStep_key", "testStep_iban", "testStep_pasted", "testStep_long"],
];
check([], used.filter((key) => !en[key]), "every key used exists");
// A "$" not followed by a digit or another "$" would be eaten by chrome.i18n.
for (const [lang, messages] of [["en", en], ["fr", fr]]) {
  for (const [key, { message }] of Object.entries(messages)) {
    check(false, /\$(?![\d$])/.test(message.replace(/\$\$/g, "")), `lone $ in ${lang}.${key}`);
  }
}

// And every key of the files is still used somewhere.
check([], Object.keys(en).filter((key) => !used.includes(key) && !code.includes(`"${key}"`)), "every key exists for a reason");

console.log(`rules and translations: ${checks} checks passed`);
