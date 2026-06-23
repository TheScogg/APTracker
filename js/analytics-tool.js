export function initAnalyticsTool(deps) {
  const { getCurrentPlantId, apiSessionClient } = deps;

  let dohChart = null;
  let dohChoices = null;
  let chartData = null; // will store the fetched API response
  let selectedDays = 'all';

  function openAnalyticsModal() {
    document.getElementById('analytics-modal')?.classList.add('visible');
    if (!chartData) {
      loadDohData();
    }
  }

  function closeAnalyticsModal() {
    document.getElementById('analytics-modal')?.classList.remove('visible');
  }

  window.closeAnalyticsModal = closeAnalyticsModal; // expose for onclick

  async function loadDohData() {
    const plantId = getCurrentPlantId();
    if (!plantId) return;
    
    // Show some loading state or wait
    try {
      // The API endpoint: GET /api/plants/:plantId/reports/doh
      const token = await apiSessionClient.getAccessToken();
      const res = await fetch(`/api/plants/${encodeURIComponent(plantId)}/reports/doh`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const json = await res.json();
      if (json.success) {
        chartData = json.data;
        initFilterControls();
        updateChart();
      } else {
        console.error("DOH data fetch failed", json.error);
      }
    } catch (e) {
      console.error("DOH fetch exception", e);
    }
  }

  let currentSortBy = 'part'; // 'part' or 'name'

  function wireDohChoicesInteractions(selectEl) {
    const choicesContainer = selectEl?.closest('.choices');
    if (!choicesContainer || !dohChoices) return;
    const openDropdown = () => {
      try {
        dohChoices.showDropdown?.();
        dohChoices.input?.focus?.();
      } catch (err) {
        console.warn('Could not open DOH parts dropdown', err);
      }
    };
    choicesContainer.addEventListener('click', (e) => {
      if (e.target?.closest?.('.choices__button')) return;
      if (e.target?.closest?.('.choices__list--dropdown')) return;
      openDropdown();
    });
    choicesContainer.addEventListener('focusin', () => {
      openDropdown();
    });
  }

  function initFilterControls() {
    const sortSelect = document.getElementById('doh-sort-select');
    if (sortSelect) {
      // Prevent multiple listeners if re-initialized
      const newSortSelect = sortSelect.cloneNode(true);
      sortSelect.parentNode.replaceChild(newSortSelect, sortSelect);
      newSortSelect.value = currentSortBy;
      newSortSelect.addEventListener('change', (e) => {
        currentSortBy = e.target.value;
        renderChoicesOptions();
      });
    }

    renderChoicesOptions();
    
    const timeFilters = document.getElementById('doh-time-filters');
    if (timeFilters) {
      const timeButtons = timeFilters.querySelectorAll('button');
      timeButtons.forEach(btn => {
        // remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
          const allBtns = timeFilters.querySelectorAll('button');
          allBtns.forEach(b => {
            b.classList.remove('active', 'btn-primary');
            b.classList.add('btn-ghost');
          });
          e.target.classList.remove('btn-ghost');
          e.target.classList.add('active', 'btn-primary');
          selectedDays = e.target.dataset.days;
          updateChart();
        });
      });
    }
  }

  function renderChoicesOptions() {
    const selectEl = document.getElementById('doh-part-select');
    if (!selectEl) return;

    // Save currently selected parts before destroying or re-rendering
    let previouslySelected = [];
    if (dohChoices) {
      previouslySelected = dohChoices.getValue(true);
      if (typeof previouslySelected === 'string') previouslySelected = [previouslySelected];
      dohChoices.destroy();
      dohChoices = null;
    } else {
      previouslySelected = Array.from(selectEl.selectedOptions).map(o => o.value);
    }
    
    selectEl.classList.remove('analytics-native-select');

    // Clear old options
    selectEl.innerHTML = '';
    
    const parts = Object.keys(chartData?.series || {});
    
    // Sort logic
    parts.sort((a, b) => {
      if (currentSortBy === 'name') {
        const descA = chartData.metadata?.[a]?.description || a;
        const descB = chartData.metadata?.[b]?.description || b;
        return descA.localeCompare(descB);
      }
      return a.localeCompare(b);
    });

    parts.forEach(part => {
      const opt = document.createElement('option');
      opt.value = part;
      // use metadata for part description if available
      const desc = chartData.metadata?.[part]?.description || part;
      const count = chartData.metadata?.[part]?.count || 0;
      opt.text = `${part} - ${desc} (${count} record${count === 1 ? '' : 's'})`;
      opt.selected = previouslySelected.length ? previouslySelected.includes(part) : false;
      selectEl.appendChild(opt);
    });
    
    // If nothing was selected (initial load), select the first 5 parts
    if (previouslySelected.length === 0) {
      for (let i = 0; i < Math.min(5, parts.length); i++) {
        selectEl.options[i].selected = true;
      }
    }

    const onSelectionChange = () => {
      updateChart();
    };

    // window.Choices should be loaded via CDN in index.html. Keep the native
    // multi-select usable if the CDN or plugin initialization fails.
    if (window.Choices) {
      try {
        dohChoices = new Choices(selectEl, {
          removeItemButton: true,
          searchEnabled: true,
          shouldSort: false, // We handle the sorting
          placeholderValue: 'Search or select parts...',
          searchPlaceholderValue: 'Search by Part # or Name...',
          itemSelectText: '',
          position: 'bottom',
        });

        wireDohChoicesInteractions(selectEl);
      } catch (err) {
        console.warn('DOH part selector enhancement failed; using native select.', err);
        dohChoices = null;
      }
    }

    if (!dohChoices) {
      selectEl.classList.add('analytics-native-select');
      selectEl.hidden = false;
      selectEl.size = Math.min(8, Math.max(4, parts.length || 4));
    }

    selectEl.onchange = onSelectionChange;
    
    updateChart();
  }

  function updateChart() {
    const ctx = document.getElementById('dohChart');
    if (!ctx) return;
    if (!chartData || !chartData.series) return;

    let selectedParts = [];
    if (dohChoices) {
      selectedParts = dohChoices.getValue(true);
    } else {
      const selectEl = document.getElementById('doh-part-select');
      selectedParts = Array.from(selectEl.selectedOptions).map(o => o.value);
    }

    if (typeof selectedParts === 'string') {
      selectedParts = [selectedParts];
    }
    
    if (selectedParts.length === 0) {
        // if none selected, show blank chart
        if (dohChart) dohChart.destroy();
        return;
    }

    // Build timeline
    const allDates = new Set();
    selectedParts.forEach(part => {
      const seriesObj = chartData.series[part];
      if (seriesObj) {
        Object.keys(seriesObj).forEach(d => allDates.add(d));
      }
    });

    let dates = Array.from(allDates).sort();
    
    // Filter by time
    if (selectedDays !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(selectedDays, 10));
      const cutoffStr = cutoff.toISOString().split('T')[0];
      dates = dates.filter(d => d >= cutoffStr);
    }

    // Use dynamic colors
    const colors = [
      '#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#f43f5e'
    ];

    const datasets = selectedParts.map((part, index) => {
      const color = colors[index % colors.length];
      const seriesObj = chartData.series[part] || {};
      const dataPoints = dates.map(d => seriesObj[d] !== undefined ? seriesObj[d] : null);
      
      const desc = chartData.metadata?.[part]?.description || part;
      
      return {
        label: `${part} - ${desc}`,
        data: dataPoints,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: dates.length > 30 ? 0 : 3,
        pointHoverRadius: 6,
        spanGaps: true
      };
    });

    if (dohChart) {
      dohChart.destroy();
    }

    if (window.Chart) {
      Chart.defaults.color = '#8b949e';
      Chart.defaults.font.family = "'Inter', 'Nunito', sans-serif";

      dohChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              display: false // We use Choices.js to show selected parts
            },
            tooltip: {
              backgroundColor: 'rgba(22, 27, 34, 0.9)',
              titleColor: '#e6edf3',
              bodyColor: '#e6edf3',
              borderColor: '#30363d',
              borderWidth: 1,
              padding: 12,
              boxPadding: 4,
              usePointStyle: true
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Days on Hand (DOH)'
              },
              grid: {
                color: 'rgba(255, 255, 255, 0.05)'
              }
            },
            x: {
              grid: {
                display: false
              },
              ticks: {
                maxRotation: 45,
                minRotation: 45
              }
            }
          }
        }
      });
    }
  }

  return {
    openModal: openAnalyticsModal,
    closeModal: closeAnalyticsModal
  };
}
