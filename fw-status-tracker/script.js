let rowSeq = 0; /* unique id seq for module rows across all entries */

/* ── I-AUTHO-NUM: fixed 11-zero prefix + 5 manually entered digits = 16 chars total ── */
const AUTHO_PREFIX = '00000000000'; /* 11 zeros */
function buildAuthoNum(suffix) {
  const digits = String(suffix || '').replace(/\D/g, '').slice(0, 5);
  return digits ? AUTHO_PREFIX + digits.padStart(5, '0') : '';
}

/* The server owns persistent records; this is the initialized shared workspace. */
function loadAll() { return window.trackerStore.entries; }
async function saveAll(d) {
  await window.trackerStore.saveEntries(d);
  if (typeof renderDashboard === 'function') renderDashboard();
}

/* ── Suggestion data ── */
function getSavedProjects() {
  return [...new Set(loadAll().map(r => r.projectName).filter(Boolean))];
}
function getSavedVersions(project) {
  const src = project ? loadAll().filter(r => r.projectName === project) : loadAll();
  const names = [];
  src.forEach(r => (r.modules || []).forEach(m => { if (m.version) names.push(m.version); }));
  return [...new Set(names)];
}
function getSavedModules(project) {
  const src = project ? loadAll().filter(r => r.projectName === project) : loadAll();
  const names = [];
  src.forEach(r => (r.modules || []).forEach(m => { if (m.moduleName) names.push(m.moduleName); }));
  return [...new Set(names)];
}

function getProjectNames(entries = loadAll()) {
  return [...new Set(entries.map(r => (r.projectName || '').trim()).filter(Boolean))];
}

function getSummary(entries = loadAll()) {
  const validEntries = entries.filter(Boolean);
  
  // Group uniquely via an uppercase map lookup engine
  const projectMap = new Map();
  validEntries.forEach(e => {
    if (!e.projectName) return;
    const key = e.projectName.trim().toUpperCase();
    if (!projectMap.has(key)) {
      projectMap.set(key, e.projectName.trim());
    }
  });

  const projects = [...projectMap.values()];
  const rows = buildAllProjectRows(validEntries);
  
  const perProject = projects.map(displayName => {
    const targetKey = displayName.toUpperCase();
    const projectRows = rows.filter(row => String(row.projectName || '').trim().toUpperCase() === targetKey);
    return {
      projectName: displayName,
      entries: validEntries.filter(entry => String(entry.projectName || '').trim().toUpperCase() === targetKey).length,
      modules: projectRows.filter(row => row.moduleName).length,
      dvcYes: projectRows.filter(row => row.dvcReview === 'Yes').length,
      tcYes: projectRows.filter(row => row.tcRelease === 'Yes').length
    };
  });

  return {
    totalProjects: projects.length,
    totalEntries: validEntries.length,
    totalModules: rows.filter(row => row.moduleName).length,
    dvcYes: rows.filter(row => row.dvcReview === 'Yes').length,
    dvcNo: rows.filter(row => row.dvcReview === 'No').length,
    tcYes: rows.filter(row => row.tcRelease === 'Yes').length,
    tcNo: rows.filter(row => row.tcRelease === 'No').length,
    perProject
  };
}


function renderDashboard() {
  // (Project Wise Status section removed — nothing to render here now)
}

/* ── Calendar icon SVG ── */
const CAL_ICON = `<svg class="cal-icon" width="15" height="15" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;

/* ── Renumber all "Entry N" labels and delete-button visibility to match current DOM order ── */
/* Replacingexisting renumberEntries() function with this updated version: */
function renumberEntries() {
  const cards = [...document.querySelectorAll('.entry-card')];
  cards.forEach((card, idx) => {
    const n = idx + 1;
    card.dataset.eid = n;

    // CHANGE HERE: Locate the project name text field in the current card wrapper
    const projInput = card.querySelector('[name="projectName"]');
    const label = card.querySelector('.entry-label');

    if (label) {
      // If the field contains text, use it as the title! Otherwise, print "Entry N"
      label.textContent = (projInput && projInput.value.trim()) ? 'Project: ' + projInput.value.trim().toUpperCase() : 'Entry ' + n;

    }

    const delBtn = card.querySelector('.btn-delete-entry');
    if (delBtn) delBtn.style.display = 'inline-flex';
  });
}


function moduleRowHtml(rid, data = {}) {
  // Parse existing size values like "24 KB" or "1.5 MB" if loading existing data
  let sizeVal = '';
  let sizeUnit = 'KB';
  //  CORRECTED VISUAL DATA MAPPING:
if (data.size) {
  const parts = String(data.size).trim().split(/\s+/);
  sizeVal = parts[0] || ''; // Extracts the value string cleanly
  if (parts[1]) {
    const u = parts[1].toUpperCase();
    if (['KB', 'MB', 'GB'].includes(u)) sizeUnit = u;
  }
}


  return `
        <div class="card-line3">
          <div class="fgroup">
            <div class="flabel">Module Name</div>
            <div class="mod-wrap">
              <input type="text" name="moduleName"
                placeholder="e.g. User Login"
                value="${escHtml(data.moduleName || '')}"
                autocomplete="off"
                oninput="onModInput(this)"
                onblur="closeModSugg(this)"/>
              <div class="mod-sugg"></div>
            </div>
          </div>
  
          <div class="fgroup">
            <div class="flabel">FW Document</div>
            ${makeSelect('fwDocs', ['', 'FRS', 'FIRS', 'FDD'], data.fwDocs || '')}
          </div>
  
          <div class="fgroup">
            <div class="flabel">Module Number</div>
            <input type="text" name="moduleNumber"
              placeholder="e.g. 1024"
              inputmode="numeric"
              value="${escHtml(data.moduleNumber || '')}"
              autocomplete="off"
              oninput="onModuleNumberInput(this)"/>
          </div>
  
          <div class="fgroup">
            <div class="flabel">I-AUTH-NUM</div>
            <div class="autho-wrap">
              <span class="autho-prefix">${AUTHO_PREFIX}</span>
              <input type="text" class="autho-suffix" name="authoNumSuffix"
                placeholder="12345"
                maxlength="5"
                inputmode="numeric"
                value="${escHtml(data.authoNumSuffix || '')}"
                autocomplete="off"
                oninput="onAuthoNumInput(this)"/>
            </div>
            <div class="autho-preview">${escHtml(buildAuthoNum(data.authoNumSuffix || '') || '—')}</div>
          </div>
  
          <div class="fgroup">
            <div class="flabel">DVC Review Status</div>
            ${makeSelect('dvcReview', ['', 'Yes', 'No'], data.dvcReview || '')}
          </div>
  
          <div class="fgroup">
            <div class="flabel">Version</div>
            <div class="ver-wrap">
              <input type="text" name="version"
                placeholder="e.g. v1.2"
                value="${escHtml(data.version || '')}"
                autocomplete="off"
                oninput="onVerInput(this)"
                onblur="closeVerSugg(this)"/>
              <div class="ver-sugg"></div>
            </div>
          </div>
  
          <div class="fgroup">
            <div class="flabel">Date of Review</div>
            <div class="date-wrap">
              <input class="date-inp" type="text" name="review"
                placeholder="DD/MM/YYYY"
                value="${escHtml(data.review || '')}"
                autocomplete="off" readonly/>
              ${CAL_ICON}
            </div>
          </div>
  
          <div class="fgroup">
            <div class="flabel">Date of Testing</div>
            <div class="date-wrap">
              <input class="date-inp" type="text" name="dateOfTesting"
                placeholder="DD/MM/YYYY"
                value="${escHtml(data.dateOfTesting || '')}"
                autocomplete="off" readonly/>
              ${CAL_ICON}
            </div>
          </div>
          
          <div class="fgroup">
            <div class="flabel">TC Release</div>
            ${makeSelect('tcRelease', ['', 'Yes', 'No'], data.tcRelease || '')}
          </div>
  
          <div class="fgroup">
            <div class="flabel">CheckSum</div>
            <input type="text" name="checkSum"
              placeholder="e.g. d41d8cd98f or NA"
              value="${escHtml(data.checkSum || '')}"
              autocomplete="off"/>
          </div>
  
          <div class="fgroup">
            <div class="flabel">Size</div>
            <div style="display: flex; gap: 4px; width: 100%;">
              <!-- CHANGED FROM type="number" TO type="text" TO ACCEPT Text Strings Like NA or N/A -->
              <input type="text" name="sizeValue"
                placeholder="e.g. 24 or NA"
                value="${escHtml(sizeVal)}"
                style="flex: 1;"
                autocomplete="off"/>
              <select name="sizeUnit" style="width: 75px; padding: 4px;">
                <option value="KB" ${sizeUnit === 'KB' ? 'selected' : ''}>KB</option>
                <option value="MB" ${sizeUnit === 'MB' ? 'selected' : ''}>MB</option>
                <option value="GB" ${sizeUnit === 'GB' ? 'selected' : ''}>GB</option>
              </select>
            </div>
          </div>
      </div>
    `;
}


/* ── Init pickers for a module row ── */
function initRowPickers(rowWrap) {
  const reviewInp = rowWrap.querySelector('[name="review"]');
  flatpickr(reviewInp, {
    dateFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    defaultDate: reviewInp.value || null,
    onChange: function (selectedDates, dateStr) { reviewInp.value = dateStr; }
  });

  const testInp = rowWrap.querySelector('[name="dateOfTesting"]');
  flatpickr(testInp, {
    dateFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    defaultDate: testInp.value || null,
    onChange: function (selectedDates, dateStr) { testInp.value = dateStr; }
  });
}

/* ── Add a module row to an entry card ── */
function addModuleRow(card, data = {}) {
  rowSeq++;
  const rid = rowSeq;
  const wrap = document.createElement('div');
  wrap.className = 'module-row-wrap';
  wrap.dataset.rid = rid;

  const removeBtn = `
      <button class="btn-remove-row" type="button" title="Remove module row" onclick="removeModuleRow(this)">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </button>`;

  wrap.innerHTML = moduleRowHtml(rid, data);
  wrap.insertAdjacentHTML('beforeend', removeBtn);

  card.querySelector('.module-rows').appendChild(wrap);
  initRowPickers(wrap);
  toggleRemoveButtons(card);
  return wrap;
}


function removeModuleRow(btn) {
  const wrap = btn.closest('.module-row-wrap');
  const card = wrap.closest('.entry-card');
  wrap.remove();
  toggleRemoveButtons(card);
  persistVisibleCards();
}

/* Hide the remove button when only one module row remains */
function toggleRemoveButtons(card) {
  const rows = card.querySelectorAll('.module-row-wrap');
  rows.forEach(r => {
    const btn = r.querySelector('.btn-remove-row');
    if (!btn) return;
    btn.style.display = rows.length > 1 ? 'inline-flex' : 'none';
  });
}

/* ── Add entry card ── */
function addEntry(data = {}, options = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';

  card.innerHTML = `
    <!-- LINE 1: Entry label (clickable header to collapse/expand) -->
    <div class="card-line1 entry-card-toggle" onclick="toggleEntryCard(this)">
      <span class="entry-label">Entry</span>
      <div class="entry-header-right">
        <svg class="entry-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- Collapsible body -->
    <div class="entry-card-body">
      <!-- LINE 2: Project Name (full width) -->
      <div class="card-line2">
        <div class="fgroup">
          <div class="flabel">Project Name</div>
          <div class="proj-wrap">
            <input type="text" class="proj-name-inp" name="projectName"
              placeholder="e.g. DRDO Radar System"
              value="${escHtml(data.projectName || '')}"
              autocomplete="off"
              oninput="onProjInput(this)"
              onblur="closeProjSugg(this)"/>
            <div class="proj-sugg"></div>
          </div>
        </div>
      </div>

      <!-- Module rows -->
      <div class="module-rows"></div>

      <!-- "+" add row & per-entry save, side by side -->
      <div class="entry-actions">
        <button class="btn-add-row" type="button" onclick="addModuleRow(this.closest('.entry-card'))">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
          Add Rows
        </button>
        <div class="save-group">
          <span class="saved-badge">✓ Saved</span>
          <button class="btn-save-entry" type="button" onclick="saveEntry(this.closest('.entry-card'))">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M17 21H7a4 4 0 0 1-4-4V7l4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4Z" stroke="#fff" stroke-width="1.8"/>
              <path d="M9 21v-6h6v6M9 3v4h6V3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Save
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('entriesContainer').appendChild(card);

  /* Seed module rows: at least one, from data.modules if provided */
  const seedModules = (data.modules && data.modules.length) ? data.modules : [{}];
  seedModules.forEach(m => addModuleRow(card, m));

  /* Any edit after a save hides the "Saved" badge again */
  card.addEventListener('input', () => markUnsaved(card));
  card.addEventListener('change', () => markUnsaved(card));

  renumberEntries();

  const isNewEntry = !data.projectName && options.focus !== false;
  const body = card.querySelector('.entry-card-body');
  const chevron = card.querySelector('.entry-chevron');
  if (isNewEntry) {
    body.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
    card.querySelector('[name="projectName"]').focus();
  } else {
    body.style.display = 'none';
    if (data.projectName) card.querySelector('.entry-label').textContent = data.projectName;
  }
}





function markSaved(card) {
  const badge = card.querySelector('.saved-badge');
  if (badge) badge.classList.add('show');
}
function markUnsaved(card) {
  const badge = card.querySelector('.saved-badge');
  if (badge) badge.classList.remove('show');
}

/* ── Toggle entry card expand/collapse ── */
function toggleEntryCard(header) {
  const card = header.closest('.entry-card');
  const body = card.querySelector('.entry-card-body');
  const chevron = card.querySelector('.entry-chevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

/* Reset the visible form without changing the server-saved workspace. */
function resetToBlank() {
  document.getElementById('entriesContainer').innerHTML = '';
  addEntry();
}

// ── CORRECTED CODE: Groups Multi-Row Entries Under a Single Form Card Panel ──
function renderEntries(entries) {
  const container = document.getElementById('entriesContainer');
  container.innerHTML = '';
  
  if (!entries || !entries.length) {
    addEntry(); // Opens a single clean form if storage is empty
    return;
  }

  // 1. Group all rows case-insensitively by project name first
  const unifiedGroups = new Map();
  
  entries.forEach(entry => {
    if (!entry || !entry.projectName) return;
    
    const lookupKey = entry.projectName.trim().toUpperCase();
    
    if (!unifiedGroups.has(lookupKey)) {
      // Create a single container entry group record tracking all combined modules
      unifiedGroups.set(lookupKey, {
        projectName: entry.projectName.trim(), 
        modules: []
      });
    }
    
    // Push all structural modules from this array block into the unified project record
    if (entry.modules && entry.modules.length) {
      entry.modules.forEach(mod => {
        // Prevent duplicate modules from slipping into the display cards loop
        const isDuplicate = unifiedGroups.get(lookupKey).modules.some(
          m => String(m.moduleName).trim().toLowerCase() === String(mod.moduleName).trim().toLowerCase() &&
               String(m.version).trim().toLowerCase() === String(mod.version).trim().toLowerCase()
        );
        if (!isDuplicate) {
          unifiedGroups.get(lookupKey).modules.push(mod);
        }
      });
    }
  });

  // 2. Render exactly ONE card element for each unique project name group
  if (unifiedGroups.size === 0) {
    addEntry();
  } else {
    unifiedGroups.forEach(groupedData => {
      addEntry(groupedData, { focus: false });
    });
  }
  
  // 3. Reset correct counting numbers sequentially across headings
  renumberEntries();
}


/* ── Delete entry from the workspace; archived module history is retained server-side. ── */
async function deleteEntry(btn) {
  const previous = loadAll();
  const card = btn.closest('.entry-card');
  card.remove();
  renumberEntries();
  const remaining = getSavableCardData();
  try {
    await saveAll(remaining);
    showToast('Entry removed from the workspace. Module history is retained.');
  } catch (error) {
    renderEntries(previous);
    showToast('Could not delete entry: ' + error.message);
  }
}

/* ── Select builder ── */
/* ── Module Number: numbers only ── */
function onModuleNumberInput(inp) {
  inp.value = inp.value.replace(/\D/g, '');
}

/* ── I-AUTHO-NUM: keep only 5 digits, live-preview the full 16-char value
   (11-zero prefix + the 5 digits entered here) ── */
function onAuthoNumInput(inp) {
  inp.value = inp.value.replace(/\D/g, '').slice(0, 5);
  const preview = inp.closest('.fgroup').querySelector('.autho-preview');
  if (preview) preview.textContent = buildAuthoNum(inp.value) || '—';
}

function makeSelect(name, opts, val) {
  let html = '<select name="' + name + '">';
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    const selectedAttr = (o === val) ? ' selected' : '';
    const displayLabel = o ? escHtml(o) : '— select —';
    const valueAttr = escHtml(o);

    html += '<option value="' + valueAttr + '"' + selectedAttr + '>' + displayLabel + '</option>';
  }
  html += '</select>';
  return html;
}



/* ── Project autocomplete ── */
/* ── Project autocomplete with real-time header rename updates ── */
function onProjInput(inp) {
  // 1. THIS IS THE NEW ADDITION: Find the header text and update it right away
  const card = inp.closest('.entry-card');
  const label = card.querySelector('.entry-label');
  if (label) {
    label.textContent = inp.value.trim() || 'Entry ' + card.dataset.eid;
  }

  // 2. THIS IS ORIGINAL CODE: Keeps the dropdown suggestion list working perfectly
  const val = inp.value.trim().toLowerCase();
  const sugg = inp.closest('.proj-wrap').querySelector('.proj-sugg');
  const names = getSavedProjects().filter(n => n.toLowerCase().includes(val));
  if (!names.length || !val) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
  sugg.innerHTML = names.map(n => `<div class="sugg-item" onmousedown="event.preventDefault()">${escHtml(n)}</div>`).join('');
  sugg.querySelectorAll('.sugg-item').forEach((el, i) =>
    el.addEventListener('mousedown', () => {
      inp.value = names[i];
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      sugg.style.display = 'none';
      sugg.innerHTML = '';
    })
  );
  sugg.style.display = 'block';
}

function closeProjSugg(inp) {
  setTimeout(() => {
    const sugg = inp.closest('.proj-wrap').querySelector('.proj-sugg');
    sugg.style.display = 'none'; sugg.innerHTML = '';
  }, 160);
}

/* ── Version autocomplete / search ── */
function onVerInput(inp) {
  const card = inp.closest('.entry-card');
  const project = card.querySelector('[name="projectName"]').value.trim();
  const val = inp.value.trim().toLowerCase();
  const sugg = inp.closest('.ver-wrap').querySelector('.ver-sugg');
  const names = getSavedVersions(project).filter(n => n.toLowerCase().includes(val));
  if (!names.length || !val) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
  sugg.innerHTML = names.map(n => `<div class="sugg-item" onmousedown="event.preventDefault()">${escHtml(n)}</div>`).join('');
  sugg.querySelectorAll('.sugg-item').forEach((el, i) =>
    el.addEventListener('mousedown', () => {
      inp.value = names[i];
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      sugg.style.display = 'none';
      sugg.innerHTML = '';
    })
  );
  sugg.style.display = 'block';
}
function closeVerSugg(inp) {
  setTimeout(() => {
    const sugg = inp.closest('.ver-wrap').querySelector('.ver-sugg');
    sugg.style.display = 'none'; sugg.innerHTML = '';
  }, 160);
}

/* ── Module autocomplete ── */
function onModInput(inp) {
  const card = inp.closest('.entry-card');
  const project = card.querySelector('[name="projectName"]').value.trim();
  const val = inp.value.trim().toLowerCase();
  const sugg = inp.closest('.mod-wrap').querySelector('.mod-sugg');
  const names = getSavedModules(project).filter(n => n.toLowerCase().includes(val));
  if (!names.length || !val) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
  sugg.innerHTML = names.map(n => `<div class="sugg-item" onmousedown="event.preventDefault()">${escHtml(n)}</div>`).join('');
  sugg.querySelectorAll('.sugg-item').forEach((el, i) =>
    el.addEventListener('mousedown', () => {
      inp.value = names[i];
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      sugg.style.display = 'none';
      sugg.innerHTML = '';
    })
  );
  sugg.style.display = 'block';
}
function closeModSugg(inp) {
  setTimeout(() => {
    const sugg = inp.closest('.mod-wrap').querySelector('.mod-sugg');
    sugg.style.display = 'none'; sugg.innerHTML = '';
  }, 160);
}

/* ── Read one entry card into the stored shape ── */
function getEntryData(card) {
  const projectName = card.querySelector('[name="projectName"]').value.trim();
  const modules = [...card.querySelectorAll('.module-row-wrap')].map(row => {
    const authoNumSuffix = row.querySelector('[name="authoNumSuffix"]').value.trim();

    // Extract CheckSum
    const checkSumVal = row.querySelector('[name="checkSum"]') ? row.querySelector('[name="checkSum"]').value.trim() : '';

    // Extract Size values from the modified split inputs
    const sVal = row.querySelector('[name="sizeValue"]') ? row.querySelector('[name="sizeValue"]').value.trim() : '';
    const sUnit = row.querySelector('[name="sizeUnit"]') ? row.querySelector('[name="sizeUnit"]').value : 'KB';

    // Smart normalization: If they typed a text exception like NA or N/A, save it directly.
    // Otherwise, combine the number value with the chosen unit block dropdown seamlessly.
    const cleanSizeLower = sVal.toLowerCase();
    let combinedSize = '';
    if (cleanSizeLower === 'na' || cleanSizeLower === 'n/a') {
      combinedSize = sVal.toUpperCase(); // Saves as clean "NA" or "N/A"
    } else if (sVal) {
      combinedSize = `${sVal} ${sUnit}`; // Saves as standard formatted entry e.g. "24 KB"
    }

    return {
      moduleName: row.querySelector('[name="moduleName"]').value.trim(),
      fwDocs: row.querySelector('[name="fwDocs"]').value.trim(),
      moduleNumber: row.querySelector('[name="moduleNumber"]').value.trim(),
      authoNumSuffix: authoNumSuffix,
      authoNum: buildAuthoNum(authoNumSuffix),
      dvcReview: row.querySelector('[name="dvcReview"]').value,
      version: row.querySelector('[name="version"]').value.trim(),
      review: row.querySelector('[name="review"]').value,
      dateOfTesting: row.querySelector('[name="dateOfTesting"]').value,
      tcRelease: row.querySelector('[name="tcRelease"]').value,
      checkSum: checkSumVal,
      size: combinedSize
    };
  });
  return { projectName, modules };
}


/* ── Read all cards, in DOM (display) order ── */
function getAllCardData() {
  return [...document.querySelectorAll('.entry-card')].map(getEntryData);
}

function getSavableCardData() {
  const rawCardsData = getAllCardData();
  const mergedMap = new Map();

  rawCardsData.forEach(card => {
    if (!card.projectName) return;
    const key = card.projectName.trim().toUpperCase();
    const validModules = card.modules.filter(m => m.moduleName);

    if (validModules.length === 0) return;

    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        projectName: card.projectName.trim(),
        modules: []
      });
    }

    // Append modules into the singular project key
    validModules.forEach(mod => {
      const exists = mergedMap.get(key).modules.some(
        m => String(m.moduleName).trim().toLowerCase() === String(mod.moduleName).trim().toLowerCase() &&
             String(m.version).trim().toLowerCase() === String(mod.version).trim().toLowerCase()
      );
      if (!exists) {
        mergedMap.get(key).modules.push(mod);
      }
    });
  });

  return [...mergedMap.values()];
}


async function persistVisibleCards() {
  try {
    await saveAll(getSavableCardData());
  } catch (error) {
    showToast('Could not save the module change: ' + error.message);
  }
}

/* ── Save a single entry (its own "Save" button) ──
   Persists a full snapshot of ALL entries in current display order, so Entry
   positions (and therefore sheet numbers on download) always stay consistent. */
   async function saveEntry(card) {
    const entry = getEntryData(card);
    if (!entry.projectName) { showToast('⚠ Add a Project Name for this entry first'); return; }
    if (!entry.modules.length || entry.modules.every(m => !m.moduleName)) {
      showToast('⚠ Add at least one row with a Module Name'); return;
    }
  
    // Mandatory Validation Check for CheckSum and Size (Accepts 'NA' and 'N/A')
    for (let i = 0; i < entry.modules.length; i++) {
      const m = entry.modules[i];
      if (m.moduleName) {
        const cleanCheckSum = String(m.checkSum || '').trim().toLowerCase();
        const cleanSize = String(m.size || '').trim().toLowerCase();
  
        // Block if fields are completely empty
        if (!cleanCheckSum || !cleanSize) {
          showToast('⚠ Error: All active modules must have valid CheckSum and Size values before saving!');
          return;
        }
  
        // Validation logic checking for placeholder exceptions
        if (cleanSize !== 'na' && cleanSize !== 'n/a') {
          const hasNumber = /\d/.test(cleanSize);
          if (!hasNumber) {
            showToast('⚠ Error: Please enter a valid number or "NA" for Size.');
            return;
          }
        }
      }
    }
  
    const allData = getSavableCardData();
    try {
      await saveAll(allData);
    } catch (error) {
      showToast('Could not save entry: ' + error.message);
      return;
    }
    markSaved(card);
    renderDashboard();
    showToast('✓ Entry saved ');
  }
  

  async function saveData() {
    const entries = getSavableCardData();
    if (!entries.length) { showToast('⚠ Add at least one complete project first'); return; }
  
    // Mandatory Validation Check across all entries (Accepts NA and N/A)
    for (let e = 0; e < entries.length; e++) {
      const modules = entries[e].modules || []; // Added clean fallback array syntax
      for (let m = 0; m < modules.length; m++) {
        const cleanCheckSum = String(modules[m].checkSum || '').trim().toLowerCase();
        const cleanSize = String(modules[m].size || '').trim().toLowerCase();
  
        if (!cleanCheckSum || !cleanSize) {
          showToast('⚠ Error: CheckSum and Size are mandatory fields. Fill out all empty fields before saving.');
          return;
        }
      }
    }
  
    try {
      await saveAll(entries);
    } catch (error) {
      showToast('Could not save records: ' + error.message);
      return;
    }
    const count = entries.length;
    document.querySelectorAll('.entry-card').forEach(card => {
      if (getEntryData(card).projectName) markSaved(card);
    });
    renderDashboard();
    showToast('✓ ' + count + ' entr' + (count === 1 ? 'y' : 'ies') + ' saved.');
  }
  



/* ── Sheet-name sanitizer (Excel: max 31 chars, no \ / ? * [ ] :) ──
   Prefixed with the entry's position so Entry 1 -> Sheet 1, Entry 2 -> Sheet 2, etc.
   is guaranteed even if two entries share the same Project Name. */
function safeSheetName(entryNum, name) {
  const prefix = 'E' + entryNum + '-';
  let base = String(name || 'Project').replace(/[\\/?*\[\]:]/g, '-').trim();
  if (!base) base = 'Project';
  const maxBaseLen = 31 - prefix.length;
  return prefix + base.substring(0, maxBaseLen);
}

/* Download Excel: all saved project details in one sheet */
function buildAllProjectRows(entries) {
  return entries.flatMap((entry, idx) => {
    const entryNum = idx + 1;
    const rows = (entry.modules && entry.modules.length) ? entry.modules : [{}];
    return rows.map((m, moduleIdx) => ({
      entryNum,
      moduleNum: moduleIdx + 1,
      projectName: entry.projectName || '',
      moduleName: m.moduleName || '',
      fwDocs: m.fwDocs || '',
      moduleNumber: m.moduleNumber || '',
      authoNum: m.authoNum || buildAuthoNum(m.authoNumSuffix || ''),
      dvcReview: m.dvcReview || '',
      version: m.version || '',
      review: m.review || '',
      dateOfTesting: m.dateOfTesting || '',
      tcRelease: m.tcRelease || '',
      checkSum: m.checkSum || '',
      size: m.size || ''
    }));
  });
}

function handleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (event) {
    try {
      const wb = XLSX.read(event.target.result, { type: 'array', cellDates: true });
      const entries = importWorkbookToEntries(wb);
      if (!entries.length) {
        showToast('No project rows found. Check the Excel column headers.');
        return;
      }

      saveAll(entries);
      renderEntries(entries);
      renderDashboard();
      showToast('Imported ' + entries.length + ' project card(s) from Excel and saved them.');
    } catch (err) {
      console.error(err);
      showToast('Could not import this Excel file. Please check the sheet format.');
    } finally {
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

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

  rows.slice(headerRowIndex + 1).forEach((row, rowOffset) => {
    const rawProject = importCell(row, map.projectName);
    const rawEntry = importCell(row, map.entryNum);
    const projectName = rawProject || lastProjectName;
    const entryNum = rawEntry || lastEntryNum || String(groups.size + 1);
    const moduleName = importCell(row, map.moduleName);

    if (!projectName && !moduleName) return;
    lastProjectName = projectName || lastProjectName;
    lastEntryNum = entryNum || lastEntryNum;

    const groupKey = entryNum + '::' + projectName;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        entryNum: Number(entryNum) || groups.size + 1,
        firstRowIndex: rowOffset,
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
    .sort((a, b) => (a.entryNum - b.entryNum) || (a.firstRowIndex - b.firstRowIndex))
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
      entryNum: findHeaderIndex(normalized, ['entryno', 'entrynum', 'entrynumber', 'entry', 'index']),
      moduleNum: findHeaderIndex(normalized, ['rowno', 'rownum', 'rownumber', 'moduleno', 'modulenum', 'srno']),
      projectName: findHeaderIndex(normalized, ['projectname', 'project', 'projectid']),
      moduleName: findHeaderIndex(normalized, ['modulename', 'module', 'modules', 'modelname', 'model', 'models']),
      fwDocs: findHeaderIndex(normalized, ['fwdocs', 'fwdoc', 'fwdocument', 'fwdocument']),
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
  return headers.findIndex(header => names.includes(header));
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

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeChoice(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'yes' || text === 'y' || text === 'true' || text === '1') return 'Yes';
  if (text === 'no' || text === 'n' || text === 'false' || text === '0') return 'No';
  return value || '';
}

/* ── Toast ── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3400);
}

/* ── Util ── */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Load the shared server workspace before enabling tracker actions. */
window.trackerStore.initialize().then(ready => {
  if (!ready) return;
  const savedEntries = loadAll();
  if (savedEntries.length) renderEntries(savedEntries);
  renderDashboard();
});

async function doLogout() {
  try {
    await window.trackerStore.logout();
  } catch (error) {
    showToast('Could not safely sign out: ' + error.message);
  }
}
