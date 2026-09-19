import { calculateSolarPanelOutput } from '/assets/calc-engine.js';

document.querySelectorAll('[data-panel-calc]').forEach(function (root) {
  const w = parseFloat(root.dataset.wattage);
  const hoursInput = root.querySelector('#hours');
  const lossInput = root.querySelector('#loss');
  const dailyOutput = root.querySelector('[data-output-daily]');
  const annualOutput = root.querySelector('[data-output-annual]');
  const resetBtn = root.querySelector('[data-role="reset"]');
  const defaultHours = root.dataset.defaultHours;
  const defaultLoss = root.dataset.defaultLoss;

  function run() {
    const hours = parseFloat(hoursInput.value);
    const loss = parseFloat(lossInput.value) / 100;
    if (!hours || hours <= 0 || isNaN(loss) || loss < 0 || loss >= 1) {
      dailyOutput.textContent = '—';
      if (annualOutput) annualOutput.textContent = '—';
      return;
    }
    try {
      const result = calculateSolarPanelOutput({ wattage: w, peakSunHours: hours, systemLossFraction: loss });
      dailyOutput.textContent = (result.dailyOutputWh / 1000).toFixed(2);
      if (annualOutput) annualOutput.textContent = (result.annualOutputWh / 1000).toFixed(0);
    } catch {
      dailyOutput.textContent = '—';
      if (annualOutput) annualOutput.textContent = '—';
    }
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
