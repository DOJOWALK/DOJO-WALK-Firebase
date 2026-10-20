# Step 177 — Duplicate parent tuple validation

Hardened the read-only District index-pair preflight so both expected parent tuples must contain unique IDs. A repeated ID is an invalid hierarchy input and returns `INPUT_INVALID` with `safeToMigrate: false`.

Added regression tests for duplicates in both the legacy and District-aware parent tuples. Step 176's Security Rules and Callable/Geometry workflows passed. Step 177 CI is pending. No production scan, Firestore write, migration, deployment, or merge was performed.
