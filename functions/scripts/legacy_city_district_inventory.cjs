#!/usr/bin/env node
"use strict";

/**
 * Read-only inventory of service_cities and their Country/State/District chain.
 * Does not infer Districts from names and never writes Firestore.
 */
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { classifyCityDistrictCompatibility } = require("../lib/district_schema_contract");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("Set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT explicitly; refusing to guess a Firebase project.");
  process.exit(2);
}
const pageSize = Math.min(500, Math.max(1, Number.parseInt(process.env.PAGE_SIZE || "200", 10) || 200));
const outputPath = process.env.REPORT_PATH;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

async function readDoc(collection, id) {
  if (typeof id !== "string" || !id.trim()) return null;
  // Validate document IDs before calling Firestore: slash-containing IDs are
  // malformed data, not a network/permission read failure.
  if (id !== id.trim() || id.includes("/")) {
    throw new Error("DOCUMENT_ID_INVALID");
  }
  const snap = await db.collection(collection).doc(id).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

async function writeReport(path, json) {
  if (!path) return;
  const fs = require("node:fs");
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
  const fd = fs.openSync(path, flags, 0o600);
  try { fs.writeFileSync(fd, json, "utf8"); } finally { fs.closeSync(fd); }
}

async function run() {
  const counts = {
    DISTRICT_LINKED: 0,
    LEGACY_NO_DISTRICT: 0,
    BROKEN_PARENT_CHAIN: 0,
    READ_ERROR: 0,
  };
  const records = [];
  let lastDoc = null;
  let scanned = 0;

  while (true) {
    let query = db.collection("service_cities").orderBy("__name__").limit(pageSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const page = await query.get();
    if (page.empty) break;

    for (const snap of page.docs) {
      scanned += 1;
      const city = snap.data();
      let status = "BROKEN_PARENT_CHAIN";
      let reason = "CITY_PARENT_FIELDS_INVALID";
      try {
        if (typeof city.countryId !== "string" || !city.countryId.trim() ||
            typeof city.stateId !== "string" || !city.stateId.trim()) {
          throw new Error("CITY_PARENT_FIELDS_INVALID");
        }
        const [country, state] = await Promise.all([
          readDoc("service_countries", city.countryId),
          readDoc("service_states", city.stateId),
        ]);
        if (!country) throw new Error("COUNTRY_MISSING");
        if (!state || state.countryId !== city.countryId) throw new Error("STATE_COUNTRY_MISMATCH");

        let district = null;
        const hasDistrict = city.districtId !== undefined && city.districtId !== null && city.districtId !== "";
        if (hasDistrict) district = await readDoc("service_districts", city.districtId);
        status = classifyCityDistrictCompatibility({
          city, district, expectedCountryId: city.countryId, expectedStateId: city.stateId,
        });
        reason = status === "DISTRICT_LINKED"
          ? "DISTRICT_AND_PARENT_CHAIN_MATCH"
          : status === "LEGACY_NO_DISTRICT"
            ? "DISTRICT_ID_MISSING_MANUAL_REVIEW_REQUIRED"
            : "DISTRICT_OR_PARENT_CHAIN_MISMATCH";
      } catch (error) {
        status = error && error.code ? "READ_ERROR" : "BROKEN_PARENT_CHAIN";
        reason = error && typeof error.message === "string" ? error.message : "UNKNOWN_READ_ERROR";
      }
      counts[status] = (counts[status] || 0) + 1;
      records.push({ cityId: snap.id, status, reason });
    }
    lastDoc = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }

  const report = {
    reportType: "read-only-service-city-district-inventory",
    projectId,
    generatedAt: new Date().toISOString(),
    collection: "service_cities",
    scanned,
    counts,
    records,
    safety: {
      firestoreWritesPerformed: false,
      districtNamesUsedForInference: false,
      locationNamesIncluded: false,
      approvalForMigration: false,
      note: "Paginated scan is not an atomic snapshot. Review exceptions and rerun before any separately approved migration.",
    },
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  await writeReport(outputPath, json);
  if (!outputPath) process.stdout.write(json);
  else console.log(`Read-only inventory written to ${outputPath}; scanned ${scanned} City records.`);
}

run().catch((error) => {
  console.error("City inventory failed; no migration writes are performed.", error && error.message ? error.message : error);
  process.exitCode = 1;
});
