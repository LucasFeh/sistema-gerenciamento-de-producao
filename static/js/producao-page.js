import { finishCurrentProduction, getCurrentProduction } from "./api.js";

const container = document.getElementById("producao-container");
let renderKey = "";
let isFinishing = false;
const POLL_MS = 2000;
const PRODUCTION_EVENTS_CHANNEL = "production-events";

function buildPdfUrl(data) {
  const equipment = encodeURIComponent(data.name);
  const process = encodeURIComponent(data.current.process);
  const filename = encodeURIComponent(data.current.filename);
  return `/arquivos/${equipment}/${process}/${filename}`;
}

function notifyManagement(equipmentName) {
  const payload = {
    type: "production-finished",
    equipmentName: equipmentName || "",
    timestamp: Date.now(),
  };

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(PRODUCTION_EVENTS_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }

  localStorage.setItem("production-finished", JSON.stringify(payload));
}

function renderWaitingState() {
  container.innerHTML = `
    <div class="producao_Header">
      <h1>Aguardando producao</h1>
      <p>Quando um processo entrar em producao, esta tela atualiza automaticamente.</p>
    </div>
    <div class="producao_EmptyStage">Sem PDF em visualizacao</div>
  `;
}

function renderActiveState(data) {
  container.innerHTML = `
    <div class="producao_Header">
      <h1>${data.name}</h1>
      <div class="producao_Meta">
        <p>Processo: <strong>${data.current.process}</strong></p>
        <p>Peca ${data.current.index + 1} de ${data.current.total}</p>
      </div>
    </div>

    <iframe
      class="pdf_Frame"
      src="${buildPdfUrl(data)}"
      title="Visualizador de PDF"
    ></iframe>

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
      const payload = await finishCurrentProduction();
      const reportEquipment = payload.equipmentName || data.name;
      notifyManagement(reportEquipment);
      if (!payload.active || !payload.equipment || !payload.equipment.current) {
        renderKey = "waiting";
        renderWaitingState();
        return;
      }
      renderKey = `${payload.equipment.name}|${payload.equipment.current.process}|${payload.equipment.current.index}|${payload.equipment.current.filename}`;
      renderActiveState(payload.equipment);
    } catch (error) {
      alert(error.message || "Erro ao finalizar etapa.");
    } finally {
      isFinishing = false;
    }
  };
}

async function loadCurrentProduction() {
  try {
    const payload = await getCurrentProduction();
    if (!payload.active || !payload.equipment || !payload.equipment.current) {
      if (renderKey !== "waiting") {
        renderKey = "waiting";
        renderWaitingState();
      }
      return;
    }

    const equipment = payload.equipment;
    const nextKey = `${equipment.name}|${equipment.current.process}|${equipment.current.index}|${equipment.current.filename}`;
    if (renderKey !== nextKey) {
      renderKey = nextKey;
      renderActiveState(equipment);
    }
  } catch (error) {
    if (renderKey !== "waiting") {
      renderKey = "waiting";
      renderWaitingState();
    }
  }
}

loadCurrentProduction();
window.setInterval(loadCurrentProduction, POLL_MS);
