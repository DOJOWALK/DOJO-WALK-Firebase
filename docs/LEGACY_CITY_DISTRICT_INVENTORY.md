# Read-only City → District inventory

This scanner counts and classifies documents in `service_cities`. It does not infer a District from a City name, update documents, or deploy anything.

## Run manually

From `functions/` after installing dependencies and building:

```sh
npm ci
npm run build
GCLOUD_PROJECT="YOUR_INTENDED_PROJECT_ID" REPORT_PATH="./city-district-inventory.json" node scripts/legacy_city_district_inventory.cjs
```

Application Default Credentials must be configured for read access. The script refuses to guess the Firebase project. The report path is created exclusively; an existing report is never overwritten. Without `REPORT_PATH`, JSON is printed to stdout.

## Statuses

- `DISTRICT_LINKED`: District exists and Country/State ancestry matches.
- `LEGACY_NO_DISTRICT`: City has no District ID; manual review is required.
- `BROKEN_PARENT_CHAIN`: Country, State, District, or ancestry is missing/mismatched or malformed.
- `READ_ERROR`: a Firestore read failed; rerun after resolving permissions/connectivity.

The exported report includes status and reason per record but deliberately omits raw document IDs, because some projects use readable location names as IDs. This reduces accidental disclosure but means the report cannot directly identify an individual City document for follow-up; investigate specific records separately under appropriate access controls. Pagination uses document ID ordering and is not an atomic snapshot. Rerun and compare reports before considering any separately approved migration. No production scan is performed by CI.
