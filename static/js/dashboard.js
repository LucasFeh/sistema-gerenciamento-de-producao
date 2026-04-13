import { decideFresa, finishCurrentPiece, getEquipmentDetail, listEquipments, resetProductionTracking, startProduction } from "./api.js";

let pieceTimerInterval = null;

function renderProgressDots(total, doneCount, currentIndex) {
  const safeTotal = Math.max(total, 1);
  let dots = "";

  for (let index = 0; index < safeTotal; index += 1) {
    let dotClass = "dot";
    if (index < doneCount) {
      dotClass = "dot done";
    }
    if (currentIndex !== null && index === currentIndex) {
      dotClass = "dot current";
    }
    dots += `<span class="${dotClass}"></span>`;
  }

  return dots;
}

function productionPageUrl() {
  return "/producao";
}

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

function formatClock(timestampMs) {
  if (!timestampMs) {
    return "--:--:--";
  }
  const date = new Date(timestampMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function canDownloadReport(data) {
  if (!data) {
    return false;
  }

  const ended = !data.active && !data.pending_fresa_confirmation;
  const hasHistory = (data.piece_history || []).length > 0;
  return ended && hasHistory;
}

function renderPieceHistory(history) {
  if (!history || history.length === 0) {
    return '<p class="history_Empty">Nenhuma peca finalizada ainda.</p>';
  }

  return history
    .map((entry) => {
      return `
        <li class="history_Item">
          <span class="history_CellName">${entry.piece_name || "-"}</span>
          <span>${entry.process || "-"}</span>
          <span>${formatClock(entry.started_at_ms)}</span>
          <span>${formatClock(entry.ended_at_ms)}</span>
          <span>${formatDuration(entry.duration_ms)}</span>
        </li>
      `;
    })
    .join("");
}

function bindCurrentPieceTimer(startedAtMs) {
  if (pieceTimerInterval) {
    clearInterval(pieceTimerInterval);
    pieceTimerInterval = null;
  }

  if (!startedAtMs) {
    return;
  }

  const timerElement = document.getElementById("current-piece-timer");
  if (!timerElement) {
    return;
  }

  const update = () => {
    const elapsed = Date.now() - startedAtMs;
    timerElement.textContent = formatDuration(elapsed);
  };

  update();
  pieceTimerInterval = window.setInterval(update, 1000);
}

function buildProcessState(data, processName, totalCount) {
  const history = data.piece_history || [];
  const completedCount = history.filter((entry) => entry.process === processName).length;

  if (!data.current || !data.active || data.current.process !== processName) {
    return { doneCount: Math.min(completedCount, totalCount), currentIndex: null };
  }

  const rawIndex = data.current.index;
  const safeIndex = Math.max(0, Math.min(rawIndex, Math.max(totalCount - 1, 0)));
  return {
    doneCount: Math.min(completedCount, safeIndex),
    currentIndex: safeIndex,
  };
}

export function renderEquipmentInfo(data, onEditPdfs, onStateChanged) {
  const panel = document.getElementById("equip-info");
  const tornoState = buildProcessState(data, "Torno", data.torno_count);
  const fresaState = buildProcessState(data, "Fresa", data.fresa_count);
  const viewUrl = productionPageUrl();
  const currentStart = data.current ? data.current.started_at_ms : null;
  const reportEnabled = canDownloadReport(data);

  panel.innerHTML = `
    <button id="edit-pdfs" class="btn_Engrenagem" title="Editar PDFs" aria-label="Editar PDFs">&#9881;</button>
    <h1>${data.name}</h1>
    <p>Status: <strong>${data.active ? "Em andamento" : "Aguardando"}</strong></p>

    <div class="barra_Progresso_Group">
      <p>Torno (${data.torno_count} PDF)</p>
      <div class="barra_Bolinhas">${renderProgressDots(data.torno_count, tornoState.doneCount, tornoState.currentIndex)}</div>
    </div>

    <div class="barra_Progresso_Group">
      <p>Fresa (${data.fresa_count} PDF)</p>
      <div class="barra_Bolinhas">${renderProgressDots(data.fresa_count, fresaState.doneCount, fresaState.currentIndex)}</div>
    </div>

    <div class="acoes_Producao">
      <button id="start-production" class="btn_IniciarProducao" ${data.active ? "disabled" : ""}>Iniciar Producao</button>
      <button id="download-report" class="btn_BaixarRelatorio" ${reportEnabled ? "" : "disabled"}>Baixar relatorio</button>
      ${data.active ? '<button id="finish-step" class="btn_FinalizarEtapa">Finalizar Etapa Atual</button>' : ""}
      ${data.active && data.current ? `<a class="btn_AbrirVisualizacao" href="${viewUrl}" target="_blank" rel="noopener">Abrir Visualizacao</a>` : ""}
    </div>

    ${data.pending_fresa_confirmation ? `
      <div class="decision_Box">
        <p>Torno finalizado. Deseja prosseguir com a Fresa?</p>
        <button id="fresa-yes" class="btn_DecisionYes">Sim</button>
        <button id="fresa-no" class="btn_DecisionNo">Nao</button>
      </div>
    ` : ""}

    ${data.active && data.current ? `<p class="viewer_Title">Em visualizacao: ${data.current.process} - ${data.current.filename}</p>` : ""}

    <div class="timer_Box">
      <p>Timer da peca atual: <strong id="current-piece-timer">${currentStart ? formatDuration(Date.now() - currentStart) : "--:--"}</strong></p>
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
        ${renderPieceHistory(data.piece_history || [])}
      </ul>
    </div>
  `;

  bindCurrentPieceTimer(currentStart);

  document.getElementById("start-production").onclick = async function () {
    try {
      const payload = await startProduction(data.name);
      renderEquipmentInfo(payload.equipment, onEditPdfs, onStateChanged);
      if (onStateChanged) {
        await onStateChanged(payload.equipment.name);
      }
    } catch (error) {
      alert(error.message || "Erro ao iniciar producao.");
    }
  };

  document.getElementById("download-report").onclick = async function () {
    if (!reportEnabled) {
      return;
    }

    try {
      const reportUrl = `/api/equipamentos/${encodeURIComponent(data.name)}/relatorio`;
      const response = await fetch(reportUrl);
      if (!response.ok) {
        throw new Error("Erro ao baixar relatorio.");
      }

      const reportBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(reportBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = `relatorio_${data.name}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.URL.revokeObjectURL(objectUrl);

      await resetProductionTracking(data.name);
      if (onStateChanged) {
        await onStateChanged(data.name);
      }
    } catch (error) {
      alert(error.message || "Erro ao zerar historico apos relatorio.");
    }
  };

  if (data.active) {
    document.getElementById("finish-step").onclick = async function () {
      try {
        const payload = await finishCurrentPiece(data.name);
        const updated = payload.equipment;
        renderEquipmentInfo(updated, onEditPdfs, onStateChanged);
        if (onStateChanged) {
          await onStateChanged((updated && updated.name) || data.name);
        }
      } catch (error) {
        alert(error.message || "Erro ao finalizar etapa.");
      }
    };
  }

  if (data.pending_fresa_confirmation) {
    document.getElementById("fresa-yes").onclick = async function () {
      try {
        const payload = await decideFresa(data.name, true);
        renderEquipmentInfo(payload.equipment, onEditPdfs, onStateChanged);
        if (onStateChanged) {
          await onStateChanged(payload.equipment.name);
        }
      } catch (error) {
        alert(error.message || "Erro ao iniciar Fresa.");
      }
    };

    document.getElementById("fresa-no").onclick = async function () {
      try {
        const payload = await decideFresa(data.name, false);
        renderEquipmentInfo(payload.equipment, onEditPdfs, onStateChanged);
        if (onStateChanged) {
          await onStateChanged(payload.equipment.name);
        }
      } catch (error) {
        alert(error.message || "Erro ao finalizar producao.");
      }
    };
  }

  document.getElementById("edit-pdfs").onclick = function () {
    onEditPdfs(data.name);
  };
}

export async function loadEquipmentList(onSelectEquipment) {
  const listElement = document.getElementById("equip-list");
  listElement.innerHTML = "";

  try {
    const equipments = await listEquipments();
    equipments.forEach((equip) => {
      const item = document.createElement("li");
      item.className = "list-item";
      item.innerHTML = `
        <span>${equip.name}</span>
        ${equip.active ? '<span class="badge_Andamento">Em andamento</span>' : ""}
      `;
      item.onclick = async function () {
        try {
          const detail = await getEquipmentDetail(equip.name);
          onSelectEquipment(detail);
        } catch (error) {
          alert(error.message || "Erro ao carregar equipamento.");
        }
      };
      listElement.appendChild(item);
    });
  } catch (error) {
    alert(error.message || "Erro ao carregar lista de equipamentos.");
  }
}
