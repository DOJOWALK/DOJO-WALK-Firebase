# Step 180 — Top-level preflight input guard

Added a runtime guard for a null or non-object top-level input before reading any properties. Invalid input returns `INPUT_INVALID` and `safeToMigrate: false` instead of throwing. Added a regression test for null input.

Step 179's code workflows passed; its final report-commit workflows were still in progress at the time of the last check. Step 180 CI is pending. No production scan, Firestore write, migration, deployment, or merge was performed.
