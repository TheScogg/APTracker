export function initAnalyticsTool(deps) {
  const { getCurrentPlantId, apiSessionClient } = deps;

  let dohChart = null;
  let dohChoices = null;
  let chartData = null;
  let selectedDays = 'all';
  let currentSortBy = 'part';

  let activeTab = 'doh';
  let runsChart = null;
  let runsData = null;
  let runsSelectedDays = '30';
  let selectedRunKey = '';
  let analyticsWired = false;

  const colors = [
    '#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#f43f5e'
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function openAnalyticsModal() {
    document.getElementById('analytics-modal')?.classList.add('visible');
    wireAnalyticsShell();
    activateAnalyticsTab(activeTab);
    if (!chartData) loadDohData();
    if (activeTab === 'runs' && !runsData) loadRunsData();
  }

  function closeAnalyticsModal() {
    document.getElementById('analytics-modal')?.classList.remove('visible');
  }

  window.closeAnalyticsModal = closeAnalyticsModal;

  function wireAnalyticsShell() {
    if (analyticsWired) return;
    analyticsWired = true;
    document.getElementById('analytics-tabs')?.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('[data-analytics-tab]');
      if (!btn) return;
      activateAnalyticsTab(btn.dataset.analyticsTab || 'doh');
    });
    document.getElementById('runs-search-input')?.addEventListener('input', () => {
      renderRunsPicker();
      renderRunsDetail();
    });
    wireRunsTimeFilters();
  }

  function activateAnalyticsTab(tab) {
    activeTab = tab === 'runs' ? 'runs' : 'doh';
    document.querySelectorAll('#analytics-tabs [data-analytics-tab]').forEach(btn => {
      const isActive = btn.dataset.analyticsTab === activeTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('#analytics-modal .analytics-panel').forEach(panel => {
      const isActive = panel.id === `analytics-panel-${activeTab}`;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });
    if (activeTab === 'runs') {
      if (!runsData) loadRunsData();
      else setTimeout(() => runsChart?.resize?.(), 0);
    } else {
      setTimeout(() => dohChart?.resize?.(), 0);
    }
  }

  async function authenticatedJson(path) {
    const token = await apiSessionClient.getAccessToken();
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok || json.success === false) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function loadDohData() {
    const plantId = getCurrentPlantId();
    if (!plantId) return;
    try {
      const json = await authenticatedJson(`/api/plants/${encodeURIComponent(plantId)}/reports/doh`);
      chartData = json.data;
      initDohFilterControls();
      updateDohChart();
    } catch (e) {
      console.error('DOH fetch exception', e);
    }
  }

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
    choicesContainer.addEventListener('focusin', openDropdown);
  }

  function initDohFilterControls() {
    const sortSelect = document.getElementById('doh-sort-select');
    if (sortSelect) {
      const newSortSelect = sortSelect.cloneNode(true);
      sortSelect.parentNode.replaceChild(newSortSelect, sortSelect);
      newSortSelect.value = currentSortBy;
      newSortSelect.addEventListener('change', (e) => {
        currentSortBy = e.target.value;
        renderDohChoicesOptions();
      });
    }

    renderDohChoicesOptions();

    const timeFilters = document.getElementById('doh-time-filters');
    if (timeFilters) {
      timeFilters.querySelectorAll('button').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
          timeFilters.querySelectorAll('button').forEach(b => {
            b.classList.remove('active', 'btn-primary');
            b.classList.add('btn-ghost');
          });
          e.target.classList.remove('btn-ghost');
          e.target.classList.add('active', 'btn-primary');
          selectedDays = e.target.dataset.days;
          updateDohChart();
        });
      });
    }
  }

  function renderDohChoicesOptions() {
    const selectEl = document.getElementById('doh-part-select');
    if (!selectEl) return;

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
    selectEl.innerHTML = '';

    const parts = Object.keys(chartData?.series || {});
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
      const desc = chartData.metadata?.[part]?.description || part;
      const count = chartData.metadata?.[part]?.count || 0;
      opt.text = `${part} - ${desc} (${count} record${count === 1 ? '' : 's'})`;
      opt.selected = previouslySelected.length ? previouslySelected.includes(part) : false;
      selectEl.appendChild(opt);
    });

    if (previouslySelected.length === 0) {
      for (let i = 0; i < Math.min(5, parts.length); i++) selectEl.options[i].selected = true;
    }

    if (window.Choices) {
      try {
        dohChoices = new Choices(selectEl, {
          removeItemButton: true,
          searchEnabled: true,
          shouldSort: false,
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

    selectEl.onchange = updateDohChart;
    updateDohChart();
  }

  function updateDohChart() {
    const ctx = document.getElementById('dohChart');
    if (!ctx || !chartData?.series) return;

    let selectedParts = dohChoices
      ? dohChoices.getValue(true)
      : Array.from(document.getElementById('doh-part-select')?.selectedOptions || []).map(o => o.value);
    if (typeof selectedParts === 'string') selectedParts = [selectedParts];

    if (!selectedParts.length) {
      dohChart?.destroy();
      dohChart = null;
      return;
    }

    const allDates = new Set();
    selectedParts.forEach(part => {
      Object.keys(chartData.series[part] || {}).forEach(d => allDates.add(d));
    });

    let dates = Array.from(allDates).sort();
    if (selectedDays !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(selectedDays, 10));
      const cutoffStr = cutoff.toISOString().split('T')[0];
      dates = dates.filter(d => d >= cutoffStr);
    }

    const datasets = selectedParts.map((part, index) => {
      const color = colors[index % colors.length];
      const seriesObj = chartData.series[part] || {};
      return {
        label: `${part} - ${chartData.metadata?.[part]?.description || part}`,
        data: dates.map(d => seriesObj[d] !== undefined ? seriesObj[d] : null),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: dates.length > 30 ? 0 : 3,
        pointHoverRadius: 6,
        spanGaps: true
      };
    });

    dohChart?.destroy();
    if (!window.Chart) return;
    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.family = "'Inter', 'Nunito', sans-serif";
    dohChart = new Chart(ctx, {
      type: 'line',
      data: { labels: dates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
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
            title: { display: true, text: 'Days on Hand (DOH)' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          x: {
            grid: { display: false },
            ticks: { maxRotation: 45, minRotation: 45 }
          }
        }
      }
    });
  }

  async function loadRunsData() {
    const plantId = getCurrentPlantId();
    if (!plantId) return;
    setRunsLoading(true);
    try {
      const json = await authenticatedJson(`/api/plants/${encodeURIComponent(plantId)}/reports/runs`);
      runsData = json.data || { entities: [], rows: [] };
      selectedRunKey = runsData.entities?.[0]?.key || '';
      renderRunsPicker();
      renderRunsDetail();
    } catch (e) {
      console.error('Runs fetch exception', e);
      runsData = { entities: [], rows: [] };
      renderRunsPicker();
      renderRunsDetail();
    } finally {
      setRunsLoading(false);
    }
  }

  function setRunsLoading(isLoading) {
    const empty = document.getElementById('runs-empty');
    if (!empty) return;
    if (isLoading) {
      empty.hidden = false;
      empty.textContent = 'Loading run history...';
    } else {
      empty.textContent = 'No schedule run history found for this plant yet.';
    }
  }

  function wireRunsTimeFilters() {
    const timeFilters = document.getElementById('runs-time-filters');
    if (!timeFilters) return;
    timeFilters.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (event) => {
        timeFilters.querySelectorAll('button').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-ghost');
        });
        event.target.classList.remove('btn-ghost');
        event.target.classList.add('active', 'btn-primary');
        runsSelectedDays = event.target.dataset.days || '30';
        renderRunsDetail();
      });
    });
  }

  function normalizedSearch() {
    return String(document.getElementById('runs-search-input')?.value || '').trim().toLowerCase();
  }

  function filteredRunEntities() {
    const entities = runsData?.entities || [];
    const term = normalizedSearch();
    if (!term) return entities;
    return entities.filter(entity => [
      entity.partNumber,
      entity.description,
      entity.moldKey,
      ...(entity.presses || []).map(p => p.press)
    ].some(value => String(value || '').toLowerCase().includes(term)));
  }

  function selectedRunEntity() {
    const entities = filteredRunEntities();
    if (!entities.length) return null;
    const selected = entities.find(entity => entity.key === selectedRunKey);
    if (selected) return selected;
    selectedRunKey = entities[0].key;
    return entities[0];
  }

  function renderRunsPicker() {
    const list = document.getElementById('runs-picker-list');
    const empty = document.getElementById('runs-empty');
    if (!list) return;
    const entities = filteredRunEntities();
    list.innerHTML = '';
    if (empty) empty.hidden = !!(runsData?.rows?.length || entities.length);

    entities.slice(0, 80).forEach(entity => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `runs-picker-item${entity.key === selectedRunKey ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="runs-picker-main">${esc(entity.partNumber || 'No part #')}</span>
        <span class="runs-picker-sub">${esc(entity.description || 'No description')}</span>
        <span class="runs-picker-meta">${esc(entity.moldKey || 'No mold suggestion')} · ${entity.runs || 0} run${entity.runs === 1 ? '' : 's'}</span>
      `;
      btn.addEventListener('click', () => {
        selectedRunKey = entity.key;
        renderRunsPicker();
        renderRunsDetail();
      });
      list.appendChild(btn);
    });
  }

  function runsCutoffDate() {
    if (runsSelectedDays === 'all') return '';
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(runsSelectedDays, 10));
    return cutoff.toISOString().split('T')[0];
  }

  function rowsForSelectedEntity(entity) {
    if (!entity) return [];
    const cutoff = runsCutoffDate();
    return (runsData?.rows || [])
      .filter(row => row.partNumber === entity.partNumber)
      .filter(row => !cutoff || row.scheduleDate >= cutoff)
      .sort((a, b) => b.scheduleDate.localeCompare(a.scheduleDate) || String(b.shift).localeCompare(String(a.shift)));
  }

  function renderRunsDetail() {
    const entity = selectedRunEntity();
    renderRunsPicker();
    const selectedCard = document.getElementById('runs-selected-card');
    const pressTable = document.getElementById('runs-press-table');
    const recentTable = document.getElementById('runs-recent-table');

    if (!entity) {
      if (selectedCard) selectedCard.innerHTML = '<div class="runs-empty-inline">No matching runs.</div>';
      if (pressTable) pressTable.innerHTML = '';
      if (recentTable) recentTable.innerHTML = '';
      runsChart?.destroy();
      runsChart = null;
      return;
    }

    const rows = rowsForSelectedEntity(entity);
    const moldLabel = entity.moldKey ? `${entity.moldKey} · ${entity.moldSource || 'inferred'}` : 'No mold suggestion';
    if (selectedCard) {
      selectedCard.innerHTML = `
        <div>
          <div class="runs-selected-kicker">Selected</div>
          <div class="runs-selected-title">${esc(entity.partNumber)} · ${esc(entity.description || 'No description')}</div>
          <div class="runs-selected-meta">Mold suggestion: <strong>${esc(moldLabel)}</strong></div>
        </div>
        <div class="runs-selected-stats">
          <span>${rows.length} visible run${rows.length === 1 ? '' : 's'}</span>
          <span>${entity.presses?.length || 0} press${entity.presses?.length === 1 ? '' : 'es'}</span>
          <span>Last: ${esc(entity.lastRun || '-')}</span>
        </div>
      `;
    }

    renderRunsChart(rows);
    renderRunsPressTable(rows, pressTable);
    renderRunsRecentTable(rows, recentTable);
  }

  function renderRunsChart(rows) {
    const ctx = document.getElementById('runsChart');
    if (!ctx) return;
    const byDate = {};
    rows.forEach(row => { byDate[row.scheduleDate] = (byDate[row.scheduleDate] || 0) + 1; });
    const dates = Object.keys(byDate).sort();

    runsChart?.destroy();
    if (!window.Chart) return;
    runsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [{
          label: 'Runs',
          data: dates.map(date => byDate[date]),
          backgroundColor: 'rgba(249,115,22,0.55)',
          borderColor: '#f97316',
          borderWidth: 1,
          borderRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: 'Runs' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          x: {
            grid: { display: false },
            ticks: { maxRotation: 45, minRotation: 45 }
          }
        }
      }
    });
  }

  function renderRunsPressTable(rows, table) {
    if (!table) return;
    const byPress = {};
    rows.forEach(row => {
      if (!byPress[row.press]) byPress[row.press] = { press: row.press, runs: 0, lastRun: row.scheduleDate };
      byPress[row.press].runs += 1;
      if (row.scheduleDate > byPress[row.press].lastRun) byPress[row.press].lastRun = row.scheduleDate;
    });
    const presses = Object.values(byPress).sort((a, b) => b.runs - a.runs || b.lastRun.localeCompare(a.lastRun));
    table.innerHTML = `
      <thead><tr><th>Press</th><th>Runs</th><th>Last Run</th></tr></thead>
      <tbody>${presses.map(p => `
        <tr><td>${esc(p.press)}</td><td>${p.runs}</td><td>${esc(p.lastRun)}</td></tr>
      `).join('') || '<tr><td colspan="3">No runs in this range.</td></tr>'}</tbody>
    `;
  }

  function renderRunsRecentTable(rows, table) {
    if (!table) return;
    table.innerHTML = `
      <thead><tr><th>Date</th><th>Shift</th><th>Press</th><th>Part #</th><th>Name</th><th>Mold</th><th>Cavity</th></tr></thead>
      <tbody>${rows.slice(0, 80).map(row => `
        <tr>
          <td>${esc(row.scheduleDate)}</td>
          <td>${esc(row.shift || '-')}</td>
          <td>${esc(row.press)}</td>
          <td>${esc(row.partNumber)}</td>
          <td>${esc(row.description || '-')}</td>
          <td>${esc(row.moldKey || '-')} ${row.moldKey ? '*' : ''}</td>
          <td>${esc(row.cavity || '-')}</td>
        </tr>
      `).join('') || '<tr><td colspan="7">No recent runs in this range.</td></tr>'}</tbody>
    `;
  }

  return {
    openModal: openAnalyticsModal,
    closeModal: closeAnalyticsModal
  };
}
