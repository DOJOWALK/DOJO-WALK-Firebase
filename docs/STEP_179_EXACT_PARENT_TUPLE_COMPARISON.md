# Step 179 — Exact parent tuple comparison

Simplified the read-only index classifier's parent tuple comparison to check tuple length and each ordered ID directly instead of serializing arrays as JSON. This keeps hierarchy matching exact and order-sensitive while avoiding unnecessary serialization.

Added regression tests for reordered and wrong-length tuples. Step 178's Security Rules and Callable/Geometry workflows passed. Step 179 CI is pending. No production scan, Firestore write, migration, deployment, or merge was performed.
