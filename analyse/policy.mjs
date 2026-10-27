// Provider-neutral, experimental routing. Examples are prototypes, not a
// trained or calibrated classifier. Similarity is never a probability.
export const MAX_CHARS = 8000;
export const MAX_TOKENS = 128;
export const PROTOTYPES = [
  ['quick', 'Corrige les fautes de ce court message sans changer le sens.'],
  ['quick', 'Traduis ce texte en anglais en gardant le ton.'],
  ['quick', 'Reformule ce mail plus poliment et plus brièvement.'],
  ['quick', 'Extrais les noms et les dates de ce texte dans un tableau.'],
  ['quick', 'Résume ce court paragraphe en trois points.'],
  ['quick', 'Donne cinq idées de titre pour mon article.'],
  ['quick', 'Translate this paragraph into French.'],
  ['quick', 'Fix the spelling and punctuation in this short email.'],
  ['quick', 'Convert this list into a JSON array.'],
  ['standard', 'Explique-moi ce concept avec des exemples adaptés à un débutant.'],
  ['standard', 'Prépare un plan de présentation pour mon équipe.'],
  ['standard', 'Rédige un premier brouillon de proposition commerciale.'],
  ['standard', 'Écris une fonction Python qui trie une liste de dates.'],
  ['standard', 'Compare les avantages et inconvénients de ces deux approches.'],
  ['standard', 'Help me plan a workshop with an agenda and activities.'],
  ['standard', 'Write a small JavaScript function with examples.'],
  ['deep', 'Démontre ce théorème et vérifie chaque étape du raisonnement.'],
  ['deep', 'Diagnostique cette condition de concurrence intermittente dans un système distribué.'],
  ['deep', 'Conçois une migration de base de données sans interruption avec retour arrière.'],
  ['deep', 'Résous ce problème d’optimisation avec plusieurs contraintes incompatibles.'],
  ['deep', 'Audite cet algorithme cryptographique et cherche des contre-exemples.'],
  ['deep', 'Find the root cause of this intermittent production deadlock.'],
  ['deep', 'Prove this mathematical statement or construct a counterexample.'],
  ['deep', 'Design a fault-tolerant architecture and justify tradeoffs under conflicting constraints.'],
];

export function inspect(text) {
  if (typeof text !== 'string' || text.trim().length < 12) return 'short';
  if (text.length > MAX_CHARS) return 'long';
  // A standalone draft can depend on information that the optional analyser
  // deliberately does not read. Ask rather than treating it as an easy task.
  if (/^(continue|poursuis|encore|fais (?:pareil|la même chose)|same again|carry on)\b/iu.test(text.trim()) ||
      /\b(ci[- ]dessus|above|pièce jointe|fichier joint|attached file|capture d'écran)\b/iu.test(text)) return 'context';
  return null;
}

export function safeguards(text) {
  const normal = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const notes = [];
  if (/\b(medical|diagnostic medical|medicament|posologie|symptomes?|juridique|legal|contrat|fiscal|investissement|investment|diagnosis|dosage|lawsuit)\b/u.test(normal)) notes.push('stakes');
  if (/\b(aujourd'hui|actuel\w*|recent\w*|latest|today|current|sources|citations|web|meteo)\b/u.test(normal)) notes.push('sources');
  return notes;
}

export function decide(text, embedding, referenceVectors) {
  const blocked = inspect(text);
  if (blocked) return { level: null, reason: blocked, notes: safeguards(text) };
  if (!Array.isArray(referenceVectors) || referenceVectors.length !== PROTOTYPES.length ||
      !Array.isArray(embedding) || !embedding.length || embedding.some(x => !Number.isFinite(x))) {
    throw new Error('Invalid embeddings');
  }
  const scores = { quick: [], standard: [], deep: [] };
  referenceVectors.forEach((vector, index) => {
    if (vector.length !== embedding.length || vector.some(x => !Number.isFinite(x))) throw new Error('Invalid reference vector');
    scores[PROTOTYPES[index][0]].push(vector.reduce((sum, value, i) => sum + value * embedding[i], 0));
  });
  // Average the two nearest examples per class to avoid favouring classes
  // merely because they have more prototypes.
  const ranked = Object.entries(scores).map(([level, values]) => {
    values.sort((a, b) => b - a);
    return { level, score: (values[0] + values[1]) / 2 };
  }).sort((a, b) => b.score - a.score);
  const margin = ranked[0].score - ranked[1].score;
  const notes = safeguards(text);
  // Conservative starting thresholds, to calibrate on independent real tasks.
  if (ranked[0].score < 0.35 || margin < 0.045) return { level: null, reason: 'uncertain', notes };
  if (ranked[0].level === 'quick' && notes.includes('stakes')) return { level: null, reason: 'stakes', notes };
  return { level: ranked[0].level, reason: ranked[0].level, notes };
}
