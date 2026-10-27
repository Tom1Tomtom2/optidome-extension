import { env, pipeline } from '@huggingface/transformers';
import { PROTOTYPES, inspect, decide, MAX_TOKENS, safeguards, combineExcerpts } from './policy.mjs';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../models/', self.location.href).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let extractor;
let references;
let busy = false;

self.onmessage = async ({ data }) => {
  if (busy || data?.type !== 'analyse') return;
  busy = true;
  const { id, text } = data;
  const partial = data.mode === "excerpts";
  try {
    const reason = inspect(text);
    if (typeof text !== "string" || text.length > 200000) throw new Error("size");
    if (reason && !(reason === "long" && partial)) {
      self.postMessage({ id, type: 'result', result: { level: null, reason, notes: [] } });
      return;
    }
    if (!extractor) {
      self.postMessage({ id, type: 'status', stage: 'loading' });
      extractor = await pipeline('feature-extraction', 'minilm', { dtype: 'q8', device: 'wasm' });
    }
    // Do not silently truncate a long request into a confident recommendation.
    const encoded = partial ? null : await extractor.tokenizer(text, { truncation: false });
    if (encoded && encoded.input_ids.size > MAX_TOKENS) {
      self.postMessage({ id, type: 'result', result: { level: null, reason: 'long', notes: [] } });
      return;
    }
    if (!references) {
      references = [];
      for (const [, example] of PROTOTYPES) {
        const output = await extractor(example, { pooling: 'mean', normalize: true });
        references.push(output.tolist()[0]);
        output.dispose();
      }
    }
    self.postMessage({ id, type: 'status', stage: 'analysing' });
    const start = performance.now();
    let result;
    if (partial) {
      const results=[];
      for (const excerpt of [text.slice(0,1000),text.slice(-1000)]) {
        const encoded = await extractor.tokenizer(excerpt,{truncation:false});
        const ids = Array.from(encoded.input_ids.data,Number);
        const selected = results.length === 0 ? ids.slice(0,64) : ids.slice(-64);
        const bounded = extractor.tokenizer.decode(selected,{skip_special_tokens:true});
        const output = await extractor(bounded,{pooling:'mean',normalize:true});
        results.push(decide(bounded,output.tolist()[0],references));output.dispose();
      }
      result=combineExcerpts(results,safeguards(text));
    } else {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      result = decide(text, output.tolist()[0], references);
      output.dispose();
    }
    self.postMessage({ id, type: 'result', result, durationMs: Math.round(performance.now() - start) });
  } catch {
    // No text or model diagnostic is logged or returned.
    self.postMessage({ id, type: 'error' });
  } finally {
    busy = false;
  }
};
