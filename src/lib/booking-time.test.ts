import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  intervalsOverlap,
  minutesToHours,
  timeToMinutes,
  validateBookingWindow,
} from "./booking-time.js";

describe("timeToMinutes", () => {
  it("converts a valid time", () => {
    assert.equal(timeToMinutes("09:30"), 570);
    assert.equal(timeToMinutes("00:00"), 0);
    assert.equal(timeToMinutes("23:59"), 1439);
  });

  it("rejects malformed or out-of-range times", () => {
    assert.equal(timeToMinutes("9:30"), null);
    assert.equal(timeToMinutes("24:00"), null);
    assert.equal(timeToMinutes("12:60"), null);
    assert.equal(timeToMinutes("noon"), null);
  });
});

describe("minutesToHours", () => {
  it("rounds to two decimals", () => {
    assert.equal(minutesToHours(90), 1.5);
    assert.equal(minutesToHours(20), 0.33);
    assert.equal(minutesToHours(120), 2);
  });
});

describe("intervalsOverlap", () => {
  it("allows back-to-back bookings", () => {
    assert.equal(intervalsOverlap(540, 600, 600, 660), false);
    assert.equal(intervalsOverlap(600, 660, 540, 600), false);
  });

  it("detects real overlaps", () => {
    assert.equal(intervalsOverlap(540, 600, 570, 630), true);
    assert.equal(intervalsOverlap(570, 630, 540, 600), true);
    assert.equal(intervalsOverlap(540, 660, 570, 600), true);
  });
});

describe("validateBookingWindow", () => {
  it("accepts a valid slot inside opening hours", () => {
    assert.equal(
      validateBookingWindow("09:00", "11:00", "08:00", "22:00"),
      null
    );
  });

  it("rejects an end time before the start", () => {
    assert.match(
      validateBookingWindow("11:00", "09:00", "08:00", "22:00") ?? "",
      /end time must be after/i
    );
  });

  it("rejects times outside opening hours", () => {
    assert.match(
      validateBookingWindow("07:00", "09:00", "08:00", "22:00") ?? "",
      /between 08:00 and 22:00/
    );

    assert.match(
      validateBookingWindow("21:00", "23:00", "08:00", "22:00") ?? "",
      /between 08:00 and 22:00/
    );
  });

  it("rejects times that are not 30-minute steps", () => {
    assert.match(
      validateBookingWindow("09:15", "10:15", "08:00", "22:00") ?? "",
      /30-minute steps/
    );
  });

  it("rejects bookings longer than 12 hours", () => {
    assert.match(
      validateBookingWindow("08:00", "21:00", "08:00", "22:00") ?? "",
      /12 hours/
    );
  });
});
