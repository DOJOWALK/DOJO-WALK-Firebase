#!/usr/bin/env node
"use strict";

/**
 * Read-only inventory of service_cities and their Country/State/District chain.
 * Does not infer Districts from names and never writes Firestore.
 */
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { classifyCityDistrictCompatibility } = require("../lib/district_schema_contract");

function resolveProjectId(env = process.env) {
  return env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
}

function parsePageSize(value) {
  const parsed = Number.parseInt(value || "200", 10);
  return Math.min(500, Math.max(1, Number.isFinite(parsed) && parsed !== 0 ? parsed : 200));
}

async function readDoc(db, collection, id) {
  if (typeof id !== "string" || !id.trim()) return null;
  // Validate document IDs before calling Firestore: slash-containing IDs are
  // malformed data, not a network/permission read failure.
  if (id !== id.trim() || id.includes("/")) {
    throw new Error("DOCUMENT_ID_INVALID");
  }
  const snap = await db.collection(collection).doc(id).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

async function writeReport(path, json, fs = require("node:fs")) {
  if (!path) return;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
  const fd = fs.openSync(path, flags, 0o600);
  try {
    fs.writeFileSync(fd, json, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

async function runInventory({ db, projectId, pageSize = 200, outputPath = null, writeReportFn = writeReport }) {
  if (!db) throw new Error("FIRESTORE_CLIENT_REQUIRED");
  if (typeof projectId !== "string" || !projectId.trim()) throw new Error("PROJECT_ID_REQUIRED");
  const safePageSize = parsePageSize(String(pageSize));
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
    let query = db.collection("service_cities").orderBy("__name__").limit(safePageSize);
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
          readDoc(db, "service_countries", city.countryId),
          readDoc(db, "service_states", city.stateId),
        ]);
        if (!country) throw new Error("COUNTRY_MISSING");
        if (!state || state.countryId !== city.countryId) throw new Error("STATE_COUNTRY_MISMATCH");

        let district = null;
        const hasDistrict = city.districtId !== undefined && city.districtId !== null && city.districtId !== "";
        if (hasDistrict) district = await readDoc(db, "service_districts", city.districtId);
        status = classifyCityDistrictCompatibility({
          city, district, expectedCountryId: city.countryId, expectedStateId: city.stateId,
        });
        reason = status === "DISTRICT_LINKED"
          ? "DISTRICT_AND_PARENT_CHAIN_MATCH"
          : status === "LEGACY_NO_DISTRICT"
            ? "DISTRICT_ID_MISSING_MANUAL_REVIEW_REQUIRED"
            : "DISTRICT_OR_PARENT_CHAIN_MISMATCH";
      } catch (error) {
        // Do not export raw SDK exception text: it can contain document paths or IDs.
        const message = error && typeof error.message === "string" ? error.message : "";
        const code = error && typeof error.code === "string" ? error.code : "";
        if (message === "CITY_PARENT_FIELDS_INVALID" || message === "DOCUMENT_ID_INVALID" ||
            message === "COUNTRY_MISSING" || message === "STATE_COUNTRY_MISMATCH") {
          status = "BROKEN_PARENT_CHAIN";
          reason = message;
        } else if (code) {
          status = "READ_ERROR";
          reason = "READ_FAILED";
        } else {
          status = "BROKEN_PARENT_CHAIN";
          reason = "VALIDATION_FAILED";
        }
      }
      counts[status] = (counts[status] || 0) + 1;
      // Do not include raw Firestore document IDs: some projects use readable
      // location names as IDs. Keep this exported report free of those values.
      records.push({ status, reason });
    }
    lastDoc = page.docs[page.docs.length - 1];
    if (page.size < safePageSize) break;
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
      rawDocumentIdsIncluded: false,
      approvalForMigration: false,
      note: "Paginated scan is not an atomic snapshot. Report records omit document IDs and are not directly traceable to individual documents. Review exceptions separately and rerun before any separately approved migration.",
    },
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  await writeReportFn(outputPath, json);
  return { report, json };
}

async function main(env = process.env) {
  const projectId = resolveProjectId(env);
  if (!projectId) {
    console.error("Set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT explicitly; refusing to guess a Firebase project.");
    process.exitCode = 2;
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const outputPath = env.REPORT_PATH || null;
  const pageSize = parsePageSize(env.PAGE_SIZE);
  const { json, report } = await runInventory({ db, projectId, pageSize, outputPath });
  if (!outputPath) process.stdout.write(json);
  else console.log(`Read-only inventory written to ${outputPath}; scanned ${report.scanned} City records.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("City inventory failed; no migration writes are performed.", error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { resolveProjectId, parsePageSize, readDoc, writeReport, runInventory, main };
