# Step 176 — Index snapshot shape validation

The read-only District index-pair classifier now validates that both supplied index snapshots are non-null objects and that each `exists` field is a boolean before reading snapshot properties. Malformed runtime input returns `INPUT_INVALID` with `safeToMigrate: false` instead of being treated as a migration candidate or throwing during classification.

Regression tests cover a non-boolean `exists` field and a null snapshot. No Firestore reads/writes, production scan, migration, deployment, or merge were performed.
