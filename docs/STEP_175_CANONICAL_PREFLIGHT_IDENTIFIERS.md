# Step 175 — Canonical preflight identifiers

Tightened read-only District index-pair preflight validation: parent IDs must already be trimmed canonical IDs, and the expected collection must be a single collection identifier rather than a path. This prevents whitespace or path-shaped values from entering the comparison as if they were canonical inputs.

Added regression tests for whitespace-padded parent IDs and collection paths. Step 174's Security Rules and Callable/Geometry workflows both passed; Step 175 CI is pending. No production scan, Firestore write, migration, deployment, or merge was performed.
