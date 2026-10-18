# Step 167 — District ancestry regression matrix

Added callable regression coverage for: (1) District linked to the wrong State, (2) Locality save where City references a missing District document, and (3) legacy City without a District remains compatible for Area creation. Negative cases assert that neither location nor canonical name index is written. Tests are emulator-backed through the existing trusted callable test workflow.

Verification status: CI triggered; check both workflows before calling this step verified.

No production scan, migration, deployment, or merge was performed.
