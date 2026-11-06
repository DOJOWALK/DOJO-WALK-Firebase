const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
initializeApp({ projectId: "demo-dojo-kyc-tests" });
const {
  buildAdminKycReadUrlHandler,
  isAllowedWalkerPrivateStoragePath,
  kycMapReferencesStoragePath,
} = require("../lib/admin_kyc_access");

const walkerUid = "walker_123";
const path = "walker_documents/walker_123/aadhaar_front_1730000000000.jpg";
const now = 1_800_000_000_000;

function makeDeps(overrides = {}) {
  const audit = [];
  const calls = [];
  const deps = {
    getAdmin: async () => ({ isActive: true, role: "super_admin" }),
    getWalker: async () => ({ kyc: { documents: {
      aadhaar_front: { status: "pending", storagePath: path },
      aadhaar_back: { status: "pending", storagePath: "walker_documents/walker_123/aadhaar_back_1730000000001.jpg" },
      pan_card: { status: "pending", storagePath: "walker_documents/walker_123/pan_card_1730000000002.jpg" },
    } } }),
    createReadUrl: async (storagePath, expiresAtMs) => {
      calls.push({ storagePath, expiresAtMs });
      return "https://signed.example.test/private-object?signature=temporary";
    },
    writeAudit: async (record) => { audit.push(record); },
    now: () => now,
    ...overrides,
  };
  return { deps, audit, calls };
}

function request(data = { walkerUid, storagePath: path }, uid = "admin_123") {
  return { auth: uid ? { uid } : undefined, data };
}

test("private object path allowlist is bound to Walker UID and known filenames", () => {
  assert.equal(isAllowedWalkerPrivateStoragePath(path, walkerUid), true);
  assert.equal(isAllowedWalkerPrivateStoragePath("walker_documents/other/aadhaar_front_1730000000000.jpg", walkerUid), false);
  assert.equal(isAllowedWalkerPrivateStoragePath("walker_documents/walker_123/unknown.jpg", walkerUid), false);
  assert.equal(isAllowedWalkerPrivateStoragePath("some_other_path/walker_123/aadhaar_front_1730000000000.jpg", walkerUid), false);
  assert.equal(isAllowedWalkerPrivateStoragePath("walker_selfies/walker_123/selfie_1730000000000.jpg", walkerUid), false);
});

test("KYC reference matching accepts only canonical document fields with matching filename prefixes", () => {
  const partnerKyc = {
    documents: {
      aadhaar_front: { status: "pending", storagePath: path },
      aadhaar_back: {
        status: "pending",
        storagePath: "walker_documents/walker_123/aadhaar_back_1730000000001.jpg",
      },
      pan_card: {
        status: "pending",
        storagePath: "walker_documents/walker_123/pan_card_1730000000002.jpg",
      },
    },
  };

  for (const document of Object.values(partnerKyc.documents)) {
    assert.equal(kycMapReferencesStoragePath(partnerKyc, document.storagePath), true);
  }
  assert.equal(kycMapReferencesStoragePath(partnerKyc, path + ".other"), false);
  assert.equal(kycMapReferencesStoragePath({ documents: {} }, path), false);
  assert.equal(kycMapReferencesStoragePath({ metadata: { storagePath: path } }, path), false);
  assert.equal(kycMapReferencesStoragePath({ documents: { extra: { storagePath: path } } }, path), false);
  assert.equal(kycMapReferencesStoragePath({ documents: { aadhaar_front: { nested: { storagePath: path } } } }, path), false);
  assert.equal(kycMapReferencesStoragePath({ documents: [{ storagePath: path }] }, path), false);

  // A valid path must not be accepted when stored under a different document type.
  assert.equal(kycMapReferencesStoragePath({
    documents: { aadhaar_back: { storagePath: path } },
  }, path), false);
  assert.equal(kycMapReferencesStoragePath({
    documents: { pan_card: { storagePath: path } },
  }, path), false);
  assert.equal(kycMapReferencesStoragePath({
    documents: { aadhaar_front: { storagePath: "walker_documents/walker_123/aadhaar_back_1730000000001.jpg" } },
  }, "walker_documents/walker_123/aadhaar_back_1730000000001.jpg"), false);
});

test("callable accepts each exact document path from the Partner App KYC schema", async () => {
  const registeredPaths = [
    path,
    "walker_documents/walker_123/aadhaar_back_1730000000001.jpg",
    "walker_documents/walker_123/pan_card_1730000000002.jpg",
  ];
  const { deps, calls, audit } = makeDeps({
    getWalker: async () => ({
      kyc: {
        documents: {
          aadhaar_front: { status: "pending", storagePath: registeredPaths[0] },
          aadhaar_back: { status: "pending", storagePath: registeredPaths[1] },
          pan_card: { status: "pending", storagePath: registeredPaths[2] },
        },
      },
    }),
  });
  const handler = buildAdminKycReadUrlHandler(deps);

  for (const storagePath of registeredPaths) {
    const result = await handler(request({ walkerUid, storagePath }));
    assert.equal(result.url, "https://signed.example.test/private-object?signature=temporary");
  }

  assert.deepEqual(calls.map((call) => call.storagePath), registeredPaths);
  assert.deepEqual(audit.map((record) => record.storagePath), registeredPaths);
});

test("unauthenticated caller is denied", async () => {
  const { deps } = makeDeps();
  const handler = buildAdminKycReadUrlHandler(deps);
  await assert.rejects(handler(request(undefined, null)), (error) =>
    error instanceof HttpsError && error.code === "unauthenticated");
});

test("ordinary and inactive Admin accounts are denied", async () => {
  for (const admin of [
    { isActive: true, role: "manager" },
    { isActive: false, role: "super_admin" },
    null,
  ]) {
    const { deps, calls, audit } = makeDeps({ getAdmin: async () => admin });
    const handler = buildAdminKycReadUrlHandler(deps);
    await assert.rejects(handler(request()), (error) =>
      error instanceof HttpsError && error.code === "permission-denied");
    assert.equal(calls.length, 0);
    assert.equal(audit.length, 0);
  }
});

test("caller cannot request an unregistered or another Walker's object", async () => {
  const { deps, calls, audit } = makeDeps({
    getWalker: async () => ({ kyc: { documents: {} } }),
  });
  const handler = buildAdminKycReadUrlHandler(deps);
  await assert.rejects(handler(request()), (error) =>
    error instanceof HttpsError && error.code === "not-found");
  await assert.rejects(handler(request({
    walkerUid: "other_walker",
    storagePath: "walker_documents/other_walker/aadhaar_front_1730000000000.jpg",
  })), (error) => error instanceof HttpsError && error.code === "not-found");
  assert.equal(calls.length, 0);
  assert.equal(audit.length, 0);
});

test("active Super Admin receives a five-minute URL and access is audited", async () => {
  const { deps, audit, calls } = makeDeps();
  const handler = buildAdminKycReadUrlHandler(deps);
  const result = await handler(request());

  assert.equal(result.url, "https://signed.example.test/private-object?signature=temporary");
  assert.equal(result.expiresAt, new Date(now + 5 * 60 * 1000).toISOString());
  assert.deepEqual(calls, [{ storagePath: path, expiresAtMs: now + 5 * 60 * 1000 }]);
  assert.deepEqual(audit, [{
    actorUid: "admin_123",
    walkerUid,
    storagePath: path,
    expiresAtMs: now + 5 * 60 * 1000,
  }]);
});

test("invalid paths are rejected before any Storage access", async () => {
  const { deps, calls, audit } = makeDeps();
  const handler = buildAdminKycReadUrlHandler(deps);
  await assert.rejects(handler(request({
    walkerUid,
    storagePath: "walker_documents/walker_123/private.pdf",
  })), (error) => error instanceof HttpsError && error.code === "invalid-argument");
  assert.equal(calls.length, 0);
  assert.equal(audit.length, 0);
});

test("audit failure prevents the signed URL from being returned", async () => {
  const { deps, calls, audit } = makeDeps({
    writeAudit: async () => { throw new Error("audit unavailable"); },
  });
  const handler = buildAdminKycReadUrlHandler(deps);

  await assert.rejects(handler(request()), /audit unavailable/);
  // A URL may be generated internally, but the callable rejects and never returns it.
  assert.equal(calls.length, 1);
  assert.equal(audit.length, 0);
});

test("Storage signing failure does not create an access audit record", async () => {
  const { deps, calls, audit } = makeDeps({
    createReadUrl: async () => { throw new Error("signing unavailable"); },
  });
  const handler = buildAdminKycReadUrlHandler(deps);

  await assert.rejects(handler(request()), /signing unavailable/);
  assert.equal(calls.length, 0);
  assert.equal(audit.length, 0);
});
