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

  // A short message that asks to redo the previous answer ("non", "plus
  // court", "try again"): the format was missing from the first request.
  // Same rule as above: only the boolean leaves this file.
  const isFollowUpFix = (text) =>
    typeof text === "string" &&
    text.trim().split(/\s+/).length <= 6 &&
    /^(?:non\b|pas (?:ça|ca)\b|(?:c'est |ce n'est )?pas (?:ça|ca|ce que)|plus (?:court|courte|simple|long|longue|clair|claire)\b|trop (?:long|longue|compliqué)\b|reformule|recommence|refais|réessaie|essaie encore|not (?:that|what)|shorter\b|simpler\b|longer\b|too long\b|rephrase|try again|redo\b)/iu.test(
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

  // Test mode, turned on from the popup's settings (bridge.js copies the
  // setting here). Each send then also carries the shape of its request, so
  // a tester can show where a site puts a setting the extension does not
  // read yet (reasoning mode, "try again").
  const testMode = () => {
    try {
      return localStorage.getItem("optidome-test") === "1";
    } catch (error) {
      return false;
    }
  };

  // The shape of a request, without what the person wrote: short single-word
  // strings are kept (settings, model names, actions), any other text becomes
  // its length. The message itself is always replaced, even when it is a
  // single word.
  const TOKEN = /^[\w.:\-]{1,40}$/;
  function shape(value, message, depth = 0) {
    if (typeof value === "string") {
      if (value === message.trim()) return "<message>";
      return TOKEN.test(value) ? value : `<${value.length} chars>`;
    }
    if (value === null || typeof value !== "object") return value;
    if (depth > 7) return "<deeper>";
    if (Array.isArray(value)) {
      // Gemini puts settings past the hundredth place of its array.
      const kept = value.slice(0, 200).map((item) => shape(item, message, depth + 1));
      return value.length > 200 ? [...kept, `<${value.length - 200} more>`] : kept;
    }
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 60)) out[key] = shape(item, message, depth + 1);
    return out;
  }

  // Test mode only: what the tester's assistant sent, as numbers and shapes.
  function reportTest(event) {
    try {
      window.postMessage({ source: "optidome-test", ...event }, window.location.origin);
    } catch (error) {
      // Same rule as the measures: never disturb the page.
    }
  }

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
    // Seen on 2026-10-22, signed in: the "Think" switch sends
    // system_hints ["reason"], and "Try again" sends action "variant".
    deep: (sent) => Array.isArray(sent?.system_hints) && sent.system_hints.includes("reason"),
    regenerated: (sent) => sent?.action === "variant",
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

  // --- Protocol buffers, read without their schema (Claude) ------------------
  //
  // A message is a list of fields: a number, then a varint or a length and
  // bytes. Field numbers below were read on the real traffic.

  function fields(bytes) {
    const out = [];
    let i = 0;
    const varint = () => {
      let value = 0;
      for (let shift = 0; ; shift += 7) {
        const byte = bytes[i++];
        if (byte === undefined) throw new Error("truncated");
        value += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) return value;
      }
    };
    while (i < bytes.length) {
      const key = varint();
      const wire = key % 8;
      if (wire === 0) out.push([Math.floor(key / 8), varint()]);
      else if (wire === 2) {
        const length = varint();
        out.push([Math.floor(key / 8), bytes.subarray(i, i + length)]);
        i += length;
      } else if (wire === 1) i += 8;
      else if (wire === 5) i += 4;
      else throw new Error("not a message");
    }
    return out;
  }

  // The first value at this path of field numbers, or undefined.
  function pick(bytes, ...path) {
    let current = bytes;
    for (const number of path) {
      if (!(current instanceof Uint8Array)) return undefined;
      try {
        current = fields(current).find(([field]) => field === number)?.[1];
      } catch (error) {
        return undefined;
      }
    }
    return current;
  }

  const utf8 = new TextDecoder();
  const pickText = (bytes, ...path) => {
    const value = pick(bytes, ...path);
    return value instanceof Uint8Array ? utf8.decode(value) : undefined;
  };

  // Test mode: the field tree of a message, as [number, value] pairs. Bytes
  // that read as text go through shape(); the others are read as a nested
  // message when they parse as one.
  function protoShape(bytes, message, depth = 0) {
    let list;
    try {
      list = fields(bytes);
    } catch (error) {
      return `<${bytes.length} bytes>`;
    }
    return list.slice(0, 40).map(([number, value]) => {
      if (!(value instanceof Uint8Array)) return [number, value];
      const text = utf8.decode(value);
      if (value.length > 0 && !/[\u0000-\u0008\u000e-\u001f�]/.test(text)) return [number, shape(text, message)];
      return [number, depth < 6 ? protoShape(value, message, depth + 1) : `<${value.length} bytes>`];
    });
  }

  // Format seen on 2026-10-27 (Connect RPC, protocol buffers). Two calls:
  // - PerformAction sends the message: [2][3] is its text, [2][7][2] the
  //   model, [1][2] the conversation, and [1][1][2] counts the turns (1 on
  //   the first message).
  // - StreamTimeline, opened before the send and kept open, carries events in
  //   envelopes (1 flag byte, 4 length bytes). [1][1][2] is the conversation's
  //   state: [1] its id, [3] its status, 2 while answering then 1. [1][1][5]
  //   is a finished block of the answer, its text in [9].
  // So a send is remembered until its conversation goes from 2 back to 1, and
  // an answer that ends first (the send's body is read in the background)
  // waits a few seconds for its send. An older answer came from elsewhere
  // (another tab, the desktop app) and is dropped.
  const claudeSends = new Map(); // conversation -> what was sent
  const claudeAnswers = new Map(); // conversation -> { answer, at }
  const ANSWER_WAIT_MS = 5000;

  function pairClaude(conversation) {
    const sent = claudeSends.get(conversation);
    const waiting = claudeAnswers.get(conversation);
    if (!sent || !waiting) return;
    claudeSends.delete(conversation);
    claudeAnswers.delete(conversation);
    if (Date.now() - waiting.at > ANSWER_WAIT_MS) return;
    report({
      provider: "claude",
      model: sent.model,
      conversation,
      firstTurn: sent.firstTurn,
      tokensSent: estimateTokens(sent.text),
      tokensReceived: estimateTokens(waiting.answer),
      justThanks: isJustThanks(sent.text),
      followUpFix: isFollowUpFix(sent.text),
      // Not found yet in Claude's requests: null says "not read", not "no".
      deep: null,
      regenerated: null,
      shape: sent.shape,
    });
  }

  const CLAUDE = {
    name: "claude",
    matches: (url, method) =>
      method === "POST" && /ConversationService\/(PerformAction|StreamTimeline)/.test(url),

    async onRequest(url, requestCopy) {
      if (!url.includes("/PerformAction") || !requestCopy) return;
      const body = new Uint8Array(await requestCopy.arrayBuffer());
      const text = pickText(body, 2, 3);
      const conversation = pickText(body, 1, 2);
      if (text === undefined || !conversation) {
        // Another action than a send ("try again" may be one of them): in
        // test mode, its shape goes in the report.
        if (testMode()) reportTest({ provider: "claude", kind: "action", shape: protoShape(body, "") });
        return;
      }
      claudeSends.set(conversation, {
        text,
        model: pickText(body, 2, 7, 2) ?? "unknown",
        firstTurn: pick(body, 1, 1, 2) === 1,
        shape: testMode() ? protoShape(body, text) : undefined,
      });
      if (diagnostic()) console.log("[optidome] sent", conversation, claudeSends.get(conversation));
      pairClaude(conversation);
    },

    async onResponse(url, stream) {
      if (!url.includes("/StreamTimeline")) return;
      const reader = stream.getReader();
      let buffer = new Uint8Array(0);
      let conversation = null;
      let answering = false;
      const blocks = new Map(); // block id -> finished text

      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          return; // the site closed the stream
        }
        if (chunk.done) return;
        const joined = new Uint8Array(buffer.length + chunk.value.length);
        joined.set(buffer);
        joined.set(chunk.value, buffer.length);
        buffer = joined;

        while (buffer.length >= 5) {
          const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(1);
          if (buffer.length < 5 + length) break;
          const flags = buffer[0];
          const message = buffer.slice(5, 5 + length);
          buffer = buffer.slice(5 + length);
          if (flags & 2) continue; // end of stream, as JSON

          const state = pick(message, 1, 1, 2);
          if (state) {
            conversation = pickText(state, 1) ?? conversation;
            const status = pick(state, 3);
            if (status === 2) answering = true;
            if (status === 1 && answering) {
              answering = false;
              claudeAnswers.set(conversation, { answer: [...blocks.values()].join(""), at: Date.now() });
              blocks.clear();
              pairClaude(conversation);
            }
          }

          // Blocks seen outside an answer are history the stream replays.
          const block = pick(message, 1, 1, 5);
          if (block && answering) blocks.set(pickText(block, 1), pickText(block, 9) ?? "");
          if (diagnostic()) console.log("[optidome] received", { conversation, answering, block: Boolean(block) });
        }
      }
    },
  };

  // Claude's older route, still served to some accounts (seen on 2026-10-28
  // in a test mode report, while another account got the Connect RPC above).
  // The request is JSON with the text in "prompt"; the answer is server-sent
  // events in the shape of Anthropic's API (content_block_delta, text_delta).
  // "Try again" is assumed to post to retry_completion: to confirm.
  const CLAUDE_REST = {
    name: "claude",
    matches: (url, method) =>
      method === "POST" && /\/chat_conversations\/[^/]+\/(retry_)?completion(\?|$)/.test(url),
    model: (sent) => sent?.model ?? "unknown",
    regenerated: (sent, url) => url.includes("/retry_completion"),
    conversation: (sent, url) => /\/chat_conversations\/([^/]+)\//.exec(url)?.[1] ?? null,
    // On the first turn, the parent is a known all-zero id.
    firstTurn: (sent) => sent?.parent_message_uuid === "00000000-0000-4000-8000-000000000000",
    sentMessage: (sent) => sent?.prompt ?? "",
    accumulator() {
      let text = "";
      return {
        // Only text deltas: the reasoning comes as thinking_delta, not counted.
        line(object) {
          if (object?.delta?.type === "text_delta" && typeof object.delta.text === "string") text += object.delta.text;
        },
        result: () => ({ text, conversation: null }),
      };
    },
  };

  // Format seen on 2026-10-27. The request is JSON: the text is in
  // content[] on the first message (mode "create"), in messageInput[] with a
  // chatId afterwards (mode "append"); the model is modelConfig.model_alias.
  // The answer is lines "<number>:<JSON>". The bootstrap line gives the
  // conversation id; then the assistant message is built by JSON patches on
  // its contentChunks, where the model's reasoning carries _context.type
  // "reasoning". Only the visible answer is counted, like on ChatGPT.
  function applyPatch(target, { op, path, value }) {
    const keys = path.split("/").slice(1);
    const last = keys.pop();
    const parent = keys.reduce((node, key) => node?.[key], target);
    if (parent == null) return;
    if (op === "remove") Array.isArray(parent) ? parent.splice(Number(last), 1) : delete parent[last];
    else if (op === "add" && Array.isArray(parent)) parent.splice(last === "-" ? parent.length : Number(last), 0, value);
    else if (op === "append") parent[last] = (parent[last] ?? "") + value;
    else parent[last] = value;
  }

  const MISTRAL = {
    name: "mistral",
    matches: (url, method) => method === "POST" && /\/api\/chat(\?|$)/.test(url),
    model: (sent) => sent?.modelConfig?.model_alias ?? "unknown",
    // Seen on 2026-10-28 (test mode): the "Think" switch sends "high" instead
    // of "low", and "try again" sends mode "rewrite", without text.
    deep: (sent) => sent?.modelConfig?.reasoning_effort === "high",
    regenerated: (sent) => sent?.mode === "rewrite",
    conversation: (sent) => sent?.chatId ?? null,
    firstTurn: (sent) => sent?.mode === "create",
    sentMessage: (sent) =>
      (sent?.content ?? sent?.messageInput ?? [])
        .filter((part) => part?.type === "text")
        .map((part) => part.text)
        .join("\n"),
    parseLine: (line) => {
      const found = /^\d+:(.*)$/.exec(line);
      const object = found && JSON.parse(found[1]);
      return object?.json ? [object.json] : [];
    },
    accumulator() {
      let conversation = null;
      const messages = {}; // by id, rebuilt from the patches
      return {
        line(event) {
          if (event.type === "bootstrap") conversation = event.chat?.id ?? conversation;
          if (event.type !== "message") return;
          for (const patch of event.patches ?? []) {
            if (patch.path === "/") messages[event.messageId] = patch.value;
            else if (messages[event.messageId]) applyPatch(messages[event.messageId], patch);
          }
        },
        result: () => ({
          text: Object.values(messages)
            .filter((message) => message?.role === "assistant")
            .flatMap((message) => message.contentChunks ?? [])
            .filter((chunk) => chunk?.type === "text" && chunk?._context?.type !== "reasoning")
            .map((chunk) => chunk.text)
            .join(""),
          conversation,
        }),
      };
    },
  };

  // Format seen on 2026-10-27, signed out. The request is a form:
  //   f.req=[null,"<JSON string>"]
  // whose inner array holds the message at [0][0], and from the second turn on
  // [conversation, answer, draft] ids at [2]. The model is a code in a header.
  // Signed out, Gemini opens a new conversation for every message.
  const geminiIds = (sent) =>
    Array.isArray(sent) ? sent.find((item) => Array.isArray(item) && /^c_\w+$/.test(item[0] ?? "")) : undefined;

  const GEMINI = {
    name: "gemini",
    matches: (url, method) =>
      method === "POST" && url.includes(".BardFrontendService/StreamGenerate"),
    parseSent: (body) => JSON.parse(JSON.parse(new URLSearchParams(body).get("f.req"))[1]),
    model: (sent, headers) => {
      try {
        return JSON.parse(headers.get("x-goog-ext-525001261-jspb"))[4] ?? "unknown";
      } catch (error) {
        return "unknown";
      }
    },
    // Seen on 2026-10-28, signed in (test mode): [96] is 1 in the Thinking
    // and Pro modes, 0 in Fast. [79] numbers the mode (1 Fast, 5 Thinking,
    // 3 Pro) and the header carries a code per model, both likely to change.
    deep: (sent) => sent?.[96] === 1,
    // Test mode: the header that carries the mode, signed in it may say more.
    headerShape: (headers, message) => {
      try {
        return shape(JSON.parse(headers.get("x-goog-ext-525001261-jspb")), message);
      } catch (error) {
        return undefined;
      }
    },
    // Signed out, the ids sit at [2]; signed in (seen on 2026-10-28), around
    // [71], with [2] left empty. So look for the array that starts with the
    // conversation id ("c_...") rather than trust a position.
    conversation: (sent) => geminiIds(sent)?.[0] ?? null,
    firstTurn: (sent) => !geminiIds(sent)?.[0],
    sentMessage: (sent) => sent?.[0]?.[0] ?? "",
    // The answer is not SSE: after ")]}'", each block is a line with its
    // length, then a line [["wrb.fr",null,"<JSON string>"]]. Each block repeats
    // the whole answer so far at [4][0][1][0], and the conversation id at [1][0].
    parseLine: (line) =>
      line.startsWith("[[")
        ? JSON.parse(line)
            .filter((item) => item?.[0] === "wrb.fr" && typeof item[2] === "string")
            .map((item) => JSON.parse(item[2]))
        : [],
    accumulator() {
      let text = "";
      let conversation = null;
      return {
        line(inner) {
          if (typeof inner?.[1]?.[0] === "string") conversation = inner[1][0];
          const answer = inner?.[4]?.[0]?.[1]?.[0];
          if (typeof answer === "string" && answer.length >= text.length) text = answer;
        },
        result: () => ({ text, conversation }),
      };
    },
  };

  const ADAPTERS = [CHATGPT, CLAUDE, CLAUDE_REST, GEMINI, MISTRAL];

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
        if (adapter.parseLine) {
          try {
            for (const object of adapter.parseLine(line)) {
              if (diagnostic()) console.log("[optidome] received", object);
              accumulator.line(object);
            }
          } catch (error) {
            // A line the adapter does not understand: skip it.
          }
          continue;
        }
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

  async function readSentBody(adapter, requestCopy, options) {
    try {
      // Trap of 2026-10-28: Claude's JSON route sends its body as binary, not
      // a string. Blobs and buffers are read from a copy; a ReadableStream
      // would be used up, so it is left alone.
      const raw = options?.body;
      const binary = raw instanceof Blob || raw instanceof ArrayBuffer || ArrayBuffer.isView(raw);
      const body = typeof raw === "string" ? raw : binary ? await new Response(raw).text() : requestCopy ? await requestCopy.text() : null;
      if (body != null) return (adapter.parseSent ?? JSON.parse)(body);
    } catch (error) {
      // No body, or not in the expected shape.
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
    let headers = null;

    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
      const method = (options?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

      adapter = ADAPTERS.find((candidate) => candidate.matches(url, method)) ?? null;
      if (adapter && input instanceof Request) requestCopy = input.clone();
      if (adapter) headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
      // Read before the answer comes back: Claude's answer arrives on another
      // call, already open, and must find the send waiting.
      if (adapter?.onRequest) {
        const body = options?.body ?? null;
        const bytes = body instanceof Uint8Array || body instanceof ArrayBuffer ? new Response(body) : requestCopy;
        adapter.onRequest(url, bytes).catch(() => {});
      }

      // In diagnostic mode, every send is announced. This is how to find the
      // right route when a site renames it, without digging in the Network tab.
      if (diagnostic() && method === "POST") {
        console.log("[optidome] POST", url, adapter ? `matched as ${adapter.name}` : "not matched");
      }
      // In test mode, the other sends of the page are listed by their route
      // only: "try again" may go through one of them.
      if (!adapter && method === "POST" && testMode()) {
        reportTest({ kind: "route", route: new URL(url, location.href).pathname });
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
      if (adapter.onResponse) adapter.onResponse(url, copy.body).catch(() => {});
      else measure(adapter, url, requestCopy, options, headers, copy.body);
    } catch (error) {
      if (diagnostic()) console.warn("[optidome] interception dropped", error);
    }

    return response;
  };

  // Deliberately not awaited: counting must not delay the answer on the page.
  async function measure(adapter, url, requestCopy, options, headers, stream) {
    try {
      const sent = await readSentBody(adapter, requestCopy, options);
      if (diagnostic()) console.log("[optidome] sent", sent);

      const { text, conversation } = await readStream(stream, adapter);
      const message = adapter.sentMessage(sent);

      report({
        provider: adapter.name,
        model: adapter.model(sent, headers),
        conversation: adapter.conversation(sent, url) ?? conversation,
        firstTurn: adapter.firstTurn(sent),
        tokensSent: estimateTokens(message),
        tokensReceived: estimateTokens(text),
        justThanks: isJustThanks(message),
        followUpFix: isFollowUpFix(message),
        // null when the adapter cannot read the setting on this site: "not
        // read" is not "no". The test mode shows the difference.
        deep: adapter.deep ? adapter.deep(sent) === true : null,
        regenerated: adapter.regenerated ? adapter.regenerated(sent, url) === true : null,
        shape: testMode()
          ? {
              request: shape(sent, message),
              headers: adapter.headerShape?.(headers, message),
              // A body still unread: say what kind it was, to read it next time.
              body: sent ? undefined : Object.prototype.toString.call(options?.body ?? requestCopy),
            }
          : undefined,
      });
    } catch (error) {
      if (diagnostic()) console.warn("[optidome] measure failed", error);
    }
  }
})();
