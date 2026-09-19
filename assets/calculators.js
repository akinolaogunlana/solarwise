import {
  calculateSolarSystemSize,
  calculatePanelCount,
  calculateBatteryCapacity,
  calculateInverterSize,
  calculateChargeControllerSize,
  calculateSolarSavings,
  calculateSolarPayback,
  calculateSolarROI,
  calculateGeneratorSize,
  calculateEVChargingCost
} from '/assets/calc-engine.js';

function num(el) { return parseFloat(el.value); }

const handlers = {
  'solar-system-size': function (root) {
    const daily = root.querySelector('#daily'), hours = root.querySelector('#hours'), loss = root.querySelector('#loss');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculateSolarSystemSize({ dailyConsumptionKwh: num(daily), peakSunHours: num(hours), systemLossFraction: num(loss) / 100 });
        output.textContent = r.toFixed(2);
      } catch { output.textContent = '—'; }
    }
    [daily, hours, loss].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { daily.value = root.dataset.defaultDaily; hours.value = root.dataset.defaultHours; loss.value = root.dataset.defaultLoss; run(); } };
  },

  'panel-count': function (root) {
    const daily = root.querySelector('#daily'), wattage = root.querySelector('#wattage'), hours = root.querySelector('#hours'), loss = root.querySelector('#loss');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculatePanelCount({ dailyLoadWh: num(daily), panelWattage: num(wattage), peakSunHours: num(hours), systemLossFraction: num(loss) / 100 });
        output.textContent = r;
      } catch { output.textContent = '—'; }
    }
    [daily, wattage, hours, loss].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { daily.value = root.dataset.defaultDaily; wattage.value = root.dataset.defaultWattage; hours.value = root.dataset.defaultHours; loss.value = root.dataset.defaultLoss; run(); } };
  },

  'battery-capacity': function (root) {
    const daily = root.querySelector('#daily'), voltage = root.querySelector('#voltage'), days = root.querySelector('#days'), dod = root.querySelector('#dod'), eff = root.querySelector('#eff');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculateBatteryCapacity({ dailyLoadWh: num(daily), systemVoltage: num(voltage), daysOfAutonomy: num(days), depthOfDischargeFraction: num(dod) / 100, efficiencyFraction: num(eff) / 100 });
        output.textContent = r.toFixed(1);
      } catch { output.textContent = '—'; }
    }
    [daily, voltage, days, dod, eff].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { daily.value = root.dataset.defaultDaily; voltage.value = root.dataset.defaultVoltage; days.value = root.dataset.defaultDays; dod.value = root.dataset.defaultDod; eff.value = root.dataset.defaultEff; run(); } };
  },

  'inverter-size': function (root) {
    const cont = root.querySelector('#continuous'), start = root.querySelector('#starting'), margin = root.querySelector('#margin');
    const outCont = root.querySelector('[data-output-continuous]'), outSurge = root.querySelector('[data-output-surge]');
    function run() {
      try {
        const r = calculateInverterSize({ continuousLoadWatts: num(cont), startingLoadWatts: num(start), safetyMarginFraction: num(margin) / 100 });
        outCont.textContent = r.recommendedContinuousWatts.toFixed(0);
        outSurge.textContent = r.recommendedSurgeWatts.toFixed(0);
      } catch { outCont.textContent = '—'; outSurge.textContent = '—'; }
    }
    [cont, start, margin].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { cont.value = root.dataset.defaultContinuous; start.value = root.dataset.defaultStarting; margin.value = root.dataset.defaultMargin; run(); } };
  },

  'charge-controller-size': function (root) {
    const wattage = root.querySelector('#wattage'), voltage = root.querySelector('#voltage'), margin = root.querySelector('#margin');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculateChargeControllerSize({ panelWattage: num(wattage), systemVoltage: num(voltage), safetyMarginFraction: num(margin) / 100 });
        output.textContent = r.toFixed(1);
      } catch { output.textContent = '—'; }
    }
    [wattage, voltage, margin].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { wattage.value = root.dataset.defaultWattage; voltage.value = root.dataset.defaultVoltage; margin.value = root.dataset.defaultMargin; run(); } };
  },

  'solar-savings-roi-payback': function (root) {
    const consumption = root.querySelector('#consumption'), rate = root.querySelector('#rate'), offset = root.querySelector('#offset'), cost = root.querySelector('#cost');
    const outMonthly = root.querySelector('[data-output-monthly]'), outAnnual = root.querySelector('[data-output-annual]');
    const outPayback = root.querySelector('[data-output-payback]'), outRoi = root.querySelector('[data-output-roi]');
    function run() {
      try {
        const savings = calculateSolarSavings({ monthlyConsumptionKwh: num(consumption), ratePerKwh: num(rate), solarOffsetFraction: num(offset) / 100 });
        outMonthly.textContent = '$' + savings.monthlySavings.toFixed(2);
        outAnnual.textContent = '$' + savings.annualSavings.toFixed(2);
        outPayback.textContent = calculateSolarPayback(num(cost), savings.annualSavings).toFixed(1);
        outRoi.textContent = calculateSolarROI(num(cost), savings.annualSavings).toFixed(2);
      } catch {
        [outMonthly, outAnnual, outPayback, outRoi].forEach(el => el.textContent = '—');
      }
    }
    [consumption, rate, offset, cost].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { consumption.value = root.dataset.defaultConsumption; rate.value = root.dataset.defaultRate; offset.value = root.dataset.defaultOffset; cost.value = root.dataset.defaultCost; run(); } };
  },

  'generator-size': function (root) {
    const total = root.querySelector('#total'), largestStart = root.querySelector('#largeststart'), largestRun = root.querySelector('#largestrun'), margin = root.querySelector('#margin');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculateGeneratorSize({ totalRunningWatts: num(total), largestApplianceStartingWatts: num(largestStart), largestApplianceRunningWatts: num(largestRun), safetyMarginFraction: num(margin) / 100 });
        output.textContent = r.toFixed(0);
      } catch { output.textContent = '—'; }
    }
    [total, largestStart, largestRun, margin].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { total.value = root.dataset.defaultTotal; largestStart.value = root.dataset.defaultLargestStart; largestRun.value = root.dataset.defaultLargestRun; margin.value = root.dataset.defaultMargin; run(); } };
  },

  'ev-charging-cost': function (root) {
    const capacity = root.querySelector('#capacity'), from = root.querySelector('#from'), to = root.querySelector('#to'), rate = root.querySelector('#rate'), eff = root.querySelector('#eff');
    const output = root.querySelector('[data-output]');
    function run() {
      try {
        const r = calculateEVChargingCost({ batteryCapacityKwh: num(capacity), chargeFromFraction: num(from) / 100, chargeToFraction: num(to) / 100, ratePerKwh: num(rate), chargingEfficiencyFraction: num(eff) / 100 });
        output.textContent = '$' + r.toFixed(2);
      } catch { output.textContent = '—'; }
    }
    [capacity, from, to, rate, eff].forEach(el => el.addEventListener('input', run));
    return { run, reset: () => { capacity.value = root.dataset.defaultCapacity; from.value = root.dataset.defaultFrom; to.value = root.dataset.defaultTo; rate.value = root.dataset.defaultRate; eff.value = root.dataset.defaultEff; run(); } };
  }
};

document.querySelectorAll('[data-calc]').forEach(function (root) {
  const id = root.dataset.calc;
  const handler = handlers[id];
  if (!handler) return;
  const { run, reset } = handler(root);
  const resetBtn = root.querySelector('[data-role="reset"]');
  if (resetBtn) resetBtn.addEventListener('click', reset);
  run();
});
