import {
  BLOCKS,
  buildCellMap,
  buildCols,
  buildRows,
  categoryLabel,
  formatCount,
  getEntryDescription,
  getEntryExample,
  matchesFilters
} from "./utils.js";

function fieldLine(label, value, isCode = false) {
  const safeValue = value && value !== "" ? value : "—";
  const content = isCode ? `<code>${escapeHtml(safeValue)}</code>` : `<span>${escapeHtml(safeValue)}</span>`;
  return `<div class="field-line"><div><strong>${label}:</strong> ${content}</div></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderBlockSelector(container, currentBlockId, onSelect) {
  container.innerHTML = "";

  for (const block of BLOCKS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `block-button${block.id === currentBlockId ? " is-active" : ""}`;
    button.textContent = block.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(block.id === currentBlockId));
    button.addEventListener("click", () => onSelect(block.id));
    container.append(button);
  }
}

export function renderCategoryOptions(select, entries, currentValue) {
  const categories = [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort();
  select.innerHTML = `<option value="all">Totes</option>`;

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = categoryLabel(category);
    option.selected = category === currentValue;
    select.append(option);
  }
}

export function renderTable(container, entries, state, block) {
  const rows = buildRows();
  const cols = buildCols();
  const cellMap = buildCellMap(entries);
  const filteredIds = new Set(entries.filter((entry) => matchesFilters(entry, state.filters, state.locale)).map((entry) => entry.id));

  let matched = 0;
  let selectedStillVisible = false;
  let documented = 0;
  let filteredDocumented = 0;

  const table = document.createElement("table");
  table.className = "opcode-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>H \\ L</th>
        ${cols.map((col) => `<th>${col}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th class="row-label">${row}</th>`;

    for (const col of cols) {
      const td = document.createElement("td");
      const entry = cellMap.get(`${row}:${col}`.toUpperCase());

      if (!entry) {
        td.innerHTML = `<div class="opcode-cell is-empty">—</div>`;
        tr.append(td);
        continue;
      }

      const matches = filteredIds.has(entry.id);
      if (matches) {
        matched += 1;
        if (entry.documented !== false) {
          filteredDocumented += 1;
        }
      }

      if (entry.documented !== false) {
        documented += 1;
      }

      const isSelected = state.selectedEntry?.id === entry.id;
      if (isSelected) {
        selectedStillVisible = true;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = `opcode-cell is-entry${matches ? "" : " is-muted"}${isSelected ? " is-selected" : ""}`;
      button.dataset.category = entry.category ?? "control";
      button.innerHTML = `
        <div class="cell-fields">
          ${fieldLine("Mnemonic", entry.mnemonic)}
          ${fieldLine("Clck", entry.clck)}
          ${fieldLine("Siz", entry.siz)}
          ${fieldLine("Op-Code", entry.opcode, true)}
          ${fieldLine("Description", getEntryDescription(entry, state.locale))}
        </div>
      `;
      button.addEventListener("click", () => state.onSelectEntry(entry));

      td.append(button);
      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(tbody);
  container.innerHTML = "";
  container.append(table);

  return {
    matched,
    total: entries.length,
    summary: `${formatCount({
      matches: matched,
      total: entries.length,
      expectedEntries: block.expectedEntries ?? entries.length,
      documented,
      filteredDocumented
    })}. ${block.note}`,
    selectedStillVisible
  };
}

export function renderDetail(container, entry, locale = "ca") {
  if (!entry) {
    container.className = "detail-content is-empty";
    container.innerHTML = "<p>Selecciona una casella valida per veure mnemonic, flags, notes i exemples.</p>";
    return;
  }

  const description = getEntryDescription(entry, locale);
  const example = getEntryExample(entry, locale);
  const affectedFlags = entry.flags?.affected?.length ? entry.flags.affected : [];
  const notes = entry.flags?.notes?.trim();

  container.className = "detail-content";
  container.innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${escapeHtml(entry.mnemonic)}</h3>
        <p class="summary-text">${escapeHtml(entry.opcode)}</p>
      </div>
      <span class="detail-chip">${escapeHtml(categoryLabel(entry.category ?? "control"))}</span>
    </div>

    <div class="detail-grid">
      <article class="detail-card">
        <h3>Camps</h3>
        <div class="cell-fields">
          ${fieldLine("Mnemonic", entry.mnemonic)}
          ${fieldLine("Clck", entry.clck)}
          ${fieldLine("Siz", entry.siz)}
          ${fieldLine("Op-Code", entry.opcode, true)}
          ${fieldLine("Description", description)}
        </div>
      </article>

      <article class="detail-card">
        <h3>Flags afectats</h3>
        <div class="tag-row">
          ${
            affectedFlags.length
              ? affectedFlags.map((flag) => `<span class="tag">${escapeHtml(flag)}</span>`).join("")
              : '<span class="tag is-empty">Sense metadata especifica</span>'
          }
        </div>
        ${notes ? `<p class="detail-note">${escapeHtml(notes)}</p>` : ""}
      </article>

      ${
        example
          ? `
            <article class="detail-card">
              <h3>Exemple curt</h3>
              <p>${escapeHtml(example)}</p>
            </article>
          `
          : ""
      }
    </div>
  `;
}
