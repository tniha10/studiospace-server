import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  escapeRegex,
  isDateString,
  isHttpUrl,
  readNumber,
  readParam,
  readString,
  readStringArray,
} from "./validate.js";

describe("readString", () => {
  it("trims strings and ignores other values", () => {
    assert.equal(readString("  studio  "), "studio");
    assert.equal(readString(42), "");
    assert.equal(readString(null), "");
  });
});

describe("readNumber", () => {
  it("accepts numbers and numeric strings", () => {
    assert.equal(readNumber(75), 75);
    assert.equal(readNumber("75.5"), 75.5);
  });

  it("rejects empty and invalid values", () => {
    assert.equal(readNumber(""), null);
    assert.equal(readNumber("abc"), null);
    assert.equal(readNumber(Number.NaN), null);
    assert.equal(readNumber(undefined), null);
  });
});

describe("readStringArray", () => {
  it("trims and drops empty entries", () => {
    assert.deepEqual(readStringArray([" wifi ", "", "parking"]), [
      "wifi",
      "parking",
    ]);
    assert.deepEqual(readStringArray("wifi"), []);
  });
});

describe("readParam", () => {
  it("handles Express repeatable params", () => {
    assert.equal(readParam("abc"), "abc");
    assert.equal(readParam(["abc", "def"]), "abc");
    assert.equal(readParam([]), "");
  });
});

describe("isHttpUrl", () => {
  it("only accepts http and https", () => {
    assert.equal(isHttpUrl("https://example.com/a.jpg"), true);
    assert.equal(isHttpUrl("http://example.com/a.jpg"), true);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("not a url"), false);
  });
});

describe("isDateString", () => {
  it("accepts real calendar dates", () => {
    assert.equal(isDateString("2026-11-11"), true);
    assert.equal(isDateString("2024-02-29"), true);
  });

  it("rejects impossible or malformed dates", () => {
    assert.equal(isDateString("2026-02-30"), false);
    assert.equal(isDateString("11/11/2026"), false);
    assert.equal(isDateString("2026-1-1"), false);
  });
});

describe("escapeRegex", () => {
  it("makes user input safe for a RegExp", () => {
    const pattern = new RegExp(escapeRegex("(a+b).*"), "i");

    assert.equal(pattern.test("xx(a+b).*yy"), true);
    assert.equal(pattern.test("aab"), false);
  });
});
