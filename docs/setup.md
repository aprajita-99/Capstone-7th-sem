# MarkMePresent — setup, hosting and operations

Everything needed to run MarkMePresent locally, deploy it, connect the outside services, and keep an eye on it.
For what the product does and how each phase works, see [`FEATURES.md`](../FEATURES.md); for the current status, [`progress.md`](../progress.md).

## 1. Run it locally

You need **Node.js 22+** and a MongoDB database (MongoDB Atlas free tier, or MongoDB Community locally).

### Backend (`attendance-backend`)

```bash
cd attendance-backend
npm install
cp config/config.env.example config/config.env   # then fill in the values (section 2)
npm run seed:rooms                                # once per new database: rooms 101–112, 201–212, 301–312
npm start                                         # http://localhost:4000
curl http://localhost:4000/api/v1/health
```

`config/config.env` holds secrets and is **git-ignored** — never commit it.

### Frontend (`attendance-frontend`)

```bash
cd attendance-frontend
npm install
cp .env.example .env      # optional; defaults to http://localhost:4000/api/v1
npm start                 # http://localhost:3000
```

Google sign-in works only from origins registered on the Google OAuth client (add `http://localhost:3000`).

### Testing on real phones

The microphone and camera need HTTPS. Either test on the deployed site, or run a temporary tunnel:

```bash
cd attendance-frontend && npm run start:shared      # binds 0.0.0.0 and proxies /api to the backend
cloudflared tunnel --url http://localhost:3000      # open the printed https://….trycloudflare.com URL on the phones
```

### Tests

```bash
cd attendance-backend && npm test                 # unit tests (node:test)
cd attendance-frontend && npm run test:acoustic   # sound codec tests
cd attendance-frontend && CI=true npm run build   # production build; lint warnings fail it
```

## 2. Configuration

### Backend (`attendance-backend/config/config.env`, or Render environment variables)

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `PRODUCTION` on the server (secure cookies, strict CORS); leave unset locally |
| `PORT` | Local port (Render sets it automatically) |
| `DB_URI` | MongoDB connection string |
| `JWT_SECRET`, `JWT_EXPIRE`, `COOKIE_EXPIRE` | Sign-in session token |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `TEACHER_EMAILS` | Comma-separated college emails that become teachers on first sign-in |
| `TEST_STUDENT_EMAILS` | **Development only**: Gmail accounts allowed as students without a roster. Empty it before a real pilot |
| `DEV_MODE` | **Development only** (`true` to turn on; `/health` shows `devMode`). For **every student**: the identity check skips the ID card (a live selfie alone verifies and becomes the reference face), and any number of browsers can be used (each one is trusted at sign-in, no phone review). Turn it off before a real pilot: with it on, anyone can check in from a friend's phone |
| `CLIENT_URL` / `CLIENT_URLS` | Website origin(s) allowed to call the API with cookies |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS Rekognition (face liveness + matching), region `ap-south-1` |
| `LIVENESS_THRESHOLD`, `MATCH_THRESHOLD`, `REVIEW_THRESHOLD` | Face pass marks (defaults 80 / 90 / 75) |
| `CHECKIN_WINDOW_MIN`, `KEY_LIFETIME_SEC`, `MAX_WAVES`, `CHECKIN_PROFILE`, `TIMEZONE` | Check-in defaults (6 min, 15 s, 6, `mid`, `Asia/Kolkata`). `CHECKIN_PROFILE` is `high`, `mid` or `low`; `low` (15.0–16.8 kHz) is loudest on phone speakers and reaches the back rows best, but some students may faintly hear it |
| `LOCK_HOUR`, `AUDIT_RETENTION_DAYS`, `EVIDENCE_TTL_HOURS`, `DIGEST_HOUR` | Lock at 09:00 next morning, 180-day audit retention, 48 h evidence backstop, 20:00 digest |
| `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`, `APP_URL` | Teacher evening digest email (skipped when unset) |
| `JOBS_SECRET` | Protects `POST /api/v1/jobs/run` (also a GitHub Actions secret) |

### Frontend (`attendance-frontend/.env`, or Vercel environment variables)

| Variable | Meaning |
| --- | --- |
| `REACT_APP_GOOGLE_CLIENT_ID` | Same Google OAuth web client ID |
| `REACT_APP_API_URL` | API base; on Vercel `/api/v1` (proxied to Render, so the cookie is first-party) |
| `REACT_APP_GOOGLE_HOSTED_DOMAIN` | Optional: limits the Google picker to one domain (e.g. `nitjsr.ac.in`). Empty or `any` (the default) shows every account; the server admits students only if their email is on a roster |
| `REACT_APP_AWS_REGION`, `REACT_APP_AWS_IDENTITY_POOL_ID` | Cognito guest credentials for the live face check |

## 3. Hosting

| Piece | Where | Notes |
| --- | --- | --- |
| API + website | **Render** web service `capstone-7th-sem-1` (Singapore), root `attendance-backend`, build `npm install && npm run build:web`, start `npm start` | `NODE_ENV=PRODUCTION`, the backend variables above, and the website's build variables (`REACT_APP_GOOGLE_CLIENT_ID`, `REACT_APP_AWS_REGION`, `REACT_APP_AWS_IDENTITY_POOL_ID`, optional `REACT_APP_GOOGLE_HOSTED_DOMAIN`; `REACT_APP_API_URL` defaults to `/api/v1`). The server serves `attendance-frontend/build` (`utils/serveWebsite.js`), so site and API share one address |
| Website (backup) | **Vercel**, root `attendance-frontend` | `vercel.json` rewrites `/api/*` to the Render URL. Some Indian ISPs block or stall `*.vercel.app` (10 s+ "Stalled" in DevTools), which is why the main address is the Render one |
| Database | **MongoDB Atlas** (AWS Mumbai, `ap-south-1`) | Network access must allow the Render service |
| Scheduled jobs | **GitHub Actions** `.github/workflows/jobs.yml`, every 30 min (plus `keep-awake.yml`, a `/health` ping every 10 min) | Calls `POST /api/v1/jobs/run` with the `JOBS_SECRET` repository secret: lock at 09:00, retention, 20:00 digest. The server also runs them every 10 min while awake |

**Speed notes.** `GET /api/v1/health?db=1` shows the server's round trip to the database (`dbPingMs`). With Render in the US and Atlas in Mumbai it is about 230 ms per database call, and every page waits on several. Run the API next to the database and keep it awake:

1. Render → **New → Web Service** → this repository, region **Singapore**, root `attendance-backend`, build `npm install`, start `npm start` (the free plan is fine).
2. Copy every environment variable from the old service (Environment → copy each value). If Atlas Network Access lists fixed IPs, add the new service's outbound IPs.
3. Open `https://<new-service>.onrender.com/api/v1/health?db=1`: `dbPingMs` should be about 30–60.
4. Point the website at it: change the Render URL in `attendance-frontend/vercel.json`, commit, and let Vercel redeploy.
5. GitHub → Settings → Secrets and variables → Actions → **Variables** → `API_URL` = `https://<new-service>.onrender.com` (used by `jobs.yml` and `keep-awake.yml`).
6. Suspend or delete the old US service once the site works.

The Render free tier sleeps after ~15 minutes idle (the first request then takes 30–60 s). `.github/workflows/keep-awake.yml` pings `/api/v1/health` every 10 minutes; because GitHub can delay scheduled runs, also add a free external monitor (cron-job.org or UptimeRobot, every 5 minutes, same URL). One always-on service fits in the free 750 hours a month.

## 4. Outside services

- **Google sign-in.** Google Cloud Console → APIs & Services → Credentials → OAuth client (Web). Authorized JavaScript origins: `http://localhost:3000` and the Vercel site. If the consent screen is in Testing, add the test accounts as test users.
- **AWS Rekognition.** IAM user for the backend with `rekognition:CreateFaceLivenessSession`, `GetFaceLivenessSessionResults`, `CompareFaces`, `DetectFaces`, `DetectText`. Cognito **identity pool** with guest access whose guest role allows only `rekognition:StartFaceLivenessSession`; the role's trust policy must have `cognito-identity.amazonaws.com:aud` = the pool ID and `amr` = `unauthenticated` (otherwise phones see "Invalid identity pool configuration").
- **Brevo (email).** Create an API key and verify the sender address; set `BREVO_API_KEY`, `MAIL_FROM`, `APP_URL` (and optionally `MAIL_FROM_NAME`) on Render.
- **GitHub Actions.** Repository → Settings → Secrets and variables → Actions → `JOBS_SECRET` (same value as on Render).

## 5. Monitoring

- **Health:** `GET /api/v1/health` returns whether the face service, email and jobs are configured; add `?db=1` for the database round trip.
- **Logs:** Render → the service → Logs (errors, `jobs run failed`, `email skipped`).
- **Scheduled jobs:** GitHub → Actions → "Scheduled jobs" shows every run; a failed run sends GitHub's failure email to the repository owner.
- **AWS cost alert (recommended before the pilot).** Face checks are billed per check, so set a budget email:
  1. Sign in to the AWS console with the account owner (root) or a user that has billing access.
  2. Open **Billing and Cost Management → Budgets → Create budget**.
  3. Choose **Use a template → Monthly cost budget** (or *Customize → Cost budget* for more control).
  4. Name it (e.g. `markmepresent-monthly`), set the amount (e.g. **5 USD**), and add your email under **Email recipients**.
  5. **Create budget.** AWS emails you when actual spend reaches 85% and 100%, and when the forecast passes 100%.
  6. Optional: also create the **Zero spend budget** template to be told about any charge at all.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Google button errors or "origin not allowed" | Add the site origin to the OAuth client; wait a few minutes |
| Student "not on a roster" | Add their college email to a class roster (or, for development only, to `TEST_STUDENT_EMAILS`) |
| Microphone / camera never asks for permission | The page must be HTTPS (deployed site or tunnel) |
| "Invalid identity pool configuration" on the face check | Fix the Cognito guest role trust policy (section 4) |
| Every first visit is very slow | Render free tier woke from sleep (section 3) |
| Website calls fail with CORS errors | Add the website origin to `CLIENT_URLS` on Render |
| Vercel build fails on a warning | `CI=true` treats lint warnings as errors; fix the warning |
| No digest emails | Check `/api/v1/health` shows `email: true`, the Brevo sender is verified, and the 20:00 IST jobs run happened (GitHub Actions) |
