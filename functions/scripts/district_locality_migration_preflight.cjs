#!/usr/bin/env node
"use strict";

const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");
const { districtAwareNameIndexId } = require("../lib/district_name_index_contract");
const { classifyAreaMigrationPreflight, classifyCityDistrictCompatibility } = require("../lib/district_schema_contract");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("Set an explicit GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT.");
  process.exit(2);
}
const pageSize = Math.min(500, Math.max(1, Number.parseInt(process.env.PAGE_SIZE || "200", 10) || 200));
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const norm = value => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
async function doc(collection, id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const s = await db.collection(collection).doc(id).get();
  return s.exists ? { ...s.data(), id: s.id } : null;
}
async function main() {
  const counts = { READY: 0, LEGACY_NO_DISTRICT: 0, BROKEN_PARENT_CHAIN: 0, INDEX_CONFLICT: 0, LEGACY_INDEX_MISSING_OR_MISMATCHED: 0, READ_ERROR: 0 };
  const records = [];
  let cursor = null, scanned = 0;
  while (true) {
    let q = db.collection("service_localities").orderBy("__name__").limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    for (const snap of page.docs) {
      scanned++;
      const l = snap.data(), localityId = snap.id;
      let status = "BROKEN_PARENT_CHAIN", reason = "LOCALITY_PARENT_FIELDS_INVALID";
      let city = null, legacyIndexId = null, proposedIndexId = null, proposedIndexOwnerId = null, proposedIndexMatches = false;
      let legacyIndexMatches = false;
      try {
        const ids = [l.countryId, l.stateId, l.cityId, l.areaId];
        if (!ids.every(x => typeof x === "string" && x.trim())) throw new Error("LOCALITY_PARENT_FIELDS_INVALID");
        const [c, a, s, country] = await Promise.all([
          doc("service_cities", l.cityId), doc("service_areas", l.areaId),
          doc("service_states", l.stateId), doc("service_countries", l.countryId),
        ]);
        city = c;
        if (!c) throw new Error("CITY_MISSING");
        if (!a) throw new Error("AREA_MISSING");
        if (!s || s.countryId !== l.countryId) throw new Error("STATE_COUNTRY_MISMATCH");
        if (!country) throw new Error("COUNTRY_MISSING");
        if (c.countryId !== l.countryId || c.stateId !== l.stateId ||
            a.countryId !== l.countryId || a.stateId !== l.stateId || a.cityId !== l.cityId) {
          throw new Error("LOCALITY_PARENT_CHAIN_MISMATCH");
        }
        const district = c.districtId ? await doc("service_districts", c.districtId) : null;
        const compatibility = classifyCityDistrictCompatibility({
          city: c, district, expectedCountryId: l.countryId, expectedStateId: l.stateId,
        });
        legacyIndexId = serviceLocationNameIndexId("service_localities", ids, String(l.name || ""));
        const legacy = await doc("service_location_name_indexes", legacyIndexId);
        legacyIndexMatches = !!legacy && legacy.collectionPath === "service_localities" &&
          legacy.documentId === localityId && legacy.name === norm(l.name) &&
          Array.isArray(legacy.parentIds) && JSON.stringify(legacy.parentIds) === JSON.stringify(ids);
        if (compatibility === "DISTRICT_LINKED") {
          if (!district || district.countryId !== l.countryId || district.stateId !== l.stateId) {
            throw new Error("DISTRICT_COUNTRY_STATE_MISMATCH");
          }
          proposedIndexId = districtAwareNameIndexId("locality", {
            countryId: l.countryId, stateId: l.stateId, districtId: c.districtId,
            cityId: l.cityId, areaId: l.areaId,
          }, String(l.name || ""));
          const proposed = await doc("service_location_name_indexes", proposedIndexId);
          proposedIndexOwnerId = proposed ? String(proposed.documentId || "") : null;
          proposedIndexMatches = !!proposed &&
            proposed.collectionPath === "service_localities" &&
            proposed.documentId === localityId &&
            proposed.name === norm(l.name) &&
            Array.isArray(proposed.parentIds) &&
            JSON.stringify(proposed.parentIds) === JSON.stringify([
              l.countryId, l.stateId, c.districtId, l.cityId, l.areaId,
            ]);
          proposedIndexMatches = !!proposed &&
            proposed.collectionPath === "service_localities" &&
            proposed.documentId === localityId &&
            proposed.name === norm(l.name) &&
            Array.isArray(proposed.parentIds) &&
            JSON.stringify(proposed.parentIds) === JSON.stringify([
              l.countryId, l.stateId, c.districtId, l.cityId, l.areaId,
            ]);
        }
        status = classifyAreaMigrationPreflight({
          cityCompatibility: compatibility, legacyIndexMatches, proposedIndexOwnerId, areaId: localityId,
        });
        if (proposedIndexOwnerId === localityId && !proposedIndexMatches) status = "INDEX_CONFLICT";
        reason = status === "READY" ? "ALL_READ_ONLY_CHECKS_PASSED" : status;
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        const knownDataErrors = new Set([
          "LOCALITY_PARENT_FIELDS_INVALID", "CITY_MISSING", "AREA_MISSING",
          "STATE_COUNTRY_MISMATCH", "COUNTRY_MISSING", "LOCALITY_PARENT_CHAIN_MISMATCH",
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
      counts[status]++;
      records.push({
        localityId, status, reason, cityId: l.cityId || null, areaId: l.areaId || null,
        districtId: city && city.districtId || null, legacyIndexId, proposedIndexId, proposedIndexOwnerId, proposedIndexMatches, proposedIndexMatches,
      });
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < pageSize) break;
  }
  const report = {
    mode: "READ_ONLY", projectId, collection: "service_localities", pageSize, scanned, counts,
    generatedAt: new Date().toISOString(), records,
    warning: "Paginated reads are not an atomic snapshot. No writes were performed.",
  };
  const json = JSON.stringify(report, null, 2), output = process.env.REPORT_PATH;
  if (output) {
    require("node:fs").writeFileSync(output, json + "\n", { flag: "wx" });
    console.log("Report written to " + output);
  } else process.stdout.write(json + "\n");
}
main().catch(e => {
  console.error("Preflight failed:", e instanceof Error ? e.message : "read error");
  process.exitCode = 1;
});
