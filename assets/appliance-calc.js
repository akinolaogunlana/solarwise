import { calculateApplianceConsumption, calculateElectricityCost } from '/assets/calc-engine.js';

function flash(el) {
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

document.querySelectorAll('[data-appliance-calc]').forEach(function (root) {
  const wattsInput = root.querySelector('#watts');
  const hoursInput = root.querySelector('#hours');
  const rateInput = root.querySelector('#rate');
  const dailyOutput = root.querySelector('[data-output-daily]');
  const monthlyOutput = root.querySelector('[data-output-monthly]');
  const resetBtn = root.querySelector('[data-role="reset"]');
  const defaultWatts = root.dataset.defaultWatts;
  const defaultHours = root.dataset.defaultHours;
  const defaultRate = root.dataset.defaultRate;
  let isFirstRun = true;

  function run() {
    const watts = parseFloat(wattsInput.value);
    const hours = parseFloat(hoursInput.value);
    const rate = parseFloat(rateInput.value);
    if (!watts || !hours || isNaN(rate) || watts < 0 || hours < 0 || rate < 0) {
      dailyOutput.textContent = '—';
      if (monthlyOutput) monthlyOutput.textContent = '—';
      isFirstRun = false;
      return;
    }
    try {
      const dailyKwh = calculateApplianceConsumption({ wattsTypical: watts, hoursPerDay: hours });
      const dailyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 1 });
      dailyOutput.textContent = '$' + dailyCost.toFixed(2);
      if (monthlyOutput) {
        const monthlyCost = calculateElectricityCost({ kwhPerDay: dailyKwh, ratePerKwh: rate, days: 30 });
        monthlyOutput.textContent = '$' + monthlyCost.toFixed(2);
      }
      if (!isFirstRun) { flash(dailyOutput); if (monthlyOutput) flash(monthlyOutput); }
    } catch {
      dailyOutput.textContent = '—';
      if (monthlyOutput) monthlyOutput.textContent = '—';
    }
    isFirstRun = false;
  }

  [wattsInput, hoursInput, rateInput].forEach(el => el.addEventListener('input', run));
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      wattsInput.value = defaultWatts;
      hoursInput.value = defaultHours;
      rateInput.value = defaultRate;
      run();
    });
  }
  run();
});
