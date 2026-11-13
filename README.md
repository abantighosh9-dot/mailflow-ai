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

## 7. Deploy to Netlify
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
This starter intentionally does not claim that all 12 modules are production complete. Before company launch, add:
- Password reset and verified-email flows.
- CSRF protection and stricter origin validation for cookie-authenticated mutations.
- Workspace selection and per-request membership authorization (the starter uses the first membership).
- Contact CRUD/import/export endpoints and UI.
- Campaign persistence, provider sending, suppression checks and signed provider webhooks.
- Persistent background queue/scheduler for campaigns and automation (do not run long jobs inside ordinary Netlify Functions).
- Real analytics events; dashboard chart is clearly labelled illustrative.
- Team invitations, roles enforcement, billing and audit logs.
- Rate limiting, monitoring, database backups and security review.

## Notes
The dashboard chart is demo illustration. No real marketing emails are sent by this starter. The AI-generated HTML contains a placeholder unsubscribe URL; replace it with a real per-recipient unsubscribe link before any marketing send.
