import { getEquipmentDetail, listEquipments, startProduction } from "./api.js";

function barDots(total, activeIndex) {
  const safeTotal = Math.max(total, 1);
  let dots = "";

  for (let index = 0; index < safeTotal; index += 1) {
    const activeClass = index < activeIndex ? "dot done" : "dot";
    dots += `<span class="${activeClass}"></span>`;
  }

  return dots;
}

export function renderEquipmentInfo(data, onEditPdfs) {
  const panel = document.getElementById("equip-info");
  const tornoCurrent = data.current && data.current.process === "Torno" ? data.current.index + 1 : 0;
  const fresaCurrent = data.current && data.current.process === "Fresa" ? data.current.index + 1 : 0;

  panel.innerHTML = `
    <button id="edit-pdfs" class="btn_Engrenagem" title="Editar PDFs" aria-label="Editar PDFs">&#9881;</button>
    <h1>${data.name}</h1>
    <p>Status: <strong>${data.active ? "Em producao" : "Aguardando"}</strong></p>

    <div class="barra_Progresso_Group">
      <p>Torno (${data.torno_count} PDF)</p>
      <div class="barra_Bolinhas">${barDots(data.torno_count, tornoCurrent)}</div>
    </div>

    <div class="barra_Progresso_Group">
      <p>Fresa (${data.fresa_count} PDF)</p>
      <div class="barra_Bolinhas">${barDots(data.fresa_count, fresaCurrent)}</div>
    </div>

    <button id="start-production" class="btn_IniciarProducao">Iniciar Producao</button>
  `;

  document.getElementById("start-production").onclick = async function () {
    try {
      const payload = await startProduction(data.name);
      window.location.href = payload.redirect;
    } catch (error) {
      alert(error.message || "Erro ao iniciar producao.");
    }
  };

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
      item.textContent = equip.name;
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
