# Sync

A self-hosted day planner built around plan versus actual. You plan your day on the left, record what
actually happened on the right, and see how well the two line up. It also keeps your to-dos, tickets,
projects, goals and a diary.

It is a single-user web app (Next.js) that you run on your own machine. Every device you use syncs
through it, and each browser keeps a local copy, so it keeps working offline.

## Features

- **Today**: a Plan | Actual grid for one day. Each hour is a row of six 10-minute cells.
  - Drag a block to move or resize it in 5-minute steps, or press and drag on empty space to add one.
  - A now marker shows the current time, and the plan in progress shows as a tentative actual.
  - Calendar events show in both columns. Tap one to turn it into a plan or an actual, mark it
    "Didn't do it", or hide it.
  - Also on this screen: end-of-plan confirmations, a timer, repeating plans, and undo / redo
    (⌘Z / ⌘⇧Z).
- **Home** (desktop): calendar, tasks and tickets, a pomodoro timer, and the day's grid on one screen.
  - Tasks can have branches and a note.
  - In the add box, `#project` files a ticket and `@project` files into a project.
- **Calendar**: a week view (with a To-dos cell) and a month view, with search and an activity filter.
- **Projects**: folders of tasks and tickets with an optional start and due date. Linked activities
  count their time.
  - Complete a project once everything in it is done; Reopen brings it back.
- **Tickets**: a kanban board of tickets in projects of your own. With a connector (below), it also
  shows your assigned tickets from your tracker.
- **Review**: Sync % (the actual matched the plan at its time) and Attainment % (the plan was done at
  some time), by weekday and per activity, compared with the previous period.
- **Goals**: weekly, monthly or yearly goals that fill from your actuals. A goal can count total time,
  a total count, a count every day, or being on time every day.
- **Diary**: a note per day, as a list or a month calendar.
- **Calendars**: Google, iCloud, any iCal link, or everything in the Mac's Calendar app (read-only).
  Plans can also be written to a Mac calendar.
- **Agent chat** (optional): describe changes in plain language ("gym tomorrow at 7 for an hour").
  It uses this machine's Claude Code login, and every change can be undone.
- **Mac menu bar app**: shows the plan in progress and the time left.

## Getting started

It takes about five minutes. You need a computer that stays on while you use Sync (macOS, Linux or
Windows). Your phone and other devices connect to it.

### 1. Install Node.js

Get Node.js **20.9 or newer** from [nodejs.org](https://nodejs.org) (the LTS version is fine). Check
that it worked by running this in a terminal:

```bash
node -v      # v20.9.0 or higher
```

### 2. Download Sync

With git:

```bash
git clone https://github.com/dryxco/sync-planner.git
cd sync-planner
```

Without git, go to the GitHub page and choose **Code → Download ZIP**, unzip it, and open a terminal
in that folder.

### 3. Install and set up

```bash
npm install
npm run setup
```

`npm run setup` asks for the password you'll sign in with. Press Enter to have one generated and
printed instead. It saves the password and an encryption key to `.env.local`. Every other setting
in [`.env.example`](.env.example) is optional.

### 4. Start it

```bash
npm run build
npm start
```

Open **http://localhost:3000** and sign in with your password. To stop the server, press Ctrl+C in the
terminal. Later, just run `npm start` again; you only need `npm run build` again after an update.

> Port 3000 taken? Use `npm start -- -p 3001` and open http://localhost:3001.

### 5. First steps in the app

1. **Settings** (the gear icon) → Time: set **Day start time** (when your day begins, e.g. 05:00) and
   **Week starts on**.
2. **Activities**: Sync starts with Sleep, Work, Exercise, Reading, Travel, Meal, Commute and Other.
   Rename them, recolour them, or add your own. Every plan and actual belongs to one.
3. **Plan your day** (Today, or Home on a computer): tap or drag on empty space in the **Plan** column,
   choose an activity, and save.
4. **Record what happened**: do the same in the **Actual** column. Or turn on Settings → Notification
   defaults → **End confirmation**: when a plan ends, Sync then asks whether you did it (✓ / ✕), and a
   confirmed plan becomes an actual for you.
5. **Connect your calendars** (optional): Settings → Accounts. Events then show beside your plans,
   and you can tap one to make it a plan. See [Calendars](#calendars).
6. **Check how it went**: **Review** compares plan and actual, and **Goals** fill up from your actuals.

Settings → Data → **Export backup** saves everything as a JSON file at any time.

### 6. Use it on your phone

Your phone has to reach the computer Sync runs on.

- **On the same Wi-Fi**: start the server with `npm start -- -H 0.0.0.0` and open
  `http://<computer's IP>:3000` on your phone. Anyone on that network can reach the sign-in page, so
  use a strong password.
- **From anywhere, privately (recommended)**: use [Tailscale](https://tailscale.com), free for
  personal use.
  1. Install it on the computer and on your phone, and sign in to the same account on both.
  2. On the computer, run `npm start -- -H 127.0.0.1` and `tailscale serve --bg 3000`.
  3. On your phone, open `https://<computer-name>.<tailnet>.ts.net`. `tailscale serve status` prints
     the exact address.

  Don't use `tailscale funnel`, which makes it public.

Then add it to your home screen so it opens like an app: on iPhone, Share → **Add to Home Screen**;
on Android, the menu → **Install app**.

### Updating

```bash
git pull            # or download the new ZIP and copy your .env.local and .data/ into it
npm install
npm run build
```

Then restart `npm start`. Your data lives in `.data/` and your settings in `.env.local`, and an
update touches neither.

### Keep it running

`npm start` runs only while its terminal is open. To keep Sync running in the background:

- **macOS**: run it as a launchd service and deploy updates with `scripts/deploy.sh`. See
  [Run it as a service](#run-it-as-a-service-macos).
- **Anywhere**: use a process manager such as [pm2](https://pm2.keymetrics.io): `npx pm2 start npm --name sync -- start`.

### Troubleshooting

| What you see | What to do |
| --- | --- |
| "No sign-in is set up on this server" | Run `npm run setup`, then restart the server. |
| Forgot the password | Open `.env.local`, change `SYNC_PASSWORD`, and restart the server. |
| The page is blank on another device | Use `npm run build && npm start`, not `npm run dev`. |
| "Can't decrypt saved calendar connections" | `SYNC_SECRET` changed. Put the old value back, or delete `.data/integrations.json` and reconnect your calendars. |
| `npm install` fails | Check `node -v`: it must be 20.9 or newer. |

## More setup

### Sign-in

Every page and API needs a session. You can sign in either of these ways:

- **Password**: set `SYNC_PASSWORD` (which `npm run setup` does).
- **A sign-in server of your own**: a device-code sign-in (see the
  [connector protocol](src/lib/server/connectors/README.md#sign-in)). Set `SYNC_LOGIN_URL`, and list
  who may sign in in `SYNC_ALLOWED_USERS`.

If neither is set, nobody can sign in. `SYNC_AUTH=off` turns the sign-in off altogether. Use it only
on a server nobody else can reach.

`SYNC_ALLOWED_TAILSCALE_USERS` adds a second gate: requests through `tailscale serve` must come from
one of those Tailscale logins.

### Run it as a service (macOS)

`scripts/deploy.sh` deploys safely:

1. It runs the checks.
2. It copies the tree into `$SYNC_LIVE_DIR/releases/<ts>` (APFS clones) and builds there.
3. It switches `$SYNC_LIVE_DIR/current` and restarts the launchd job `$SYNC_LAUNCHD_LABEL`.

The live server never runs from your working tree. Point the launchd job at `npm start` in
`$SYNC_LIVE_DIR/current` with `SYNC_DATA_DIR=<repo>/.data`, so data stays in one place across releases.

## Connectors: plug in your own task board, tracker or team calendar

Sync works fully on its own. A **connector** links it to a service you already use:

- two-way sync between its tasks and Sync's to-dos (timed tasks become plans),
- your assigned tickets on the Tickets board, with descriptions, history and comments,
- its calendars,
- optionally, sign-in.

There are two ways to connect your service:

- **Without writing Sync code:** implement the small REST protocol on your server, then use
  Settings → Connector → REST server.
- **In TypeScript:** write a connector for a service's own API and register it in
  `src/lib/server/connectors/index.ts`.

Both are documented in [`src/lib/server/connectors/README.md`](src/lib/server/connectors/README.md).
`scripts/mock-connector.mjs` implements the whole protocol in memory, as a reference.

## Calendars

- **This Mac's Calendar**: shows everything Apple Calendar does, including shared and Workspace
  calendars. It is read-only, through EventKit. Build the helper once with `tools/ekexport/build.sh`,
  then turn on Settings → This Mac. Plans can also be saved to a writable Mac calendar.
- **Any iCal link**: Settings → Add calendar by iCal link. For Google calendars you own, use the
  "Secret address in iCal format". `scripts/google-calendar-ics.gs` serves calendars shared with you
  the same way.
- **Google**:
  1. In Google Cloud Console, enable the Google Calendar API.
  2. Create an OAuth client of type *Web application* with the redirect URI
     `${APP_URL}/api/auth/google/callback`.
  3. Put the client id and secret in `.env.local`.

  While the consent screen is in *Testing*, Google expires refresh tokens after 7 days, so publish
  the app (unverified apps still work for the owner).
- **iCloud**: use an app-specific password from appleid.apple.com → Sign-In and Security.

Calendar endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/calendar/calendars` | Connected accounts and calendars. A failing account goes into `errors`, never a 500. |
| `GET /api/calendar/events?start=<ms>&end=<ms>[&tz=<IANA>]` | Occurrences overlapping the range (at most 400 days), with recurring events expanded. |

## Data

`.data/` is git-ignored and holds all your data:

| File | Contents |
| --- | --- |
| `sync-default.json` | Your plans, actuals, to-dos and so on. Merged per record, last write wins, deletes kept as tombstones. |
| `sync-journal.jsonl` | Which device changed what. |
| `integrations.json` | Calendar and connector credentials, encrypted with AES-256-GCM using a key derived from `SYNC_SECRET`. |
| `sessions.json` | Sessions, stored hashed. |

The file store needs a writable, persistent disk, so it won't persist on serverless hosts.

## Mac menu bar

To set up the menu bar app:

1. Build it with `zsh tools/menubar/build.sh` (needs the Xcode command line tools).
2. Copy `.bin/SyncMenuBar.app` to `/Applications` and open it.
3. Choose "Set up…" and enter your server URL.
4. Paste the token from Settings → Mac menu bar → Copy menu bar token.

The token can only read your current and next plan. To rotate it, delete `.data/menubar-token`.

## Checks

```bash
npm run lint && npx tsc --noEmit && npm test
```

The Playwright e2e scripts in `scripts/` run against a throwaway server, so they never touch real
data.

1. Start the throwaway server:
   ```bash
   T=$(mktemp -d)
   SYNC_DATA_DIR=$T SYNC_DISABLE_JOBS=1 SYNC_ALLOWED_USERS=good-user npx next start -p 3302
   ```
2. Give the scripts a session:
   ```bash
   export SYNC_TEST_SESSION=$(node scripts/make-test-session.mjs $T good-user) SYNC_TEST_BASE=http://127.0.0.1:3302
   ```
3. Run the scripts:
   ```bash
   node scripts/e2e-today.mjs $SYNC_TEST_BASE   # and the other e2e-*.mjs
   ```

Some scripts need extra setup:

- `e2e-connector.mjs` and `e2e-auth.mjs` also need `node scripts/mock-connector.mjs 3399`.
- For `e2e-auth.mjs`, start the server with `SYNC_PASSWORD=test-pass SYNC_LOGIN_URL=http://127.0.0.1:3399`.
- Each script's header says what else it needs.

## License

Copyright © 2026 [dryxco](https://github.com/dryxco). Licensed under
[PolyForm Noncommercial 1.0.0](LICENSE.md). You can use, change and share Sync for any
noncommercial purpose: personal use, study, research, hobby projects, and nonprofit, educational or
government organizations. Commercial use isn't allowed. For that, ask for a separate license.
