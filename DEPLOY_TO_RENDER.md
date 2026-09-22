# Deploy Propel Backend to Render
Everything is pre-configured. This should take under 10 minutes.

---

## Step 1 — Push your code to GitHub

Open Terminal and run:
```bash
cd ~/Documents/Claude/Projects/real\ estate\ software/propel-dialer
git add .
git commit -m "deploy: render config"
git push
```

---

## Step 2 — Create the Render Web Service

1. Go to **dashboard.render.com** → click **New +** → **Web Service**
2. Connect your GitHub account if not already connected
3. Select your **propel-dialer** repo
4. Set the **Root Directory** to `backend`
5. Confirm these settings:
   - **Build Command:** `npm install && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma db push && node dist/server.js`

---

## Step 3 — Add Environment Variables

In the Render dashboard → **Environment** tab → copy values from your `backend/.env` file.

Key variables needed:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_API_KEY`
- `TWILIO_API_SECRET`
- `TWILIO_TWIML_APP_SID`
- `TWILIO_CALLER_ID`
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `AGENT_NAME`
- `AGENT_PHONE`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ENCRYPTION_KEY`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `NODE_ENV` = `production`
- `BACKEND_URL` = `https://propel-dialer-backend.onrender.com` (code also accepts the legacy name `NGROK_URL`)

---

## Step 4 — Update Twilio TwiML App

1. Go to console.twilio.com → Voice → TwiML Apps
2. Set **Voice Request URL** to:
   ```
   https://propel-dialer-backend.onrender.com/api/twilio/voice
   ```
3. Method: `HTTP POST` → Save

---

## Step 5 — Deploy Frontend to Vercel

- Import repo on vercel.com → set root directory to `frontend`
- Add env vars:
  - `VITE_API_URL` = `https://propel-dialer-backend.onrender.com/api`
  - `VITE_SOCKET_URL` = `https://propel-dialer-backend.onrender.com`
