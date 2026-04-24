import { finishScreenPiece, getScreenDetail, toggleScreenPause, confirmScreenProduction } from "./api.js";

const container = document.getElementById("producao-container");
const body = document.body;
const screenId = Number(body.dataset.screenId || 1);
const drawerBtn = document.getElementById("btn-menu-info");
const drawer = document.getElementById("info-drawer");
const drawerContent = document.getElementById("info-drawer-content");
const drawerBackdrop = document.getElementById("info-drawer-backdrop");
const drawerCloseBtn = document.getElementById("btn-close-drawer");

let lastScreenSnapshot = null;

function openDrawer() {
  drawer.classList.remove("hidden");
  drawerBackdrop.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  populateDrawer();
}

function closeDrawer() {
  drawer.classList.add("hidden");
  drawerBackdrop.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
}

function setDrawerButtonVisible(visible) {
  if (!drawerBtn) {
    return;
  }

  if (visible) {
    drawerBtn.classList.remove("hidden");
    return;
  }

  drawerBtn.classList.add("hidden");
  closeDrawer();
}

function populateDrawer() {
  const screen = lastScreenSnapshot;
  if (!screen) {
    drawerContent.innerHTML = "<p>Carregando...</p>";
    return;
  }

  const machineName = screen.equipment_machine || "Nao informado";
  const pieces = screen.piece_statuses || [];

  const rows = pieces.map((p) => {
    const statusLabel = {
      done: "Concluido",
      current: "Em andamento",
      emergency: "Emergencia",
      paused_for_emergency: "Pausado",
      pending: "Pendente",
      waiting_confirmation: "Aguardando",
    }[p.status] || p.status;
    const name = (p.filename || "").replace(/\.pdf$/i, "");
    return `
      <div class="drawer_PieceRow drawer_PieceRow--${p.status}">
        <span class="drawer_PieceNum">${p.piece_number}</span>
        <span class="drawer_PieceName">${name}</span>
        <span class="drawer_PieceQty">x${p.quantity}</span>
        <span class="drawer_PieceStatus">${statusLabel}</span>
      </div>`;
  }).join("");

  drawerContent.innerHTML = `
    <div class="drawer_Section">
      <p class="drawer_Label">Equipamento</p>
      <p class="drawer_Value">${machineName}</p>
    </div>
    <div class="drawer_Section">
      <p class="drawer_Label">Pecas (${pieces.length})</p>
      <div class="drawer_PieceList">${rows || "<p>Sem pecas cadastradas.</p>"}</div>
    </div>
  `;
}


if (drawerBtn) drawerBtn.addEventListener("click", openDrawer);
if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

const MANAGEMENT_SYNC_KEY = "screen-production-updated";
const MANAGEMENT_SYNC_CHANNEL = "screen-production-sync";
let renderKey = "";
let isFinishing = false;
let elapsedTimerInterval = null;

function formatDuration(durationMs) {
  const totalSeconds = Math.floor(Math.max(0, Number(durationMs || 0)) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function bindElapsedTimer(initialElapsedMs, paused) {
  if (elapsedTimerInterval) {
    clearInterval(elapsedTimerInterval);
    elapsedTimerInterval = null;
  }

  const elapsedElement = document.getElementById("current-elapsed-display");
  if (!elapsedElement) {
    return;
  }

  const baseElapsed = Math.max(0, Number(initialElapsedMs || 0));
  elapsedElement.textContent = formatDuration(baseElapsed);

  if (paused) {
    return;
  }

  const startedAt = Date.now();
  const updateElapsed = () => {
    const delta = Date.now() - startedAt;
    elapsedElement.textContent = formatDuration(baseElapsed + delta);
  };

  updateElapsed();
  elapsedTimerInterval = window.setInterval(updateElapsed, 1000);
}

function notifyManagementScreen(updatedScreenId) {
  const payload = {
    type: "piece-finished",
    screenId: Number(updatedScreenId || screenId),
    timestamp: Date.now(),
  };

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(MANAGEMENT_SYNC_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }

  localStorage.setItem(MANAGEMENT_SYNC_KEY, JSON.stringify(payload));
}

function buildPdfUrl(filename) {
  return `/arquivos/telas/${encodeURIComponent(screenId)}/${encodeURIComponent(filename)}`;
}

function renderWaitingState(screen) {
  setDrawerButtonVisible(false);
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${screen.name}</h1>
      <p>Aguardando inicio da producao para esta tela.</p>
    </div>
    <div class="producao_EmptyStage">Aguardando inicio da producao...</div>
  `;
}

function renderWaitingConfirmation(screen) {
  setDrawerButtonVisible(true);
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${screen.name}</h1>
    </div>

    <div class="producao_EmptyStage">
      <div class="confirmation_CenterBox">
        <h2 class="confirmation_Title">NOVO PEDIDO DE PRODUÇÃO</h2>
        <h2 class="confirmation_Responsible">${screen.responsible || "Responsavel nao informado"}</h2>
        <button id="btn-confirm-production" class="btn_Finalizar btn_Finish">Iniciar</button>
      </div>
    </div>
  `;

  document.getElementById("btn-confirm-production").onclick = async function () {
    try {
      await confirmScreenProduction(screen.id);
      notifyManagementScreen(screen.id);
      await refreshViewer();
    } catch (error) {
      alert(error.message || "Erro ao confirmar producao.");
    }
  };
}

function renderFinishedState(screen) {
  setDrawerButtonVisible(false);
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${screen.name}</h1>
      <p>Producao finalizada.</p>
    </div>
    <div class="producao_EmptyStage">Todos as peças em produção desta tela foram concluidos.</div>
  `;
}

function renderActiveState(screen) {
  setDrawerButtonVisible(false);
  const current = screen.current;
  const pieceTitle = (current.piece_name || current.filename || "Peca").replace(/\.pdf$/i, "");
  const elapsedMs = Number(current.elapsed_ms || 0);
  const isEmergency = Boolean(current.emergency);

  if (current.paused) {
    container.innerHTML = `
      <div class="producao_Header">
        <h1>${screen.responsible || "Responsavel nao informado"}</h1>
        <div class="producao_Meta">
          <p>Peca em andamento: <strong>${pieceTitle}</strong> ${isEmergency ? '<span class="emergency_Tag">EMERGENCIA</span>' : ""}</p>
          <p>Tempo atual: <strong id="current-elapsed-display">${formatDuration(elapsedMs)}</strong></p>
          <p>Paginacao: <strong>${current.index + 1} de ${current.total}</strong></p>
        </div>
      </div>

      <div class="producao_EmptyStage">
        <div class="paused_CenterBox">
          <h2>PAUSADO</h2>
          <button id="btn-toggle-pause" class="btn_Finalizar btn_Resume">Retomar</button>
        </div>
      </div>
    `;

    document.getElementById("btn-toggle-pause").onclick = async function () {
      try {
        await toggleScreenPause(screen.id);
        notifyManagementScreen(screen.id);
        await refreshViewer();
      } catch (error) {
        alert(error.message || "Erro ao retomar operacao.");
      }
    };

    bindElapsedTimer(elapsedMs, true);
    return;
  }

  container.innerHTML = `
    <div class="producao_Header">
      <h1>${pieceTitle} ${isEmergency ? '<span class="emergency_Tag">EMERGENCIA</span>' : ""}</h1>
      <div class="producao_Meta">
        <p>Tempo atual: <strong id="current-elapsed-display">${formatDuration(elapsedMs)}</strong></p>
        <p>Quantidade: <strong>${current.quantity || 1}</strong></p>
        <p>Responsavel: <strong>${screen.responsible || "Nao informado"}</strong></p>
        <p>Tipo de operacao: <strong>${screen.operation_type || "Nao informado"}</strong></p>
        <p>Paginacao: <strong>${current.index + 1} de ${current.total}</strong></p>
      </div>
    </div>

    <iframe class="pdf_Frame" src="${buildPdfUrl(current.filename)}" title="Visualizador de PDF"></iframe>

    <div class="producao_Footer">
      <button id="btn-toggle-pause" class="btn_Finalizar btn_Pause">Pausar</button>
      <button id="btn-finalizar" class="btn_Finalizar btn_Finish">Finalizar</button>
    </div>
  `;

  document.getElementById("btn-toggle-pause").onclick = async function () {
    try {
      await toggleScreenPause(screen.id);
      notifyManagementScreen(screen.id);
      await refreshViewer();
    } catch (error) {
      alert(error.message || "Erro ao pausar operacao.");
    }
  };

  document.getElementById("btn-finalizar").onclick = async function () {
    if (isFinishing) {
      return;
    }

    isFinishing = true;
    try {
      await finishScreenPiece(screen.id);
      notifyManagementScreen(screen.id);
      await refreshViewer();
    } catch (error) {
      alert(error.message || "Erro ao finalizar etapa.");
    } finally {
      isFinishing = false;
    }
  };

  bindElapsedTimer(elapsedMs, false);
}

async function refreshViewer() {
  try {
    const screen = await getScreenDetail(screenId);
    lastScreenSnapshot = screen;

    if (!screen.production_started) {
      if (renderKey !== "waiting") {
        renderKey = "waiting";
        renderWaitingState(screen);
      }
      return;
    }

    if (screen.waiting_confirmation) {
      if (renderKey !== "waiting_confirmation") {
        renderKey = "waiting_confirmation";
        renderWaitingConfirmation(screen);
      }
      return;
    }

    if (!screen.active || !screen.current) {
      if (renderKey !== "finished") {
        renderKey = "finished";
        renderFinishedState(screen);
      }
      return;
    }

    const nextKey = `${screen.id}|${screen.current.index}|${screen.current.filename}|${screen.piece_history.length}|${screen.paused ? 1 : 0}`;
    if (renderKey !== nextKey) {
      renderKey = nextKey;
      renderActiveState(screen);
    }
  } catch (error) {
    renderKey = "error";
    container.innerHTML = "<p>Erro ao carregar visualizacao da tela.</p>";
  }
}

refreshViewer();
window.setInterval(refreshViewer, 2000);
