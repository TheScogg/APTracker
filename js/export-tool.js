export function initExportTool(deps) {
  const {
    getIssues,
    getCurrentSort,
    getIssueRowScope,
    getActiveRows,
    getPresses,
    getIssueScope,
    getCurrentUser,
    getCurrentPlantId,
    periodFilter,
    issueHasActiveStatus,
    applySortOrder,
    getStatuses,
    currentStatusKey,
    alphaColor,
    esc,
    localDateStr,
    completeDemoGuideStep,
    fetchIssueEventHistory,
    fetchAttachmentPhotos,
    toRowId,
    getStatusDef,
    getHtml2Pdf,
    getXlsx
  } = deps;

  function currentFilteredIssues() {
    const search = document.getElementById('search-input')?.value.toLowerCase() || '';
    const machineFilter = document.getElementById('machine-filter')?.value || '';
    const statusFilter = document.getElementById('status-filter')?.value || '';
    const sort = getCurrentSort();
    const rowScope = getIssueRowScope();
    const activeRows = getActiveRows();
    const presses = getPresses();
    const issueScope = getIssueScope();
    const currentUser = getCurrentUser();

    const activeRowMachines = new Set();
    if (rowScope === 'active' && activeRows.size > 0) {
      activeRows.forEach(rowName => { (presses[rowName] || []).forEach(machine => activeRowMachines.add(machine)); });
    }

    const filtered = getIssues().filter(issue => {
      if (issueScope === 'mine' && issue.userId !== currentUser?.uid) return false;
      if (!periodFilter(issue)) return false;
      if (rowScope === 'active' && activeRows.size > 0 && !activeRowMachines.has(issue.machine)) return false;
      if (machineFilter && issue.machine !== machineFilter) return false;
      if (statusFilter && !issueHasActiveStatus(issue, statusFilter)) return false;
      if (search) {
        const machineText = String(issue.machine || '').toLowerCase();
        const noteText = String(issue.note || '').toLowerCase();
        const resolveText = String(issue.resolveNote || '').toLowerCase();
        const userText = String(issue.userName || '').toLowerCase();
        if (!machineText.includes(search) && !noteText.includes(search) && !resolveText.includes(search) && !userText.includes(search)) return false;
      }
      return true;
    });

    applySortOrder(filtered, sort);
    return filtered;
  }

  function statusConfig() {
    return Object.fromEntries(Object.entries(getStatuses()).map(([key, value]) => [
      key,
      {
        label: value.label,
        icon: value.icon,
        color: value.swipeColor || value.cssColor || value.color,
        subs: value.subs
      }
    ]));
  }

  function fallbackStatusConfig(config, key) {
    return config[key] || { label: key || 'Unknown', icon: '\u25cf', color: '#8b949e', subs: [] };
  }

  function openModal() {
    const filtered = currentFilteredIssues();
    const subtitle = document.getElementById('export-subtitle');
    if (subtitle) subtitle.textContent = filtered.length + ' issue' + (filtered.length !== 1 ? 's' : '') + ' in current view';

    const config = statusConfig();
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const currentUser = getCurrentUser();
    const userName = currentUser?.displayName || currentUser?.email || 'Unknown';

    let cardsHtml = '';
    filtered.forEach(issue => {
      const history = issue.eventHistory && issue.eventHistory.length > 0
        ? issue.eventHistory
        : [{
            status: currentStatusKey(issue),
            subStatus: issue.currentStatus?.subStatusKey || '',
            note: issue.currentStatus?.notePreview || '',
            dateTime: issue.currentStatus?.enteredDateTime || issue.dateTime || '',
            by: issue.currentStatus?.enteredBy?.name || issue.userName || ''
          }];
      const lastEntry = history[history.length - 1];
      const lastKey = lastEntry.status || 'open';
      const cfg = fallbackStatusConfig(config, lastKey);
      const statusLabel = cfg.label + (lastEntry.subStatus ? ' \u203a ' + lastEntry.subStatus : '');
      const color = cfg.color || '#ef4444';
      const pillBg = alphaColor(color, 0.09);
      const pillBorder = alphaColor(color, 0.27);

      const photosHtml = (issue.photos || []).length
        ? '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' + issue.photos.map(photo => '<img src="' + photo.dataUrl + '" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #ddd;">').join('') + '</div>'
        : '';

      let timelineHtml = '';
      history.forEach((entry, idx) => {
        const entryCfg = fallbackStatusConfig(config, entry.status);
        const isCurrent = idx === history.length - 1;
        timelineHtml += '<div style="padding:3px 0 3px 10px;border-left:2px solid ' + (isCurrent ? entryCfg.color : '#ddd') + ';margin-bottom:2px;">'
          + '<div style="font-size:9px;font-weight:700;color:' + entryCfg.color + ';">' + entryCfg.icon + ' ' + entryCfg.label + (entry.subStatus ? ' \u203a ' + esc(entry.subStatus) : '') + (isCurrent ? ' (current)' : '') + '</div>'
          + '<div style="font-size:8px;color:#999;">' + (entry.dateTime || '') + (entry.by ? ' \u2014 ' + esc(entry.by) : '') + '</div>'
          + (entry.note ? '<div style="font-size:8px;color:#666;font-style:italic;">&quot;' + esc(entry.note) + '&quot;</div>' : '')
          + '</div>';
      });

      const datePart = issue.dateTime || '';

      cardsHtml += `<div style="border:1px solid #ddd;border-radius:6px;margin-bottom:10px;overflow:hidden;page-break-inside:avoid;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #eee;background:#fafafa;">
          <span style="font-size:14px;font-weight:700;color:#ea580c;font-family:monospace;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:2px 8px;">${esc(issue.machine)}</span>
          <span style="font-size:12px;font-weight:700;flex:1;">${esc(issue.note || '')}</span>
          <span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.3px;background:${pillBg};color:${color};border:1px solid ${pillBorder};">${esc(statusLabel)}</span>
        </div>
        <div style="padding:10px;font-size:10px;">
          <div style="font-size:11px;line-height:1.5;margin-bottom:6px;color:#333;">${esc(issue.note || '')}</div>
          <div style="display:flex;gap:16px;color:#666;font-size:9px;margin-bottom:4px;">
            <span><span style="color:#999;">Logged:</span> ${esc(datePart)}</span>
            <span><span style="color:#999;">By:</span> ${esc(issue.userName || '')}</span>
          </div>
          ${issue.resolveNote ? '<div style="display:flex;gap:16px;color:#666;font-size:9px;margin-bottom:4px;"><span><span style="color:#999;">Resolved:</span> ' + (issue.resolveDateTime || '') + '</span><span><span style="color:#999;">By:</span> ' + (issue.resolvedBy || '') + '</span></div><div style="font-size:9px;color:#166534;background:#dcfce7;padding:4px 8px;border-radius:4px;margin-bottom:6px;">' + esc(issue.resolveNote) + '</div>' : ''}
          ${photosHtml}
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;">
            <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#999;margin-bottom:4px;">Status history</div>
            ${timelineHtml}
          </div>
        </div>
      </div>`;
    });

    const previewHtml = `<div id="pdf-content" style="background:white;padding:20px;color:#1a1a1a;font-family:'Segoe UI',sans-serif;font-size:11px;">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid #ea580c;padding-bottom:8px;margin-bottom:16px;">
        <div style="font-size:18px;font-weight:700;color:#ea580c;letter-spacing:0.5px;">AP-TRACKER</div>
        <div style="text-align:right;font-size:9px;color:#666;line-height:1.5;">Issue log report<br>${dateStr}<br>Generated by ${esc(userName)}</div>
      </div>
      ${cardsHtml}
    </div>`;

    const preview = document.getElementById('export-preview');
    if (preview) preview.innerHTML = previewHtml;
    document.getElementById('export-modal')?.classList.add('visible');
  }

  function closeModal() {
    document.getElementById('export-modal')?.classList.remove('visible');
  }

  async function downloadPDF() {
    const btn = document.getElementById('export-dl-btn');
    const html2pdf = getHtml2Pdf();
    let wrapper = null;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating\u2026';
    }
    try {
      const src = document.getElementById('pdf-content');
      if (!src) throw new Error('PDF content not found');
      if (!html2pdf) throw new Error('PDF library not loaded');
      closeModal();
      wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;top:0;left:-10000px;width:816px;background:white;opacity:0.01;pointer-events:none;';
      const clone = src.cloneNode(true);
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);
      const opt = {
        margin: [0.4, 0.4, 0.4, 0.4],
        filename: 'AP-Tracker-Report-' + localDateStr(new Date()) + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] }
      };
      await html2pdf().set(opt).from(clone).save();
      completeDemoGuideStep('export');
    } catch (error) {
      console.error('PDF export error:', error);
    } finally {
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Download PDF';
      }
    }
  }

  async function hydrateExportRows(filtered) {
    await Promise.all(filtered.map(async issue => {
      if (issue.schemaVersion === 2 && (!issue.eventHistory || issue.eventHistory.length === 0)) {
        const history = await fetchIssueEventHistory(issue);
        if (history.length > 0) issue.eventHistory = history;
      }
      if (Number(issue.photoCount || 0) > 0 && (!issue.photos || issue.photos.length === 0)) {
        issue.photos = await fetchAttachmentPhotos(issue.id);
      }
    }));
  }

  function rowNameLookup() {
    const rowIdToName = {};
    Object.entries(getPresses()).forEach(([rowName]) => {
      rowIdToName[toRowId(rowName)] = rowName;
    });
    return rowIdToName;
  }

  function toJsDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts === 'number') return new Date(ts);
    return null;
  }

  async function downloadExcel() {
    const XLSX = getXlsx();
    if (!XLSX) {
      alert('Excel library not loaded. Please refresh and try again.');
      return;
    }
    const btn = document.getElementById('export-excel-menu-item');
    const origInner = btn?.innerHTML || '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Building\u2026';
    }
    try {
      const filtered = currentFilteredIssues();
      await hydrateExportRows(filtered);

      const rowIdToName = rowNameLookup();
      const plantId = getCurrentPlantId();

      const ISSUE_HEADERS = ['Issue ID', 'Plant ID', 'Machine', 'Row', 'Date Logged', 'Note', 'Status', 'Sub-Status',
        'Logged By', 'Resolved', 'Resolved At', 'Resolve Note', 'Resolved By', 'Photo Count', 'Photo URLs',
        'Workflow State', 'Created At', 'Updated At'];
      const issueRows = filtered.map(issue => {
        const statusKey = currentStatusKey(issue);
        const statusLabel = getStatusDef(statusKey).label || statusKey;
        const subStatus = issue.currentStatus?.subStatusKey || '';
        const rowName = rowIdToName[issue.rowId] || issue.rowId || '';
        const isResolved = !!(issue.lifecycle?.isResolved || issue.resolved);
        const history = issue.eventHistory || issue.statusHistory || [];
        const resolvedEntry = history.slice().reverse().find(entry => entry.status === 'resolved');
        const photoUrls = (issue.photos || []).map(photo => photo.dataUrl).filter(Boolean).join('\n');
        return {
          'Issue ID': issue.id,
          'Plant ID': issue.plantId || plantId,
          'Machine': issue.machine || '',
          'Row': rowName,
          'Date Logged': toJsDate(issue.timestamp) || issue.dateTime || '',
          'Note': issue.note || '',
          'Status': statusLabel,
          'Sub-Status': subStatus,
          'Logged By': issue.userName || '',
          'Resolved': isResolved ? 'Yes' : 'No',
          'Resolved At': toJsDate(issue.lifecycle?.resolvedAt) || '',
          'Resolve Note': issue.resolveNote || '',
          'Resolved By': resolvedEntry?.by || issue.resolvedBy || '',
          'Photo Count': Number(issue.photoCount || 0),
          'Photo URLs': photoUrls,
          'Workflow State': issue.workflowState || 'called',
          'Created At': toJsDate(issue.createdAt) || '',
          'Updated At': toJsDate(issue.updatedAt) || ''
        };
      });

      const EVENT_HEADERS = ['Issue ID', 'Machine', 'Event #', 'Date/Time', 'From Status', 'To Status', 'Sub-Status', 'Note', 'By'];
      const eventRows = [];
      filtered.forEach(issue => {
        const history = issue.eventHistory || issue.statusHistory || [];
        history.forEach((entry, idx) => {
          const prevKey = idx > 0 ? history[idx - 1].status : '';
          eventRows.push({
            'Issue ID': issue.id,
            'Machine': issue.machine || '',
            'Event #': idx + 1,
            'Date/Time': entry.dateTime || '',
            'From Status': prevKey ? (getStatusDef(prevKey).label || prevKey) : '',
            'To Status': getStatusDef(entry.status).label || entry.status || '',
            'Sub-Status': entry.subStatus || '',
            'Note': entry.note || '',
            'By': entry.by || ''
          });
        });
      });

      const PHOTO_HEADERS = ['Issue ID', 'Machine', 'File Name', 'Storage Path', 'Download URL', 'Content Type', 'Size (bytes)'];
      const photoRows = [];
      filtered.forEach(issue => {
        (issue.photos || []).forEach(photo => {
          photoRows.push({
            'Issue ID': issue.id,
            'Machine': issue.machine || '',
            'File Name': photo.name || '',
            'Storage Path': photo.storagePath || '',
            'Download URL': photo.dataUrl || '',
            'Content Type': photo.contentType || '',
            'Size (bytes)': Number(photo.sizeBytes || 0)
          });
        });
      });

      const mkSheet = (rows, headers) => XLSX.utils.json_to_sheet(
        rows.length > 0 ? rows : [Object.fromEntries(headers.map(header => [header, null]))],
        { header: headers, cellDates: true }
      );

      const wsIssues = mkSheet(issueRows, ISSUE_HEADERS);
      const wsEvents = mkSheet(eventRows, EVENT_HEADERS);
      const wsPhotos = mkSheet(photoRows, PHOTO_HEADERS);

      wsIssues['!cols'] = [24, 14, 10, 12, 20, 44, 18, 18, 20, 10, 20, 44, 20, 12, 60, 16, 20, 20].map(width => ({ wch: width }));
      wsEvents['!cols'] = [24, 10, 8, 20, 18, 18, 18, 44, 20].map(width => ({ wch: width }));
      wsPhotos['!cols'] = [24, 10, 30, 60, 80, 14, 14].map(width => ({ wch: width }));

      if (issueRows.length > 0) {
        const range = XLSX.utils.decode_range(wsIssues['!ref']);
        wsIssues['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsIssues, 'Issues');
      XLSX.utils.book_append_sheet(wb, wsEvents, 'Events');
      XLSX.utils.book_append_sheet(wb, wsPhotos, 'Photos');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AP-Tracker-Export-' + localDateStr(new Date()) + '.xlsx';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      completeDemoGuideStep('export');
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Excel export failed. See console for details.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origInner;
      }
    }
  }

  document.getElementById('export-modal')?.addEventListener('click', event => {
    if (event.target === document.getElementById('export-modal')) closeModal();
  });

  return {
    openModal,
    closeModal,
    downloadPDF,
    downloadExcel
  };
}
