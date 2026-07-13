import { Router, Request, Response } from 'express';
import { loadSequences, saveSequences } from '../sequenceStore';
import { DEFAULT_SEQUENCES } from '../sequences';

const router = Router();

// GET /api/sequences — list all sequences
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(loadSequences());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sequences/:id — update a sequence
router.put('/:id', (req: Request, res: Response) => {
  try {
    const sequences = loadSequences();
    const idx = sequences.findIndex((s) => s.id === req.params.id);
    if (idx === -1) { res.status(404).json({ error: 'Sequence not found' }); return; }
    sequences[idx] = { ...sequences[idx], ...req.body, id: req.params.id };
    saveSequences(sequences);
    res.json(sequences[idx]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sequences/reset — reset all to defaults
router.post('/reset', (_req: Request, res: Response) => {
  try {
    saveSequences(DEFAULT_SEQUENCES);
    res.json(DEFAULT_SEQUENCES);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
