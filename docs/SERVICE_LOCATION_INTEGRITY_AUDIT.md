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

The file `scripts/examples/service_location_snapshot.example.json` is a synthetic fixture, not production data.

## Run locally

From the repository root:

```sh
node scripts/audit_service_location_integrity.mjs scripts/examples/service_location_snapshot.example.json /tmp/service-location-integrity-report.json
```

The command exits with code 0 when no issues are found and 1 when integrity issues are found. Invalid/missing collection shapes produce an error. Review `issueCount`, each issue code, record counts, and the exact export scope before interpreting results.

For a real authorized snapshot, use a local protected path, not a Git-tracked path:

```sh
node scripts/audit_service_location_integrity.mjs /secure/path/location-snapshot.json /secure/path/location-report.json
```

## Scope and limitations

This is a structural hierarchy and boundary-reference audit: missing parents, mismatched parent IDs, active children beneath inactive/missing ancestors, and basic checks on active City/Area boundary references, verification metadata, and coordinates. It does not establish that the snapshot is current/complete, reconcile rows with the latest official LGD data, verify authoritative contiguous polygons, or prove production behavior. Record export timestamp, source/project, collection counts, operator/authorization, and checksum in a separate controlled audit record. Never publish sensitive document contents in the report.

## Validation

Run the repository's test suite with `npm test`. A clean synthetic fixture is not evidence that live Firestore records are clean.
