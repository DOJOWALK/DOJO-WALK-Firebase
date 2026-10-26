const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Requires Firestore Emulator; refusing real-project execution.");
const { getFirestore } = require("firebase-admin/firestore");
const { saveServiceLocationWithNameIndex, setServiceLocationStatus } = require("../lib/index");
const { serviceLocationNameIndexId } = require("../lib/location_name_index");
const db = getFirestore();
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const ids = { admin:`district-admin-${suffix}`, ordinary:`district-user-${suffix}`, country:`district-country-${suffix}`, state:`district-state-${suffix}` };
function request(uid,data){return {auth:uid?{uid,token:{uid}}:undefined,data,rawRequest:{},acceptsStreaming:false};}
async function expectCode(promise,code){await assert.rejects(promise,e=>{assert.equal(e.code,code,`Expected ${code}, got ${e.code}: ${e.message}`);return true;});}
test("District reference records save with canonical ancestry but cannot be service-activated", async (t) => {
 const paths=[`admin_users/${ids.admin}`,`admin_users/${ids.ordinary}`,`service_countries/${ids.country}`,`service_states/${ids.state}`];
 const indexIds=new Set();
 t.after(async()=>{await Promise.all(paths.map(p=>db.doc(p).delete().catch(()=>undefined)));await Promise.all([...indexIds].map(id=>db.doc(`service_location_name_indexes/${id}`).delete().catch(()=>undefined)));});
 await Promise.all([
  db.doc(`admin_users/${ids.admin}`).set({isActive:true,role:"super_admin"}),
  db.doc(`admin_users/${ids.ordinary}`).set({isActive:true,role:"customer"}),
  db.doc(`service_countries/${ids.country}`).set({name:"Test Country",isActive:true}),
  db.doc(`service_states/${ids.state}`).set({name:"Test State",countryId:ids.country,isActive:true})
 ]);
 await expectCode(saveServiceLocationWithNameIndex.run(request(undefined,{locationType:"district",payload:{countryId:ids.country,stateId:ids.state,name:"No Auth District"}})),"unauthenticated");
 await expectCode(saveServiceLocationWithNameIndex.run(request(ids.ordinary,{locationType:"district",payload:{countryId:ids.country,stateId:ids.state,name:"No Admin District"}})),"permission-denied");
 const name=`Reference District ${suffix}`;
 const idx=serviceLocationNameIndexId("service_districts",[ids.country,ids.state],name.toLowerCase());
 indexIds.add(idx);
 const result=await saveServiceLocationWithNameIndex.run(request(ids.admin,{locationType:"district",payload:{countryId:ids.country,stateId:ids.state,name}}));
 assert.ok(result.locationId);
 const saved=await db.doc(`service_districts/${result.locationId}`).get();
 assert.equal(saved.get("stateId"),ids.state);
 assert.equal(saved.get("isServiceActive"),false);
 await expectCode(setServiceLocationStatus.run(request(ids.admin,{locationType:"district",locationId:result.locationId,isActive:true})),"failed-precondition");
});
