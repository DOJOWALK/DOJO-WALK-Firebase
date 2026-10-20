# Step 178 — Populated index snapshot validation

Extended the read-only classifier's runtime validation for snapshots marked as existing. An existing snapshot must now contain a canonical document ID, collection identifier, normalized name, and non-empty unique parent tuple. Malformed snapshot contents return `INPUT_INVALID` and cannot be classified as migration-safe.

Added regression tests for a path-shaped document ID and a non-canonical stored name. Step 177's Security Rules and Callable/Geometry workflows passed. Step 178 CI is pending. No production scan, Firestore write, migration, deployment, or merge was performed.
