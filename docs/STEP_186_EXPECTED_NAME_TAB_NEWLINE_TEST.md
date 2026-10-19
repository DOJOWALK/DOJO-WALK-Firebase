# Step 186 — Expected-Name Tab/Newline Normalization Regression

## Change
Added a regression case for an expected location name containing tab and newline whitespace. The classifier should normalize that input to the canonical name and safely classify the consistent legacy-only index.

## Safety
- Test-only change; no production callable or Firestore data changed.
- District-aware preflight remains separate from the production save path.
- No production scan, migration, deployment, or merge performed.
- CI pending.
