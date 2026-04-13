import { finishCurrentPiece } from "./api.js";

const finishButton = document.getElementById("btn-finalizar");

if (finishButton) {
  const equipmentName = document.body.dataset.equipmentName || "";

  finishButton.onclick = async function () {
    try {
      const payload = await finishCurrentPiece(equipmentName);
      window.location.href = payload.redirect;
    } catch (error) {
      alert(error.message || "Erro ao finalizar etapa.");
    }
  };
}
