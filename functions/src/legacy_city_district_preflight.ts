export type LegacyCityDistrictStatus =
  | "ALREADY_LINKED"
  | "NO_CANDIDATE"
  | "AMBIGUOUS"
  | "PARENT_MISMATCH"
  | "UNIQUE_EVIDENCE_CANDIDATE"
  | "REVIEWED_MAPPING_READY"
  | "MANIFEST_MISMATCH"
  | "INPUT_INVALID";

export interface DistrictCandidate {
  districtId: unknown;
  countryId: unknown;
  stateId: unknown;
  evidenceReference: unknown;
}

export interface ApprovedDistrictMapping {
  cityId: unknown;
  districtId: unknown;
  expectedCountryId: unknown;
  expectedStateId: unknown;
  evidenceReference: unknown;
  reviewer: unknown;
  reviewedAt: unknown;
}

/**
 * Pure, read-only classifier for a City -> District mapping proposal.
 * It does not query or write Firestore and never infers a District from names.
 * Candidates must already have been obtained from an authoritative source.
 */
export function classifyLegacyCityDistrictMapping(input: {
  cityId: unknown;
  countryId: unknown;
  stateId: unknown;
  currentDistrictId: unknown;
  candidates: readonly DistrictCandidate[];
  approvedMapping?: ApprovedDistrictMapping | null;
}): {
  status: LegacyCityDistrictStatus;
  safeToApply: boolean;
  candidateDistrictIds: string[];
  reason: string;
} {
  const invalid = (reason: string) => ({
    status: "INPUT_INVALID" as const,
    safeToApply: false,
    candidateDistrictIds: [],
    reason,
  });
  const validId = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && value === value.trim();
  const validTimestamp = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));

  if (!input || typeof input !== "object" ||
      !validId(input.cityId) || !validId(input.countryId) ||
      !validId(input.stateId) || !Array.isArray(input.candidates)) {
    return invalid("City identity, parent IDs, or candidate list is invalid.");
  }

  if (input.currentDistrictId !== undefined && input.currentDistrictId !== null &&
      input.currentDistrictId !== "" && !validId(input.currentDistrictId)) {
    return invalid("Existing districtId is malformed; do not auto-correct it.");
  }

  if (validId(input.currentDistrictId)) {
    return {
      status: "ALREADY_LINKED",
      safeToApply: false,
      candidateDistrictIds: [input.currentDistrictId],
      reason: "City already has a District ID; this preflight does not change linked records.",
    };
  }

  const seen = new Set<string>();
  const candidates: DistrictCandidate[] = [];
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate !== "object" ||
        !validId(candidate.districtId) ||
        !validId(candidate.countryId) ||
        !validId(candidate.stateId) ||
        typeof candidate.evidenceReference !== "string" ||
        !candidate.evidenceReference.trim()) {
      return invalid("Candidate must have valid IDs and an authoritative evidence reference.");
    }
    if (seen.has(candidate.districtId)) {
      return invalid("Duplicate candidate District ID detected.");
    }
    seen.add(candidate.districtId);
    candidates.push(candidate);
  }

  const parentMatches = candidates.filter(candidate =>
    candidate.countryId === input.countryId && candidate.stateId === input.stateId);

  if (candidates.length > 0 && parentMatches.length === 0) {
    return {
      status: "PARENT_MISMATCH",
      safeToApply: false,
      candidateDistrictIds: candidates.map(candidate => candidate.districtId as string),
      reason: "Candidate District parent Country/State does not match the City.",
    };
  }
  if (parentMatches.length === 0) {
    return {
      status: "NO_CANDIDATE",
      safeToApply: false,
      candidateDistrictIds: [],
      reason: "No authoritative District candidate; manual review required.",
    };
  }
  if (parentMatches.length > 1) {
    return {
      status: "AMBIGUOUS",
      safeToApply: false,
      candidateDistrictIds: parentMatches.map(candidate => candidate.districtId as string),
      reason: "Multiple parent-consistent candidates; do not choose automatically.",
    };
  }

  const candidate = parentMatches[0];
  const mapping = input.approvedMapping;
  if (!mapping) {
    return {
      status: "UNIQUE_EVIDENCE_CANDIDATE",
      safeToApply: false,
      candidateDistrictIds: [candidate.districtId as string],
      reason: "One authoritative candidate exists, but human-reviewed approval is missing.",
    };
  }

  if (mapping.cityId !== input.cityId ||
      mapping.districtId !== candidate.districtId ||
      mapping.expectedCountryId !== input.countryId ||
      mapping.expectedStateId !== input.stateId ||
      typeof mapping.evidenceReference !== "string" ||
      !mapping.evidenceReference.trim() ||
      mapping.evidenceReference !== candidate.evidenceReference ||
      typeof mapping.reviewer !== "string" || !mapping.reviewer.trim() ||
      !validTimestamp(mapping.reviewedAt)) {
    return {
      status: "MANIFEST_MISMATCH",
      safeToApply: false,
      candidateDistrictIds: [candidate.districtId as string],
      reason: "Approved mapping manifest does not exactly match the current candidate, parents, evidence, and reviewer metadata.",
    };
  }

  return {
    status: "REVIEWED_MAPPING_READY",
    safeToApply: true,
    candidateDistrictIds: [candidate.districtId as string],
    reason: "Reviewed mapping matches the current authoritative candidate and parent tuple; still requires a separately approved write implementation.",
  };
}
