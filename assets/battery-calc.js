import { calculateBatteryRuntime } from '/assets/calc-engine.js';

function flash(el) {
  el.classList.remove('pulse');
  void el.offsetWidth; // restart animation if triggered again quickly
  el.classList.add('pulse');
}

document.querySelectorAll('[data-battery-calc]').forEach(function (root) {
  const v = parseFloat(root.dataset.voltage);
  const ah = parseFloat(root.dataset.capacity);
  const loadInput = root.querySelector('#load');
  const dodInput = root.querySelector('#dod');
  const effInput = root.querySelector('#eff');
  const hoursOutput = root.querySelector('[data-output-hours]');
  const whOutput = root.querySelector('[data-output-wh]');
  const resetBtn = root.querySelector('[data-role="reset"]');
  const defaultLoad = root.dataset.defaultLoad;
  const defaultDod = root.dataset.defaultDod;
  const defaultEff = root.dataset.defaultEff;
  let isFirstRun = true;

  function run() {
    const load = parseFloat(loadInput.value);
    const dod = parseFloat(dodInput.value) / 100;
    const eff = parseFloat(effInput.value) / 100;
    if (!load || load <= 0 || isNaN(dod) || isNaN(eff)) {
      hoursOutput.textContent = '—';
      if (whOutput) whOutput.textContent = '—';
      isFirstRun = false;
      return;
    }
    try {
      const result = calculateBatteryRuntime({
        batteryVoltage: v, batteryAh: ah, loadWatts: load,
        depthOfDischargeFraction: dod, efficiencyFraction: eff
      });
      hoursOutput.textContent = result.hours.toFixed(2);
      if (whOutput) whOutput.textContent = result.usableWh.toFixed(0);
      if (!isFirstRun) { flash(hoursOutput); if (whOutput) flash(whOutput); }
    } catch {
      hoursOutput.textContent = '—';
      if (whOutput) whOutput.textContent = '—';
    }
    isFirstRun = false;
  }

  [loadInput, dodInput, effInput].forEach(el => el.addEventListener('input', run));
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      loadInput.value = defaultLoad;
      dodInput.value = defaultDod;
      effInput.value = defaultEff;
      run();
    });
  }
  run();
});
