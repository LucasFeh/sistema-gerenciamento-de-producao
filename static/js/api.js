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

export async function listScreens() {
  return requestJson("/api/telas");
}

export async function getScreenDetail(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}`);
}

export async function updateScreenName(screenId, screenName) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/nome`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: (screenName || "").trim() }),
  });
}

export async function updateScreenPdfs(screenId, files = [], removeFiles = [], metadata = {}) {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append("pdfs", file);
  });

  removeFiles.forEach((filename) => {
    formData.append("remove_files", filename);
  });

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "responsible")) {
    formData.append("responsible", metadata.responsible || "");
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "operation_type")) {
    formData.append("operation_type", metadata.operation_type || "");
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "equipment_machine")) {
    formData.append("equipment_machine", metadata.equipment_machine || "");
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "emergency_filename")) {
    formData.append("emergency_filename", metadata.emergency_filename || "");
  }

  if (metadata && metadata.piece_quantities) {
    formData.append("piece_quantities", JSON.stringify(metadata.piece_quantities));
  }

  if (metadata && metadata.upload_piece_quantities) {
    formData.append("upload_piece_quantities", JSON.stringify(metadata.upload_piece_quantities));
  }

  if (metadata && Array.isArray(metadata.pdf_order)) {
    formData.append("pdf_order", JSON.stringify(metadata.pdf_order));
  }

  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/pdfs`, {
    method: "POST",
    body: formData,
  });
}

export async function getScreenVisualization(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/visualizacao`);
}

export async function startScreenProduction(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/iniciar`, {
    method: "POST",
  });
}

export async function confirmScreenProduction(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/confirmar`, {
    method: "POST",
  });
}

export async function finishScreenPiece(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/finalizar`, {
    method: "POST",
  });
}

export async function startScreenEmergency(screenId, filename) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/emergencia`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: String(filename || "") }),
  });
}

export async function toggleScreenPause(screenId) {
  return requestJson(`/api/telas/${encodeURIComponent(screenId)}/pausa`, {
    method: "POST",
  });
}
