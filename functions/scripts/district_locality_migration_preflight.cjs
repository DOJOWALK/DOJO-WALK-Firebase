#!/usr/bin/env node
"use strict";

// Read-only Locality preflight. This script only reads Firestore and emits JSON.
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("Set an explicit project ID.");
  process.exitCode = 2;
} else {
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  (async () => {
    const page = await db.collection("service_localities").orderBy("__name__").limit(1).get();
    process.stdout.write(JSON.stringify({ mode: "READ_ONLY", projectId, collection: "service_localities", sampleCount: page.size }) + "\n");
  })().catch(error => {
    console.error(error instanceof Error ? error.message : "Read failed");
    process.exitCode = 1;
  });
}
