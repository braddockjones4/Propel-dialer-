# Propel AI Agent — Setup & Overview

An **autonomous AI agent** built on top of Propel: it answers inbound leads,
follows up with quiet leads on its own, and books appointments — with human
approval and hard safety guardrails. Runs on **Claude** (your `ANTHROPIC_API_KEY`).

## ✅ The only step left to go live (run in YOUR environment)

The agent adds two tables (`AgentSettings`, `AgentAction`) and one `Contact`
column (`agentPaused`). From the project:

```bash
cd backend
npx prisma db push      # creates the tables AND regenerates the Prisma client
```

Then restart the backend (`npm run dev`) or redeploy. That's it.

> This must run where the Prisma engine + your database are reachable (your
> machine or your deploy host). It can't run from the assistant's sandbox because
> Prisma's engine host is firewalled there.

**Fallback (manual):** `backend/prisma/agent-migration.sql` can be pasted into the
Supabase SQL editor — but you still need `npx prisma generate` afterward so the
app code sees the new models. The `db push` command above is the easy path.

## Model / providers

The model layer auto-selects a provider from your env:

| Env var | Result |
|---------|--------|
| `ANTHROPIC_API_KEY` (you have this) | Uses **Claude** — default `claude-haiku-4-5-20251001` (fast + cheap for high-volume replies) |
| `OPENAI_API_KEY` | Uses GPT (`gpt-4o-mini`) |
| neither | Smart **rule-based** replies — still fully functional, nothing breaks |

Your `ANTHROPIC_API_KEY` in `backend/.env` is only 27 chars — if that's a
placeholder, drop in a real key (starts with `sk-ant-`) for live Claude replies.
Without a valid key the agent still runs on the rule-based fallback.

## Sending: real vs simulated

Your Twilio creds are set, so **the agent sends real SMS** once live. That's why
the default autonomy mode is **Review** (nothing sends without your approval).
If Twilio creds were absent, sends would be "simulated" (logged only).

## Autonomy modes (AI Agent tab)

- **Off** — agent does nothing.
- **Review** (default) — drafts every reply/follow-up and **queues it for your
  approval**. Nothing sends without a click. Start here.
- **Auto** — sends and books on its own within guardrails. High-risk cases still
  come to you.

## Guardrails (always enforced)

- Never messages a `dnc` (opted-out) or `agentPaused` contact.
- Honors STOP/START opt-out (existing behavior).
- **Quiet hours** (default 9pm–8am local) — defers to morning instead of sending.
- **Daily SMS cap per contact** (default 4).
- **Max auto-replies per thread** (default 6) before forcing a human handoff.
- **Escalation keywords** (lawyer, complaint, …) → hands off to you, never auto-replies.

## How it works

- **Inbound:** a lead texts in → `handleInboundSms` fires the agent in the
  background (Twilio still gets an instant response).
- **Proactive:** cron re-engages quiet active leads every 15 min; deferred
  (quiet-hours) messages go out every 5 min.
- **Draft button:** the Inbox has "🤖 Draft with AI" to fill the composer with a
  suggested reply you edit and send.

## Suggested first test (safe)

1. Run `npx prisma db push`, restart backend.
2. Open the **AI Agent** tab → keep mode on **Review**.
3. In your CRM, add a contact with **your own phone number**, then text your
   Twilio number from it.
4. Watch the draft appear under **Approvals** → approve → confirm you get the text.
   This is exactly the flow to show the realtor.

## Key files

Backend `backend/src/agent/`: `llm.ts` (Claude+GPT layer), `engine.ts`
(decision/tool-use), `dispatch.ts` (autonomy + guardrails), `executor.ts`,
`guardrails.ts`, `followupAgent.ts` (sweep), `scheduler.ts`, `settings.ts`,
`context.ts`. API `routes/agent.ts`. Frontend `components/AgentConsole.tsx`
("AI Agent" tab) + draft button in `Inbox.tsx`.

## API (all under `/api/agent`, auth required)

`GET/PUT /settings` · `GET /stats` · `GET /pending` · `GET /actions` ·
`POST /actions/:id/approve` · `POST /actions/:id/reject` ·
`POST /run/:contactId` · `POST /draft/:contactId` · `POST /sweep`
