// ─── Sequence Store ───────────────────────────────────────────────────────────
// Persists user-customized sequences to a local JSON file.
// In production this would be a database.

import fs from 'fs';
import path from 'path';
import { Sequence, DEFAULT_SEQUENCES, SequenceTrigger } from './sequences';
export type { SequenceTrigger };

const STORE_PATH = path.join(__dirname, '../../data/sequences.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadSequences(): Sequence[] {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    saveSequences(DEFAULT_SEQUENCES);
    return DEFAULT_SEQUENCES;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as Sequence[];
  } catch {
    return DEFAULT_SEQUENCES;
  }
}

export function saveSequences(sequences: Sequence[]): void {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(sequences, null, 2));
}

export function getSequenceByTrigger(trigger: string): Sequence | undefined {
  return loadSequences().find((s) => s.trigger === trigger && s.enabled);
}
