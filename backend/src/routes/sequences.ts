import { Router, Request, Response } from 'express';
import { loadSequences, saveSequences } from '../sequenceStore';
import { DEFAULT_SEQUENCES } from '../sequences';

const router = Router();

// GET /api/sequences — list all sequences
router.get('/', (_req: Request, res: Response) => {
  res.json(loadSequences());
});

// PUT /api/sequences/:id — update a sequence
router.put('/:id', (req: Request, res: Response) => {
  const sequences = loadSequences();
  const idx = sequences.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Sequence not found' });
    return;
  }
  sequences[idx] = { ...sequences[idx], ...req.body, id: req.params.id };
  saveSequences(sequences);
  res.json(sequences[idx]);
});

// POST /api/sequences/reset — reset all to defaults
router.post('/reset', (_req: Request, res: Response) => {
  saveSequences(DEFAULT_SEQUENCES);
  res.json(DEFAULT_SEQUENCES);
});

export default router;
