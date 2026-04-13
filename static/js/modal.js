import { deleteEquipment, getEquipmentDetail, saveEquipment } from "./api.js";

export function createModalController(onSaved) {
  const modal = document.getElementById("equipment-modal");
  const equipmentForm = document.getElementById("equipment-form");
  const nameInput = document.getElementById("equipment-name");
  const tornoInput = document.getElementById("torno-pdfs");
  const fresaInput = document.getElementById("fresa-pdfs");
  const feedback = document.getElementById("form-feedback");
  const deleteButton = document.getElementById("delete-equipment");

  let equipmentExists = false;

  function syncDeleteButtonState() {
    deleteButton.disabled = !equipmentExists;
    deleteButton.title = equipmentExists ? "Apagar equipamento" : "Informe um equipamento existente para apagar";
  }

  const selectedUploads = {
    torno: [],
    fresa: [],
  };
  const existingFiles = {
    torno: [],
    fresa: [],
  };
  const removedFiles = {
    torno: new Set(),
    fresa: new Set(),
  };

  function renderPreview(processName) {
    const target = document.getElementById(`${processName}-preview`);
    target.innerHTML = "";

    const visibleExisting = existingFiles[processName].filter((filename) => !removedFiles[processName].has(filename));
    const visibleSelected = selectedUploads[processName];

    if (visibleExisting.length === 0 && visibleSelected.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pdf_EmptyBox";
      empty.textContent = "Sem PDFs";
      target.appendChild(empty);
      return;
    }

    visibleExisting.forEach((filename) => {
      const card = document.createElement("div");
      card.className = "pdf_Card existing";
      card.innerHTML = `
        <span class="pdf_Tag">PDF</span>
        <p title="${filename}">${filename}</p>
        <button type="button" class="pdf_RemoveBtn" aria-label="Remover ${filename}">x</button>
      `;

      card.querySelector(".pdf_RemoveBtn").onclick = function () {
        removedFiles[processName].add(filename);
        renderPreview(processName);
      };

      target.appendChild(card);
    });

    visibleSelected.forEach((file, index) => {
      const card = document.createElement("div");
      card.className = "pdf_Card selected";
      card.innerHTML = `
        <span class="pdf_Tag">NOVO</span>
        <p title="${file.name}">${file.name}</p>
        <button type="button" class="pdf_RemoveBtn" aria-label="Remover ${file.name}">x</button>
      `;

      card.querySelector(".pdf_RemoveBtn").onclick = function () {
        selectedUploads[processName].splice(index, 1);
        renderPreview(processName);
      };

      target.appendChild(card);
    });
  }

  function renderPreviews() {
    renderPreview("torno");
    renderPreview("fresa");
  }

  function appendSelectedFiles(processName, fileList) {
    const incoming = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (incoming.length === 0) {
      return;
    }
    selectedUploads[processName] = selectedUploads[processName].concat(incoming);
    renderPreview(processName);
  }

  async function loadExistingFilesByName(equipmentName) {
    if (!equipmentName) {
      equipmentExists = false;
      syncDeleteButtonState();
      existingFiles.torno = [];
      existingFiles.fresa = [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      renderPreviews();
      return;
    }

    try {
      const payload = await getEquipmentDetail(equipmentName);
      equipmentExists = true;
      syncDeleteButtonState();
      existingFiles.torno = payload.torno_files || [];
      existingFiles.fresa = payload.fresa_files || [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      renderPreviews();
    } catch (error) {
      equipmentExists = false;
      syncDeleteButtonState();
      existingFiles.torno = [];
      existingFiles.fresa = [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      renderPreviews();
    }
  }

  function openModal() {
    modal.classList.remove("hidden");
    loadExistingFilesByName(nameInput.value.trim());
    renderPreviews();
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  document.getElementById("open-modal").onclick = function () {
    nameInput.value = "";
    equipmentExists = false;
    syncDeleteButtonState();
    selectedUploads.torno = [];
    selectedUploads.fresa = [];
    existingFiles.torno = [];
    existingFiles.fresa = [];
    removedFiles.torno = new Set();
    removedFiles.fresa = new Set();
    openModal();
  };

  document.getElementById("close-modal").onclick = closeModal;

  deleteButton.onclick = async function () {
    const equipmentName = nameInput.value.trim();
    if (!equipmentName) {
      feedback.textContent = "Informe o nome do equipamento para apagar.";
      feedback.className = "feedback error";
      return;
    }

    if (!equipmentExists) {
      feedback.textContent = "Esse equipamento nao existe.";
      feedback.className = "feedback error";
      return;
    }

    const confirmed = window.confirm(`Apagar o equipamento '${equipmentName}' e toda a pasta dele?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteEquipment(equipmentName);
      feedback.textContent = "Equipamento apagado com sucesso.";
      feedback.className = "feedback success";

      equipmentForm.reset();
      equipmentExists = false;
      syncDeleteButtonState();
      selectedUploads.torno = [];
      selectedUploads.fresa = [];
      existingFiles.torno = [];
      existingFiles.fresa = [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      closeModal();
      await onSaved({ deleted: true, name: equipmentName });
    } catch (error) {
      feedback.textContent = error.message || "Erro ao apagar equipamento.";
      feedback.className = "feedback error";
    }
  };

  modal.onclick = function (event) {
    if (event.target === modal) {
      closeModal();
    }
  };

  document.querySelectorAll(".tab_Btn").forEach((button) => {
    button.onclick = function () {
      document.querySelectorAll(".tab_Btn").forEach((btn) => {
        btn.classList.remove("active");
      });

      document.querySelectorAll(".tab_Panel").forEach((panel) => {
        panel.classList.remove("active");
      });

      button.classList.add("active");
      const target = document.getElementById(`tab-${button.dataset.tab}`);
      target.classList.add("active");
    };
  });

  nameInput.addEventListener("blur", function () {
    loadExistingFilesByName(nameInput.value.trim());
  });

  tornoInput.addEventListener("change", function () {
    appendSelectedFiles("torno", tornoInput.files);
    tornoInput.value = "";
  });

  fresaInput.addEventListener("change", function () {
    appendSelectedFiles("fresa", fresaInput.files);
    fresaInput.value = "";
  });

  equipmentForm.onsubmit = async function (event) {
    event.preventDefault();
    feedback.textContent = "Salvando equipamento...";

    try {
      const payload = await saveEquipment(
        nameInput.value,
        selectedUploads.torno,
        selectedUploads.fresa,
        Array.from(removedFiles.torno),
        Array.from(removedFiles.fresa)
      );
      feedback.textContent = payload.created ? "Equipamento criado com sucesso." : "PDFs atualizados com sucesso.";
      feedback.className = "feedback success";

      equipmentForm.reset();
      equipmentExists = false;
      syncDeleteButtonState();
      selectedUploads.torno = [];
      selectedUploads.fresa = [];
      existingFiles.torno = [];
      existingFiles.fresa = [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      closeModal();
      await onSaved(payload);
    } catch (error) {
      feedback.textContent = error.message || "Erro ao salvar equipamento.";
      feedback.className = "feedback error";
    }
  };

  return {
    openForEquipment(equipmentName) {
      nameInput.value = equipmentName || "";
      equipmentExists = false;
      syncDeleteButtonState();
      selectedUploads.torno = [];
      selectedUploads.fresa = [];
      removedFiles.torno = new Set();
      removedFiles.fresa = new Set();
      openModal();
    },
  };
}
