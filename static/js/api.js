async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};

  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Erro na requisicao.");
  }

  return payload;
}

export async function listEquipments() {
  return requestJson("/api/equipamentos");
}

export async function getEquipmentDetail(equipmentName) {
  return requestJson(`/api/equipamentos/${encodeURIComponent(equipmentName)}`);
}

export async function deleteEquipment(equipmentName) {
  return requestJson(`/api/equipamentos/${encodeURIComponent(equipmentName)}`, {
    method: "DELETE",
  });
}

export async function saveEquipment(equipmentName, tornoFiles, fresaFiles, removeTornoFiles = [], removeFresaFiles = []) {
  const formData = new FormData();
  formData.append("name", equipmentName.trim());

  tornoFiles.forEach((file) => {
    formData.append("torno_pdfs", file);
  });

  fresaFiles.forEach((file) => {
    formData.append("fresa_pdfs", file);
  });

  removeTornoFiles.forEach((filename) => {
    formData.append("remove_torno_files", filename);
  });

  removeFresaFiles.forEach((filename) => {
    formData.append("remove_fresa_files", filename);
  });

  return requestJson("/api/equipamentos", {
    method: "POST",
    body: formData,
  });
}

export async function startProduction(equipmentName) {
  return requestJson(`/api/equipamentos/${encodeURIComponent(equipmentName)}/iniciar`, {
    method: "POST",
  });
}

export async function finishCurrentPiece(equipmentName) {
  return requestJson(`/api/equipamentos/${encodeURIComponent(equipmentName)}/finalizar`, {
    method: "POST",
  });
}
