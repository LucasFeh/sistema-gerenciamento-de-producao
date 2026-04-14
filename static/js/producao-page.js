import { finishScreenPiece, getScreenDetail } from "./api.js";

const container = document.getElementById("producao-container");
const body = document.body;
const screenId = Number(body.dataset.screenId || 1);
const MANAGEMENT_SYNC_KEY = "screen-production-updated";
const MANAGEMENT_SYNC_CHANNEL = "screen-production-sync";
let renderKey = "";
let isFinishing = false;

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
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${screen.name}</h1>
      <p>Aguardando inicio da producao para esta tela.</p>
    </div>
    <div class="producao_EmptyStage">Clique em Iniciar Producao no painel principal</div>
  `;
}

function renderFinishedState(screen) {
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${screen.name}</h1>
      <p>Producao finalizada.</p>
    </div>
    <div class="producao_EmptyStage">Todos os PDFs desta tela foram concluidos.</div>
  `;
}

function renderActiveState(screen) {
  const current = screen.current;
  const pieceTitle = (current.piece_name || current.filename || "Peca").replace(/\.pdf$/i, "");

  container.innerHTML = `
    <div class="producao_Header">
      <h1>${pieceTitle}</h1>
      <div class="producao_Meta">
        <p>Quantidade de pecas: <strong>${current.quantity || 1}</strong></p>
        <p>Nome do responsavel pela producao: <strong>${screen.responsible || "Nao informado"}</strong></p>
        <p>Tipo de operacao: <strong>${screen.operation_type || "Nao informado"}</strong></p>
        <p>Paginacao: <strong>${current.index + 1} de ${current.total}</strong></p>
      </div>
    </div>

    <iframe class="pdf_Frame" src="${buildPdfUrl(current.filename)}" title="Visualizador de PDF"></iframe>

    <div class="producao_Footer">
      <button id="btn-finalizar" class="btn_Finalizar">Finalizar</button>
    </div>
  `;

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
}

async function refreshViewer() {
  try {
    const screen = await getScreenDetail(screenId);

    if (!screen.production_started) {
      if (renderKey !== "waiting") {
        renderKey = "waiting";
        renderWaitingState(screen);
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

    const nextKey = `${screen.id}|${screen.current.index}|${screen.current.filename}|${screen.piece_history.length}`;
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
