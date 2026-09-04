# ProjectActivity: canonical Timeline and delivery registry

## Root cause verified on 2026-09-04

Production Timeline reports the headers `ID | Project ID | TaskID | Timestamp |
EventType | Description | Author`, but the 272 visible data rows still carry the
legacy four-value layout in columns A-D. Columns E-G are empty. The repository,
Git history, and current remote Apps Script source all write the legacy layout
`Data | Project ID | Tipo | Descrizione`. The seven-column header change is not
represented in Git. The 21 duplicated values in column A are timestamps from
distinct events, not stable event identifiers.

No historical row is rewritten by this change.

## Canonical Timeline V1

The future logical row is:

| Field | Meaning |
|---|---|
| ID | Logical entity involved when one exists: Project ID, Task ID, or Activity ID. Empty for a generic memory event. It is not the outbox event ID. |
| Project ID | Required owning Project ID. |
| TaskID | Task ID only for task events; otherwise empty. |
| Timestamp | Actual event timestamp. |
| EventType | Stable event classification. |
| Description | Human-readable description, never a payload dump. |
| Author | Normalized non-sensitive source: `SYSTEM`, `CUSTOM_GPT`, or `PROJECT_ACTIVITY`. |

`TimelineRepository.fromRow` recognizes canonical rows by populated canonical
tail fields and otherwise interprets A-D as the legacy layout, even below the
seven current headers. Both layouts produce the common properties `timestamp`,
`projectId`, `eventType`, and `description`.

The canonical writer is `TimelineRepository.appendEvent`. Legacy services use
`addTimeline` only as a compatibility adapter; no Service assembles positional
rows directly.

## Writer mappings

- Project create/update: ID = Project ID, TaskID empty, Author `SYSTEM`.
- Task create/complete: ID and TaskID = Task ID, Author `SYSTEM`.
- Desk memory event: ID and TaskID empty, Author `CUSTOM_GPT`.
- ProjectActivity: ID = Activity ID, TaskID empty, Author `PROJECT_ACTIVITY`.

The current event types remain stable. A future normalization of generic memory
types requires a separate compatibility review.

## Technical delivery registry

The technical sheet `ProjectActivityTimelineDelivery` has:

`EventId | ProjectId | Fingerprint | TimelineRow | CreatedAt | Status`

`Status` is `PENDING` or `DELIVERED`. `EventId` is the D1 outbox identifier and
is never written into Timeline.ID. The fingerprint is SHA-256 over a fixed JSON
array containing logical ID, Project ID, TaskID, ISO timestamp, EventType,
Description, and Author. It contains no token or non-deterministic field.

The sink holds the DocumentLock, reserves the expected Timeline row in a
`PENDING` record before append, and marks it `DELIVERED` afterward. Sheets has
no multi-sheet transaction. If the final update fails, retry checks exactly the
reserved row and its fingerprint. A match is finalized without append; an
absent or unrelated row causes a new final-row reservation under the same lock.
This distinguishes semantically identical events with different EventIds and
mitigates response loss, but cannot provide database-grade atomicity.

## Migration and rollback

`PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1` creates only the technical sheet. It
requires dry-run, verified physical backup, exact confirmation
`APPLY PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`, lock, and MigrationLog. Rollback
is permitted only while the registry contains no delivery rows.

`TIMELINE_EVENT_ID_V1` is superseded and its normal manifest entrypoint always
fails. Its historical manifest remains only as an auditable artifact and is not
part of activation.

## Rollout

Before activating canonical writes for all legacy flows, inventory external
consumers of Timeline and confirm that they accept mixed legacy/canonical rows.
Until that check is complete the release is locally ready but production is
NO-GO. Activation order: verified spreadsheet backup, compatible Apps Script,
registry-sheet migration, canonical-writer smoke, D1, Worker, ProjectActivity
smoke, then GPT. Never rewrite historical Timeline rows automatically.
