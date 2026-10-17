# Read-only Service Location Integrity Audit

## Purpose and safety

The audit script reads a JSON snapshot from a local file and emits a JSON report. It does **not** connect to Firebase, export data, mutate Firestore, or activate locations. It checks active City/Area boundary references, verification metadata, and basic coordinate validity, but does not replace full polygon geometry validation or authoritative map review. A successful sample run proves only that the tool executes against the sample.

Do not export or access production data until the project owner has explicitly authorized a read-only export and the export method/access scope has been approved. Protect the snapshot and report as potentially sensitive operational data; do not commit real exports to Git.

## Required snapshot shape

Provide all six collections as objects keyed by Firestore document ID:

- `service_countries`
- `service_states`
- `service_cities`
- `service_areas`
- `service_localities`
- `service_location_boundaries`

Preserve document IDs and hierarchy/status fields exactly as exported. Country/State use `isActive`; City/Area/Locality use `isServiceActive`. Do not normalize or repair records before auditing. If a collection was not exported, do not substitute an empty object; obtain a complete export or document the scope limitation separately.

Optional `snapshotMetadata` may be included to describe export scope:
```json
{
  "snapshotMetadata": {
    "sourceProjectId": "project-id",
    "exportedAt": "2026-10-17T00:00:00Z",
    "collectionsIncluded": ["service_countries", "service_states", "service_cities", "service_areas", "service_localities", "service_location_boundaries"],
    "completeCollections": ["service_countries", "service_states", "service_cities", "service_areas", "service_localities", "service_location_boundaries"],
    "recordCounts": {
      "service_countries": 0, "service_states": 0, "service_cities": 0,
      "service_areas": 0, "service_localities": 0, "service_location_boundaries": 0
    }
  }
}
```
Use actual project/export metadata only in a protected local snapshot. The auditor compares declared collection counts with observed snapshot counts and reports `snapshotScope.status` as `DECLARED_COMPLETE`, `INCOMPLETE_OR_UNVERIFIED`, or `UNVERIFIED`. This is a declaration/count consistency check, not cryptographic proof that the export is complete or authorized. Never put real export metadata or snapshots in Git.

The file `scripts/examples/service_location_snapshot.example.json` is a synthetic fixture, not production data.

## Run locally

From the repository root:

```sh
node scripts/audit_service_location_integrity.mjs scripts/examples/service_location_snapshot.example.json /tmp/service-location-integrity-report.json
```

The command exits with code 0 when no issues are found and 1 when integrity issues are found. Invalid/missing collection shapes produce an error. Review `issueCount`, grouped issue counts, `snapshotScope.status`, collection counts, and the exact export scope before interpreting results. An `UNVERIFIED` scope means metadata was not supplied; it is not evidence of a complete export.

For a real authorized snapshot, use a local protected path, not a Git-tracked path:

```sh
node scripts/audit_service_location_integrity.mjs /secure/path/location-snapshot.json /secure/path/location-report.json
```

## Scope and limitations

This is a structural hierarchy and boundary-reference audit: missing parents, mismatched parent IDs, active children beneath inactive/missing ancestors, and basic checks on active City/Area boundary references, verification metadata, and coordinates. It does not establish that the snapshot is current/complete, reconcile rows with the latest official LGD data, verify authoritative contiguous polygons, or prove production behavior. Record export timestamp, source/project, collection counts, operator/authorization, and checksum in a separate controlled audit record. Never publish sensitive document contents in the report.

## Validation

Run the repository's test suite with `npm test`. A clean synthetic fixture is not evidence that live Firestore records are clean.


## Metadata validation added in Step 100
The auditor also checks that `exportedAt` looks like an ISO-style timestamp and parses as a date, that collection-list entries name only the six required collections, and that declared record counts are non-negative integers matching the snapshot. The report exposes `invalidExportTimestamp`, `unknownCollections`, and `malformedCollectionLists` for diagnosis. `recordCounts` must be an object containing only the six required collection names; unknown keys or a malformed count map set `malformedRecordCounts` and `unknownRecordCountKeys` and prevent `DECLARED_COMPLETE`. These checks validate formatting and internal consistency only; they do not authenticate the export source or prove completeness.


`collectionsIncluded` and `completeCollections` must contain unique collection names. Duplicate entries are reported in `duplicateCollectionEntries` and force `INCOMPLETE_OR_UNVERIFIED`; duplicate declarations are malformed metadata even if all required names are present.

Snapshot metadata `exportedAt` must be an ISO-style timestamp with seconds and an explicit timezone (`Z` or an offset such as `+05:30`). Timestamps without a timezone are rejected so export time is not interpreted ambiguously across machines.


## Step 105 — Strict export timestamp calendar/time validation

The offline snapshot auditor requires an explicit timezone and rejects impossible calendar dates, invalid day-of-month values, hours above 23, minutes/seconds above 59, and malformed timezone offsets. A leap-day timestamp is covered as a valid regression case. This validates timestamp syntax/components only; it does not authenticate the export or establish the exporter's clock accuracy.


## Step 106 — Timezone offset bounds

Snapshot export timestamps now reject offsets larger than ±14:00 and reject non-zero minutes at a 14-hour offset. Regression tests cover +15:00 and +14:01 rejection and +14:00 acceptance. This is format validation only and does not authenticate export provenance.
