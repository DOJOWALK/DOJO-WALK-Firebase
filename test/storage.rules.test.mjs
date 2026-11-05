import { after, before, beforeEach, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage';

const PROJECT_ID = 'demo-dojo-storage-rules';
const SELFIE_PATH = 'walker_selfies/walker-1/selfie_1793510400000.jpg';
const OTHER_PARTNER_SELFIE_PATH = 'walker_selfies/walker-1/selfie_1793510400001.jpg';
const OVERWRITE_SELFIE_PATH = 'walker_selfies/walker-1/selfie_1793510400002.jpg';
const OVERWRITE_KYC_PATH = 'walker_documents/walker-1/aadhaar_front_1793510400003.jpg';
const DELETE_KYC_PATH = 'walker_documents/walker-1/aadhaar_front_1793510400004.jpg';
const KYC_PATH = 'walker_documents/walker-1/aadhaar_front_1793510400000.jpg';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

let testEnv;

before(async () => {
  const rules = await readFile(new URL('../storage.rules', import.meta.url), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

after(async () => {
  await testEnv.cleanup();
});

function metadata(userId, documentType) {
  return {
    contentType: 'image/jpeg',
    customMetadata: { userId, documentType },
  };
}

describe('DOJO WALK Storage Security Rules', () => {
  it('allows a Partner to upload and read their own selfie', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const objectRef = ref(storage, SELFIE_PATH);

    await assertSucceeds(uploadBytes(
      objectRef,
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
    await assertSucceeds(getBytes(objectRef));
  });

  it('allows a Partner to upload each approved KYC document type', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const documents = [
      ['aadhaar_front_1793510400000.jpg', 'aadhaar_front'],
      ['aadhaar_back_1793510400001.jpg', 'aadhaar_back'],
      ['pan_card_1793510400002.jpg', 'pan_card'],
    ];

    for (const [fileName, documentType] of documents) {
      await assertSucceeds(uploadBytes(
        ref(storage, `walker_documents/walker-1/${fileName}`),
        jpeg,
        metadata('walker-1', documentType),
      ));
    }
  });

  it('denies unauthenticated upload and read', async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    const objectRef = ref(storage, SELFIE_PATH);

    await assertFails(uploadBytes(
      objectRef,
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
    await assertFails(getBytes(objectRef));
  });

  it('denies another Partner from reading or writing the owner path', async () => {
    const ownerStorage = testEnv.authenticatedContext('walker-1').storage();
    const otherStorage = testEnv.authenticatedContext('walker-2').storage();
    const ownerRef = ref(ownerStorage, OTHER_PARTNER_SELFIE_PATH);

    await assertSucceeds(uploadBytes(
      ownerRef,
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
    await assertFails(getBytes(ref(otherStorage, OTHER_PARTNER_SELFIE_PATH)));
    await assertFails(uploadBytes(
      ref(otherStorage, OTHER_PARTNER_SELFIE_PATH),
      jpeg,
      metadata('walker-2', 'selfie'),
    ));
  });

  it('denies wrong content type, mismatched metadata and unknown filenames', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();

    await assertFails(uploadBytes(
      ref(storage, SELFIE_PATH),
      jpeg,
      {
        contentType: 'application/octet-stream',
        customMetadata: { userId: 'walker-1', documentType: 'selfie' },
      },
    ));
    await assertFails(uploadBytes(
      ref(storage, SELFIE_PATH),
      jpeg,
      metadata('walker-1', 'pan_card'),
    ));
    await assertFails(uploadBytes(
      ref(storage, 'walker_selfies/walker-1/profile.jpg'),
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
    await assertFails(uploadBytes(
      ref(storage, KYC_PATH),
      jpeg,
      metadata('walker-1', 'pan_card'),
    ));
  });

  it('denies oversized selfie uploads', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);

    await assertFails(uploadBytes(
      ref(storage, SELFIE_PATH),
      tooLarge,
      metadata('walker-1', 'selfie'),
    ));
  });

  it('denies KYC uploads larger than 15 MiB', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const tooLarge = new Uint8Array(15 * 1024 * 1024 + 1);

    await assertFails(uploadBytes(
      ref(storage, KYC_PATH),
      tooLarge,
      metadata('walker-1', 'aadhaar_front'),
    ));
  });

  it('denies overwriting an existing selfie or KYC evidence object', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const selfieRef = ref(storage, OVERWRITE_SELFIE_PATH);
    const kycRef = ref(storage, OVERWRITE_KYC_PATH);

    await assertSucceeds(uploadBytes(
      selfieRef,
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
    await assertFails(uploadBytes(
      selfieRef,
      jpeg,
      metadata('walker-1', 'selfie'),
    ));

    await assertSucceeds(uploadBytes(
      kycRef,
      jpeg,
      metadata('walker-1', 'aadhaar_front'),
    ));
    await assertFails(uploadBytes(
      kycRef,
      jpeg,
      metadata('walker-1', 'aadhaar_front'),
    ));
  });

  it('denies client-side deletion of private KYC objects', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();
    const objectRef = ref(storage, DELETE_KYC_PATH);

    await assertSucceeds(uploadBytes(
      objectRef,
      jpeg,
      metadata('walker-1', 'aadhaar_front'),
    ));
    await assertFails(deleteObject(objectRef));
  });

  it('denies all unapproved object paths', async () => {
    const storage = testEnv.authenticatedContext('walker-1').storage();

    await assertFails(uploadBytes(
      ref(storage, 'misc/walker-1/file.jpg'),
      jpeg,
      metadata('walker-1', 'selfie'),
    ));
  });
});
