export const MIN_BOOKING_MINUTES = 30;
export const MAX_BOOKING_HOURS = 12;

/** Converts "09:30" into 570. Returns null when the format is invalid. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Two intervals overlap only when each one starts before the other ends.
 * A booking that ends at 12:00 and another that starts at 12:00 do NOT overlap.
 */
export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

/** Applies the studio opening hours and the platform duration limits. */
export function validateBookingWindow(
  startTime: string,
  endTime: string,
  openTime: string,
  closeTime: string
): string | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const open = timeToMinutes(openTime);
  const close = timeToMinutes(closeTime);

  if (start === null || end === null) {
    return "Please choose a valid start and end time.";
  }

  if (open === null || close === null) {
    return "This studio has invalid opening hours. Please contact the host.";
  }

  if (start % MIN_BOOKING_MINUTES !== 0 || end % MIN_BOOKING_MINUTES !== 0) {
    return "Booking times must use 30-minute steps.";
  }

  if (end <= start) {
    return "The end time must be after the start time.";
  }

  if (start < open || end > close) {
    return `Bookings are available between ${openTime} and ${closeTime}.`;
  }

  const durationMinutes = end - start;

  if (durationMinutes > MAX_BOOKING_HOURS * 60) {
    return `A single booking cannot be longer than ${MAX_BOOKING_HOURS} hours.`;
  }

  return null;
}
