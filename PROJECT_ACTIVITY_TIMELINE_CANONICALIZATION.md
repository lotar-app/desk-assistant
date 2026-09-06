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

`TimelineRepository.fromRow` recognizes a canonical row only when Project ID,
EventType, and Description are populated in their canonical positions. It
otherwise interprets A-D as the legacy layout, even below the seven current
headers. Requiring the structural fields avoids classifying a legacy row as
canonical because of an isolated accidental value in E-G. Both layouts produce
the common properties `timestamp`, `projectId`, `eventType`, and `description`.

## Transitional writer split

The production transition deliberately keeps two centralized writers:

- `TimelineRepository.appendLegacy` writes exactly four physical values,
  `timestamp | projectId | eventType | description`;
- `TimelineRepository.appendEvent` writes the canonical seven-column row and
  is reserved for the ProjectActivity sink.

`addTimeline` is the compatibility adapter used by every existing Desk flow.
It calls only `appendLegacy`; options formerly used to describe canonical ID,
TaskID, and Author do not change the physical row. ProjectActivity bypasses
this adapter and calls `appendEvent` after delivery-registry checks.

## Writer mappings

- Project create/update: legacy A-D row.
- Task create/complete: legacy A-D row; the historical layout has no TaskID
  column and the task remains represented in event type/description.
- Desk memory event: legacy A-D row.
- ProjectActivity: canonical row with ID = Activity ID, Project ID = projectId,
  TaskID empty, Timestamp = createdAt, EventType and readable Description from
  the outbox event, and Author `PROJECT_ACTIVITY`.

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

Mixed-layout parsing is supported. On 2026-09-04 Max manually verified all live
sheets and found no pivot, and confirmed no known external Desk or Timeline
consumer. The transitional architecture completed its operational gates and is
active in production. Gate 7 verified one Timeline row and one delivery
registry record per outbox event, without duplicates. The global canonical
writer for Project, Task, memory, or `updateDesk` remains unauthorized:
ProjectActivity alone may introduce canonical rows. Never rewrite historical
Timeline rows automatically.

The active registry was created by
`PROJECT_ACTIVITY_TIMELINE_DELIVERY_V1`; `TIMELINE_EVENT_ID_V1` remains
superseded and non-applicable. Apps Script production is version 27 and the
active Worker version recorded at final validation is
`4edc6eff-8cd6-4e7d-9887-82a852d6a806`.
