import { getScreenDetail, updateScreenName, updateScreenPdfs } from "./api.js";

// Cria e retorna o controlador do modal de configuração de tela, gerenciando uploads, remoções e edição de PDFs
export function createModalController(getSelectedScreenId, onSaved) {
  const modal = document.getElementById("equipment-modal");
  const equipmentForm = document.getElementById("equipment-form");
  const nameInput = document.getElementById("equipment-name");
  const responsibleInput = document.getElementById("responsible-name");
  const operationTypeInput = document.getElementById("operation-type");
  const equipmentMachineInput = document.getElementById("equipment-machine");
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
  let emergencyFilename = "";

  // Ordem manual dos PDFs (nomes dos arquivos na sequência desejada)
  const pdfOrder = {
    torno: [],
  };

  // Reconstrói pdfOrder[processName] a partir dos arrays visíveis
  function rebuildOrder(processName) {
    const visibleExisting = existingFiles[processName].filter(
      (f) => !removedFiles[processName].has(f)
    );
    const existingSet = new Set(visibleExisting);
    const selectedNames = selectedUploads[processName].map((f) => f.name);

    // Mantém a ordem já definida, remove o que foi deletado, adiciona novos ao final
    const current = pdfOrder[processName].filter(
      (f) => existingSet.has(f) || selectedNames.includes(f)
    );
    const inOrder = new Set(current);
    for (const f of visibleExisting) {
      if (!inOrder.has(f)) current.push(f);
    }
    for (const name of selectedNames) {
      if (!inOrder.has(name)) current.push(name);
    }
    pdfOrder[processName] = current;
  }

  // Retorna os itens na ordem definida pelo usuário
  function orderedItems(processName) {
    rebuildOrder(processName);
    const existingSet = new Set(
      existingFiles[processName].filter((f) => !removedFiles[processName].has(f))
    );
    const selectedMap = new Map(
      selectedUploads[processName].map((f) => [f.name, f])
    );
    return pdfOrder[processName].map((name) => {
      if (existingSet.has(name)) return { type: "existing", name };
      if (selectedMap.has(name)) return { type: "selected", file: selectedMap.get(name) };
      return null;
    }).filter(Boolean);
  }

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

    const items = orderedItems(processName);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pdf_EmptyBox";
      empty.textContent = "Sem PDFs";
      target.appendChild(empty);
      return;
    }

    let dragSrc = null;

    items.forEach((item) => {
      const card = document.createElement("div");
      const isExisting = item.type === "existing";
      const name = isExisting ? item.name : item.file.name;
      const emergencyClass = emergencyFilename === name ? " emergency" : "";
      card.className = "pdf_Card " + (isExisting ? "existing" : "selected") + emergencyClass + " pdf_Draggable";
      card.draggable = true;
      card.dataset.name = name;
      card.innerHTML = `
        <div class="pdf_DragHandle" title="Arrastar para reordenar">&#9776;</div>
        <span class="pdf_Tag">${emergencyFilename === name ? "EMERGENCIA" : (isExisting ? "PDF" : "NOVO")}</span>
        <p title="${name}">${name}</p>
        <div class="pdf_CardFooter">
          <div class="pdf_QtyBox">
            <label class="pdf_QtyLabel">Qtd</label>
            <input type="number" min="1" step="1" class="pdf_QtyInput" value="${quantityFor(name)}" />
          </div>
          <button type="button" class="pdf_RemoveBtn" aria-label="Remover ${name}">x</button>
        </div>
      `;

      card.onclick = function (event) {
        if (
          event.target.closest(".pdf_RemoveBtn") ||
          event.target.closest(".pdf_QtyInput") ||
          event.target.closest(".pdf_DragHandle")
        ) {
          return;
        }
        emergencyFilename = emergencyFilename === name ? "" : name;
        renderPreview(processName);
      };

      card.querySelector(".pdf_QtyInput").oninput = function (event) {
        updateQuantity(name, event.target.value);
      };

      if (isExisting) {
        card.querySelector(".pdf_RemoveBtn").onclick = function () {
          if (emergencyFilename === name) {
            emergencyFilename = "";
          }
          removedFiles[processName].add(name);
          renderPreview(processName);
        };
      } else {
        card.querySelector(".pdf_RemoveBtn").onclick = function () {
          if (emergencyFilename === name) {
            emergencyFilename = "";
          }
          delete pieceQuantities[name];
          selectedUploads[processName] = selectedUploads[processName].filter((f) => f.name !== name);
          renderPreview(processName);
        };
      }

      // Drag-and-drop para reordenar
      card.addEventListener("dragstart", function (e) {
        dragSrc = card;
        card.classList.add("pdf_Dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      card.addEventListener("dragend", function () {
        card.classList.remove("pdf_Dragging");
        target.querySelectorAll(".pdf_Card").forEach((c) => c.classList.remove("pdf_DragOver"));
      });

      card.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragSrc && dragSrc !== card) {
          target.querySelectorAll(".pdf_Card").forEach((c) => c.classList.remove("pdf_DragOver"));
          card.classList.add("pdf_DragOver");
        }
      });

      card.addEventListener("dragleave", function () {
        card.classList.remove("pdf_DragOver");
      });

      card.addEventListener("drop", function (e) {
        e.preventDefault();
        card.classList.remove("pdf_DragOver");
        if (!dragSrc || dragSrc === card) return;

        const srcName = dragSrc.dataset.name;
        const dstName = card.dataset.name;
        const order = pdfOrder[processName];
        const srcIdx = order.indexOf(srcName);
        const dstIdx = order.indexOf(dstName);
        if (srcIdx === -1 || dstIdx === -1) return;
        order.splice(srcIdx, 1);
        order.splice(dstIdx, 0, srcName);
        renderPreview(processName);
      });

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
      if (equipmentMachineInput) equipmentMachineInput.value = payload.equipment_machine || "";
      existingFiles.torno = payload.pdf_files || [];
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      existingFiles.torno.forEach((filename) => {
        pieceQuantities[filename] = Number(payload.piece_quantities?.[filename] || 1);
      });
      removedFiles.torno = new Set();
      pdfOrder.torno = Array.isArray(payload.pdf_order) && payload.pdf_order.length
        ? [...payload.pdf_order]
        : [...existingFiles.torno];
      emergencyFilename = payload.emergency_filename || "";
      renderPreviews();
    } catch (error) {
      existingFiles.torno = [];
      responsibleInput.value = "";
      operationTypeInput.value = "";
      if (equipmentMachineInput) equipmentMachineInput.value = "";
      emergencyFilename = "";
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
      pdfOrder.torno = [];
      emergencyFilename = "";
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

  // Drag-and-drop na zona de upload
  const tornoDropzone = document.getElementById("torno-dropzone");
  if (tornoDropzone) {
    tornoDropzone.addEventListener("dragover", function (event) {
      event.preventDefault();
      tornoDropzone.classList.add("dragover");
    });

    tornoDropzone.addEventListener("dragleave", function (event) {
      if (!tornoDropzone.contains(event.relatedTarget)) {
        tornoDropzone.classList.remove("dragover");
      }
    });

    tornoDropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      tornoDropzone.classList.remove("dragover");
      const files = event.dataTransfer.files;
      appendSelectedFiles("torno", files);
    });
  }

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
          equipment_machine: equipmentMachineInput ? equipmentMachineInput.value.trim() : "",
          emergency_filename: emergencyFilename,
          piece_quantities: buildVisiblePieceQuantities(),
          upload_piece_quantities: buildUploadPieceQuantities(),
          pdf_order: [...pdfOrder.torno],
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
      pdfOrder.torno = [];
      emergencyFilename = "";
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
      emergencyFilename = "";
      Object.keys(pieceQuantities).forEach((key) => {
        delete pieceQuantities[key];
      });
      loadScreenData(activeScreenId);
      openModal();
    },
  };
}
