/**
 * Solar/energy calculation engine.
 *
 * Every function here is pure (same input -> same output, no I/O) so it can be:
 *   - unit tested in isolation (see index.test.ts)
 *   - imported server-side by the page generator
 *   - imported client-side by an interactive calculator widget
 * without duplicating a single formula. If a formula needs fixing, it's fixed here once.
 *
 * DEFAULTS ARE ASSUMPTIONS, NOT FACTS. Every default is documented with its source/rationale
 * inline. Callers should override with real data when they have it — a generated page must
 * visibly disclose which numbers are defaults vs. user/location-supplied, per the "don't
 * fabricate data" requirement.
 */

// ---------- Appliance / electricity ----------

export interface ApplianceConsumptionInput {
  wattsTypical: number;
  hoursPerDay: number;
}

/** Daily energy use of a single appliance, in kWh/day. */
export function calculateApplianceConsumption(input: ApplianceConsumptionInput): number {
  const { wattsTypical, hoursPerDay } = input;
  if (wattsTypical < 0 || hoursPerDay < 0) throw new Error('Negative input not allowed');
  return (wattsTypical * hoursPerDay) / 1000;
}

export interface ElectricityCostInput {
  kwhPerDay: number;
  ratePerKwh: number;
  days?: number; // default: 30 (monthly estimate)
}

/** Electricity cost over a period (default 30 days) given daily consumption and a rate. */
export function calculateElectricityCost(input: ElectricityCostInput): number {
  const { kwhPerDay, ratePerKwh, days = 30 } = input;
  return kwhPerDay * ratePerKwh * days;
}

// ---------- Solar panel output ----------

export interface SolarPanelOutputInput {
  wattage: number;
  peakSunHours: number;
  /**
   * Fraction lost to wiring, inverter, temperature, dust, etc.
   * Default 0.14 (14%) is NREL PVWatts' commonly cited default system loss figure —
   * NOT a measurement of any specific installation. Override with real data when available.
   */
  systemLossFraction?: number;
}

export interface SolarPanelOutputResult {
  dailyOutputWh: number;
  monthlyOutputWh: number;
  annualOutputWh: number;
  assumedSystemLossFraction: number;
}

export function calculateSolarPanelOutput(input: SolarPanelOutputInput): SolarPanelOutputResult {
  const { wattage, peakSunHours, systemLossFraction = 0.14 } = input;
  if (wattage <= 0 || peakSunHours <= 0) throw new Error('wattage and peakSunHours must be positive');
  if (systemLossFraction < 0 || systemLossFraction >= 1) throw new Error('systemLossFraction must be in [0,1)');

  const dailyOutputWh = wattage * peakSunHours * (1 - systemLossFraction);
  return {
    dailyOutputWh,
    monthlyOutputWh: dailyOutputWh * 30,
    annualOutputWh: dailyOutputWh * 365,
    assumedSystemLossFraction: systemLossFraction
  };
}

// ---------- System / panel sizing ----------

export interface SolarSystemSizeInput {
  dailyConsumptionKwh: number;
  peakSunHours: number;
  systemLossFraction?: number; // default 0.14, see above
}

/** Required system size in kW to meet a daily consumption target. */
export function calculateSolarSystemSize(input: SolarSystemSizeInput): number {
  const { dailyConsumptionKwh, peakSunHours, systemLossFraction = 0.14 } = input;
  if (peakSunHours <= 0) throw new Error('peakSunHours must be positive');
  return dailyConsumptionKwh / (peakSunHours * (1 - systemLossFraction));
}

export interface PanelCountInput {
  dailyLoadWh: number;
  panelWattage: number;
  peakSunHours: number;
  systemLossFraction?: number; // default 0.14
}

/** Number of panels needed (rounded up — you can't buy a fraction of a panel). */
export function calculatePanelCount(input: PanelCountInput): number {
  const { dailyLoadWh, panelWattage, peakSunHours, systemLossFraction = 0.14 } = input;
  const perPanelWh = panelWattage * peakSunHours * (1 - systemLossFraction);
  if (perPanelWh <= 0) throw new Error('Invalid panel output — check wattage/peakSunHours');
  return Math.ceil(dailyLoadWh / perPanelWh);
}

// ---------- Battery ----------

export interface BatteryRuntimeInput {
  batteryVoltage: number;
  batteryAh: number;
  loadWatts: number;
  /** Round-trip efficiency loss (inverter + battery). Default 0.85 is a common off-grid estimate. */
  efficiencyFraction?: number;
  /** How much of rated capacity is safely usable. LiFePO4 ~0.95-1.0, lead-acid ~0.5 (to protect battery life). */
  depthOfDischargeFraction?: number;
}

export interface BatteryRuntimeResult {
  hours: number;
  usableWh: number;
}

/** Hours a battery can run a given continuous load, plus the usable energy (Wh) that runtime is based on. */
export function calculateBatteryRuntime(input: BatteryRuntimeInput): BatteryRuntimeResult {
  const {
    batteryVoltage, batteryAh, loadWatts,
    efficiencyFraction = 0.85, depthOfDischargeFraction = 1
  } = input;
  if (loadWatts <= 0) throw new Error('loadWatts must be positive');
  const usableWh = batteryVoltage * batteryAh * depthOfDischargeFraction * efficiencyFraction;
  return { hours: usableWh / loadWatts, usableWh };
}

export interface BatteryCapacityInput {
  dailyLoadWh: number;
  systemVoltage: number;
  daysOfAutonomy: number;
  depthOfDischargeFraction?: number; // default 0.5 (conservative, lead-acid-safe default)
  efficiencyFraction?: number;       // default 0.85
}

/** Required battery capacity in Ah to cover a daily load for N days of autonomy. */
export function calculateBatteryCapacity(input: BatteryCapacityInput): number {
  const {
    dailyLoadWh, systemVoltage, daysOfAutonomy,
    depthOfDischargeFraction = 0.5, efficiencyFraction = 0.85
  } = input;
  const denominator = systemVoltage * depthOfDischargeFraction * efficiencyFraction;
  if (denominator <= 0) throw new Error('Invalid voltage/DoD/efficiency');
  return (dailyLoadWh * daysOfAutonomy) / denominator;
}

// ---------- Inverter / charge controller ----------

export interface InverterSizeInput {
  continuousLoadWatts: number;
  startingLoadWatts?: number; // surge load, if known (motors, compressors)
  safetyMarginFraction?: number; // default 0.2 (20%), common sizing rule of thumb
}

export interface InverterSizeResult {
  recommendedContinuousWatts: number;
  recommendedSurgeWatts: number;
}

export function calculateInverterSize(input: InverterSizeInput): InverterSizeResult {
  const { continuousLoadWatts, startingLoadWatts = 0, safetyMarginFraction = 0.2 } = input;
  const recommendedContinuousWatts = continuousLoadWatts * (1 + safetyMarginFraction);
  const recommendedSurgeWatts = Math.max(startingLoadWatts, recommendedContinuousWatts);
  return { recommendedContinuousWatts, recommendedSurgeWatts };
}

export interface ChargeControllerSizeInput {
  panelWattage: number;
  systemVoltage: number;
  safetyMarginFraction?: number; // default 0.25 (25%), standard NEC-influenced sizing margin
}

/**
 * Approximate required controller amperage using panel wattage / system voltage.
 * NOTE: real-world MPPT sizing should use the panel's actual Voc/Isc rating, not this
 * wattage/voltage approximation — this is a reasonable estimate for a generic page,
 * not a substitute for checking the specific panel's datasheet.
 */
export function calculateChargeControllerSize(input: ChargeControllerSizeInput): number {
  const { panelWattage, systemVoltage, safetyMarginFraction = 0.25 } = input;
  if (systemVoltage <= 0) throw new Error('systemVoltage must be positive');
  return (panelWattage / systemVoltage) * (1 + safetyMarginFraction);
}

// ---------- Savings / ROI / payback ----------

export interface SolarSavingsInput {
  monthlyConsumptionKwh: number;
  ratePerKwh: number;
  solarOffsetFraction: number; // 0-1, what fraction of consumption solar covers
}

export interface SolarSavingsResult {
  monthlySavings: number;
  annualSavings: number;
}

export function calculateSolarSavings(input: SolarSavingsInput): SolarSavingsResult {
  const { monthlyConsumptionKwh, ratePerKwh, solarOffsetFraction } = input;
  if (solarOffsetFraction < 0 || solarOffsetFraction > 1) throw new Error('solarOffsetFraction must be in [0,1]');
  const monthlySavings = monthlyConsumptionKwh * ratePerKwh * solarOffsetFraction;
  return { monthlySavings, annualSavings: monthlySavings * 12 };
}

/** Simple payback period in years (does not account for financing, degradation, or rate changes). */
export function calculateSolarPayback(systemCost: number, annualSavings: number): number {
  if (annualSavings <= 0) throw new Error('annualSavings must be positive');
  return systemCost / annualSavings;
}

/** Simple annual ROI as a percentage (first-year, undiscounted — not IRR). */
export function calculateSolarROI(systemCost: number, annualSavings: number): number {
  if (systemCost <= 0) throw new Error('systemCost must be positive');
  return (annualSavings / systemCost) * 100;
}

// ---------- Generator ----------

export interface GeneratorSizeInput {
  totalRunningWatts: number;
  /** Starting/surge watts of the single largest motor-driven appliance in the load list. */
  largestApplianceStartingWatts: number;
  largestApplianceRunningWatts: number;
  safetyMarginFraction?: number; // default 0.2
}

/**
 * Recommended generator wattage: total running load, plus the EXTRA surge needed by the
 * single largest appliance on startup (not every appliance's surge — they don't all start
 * simultaneously), plus a safety margin.
 */
export function calculateGeneratorSize(input: GeneratorSizeInput): number {
  const {
    totalRunningWatts, largestApplianceStartingWatts,
    largestApplianceRunningWatts, safetyMarginFraction = 0.2
  } = input;
  const extraSurge = Math.max(0, largestApplianceStartingWatts - largestApplianceRunningWatts);
  return (totalRunningWatts + extraSurge) * (1 + safetyMarginFraction);
}

// ---------- EV charging ----------

export interface EVChargingCostInput {
  batteryCapacityKwh: number;
  chargeFromFraction: number; // 0-1
  chargeToFraction: number;   // 0-1
  ratePerKwh: number;
  /** Charging losses (AC-DC conversion, battery heat). Default 0.9 (90%) is a common estimate. */
  chargingEfficiencyFraction?: number;
}

export function calculateEVChargingCost(input: EVChargingCostInput): number {
  const {
    batteryCapacityKwh, chargeFromFraction, chargeToFraction,
    ratePerKwh, chargingEfficiencyFraction = 0.9
  } = input;
  if (chargeToFraction <= chargeFromFraction) throw new Error('chargeToFraction must exceed chargeFromFraction');
  const energyNeededKwh = (batteryCapacityKwh * (chargeToFraction - chargeFromFraction)) / chargingEfficiencyFraction;
  return energyNeededKwh * ratePerKwh;
}
