# Step 170 — Read-only District index-pair preflight

Added a pure classifier for legacy and District-aware name-index pairs. It distinguishes missing indexes, legacy-only, District-aware-only, consistent dual indexes, and ownership/tuple conflicts. Every classification includes a reason and a `safeToMigrate` boolean.

Added tests for normal paths, wrong owner/tuple/collection, name normalization, and input immutability. This is a read-only helper only: it is not wired into the production callable and does not read or write Firestore itself.

No production scan, migration, deployment, or merge was performed. CI status pending.
