# Propel Dialer — Production Deployment Guide

## Backend → Railway

### 1. Create Railway account
Go to https://railway.app → New Project → Deploy from GitHub repo

### 2. Connect your repo
Push the `propel-dialer` folder to a GitHub repo, then connect it in Railway.
Select the `/backend` folder as the root directory.

### 3. Add environment variables in Railway dashboard
Copy all values from your local `backend/.env`:

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY=
TWILIO_API_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_CALLER_ID=
DATABASE_URL=file:./dev.db
PORT=3001
FRONTEND_URL=https://your-vercel-app.vercel.app
AGENT_NAME=Braddock Jones
AGENT_PHONE=+14439091704
JWT_SECRET=your-random-secret-here
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_ELITE=
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
OPENAI_API_KEY=
NODE_ENV=production
```

### 4. Railway will auto-build using railway.toml
Build: `npm install && npx prisma generate && npm run build`
Start: `npx prisma db push && node dist/server.js`

### 5. Get your Railway URL
It will look like: `https://propel-backend-production.up.railway.app`
Save this — you'll need it for Twilio and the frontend.

### 6. Update Twilio webhooks
In Twilio console → your phone number:
- SMS webhook: `https://your-railway-url/api/twilio/sms-inbound`
- Voice webhook: `https://your-railway-url/api/twilio/voice`

---

## Frontend → Vercel

### 1. Create Vercel account
Go to https://vercel.com → New Project → Import GitHub repo
Select the `/frontend` folder as root directory.

### 2. Add environment variables in Vercel dashboard
```
VITE_API_URL=https://your-railway-url/api
VITE_SOCKET_URL=https://your-railway-url
```

### 3. Deploy
Vercel auto-deploys on every push. Your app will be at:
`https://propel-dialer.vercel.app`

### 4. Update Railway FRONTEND_URL
Set `FRONTEND_URL=https://propel-dialer.vercel.app` in Railway env vars.

---

## Quick local dev (no change needed)
```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev

# App at http://localhost:5173
```

---

## Stripe Setup (to accept payments)
1. Go to https://dashboard.stripe.com/products
2. Create 3 products: Starter ($99/mo), Pro ($199/mo), Elite ($399/mo)
3. Copy each Price ID (price_xxx) to Railway env vars:
   - STRIPE_PRICE_STARTER=price_xxx
   - STRIPE_PRICE_PRO=price_xxx
   - STRIPE_PRICE_ELITE=price_xxx
4. Go to Stripe → Webhooks → Add endpoint:
   - URL: `https://your-railway-url/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
5. Copy webhook signing secret → STRIPE_WEBHOOK_SECRET in Railway

---

## PWA Install on iPhone
1. Open `https://propel-dialer.vercel.app` in Safari
2. Tap Share → Add to Home Screen
3. Propel installs as a native-looking app

---

## First login
1. Go to your deployed URL
2. Click "Create Account" — first account is auto-admin
3. Log in and start dialing
