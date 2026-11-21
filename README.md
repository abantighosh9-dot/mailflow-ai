# MailFlow AI

A React + Vite + Tailwind frontend with Netlify Functions, PostgreSQL/Prisma, Google sign-in, email/password authentication and AI email generation.

## Requirements
- Node.js 20 LTS or newer
- npm
- PostgreSQL database (local PostgreSQL or managed provider such as Neon/Prisma Postgres)
- OpenAI API key for AI email generation
- Google OAuth Web client ID for Google sign-in

## 1. Install
```bash
npm install
```

## 2. Configure environment
Copy `.env.example` to `.env` and fill in:
- `DATABASE_URL`
- `JWT_SECRET` (long random value)
- `CLIENT_URL=http://localhost:8888`
- `GOOGLE_CLIENT_ID`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (choose a model available to your API account)

For the frontend Google button, also create `.env.local`:
```env
VITE_GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
```
Never put OpenAI keys, JWT secrets, or database passwords in variables beginning with `VITE_`.

## 3. Set up PostgreSQL and Prisma
Create a PostgreSQL database and put its connection URL in `DATABASE_URL`.

Then run:
```bash
npx prisma generate
npx prisma migrate dev --name init
```

Optional demo account:
```bash
npm run db:seed
```
Demo login:
- Email: `demo@mailflow.local`
- Password: `MailFlowDemo!2026`

This account is for local development only. Do not seed it into production. Change/delete it before any public deployment.

## 4. Configure Google login
In Google Cloud Console:
1. Create/select a project.
2. Configure the OAuth consent screen.
3. Create an OAuth Client ID with application type **Web application**.
4. Add `http://localhost:8888` to Authorized JavaScript origins.
5. Add your production Netlify domain as an authorized origin after deployment.
6. Copy the Client ID into both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`.

The backend verifies Google's ID token before creating a local session. Do not trust profile details sent directly by the browser.

## 5. Run locally
Use Netlify Dev so the `/api` function routes work:
```bash
npx netlify dev
```
Open the local URL printed by Netlify CLI (normally http://localhost:8888).

You can run only the frontend with `npm run dev`, but the API/auth routes require Netlify Dev.

## 6. AI email generator
Add a valid `OPENAI_API_KEY` and a model available to your API account. The backend returns structured JSON and renders escaped HTML. Review and test the email in real email clients before sending.

## 7. Automation & Drip Workflows
MailFlow AI includes an automated drip sequence engine:
- **Triggers**: Contact subscription (`CONTACT_SUBSCRIBED`) and tag assignment (`TAG_ADDED`).
- **Steps**: Marketing email dispatch, wait/delay intervals (minutes, hours, days), and condition checks.
- **Engine**: Runs every minute via Netlify Scheduled Functions (`scheduled-campaigns.mjs`), utilizing optimistic concurrency locks (`lockedAt`), duplicate execution prevention, and automatic suppression guards (unsubscribed or bounced contacts are cancelled and never sent marketing copy).
- **Builder**: Visual sequence pipeline in `/app/automation` with drag-and-drop / reordering, execution timeline simulation, and enrollment monitoring.

## 8. Deliverability & DNS Domain Authentication
MailFlow AI provides complete domain authentication and deliverability tooling (`/app/deliverability`):
- **DNS Authentication Engine**: Automatic generation and live verification of SPF (`v=spf1 include:spf.brevo.com ~all`), DKIM (`mailo._domainkey` public key), DMARC policy (`v=DMARC1; p=...`), and custom CNAME tracking links.
- **SSRF Defense**: Strict validation of domain hostnames rejecting private IPs, loopback sockets, and internal TLDs.
- **Domain Health Score**: Composite reputation metric (0-100) factoring in DNS verification status, bounce rate penalties (> 5%), and spam complaint penalties (> 0.1%).
- **Registrar Setup Guides**: Tailored instructions with 1-click copy for Cloudflare, GoDaddy, Namecheap, and AWS Route 53.
- **Pre-Send Email Spam Score Analyzer**: Real-time content analyzer scoring draft subjects, HTML markup, promotional trigger words, excessive capitalization/punctuation, missing unsubscribe links, and suspicious URL shorteners.

## 9. Deploy to Netlify
1. Push the project to a private Git repository.
2. Import the repository into Netlify.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Functions directory: `netlify/functions`
6. Add all server environment variables in Netlify site configuration.
7. Add `VITE_GOOGLE_CLIENT_ID` as a build environment variable.
8. Add the Netlify production URL to Google authorized JavaScript origins.
9. Run migrations against the production database from a trusted deployment workflow, not from every serverless invocation.

## Important production work still required
Before public production launch, the following remaining modules can be expanded:
- Password reset and verified-email flows.
- Team invitations, workspace switching, and member role assignment (`/app/team`).
- Stripe billing integration and subscription tier metering (`/app/billing`).
- Interactive conversational AI assistant (`/app/assistant`).
- Inbound/outbound webhook integrations for eCommerce platforms (`/app/integrations`).

## Notes
The dashboard chart is demo illustration. No real marketing emails are sent by this starter. The AI-generated HTML contains a placeholder unsubscribe URL; replace it with a real per-recipient unsubscribe link before any marketing send.
