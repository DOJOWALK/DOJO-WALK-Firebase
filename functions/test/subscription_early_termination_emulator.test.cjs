const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const prefix = "test_subscription_termination_" + process.pid;
let app, db;
function calc({paid, completed, consent, expense = 0, disclosed = false, evidenced = false, lawful = false}) {
  assert.ok(Number.isSafeInteger(paid) && paid >= 0);
  const used = completed.reduce((sum, w) => sum + (consent ? w.shortTermPaise : w.subscriptionPaise), 0);
  const allowedExpense = expense > 0 && disclosed && evidenced && lawful ? expense : 0;
  assert.ok(used + allowedExpense <= paid, "DEDUCTIONS_EXCEED_CAPTURED_PAYMENT");
  return { usedPaise: used, expensePaise: allowedExpense, refundPaise: paid - used - allowedExpense, repriced: !!consent };
}
function companyFailure({allocated, backup, reschedule}) {
  if (backup) return {action:"replacement", refundPaise:0};
  if (reschedule) return {action:"reschedule", refundPaise:0};
  return {action:"full_affected_walk_refund", refundPaise:allocated};
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
test("zero completed walks: refund full captured balance", () => { assert.equal(calc({paid:300000,completed:[],consent:true}).refundPaise,300000); });
test("recorded pre-purchase consent permits disclosed Short-Term repricing", () => {
  const r=calc({paid:300000,completed:[{shortTermPaise:18000,subscriptionPaise:12000},{shortTermPaise:18000,subscriptionPaise:12000}],consent:true});
  assert.equal(r.usedPaise,36000); assert.equal(r.refundPaise,264000); assert.equal(r.repriced,true);
});
test("missing affirmative consent prohibits retroactive Short-Term repricing", () => {
  const r=calc({paid:300000,completed:[{shortTermPaise:18000,subscriptionPaise:12000}],consent:false});
  assert.equal(r.usedPaise,12000); assert.equal(r.refundPaise,288000); assert.equal(r.repriced,false);
});
test("only disclosed, evidenced and lawful third-party expense is deductible", () => {
  assert.equal(calc({paid:100000,completed:[],consent:false,expense:5000,disclosed:true,evidenced:true,lawful:true}).refundPaise,95000);
  assert.equal(calc({paid:100000,completed:[],consent:false,expense:5000,disclosed:false,evidenced:true,lawful:true}).refundPaise,100000);
});
test("no arbitrary percentage penalty or hidden admin fee", () => {
  const r=calc({paid:100000,completed:[{shortTermPaise:18000,subscriptionPaise:12000}],consent:true});
  assert.equal(r.refundPaise,82000); assert.equal(Object.hasOwn(r,"adminFeePaise"),false);
});
test("deductions cannot exceed captured payment", () => { assert.throws(()=>calc({paid:10000,completed:[{shortTermPaise:12000,subscriptionPaise:9000}],consent:true}),/DEDUCTIONS_EXCEED_CAPTURED_PAYMENT/); });
test("company failure without backup and declined reschedule gets full affected-walk refund", () => {
  assert.deepEqual(companyFailure({allocated:18000,backup:false,reschedule:false}),{action:"full_affected_walk_refund",refundPaise:18000});
});
test("backup or accepted reschedule avoids automatic refund", () => {
  assert.equal(companyFailure({allocated:18000,backup:true,reschedule:false}).refundPaise,0);
  assert.equal(companyFailure({allocated:18000,backup:false,reschedule:true}).action,"reschedule");
});
test("duplicate cancellation calculation is idempotent in emulator", async () => {
  const ref=db.collection(prefix).doc("booking-1");
  const save=()=>db.runTransaction(async tx=>{const s=await tx.get(ref); if(s.exists)return false; tx.create(ref,{refundPaise:82000}); return true;});
  const results=await Promise.all([save(),save(),save()]);
  assert.equal(results.filter(Boolean).length,1); assert.equal((await ref.get()).get("refundPaise"),82000);
});
