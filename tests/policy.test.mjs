import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, safeguards, decide, PROTOTYPES } from '../analyse/policy.mjs';

test('missing, overlong and context-dependent requests abstain before loading', () => {
  assert.equal(inspect('merci'), 'short');
  assert.equal(inspect('a'.repeat(8001)), 'long');
  assert.equal(inspect('Continue la démonstration.'), 'context');
  assert.equal(inspect('Résume le fichier joint en trois points.'), 'context');
  assert.equal(inspect('Corrige la ponctuation de ce paragraphe.'), null);
});
test('unsupported and ambiguous embeddings abstain, never fake a probability', () => {
  const vectors = PROTOTYPES.map(() => [0.5, 0.5]);
  const result = decide('Rédige un compte rendu de réunion.', [1, 0], vectors);
  assert.equal(result.level, null);
  assert.equal(result.reason, 'uncertain');
  assert.ok(!('confidence' in result));
});
test('sensitive decisions cannot be casually downgraded by similarity', () => {
  const vectors = PROTOTYPES.map(([level]) => level === 'quick' ? [1, 0] : [0, 1]);
  const result = decide('Reformule cette posologie pour un enfant.', [1, 0], vectors);
  assert.equal(result.level, null);
  assert.equal(result.reason, 'stakes');
});
test('retrieval requirements are distinct from reasoning', () => {
  assert.deepEqual(safeguards('Trouve les dernières sources sur ce sujet.'), ['sources']);
});
test('invalid model output is rejected', () => {
  assert.throws(() => decide('Explique ce concept simplement.', [NaN], []));
});
