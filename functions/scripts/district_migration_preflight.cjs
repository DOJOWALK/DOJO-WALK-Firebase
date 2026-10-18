#!/usr/bin/env node
"use strict";

/** Read-only District migration preflight for service_areas. */
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");
const { districtAwareNameIndexId } = require("../lib/district_name_index_contract");
const {
  classifyAreaMigrationPreflight,
  classifyCityDistrictCompatibility,
} = require("../lib/district_schema_contract");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("Set GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT explicitly; refusing to guess a Firebase project.");
  process.exit(2);
}
const pageSize = Math.min(500, Math.max(1, Number.parseInt(process.env.PAGE_SIZE || "200", 10) || 200));
const outputPath = process.env.REPORT_PATH;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
async function readDoc(collection, id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const snap = await db.collection(collection).doc(id).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

async function run() {
  const counts = {
    READY: 0,
    LEGACY_NO_DISTRICT: 0,
    BROKEN_PARENT_CHAIN: 0,
    INDEX_CONFLICT: 0,
    LEGACY_INDEX_MISSING_OR_MISMATCHED: 0,
    READ_ERROR: 0,
  };
  const records = [];
  let lastDoc = null;
  let scanned = 0;
  while (true) {
    let query = db.collection("service_areas").orderBy("__name__").limit(pageSize);
    if (lastDoc) query = query.startAfter(lastDoc);
    const page = await query.get();
    if (page.empty) break;
    for (const snap of page.docs) {
      scanned += 1;
      const area = snap.data();
      const areaId = snap.id;
      let status = "BROKEN_PARENT_CHAIN";
      let reason = "AREA_PARENT_FIELDS_INVALID";
      let city = null;
      let legacyIndexId = null;
      let proposedIndexId = null;
      let proposedIndexOwnerId = null;
      let proposedIndexMatches = false;
      let legacyIndexMatches = false;
      try {
        if (![area.countryId, area.stateId, area.cityId].every(v => typeof v === "string" && v.trim())) {
          throw new Error("AREA_PARENT_FIELDS_INVALID");
        }
        if (typeof area.name !== "string" || !area.name.trim() || area.name.trim().length > 120) {
          throw new Error("AREA_NAME_INVALID");
        }
        city = await readDoc("service_cities", area.cityId);
        if (!city) throw new Error("CITY_MISSING");
        if (city.countryId !== area.countryId || city.stateId !== area.stateId) {
          throw new Error("CITY_COUNTRY_STATE_MISMATCH");
        }
        const state = await readDoc("service_states", area.stateId);
        if (!state || state.countryId !== area.countryId) throw new Error("STATE_COUNTRY_MISMATCH");
        const country = await readDoc("service_countries", area.countryId);
        if (!country) throw new Error("COUNTRY_MISSING");

        let district = null;
        if (city.districtId !== undefined && city.districtId !== null && city.districtId !== "") {
          district = await readDoc("service_districts", city.districtId);
        }
        const compatibility = classifyCityDistrictCompatibility({
          city, district, expectedCountryId: area.countryId, expectedStateId: area.stateId,
        });
        legacyIndexId = serviceLocationNameIndexId(
          "service_areas", [area.countryId, area.stateId, area.cityId], area.name,
        );
        const legacy = await readDoc("service_location_name_indexes", legacyIndexId);
        legacyIndexMatches = !!legacy &&
          legacy.collectionPath === "service_areas" &&
          legacy.documentId === areaId &&
          legacy.name === normalizeName(area.name) &&
          Array.isArray(legacy.parentIds) &&
          JSON.stringify(legacy.parentIds) === JSON.stringify([area.countryId, area.stateId, area.cityId]);

        if (compatibility === "DISTRICT_LINKED") {
          if (!district || district.countryId !== area.countryId || district.stateId !== area.stateId) {
            throw new Error("DISTRICT_COUNTRY_STATE_MISMATCH");
          }
          proposedIndexId = districtAwareNameIndexId("area", {
            countryId: area.countryId,
            stateId: area.stateId,
            districtId: city.districtId,
            cityId: area.cityId,
          }, area.name);
          const proposed = await readDoc("service_location_name_indexes", proposedIndexId);
          proposedIndexOwnerId = proposed ? String(proposed.documentId || "") : null;
          proposedIndexMatches = !!proposed &&
            proposed.collectionPath === "service_areas" &&
            proposed.documentId === areaId &&
            proposed.name === normalizeName(area.name) &&
            Array.isArray(proposed.parentIds) &&
            JSON.stringify(proposed.parentIds) === JSON.stringify([
              area.countryId, area.stateId, city.districtId, area.cityId,
            ]);
        }
        status = classifyAreaMigrationPreflight({
          cityCompatibility: compatibility, legacyIndexMatches, proposedIndexOwnerId, areaId,
        });
        if (proposedIndexOwnerId === areaId && !proposedIndexMatches) status = "INDEX_CONFLICT";
        reason = status === "READY" ? "ALL_READ_ONLY_CHECKS_PASSED" : status;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const knownDataErrors = new Set([
          "AREA_PARENT_FIELDS_INVALID", "AREA_NAME_INVALID", "CITY_MISSING",
          "CITY_COUNTRY_STATE_MISMATCH", "STATE_COUNTRY_MISMATCH", "COUNTRY_MISSING",
          "DISTRICT_COUNTRY_STATE_MISMATCH",
        ]);
        if (knownDataErrors.has(message)) {
          status = "BROKEN_PARENT_CHAIN";
          reason = message;
        } else {
          status = "READ_ERROR";
          reason = "FIRESTORE_OR_INDEX_HELPER_READ_FAILED";
        }
      }
      counts[status] += 1;
      records.push({
        areaId, status, reason,
        cityId: typeof area.cityId === "string" ? area.cityId : null,
        districtId: city && typeof city.districtId === "string" ? city.districtId : null,
        legacyIndexId, proposedIndexId, proposedIndexOwnerId, proposedIndexMatches,
      });
    }
    lastDoc = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }
  const report = {
    mode: "READ_ONLY", projectId, collection: "service_areas", pageSize, scanned, counts,
    generatedAt: new Date().toISOString(), records,
    warning: "This paginated scan is not an atomic database snapshot. No writes were performed.",
    statusMeaning: {
      READY: "parent chain and legacy index verified; proposed index is absent or matches this Area",
      LEGACY_NO_DISTRICT: "City needs reviewed District mapping",
      BROKEN_PARENT_CHAIN: "required parent or Area data is invalid",
      INDEX_CONFLICT: "proposed index exists but does not safely match its expected owner/data",
      LEGACY_INDEX_MISSING_OR_MISMATCHED: "legacy index missing or inconsistent",
      READ_ERROR: "Firestore or helper read failed; investigate access/service errors before retrying",
    },
  };
  const json = JSON.stringify(report, null, 2);
  if (outputPath) {
    require("node:fs").writeFileSync(outputPath, json + "\n", { flag: "wx" });
    console.log(`Read-only preflight report written to ${outputPath}`);
  } else {
    process.stdout.write(json + "\n");
  }
}
run().catch(error => {
  console.error("Read-only preflight failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
