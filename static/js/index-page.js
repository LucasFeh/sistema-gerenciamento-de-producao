import { getScreenDetail } from "./api.js";
import { loadScreenList, renderScreenInfo } from "./dashboard.js";
import { createModalController } from "./modal.js";

let selectedScreenId = 1;
let isRefreshing = false;
let modalController = null;

function renderDefaultPanel() {
  const panel = document.getElementById("equip-info");
  panel.innerHTML = `
    <h1>Painel de Telas</h1>
    <p>Selecione uma tela no menu lateral para configurar nome e PDFs.</p>
  `;
}

function renderDetail(detail) {
  renderScreenInfo(detail, (screenId) => {
    modalController.openForScreen(screenId);
  }, async (screenId) => {
    selectedScreenId = Number(screenId);
    await refreshAll();
  });
}

async function refreshList() {
  const screens = await loadScreenList(selectedScreenId, (detail) => {
    selectedScreenId = Number(detail.id);
    renderDetail(detail);
  });

  if (!screens || screens.length === 0) {
    renderDefaultPanel();
    return;
  }

  const exists = screens.some((screen) => Number(screen.id) === Number(selectedScreenId));
  if (!exists) {
    selectedScreenId = Number(screens[0].id);
  }
}

async function refreshSelectedScreen() {
  if (!selectedScreenId) {
    return;
  }

  try {
    const detail = await getScreenDetail(selectedScreenId);
    renderDetail(detail);
  } catch (error) {
    selectedScreenId = 0;
    renderDefaultPanel();
  }
}

async function refreshAll() {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;
  try {
    await refreshList();
    await refreshSelectedScreen();
  } finally {
    isRefreshing = false;
  }
}

refreshAll();

modalController = createModalController(
  () => selectedScreenId,
  async (payload) => {
    selectedScreenId = Number(payload.id);
    await refreshAll();
    const detail = await getScreenDetail(selectedScreenId);
    renderDetail(detail);
  }
);
