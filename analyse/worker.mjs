import { env, pipeline } from '@huggingface/transformers';
import { PROTOTYPES, inspect, decide, MAX_TOKENS } from './policy.mjs';

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
  try {
    const reason = inspect(text);
    if (reason) {
      self.postMessage({ id, type: 'result', result: { level: null, reason, notes: [] } });
      return;
    }
    if (!extractor) {
      self.postMessage({ id, type: 'status', stage: 'loading' });
      extractor = await pipeline('feature-extraction', 'minilm', { dtype: 'q8', device: 'wasm' });
    }
    // Do not silently truncate a long request into a confident recommendation.
    const encoded = await extractor.tokenizer(text, { truncation: false });
    if (encoded.input_ids.size > MAX_TOKENS) {
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
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const result = decide(text, output.tolist()[0], references);
    output.dispose();
    self.postMessage({ id, type: 'result', result, durationMs: Math.round(performance.now() - start) });
  } catch {
    // No text or model diagnostic is logged or returned.
    self.postMessage({ id, type: 'error' });
  } finally {
    busy = false;
  }
};
