const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PREFIX = "test_cancellation_refund_policy_" + process.pid;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
let app;
let db;

function assertEmulatorIsolation() {
  assert.ok(PROJECT_ID && PROJECT_ID.startsWith("demo-"), "Requires a demo-* Firebase project.");
  assert.ok(FIRESTORE_HOST, "FIRESTORE_EMULATOR_HOST is required.");
  assert.notEqual(PROJECT_ID, "dojo-platform-b68a3", "Production Firebase project is forbidden.");
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  assert.equal(Number.isNaN(date.getTime()), false, "INVALID_SCHEDULED_AT");
  return date;
}

// Test-only policy oracle. It is intentionally not imported by production Functions.
function calculateOccurrenceRefund({ occurrence, serverNow }) {
  const amount = occurrence.allocatedPaidAmountPaise;
  assert.ok(Number.isSafeInteger(amount) && amount >= 0, "INVALID_ALLOCATED_PAID_AMOUNT");

  if (occurrence.status === "completed") {
    return { refundPaise: 0, basis: "completed_no_ordinary_refund", automatic: true };
  }
  if (occurrence.status === "active" || occurrence.startedAt) {
    return { refundPaise: 0, basis: "active_walk_operations_review", automatic: false };
  }
  if (!["scheduled", "assigned", "replacement_pending"].includes(occurrence.status)) {
    return { refundPaise: 0, basis: "not_refundable_occurrence_state", automatic: true };
  }

  const millisecondsUntilStart = asDate(occurrence.scheduledAt).getTime() - asDate(serverNow).getTime();
  if (millisecondsUntilStart < 0) {
    return { refundPaise: 0, basis: "past_due_operations_review", automatic: false };
  }
  if (millisecondsUntilStart >= TWELVE_HOURS_MS) {
    return { refundPaise: amount, basis: "at_least_12_hours_full_refund", automatic: true };
  }
  return { refundPaise: Math.floor(amount / 2), basis: "under_12_hours_50_percent_refund", automatic: true };
}

function calculateSubscriptionRefund({ paymentTotalPaise, occurrences, serverNow }) {
  assert.ok(Number.isSafeInteger(paymentTotalPaise) && paymentTotalPaise >= 0, "INVALID_PAYMENT_TOTAL");
  assert.ok(Array.isArray(occurrences) && occurrences.length > 0, "OCCURRENCES_REQUIRED");
  const allocatedTotal = occurrences.reduce((sum, item) => {
    assert.ok(Number.isSafeInteger(item.allocatedPaidAmountPaise) && item.allocatedPaidAmountPaise >= 0,
      "INVALID_ALLOCATED_PAID_AMOUNT");
    return sum + item.allocatedPaidAmountPaise;
  }, 0);
  assert.equal(allocatedTotal, paymentTotalPaise, "PAID_AMOUNT_ALLOCATION_MISMATCH");

  const results = occurrences.map((item) => ({
    occurrenceId: item.occurrenceId,
    ...calculateOccurrenceRefund({ occurrence: item, serverNow }),
  }));
  const requiresManualReview = results.some((item) => !item.automatic);
  return {
    results,
    requiresManualReview,
    refundPaise: requiresManualReview ? null : results.reduce((sum, item) => sum + item.refundPaise, 0),
  };
}

function serviceFailureRemedy({ backupAvailable, customerChoice }) {
  if (backupAvailable) return { action: "replacement_workflow", automaticRefundPaise: 0 };
  if (customerChoice === "refund") return { action: "refund", automaticRefundPaise: "full_affected_walk_amount" };
  if (customerChoice === "reschedule") return { action: "reschedule", automaticRefundPaise: 0 };
  return { action: "offer_refund_or_reschedule", automaticRefundPaise: 0 };
}

function refundApprover(amountPaise, suspicious = false) {
  assert.ok(Number.isSafeInteger(amountPaise) && amountPaise >= 0, "INVALID_REFUND_AMOUNT");
  if (suspicious) return "escalation";
  return amountPaise <= 200000 ? "central_admin" : "founder_ceo";
}

function canMarkRefundCompleted({ providerStatus, reconciled }) {
  return providerStatus === "succeeded" && reconciled === true;
}

function canTransitionTask(currentStatus, nextStatus) {
  if (currentStatus === "cancelled") return nextStatus === "cancelled";
  if (currentStatus === "completed") return nextStatus === "completed";
  return true;
}

function assertCustomerConfirmed(confirmed) {
  assert.equal(confirmed, true, "CUSTOMER_CONFIRMATION_REQUIRED");
}

async function createRefundOnce({ occurrenceId, idempotencyKey, amountPaise, allocatedPaidAmountPaise }) {
  assert.ok(idempotencyKey && typeof idempotencyKey === "string", "IDEMPOTENCY_KEY_REQUIRED");
  assert.ok(Number.isSafeInteger(amountPaise) && amountPaise >= 0, "INVALID_REFUND_AMOUNT");
  assert.ok(Number.isSafeInteger(allocatedPaidAmountPaise) && allocatedPaidAmountPaise >= 0,
    "INVALID_ALLOCATED_PAID_AMOUNT");
  assert.ok(amountPaise <= allocatedPaidAmountPaise, "REFUND_EXCEEDS_OCCURRENCE_PAID_AMOUNT");

  const refundRef = db.collection(PREFIX + "_refunds").doc(occurrenceId);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(refundRef);
    if (existing.exists) {
      return { created: false, existingIdempotencyKey: existing.get("idempotencyKey") };
    }
    tx.create(refundRef, {
      occurrenceId,
      idempotencyKey,
      amountPaise,
      status: "refund_requested",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { created: true };
  });
}

function occurrence(overrides = {}) {
  return {
    occurrenceId: "walk-1",
    status: "scheduled",
    scheduledAt: new Date("2026-11-05T12:00:00.000Z"),
    allocatedPaidAmountPaise: 15000,
    ...overrides,
  };
}

test.before(async () => {
  assertEmulatorIsolation();
  app = initializeApp({ projectId: PROJECT_ID }, "cancellation-refund-policy-" + process.pid);
  db = getFirestore(app);
});

test.after(async () => {
  if (db) {
    const snap = await db.collection(PREFIX + "_refunds").get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }
  if (app) await deleteApp(app);
});

test("exactly 12 hours before start is eligible for 100 percent refund", () => {
  const start = new Date("2026-11-05T12:00:00.000Z");
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ scheduledAt: start }),
    serverNow: new Date(start.getTime() - TWELVE_HOURS_MS),
  });
  assert.equal(result.refundPaise, 15000);
  assert.equal(result.basis, "at_least_12_hours_full_refund");
});

test("more than 12 hours before start is eligible for 100 percent refund", () => {
  const start = new Date("2026-11-05T12:00:00.000Z");
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ scheduledAt: start }),
    serverNow: new Date(start.getTime() - TWELVE_HOURS_MS - 1000),
  });
  assert.equal(result.refundPaise, 15000);
});

test("less than 12 hours before start is eligible for 50 percent refund", () => {
  const start = new Date("2026-11-05T12:00:00.000Z");
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ scheduledAt: start }),
    serverNow: new Date(start.getTime() - TWELVE_HOURS_MS + 1000),
  });
  assert.equal(result.refundPaise, 7500);
  assert.equal(result.basis, "under_12_hours_50_percent_refund");
});

test("trusted server timestamp determines cutoff; client timestamp is not an input", () => {
  const start = new Date("2026-11-05T12:00:00.000Z");
  const serverNow = new Date(start.getTime() - 11 * 60 * 60 * 1000);
  const clientNow = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ scheduledAt: start, clientNow }),
    serverNow,
  });
  assert.equal(result.refundPaise, 7500);
});

test("active walk routes to Operations review and does not auto-refund", () => {
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ status: "active", startedAt: new Date("2026-11-05T11:30:00.000Z") }),
    serverNow: new Date("2026-11-05T11:40:00.000Z"),
  });
  assert.equal(result.refundPaise, 0);
  assert.equal(result.automatic, false);
  assert.equal(result.basis, "active_walk_operations_review");
});

test("completed walk receives no ordinary mid-subscription refund", () => {
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ status: "completed" }),
    serverNow: new Date("2026-11-04T00:00:00.000Z"),
  });
  assert.equal(result.refundPaise, 0);
});

test("past scheduled occurrence without a started event requires review, not an invented late fee", () => {
  const result = calculateOccurrenceRefund({
    occurrence: occurrence({ scheduledAt: new Date("2026-11-04T10:00:00.000Z") }),
    serverNow: new Date("2026-11-04T11:00:00.000Z"),
  });
  assert.equal(result.automatic, false);
  assert.equal(result.basis, "past_due_operations_review");
});

test("mid-subscription cancellation preserves completed walks and refunds eligible future occurrences", () => {
  const result = calculateSubscriptionRefund({
    paymentTotalPaise: 30000,
    serverNow: new Date("2026-11-04T00:00:00.000Z"),
    occurrences: [
      occurrence({ occurrenceId: "walk-done", status: "completed", allocatedPaidAmountPaise: 10000 }),
      occurrence({ occurrenceId: "walk-future-a", scheduledAt: new Date("2026-11-06T12:00:00.000Z"), allocatedPaidAmountPaise: 10000 }),
      occurrence({ occurrenceId: "walk-future-b", scheduledAt: new Date("2026-11-04T08:00:00.000Z"), allocatedPaidAmountPaise: 10000 }),
    ],
  });
  assert.equal(result.requiresManualReview, false);
  // The second future walk is only eight hours away, so it receives 50%, not 100%.
  assert.equal(result.refundPaise, 15000);
  assert.equal(result.results.find((x) => x.occurrenceId === "walk-done").refundPaise, 0);
  assert.equal(result.results.find((x) => x.occurrenceId === "walk-future-b").refundPaise, 5000);
});

test("mid-subscription cancellation applies the 12-hour cutoff separately to each future occurrence", () => {
  const now = new Date("2026-11-04T00:00:00.000Z");
  const result = calculateSubscriptionRefund({
    paymentTotalPaise: 30000,
    serverNow: now,
    occurrences: [
      occurrence({ occurrenceId: "future-full", scheduledAt: new Date(now.getTime() + TWELVE_HOURS_MS), allocatedPaidAmountPaise: 10000 }),
      occurrence({ occurrenceId: "future-half", scheduledAt: new Date(now.getTime() + TWELVE_HOURS_MS - 1000), allocatedPaidAmountPaise: 10000 }),
      occurrence({ occurrenceId: "done", status: "completed", allocatedPaidAmountPaise: 10000 }),
    ],
  });
  assert.equal(result.refundPaise, 15000);
});

test("subscription calculation rejects an allocation total that differs from actual payment", () => {
  assert.throws(() => calculateSubscriptionRefund({
    paymentTotalPaise: 20000,
    serverNow: new Date("2026-11-04T00:00:00.000Z"),
    occurrences: [occurrence({ allocatedPaidAmountPaise: 10000 })],
  }), /PAID_AMOUNT_ALLOCATION_MISMATCH/);
});

test("active occurrence during subscription cancellation blocks automatic final calculation for review", () => {
  const result = calculateSubscriptionRefund({
    paymentTotalPaise: 30000,
    serverNow: new Date("2026-11-04T00:00:00.000Z"),
    occurrences: [
      occurrence({ occurrenceId: "active", status: "active", allocatedPaidAmountPaise: 10000 }),
      occurrence({ occurrenceId: "future", scheduledAt: new Date("2026-11-06T12:00:00.000Z"), allocatedPaidAmountPaise: 20000 }),
    ],
  });
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.refundPaise, null);
});

test("company failure with an available backup enters replacement workflow without automatic refund", () => {
  assert.deepEqual(serviceFailureRemedy({ backupAvailable: true }), {
    action: "replacement_workflow", automaticRefundPaise: 0,
  });
});

test("company failure without backup offers reschedule or full affected-walk refund", () => {
  assert.deepEqual(serviceFailureRemedy({ backupAvailable: false }), {
    action: "offer_refund_or_reschedule", automaticRefundPaise: 0,
  });
  assert.equal(serviceFailureRemedy({ backupAvailable: false, customerChoice: "refund" }).automaticRefundPaise,
    "full_affected_walk_amount");
  assert.equal(serviceFailureRemedy({ backupAvailable: false, customerChoice: "reschedule" }).action, "reschedule");
});

test("customer confirmation is required before cancellation is committed", () => {
  assert.throws(() => assertCustomerConfirmed(false), /CUSTOMER_CONFIRMATION_REQUIRED/);
  assert.doesNotThrow(() => assertCustomerConfirmed(true));
});

test("₹2,000 refund routes to Central Admin approval", () => {
  assert.equal(refundApprover(200000), "central_admin");
});

test("refund above ₹2,000 routes to Founder/CEO approval", () => {
  assert.equal(refundApprover(200001), "founder_ceo");
});

test("suspicious refund routes to escalation regardless of amount", () => {
  assert.equal(refundApprover(5000, true), "escalation");
});

test("refund cannot be marked completed without successful provider status and reconciliation", () => {
  assert.equal(canMarkRefundCompleted({ providerStatus: "pending", reconciled: false }), false);
  assert.equal(canMarkRefundCompleted({ providerStatus: "succeeded", reconciled: false }), false);
  assert.equal(canMarkRefundCompleted({ providerStatus: "succeeded", reconciled: true }), true);
});

test("concurrent duplicate refund requests create at most one refund per occurrence", async () => {
  const input = {
    occurrenceId: "walk-duplicate",
    idempotencyKey: "cancel-request-1",
    amountPaise: 7500,
    allocatedPaidAmountPaise: 15000,
  };
  const results = await Promise.all([
    createRefundOnce(input),
    createRefundOnce(input),
    createRefundOnce({ ...input, idempotencyKey: "cancel-request-retry" }),
  ]);
  assert.equal(results.filter((result) => result.created).length, 1);
  const stored = await db.collection(PREFIX + "_refunds").doc("walk-duplicate").get();
  assert.equal(stored.exists, true);
  assert.equal(stored.get("amountPaise"), 7500);
});

test("refund amount cannot exceed the actual amount allocated to the occurrence", async () => {
  await assert.rejects(createRefundOnce({
    occurrenceId: "walk-over-refund",
    idempotencyKey: "refund-too-large",
    amountPaise: 15001,
    allocatedPaidAmountPaise: 15000,
  }), /REFUND_EXCEEDS_OCCURRENCE_PAID_AMOUNT/);
});

test("cancelled task cannot be reassigned, started, or completed by stale events", () => {
  for (const next of ["assigned", "active", "completed"]) {
    assert.equal(canTransitionTask("cancelled", next), false);
  }
  assert.equal(canTransitionTask("cancelled", "cancelled"), true);
});

test("a single occurrence cannot be refunded twice even with a different retry key", async () => {
  const first = await createRefundOnce({
    occurrenceId: "walk-one-refund",
    idempotencyKey: "first-refund",
    amountPaise: 10000,
    allocatedPaidAmountPaise: 10000,
  });
  const second = await createRefundOnce({
    occurrenceId: "walk-one-refund",
    idempotencyKey: "second-refund-attempt",
    amountPaise: 10000,
    allocatedPaidAmountPaise: 10000,
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
});
