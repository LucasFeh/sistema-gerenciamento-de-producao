import { getScreenDetail } from "./api.js";
import { loadScreenList, renderScreenInfo } from "./dashboard.js";
import { createModalController } from "./modal.js";

let selectedScreenId = 1;
let isRefreshing = false;
let modalController = null;
const MANAGEMENT_SYNC_KEY = "screen-production-updated";
const MANAGEMENT_SYNC_CHANNEL = "screen-production-sync";

// Exibe o painel padrão quando nenhuma tela está selecionada
function renderDefaultPanel() {
  const panel = document.getElementById("equip-info");
  panel.innerHTML = `
    <h1>Painel de Telas</h1>
    <p>Selecione uma tela no menu lateral para configurar nome e PDFs.</p>
  `;
}

// Renderiza os detalhes de uma tela específica, incluindo ações de abrir modal e atualizar seleção
function renderDetail(detail) {
  renderScreenInfo(detail, (screenId) => {
    modalController.openForScreen(screenId);
  }, async (screenId) => {
    selectedScreenId = Number(screenId);
    await refreshAll();
  });
}

// Atualiza a lista de telas disponíveis e seleciona a tela ativa
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

// Atualiza os detalhes da tela atualmente selecionada
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

// Atualiza toda a interface: lista de telas e detalhes da tela selecionada
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

// Inscreve o frontend para receber atualizações de visualização via BroadcastChannel e storage events
function subscribeToVisualizationUpdates() {
  const handlePayload = async (payload) => {
    if (!payload || payload.type !== "piece-finished") {
      return;
    }

    await refreshAll();
  };

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(MANAGEMENT_SYNC_CHANNEL);
    channel.onmessage = async function (event) {
      await handlePayload(event.data || {});
    };
  }

  window.addEventListener("storage", async function (event) {
    if (event.key !== MANAGEMENT_SYNC_KEY) {
      return;
    }

    let payload = {};
    try {
      payload = JSON.parse(event.newValue || "{}");
    } catch (error) {
      payload = {};
    }

    await handlePayload(payload);
  });
}

// Inscreve o frontend para receber eventos de produção do backend via EventSource
function subscribeToBackendProductionEvents() {
  if (!("EventSource" in window)) {
    return;
  }

  const source = new EventSource("/api/eventos/producao");
  source.addEventListener("production-updated", async function () {
    await refreshAll();
  });
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

subscribeToVisualizationUpdates();
subscribeToBackendProductionEvents();
