import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const READ_URL_TTL_MS = 5 * 60 * 1000;

export interface AdminKycReadRequest {
  walkerUid?: unknown;
  storagePath?: unknown;
}

interface AdminKycDependencies {
  getAdmin(uid: string): Promise<{ isActive?: unknown; role?: unknown } | null>;
  getWalker(uid: string): Promise<{ kyc?: unknown } | null>;
  createReadUrl(path: string, expiresAtMs: number): Promise<string>;
  writeAudit(record: {
    actorUid: string;
    walkerUid: string;
    storagePath: string;
    expiresAtMs: number;
  }): Promise<void>;
  now(): number;
}

function isValidUid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Only the Partner App's private KYC document layouts are eligible; selfies are excluded. */
export function isAllowedWalkerPrivateStoragePath(path: string, walkerUid: string): boolean {
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== "walker_documents" || parts[1] !== walkerUid) return false;
  return /^(aadhaar_front|aadhaar_back|pan_card)_[0-9]{10,17}\.jpg$/.test(parts[2]);
}

/**
 * Accept only the Partner App's canonical kyc.documents.<documentType>.storagePath
 * field, and require the filename prefix to match that exact document type.
 */
export function kycMapReferencesStoragePath(value: unknown, expectedPath: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const documents = (value as Record<string, unknown>).documents;
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) return false;

  const documentMap = documents as Record<string, unknown>;
  const documentTypes = ["aadhaar_front", "aadhaar_back", "pan_card"] as const;
  return documentTypes.some((documentType) => {
    const document = documentMap[documentType];
    if (!document || typeof document !== "object" || Array.isArray(document)) return false;
    const storagePath = (document as Record<string, unknown>).storagePath;
    return storagePath === expectedPath &&
      expectedPath.split("/").at(-1)?.startsWith(`${documentType}_`) === true;
  });
}

export function buildAdminKycReadUrlHandler(deps: AdminKycDependencies) {
  return async (request: CallableRequest<AdminKycReadRequest>) => {
    const actorUid = request.auth?.uid;
    if (!actorUid) {
      throw new HttpsError("unauthenticated", "Sign-in is required.");
    }

    const walkerUid = request.data?.walkerUid;
    const storagePath = request.data?.storagePath;
    if (!isValidUid(walkerUid) || typeof storagePath !== "string" ||
        storagePath.length > 512 || !isAllowedWalkerPrivateStoragePath(storagePath, walkerUid)) {
      throw new HttpsError("invalid-argument", "A valid Walker ID and private KYC Storage path are required.");
    }

    const admin = await deps.getAdmin(actorUid);
    if (!admin || admin.isActive !== true || admin.role !== "super_admin") {
      throw new HttpsError("permission-denied", "An active super_admin account is required.");
    }

    const walker = await deps.getWalker(walkerUid);
    if (!walker || !kycMapReferencesStoragePath(walker.kyc, storagePath)) {
      throw new HttpsError("not-found", "The requested private document is not registered to this Walker.");
    }

    const expiresAtMs = deps.now() + READ_URL_TTL_MS;
    const url = await deps.createReadUrl(storagePath, expiresAtMs);
    await deps.writeAudit({ actorUid, walkerUid, storagePath, expiresAtMs });

    return {
      url,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  };
}

const handler = buildAdminKycReadUrlHandler({
  getAdmin: async (uid) => {
    const db = getFirestore();
    const snapshot = await db.doc(`admin_users/${uid}`).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  getWalker: async (uid) => {
    const db = getFirestore();
    const snapshot = await db.doc(`walkers/${uid}`).get();
    return snapshot.exists ? snapshot.data() ?? null : null;
  },
  createReadUrl: async (path, expiresAtMs) => {
    const [url] = await getStorage().bucket().file(path).getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAtMs,
    });
    return url;
  },
  writeAudit: async ({ actorUid, walkerUid, storagePath, expiresAtMs }) => {
    const db = getFirestore();
    await db.collection("walker_documents_access_audit").add({
      actorUid,
      actorRole: "super_admin",
      walkerUid,
      storagePath,
      action: "read_url_issued",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });
  },
  now: () => Date.now(),
});

/**
 * Issues a five-minute, read-only URL after verifying the active Super Admin,
 * Walker ownership, and exact canonical KYC document path in walkers/{uid}.kyc.
 * The Storage object itself remains owner-only under Storage Rules.
 */
export const createAdminKycReadUrl = onCall(
  { region: "asia-south1", timeoutSeconds: 30, memory: "256MiB" },
  handler,
);
