// --- LINE 1-3 inside summary.js ---
// I-AUTHO-NUM: fixed 11-zero prefix + 5 manually entered digits = 16 chars total
const AUTHO_PREFIX = '00000000000';
function buildAuthoNum(suffix) {
  const digits = String(suffix || '').replace(/\D/g, '').slice(0, 5);
  return digits ? AUTHO_PREFIX + digits.padStart(5, '0') : '';
}

// ── All Module Details: search + manual row selection state ──
let currentPermRows = [];       // full, unfiltered list of module rows currently loaded
let currentDashboardRows = [];
let moduleSearchText = '';      // current search bar text (lowercased)
let selectedModuleRows = new Set(); // indices (into currentPermRows) that are checked

// ── STATE MANIPULATION HEADERS FOR MULTI-FILTER MATCHING ──
let activeFilters = {
  projectName: 'ALL',
  selectedModules: new Set(), // tracks checked module names
  timeline: '' // formatted string tracker "MM/YYYY"
};
let allModuleNames = new Map();
let availableModuleNames = new Map();
let moduleFilterActive = false;

// Global hook placeholder variable to track Flatpickr engine instance
let filterCalInstance = null;

// ── SEED DATA VALUES INTO FILTER UI COMPONENT DRAWER DRAWS ──
// ── 1. FIXED FILTER ENGINE INITIALIZER ──
function initFilterControlsData(rows) {
  const projSelect = document.getElementById('filterProjectSelect');
  const modDrawer = document.getElementById('moduleCheckboxDrawer');
  
  if (!projSelect || !modDrawer) return;

  const uniqueProjects = [...new Set(rows.map(r => String(r.projectName || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const currentProjSelection = projSelect.value || 'ALL';
  projSelect.innerHTML = '<option value="ALL">All Projects</option>' +
    uniqueProjects.map(p => `<option value="${escapeHtml(p.trim().toLowerCase())}">${escapeHtml(p)}</option>`).join('');
  projSelect.value = [...projSelect.options].some(option => option.value === currentProjSelection)
    ? currentProjSelection
    : 'ALL';

  allModuleNames = new Map(
    rows
      .map(row => String(row.moduleName || '').trim())
      .filter(Boolean)
      .map(name => [name.toLowerCase(), name])
  );
  activeFilters.projectName = projSelect.value;
  setAvailableModulesForProject(activeFilters.projectName, rows, activeFilters.projectName !== 'ALL');
}

function setAvailableModulesForProject(projectName, rows, selectAll) {
  const scopedRows = projectName === 'ALL'
    ? rows
    : rows.filter(row => String(row.projectName || '').trim().toLowerCase() === projectName);
  availableModuleNames = new Map(
    scopedRows
      .map(row => String(row.moduleName || '').trim())
      .filter(Boolean)
      .map(name => [name.toLowerCase(), name])
  );
  activeFilters.selectedModules = selectAll
    ? new Set(availableModuleNames.keys())
    : new Set();
  moduleFilterActive = selectAll;
  updateModuleFilterOptions();
}

function updateModuleFilterOptions() {
  const modDrawer = document.getElementById('moduleCheckboxDrawer');
  if (!modDrawer) return;

  const drawerItemsHtml = [...availableModuleNames.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([lowerM, m]) => {
    const isChecked = activeFilters.selectedModules.has(lowerM) ? 'checked' : '';
    return `
      <label class="drawer-checkbox-item">
        <input type="checkbox" value="${escapeHtml(lowerM)}" ${isChecked} onchange="handleModuleCheckboxChange(this)"/>
        <span>${escapeHtml(m)}</span>
      </label>
    `;
  }).join('');
  modDrawer.innerHTML = drawerItemsHtml || '<div style="padding: 8px; color: var(--muted);">No modules available</div>';

  updateModuleFilterLabel();
}

function areAllModulesSelected() {
  return availableModuleNames.size > 0 &&
    activeFilters.selectedModules.size === availableModuleNames.size &&
    [...availableModuleNames.keys()].every(name => activeFilters.selectedModules.has(name));
}

function updateModuleFilterLabel() {
  const label = document.getElementById('checkboxDropdownLabel');
  if (!label) return;

  if (areAllModulesSelected()) {
    label.textContent = 'All Modules Selected';
  } else if (activeFilters.selectedModules.size === 0) {
    label.textContent = 'Select Modules';
  } else {
    label.textContent = `${activeFilters.selectedModules.size} Module(s) Selected`;
  }
}

function handleProjectFilterChange() {
  activeFilters.projectName = document.getElementById('filterProjectSelect')?.value || 'ALL';
  setAvailableModulesForProject(activeFilters.projectName, currentPermRows, activeFilters.projectName !== 'ALL');
  runCombinedFilters();
}

function getRowMonthYear(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  let match = text.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (match) return `${match[2].padStart(2, '0')}/${match[1]}`;

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[2].padStart(2, '0')}/${match[3]}`;

  match = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[1].padStart(2, '0')}/${match[2]}`;

  return '';
}

function matchesDashboardFilters(row) {
  const projectName = String(row.projectName || '').trim().toLowerCase();
  const moduleName = String(row.moduleName || '').trim().toLowerCase();

  if (activeFilters.projectName !== 'ALL' && projectName !== activeFilters.projectName) return false;
  if (moduleFilterActive && !activeFilters.selectedModules.has(moduleName)) return false;
  if (activeFilters.timeline) {
    const reviewMonth = getRowMonthYear(row.review);
    const testingMonth = getRowMonthYear(row.dateOfTesting);
    if (reviewMonth !== activeFilters.timeline && testingMonth !== activeFilters.timeline) return false;
  }
  return true;
}

// Translates the native calendar input into dashboard database tokens safely offline
function handleNativeMonthFilter(input) {
  const val = input.value; // Returns raw string "YYYY-MM" (e.g. "2026-10")
  if (!val) {
    activeFilters.timeline = '';
  } else {
    activeFilters.timeline = getRowMonthYear(val);
  }
  runCombinedFilters();
}

// Handle checkboxes dynamic updates
function handleModuleCheckboxChange(cb) {
  const val = cb.value;
  if (cb.checked) {
    activeFilters.selectedModules.add(val);
  } else {
    activeFilters.selectedModules.delete(val);
  }
  moduleFilterActive = activeFilters.selectedModules.size > 0;

  updateModuleFilterLabel();
  runCombinedFilters();
}
// Toggle open/close visibility states on the custom dropdown menu panel layer box
function toggleModuleSelectorDrawer(event) {
  event.stopPropagation();
  const drawer = document.getElementById('moduleCheckboxDrawer');
  const selectBox = event.currentTarget;
  
  drawer.classList.toggle('open-drawer');
  selectBox.classList.toggle('active-box');
  
  // Hook listener window to close drawer cleanly if user clicks anywhere else on screen
  if (drawer.classList.contains('open-drawer')) {
    document.addEventListener('click', closeModuleSelectorDrawerOutside);
  }
}

// Automatically folds drawer close when clicking background elements outside menu area
function closeModuleSelectorDrawerOutside() {
  const drawer = document.getElementById('moduleCheckboxDrawer');
  const selectBox = document.querySelector('.module-dropdown-select-box');
  
  if (drawer) drawer.classList.remove('open-drawer');
  if (selectBox) selectBox.classList.remove('active-box');
  
  document.removeEventListener('click', closeModuleSelectorDrawerOutside);
}

// Open/Close dropdown lists cleanly
function toggleModuleDrawer(e) {
  e.stopPropagation();
  const drawer = document.getElementById('moduleCheckboxDrawer');
  drawer.classList.toggle('show');
  document.addEventListener('click', closeModuleDrawerOutside);
}

function closeModuleDrawerOutside() {
  const drawer = document.getElementById('moduleCheckboxDrawer');
  if (drawer) drawer.classList.remove('show');
  document.removeEventListener('click', closeModuleDrawerOutside);
}

// ── 1. UPDATE RUNCOMBINEDFILTERS TO REMOVE LOWER TABLE CONTROLS ──
function runCombinedFilters() {
  const projSelect = document.getElementById('filterProjectSelect');
  if (projSelect) activeFilters.projectName = projSelect.value || 'ALL';

  currentDashboardRows = currentPermRows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => matchesDashboardFilters(row));
  const matchedRows = currentDashboardRows.map(({ row }) => row);
  renderMetrics(getSummaryFromPermanentRows(matchedRows));
  updateFilterCardsView(matchedRows);
  renderProjectFilteredTable(currentDashboardRows);

  const summaryCounter = document.getElementById('summaryRowCount');
  if (summaryCounter) {
    summaryCounter.textContent = hasActiveDashboardFilter()
      ? `${matchedRows.length} matching module row(s)`
      : 'Choose a filter to view results';
  }
}

function hasActiveDashboardFilter() {
  return activeFilters.projectName !== 'ALL' ||
    moduleFilterActive ||
    Boolean(activeFilters.timeline);
}

// ── PRINT OUT THE CLEAN CONSOLIDATED FILTER CARDS GRID ──
// ── UPDATED COMPONENT: Dynamically lists matched module strings and aligns parameters ──
function updateFilterCardsView(filteredRows) {
  const listContainer = document.getElementById('summaryProjectList');
  if (!listContainer) return;

  if (!hasActiveDashboardFilter()) {
    listContainer.innerHTML = '<div class="summary-empty-state">Select a project, choose one or more modules, or select a month and year to view status cards.</div>';
    return;
  }

  if (!filteredRows.length) {
    listContainer.innerHTML = '<div class="summary-empty-state">No projects or status data found for the selected filters.</div>';
    return;
  }

  const groups = new Map();
  filteredRows.forEach(row => {
    const key = String(row.projectName || '').trim().toUpperCase();
    if (!groups.has(key)) {
      groups.set(key, {
        displayName: row.projectName || 'Unnamed Project',
        rows: []
      });
    }
    groups.get(key).rows.push(row);
  });

  listContainer.innerHTML = [...groups.values()].map(projGroup => {
    const pRows = projGroup.rows;
    const activeModuleNames = [...new Set(pRows.filter(r => r.moduleName).map(r => String(r.moduleName).trim()))].filter(Boolean);

    let modulesListDisplayString = "";
    if (activeModuleNames.length > 0) {
      modulesListDisplayString = ` (${activeModuleNames.join(', ')})`;
    }

    const moduleCount = pRows.filter(r => r.moduleName).length;
    const dvcYes = pRows.filter(r => r.dvcReview === 'Yes').length;
    const dvcNo = pRows.filter(r => r.dvcReview === 'No').length;
    const tcYes = pRows.filter(r => r.tcRelease === 'Yes').length;
    const tcNo = pRows.filter(r => r.tcRelease === 'No').length;
    const completion = moduleCount ? Math.round(((dvcYes + tcYes) / (moduleCount * 2)) * 100) : 0;

    return `
      <article class="summary-project-card full-width-card-override">
        <div class="summary-project-top">
          <div>
            <h3>${escapeHtml(projGroup.displayName)}</h3>
          </div>
          <strong>${completion}%</strong>
        </div>
        <div class="summary-progress"><span style="width:${completion}%"></span></div>
        <div class="summary-project-stats aligned-rows-grid">
          <div class="stat-row full-width-stat">
            Modules matched : <strong>${moduleCount}${escapeHtml(modulesListDisplayString)}</strong>
          </div>
          <div class="stat-row split-stat-pair">
            <span>DVC Review - Yes : <strong>${dvcYes}</strong></span>
            <span>DVC Review - No : <strong>${dvcNo}</strong></span>
          </div>
          <div class="stat-row split-stat-pair">
            <span>TC Release - Yes : <strong>${tcYes}</strong></span>
            <span>TC Release - No : <strong>${tcNo}</strong></span>
          </div>
        </div>
      </article>
    `;
  }).join('');
}


// ── FULL RESET TRIGGER ROUTINE ──
function resetDashboardFilters() {
  document.getElementById('filterProjectSelect').value = 'ALL';
  activeFilters.projectName = 'ALL';
  availableModuleNames = new Map(allModuleNames);
  activeFilters.selectedModules.clear();
  moduleFilterActive = false;
  
  // FIXED FOR OFFLINE MONTH INPUT: Clears the native calendar date picker text box field cleanly
  const timelineInput = document.getElementById('filterTimelineInput');
  if (timelineInput) {
    timelineInput.value = '';
    timelineInput.type = 'text';
  }
  activeFilters.timeline = '';
  
  updateModuleFilterOptions();
  runCombinedFilters();
}

// ── Storage ──
function loadAll() {
  return window.trackerStore.entries;
}

function loadPermanentRows() {
  return window.trackerStore.modules;
}

// ── Build rows from live entries (for metrics/project stats) ──
function buildRows(entries) {
  return entries.flatMap((entry, entryIdx) => {
    const modules = entry.modules && entry.modules.length ? entry.modules : [];
    return modules.map((module, moduleIdx) => ({
      entryNum: entryIdx + 1,
      moduleNum: moduleIdx + 1,
      projectName: entry.projectName || '',
      moduleName: module.moduleName || '',
      fwDocs: module.fwDocs || '',
      moduleNumber: module.moduleNumber || '',
      authoNum: module.authoNum || buildAuthoNum(module.authoNumSuffix || ''),
      dvcReview: module.dvcReview || '',
      version: module.version || '',
      review: module.review || '',
      dateOfTesting: module.dateOfTesting || '',
      tcRelease: module.tcRelease || '',
      checkSum: module.checkSum || '',
      size: module.size || module.Size || ''
    }));
  });
}

function getSummary(entries) {
  const validEntries = entries.filter(Boolean);
  
  // Group unique projects by uppercase keys to ignore casing variations
  const projectMap = new Map();
  validEntries.forEach(e => {
    if (!e.projectName) return;
    const key = e.projectName.trim().toUpperCase();
    if (!projectMap.has(key)) {
      // Retain the first variant encountered as the official display title
      projectMap.set(key, e.projectName.trim()); 
    }
  });
  
  const projects = [...projectMap.values()];
  const rows = buildRows(validEntries);

  const perProject = projects.map(displayName => {
    const targetKey = displayName.toUpperCase();
    
    // Filter matching rows regardless of raw input string casing adjustments
    const projectRows = rows.filter(row => String(row.projectName || '').trim().toUpperCase() === targetKey);
    const dvcYes = projectRows.filter(row => row.dvcReview === 'Yes').length;
    const tcYes = projectRows.filter(row => row.tcRelease === 'Yes').length;
    const moduleCount = projectRows.filter(row => row.moduleName).length;
    
    return {
      projectName: displayName, 
      modules: moduleCount,
      dvcYes,
      dvcNo: projectRows.filter(row => row.dvcReview === 'No').length,
      tcYes,
      tcNo: projectRows.filter(row => row.tcRelease === 'No').length,
      completion: moduleCount ? Math.round(((dvcYes + tcYes) / (moduleCount * 2)) * 100) : 0
    };
  });

  return {
    totalProjects: projects.length,
    totalModules: rows.filter(row => row.moduleName).length,
    dvcYes: rows.filter(row => row.dvcReview === 'Yes').length,
    dvcNo: rows.filter(row => row.dvcReview === 'No').length,
    tcYes: rows.filter(row => row.tcRelease === 'Yes').length,
    tcNo: rows.filter(row => row.tcRelease === 'No').length,
    perProject,
    rows
  };
}


// ── Toggle collapsible module details ──
function toggleModuleDetails() {
  const panel = document.getElementById('moduleDetailsPanel');
  const chevron = document.getElementById('moduleDetailsChevron');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}
// Computes total metrics directly from the permanent rows database array
function getSummaryFromPermanentRows(rows) {
  if (!rows || !rows.length) {
    return { totalProjects: 0, totalModules: 0, dvcYes: 0, dvcNo: 0, tcYes: 0, tcNo: 0 };
  }

  const validRows = rows.filter(r => r && r.moduleName);
  const projectSet = new Set();
  
  validRows.forEach(r => {
    if (r.projectName) projectSet.add(String(r.projectName).trim().toLowerCase());
  });

  return {
    totalProjects: projectSet.size,
    totalModules: validRows.length,
    dvcYes: validRows.filter(r => r.dvcReview === 'Yes').length,
    dvcNo: validRows.filter(r => r.dvcReview === 'No').length,
    tcYes: validRows.filter(r => r.tcRelease === 'Yes').length,
    tcNo: validRows.filter(r => r.tcRelease === 'No').length
  };
}



// ── Render ──
function renderSummary() {
  currentPermRows = loadPermanentRows();
  
  // Instantly process calculations for the top cards view
  const summary = getSummaryFromPermanentRows(currentPermRows);
  renderMetrics(summary);
  
  // Seed the dropdown controls securely using the complete master array
  initFilterControlsData(currentPermRows);
  
  // Fire decoupled panel rendering actions simultaneously
  runCombinedFilters();   // Strictly handles middle progress cards viewports
  renderFilteredTable();  // Strictly handles lower data grid rows viewports
}

// ── Search bar: filter currentPermRows by any field, then render ──
function filterModuleTable() {
  const input = document.getElementById('moduleSearchInput');
  moduleSearchText = (input ? input.value : '').trim().toLowerCase();
  const clearBtn = document.getElementById('moduleSearchClear');
  if (clearBtn) clearBtn.classList.toggle('show', !!moduleSearchText);
  renderFilteredTable();
}

function clearModuleSearch() {
  const input = document.getElementById('moduleSearchInput');
  if (input) input.value = '';
  moduleSearchText = '';
  const clearBtn = document.getElementById('moduleSearchClear');
  if (clearBtn) clearBtn.classList.remove('show');
  renderFilteredTable();
}

function getFilteredModuleRows() {
  return currentPermRows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => {
      if (!row) return false;
      return !moduleSearchText || [
        row.projectName, row.moduleName, row.fwDocs, row.moduleNumber, 
        row.authoNum, row.dvcReview, row.version, row.review, 
        row.dateOfTesting, row.tcRelease, row.checkSum, row.size
      ].some(field => String(field || '').toLowerCase().includes(moduleSearchText));
    });
}


function renderFilteredTable() {
  const rowsToDraw = getFilteredModuleRows();
  
  renderTable(rowsToDraw, 'summaryTableBody', 'No module details available.');

  const rowCountText = rowsToDraw.length
    ? `${rowsToDraw.length} module row(s) listed below`
    : moduleSearchText
      ? 'No module rows match your search.'
      : 'No module details available.';
  const rowCounter = document.getElementById('summaryDetailRowCount');
  if (rowCounter) rowCounter.textContent = rowCountText;
  
  updateSelectedCount();
  syncSelectAllCheckbox();
}

function renderProjectFilteredTable(rows) {
  const section = document.getElementById('projectFilteredDetails');
  if (!document.getElementById('projectFilteredDetailsList')) return;

  const hasActiveFilter = hasActiveDashboardFilter();
  if (section) section.hidden = !hasActiveFilter;
  if (!hasActiveFilter) {
    syncSelectAllCheckbox();
    return;
  }

  renderTable(
    rows,
    'projectFilteredDetailsList',
    'No module rows match the selected dashboard filters.'
  );
  syncSelectAllCheckbox();
}
function renderMetrics(summary) {
  const dataPayload = summary || { totalProjects: 0, totalModules: 0, dvcYes: 0, dvcNo: 0, tcYes: 0, tcNo: 0 };

  // Target numbers directly by their element IDs
  const elProjects = document.getElementById('metricTotalProjects');
  const elModules = document.getElementById('metricTotalModules');
  const elDvc = document.getElementById('metricDvcReviewed');
  const elDvcSub = document.getElementById('metricDvcSubtext');
  const elTc = document.getElementById('metricTcReleased');
  const elTcSub = document.getElementById('metricTcSubtext');

  // Update text node content fields securely without breaking container layouts
  if (elProjects) elProjects.textContent = dataPayload.totalProjects || 0;
  if (elModules)  elModules.textContent  = dataPayload.totalModules || 0;
  if (elDvc)      elDvc.textContent      = dataPayload.dvcYes || 0;
  if (elTc)       elTc.textContent       = dataPayload.tcYes || 0;

  // Dynamically update subtext descriptions
  if (elDvcSub) elDvcSub.textContent = (dataPayload.dvcNo || 0) + ' pending / no';
  if (elTcSub)  elTcSub.textContent  = (dataPayload.tcNo || 0) + ' pending / no';
}




function renderProjects(summary) {
  const list = document.getElementById('summaryProjectList');
  if (!summary.perProject.length) {
    list.innerHTML = '<div class="summary-empty-state">No saved projects yet. Open the Tracker, add a project, and click Save Records.</div>';
    return;
  }

  list.innerHTML = summary.perProject.map(project => `
    <article class="summary-project-card">
      <div class="summary-project-top">
        <div>
          <h3>${escapeHtml(project.projectName)}</h3>
        </div>
        <strong>${project.completion}%</strong>
      </div>
      <div class="summary-progress"><span style="width:${project.completion}%"></span></div>
      <div class="summary-project-stats">
        <span> Modules : <strong>${project.modules}</strong> </span>
        <span> DVC Review - Yes : <strong>${project.dvcYes}</strong></span>
        <span> DVC Review - No : <strong>${project.dvcNo}</strong></span>
        <span> TC Release - Yes : <strong>${project.tcYes}</strong></span>
        <span> TC Release - No : <strong>${project.tcNo}</strong></span>
      </div>
    </article>
  `).join('');
}

function renderTable(entries, bodyId, emptyMessage) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!entries.length) {
    const colspan = 13;
    const msg = moduleSearchText && bodyId === 'summaryTableBody'
      ? 'No module rows match your search.'
      : emptyMessage;
    body.innerHTML = `<tr><td colspan="${colspan}">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  body.innerHTML = entries.map(({ row, idx }) => `
    <tr class="${selectedModuleRows.has(idx) ? 'row-selected' : ''}">
      <td class="summary-select-col">
        <input type="checkbox" data-idx="${idx}" ${selectedModuleRows.has(idx) ? 'checked' : ''} onchange="toggleRowSelection(${idx}, this.checked)"/>
      </td>
      <td>${escapeHtml(row.projectName)}</td>
      <td>${escapeHtml(row.moduleName)}</td>
      <td>${escapeHtml(row.fwDocs)}</td>
      <td>${escapeHtml(row.moduleNumber)}</td>
      <td>${escapeHtml(row.authoNum)}</td>
      <td>${statusPill(row.dvcReview)}</td>
      <td>${escapeHtml(row.version)}</td>
      <td>${escapeHtml(row.review)}</td>
      <td>${escapeHtml(row.dateOfTesting)}</td>
      <td>${statusPill(row.tcRelease)}</td>
      <td>${escapeHtml(row.checkSum)}</td>
      <td>${escapeHtml(row.size)}</td>
    </tr>
  `).join('');
}

// ── Manual row selection (checkbox per row) ──
function toggleRowSelection(idx, checked) {
  if (checked) selectedModuleRows.add(idx);
  else selectedModuleRows.delete(idx);
  updateSelectedCount();
  syncSelectAllCheckbox();
  for (const bodyId of ['summaryTableBody', 'projectFilteredDetailsList']) {
    const cb = document.querySelector(`#${bodyId} input[data-idx="${idx}"]`);
    const row = cb ? cb.closest('tr') : null;
    if (cb) cb.checked = checked;
    if (row) row.classList.toggle('row-selected', checked);
  }
}

function toggleSelectAllRows(checkbox, scope = 'all') {
  const visible = scope === 'project' ? currentDashboardRows : getFilteredModuleRows();
  if (checkbox.checked) visible.forEach(({ idx }) => selectedModuleRows.add(idx));
  else visible.forEach(({ idx }) => selectedModuleRows.delete(idx));
  renderFilteredTable();
  renderProjectFilteredTable(currentDashboardRows);
}

function syncSelectAllCheckbox() {
  const checkboxes = [
    { id: 'selectAllRowsCheckbox', rows: getFilteredModuleRows() },
    { id: 'selectAllProjectRowsCheckbox', rows: currentDashboardRows }
  ];
  checkboxes.forEach(({ id, rows }) => {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;
    const allSelected = rows.length > 0 && rows.every(({ idx }) => selectedModuleRows.has(idx));
    checkbox.checked = allSelected;
    checkbox.indeterminate = !allSelected && rows.some(({ idx }) => selectedModuleRows.has(idx));
  });
}

function updateSelectedCount() {
  const el = document.getElementById('selectedRowCount');
  if (el) el.textContent = selectedModuleRows.size;
}

// ── Export only the manually selected module rows to Excel ──
function exportSelectedModuleRows() {
  if (!selectedModuleRows.size) {
    showSummaryToast('Select at least one row (checkbox) to export.');
    return;
  }
  const rows = [...selectedModuleRows]
    .sort((a, b) => a - b)
    .map(idx => currentPermRows[idx])
    .filter(Boolean);

  if (!rows.length) {
    showSummaryToast('Selected rows could not be found. Try reselecting.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const sheetData = [
    ['Project Name', 'Module Name', 'FW Docs', 'Module Number', 'I-AUTHO-NUM', 'DVC Review', 'Version', 'Date of Review', 'Date of Testing', 'TC Release', 'CheckSum', 'Size'],
    ...rows.map(row => [
      row.projectName, row.moduleName, row.fwDocs, row.moduleNumber, row.authoNum, row.dvcReview,
      row.version, row.review, row.dateOfTesting, row.tcRelease, row.checkSum, row.size
    ])
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [24, 28, 12, 14, 18, 12, 12, 16, 16, 12].map(wch => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheetData.length - 1, c: 11 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'Selected Module Rows');
  XLSX.writeFile(wb, 'TW_Status_Tracker_Selected_Modules.xlsx');
  showSummaryToast('Downloaded ' + rows.length + ' selected row(s).');
}

function statusPill(value) {
  const text = value || '-';
  const tone = value === 'Yes' ? 'yes' : value === 'No' ? 'no' : 'blank';
  return `<span class="summary-pill ${tone}">${escapeHtml(text)}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Toast ──
function showSummaryToast(msg) {
  const t = document.getElementById('summaryToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3400);
}

// ── Import on Summary page ──
// ── FIND THIS BLOCK IN YOUR FILE ──
function handleSummaryImport(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (event) {
    try {
      const wb = XLSX.read(event.target.result, { type: 'array', cellDates: true });
      const importedEntries = importWorkbookToEntries(wb);
      if (!importedEntries.length) {
        showSummaryToast('No project rows found. Check the Excel column headers.');
        return;
      }

      // ── CHANGE EVERYTHING FROM HERE DOWN TO THE CATCH BLOCK ──
      
      const currentActiveWorkspace = loadAll().map(entry => ({
        ...entry,
        modules: [...(entry.modules || [])]
      }));

      // 2. Loop and merge rows into their matching project slots case-insensitively
      importedEntries.forEach(newEntry => {
        const targetName = String(newEntry.projectName || '').trim().toUpperCase();
        
        const existingProjectMatch = currentActiveWorkspace.find(
          oldEntry => String(oldEntry.projectName || '').trim().toUpperCase() === targetName
        );

        if (existingProjectMatch) {
          if (!existingProjectMatch.modules) existingProjectMatch.modules = [];
          
          newEntry.modules.forEach(newMod => {
            const isDuplicate = existingProjectMatch.modules.some(
              oldMod => String(oldMod.moduleName).trim().toLowerCase() === String(newMod.moduleName).trim().toLowerCase()
            );
            if (!isDuplicate) {
              existingProjectMatch.modules.push(newMod);
            }
          });
        } else {
          currentActiveWorkspace.push(newEntry);
        }
      });

      // 3. Save the merged workspace back and refresh viewports
      await window.trackerStore.saveEntries(currentActiveWorkspace);
      
      renderSummary();
      showSummaryToast('Imported and merged ' + importedEntries.length + ' project(s) cleanly.');

    } catch (err) {
      console.error(err);
      showSummaryToast('Could not import this file. Please check the format.');
    } finally {
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}


// ── Import helpers (shared logic, same as script.js) ──
function importWorkbookToEntries(wb) {
  for (const sheetName of getImportSheetOrder(wb)) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    const parsed = sheetRowsToEntries(rows);
    if (parsed.length) return parsed;
  }
  return [];
}

function getImportSheetOrder(wb) {
  const preferred = ['All Project Details', 'Project Details', 'Details'];
  const names = wb.SheetNames || [];
  return [
    ...preferred.filter(name => names.includes(name)),
    ...names.filter(name => !preferred.includes(name) && name !== 'Summary')
  ];
}

function sheetRowsToEntries(rows) {
  const headerInfo = findImportHeader(rows);
  if (!headerInfo) return [];

  const { headerRowIndex, map } = headerInfo;
  const groups = new Map();
  let lastProjectName = '';
  let lastEntryNum = '';

  rows.slice(headerRowIndex + 1).forEach((row) => {
    const rawProject = importCell(row, map.projectName);
    const rawEntry = importCell(row, map.entryNum);
    const projectName = rawProject || lastProjectName;
    
    // CHANGE HERE: If entryNum is empty, default it to the project name instead of a number!
    const entryNum = rawEntry || lastEntryNum || projectName || String(groups.size + 1);
    const moduleName = importCell(row, map.moduleName);

    if (!projectName && !moduleName) return;
    lastProjectName = projectName || lastProjectName;
    lastEntryNum = entryNum || lastEntryNum;

    // We group by the Project Name directly now
    const groupKey = projectName; 
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        // CHANGE HERE: Assign the project name string directly to the entry's primary identification
        entryNum: projectName || String(groups.size + 1), 
        projectName,
        modules: []
      });
    }

    const importedAuthoNum = importCell(row, map.authoNum);
    groups.get(groupKey).modules.push({
      rowNum: Number(importCell(row, map.moduleNum)) || groups.get(groupKey).modules.length + 1,
      moduleName,
      fwDocs: importCell(row, map.fwDocs),
      moduleNumber: importCell(row, map.moduleNumber),
      authoNumSuffix: importedAuthoNum.slice(-5).replace(/\D/g, ''),
      authoNum: importedAuthoNum,
      dvcReview: normalizeChoice(importCell(row, map.dvcReview)),
      version: importCell(row, map.version),
      review: importDateCell(row, map.review),
      dateOfTesting: importDateCell(row, map.dateOfTesting),
      tcRelease: normalizeChoice(importCell(row, map.tcRelease)),
      checkSum: importCell(row, map.checkSum), 
      size: importCell(row, map.size)
    });
  });

  return [...groups.values()]
    // Sort cleanly by project name strings alphabetically
    .sort((a, b) => String(a.projectName).localeCompare(String(b.projectName)))
    .map(group => ({
      projectName: group.projectName,
      modules: group.modules
        .sort((a, b) => a.rowNum - b.rowNum)
        .map(({ rowNum, ...module }) => module)
    }));
}


function findImportHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const normalized = rows[r].map(normalizeHeader);
    const map = {
      entryNum: findHeaderIndex(normalized, ['entryno', 'entrynum', 'entry', 'index']),
      moduleNum: findHeaderIndex(normalized, ['rowno', 'rownum', 'moduleno', 'srno']),
      
      // FIX HERE: Added 'project' and 'projectname' variants to the validation matcher array
      projectName: findHeaderIndex(normalized, ['projectname', 'project', 'projectid', 'projectname']),
      
      moduleName: findHeaderIndex(normalized, ['modulename', 'module', 'modules']),
      fwDocs: findHeaderIndex(normalized, ['fwdocs', 'fwdoc', 'fwdocument']),
      moduleNumber: findHeaderIndex(normalized, ['modulenumber', 'modelnumber', 'modulenum']),
      authoNum: findHeaderIndex(normalized, ['iauthonum', 'authonum', 'iauthonumber']),
      dvcReview: findHeaderIndex(normalized, ['dvcreview', 'dvcreviewstatus', 'dvcstatus']),
      version: findHeaderIndex(normalized, ['version', 'versions']),
      review: findHeaderIndex(normalized, ['dateofreview', 'reviewdate', 'review']),
      dateOfTesting: findHeaderIndex(normalized, ['dateoftesting', 'testingdate', 'testdate']),
      tcRelease: findHeaderIndex(normalized, ['tcrelease', 'tcreleasestatus', 'tcstatus']),
      checkSum: findHeaderIndex(normalized, ['checksum', 'md5', 'hash']), 
      size: findHeaderIndex(normalized, ['size', 'filesize', 'bytes'])
    };
    if (map.projectName > -1 && map.moduleName > -1) return { headerRowIndex: r, map };
  }
  return null;
}


function findHeaderIndex(headers, names) {
  return headers.findIndex(h => names.includes(h));
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function importCell(row, index) {
  if (index === undefined || index < 0) return '';
  const value = row[index];
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  return String(value).trim();
}

function importDateCell(row, index) {
  if (index === undefined || index < 0) return '';
  const value = row[index];
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'number' && XLSX.SSF && XLSX.SSF.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return pad2(parsed.d) + '/' + pad2(parsed.m) + '/' + parsed.y;
  }
  return importCell(row, index);
}

function formatDate(date) {
  return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
}

function pad2(v) { return String(v).padStart(2, '0'); }

function normalizeChoice(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(text)) return 'Yes';
  if (['no', 'n', 'false', '0'].includes(text)) return 'No';

  return value || '';
}

window.trackerStore.initialize().then(ready => {
  if (!ready) return;
  renderSummary();
  if (window.trackerStore.user && window.trackerStore.user.is_admin) {
    document.getElementById('userAdminPanel').hidden = false;
    renderAdminUsers();
  }
});

async function renderAdminUsers() {
  const body = document.getElementById('userAdminTableBody');
  if (!body) return;
  const count = document.getElementById('userAdminCount');
  body.innerHTML = '<tr><td colspan="4" class="user-admin-feedback">Loading accounts…</td></tr>';
  try {
    const result = await window.trackerStore.request('/api/users');
    if (count) count.textContent = `${result.users.length} account${result.users.length === 1 ? '' : 's'}`;
    if (!result.users.length) {
      body.innerHTML = '<tr><td colspan="4" class="user-admin-feedback">No accounts found.</td></tr>';
      return;
    }
    body.innerHTML = result.users.map(user => `
      <tr>
        <td class="user-admin-name">${escapeHtml(user.username)}</td>
        <td><span class="user-admin-badge ${user.is_admin ? 'is-admin' : ''}">${user.is_admin ? 'Administrator' : 'User'}</span></td>
        <td><span class="user-admin-badge ${user.is_active ? 'is-active' : 'is-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="user-admin-action-cell">
          <div class="user-admin-actions">
          <button type="button" class="btn-summary-action user-admin-button ${user.is_active ? 'is-danger' : 'is-positive'}"
            onclick="adminSetUser(${user.id}, ${!user.is_active}, ${user.is_admin})">
            ${user.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button type="button" class="btn-summary-action user-admin-button"
            onclick="adminSetUser(${user.id}, ${user.is_active}, ${!user.is_admin})">
            ${user.is_admin ? 'Remove admin' : 'Make admin'}
          </button>
          <button type="button" class="btn-summary-action user-admin-button"
            onclick="adminResetPassword(${user.id})">Reset password</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    if (count) count.textContent = 'Accounts unavailable';
    body.innerHTML = '<tr><td colspan="4" class="user-admin-feedback">Could not load accounts. Please try again.</td></tr>';
    showSummaryToast('Could not load user accounts: ' + error.message);
  }
}

async function adminCreateUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  const is_admin = document.getElementById('userAdminRole').checked;
  try {
    await window.trackerStore.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, is_admin })
    });
    form.reset();
    await renderAdminUsers();
    showSummaryToast('Account created.');
  } catch (error) {
    showSummaryToast('Could not create account: ' + error.message);
  }
}

async function adminSetUser(id, is_active, is_admin) {
  try {
    await window.trackerStore.request('/api/users/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ is_active, is_admin })
    });
    await renderAdminUsers();
    showSummaryToast('Account updated.');
  } catch (error) {
    showSummaryToast('Could not update account: ' + error.message);
  }
}

async function adminResetPassword(id) {
  const password = window.prompt('Enter a new password with at least 8 characters.');
  if (password === null) return;
  if (password.length < 8) {
    showSummaryToast('Password must contain at least 8 characters.');
    return;
  }
  try {
    await window.trackerStore.request('/api/users/' + id + '/password', {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    showSummaryToast('Password reset. Existing sessions for that user have been signed out.');
  } catch (error) {
    showSummaryToast('Could not reset password: ' + error.message);
  }
}

async function doLogout() {
  try {
    await window.trackerStore.logout();
  } catch (error) {
    showSummaryToast('Could not safely sign out: ' + error.message);
  }
}
