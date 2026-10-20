# Step 173 — Index ownership conflict regression tests

Added regression tests for two additional unsafe migration cases:

1. Both legacy and District-aware index documents exist and agree with each other, but both point to a location other than the expected document. The classifier must reject the pair.
2. Only the District-aware index exists, but it points to a different location document. The classifier must reject it.

These tests exercise the read-only classifier only; they do not access production Firestore. No migration, deployment, or merge was performed. CI for the test commit is pending.
