"use strict";

// The rules that pick a tip from the draft. Pure functions, with no DOM and no
// chrome.*, so they can be checked outside the browser (rules.check.js). The
// text is never kept: it is read, judged, forgotten.

const TipRules = (() => {
  // --- Secret keys -----------------------------------------------------------

  const KEY_PATTERNS = [
    /\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}/, // OpenAI, Anthropic
    /\bAKIA[0-9A-Z]{16}\b/, // AWS
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
    /\bAIza[0-9A-Za-z_-]{35}\b/, // Google
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

  // The key found, so the card can remove it from the draft, or null.
  const findKey = (text) => KEY_PATTERNS.map((pattern) => text.match(pattern)?.[0]).find(Boolean) ?? null;

  // --- Personal or banking data ---------------------------------------------
  //
  // Each number is checked against its check digits, otherwise we would cry
  // wolf on any string of digits (order number, ticket number).

  // Remainder of the division by 97 of a number written in digits, too long
  // for a Number: handled piece by piece.
  function mod97(digits) {
    let rest = 0;
    for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
    return rest;
  }

  function isValidIban(raw) {
    const iban = raw.replace(/\s/g, "").toUpperCase();
    if (iban.length < 15 || iban.length > 34) return false;
    const rotated = iban.slice(4) + iban.slice(0, 4);
    const digits = rotated.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
    return mod97(digits) === 1;
  }

  function isValidCard(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    // Visa, Mastercard, Amex, Discover and CB start with 3 to 6.
    if (!/^[3-6]/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
      let digit = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  }

  // French social security number (NIR): 13 characters then a 2 digit key,
  // equal to 97 minus the remainder of the division by 97. Corsica (2A, 2B)
  // counts as 19 and 18 in the calculation.
  // shortcut: French numbers only, add other countries' formats when a user asks.
  function isValidNir(raw) {
    const nir = raw.replace(/[\s.]/g, "").toUpperCase();
    if (!/^[12]\d{4}(?:\d{2}|2[AB])\d{8}$/.test(nir)) return false;
    const body = nir.slice(0, 13).replace("2A", "19").replace("2B", "18");
    return 97 - mod97(body) === Number(nir.slice(13));
  }

  const find = (text, pattern, isValid) =>
    (text.match(pattern) ?? []).find((candidate) => isValid(candidate)) ?? null;

  // The kind of data the card names on screen, the text found and an example
  // to replace it with (chosen so it no longer passes the check digits), or
  // null. Email addresses have no example: we cannot tell which one to keep.
  function findSensitiveData(text) {
    let excerpt = find(text, /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi, isValidIban);
    if (excerpt) return { kind: "iban", excerpt, example: "FR00 0000 0000 0000 0000 0000 000" };
    excerpt = find(text, /\b(?:\d[ -]?){12,18}\d\b/g, isValidCard);
    if (excerpt) return { kind: "card", excerpt, example: "0000 0000 0000 0000" };
    excerpt = find(text, /\b[12][\s.]?\d{2}[\s.]?\d{2}[\s.]?(?:\d{2}|2[AB])[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{2}\b/gi, isValidNir);
    if (excerpt) return { kind: "ssn", excerpt, example: "0 00 00 00 000 000 00" };
    if ((text.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi) ?? []).length >= 3) {
      return { kind: "emails" };
    }
    return null;
  }

  // --- Asking for references -------------------------------------------------
  //
  // "sources" in the plural only, so "code source" and "source code" do not match.

  const REFERENCE_PATTERNS = [
    /\b(?:sources|références|references|bibliographie|bibliography|jurisprudences?|case law|posologie|dosage|citations?)\b/i,
    /\bcite[rsz]?\b/i,
    /\barticles? (?:de loi|du code|[LRD]\.? ?\d)/i,
  ];

  const asksForReferences = (text) => REFERENCE_PATTERNS.some((pattern) => pattern.test(text));

  // --- Picking the tip -------------------------------------------------------

  // The tip to show for this draft, by order of priority, or null.
  // A draft that is too short says nothing reliable.
  function tipForDraft(text) {
    if (typeof text !== "string" || text.trim().length < 12) return null;
    const key = findKey(text);
    if (key) return { id: "key", excerpt: key, example: "[***]" };
    const data = findSensitiveData(text);
    if (data) return { id: "data", ...data };
    if (asksForReferences(text)) return { id: "references" };
    return null;
  }

  // Fingerprint of a pasted text (FNV-1a), to recognize a paste already made
  // without keeping the text. Not cryptographic: it never leaves the page.
  function fingerprint(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16) + ":" + text.length;
  }

  return { tipForDraft, findSensitiveData, findKey, asksForReferences, fingerprint, isValidIban, isValidCard, isValidNir };
})();

if (typeof module !== "undefined") module.exports = TipRules;
