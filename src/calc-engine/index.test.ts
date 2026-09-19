import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateApplianceConsumption,
  calculateElectricityCost,
  calculateSolarPanelOutput,
  calculateSolarSystemSize,
  calculatePanelCount,
  calculateBatteryRuntime,
  calculateBatteryCapacity,
  calculateInverterSize,
  calculateChargeControllerSize,
  calculateSolarSavings,
  calculateSolarPayback,
  calculateSolarROI,
  calculateGeneratorSize,
  calculateEVChargingCost
} from './index.ts';

test('applianceConsumption: 150W fridge running 8hrs/day = 1.2 kWh/day', () => {
  const result = calculateApplianceConsumption({ wattsTypical: 150, hoursPerDay: 8 });
  assert.equal(result, 1.2);
});

test('electricityCost: 1.2 kWh/day at $0.15/kWh over 30 days = $5.40', () => {
  const result = calculateElectricityCost({ kwhPerDay: 1.2, ratePerKwh: 0.15 });
  assert.ok(Math.abs(result - 5.4) < 1e-9);
});

test('electricityCost: respects custom period (7 days)', () => {
  const result = calculateElectricityCost({ kwhPerDay: 1.2, ratePerKwh: 0.15, days: 7 });
  assert.ok(Math.abs(result - 1.26) < 1e-9);
});

test('solarPanelOutput: 400W panel, 5 peak sun hours, default 14% loss', () => {
  // 400 * 5 * 0.86 = 1720 Wh/day
  const result = calculateSolarPanelOutput({ wattage: 400, peakSunHours: 5 });
  assert.equal(result.dailyOutputWh, 1720);
  assert.equal(result.monthlyOutputWh, 1720 * 30);
  assert.equal(result.annualOutputWh, 1720 * 365);
  assert.equal(result.assumedSystemLossFraction, 0.14);
});

test('solarPanelOutput: rejects invalid system loss fraction', () => {
  assert.throws(() => calculateSolarPanelOutput({ wattage: 400, peakSunHours: 5, systemLossFraction: 1 }));
  assert.throws(() => calculateSolarPanelOutput({ wattage: 400, peakSunHours: 5, systemLossFraction: -0.1 }));
});

test('solarPanelOutput: rejects zero/negative wattage or sun hours', () => {
  assert.throws(() => calculateSolarPanelOutput({ wattage: 0, peakSunHours: 5 }));
  assert.throws(() => calculateSolarPanelOutput({ wattage: 400, peakSunHours: 0 }));
});

test('solarSystemSize: 10 kWh/day need, 5 peak sun hours, 14% loss -> ~2.326 kW system', () => {
  // 10 / (5 * 0.86) = 2.3256 kW
  const result = calculateSolarSystemSize({ dailyConsumptionKwh: 10, peakSunHours: 5 });
  assert.ok(Math.abs(result - 2.3256) < 0.001);
});

test('panelCount: 1720 Wh/day need, 400W panels, 5 peak sun hours -> 1 panel exactly covers it', () => {
  // one 400W panel produces exactly 1720 Wh/day per the test above
  const result = calculatePanelCount({ dailyLoadWh: 1720, panelWattage: 400, peakSunHours: 5 });
  assert.equal(result, 1);
});

test('panelCount: rounds UP (can\'t buy a fraction of a panel)', () => {
  // need slightly more than one panel provides
  const result = calculatePanelCount({ dailyLoadWh: 1721, panelWattage: 400, peakSunHours: 5 });
  assert.equal(result, 2);
});

test('batteryRuntime: 12V 100Ah battery, 100W load, default 85% efficiency, full DoD', () => {
  // 12 * 100 * 1 * 0.85 = 1020 Wh usable / 100W = 10.2 hours
  const result = calculateBatteryRuntime({ batteryVoltage: 12, batteryAh: 100, loadWatts: 100 });
  assert.equal(result.hours, 10.2);
  assert.equal(result.usableWh, 1020);
});

test('batteryRuntime: lower depth of discharge reduces runtime proportionally', () => {
  const fullDoD = calculateBatteryRuntime({ batteryVoltage: 12, batteryAh: 100, loadWatts: 100, depthOfDischargeFraction: 1 });
  const halfDoD = calculateBatteryRuntime({ batteryVoltage: 12, batteryAh: 100, loadWatts: 100, depthOfDischargeFraction: 0.5 });
  assert.equal(halfDoD.hours, fullDoD.hours / 2);
  assert.equal(halfDoD.usableWh, fullDoD.usableWh / 2);
});

test('batteryCapacity: 1200 Wh/day, 12V system, 2 days autonomy, default 50% DoD, 85% eff', () => {
  // (1200 * 2) / (12 * 0.5 * 0.85) = 2400 / 5.1 = 470.588... Ah
  const result = calculateBatteryCapacity({ dailyLoadWh: 1200, systemVoltage: 12, daysOfAutonomy: 2 });
  assert.ok(Math.abs(result - 470.588) < 0.01);
});

test('inverterSize: 500W continuous load, no known surge, default 20% margin', () => {
  const result = calculateInverterSize({ continuousLoadWatts: 500 });
  assert.equal(result.recommendedContinuousWatts, 600);
  assert.equal(result.recommendedSurgeWatts, 600); // no surge given, so surge = continuous recommendation
});

test('inverterSize: surge load higher than margin-adjusted continuous wins', () => {
  const result = calculateInverterSize({ continuousLoadWatts: 500, startingLoadWatts: 1500 });
  assert.equal(result.recommendedContinuousWatts, 600);
  assert.equal(result.recommendedSurgeWatts, 1500);
});

test('chargeControllerSize: 400W panel, 12V system, default 25% margin', () => {
  // (400/12) * 1.25 = 41.666... A
  const result = calculateChargeControllerSize({ panelWattage: 400, systemVoltage: 12 });
  assert.ok(Math.abs(result - 41.6667) < 0.001);
});

test('solarSavings: 900 kWh/month at $0.15/kWh, 80% offset', () => {
  const result = calculateSolarSavings({ monthlyConsumptionKwh: 900, ratePerKwh: 0.15, solarOffsetFraction: 0.8 });
  assert.equal(result.monthlySavings, 108);
  assert.equal(result.annualSavings, 1296);
});

test('solarSavings: rejects offset fraction outside [0,1]', () => {
  assert.throws(() => calculateSolarSavings({ monthlyConsumptionKwh: 900, ratePerKwh: 0.15, solarOffsetFraction: 1.5 }));
});

test('solarPayback: $15,000 system, $1,296/yr savings -> ~11.57 years', () => {
  const result = calculateSolarPayback(15000, 1296);
  assert.ok(Math.abs(result - 11.574) < 0.01);
});

test('solarROI: $15,000 system, $1,296/yr savings -> 8.64% first-year return', () => {
  const result = calculateSolarROI(15000, 1296);
  assert.ok(Math.abs(result - 8.64) < 0.01);
});

test('generatorSize: fridge (1200W run, 2200W start) is the largest of 3 appliances totalling 1800W running', () => {
  // total running 1800W, fridge adds (2200-1200)=1000W extra surge, +20% margin
  // (1800 + 1000) * 1.2 = 3360W
  const result = calculateGeneratorSize({
    totalRunningWatts: 1800,
    largestApplianceStartingWatts: 2200,
    largestApplianceRunningWatts: 1200
  });
  assert.equal(result, 3360);
});

test('evChargingCost: 60kWh battery, 20% to 80%, $0.14/kWh, default 90% efficiency', () => {
  // (60 * 0.6) / 0.9 = 40 kWh needed; * 0.14 = $5.60
  const result = calculateEVChargingCost({
    batteryCapacityKwh: 60, chargeFromFraction: 0.2, chargeToFraction: 0.8, ratePerKwh: 0.14
  });
  assert.ok(Math.abs(result - 5.6) < 1e-9);
});

test('evChargingCost: rejects chargeTo <= chargeFrom', () => {
  assert.throws(() => calculateEVChargingCost({
    batteryCapacityKwh: 60, chargeFromFraction: 0.8, chargeToFraction: 0.2, ratePerKwh: 0.14
  }));
});
