# Step 147 — Area callable migration guard

## Change
- Added an emulator-backed callable regression test to `functions/test/location_name_index_callable.test.cjs`.
- The test sends an Area payload containing `districtId` to the current legacy trusted callable and expects `invalid-argument`.
- It verifies the rejected request creates neither an Area document nor a canonical legacy Area name-index document.
- This is intentional until Area/Locality District ancestry, transactional parent validation, and the name-index tuple are migrated together.

## Contract confirmed
- Legacy Area payload/index tuple: Country → State → City.
- Proposed District-aware Area tuple: Country → State → District → City.
- The current callable and Admin Area model must not be switched independently. Existing Area/Locality documents and name-index IDs need a migration plan and compatibility strategy first.

## Validation
- Firebase Callable and Geometry Tests and Firestore Security Rules workflows were triggered by this commit. Check their final GitHub Actions results before marking this step fully validated.
- No production callable deployment, data migration, production import, or Admin/Customer/Partner repo changes were made.
