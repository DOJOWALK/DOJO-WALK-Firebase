const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const prefix = "test_subscription_termination_" + process.pid;
let app, db;

// Synthetic oracle for the single cost-based Cancellation Charge policy.
// Completed walks use only their agreed subscription allocation. There is no
// Short-Term repricing and no separate automatic refund-processing fee.
function calc({paid, completed, cancellationCost = 0, cap = 0, disclosed = false, evidenced = false, lawful = false}) {
  assert.ok(Number.isSafeInteger(paid) && paid >= 0);
  const used = completed.reduce((sum, w) => {
    assert.ok(Number.isSafeInteger(w.subscriptionPaise) && w.subscriptionPaise >= 0);
    return sum + w.subscriptionPaise;
  }, 0);
  const eligible = cancellationCost > 0 && disclosed && evidenced && lawful
    ? Math.min(cancellationCost, cap)
    : 0;
  assert.ok(Number.isSafeInteger(eligible) && eligible >= 0);
  assert.ok(used + eligible <= paid, "DEDUCTIONS_EXCEED_CAPTURED_PAYMENT");
  return {
    completedWalkPaise: used,
    cancellationChargePaise: eligible,
    refundPaise: paid - used - eligible
  };
}
function companyFailure({allocated, backup, reschedule}) {
  if (backup) return {action:"replacement", refundPaise:0, cancellationChargePaise:0};
  if (reschedule) return {action:"reschedule", refundPaise:0, cancellationChargePaise:0};
  return {action:"full_affected_walk_refund", refundPaise:allocated, cancellationChargePaise:0};
}
test.before(async () => {
  assert.ok(project && project.startsWith("demo-"), "demo-* project required");
  assert.ok(host, "Firestore Emulator required");
  assert.notEqual(project, "dojo-platform-b68a3", "production project forbidden");
  app = initializeApp({projectId:project}, "subscription-termination-" + process.pid);
  db = getFirestore(app);
});
test.after(async () => {
  if (db) { const s = await db.collection(prefix).get(); if (!s.empty) { const b=db.batch(); s.docs.forEach(d=>b.delete(d.ref)); await b.commit(); } }
  if (app) await deleteApp(app);
});
test("zero completed walks: refund full captured balance when no eligible cancellation cost", () => {
  assert.deepEqual(calc({paid:300000,completed:[]}), {
    completedWalkPaise:0, cancellationChargePaise:0, refundPaise:300000
  });
});
test("completed walks always use agreed subscription allocation; no Short-Term repricing", () => {
  const r=calc({paid:300000,completed:[{subscriptionPaise:12000},{subscriptionPaise:12000}]});
  assert.equal(r.completedWalkPaise,24000);
  assert.equal(r.refundPaise,276000);
  assert.equal(Object.hasOwn(r,"repriced"),false);
});
test("Cancellation Charge is limited to the lower of evidenced eligible cost and disclosed cap", () => {
  const r=calc({paid:300000,completed:[],cancellationCost:7000,cap:5000,disclosed:true,evidenced:true,lawful:true});
  assert.equal(r.cancellationChargePaise,5000);
  assert.equal(r.refundPaise,295000);
});
test("missing disclosure, evidence, or legal eligibility makes Cancellation Charge zero", () => {
  for (const flags of [
    {disclosed:false,evidenced:true,lawful:true},
    {disclosed:true,evidenced:false,lawful:true},
    {disclosed:true,evidenced:true,lawful:false}
  ]) {
    assert.equal(calc({paid:100000,completed:[],cancellationCost:5000,cap:5000,...flags}).cancellationChargePaise,0);
  }
});
test("no separate automatic Refund Processing Fee; ordinary gateway cost is not deducted", () => {
  const r=calc({paid:100000,completed:[{subscriptionPaise:12000}]});
  assert.equal(r.refundPaise,88000);
  assert.equal(Object.hasOwn(r,"refundProcessingFeePaise"),false);
});
test("deductions cannot exceed captured payment", () => {
  assert.throws(()=>calc({paid:10000,completed:[{subscriptionPaise:9000}],cancellationCost:2000,cap:2000,disclosed:true,evidenced:true,lawful:true}),/DEDUCTIONS_EXCEED_CAPTURED_PAYMENT/);
});
test("company failure without backup and declined reschedule gets full affected-walk refund and no cancellation charge", () => {
  assert.deepEqual(companyFailure({allocated:18000,backup:false,reschedule:false}),{
    action:"full_affected_walk_refund",refundPaise:18000,cancellationChargePaise:0
  });
});
test("backup or accepted reschedule avoids automatic refund and customer cancellation charge", () => {
  assert.equal(companyFailure({allocated:18000,backup:true,reschedule:false}).cancellationChargePaise,0);
  assert.equal(companyFailure({allocated:18000,backup:false,reschedule:true}).action,"reschedule");
});
test("duplicate cancellation settlement is idempotent in emulator", async () => {
  const ref=db.collection(prefix).doc("booking-1");
  const save=()=>db.runTransaction(async tx=>{const s=await tx.get(ref); if(s.exists)return false; tx.create(ref,{refundPaise:88000}); return true;});
  const results=await Promise.all([save(),save(),save()]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal((await ref.get()).get("refundPaise"),88000);
});
