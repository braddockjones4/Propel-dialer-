/**
 * Promo / Discount Code System
 * POST /api/promo/validate   — check if a code is valid, return discount info
 * POST /api/billing/checkout accepts optional promoCode param
 *
 * Codes are managed as Stripe Promotion Codes (created in Stripe dashboard or via API).
 * This keeps discount logic in Stripe so it applies correctly to subscriptions.
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from './auth';

const router = Router();

// ── POST /api/promo/validate ──────────────────────────────────────────────────
router.post('/validate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { code, planId } = req.body;
    if (!code) { res.status(400).json({ error: 'Code required' }); return; }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) { res.status(500).json({ error: 'Stripe not configured' }); return; }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' as any });

    // Search for promotion code
    const promoCodes = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    if (!promoCodes.data.length) {
      res.status(404).json({ error: 'Invalid or expired promo code' }); return;
    }

    const promo = promoCodes.data[0] as any;
    const coupon = promo.coupon;

    let discountText = '';
    if (coupon.percent_off) discountText = `${coupon.percent_off}% off`;
    else if (coupon.amount_off) discountText = `$${(coupon.amount_off / 100).toFixed(0)} off`;
    if (coupon.duration === 'repeating') discountText += ` for ${coupon.duration_in_months} months`;
    else if (coupon.duration === 'once') discountText += ' first month';
    else if (coupon.duration === 'forever') discountText += ' forever';

    res.json({
      valid: true,
      promoId: promo.id,
      code: promo.code,
      discount: discountText,
      percentOff: coupon.percent_off || null,
      amountOff: coupon.amount_off || null,
      duration: coupon.duration,
    });
  } catch (e: any) {
    console.error('[Promo] validate:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
