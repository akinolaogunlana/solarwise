import { calculateSolarPanelOutput } from '/assets/calc-engine.js';

function flash(el) {
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

document.querySelectorAll('[data-panel-calc]').forEach(function (root) {
  const w = parseFloat(root.dataset.wattage);
  const hoursInput = root.querySelector('#hours');
  const lossInput = root.querySelector('#loss');
  const dailyOutput = root.querySelector('[data-output-daily]');
  const annualOutput = root.querySelector('[data-output-annual]');
  const resetBtn = root.querySelector('[data-role="reset"]');
  const defaultHours = root.dataset.defaultHours;
  const defaultLoss = root.dataset.defaultLoss;
  let isFirstRun = true;

  function run() {
    const hours = parseFloat(hoursInput.value);
    const loss = parseFloat(lossInput.value) / 100;
    if (!hours || hours <= 0 || isNaN(loss) || loss < 0 || loss >= 1) {
      dailyOutput.textContent = '—';
      if (annualOutput) annualOutput.textContent = '—';
      isFirstRun = false;
      return;
    }
    try {
      const result = calculateSolarPanelOutput({ wattage: w, peakSunHours: hours, systemLossFraction: loss });
      dailyOutput.textContent = (result.dailyOutputWh / 1000).toFixed(2);
      if (annualOutput) annualOutput.textContent = (result.annualOutputWh / 1000).toFixed(0);
      if (!isFirstRun) { flash(dailyOutput); if (annualOutput) flash(annualOutput); }
    } catch {
      dailyOutput.textContent = '—';
      if (annualOutput) annualOutput.textContent = '—';
    }
    isFirstRun = false;
  }

  [hoursInput, lossInput].forEach(el => el.addEventListener('input', run));
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      hoursInput.value = defaultHours;
      lossInput.value = defaultLoss;
      run();
    });
  }
  run();
});
