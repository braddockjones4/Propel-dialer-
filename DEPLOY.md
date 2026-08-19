# Propel Dialer — Production Deployment Guide

**Stack:** Backend → Render | Database → Supabase (PostgreSQL) | Frontend → Vercel

---

## Step 1 — Supabase (Database)

1. Go to https://supabase.com → New project
2. Choose a region close to your users (e.g. US East)
3. Once created, go to **Settings → Database → Connection string**
4. Copy two URLs:
   - **Transaction pooler** (port 6543) → this becomes `DATABASE_URL`
   - **Direct connection** (port 5432) → this becomes `DIRECT_URL`
5. Both URLs look like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
   ```

---

## Step 2 — Render (Backend)

### Connect repo
1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo (`Propel-dialer-`)
3. Set **Root Directory** to `backend`
4. Render will detect `render.yaml` and pre-fill build/start commands

### Environment variables
Add all of these in the Render dashboard under **Environment**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **pooler** URL (port 6543) |
| `DIRECT_URL` | Supabase **direct** URL (port 5432) |
| `JWT_SECRET` | Any long random string |
| `TWILIO_ACCOUNT_SID` | From Twilio console |
| `TWILIO_AUTH_TOKEN` | From Twilio console |
| `TWILIO_API_KEY` | From Twilio → API keys |
| `TWILIO_API_SECRET` | From Twilio → API keys |
| `TWILIO_TWIML_APP_SID` | From Twilio → TwiML Apps |
| `TWILIO_CALLER_ID` | `+14439091704` |
| `FRONTEND_URL` | `https://propel-dialer.vercel.app` (set after Vercel deploy) |
| `AGENT_NAME` | `Braddock Jones` |
| `AGENT_PHONE` | `+14439091704` |
| `OPENAI_API_KEY` | From platform.openai.com — used for call transcription, scoring, and next-action suggestions |
| `ANTHROPIC_API_KEY` | From console.anthropic.com — used for the autonomous AI Agent follow-ups |
| `ANTHROPIC_MODEL` | Optional — overrides the default agent model (`claude-haiku-4-5-20251001`) |
| `VOICEMAIL_SCRIPT` | Optional — overrides the default voicemail-drop script text |
| `STRIPE_SECRET_KEY` | From Stripe dashboard — required for promo-code validation (`/api/promo/validate`) only; SaaS billing (`routes/billing.ts`) is not mounted |
| `SENDGRID_API_KEY` | From SendGrid |
| `SENDGRID_FROM_EMAIL` | `braddockjones4@icloud.com` |
| `NODE_ENV` | `production` |

### Deploy
Click **Deploy**. Render runs:
```
npm install && npx prisma generate && npm run build
npx prisma db push && node dist/server.js
```
`prisma db push` creates all tables in Supabase on first boot.

Your backend URL: `https://propel-dialer-backend.onrender.com`

> **Note:** Free tier services sleep after 15 min of inactivity. Upgrade to Starter ($7/mo) to keep always-on.

---

## Step 3 — Update Twilio Webhooks

In Twilio console → your phone number (`+14439091704`):
- **Voice webhook:** `https://propel-dialer-backend.onrender.com/api/twilio/voice`
- **SMS webhook:** `https://propel-dialer-backend.onrender.com/api/twilio/sms-inbound`

In Twilio → TwiML Apps → your app:
- **Voice Request URL:** `https://propel-dialer-backend.onrender.com/api/twilio/voice`

---

## Step 4 — Vercel (Frontend)

1. Go to https://vercel.com → New Project → Import GitHub repo
2. Set **Root Directory** to `frontend`
3. Add environment variables:
   ```
   VITE_API_URL=https://propel-dialer-backend.onrender.com/api
   VITE_SOCKET_URL=https://propel-dialer-backend.onrender.com
   ```
4. Deploy → your app will be at `https://propel-dialer.vercel.app`
5. Go back to Render → update `FRONTEND_URL` to that URL and redeploy

---

## Step 5 — Stripe Setup (promo codes only)

SaaS billing (`routes/billing.ts`) is not wired up — this is a per-client custom deployment with no subscription billing. Stripe is only used for promo-code validation:

1. Go to https://dashboard.stripe.com/apikeys → copy the secret key
2. Add it as `STRIPE_SECRET_KEY` in Render env vars

---

## First Login

1. Open your Vercel URL
2. Click **Create Account** — first account is auto-admin
3. Start dialing

---

## Local Dev (unchanged)

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
# App at http://localhost:5173
```

Keep `backend/.env` with `DATABASE_URL="file:./dev.db"` for local SQLite dev, or swap in the Supabase URL to develop against the live database.

---

## PWA Install on iPhone

1. Open your Vercel URL in Safari
2. Tap Share → Add to Home Screen
3. Propel installs as a native app
