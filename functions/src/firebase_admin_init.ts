import { getApps, initializeApp } from "firebase-admin/app";

// Initialize the default Admin SDK app before any imported Functions module
// evaluates module-scope getFirestore() calls.
if (getApps().length === 0) {
  initializeApp();
}
