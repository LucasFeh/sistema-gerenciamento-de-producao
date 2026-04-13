import { createModalController } from "./modal.js";
import { loadEquipmentList, renderEquipmentInfo } from "./dashboard.js";

let modalController = null;

function renderDefaultPanel() {
  const panel = document.getElementById("equip-info");
  panel.innerHTML = `
    <h1>Painel de Producao</h1>
    <p>Selecione um equipamento para ver as informacoes e iniciar a producao.</p>
  `;
}

async function refreshList() {
  await loadEquipmentList((detail) => {
    renderEquipmentInfo(detail, (equipmentName) => {
      modalController.openForEquipment(equipmentName);
    });
  });
}

modalController = createModalController(async (payload) => {
  await refreshList();
  if (payload && payload.deleted) {
    renderDefaultPanel();
    return;
  }
  renderEquipmentInfo(payload, (equipmentName) => {
    modalController.openForEquipment(equipmentName);
  });
});

refreshList();
