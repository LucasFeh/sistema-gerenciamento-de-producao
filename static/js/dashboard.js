import { decideFresa, finishCurrentPiece, getEquipmentDetail, listEquipments, startProduction } from "./api.js";

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

function buildProcessState(data, processName, totalCount) {
  if (!data.current || !data.active || data.current.process !== processName) {
    return { doneCount: 0, currentIndex: null };
  }

  const rawIndex = data.current.index;
  const safeIndex = Math.max(0, Math.min(rawIndex, Math.max(totalCount - 1, 0)));
  return {
    doneCount: safeIndex,
    currentIndex: safeIndex,
  };
}

export function renderEquipmentInfo(data, onEditPdfs, onStateChanged) {
  const panel = document.getElementById("equip-info");
  const tornoState = buildProcessState(data, "Torno", data.torno_count);
  const fresaState = buildProcessState(data, "Fresa", data.fresa_count);
  const viewUrl = productionPageUrl();

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
  `;

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

  if (data.active) {
    document.getElementById("finish-step").onclick = async function () {
      try {
        const payload = await finishCurrentPiece(data.name);
        const updated = payload.equipment;
        renderEquipmentInfo(updated, onEditPdfs, onStateChanged);
        if (onStateChanged) {
          await onStateChanged(updated.name);
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
