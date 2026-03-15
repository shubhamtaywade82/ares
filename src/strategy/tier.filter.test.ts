import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTierReadiness,
  SmcStateSnapshot,
  TIER_SCORE_THRESHOLDS,
} from "./tier.filter.js";

const baseSnapshot = (): SmcStateSnapshot => ({
  htfBiasAligned: false,
  inObZone: false,
  inFvgZone: false,
  sweepDetected: false,
  displacementDetected: false,
  bosConfirmed: false,
  breakerConfluence: false,
  inducementDetected: false,
  premiumDiscountAligned: false,
  premiumDiscount: null,
});

test("aggressive tier: passes with only bias + OB zone", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true, inObZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, true);
  assert.ok(result.met.includes("htfBias"));
  assert.ok(result.met.includes("obOrFvgZone"));
});

test("aggressive tier: passes with only bias + FVG zone (OR logic)", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true, inFvgZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, true);
});

test("aggressive tier: fails without bias", () => {
  const snap = { ...baseSnapshot(), inObZone: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("htfBias"));
});

test("aggressive tier: fails without OB or FVG", () => {
  const snap = { ...baseSnapshot(), htfBiasAligned: true };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("obOrFvgZone"));
});

test("moderate tier: requires bias + zone + sweep + BOS", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    sweepDetected: true,
    bosConfirmed: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, true);
});

test("moderate tier: fails without sweep", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    bosConfirmed: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("sweep"));
});

test("moderate tier: fails without BOS", () => {
  const snap = {
    ...baseSnapshot(),
    htfBiasAligned: true,
    inObZone: true,
    sweepDetected: true,
  };
  const result = evaluateTierReadiness("moderate", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("bos"));
});

test("conservative tier: requires all mandatory conditions", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, true);
});

test("conservative tier: fails without displacement", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: false,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
  assert.ok(result.unmet.includes("displacement"));
});

test("conservative tier: fails without breaker confluence", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: false,
    inducementDetected: false,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
});

test("conservative tier: fails without premium/discount aligned", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: false,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: false,
    premiumDiscountAligned: false,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("conservative", snap);
  assert.equal(result.passed, false);
});

test("readiness percentages: all conditions met = 100% for all tiers", () => {
  const snap: SmcStateSnapshot = {
    htfBiasAligned: true,
    inObZone: true,
    inFvgZone: true,
    sweepDetected: true,
    displacementDetected: true,
    bosConfirmed: true,
    breakerConfluence: true,
    inducementDetected: true,
    premiumDiscountAligned: true,
    premiumDiscount: null,
  };
  const result = evaluateTierReadiness("aggressive", snap);
  assert.equal(result.readiness.aggressive, 100);
  assert.equal(result.readiness.moderate, 100);
  assert.equal(result.readiness.conservative, 100);
});

test("readiness percentages: nothing met = 0% for all tiers", () => {
  const result = evaluateTierReadiness("aggressive", baseSnapshot());
  assert.equal(result.readiness.aggressive, 0);
  assert.equal(result.readiness.moderate, 0);
  assert.equal(result.readiness.conservative, 0);
});

test("score thresholds are exported correctly", () => {
  assert.equal(TIER_SCORE_THRESHOLDS.aggressive, 3);
  assert.equal(TIER_SCORE_THRESHOLDS.moderate, 5);
  assert.equal(TIER_SCORE_THRESHOLDS.conservative, 8);
});
