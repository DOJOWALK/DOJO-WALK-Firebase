#!/usr/bin/env node
/**
 * Read-only offline audit of a JSON snapshot. Never connects to Firebase.
 * Usage: node scripts/audit_service_location_integrity.mjs snapshot.json [report.json]
 */
import fs from 'node:fs';
import { auditSnapshot } from './service_location_integrity_core.mjs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || inputPath === '--help') {
  console.error('Usage: node scripts/audit_service_location_integrity.mjs <snapshot.json> [report.json]');
  process.exit(inputPath === '--help' ? 0 : 2);
}
const snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const report = auditSnapshot(snapshot);
const output = JSON.stringify(report, null, 2) + '\\n';
if (outputPath) fs.writeFileSync(outputPath, output, { flag: 'wx' });
else process.stdout.write(output);
if (report.issueCount) process.exitCode = 1;
