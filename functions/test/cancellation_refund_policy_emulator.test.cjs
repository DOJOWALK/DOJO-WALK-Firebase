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