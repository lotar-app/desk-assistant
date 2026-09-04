# ProjectActivity Phase 3A: reliable outbox delivery

Phase 3A introduces an explicitly invoked delivery path from the D1
`timeline_outbox` to the Google Sheets Timeline. It does not schedule or invoke
delivery from `updateProjectActivity`.

## Delivery flow

1. `deliverOutboxEvent(eventId)` reads one row by its D1 primary key.
2. A row with `delivered_at` is returned without an HTTP request.
3. The Worker sends the event to Apps Script using the existing JSON-body
   `DESK_API_TOKEN` authentication.
4. Apps Script validates the Project, locks the Spreadsheet, and performs an
   EventId lookup followed by at most one append.
5. A newly created row and an idempotent replay are both delivery success.
6. Only an unambiguous success sets `delivered_at`; every failed HTTP attempt
   increments `attempts` and records a sanitized `last_error`.

The internal Apps Script action is `appendProjectActivityTimelineEvent`. It is
not listed in the Custom GPT OpenAPI. Its required fields are `eventId`,
`projectId`, and `description`; it also accepts `activityId`, `eventType`,
`createdAt`, and `payload`. It never creates Projects, changes Tasks, or calls
`updateDesk`.

## Sink idempotency and response loss

The Sheets migration `TIMELINE_EVENT_ID_V1` appends the nullable `EventId`
column at position 5. Historical rows remain unchanged and readable. The
migration must pass the existing backup, baseline, dry-run, confirmation, lock,
and migration-log workflow before it is ever applied.

For a new EventId the sink appends `createdAt`, `projectId`, `eventType`, the
human-readable `description`, and `eventId`. The complete payload remains in
D1 and is not dumped into Timeline. A repeated EventId with the same persisted
Timeline content returns `{ created: false, idempotentReplay: true }`. A
different Project, type, or description returns `TIMELINE_EVENT_CONFLICT` and
does not append.

The Apps Script document lock serializes lookup plus append. Therefore two
Worker executions may issue concurrent HTTP requests, but only one Timeline
row is created. This also covers a successful append followed by a lost HTTP
response: the retry receives an idempotent success and the Worker can safely
mark the D1 row delivered.

## D1 state and retry semantics

Migration `0003_project_activity_outbox_delivery.sql` adds an index on
`(delivered_at, created_at, event_id)`. It does not alter existing rows.

`attempts` is the count of HTTP attempts actually made. It starts at zero and
is incremented atomically after every success or failure. A first success is 1;
a failure followed by success is 2. A row already delivered causes no HTTP
request and no increment.

`delivered_at` is assigned only after a valid positive sink response, including
an idempotent replay. It is never overwritten. `last_error` stores only a
bounded JSON record with code, generic message, retryability, and HTTP status;
it is cleared on success and never contains the request, URL, token, or remote
response body.

Network errors, HTTP 5xx, and invalid or ambiguous responses are retryable.
HTTP 4xx, invalid input/Project, and sink idempotency conflicts are permanent.
`deliverPendingOutbox(limit)` requires an integer from 1 to 100, reads only that
many undelivered rows ordered by `created_at, event_id`, and returns one result
per event. There is no unbounded scan.

## Activation prerequisites and exclusions

Before real activation, deploy the reviewed Apps Script version, execute the
Sheets migration through its guarded workflow, apply D1 migration 0003, deploy
the Worker, verify token alignment without logging it, and run the runbook's
read-only checks before any mutating test.

Phase 3A does not include a cron/scheduled retry, automatic delivery during
`updateProjectActivity`, automatic Custom GPT writes, brainstorming snapshot
updates, semantic search, historical Timeline import, deployment, or remote
migration execution.
