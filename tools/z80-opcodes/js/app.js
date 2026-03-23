import { getBlockDefinition, loadBlockData } from "./utils.js";
import { renderBlockSelector, renderCategoryOptions, renderDetail, renderTable } from "./renderer.js";

const state = {
  blockId: "base",
  locale: "ca",
  entries: [],
  selectedEntry: null,
  filters: {
    query: "",
    category: "all"
  },
  onSelectEntry: (entry) => {
    state.selectedEntry = entry;
    render();
  }
};

const elements = {
  blockSelector: document.querySelector("#block-selector"),
  searchInput: document.querySelector("#search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  tableTitle: document.querySelector("#table-title"),
  tableDescription: document.querySelector("#table-description"),
  tableSummary: document.querySelector("#table-summary"),
  tableContainer: document.querySelector("#table-container"),
  statusBadge: document.querySelector("#status-badge"),
  detailContent: document.querySelector("#detail-content"),
  loadMessage: document.querySelector("#load-message")
};

elements.searchInput.addEventListener("input", (event) => {
  state.filters.query = event.target.value;
  render();
});

elements.categoryFilter.addEventListener("change", (event) => {
  state.filters.category = event.target.value;
  render();
});

async function setBlock(blockId) {
  state.blockId = blockId;
  state.selectedEntry = null;
  state.filters.category = "all";
  showMessage("Carregant dades...", false);

  try {
    state.entries = await loadBlockData(blockId);
    renderCategoryOptions(elements.categoryFilter, state.entries, state.filters.category);
    showMessage("", false);
    render();
  } catch (error) {
    state.entries = [];
    elements.categoryFilter.innerHTML = '<option value="all">Totes</option>';
    showMessage(error.message, true);
    render();
  }
}

function showMessage(message, isError) {
  if (!message) {
    elements.loadMessage.hidden = true;
    elements.loadMessage.textContent = "";
    elements.loadMessage.classList.remove("is-error");
    return;
  }

  elements.loadMessage.hidden = false;
  elements.loadMessage.textContent = message;
  elements.loadMessage.classList.toggle("is-error", isError);
}

function render() {
  const block = getBlockDefinition(state.blockId);
  elements.tableTitle.textContent = block.label;
  elements.tableDescription.textContent = block.description ?? "";
  elements.statusBadge.textContent = block.complete ? "Bloc complet" : "Mostra parcial";

  renderBlockSelector(elements.blockSelector, state.blockId, (nextBlockId) => {
    if (nextBlockId !== state.blockId) {
      setBlock(nextBlockId);
    }
  });

  if (!state.entries.length) {
    elements.tableSummary.textContent = block.note;
    elements.tableContainer.innerHTML = '<div class="load-message">No hi ha entrades carregades per aquest bloc.</div>';
    renderDetail(elements.detailContent, null, state.locale);
    return;
  }

  const result = renderTable(elements.tableContainer, state.entries, state, block);
  elements.tableSummary.textContent = result.summary;
  renderDetail(elements.detailContent, state.selectedEntry, state.locale);
}

setBlock(state.blockId);
