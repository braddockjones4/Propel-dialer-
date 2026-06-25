# Propel Dialer — Setup Guide

## What You're Building
A real estate power dialer that runs in the browser. Twilio handles all the calling infrastructure. You need a Twilio account (free to start) and Node.js on your machine.

---

## Step 1 — Install Prerequisites

Make sure you have:
- **Node.js v18+** → https://nodejs.org (download LTS version)
- **npm** (comes with Node.js)

Verify:
```bash
node --version   # should print v18 or higher
npm --version    # should print 9 or higher
```

---

## Step 2 — Set Up Twilio (15 minutes)

1. **Create a free Twilio account** → https://www.twilio.com/try-twilio

2. **Get your Account SID and Auth Token**
   - Go to: https://console.twilio.com
   - They're on the main dashboard

3. **Create an API Key** (more secure than using Auth Token directly)
   - Go to: Account → API keys & tokens → Create API key
   - Type: Standard
   - Save the **SID** (starts with `SK`) and the **Secret** — you only see the Secret once

4. **Buy a phone number** (costs $1/month, covered by free trial credit)
   - Go to: Phone Numbers → Manage → Buy a number
   - Make sure it has Voice capability

5. **Create a TwiML App**
   - Go to: Voice → TwiML Apps → Create new TwiML App
   - Name: "Propel Dialer"
   - **Voice Request URL**: `http://localhost:3001/api/twilio/voice` (for local dev)
   - HTTP method: POST
   - Save — copy the **App SID** (starts with `AP`)

> **Note for production**: The Voice Request URL must be a public HTTPS URL. Use [ngrok](https://ngrok.com) during development to expose your local server.

---

## Step 3 — Configure Environment Variables

```bash
cd propel-dialer/backend
cp .env.example .env
```

Open `backend/.env` and fill in your Twilio values:
```
TWILIO_ACCOUNT_SID=AC...       ← from Twilio dashboard
TWILIO_AUTH_TOKEN=...          ← from Twilio dashboard
TWILIO_API_KEY=SK...           ← API key SID you just created
TWILIO_API_SECRET=...          ← API key Secret you just created
TWILIO_TWIML_APP_SID=AP...     ← TwiML App SID
TWILIO_CALLER_ID=+1XXXXXXXXXX  ← the phone number you bought
```

---

## Step 4 — Install Dependencies and Run

From the `propel-dialer` root folder:

```bash
# Install all dependencies
cd propel-dialer
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..

# Start both servers at once
npm run dev
```

This runs:
- Backend API on http://localhost:3001
- Frontend on http://localhost:5173

Open http://localhost:5173 in your browser. You should see the Propel Dialer interface.

---

## Step 5 — Make Your First Test Call

1. The dialer shows a demo contact list with 3 fake contacts
2. The device status dot in the top right should turn green (Ready)
3. Click **Dial** on the first contact
4. **For testing**: change the phone number in `frontend/src/components/Dialer.tsx` (line with `DEMO_CONTACTS`) to your own cell phone number
5. Your cell phone should ring — answer it and you've made your first Twilio call

---

## Using ngrok for Local Dev (Required for Twilio webhooks)

Twilio needs to send webhooks to your backend. During local development, use ngrok to create a public tunnel:

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3001
```

Copy the `https://...ngrok.io` URL and update your TwiML App's Voice Request URL to:
`https://YOUR-NGROK-URL/api/twilio/voice`

---

## Project Structure

```
propel-dialer/
├── backend/
│   ├── src/
│   │   ├── server.ts              ← Express app entry point
│   │   └── routes/
│   │       └── twilio.ts          ← Token endpoint + TwiML webhook
│   ├── .env                       ← Your secrets (never commit this)
│   └── .env.example               ← Template
└── frontend/
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── Dialer.tsx          ← Main dialer UI
        │   └── DispositionPanel.tsx ← Call outcome buttons
        ├── hooks/
        │   └── useTwilioDevice.ts  ← All Twilio SDK logic
        └── types/
            └── index.ts            ← TypeScript types
```

---

## What's Working Right Now

- [x] Browser-based dialer powered by Twilio Voice SDK
- [x] Prospect list with contact card display
- [x] Dial / hang up / mute controls
- [x] Live call timer
- [x] 7 call disposition buttons (Not Home, Left VM, Hot Lead, etc.)
- [x] Call scripts on screen per prospect type
- [x] Session stats (calls made, hot leads)
- [x] Call history for current session

## What's Coming Next

- [ ] Real prospect list from database (PostgreSQL)
- [ ] Automated follow-up sequences triggered by disposition
- [ ] SMS/email sending via Twilio + SendGrid
- [ ] Voicemail drop
- [ ] Triple-line dialing
- [ ] Local presence numbers
- [ ] AI call summaries via OpenAI Whisper
- [ ] Personal Blast mass texting
- [ ] Deal pipeline
