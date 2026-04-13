import { createModalController } from "./modal.js";
import { loadEquipmentList, renderEquipmentInfo } from "./dashboard.js";
import { getEquipmentDetail } from "./api.js";

let modalController = null;
let selectedEquipmentName = "";
let isRefreshing = false;
const PRODUCTION_EVENTS_CHANNEL = "production-events";

function renderDefaultPanel() {
  const panel = document.getElementById("equip-info");
  panel.innerHTML = `
    <h1>Painel de Producao</h1>
    <p>Selecione um equipamento para ver as informacoes e iniciar a producao.</p>
  `;
}

function renderDetail(detail) {
  renderEquipmentInfo(detail, (equipmentName) => {
    modalController.openForEquipment(equipmentName);
  }, async (equipmentName) => {
    selectedEquipmentName = equipmentName;
    await refreshAll();
  });
}

async function refreshList() {
  await loadEquipmentList((detail) => {
    selectedEquipmentName = detail.name;
    renderDetail(detail);
  });
}

async function refreshSelectedEquipment() {
  if (!selectedEquipmentName) {
    return;
  }

  try {
    const detail = await getEquipmentDetail(selectedEquipmentName);
    renderDetail(detail);
  } catch (error) {
    selectedEquipmentName = "";
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
    await refreshSelectedEquipment();
  } finally {
    isRefreshing = false;
  }
}

function subscribeToProductionNotifications() {
  if ("EventSource" in window) {
    const source = new EventSource("/api/eventos/producao");
    source.addEventListener("production-updated", async function (event) {
      let payload = {};
      try {
        payload = JSON.parse(event.data || "{}");
      } catch (error) {
        payload = {};
      }

      if (payload.equipmentName) {
        selectedEquipmentName = payload.equipmentName;
      }

      await refreshAll();
    });
  }

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(PRODUCTION_EVENTS_CHANNEL);
    channel.onmessage = async function (event) {
      const payload = event.data || {};
      if (payload.type !== "production-finished") {
        return;
      }

      if (payload.equipmentName) {
        selectedEquipmentName = payload.equipmentName;
      }

      await refreshAll();
    };
  }

  window.addEventListener("storage", async function (event) {
    if (event.key !== "production-finished") {
      return;
    }

    let payload = {};
    try {
      payload = JSON.parse(event.newValue || "{}");
    } catch (error) {
      payload = {};
    }

    if (payload.equipmentName) {
      selectedEquipmentName = payload.equipmentName;
    }

    await refreshAll();
  });
}

modalController = createModalController(async (payload) => {
  await refreshAll();
  if (payload && payload.deleted) {
    renderDefaultPanel();
    selectedEquipmentName = "";
    return;
  }
  selectedEquipmentName = payload.name;
  renderDetail(payload);
});

refreshAll();
subscribeToProductionNotifications();
