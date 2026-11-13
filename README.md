# StudioSpace Server

Express 5 + TypeScript + MongoDB API for StudioSpace, with BetterAuth for
authentication. This folder is an independent project with its own
`package.json` and `tsconfig.json`. The Next.js frontend lives one level up.
The root `.gitignore` excludes `/server/`, so version this API in its own git
repository.

## Scripts

```bash
npm install
npm run dev             # tsx watch src/index.ts
npm run dev:local       # zero-credential local mode (in-memory MongoDB)
npm run typecheck       # tsc --noEmit
npm run test            # unit tests for time/validation helpers
npm run test:integration # live HTTP suite against an ephemeral MongoDB
npm run build           # tsc -> dist/
npm start               # node dist/index.js
npm run seed            # add six example studios (needs a registered user)
```

### Zero-credential local mode

For local demos without Atlas, Google, or ImgBB credentials:

```bash
npm run dev:local
```

It starts a throwaway `mongodb-memory-server` replica set, generates
per-run development secrets, and runs the API on port `5000`. Google and ImgBB
are disabled in this mode; email + password works normally.

**Data is in memory and resets every time the process stops.** To load the six
example studios, register an account in the frontend and run `npm run seed` in
another terminal while local mode is running.

`npm run dev:local -- --check` starts both components, verifies `/api/health`,
and shuts down cleanly — useful as a quick environment check.

Use `npm run dev` with a real `MONGODB_URI` for normal development, and
`npm start` for production. Never use the generated local secrets in
production.

## Environment

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | Atlas/local connection string, including database name |
| `MONGODB_DB` | No | Database name (defaults to `studiospace`) |
| `PORT` | No | API port (defaults to `5000`) |
| `BETTER_AUTH_URL` | No | Public frontend origin used by BetterAuth (defaults to `http://localhost:3000`) |
| `CLIENT_ORIGIN` | No | Allowed browser origin (defaults to `http://localhost:3000`) |
| `BETTER_AUTH_SECRET` | Yes | BetterAuth signing secret |
| `JWT_SECRET` | Yes | Mutation JWT signing secret |
| `GOOGLE_CLIENT_ID` | No | Enables Google sign-in when paired with the secret |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth secret |
| `IMGBB_API_KEY` | No | Enables image uploads |
| `SEED_HOST_EMAIL` | No | Host account used by `npm run seed` |

Generate the two secrets with `openssl rand -base64 32`.

## How it is wired

- `/api/auth/*splat` is mounted **before** `express.json()` so BetterAuth can
  read the raw request body.
- The frontend proxies `/api/*` to this server, so BetterAuth cookies are
  first-party on the Next.js origin.
- MongoDB has one shared `MongoClient`; the same database is used by the
  BetterAuth MongoDB adapter and by the routes.
- Collections: `user`, `session`, `account`, `verification` (BetterAuth),
  `studios`, `bookings`, and `booking_locks` (the per-studio/date lock used for
  concurrency-safe overlap checks).

### Routes

| Method | Route | Guard |
| --- | --- | --- |
| `GET` | `/api/health` | Public |
| `GET` | `/api/studios` | Public |
| `GET` | `/api/studios/mine` | Session |
| `GET` | `/api/studios/:id` | Public |
| `POST` | `/api/studios` | Mutation guard |
| `PATCH` | `/api/studios/:id` | Mutation guard + ownership |
| `DELETE` | `/api/studios/:id` | Mutation guard + ownership |
| `GET` | `/api/bookings/mine` | Session |
| `POST` | `/api/bookings` | Mutation guard |
| `PATCH` | `/api/bookings/:id/cancel` | Mutation guard + ownership |
| `POST` | `/api/mutation-token` | Session |
| `POST` | `/api/uploads` | Mutation guard |

## Booking rules

- Status starts as `Pending`; users may cancel only `Pending` bookings.
- The server ignores any price sent by the browser and recalculates
  `hours × studio.hourlyRate`.
- Times must use 30-minute steps, stay inside the studio's opening hours, and
  last no more than 12 hours. Dates cannot be in the past.
- Overlap detection rejects conflicts with `Pending` **and** `Confirmed`
  bookings. A booking that ends at 12:00 does not conflict with one starting at
  12:00.
- Creation runs inside a MongoDB transaction. If the database is a standalone
  server without replica-set transactions, the route falls back to a
  check-then-insert so local development still works.

## Security

State-changing routes go through `requireMutationAuth`, which checks:

1. A valid BetterAuth session.
2. A 15-minute JWT in the HTTPOnly `studiospace_mutation` cookie
   (`issuer: studiospace-api`, payload `sub` + `sid`).
3. The JWT user/session matching the current session.
4. Double-submit CSRF: `studiospace_csrf` cookie must equal `X-CSRF-Token`.
5. The `Origin` header, when present, must be one of the allowed origins
   (`CLIENT_ORIGIN`; in development, both `localhost:3000` spellings).

Passwords are at least 6 characters and must contain uppercase and lowercase
letters (BetterAuth hook on `/sign-up/email`). Studio and booking ownership is
always derived from the verified session, never from the request body.

## Seed data

1. Start the API and register a host account in the frontend.
2. Run `npm run seed`.

The script inserts six studios if their titles do not already exist and prints
how many were inserted and skipped. It uses the first user, or
`SEED_HOST_EMAIL` when set.

## Testing

```bash
npm test                 # unit tests, no database
npm run build
npm run test:integration # end-to-end HTTP suite
```

`npm run test:integration` starts an ephemeral `mongodb-memory-server`
single-node replica set (transactions enabled), boots the built API on port
`5055`, and runs `scripts/live-integration.mjs`. It creates its own database
and destroys everything on exit. No Atlas or production credentials are used.

Latest result: **59 passed, 0 failed, 0 skipped**, covering auth (including the
registration photo URL), password rules, sessions, mutation-token/CSRF/JWT/
origin guards, studio CRUD, ownership isolation, search/filter/sort, empty
listing lists, booking pricing, overlap prevention including concurrent
requests, cancel rules, and upload guards.

Google OAuth and ImgBB uploads require real credentials and were not exercised;
the upload route is tested for its intended `503 UPLOAD_NOT_CONFIGURED` response.

## Notes

- Uploads require `IMGBB_API_KEY`; without it the route returns a clear `503`.
  The frontend also accepts a pasted image URL.
- `/api/health` returns `200` with `database: "disconnected"` when MongoDB is
  unreachable. Startup still fails fast if the initial database connection
  cannot be made.
