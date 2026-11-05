import {
  buildCanonicalDogSnapshot,
  buildCanonicalPickupSnapshot,
  type CanonicalDogSnapshot,
  type CanonicalPickupSnapshot,
} from "./booking_trusted_snapshots";
import {
  normalizeBookingScheduleRequest,
  type BookingScheduleNormalization,
  type CanonicalBookingPlan,
} from "./booking_schedule_normalizer";

export interface BookingRequestInput {
  bookingPlan: CanonicalBookingPlan;
  dogId: string;
  pickupAddressId: string;
  schedule: unknown;
}

export interface ValidatedBookingRequest {
  bookingPlan: CanonicalBookingPlan;
  dog: CanonicalDogSnapshot;
  pickup: CanonicalPickupSnapshot;
  schedule: BookingScheduleNormalization;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, code: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], code: string): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) throw new Error(code);
}

/**
 * Pure composition boundary for a customer Booking request.
 *
 * The request contains only identifiers and schedule intent. Pet and address
 * records must already have been loaded by trusted server code under the
 * authenticated customer's UID. This function performs no Firebase access,
 * Zone lookup, timezone conversion, availability check, payment, or writes.
 */
export function validateAndNormalizeBookingRequest(
  requestInput: unknown,
  trustedSources: { petRecord: unknown; addressRecord: unknown },
): ValidatedBookingRequest {
  const request = asRecord(requestInput, "BOOKING_REQUEST_INVALID");
  exactKeys(
    request,
    ["bookingPlan", "dogId", "pickupAddressId", "schedule"],
    "BOOKING_REQUEST_FIELD_INVALID",
  );

  const bookingPlan = request.bookingPlan;
  if (
    bookingPlan !== "one_time" &&
    bookingPlan !== "choose_dates" &&
    bookingPlan !== "regular" &&
    bookingPlan !== "immediate"
  ) {
    throw new Error("BOOKING_PLAN_UNSUPPORTED");
  }

  const dog = buildCanonicalDogSnapshot(request.dogId, trustedSources.petRecord);
  const pickup = buildCanonicalPickupSnapshot(
    request.pickupAddressId,
    trustedSources.addressRecord,
  );
  const schedule = normalizeBookingScheduleRequest(bookingPlan, request.schedule);

  return { bookingPlan, dog, pickup, schedule };
}
