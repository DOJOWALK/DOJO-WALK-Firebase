import { getApps, initializeApp } from "firebase-admin/app";

// Initialize the default Admin SDK app before callable modules capture
// getFirestore() at module scope. index.ts imports this module first.
if (getApps().length === 0) {
  initializeApp();
}
