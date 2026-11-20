# API Keys required for MailFlow AI

## 1. OpenAI API key
- Sign up / log in at https://platform.openai.com/account/api-keys.
- Click **Create new secret key**.
- Copy the generated key (it looks like `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).
- Add it to the `.env` file:
  ```
  OPENAI_API_KEY="sk-YourOpenAIKeyHere"
  ```
- Choose a model that your OpenAI account has access to (e.g., `gpt-4o-mini`).
  ```
  OPENAI_MODEL="gpt-4o-mini"
  ```

## 2. Brevo (formerly Sendinblue) transactional email API key & Webhooks
- Go to https://app.brevo.com/settings/keys/api.
- Click **Create a new key** → select *Transactional* scope.
- Copy the key (a long alphanumeric string).
- Add it to `.env`:
  ```
  BREVO_API_KEY="your-brevo-api-key"
  BREVO_SENDER_EMAIL="you@example.com"   # verified sender email in Brevo
  BREVO_SENDER_NAME="MailFlow AI"
  BREVO_WEBHOOK_SECRET="your-secure-webhook-secret"
  ```

### Brevo Webhook Configuration (for delivery & engagement tracking)
Reference: https://developers.brevo.com/docs/secured-webhooks

1. Go to Brevo Dashboard → **Transactional** → **Settings** → **Webhooks** (or https://app.brevo.com/settings/webhooks).
2. Click **Add a new webhook**.
3. Choose one of the 3 officially supported Brevo authentication methods:
   - **Option A (Custom Header — Recommended):**
     URL: `https://<your-domain>/api/webhooks/brevo`
     Under custom headers, add: `X-Webhook-Secret: <your-secure-webhook-secret>`
   - **Option B (Bearer Token via API):**
     Set `"auth": { "type": "bearer", "token": "<your-secure-webhook-secret>" }` when creating the webhook via Brevo API.
   - **Option C (Basic Authentication in URL):**
     URL: `https://brevo:<your-secure-webhook-secret>@<your-domain>/api/webhooks/brevo`
     (Brevo transmits this via `Authorization: Basic <base64>`).
   *(Note: URL query parameters such as `?token=` are not an official Brevo authentication method and are not accepted).*
4. Select all tracked transactional events:
   - **Delivered**
   - **Opened / Unique Opened**
   - **Clicked**
   - **Soft bounce & Hard bounce**
   - **Spam complaint**
   - **Deferred**
5. Save the webhook. Brevo will now securely POST real-time delivery and engagement events to MailFlow AI.

## 3. Google OAuth client ID (optional, for Google Sign‑In)
- Open Google Cloud Console → **APIs & Services > Credentials**.
- Create an **OAuth 2.0 Client ID** (Web application).
- Add `http://localhost:8888` (or your dev URL) to **Authorized JavaScript origins** and `http://localhost:8888/api/auth/google/callback` to **Authorized redirect URIs**.
- Copy the **Client ID** and paste it:
  ```
  GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
  ```

## 4. Background Campaign Scheduling (Netlify Scheduled Functions)
MailFlow AI uses a server-side Netlify Scheduled Function (`netlify/functions/scheduled-campaigns.mjs`) configured to trigger every minute:
- Netlify reads the schedule from `netlify.toml`:
  ```toml
  [functions."scheduled-campaigns"]
    schedule = "* * * * *"
  ```
- No external paid message queue (Redis/BullMQ) is required; PostgreSQL acts as the durable state store and transactional queue.
- Campaigns transition through optimistic concurrency locking (`lockedAt`) to prevent double-sends across parallel function invocations.
- In local development or environments without Netlify Scheduled Functions enabled, scheduled campaigns can be triggered on demand by calling:
  ```bash
  POST /api/campaigns/process-due
  ```
  (Requires authentication with `OWNER`, `ADMIN`, or `EDITOR` role).

## 5. Reload environment variables
After updating `.env`, restart the dev server:
```bash
npm run dev   # or `npm run dev:server` then `npm run dev:vite`
```
The server will now load the keys and the AI, email‑sending, and Google‑auth routes will work.
