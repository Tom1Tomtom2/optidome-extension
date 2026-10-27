"use strict";

// Runs in the page's world (world MAIN), before the site's bundle. It replaces
// window.fetch to read each exchange as it goes by.
//
// It never lets any text out. It counts on the spot and only sends numbers to
// the rest of the extension. Conversation content stays inside this function
// for as long as the count takes.

(() => {
  // An estimate. A real tokenizer (gpt-tokenizer, o200k_base) would give the
  // exact figure for the GPT family; Anthropic does not publish one.
  // 3.8 characters per token matches everyday French and English. Expect about
  // 15% error, either way.
  const CHARS_PER_TOKEN = 3.8;

  const estimateTokens = (text) =>
    typeof text === "string" && text.length > 0 ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;

  // A message made only of thanks or approval, three words at most.
  // The text does not leave this file: only the boolean goes out with the numbers.
  const isJustThanks = (text) =>
    typeof text === "string" &&
    /^(?:(?:merci|ok|okay|super|parfait|top|génial|nickel|cool|thanks|thank|you|thx|beaucoup|bien|très|great|perfect|👍|🙏|😊)[\s!.,]*){1,3}$/iu.test(
      text.trim()
    );

  // Diagnostic mode: logs the raw shape of requests and responses in the
  // console, to check the adapters below when a site changes.
  // Turn it on from the site's console:
  //   localStorage.setItem("optidome-diagnostic", "1")
  const diagnostic = () => {
    try {
      return localStorage.getItem("optidome-diagnostic") === "1";
    } catch (error) {
      return false;
    }
  };

  // --- Adapters --------------------------------------------------------------
  //
  // One adapter per provider. This is the only part that ages: sites rename
  // their routes and change the shape of their responses without notice. The
  // diagnostic mode is how to check them again.

  const CHATGPT = {
    name: "chatgpt",
    // "backend-api" when signed in, "backend-anon" when not. The "f/" is
    // optional depending on the site's version. The end of the pattern avoids
    // /conversation/<id>, which reloads a conversation rather than sending to it.
    matches: (url, method) =>
      method === "POST" && /\/backend-[a-z]+\/(f\/)?conversation(\?|$)/.test(url),
    model: (sent) => sent?.model ?? "unknown",
    conversation: (sent) => sent?.conversation_id ?? null,
    // On the very first turn, ChatGPT has no conversation id yet and names
    // "client-created-root" as the parent. The id arrives in the response,
    // where the accumulator picks it up.
    firstTurn: (sent) =>
      sent?.conversation_id == null || sent?.parent_message_id === "client-created-root",
    sentMessage: (sent) =>
      (sent?.messages ?? [])
        .flatMap((message) => message?.content?.parts ?? [])
        .filter((part) => typeof part === "string")
        .join("\n"),
    // Format seen on 2026-09-06. The stream is a log of changes:
    //   {"p":"/message/content/parts/0","o":"append","v":"Hello"}
    //   {"v":" How are you?"}
    //   {"p":"","o":"patch","v":[...]}
    // The "p" field names the place being changed. Following lines without "p"
    // continue at the same place. This cursor must be followed, otherwise we
    // also count what goes to places other than the visible answer.
    //
    // Format seen on 2026-10-22 (delta_encoding v1), on top of the previous one:
    //   {"v":{"message":{"author":{"role":"assistant"},"content":{"parts":["Red"]}}}}
    //   {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":", blue"}, ...]}
    //   {"v":[...]}   <- no "o": continues the previous operation, here a batch
    // So the answer starts inside a full message, then moves forward in batches.
    accumulator() {
      let text = "";
      let snapshot = "";
      let conversation = null;
      let place = "";
      let operation = "";

      const apply = (path, op, value) => {
        if (op === "patch" && Array.isArray(value)) {
          for (const sub of value) apply(sub?.p ?? "", sub?.o ?? "", sub?.v);
        } else if (typeof value === "string" && op !== "replace" && path.includes("/content/parts/")) {
          text += value;
        }
      };

      return {
        line(object) {
          if (typeof object?.conversation_id === "string") {
            conversation = object.conversation_id;
          }

          // Start of an answer: the message arrives whole, with its first
          // piece. It carries a channel number ("c"), hence its place before
          // the channel rule below.
          const message = object?.v?.message;
          if (message?.author?.role === "assistant" && message?.content?.content_type === "text") {
            text += (message.content.parts ?? []).filter((part) => typeof part === "string").join("");
          }

          if (typeof object?.p === "string") {
            place = object.p;
          } else if (object?.c !== undefined) {
            // Line tied to a channel other than the one we follow.
            return;
          }
          if (typeof object?.o === "string") operation = object.o;

          apply(place, operation, object?.v);

          // Old format, where the full message was sent again each time.
          // Kept as a fallback, used only if nothing was accumulated.
          const parts = object?.message?.content?.parts;
          if (Array.isArray(parts)) {
            snapshot = parts.filter((part) => typeof part === "string").join("");
          }
        },
        result: () => ({ text: text || snapshot, conversation }),
      };
    },
  };

  const CLAUDE = {
    name: "claude",
    matches: (url, method) =>
      method === "POST" && /\/chat_conversations\/[^/]+\/completion/.test(url),
    model: (sent) => sent?.model ?? "unknown",
    conversation: (sent, url) => {
      const found = /\/chat_conversations\/([^/]+)\//.exec(url ?? "");
      return found ? found[1] : sent?.conversation_uuid ?? null;
    },
    // On the first turn, Claude names a known null id as the parent.
    firstTurn: (sent) => sent?.parent_message_uuid === "00000000-0000-4000-8000-000000000000",
    sentMessage: (sent) => sent?.prompt ?? "",
    accumulator() {
      let text = "";
      return {
        line(object) {
          const added = object?.delta?.text ?? object?.completion;
          if (typeof added === "string") text += added;
        },
        result: () => ({ text, conversation: null }),
      };
    },
  };

  const ADAPTERS = [CHATGPT, CLAUDE];

  // --- Reading the stream ----------------------------------------------------

  // Trap hit on 2026-10-22: after "[DONE]", ChatGPT aborts the request
  // (AbortController). The copy read here then threw an AbortError instead of
  // ending normally, and the measure was lost. So we stop at "[DONE]", and an
  // aborted stream returns what was already read.
  async function readStream(stream, adapter) {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    const accumulator = adapter.accumulator();
    let rest = "";

    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (diagnostic()) console.warn("[optidome] stream aborted", error);
        break;
      }
      const { done, value } = chunk;
      if (done) break;
      rest += value;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          reader.cancel().catch(() => {});
          return accumulator.result();
        }
        if (payload === "") continue;
        try {
          const object = JSON.parse(payload);
          if (diagnostic()) console.log("[optidome] received", object);
          accumulator.line(object);
        } catch (error) {
          // Non JSON line: the stream has some, this is not an anomaly.
        }
      }
    }
    return accumulator.result();
  }

  async function readSentBody(requestCopy, options) {
    try {
      if (options && typeof options.body === "string") return JSON.parse(options.body);
      if (requestCopy) return JSON.parse(await requestCopy.text());
    } catch (error) {
      // No body, or not JSON.
    }
    return null;
  }

  function report(measure) {
    try {
      window.postMessage({ source: "optidome-measure", ...measure }, window.location.origin);
    } catch (error) {
      // A lost measure must not disturb the page.
    }
  }

  // --- Replacing fetch -------------------------------------------------------
  //
  // Absolute rule: whatever happens here, the page must keep working. Every
  // step is guarded, and on failure we return the original response without
  // counting anything.

  const originalFetch = window.fetch;

  window.fetch = async function (input, options) {
    let adapter = null;
    let url = "";
    let requestCopy = null;

    try {
      url = typeof input === "string" ? input : input?.url ?? "";
      const method = (options?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

      adapter = ADAPTERS.find((candidate) => candidate.matches(url, method)) ?? null;
      if (adapter && input instanceof Request) requestCopy = input.clone();

      // In diagnostic mode, every send is announced. This is how to find the
      // right route when a site renames it, without digging in the Network tab.
      if (diagnostic() && method === "POST") {
        console.log("[optidome] POST", url, adapter ? `matched as ${adapter.name}` : "not matched");
      }
    } catch (error) {
      adapter = null;
    }

    const response = await originalFetch.apply(this, arguments);
    if (!adapter || !response.body || !response.ok) return response;

    try {
      // Duplicate with clone(), and hand the site the original response,
      // untouched.
      //
      // Trap hit on 2026-09-06, not to repeat: the first version split the
      // stream in two with tee() and gave the site a rebuilt Response. Counting
      // worked, but ChatGPT stayed stuck on "answer in progress" and the stop
      // button no longer responded. A rebuilt Response is not equivalent.
      const copy = response.clone();
      measure(adapter, url, requestCopy, options, copy.body);
    } catch (error) {
      if (diagnostic()) console.warn("[optidome] interception dropped", error);
    }

    return response;
  };

  // Deliberately not awaited: counting must not delay the answer on the page.
  async function measure(adapter, url, requestCopy, options, stream) {
    try {
      const sent = await readSentBody(requestCopy, options);
      if (diagnostic()) console.log("[optidome] sent", sent);

      const { text, conversation } = await readStream(stream, adapter);
      const message = adapter.sentMessage(sent);

      report({
        provider: adapter.name,
        model: adapter.model(sent),
        conversation: adapter.conversation(sent, url) ?? conversation,
        firstTurn: adapter.firstTurn(sent),
        tokensSent: estimateTokens(message),
        tokensReceived: estimateTokens(text),
        justThanks: isJustThanks(message),
      });
    } catch (error) {
      if (diagnostic()) console.warn("[optidome] measure failed", error);
    }
  }
})();
