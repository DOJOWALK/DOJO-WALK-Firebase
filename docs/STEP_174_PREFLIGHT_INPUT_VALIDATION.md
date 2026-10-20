# Step 174 — Validate preflight inputs before migration classification

The District index-pair classifier now validates the expected collection/document identity, normalized name (nonempty and at most 120 characters), and both parent tuples before assessing index ownership. Invalid expected input returns `INPUT_INVALID` with `safeToMigrate: false`.

Regression tests cover blank and oversized names, malformed parent IDs, and invalid document IDs. This closes a safety gap where invalid expected metadata could otherwise be compared against stored index values.

CI for this commit is pending. No Firestore scan, production write, migration, deployment, or merge was performed.
