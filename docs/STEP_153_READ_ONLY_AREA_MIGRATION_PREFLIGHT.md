# Step 153 — Read-only Area migration preflight classifier

## Changes
- Added `classifyAreaMigrationPreflight`, a pure helper that classifies precomputed checks into:
  - `READY`
  - `LEGACY_NO_DISTRICT`
  - `BROKEN_PARENT_CHAIN`
  - `INDEX_CONFLICT`
  - `LEGACY_INDEX_MISSING_OR_MISMATCHED`
- Added tests for every classification and for an already-existing proposed index owned by the same Area (idempotent-ready case).
- Conflicts never become READY when the proposed index belongs to a different Area.
- This helper performs no Firestore reads/writes and does not execute a scan. A future scanner must paginate trusted records, derive ancestry from parent documents, and feed only verified checks into this classifier.

## Safety
No production records or indexes changed. No deployment, merge, or Customer/Partner changes.
