/**
 * Stripe Billing
 * POST /api/billing/checkout       — create Stripe Checkout session
 * POST /api/billing/portal         — customer portal (manage subscription)
 * POST /api/billing/webhook        — Stripe webhook (update plan in DB)
 * GET  /api/billing/plans          — list available plans
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from './auth';
import prisma from '../db';

const router = Router();
const db = prisma as any;

const PLANS = [
  {
    id:          'starter',
    name:        'Starter',
    price:       99,
    priceId:     process.env.STRIPE_PRICE_STARTER || '',
    features:    ['Single-line dialing', 'SMS Blast', 'Inbox', '1,000 contacts', 'Basic analytics'],
    callsPerDay: 100,
  },
  {
    id:          'pro',
    name:        'Pro',
    price:       199,
    priceId:     process.env.STRIPE_PRICE_PRO || '',
    features:    ['Triple-line dialing', 'VM Blast', 'AI Script', 'Email sequences', 'Appointments', 'DNC scrub', '2,500 contacts', 'Advanced analytics'],
    callsPerDay: 300,
    badge:       'Most Popular',
  },
  {
    id:          'elite',
    name:        'Elite',
    price:       399,
    priceId:     process.env.STRIPE_PRICE_ELITE || '',
    features:    ['Everything in Pro', 'AI Next-Action engine', 'AI transcription & scoring', 'Unlimited contacts', 'Priority support'],
    callsPerDay: -1, // unlimited
  },
];

// ── GET /api/billing/plans ────────────────────────────────────────────────────
router.get('/plans', (_req: Request, res: Response) => {
  res.json(PLANS);
});

// ── POST /api/billing/checkout ────────────────────────────────────────────────
router.post('/checkout', requireAuth, async (req: any, res: Response) => {
  try {
    const { planId } = req.body;
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) { res.status(400).json({ error: 'Invalid plan' }); return; }
    if (!plan.priceId) { res.status(400).json({ error: 'Stripe price not configured for this plan' }); return; }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) { res.status(500).json({ error: 'Stripe not configured' }); return; }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' as any });

    // Get or create customer
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.name,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      await db.user.update({ where: { id: req.user.id }, data: { stripeCustomerId: customerId } });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${frontendUrl}?billing=success&plan=${planId}`,
      cancel_url:  `${frontendUrl}?billing=cancelled`,
      metadata: { userId: req.user.id, planId },
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error('[Billing] checkout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────
router.post('/portal', requireAuth, async (req: any, res: Response) => {
  try {
    if (!req.user.stripeCustomerId) { res.status(400).json({ error: 'No active subscription' }); return; }
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) { res.status(500).json({ error: 'Stripe not configured' }); return; }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' as any });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await stripe.billingPortal.sessions.create({
      customer:   req.user.stripeCustomerId,
      return_url: frontendUrl,
    });
    res.json({ url: session.url });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// Must be registered with raw body parser (no JSON middleware)
router.post('/webhook', async (req: Request, res: Response) => {
  const stripeKey       = process.env.STRIPE_SECRET_KEY;
  const webhookSecret   = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey) { res.status(200).end(); return; }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' as any });

    let event: any;
    if (webhookSecret && req.headers['stripe-signature']) {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody || req.body,
        req.headers['stripe-signature'] as string,
        webhookSecret
      );
    } else {
      event = req.body;
    }

    const obj = event.data?.object;

    if (event.type === 'checkout.session.completed') {
      const userId = obj.metadata?.userId;
      const planId = obj.metadata?.planId;
      if (userId && planId) {
        await db.user.update({
          where: { id: userId },
          data: { plan: planId, stripeSubId: obj.subscription },
        });
        console.log(`[Billing] ${userId} upgraded to ${planId}`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const customerId = obj.customer;
      const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } });
      if (user) {
        await db.user.update({ where: { id: user.id }, data: { plan: 'trial', stripeSubId: null } });
        console.log(`[Billing] ${user.email} subscription cancelled → trial`);
      }
    }

    res.json({ received: true });
  } catch (e: any) {
    console.error('[Billing] webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

export default router;
