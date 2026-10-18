# Connectors

Ote runs on its own: plans, actuals, to-dos, tickets in projects of your own, goals and the diary
all live in Ote, and calendars come in from Google, iCloud, iCal links or the Mac's Calendar.

A **connector** links Ote to a service you already use: a task board, an issue tracker, a team
calendar. It also lets you sign in with that service. A connector supports whichever of these the
service has:

| Part | What Ote does with it |
| --- | --- |
| `tasks` | Two-way sync with To-dos. A task that has a start **and** an end time becomes a Plan. |
| `tickets` | Your assigned tickets show on the Tickets board, and `#project` in the add box files a new one. The ticket sheet shows the description, history and comments when the connector provides them. |
| `calendar` | Read-only calendars, shown like any other calendar. |
| `login` | "Sign in with …" on the login page, using a device code. |

One connector can be connected at a time (Settings → Connector). Its settings are stored encrypted in
`.data/integrations.json`.

## Two ways to connect your service

1. **Implement the REST protocol below on your own server.** Then connect it from Settings with the
   built-in **REST server** connector. You don't change any Ote code.
2. **Write a connector in TypeScript.** Implement `ConnectorDef` from [`types.ts`](./types.ts) and
   add it to `CONNECTORS` in [`index.ts`](./index.ts). Use this when the service has its own API,
   such as Todoist, Linear or GitHub Issues. [`rest.ts`](./rest.ts) is a complete example.

### How the sync behaves

The sync engines are `task-sync.ts` and `ticket-sync.ts`, one level up from this folder.

- **Interval:** they run every minute, and a few seconds after something changes in Ote.
- **Merging:** each run is a 3-way merge against a snapshot of the last good run, so your service
  doesn't need change timestamps. If both sides changed the same thing, Ote's edit wins. For
  tickets, the merge works field by field.
- **Ids:** a task made in Ote is created on your service with Ote's id, a UUID. Keep that id. If
  your service needs its own ids, set `acceptsId` and keep a mapping.
- **Deleting:** deleting in Ote calls `remove`, and you can archive instead of deleting. A task that
  disappears from your list, or shows up in `archivedIds`, is deleted in Ote. If your list can be
  cut off, return `complete: false` so nothing is taken as deleted.
- **Rate limits:** `maxWritesPerRun` caps the writes per run. The defaults are 40 for tasks and 20
  for tickets.
- **Rollover:** if your board moves unfinished past tasks to today on its own, set `rollsOver`.
  Ote then keeps a past plan on its day.
- **Projects:** to map your service's projects to Ote activities, put
  `[{ "activity": "Work", "project_id": "…" }]` in `.data/task-projects.json`.

## REST protocol

The base URL and bearer token are what you enter in Settings. Requests and responses are JSON.
Errors are `{ "error": "message" }` with a non-2xx status. Return `409` to mean "it changed since
you read it". [`scripts/mock-connector.mjs`](../../../../scripts/mock-connector.mjs) implements
the whole protocol in memory and is the reference implementation.

### Identity

`GET /me` returns:

```json
{ "id": "user-1", "label": "me@example.com", "features": ["tasks", "tickets", "calendar"], "timeZone": "Europe/Berlin", "rollsOver": false }
```

`features` lists the parts the server supports. `timeZone` is the zone of the task dates and times.

`DELETE /me/token` is optional. Ote calls it on disconnect so you can revoke the token.

### Tasks

A task looks like this:

```json
{ "id": "uuid", "title": "Gym", "done": false, "date": "2026-10-20", "time": "07:00", "endTime": "08:00", "due": null, "projectId": null }
```

- `date` and `due` are `YYYY-MM-DD`.
- `time` and `endTime` are `HH:MM` wall-clock times in `timeZone`.
- `date`, `time`, `endTime` and `due` can be null.

| Request | Body | Response |
| --- | --- | --- |
| `GET /tasks` | — | `{ "tasks": [Task], "archivedIds": ["…"], "complete": true }`, with open and recently done tasks in `tasks` |
| `POST /tasks` | Task (with Ote's `id`) | the task |
| `PATCH /tasks/:id` | any task fields, plus `"archived": false` to bring an archived task back | the task |
| `DELETE /tasks/:id` | — | — (archive or delete it) |

### Tickets

A ticket looks like this:

```json
{
  "id": "t-1", "containerId": "board-1", "projectId": "web",
  "title": "Fix header", "status": "Todo", "statusGroup": "to_do", "statusColor": "gray",
  "priority": null, "estimate": null, "due": null,
  "assignees": ["Sam"], "author": "Sam", "createdAt": 1760000000000, "completedAt": null, "updatedAt": 1760000000000,
  "files": [{ "id": "f1", "name": "spec.pdf", "type": "application/pdf" }]
}
```

- `statusGroup` is one of `to_do`, `in_progress`, `complete` or `backlog`.
- `containerId` is opaque to Ote. Use it for a board id, a repository, or whatever you need to find
  the ticket again.
- Times are in milliseconds.

| Request | Body | Response |
| --- | --- | --- |
| `GET /tickets/meta` | — | `{ "projects": [{ "id", "name", "parentId", "color", "noBoard"? }], "options": { "status": [{ "name", "group", "color" }], "priority": ["…"], "estimate": ["…"] } }` |
| `GET /tickets` | — | `{ "tickets": [Ticket], "complete": true }`, listing the signed-in person's tickets |
| `POST /tickets` | `{ projectId, title, status, priority, estimate, due }` | the new ticket, assigned to the signed-in person |
| `PATCH /tickets/:id?container=` | `{ title, status, priority, estimate, due, baseUpdatedAt }` | the ticket, or `409` if `baseUpdatedAt` is stale |

The rest is optional and only used by the ticket sheet. Descriptions are
[BlockNote](https://www.blocknotejs.org/) JSON documents, sent as a string.

| Request | Body | Response |
| --- | --- | --- |
| `GET /tickets/:id?container=&detail=1` | — | `{ "body": string \| null, "updatedAt": string, "history": [{ history_id, from_name, to_name, event_kind, changed_at }], "comments": [{ comment_id, author_name, body, created_at }] }` |
| `PUT /tickets/:id/body?container=` | `{ body, base }` | `{ "updatedAt" }`, or `409` if `base` is stale |
| `POST /tickets/:id/body-images?container=` | multipart `files[]`, `base`, `position` (`start` or `end`) | `{ "body", "updatedAt" }` |
| `POST /tickets/:id/comments?container=` | `{ body }` | the comment |
| `GET /files/:container/:fileId` | — | the file |
| `GET /media/:name` | — | an image used in a description, referenced in the body by a URL ending in `/media/<name>` |

### Calendar

| Request | Response |
| --- | --- |
| `GET /calendars` | `[{ "id": "team", "name": "Team", "color": "#30d158" }]` |
| `GET /events?from=<ms>&to=<ms>&tz=<IANA>` | `[{ "id", "calendarId", "title", "start", "end", "allDay", "location"?, "notes"?, "color"? }]`, times in ms |

### Sign-in

Set `OTE_LOGIN_URL` to the base URL. These two endpoints don't need a token.

| Request | Body | Response |
| --- | --- | --- |
| `POST /auth/device/start` | `{ client }` | `{ deviceCode, userCode, verificationUri, expiresIn, interval }` |
| `POST /auth/device/poll` | `{ deviceCode }` | `{ "status": "pending" }`, `{ "status": "expired" }` or `{ "status": "ok", "userId", "email" }` |

The person opens `verificationUri` and approves `userCode`. Ote then starts a session if `userId`
or `email` is on `OTE_ALLOWED_USERS`. Ote keeps no access to your server after that.
