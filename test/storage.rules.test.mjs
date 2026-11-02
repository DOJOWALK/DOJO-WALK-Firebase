import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const projectId = 'demo-dojo-storage-tests';
const bucket = `${projectId}.appspot.com`;
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      bucket,
    },
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('admin_users/admin-1').set({
      role: 'super_admin',
      isActive: true,
    });
  });
});

after(async () => {
  await env?.cleanup();
});

test('walker can upload a valid private selfie', async () => {
  const storage = env.authenticatedContext('walker-1').storage(bucket);
  const file = ref(storage, 'walker_selfies/walker-1/selfie_1793600000.jpg');
  await uploadBytes(file, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
});

test('another walker cannot read a private selfie', async () => {
  const ownerStorage = env.authenticatedContext('walker-1').storage(bucket);
  const file = ref(ownerStorage, 'walker_selfies/walker-1/selfie_1793600001.jpg');
  await uploadBytes(file, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });

  const otherStorage = env.authenticatedContext('walker-2').storage(bucket);
  await assert.rejects(() => getBytes(ref(otherStorage, 'walker_selfies/walker-1/selfie_1793600001.jpg')));
});

test('active Super Admin can read a walker selfie', async () => {
  const ownerStorage = env.authenticatedContext('walker-1').storage(bucket);
  const file = ref(ownerStorage, 'walker_selfies/walker-1/selfie_1793600002.jpg');
  await uploadBytes(file, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });

  const adminStorage = env.authenticatedContext('admin-1').storage(bucket);
  const bytes = await getBytes(ref(adminStorage, 'walker_selfies/walker-1/selfie_1793600002.jpg'));
  assert.equal(bytes.byteLength, 3);
});

test('walker cannot upload an executable or unsupported file type', async () => {
  const storage = env.authenticatedContext('walker-1').storage(bucket);
  const file = ref(storage, 'walker_documents/walker-1/malware.exe');
  await assert.rejects(() => uploadBytes(file, new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' }));
});

test('unlisted paths are denied', async () => {
  const storage = env.authenticatedContext('walker-1').storage(bucket);
  const file = ref(storage, 'public/random.txt');
  await assert.rejects(() => uploadBytes(file, new Uint8Array([1]), { contentType: 'text/plain' }));
});
