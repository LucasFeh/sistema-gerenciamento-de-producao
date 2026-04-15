import { getScreenDetail, updateScreenName, updateScreenPdfs } from "./api.js";

// Cria e retorna o controlador do modal de configuração de tela, gerenciando uploads, remoções e edição de PDFs
export function createModalController(getSelectedScreenId, onSaved) {
  const modal = document.getElementById("equipment-modal");
  const equipmentForm = document.getElementById("equipment-form");
  const nameInput = document.getElementById("equipment-name");
  const responsibleInput = document.getElementById("responsible-name");
  const operationTypeInput = document.getElementById("operation-type");
  const tornoInput = document.getElementById("torno-pdfs");
  const feedback = document.getElementById("form-feedback");
  const openModalButton = document.getElementById("open-modal");

  let activeScreenId = null;

  const selectedUploads = {
    torno: [],
  };
  const existingFiles = {
    torno: [],
  };
  const removedFiles = {
    torno: new Set(),
  };
  const pieceQuantities = {};

  // Retorna a quantidade de peças para um arquivo PDF
  function quantityFor(filename) {
    return Math.max(1, Number(pieceQuantities[filename] || 1));
  }

  // Atualiza a quantidade de peças para um arquivo PDF
  function updateQuantity(filename, rawValue) {
    const parsed = Number(rawValue);
    pieceQuantities[filename] = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  // Monta o objeto com as quantidades visíveis de peças para os arquivos existentes
  function buildVisiblePieceQuantities() {
    const payload = {};

    existingFiles.torno
      .filter((filename) => !removedFiles.torno.has(filename))
      .forEach((filename) => {
        payload[filename] = quantityFor(filename);
      });

    return payload;
  }

  // Monta o objeto com as quantidades de peças para os arquivos que serão enviados
  function buildUploadPieceQuantities() {
    const payload = {};

    selectedUploads.torno.forEach((file) => {
      payload[file.name] = quantityFor(file.name);
    });

    return payload;
  }

  // Renderiza a visualização dos arquivos PDFs (existentes e novos) para um processo
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
        <div class="pdf_CardFooter">
          <div class="pdf_QtyBox">
            <label class="pdf_QtyLabel">Qtd</label>
            <input type="number" min="1" step="1" class="pdf_QtyInput" value="${quantityFor(filename)}" />
          </div>
          <button type="button" class="pdf_RemoveBtn" aria-label="Remover ${filename}">x</button>
        </div>
      `;

      card.querySelector(".pdf_QtyInput").oninput = function (event) {
        updateQuantity(filename, event.target.value);
      };

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
        <div class="pdf_CardFooter">
          <div class="pdf_QtyBox">
            <label class="pdf_QtyLabel">Qtd</label>
            <input type="number" min="1" step="1" class="pdf_QtyInput" value="${quantityFor(file.name)}" />
          </div>
          <button type="button" class="pdf_RemoveBtn" aria-label="Remover ${file.name}">x</button>
        </div>
      `;

      card.querySelector(".pdf_QtyInput").oninput = function (event) {
        updateQuantity(file.name, event.target.value);
      };

      card.querySelector(".pdf_RemoveBtn").onclick = function () {
        delete pieceQuantities[file.name];
        selectedUploads[processName].splice(index, 1);
        renderPreview(processName);
      };

      target.appendChild(card);
    });
  }

  // Renderiza as visualizações de todos os processos (atualmente só "torno")
  function renderPreviews() {
    renderPreview("torno");
  }

  // Adiciona arquivos PDF selecionados ao processo e atualiza a visualização
  function appendSelectedFiles(processName, fileList) {
    const incoming = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (incoming.length === 0) {
      return;
    }
    selectedUploads[processName] = selectedUploads[processName].concat(incoming);
    incoming.forEach((file) => {
      if (!pieceQuantities[file.name]) {
        pieceQuantities[file.name] = 1;
      }
    });
    renderPreview(processName);
  }

  // Carrega os dados da tela selecionada para edição no modal
  async function loadScreenData(screenId) {
    if (!screenId) {
      existingFiles.torno = [];
      removedFiles.torno = new Set();
      renderPreviews();
      return;
    }

    try {
      const payload = await getScreenDetail(screenId);
      activeScreenId = payload.id;
      nameInput.value = payload.name || "";
      responsibleInput.value = payload.responsible || "";
      operationTypeInput.value = payload.operation_type || "";
      existingFiles.torno = payload.pdf_files || [];
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      existingFiles.torno.forEach((filename) => {
        pieceQuantities[filename] = Number(payload.piece_quantities?.[filename] || 1);
      });
      removedFiles.torno = new Set();
      renderPreviews();
    } catch (error) {
      existingFiles.torno = [];
      responsibleInput.value = "";
      operationTypeInput.value = "";
      removedFiles.torno = new Set();
      renderPreviews();
    }
  }

  // Exibe o modal de configuração de tela
  function openModal() {
    modal.classList.remove("hidden");
    renderPreviews();
  }

  // Fecha o modal de configuração de tela
  function closeModal() {
    modal.classList.add("hidden");
  }

  if (openModalButton) {
    openModalButton.onclick = function () {
      activeScreenId = Number(getSelectedScreenId());
      selectedUploads.torno = [];
      existingFiles.torno = [];
      removedFiles.torno = new Set();
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      loadScreenData(activeScreenId);
      openModal();
    };
  }

  document.getElementById("close-modal").onclick = closeModal;

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
      if (target) {
        target.classList.add("active");
      }
    };
  });

  tornoInput.addEventListener("change", function () {
    appendSelectedFiles("torno", tornoInput.files);
    tornoInput.value = "";
  });

  equipmentForm.onsubmit = async function (event) {
    event.preventDefault();

    if (!activeScreenId) {
      if (feedback) {
        feedback.textContent = "Selecione uma tela para salvar os PDFs.";
        feedback.className = "feedback error";
      }
      return;
    }

    if (feedback) {
      feedback.textContent = "Salvando PDFs da tela...";
    }

    try {
      const nextName = nameInput.value.trim();
      if (!nextName) {
        throw new Error("Nome da tela e obrigatorio.");
      }

      await updateScreenName(activeScreenId, nextName);
      const payload = await updateScreenPdfs(
        activeScreenId,
        selectedUploads.torno,
        Array.from(removedFiles.torno),
        {
          responsible: responsibleInput.value.trim(),
          operation_type: operationTypeInput.value.trim(),
          piece_quantities: buildVisiblePieceQuantities(),
          upload_piece_quantities: buildUploadPieceQuantities(),
        }
      );
      if (feedback) {
        feedback.textContent = "PDFs atualizados com sucesso.";
        feedback.className = "feedback success";
      }

      equipmentForm.reset();
      selectedUploads.torno = [];
      existingFiles.torno = [];
      removedFiles.torno = new Set();
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      closeModal();
      await onSaved(payload);
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message || "Erro ao salvar PDFs.";
        feedback.className = "feedback error";
      }
    }
  };

  return {
    openForScreen(screenId) {
      activeScreenId = Number(screenId || getSelectedScreenId());
      selectedUploads.torno = [];
      removedFiles.torno = new Set();
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      loadScreenData(activeScreenId);
      openModal();
    },
  };
}
