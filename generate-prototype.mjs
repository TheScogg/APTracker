import { execSync } from 'child_process';
import fs from 'fs';

console.log("Fetching ALL data from D1...");
const command = 'npx wrangler d1 execute coe_db --remote --json --command="SELECT schedule_date, part_number, description, doh FROM daily_schedule_rows WHERE part_number IS NOT NULL AND part_number != \'\' AND doh IS NOT NULL AND doh != \'\' ORDER BY schedule_date ASC;"';

const rawOutput = execSync(command, { maxBuffer: 1024 * 1024 * 10 }).toString();

const jsonStart = rawOutput.indexOf('[');
const jsonOutput = rawOutput.substring(jsonStart);
const data = JSON.parse(jsonOutput);

const rows = data[0].results;

const series = {};
const allDates = new Set();
const partCounts = {};
const partDescriptions = {};

rows.forEach(r => {
  let date = r.schedule_date;
  if (date.includes('T')) {
    date = date.split('T')[0];
  } else if (date.includes(' ')) {
    date = date.split(' ')[0];
  }
  
  const num = parseFloat(r.doh);
  if (isNaN(num)) return;
  
  if (!series[r.part_number]) {
    series[r.part_number] = {};
    partCounts[r.part_number] = 0;
  }
  
  // Always grab the latest description if it's there
  if (r.description && r.description.trim() !== '') {
    partDescriptions[r.part_number] = r.description.trim();
  }

  series[r.part_number][date] = num;
  partCounts[r.part_number]++;
  allDates.add(date);
});

// Fallback for missing descriptions
Object.keys(series).forEach(p => {
  if (!partDescriptions[p]) partDescriptions[p] = "Unknown Part";
});

const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
const sortedParts = Object.keys(series).sort((a, b) => partCounts[b] - partCounts[a]);

const optionsHtml = sortedParts.map(p => {
  const safeDesc = partDescriptions[p].replace(/"/g, '&quot;');
  return `<option value="${p}">${p} - ${safeDesc}</option>`;
}).join('\n            ');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>DOH Trends Prototype</title>
  
  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  
  <!-- Choices.js for premium multi-select -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js"></script>

  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #f97316;
    }
    * { box-sizing: border-box; }
    body { 
      background: var(--bg); color: var(--text); 
      font-family: 'Inter', 'Nunito', sans-serif; 
      padding: 12px; margin: 0;
      -webkit-font-smoothing: antialiased;
    }
    .container { max-width: 1000px; margin: 0 auto; width: 100%; }
    .card { 
      background: var(--surface); border: 1px solid var(--border); 
      border-radius: 16px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); 
    }
    .header { margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
    .header-top { display: flex; flex-direction: column; gap: 12px; }
    h2 { margin: 0 0 4px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    p { color: var(--text-muted); margin: 0; font-size: 13px; }
    
    .controls-row { display: flex; flex-direction: column; gap: 12px; width: 100%; }
    .control-group { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    label { font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    
    /* Choices.js better dark theme overrides */
    .choices { margin-bottom: 0; }
    .choices__inner, .choices[data-type*="select-multiple"] .choices__inner { 
      background-color: #0d1117 !important; border: 1px solid var(--border) !important; border-radius: 8px !important; min-height: 44px; padding: 4px 8px;
    }
    .choices.is-focused .choices__inner { border-color: var(--accent) !important; }
    .choices__input { background-color: transparent !important; color: var(--text) !important; font-size: 14px; }
    .choices__list--dropdown, .choices__list[aria-expanded] { background-color: #161b22 !important; border: 1px solid var(--border) !important; color: var(--text) !important; border-radius: 8px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important; z-index: 10; margin-top: 4px; word-break: break-word; }
    .choices__list--dropdown .choices__item { color: var(--text) !important; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid #21262d; }
    .choices__list--dropdown .choices__item--selectable.is-highlighted { background-color: #30363d !important; color: #fff !important; }
    .choices__list--multiple .choices__item, .choices[data-type*="select-multiple"] .choices__list--multiple .choices__item {
      background-color: #30363d !important; border: 1px solid #484f58 !important; color: #e6edf3 !important; border-radius: 6px !important; padding: 4px 8px; font-size: 13px; word-break: break-all;
    }
    .choices__button, .choices[data-type*="select-multiple"] .choices__button { filter: invert(1) !important; border-left: 1px solid rgba(255,255,255,0.2) !important; margin-left: 6px; }
    
    .time-filters { display: flex; gap: 4px; background: #0d1117; padding: 4px; border-radius: 8px; border: 1px solid var(--border); width: 100%; }
    .time-filters button {
      background: transparent; border: none; color: var(--text-muted); padding: 8px 0; flex: 1;
      border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700; font-family: inherit; transition: 0.2s;
    }
    .time-filters button:hover { color: var(--text); background: rgba(255,255,255,0.05); }
    .time-filters button.active { background: #30363d; color: var(--text); }

    .chart-container { position: relative; height: 350px; width: 100%; margin-top: 8px; }

    /* Desktop overrides */
    @media (min-width: 768px) {
      body { padding: 40px 20px; }
      .card { padding: 24px; }
      .header-top { flex-direction: row; justify-content: space-between; align-items: flex-start; }
      h2 { font-size: 24px; }
      .time-filters { width: fit-content; }
      .time-filters button { padding: 6px 16px; }
      .chart-container { height: 500px; }
      .choices__list--dropdown .choices__item { font-size: 15px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="header-top">
          <div>
            <h2>Days on Hand (DOH) Trend</h2>
            <p>Compare inventory trends over time.</p>
          </div>
          <div class="time-filters" id="timeFilters">
            <button data-days="7">7D</button>
            <button data-days="30">30D</button>
            <button data-days="90">90D</button>
            <button data-days="all" class="active">All Time</button>
          </div>
        </div>
        
        <div class="controls-row">
          <div class="control-group">
            <label for="partSelect">Selected Parts</label>
            <select id="partSelect" multiple>
              ${optionsHtml}
            </select>
          </div>
        </div>
      </div>
      
      <div class="chart-container">
        <canvas id="dohChart"></canvas>
      </div>
    </div>
  </div>
  
  <script>
    const series = ${JSON.stringify(series)};
    const allSortedDates = ${JSON.stringify(sortedDates)};
    const sortedParts = ${JSON.stringify(sortedParts)};
    const partDescriptions = ${JSON.stringify(partDescriptions)};
    
    // Stable color palette
    const colors = [
      '#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', 
      '#ef4444', '#14b8a6', '#f43f5e', '#6366f1', '#8b5cf6'
    ];

    const ctx = document.getElementById('dohChart').getContext('2d');
    let chartInstance = null;
    let selectedTimeFrame = 'all';

    // Initialize Choices.js
    const selectEl = document.getElementById('partSelect');
    const choices = new Choices(selectEl, {
      removeItemButton: true,
      searchPlaceholderValue: 'Search part numbers or names...',
      shouldSort: false, // keep our custom sorting
      itemSelectText: '', // Remove the "Press to select" text which clutters mobile
      position: 'bottom'
    });

    // Default select top 2
    if (sortedParts.length > 0) choices.setChoiceByValue(sortedParts[0]);
    if (sortedParts.length > 1) choices.setChoiceByValue(sortedParts[1]);

    function renderChart() {
      const selectedParts = Array.from(selectEl.selectedOptions).map(opt => opt.value);
      
      // Filter dates based on timeframe
      let datesToUse = allSortedDates;
      if (selectedTimeFrame !== 'all') {
        const days = parseInt(selectedTimeFrame);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        datesToUse = allSortedDates.filter(d => new Date(d) >= cutoffDate);
      }

      const datasets = selectedParts.map(partNumber => {
        const colorIdx = sortedParts.indexOf(partNumber) % colors.length;
        const color = colors[colorIdx];
        
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, color + '66');
        gradient.addColorStop(1, color + '00');

        const dataPoints = datesToUse.map(date => {
          return series[partNumber][date] !== undefined ? series[partNumber][date] : null;
        });
        
        // Label will show part number + name in tooltips
        const labelText = partNumber + ' - ' + partDescriptions[partNumber];

        return {
          label: labelText,
          data: dataPoints,
          borderColor: color,
          backgroundColor: selectedParts.length === 1 ? gradient : color + '33',
          fill: selectedParts.length === 1,
          tension: 0.3,
          spanGaps: true,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 6
        };
      });

      if (chartInstance) {
        chartInstance.destroy();
      }

      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: datesToUse,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { 
              display: false // Hide default legend to save space on mobile, tooltips are enough
            },
            tooltip: { 
              backgroundColor: 'rgba(22, 27, 34, 0.95)', 
              titleColor: '#e6edf3', 
              bodyColor: '#e6edf3', 
              borderColor: '#30363d', 
              borderWidth: 1, 
              padding: 12,
              titleFont: { size: 13 },
              bodyFont: { size: 13 },
              callbacks: {
                label: function(context) {
                  return ' ' + context.dataset.label + ': ' + context.parsed.y + ' DOH';
                }
              }
            }
          },
          scales: {
            x: { 
              ticks: { color: '#8b949e', maxTicksLimit: window.innerWidth < 768 ? 6 : 15, maxRotation: 0, font: {size: 11} }, 
              grid: { color: '#30363d', drawBorder: false } 
            },
            y: { 
              title: { display: false },
              ticks: { color: '#8b949e', padding: 8, font: {size: 11} }, 
              grid: { color: '#30363d', drawBorder: false },
              min: 0, beginAtZero: true
            }
          }
        }
      });
    }

    selectEl.addEventListener('change', () => {
      renderChart();
    });

    const filterBtns = document.querySelectorAll('.time-filters button');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        selectedTimeFrame = e.target.getAttribute('data-days');
        renderChart();
      });
    });

    // Re-render on resize to adjust tick limits
    window.addEventListener('resize', () => {
      clearTimeout(window.resizeTimer);
      window.resizeTimer = setTimeout(renderChart, 150);
    });

    renderChart();
  </script>
</body>
</html>`;

fs.writeFileSync('prototype-doh.html', html);
console.log("Successfully generated optimized prototype-doh.html!");
