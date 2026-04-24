import { getScreenDetail, listScreens, startScreenProduction } from "./api.js";

let pieceTimerInterval = null;

// Formata uma duração em milissegundos para o formato HH:MM:SS ou MM:SS
function formatDuration(durationMs) {
  const totalSeconds = Math.floor((durationMs || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Formata um timestamp em milissegundos para o formato de hora HH:MM:SS
function formatClock(timestampMs) {
  if (!timestampMs) {
    return "--:--:--";
  }

  const date = new Date(timestampMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

// Renderiza a lista de status das peças na fila de produção
function renderPieceStatuses(pieceStatuses) {
  if (!pieceStatuses || pieceStatuses.length === 0) {
    return '<li class="screenPdf_Empty">Nenhuma peca na fila.</li>';
  }

  return pieceStatuses
    .map((piece) => {
      const dotClass = piece.status === "done" ? "dot done" : piece.status === "current" ? "dot current" : piece.status === "emergency" ? "dot emergency" : piece.status === "paused_for_emergency" ? "dot paused_for_emergency" : piece.status === "waiting_confirmation" ? "dot waiting_confirmation" : "dot";
      const itemClass = piece.status === "done" ? "pieceStatus_Item done" : piece.status === "current" ? "pieceStatus_Item current" : piece.status === "emergency" ? "pieceStatus_Item emergency" : piece.status === "paused_for_emergency" ? "pieceStatus_Item paused_for_emergency" : piece.status === "waiting_confirmation" ? "pieceStatus_Item waiting_confirmation" : "pieceStatus_Item";
      const statusLabel = piece.status === "done" ? "FINALIZADO" : piece.status === "current" ? "EM PRODUCAO" : piece.status === "emergency" ? "EMERGENCIA" : piece.status === "paused_for_emergency" ? "PAUSADO" : piece.status === "waiting_confirmation" ? "AGUARDANDO CONFIRMACAO" : "PENDENTE";
      const statusClass = piece.status === "done" ? "pieceStatus_Badge done" : piece.status === "current" ? "pieceStatus_Badge current" : piece.status === "emergency" ? "pieceStatus_Badge emergency" : piece.status === "paused_for_emergency" ? "pieceStatus_Badge paused_for_emergency" : piece.status === "waiting_confirmation" ? "pieceStatus_Badge waiting_confirmation" : "pieceStatus_Badge";
      const pieceName = (piece.filename || "").replace(/\.pdf$/i, "");
      return `
        <li class="${itemClass}">
          <div class="pieceStatus_Label">
            <div class="pieceStatus_MainLine">
              <span class="${statusClass}">${statusLabel}</span>
              <span class="pieceStatus_Name" title="${pieceName}">${pieceName}</span>
            </div>
          </div>
          <span class="${dotClass}"></span>
        </li>
      `;
    })
    .join("");
}

// Renderiza o histórico de peças finalizadas
function renderPieceHistory(history) {
  if (!history || history.length === 0) {
    return '<p class="history_Empty">Nenhuma peca finalizada ainda.</p>';
  }

  return history
    .map((entry) => {
      const emergencyTag = entry.piece_type === "emergency" ? '<span class="history_EmergencyTag">PECA DE EMERGENCIA</span>' : "";
      return `
        <li class="history_Item">
          <span class="history_CellName">${entry.piece_name || "-"} ${emergencyTag}</span>
          <span>${entry.process || "-"}</span>
          <span>${formatClock(entry.started_at_ms)}</span>
          <span>${formatClock(entry.ended_at_ms)}</span>
          <span>${formatDuration(entry.duration_ms)}</span>
        </li>
      `;
    })
    .join("");
}

// Atualiza o timer da peça atual em produção, exibindo o tempo decorrido
function bindCurrentPieceTimer(initialElapsedMs, paused) {
  if (pieceTimerInterval) {
    clearInterval(pieceTimerInterval);
    pieceTimerInterval = null;
  }

  const timerElement = document.getElementById("current-piece-timer");
  if (!timerElement) {
    return;
  }

  const baseElapsed = Math.max(0, Number(initialElapsedMs || 0));
  timerElement.textContent = formatDuration(baseElapsed);

  if (paused) {
    return;
  }

  const startedAt = Date.now();
  const updateTimer = () => {
    const delta = Date.now() - startedAt;
    timerElement.textContent = formatDuration(baseElapsed + delta);
  };

  updateTimer();
  pieceTimerInterval = window.setInterval(updateTimer, 1000);
}

// Renderiza as informações da tela selecionada, incluindo status, fila, histórico e ações
export function renderScreenInfo(screenData, onOpenModal, onChanged) {
  const panel = document.getElementById("equip-info");
  const history = screenData.piece_history || [];
  const current = screenData.current;
  const pieceStatuses = screenData.piece_statuses || [];
  const reportEnabled = Boolean(screenData.report_available);

  panel.innerHTML = `
    <button id="edit-pdfs" class="btn_Engrenagem" title="Editar PDFs" aria-label="Editar PDFs">&#9881;</button>
    <h1>${screenData.name}</h1>
    <p>Status: <strong>${screenData.paused ? "Pausado" : screenData.active ? "Em andamento" : screenData.waiting_confirmation ? "Aguardando confirmacao" : "Aguardando"}</strong></p>

    <div class="screenUpload_Box">
      <label>Controle de producao</label>
      <div class="screenUpload_Row">
        <button id="start-production" class="btn_IniciarProducao" type="button" ${screenData.active || screenData.waiting_confirmation ? "disabled" : ""}>Iniciar Producao</button>
        <a class="btn_AbrirVisualizacao" href="/producao/${screenData.id}" target="_blank" rel="noopener">Abrir Visualizacao</a>
        <button id="download-report" class="btn_BaixarRelatorio" type="button" ${reportEnabled ? "" : "disabled"}>Baixar relatorio</button>
      </div>
    </div>


    ${screenData.production_started ? `
      <div class="timer_Box">
        <p>Timer da peca atual: <strong id="current-piece-timer">${current ? formatDuration(current.elapsed_ms || 0) : "--:--"}</strong></p>
      </div>

      <div class="barra_Progresso_Group pieceQueue_Block">
        <h3 class="pieceQueue_Title">Fila de producao</h3>
        <ul class="pieceStatus_List">${renderPieceStatuses(pieceStatuses)}</ul>
      </div>

      <div class="history_Box">
        <p>Historico de pecas finalizadas</p>
        <div class="history_HeaderRow">
          <span>Nome</span>
          <span>Tipo</span>
          <span>Hora de inicio</span>
          <span>Hora de termino</span>
          <span>Tempo de producao</span>
        </div>
        <ul class="history_List">
          ${renderPieceHistory(history)}
        </ul>
      </div>
    ` : '<p class="history_Empty">Os campos de producao serao gerados apos clicar em Iniciar Producao.</p>'}
  `;

  bindCurrentPieceTimer(current ? current.elapsed_ms : null, Boolean(screenData.paused));

  document.getElementById("start-production").onclick = async function () {
    try {
      const payload = await startScreenProduction(screenData.id);
      renderScreenInfo(payload.screen, onOpenModal, onChanged);
      await onChanged(payload.screen.id);
    } catch (error) {
      alert(error.message || "Erro ao iniciar producao.");
    }
  };

  document.getElementById("edit-pdfs").onclick = function () {
    onOpenModal(screenData.id);
  };

  document.getElementById("download-report").onclick = async function () {
    if (!reportEnabled) {
      return;
    }

    try {
      const response = await fetch(`/api/telas/${encodeURIComponent(screenData.id)}/relatorio`);
      if (!response.ok) {
        let payload = {};
        try {
          payload = await response.json();
        } catch (error) {
          payload = {};
        }
        throw new Error(payload.error || "Erro ao baixar relatorio.");
      }

      const reportBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(reportBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = `relatorio_tela_${screenData.id}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.URL.revokeObjectURL(objectUrl);

      await onChanged(screenData.id);
    } catch (error) {
      alert(error.message || "Erro ao baixar relatorio.");
    }
  };
}

// Carrega e renderiza a lista de telas disponíveis no menu lateral
export async function loadScreenList(selectedScreenId, onSelectScreen) {
  const listElement = document.getElementById("equip-list");
  listElement.innerHTML = "";

  const screens = await listScreens();
  screens.forEach((screen) => {
    const item = document.createElement("li");
    item.className = "list-item";

    if (Number(selectedScreenId) === Number(screen.id)) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <span>${screen.name}</span>
      <span class="badge_Andamento">${screen.pdf_count} pecas</span>
    `;

    item.onclick = async function () {
      listElement.querySelectorAll(".list-item").forEach((listItem) => {
        listItem.classList.remove("active");
      });
      item.classList.add("active");

      const detail = await getScreenDetail(screen.id);
      onSelectScreen(detail);
    };

    listElement.appendChild(item);
  });

  return screens;
}
