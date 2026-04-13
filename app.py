import os
import re
import shutil
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)

BASE_STORAGE_DIR = Path(os.getenv("EQUIPMENTS_ROOT", "D:/MICROCONTROLLER_DEV/Sistema_Mecanica/equipamentos"))
BASE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

equipment_runtime = {}


def normalize_equipment_name(raw_name):
    cleaned = " ".join(raw_name.strip().split())
    if not cleaned:
        return ""
    return cleaned


def process_dir(equipment_name, process_name):
    return BASE_STORAGE_DIR / equipment_name / process_name


def piece_sort_key(filename):
    match = re.match(r"^Peca_(\d+)\.pdf$", filename, flags=re.IGNORECASE)
    if not match:
        return (1, filename.lower())
    return (0, int(match.group(1)))


def list_process_pdfs(equipment_name, process_name):
    directory = process_dir(equipment_name, process_name)
    if not directory.exists():
        return []
    files = [p.name for p in directory.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"]
    return sorted(files, key=piece_sort_key)


def next_piece_index(equipment_name, process_name):
    files = list_process_pdfs(equipment_name, process_name)
    max_index = 0

    for filename in files:
        match = re.match(r"^Peca_(\d+)\.pdf$", filename, flags=re.IGNORECASE)
        if not match:
            continue
        max_index = max(max_index, int(match.group(1)))

    return max_index + 1


def save_uploaded_pdfs(equipment_name, process_name, files):
    directory = process_dir(equipment_name, process_name)
    directory.mkdir(parents=True, exist_ok=True)

    next_index = next_piece_index(equipment_name, process_name)

    for file_storage in files:
        if not file_storage or not file_storage.filename:
            continue
        safe_name = secure_filename(file_storage.filename)
        if not safe_name.lower().endswith(".pdf"):
            continue
        target_name = f"Peca_{next_index}.pdf"
        file_storage.save(directory / target_name)
        next_index += 1


def delete_process_pdfs(equipment_name, process_name, filenames):
    directory = process_dir(equipment_name, process_name)
    if not directory.exists():
        return

    for filename in filenames:
        safe_name = Path(filename).name
        target = directory / safe_name
        if target.exists() and target.is_file() and target.suffix.lower() == ".pdf":
            target.unlink()


def ensure_runtime_state(equipment_name):
    if equipment_name not in equipment_runtime:
        equipment_runtime[equipment_name] = {
            "active": False,
            "process": "Torno",
            "index": 0,
        }
    return equipment_runtime[equipment_name]


def current_production_file(equipment_name):
    state = ensure_runtime_state(equipment_name)
    if not state["active"]:
        return None

    current_process = state["process"]
    current_index = state["index"]
    current_files = list_process_pdfs(equipment_name, current_process)

    if current_index >= len(current_files):
        return None

    return {
        "process": current_process,
        "filename": current_files[current_index],
        "index": current_index,
        "total": len(current_files),
    }


def advance_production(equipment_name):
    state = ensure_runtime_state(equipment_name)
    if not state["active"]:
        return False

    state["index"] += 1
    process_files = list_process_pdfs(equipment_name, state["process"])

    if state["index"] < len(process_files):
        return True

    if state["process"] == "Torno":
        state["process"] = "Fresa"
        state["index"] = 0
        fresa_files = list_process_pdfs(equipment_name, "Fresa")
        if fresa_files:
            return True

    state["active"] = False
    state["process"] = "Torno"
    state["index"] = 0
    return False


def equipment_snapshot(equipment_name):
    torno_files = list_process_pdfs(equipment_name, "Torno")
    fresa_files = list_process_pdfs(equipment_name, "Fresa")
    state = ensure_runtime_state(equipment_name)
    current_file = current_production_file(equipment_name)

    return {
        "name": equipment_name,
        "torno_count": len(torno_files),
        "fresa_count": len(fresa_files),
        "torno_files": torno_files,
        "fresa_files": fresa_files,
        "active": state["active"],
        "current": current_file,
    }


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/producao/<equipment_name>")
def production_page(equipment_name):
    equipment_dir = BASE_STORAGE_DIR / equipment_name
    if not equipment_dir.exists():
        abort(404)

    snapshot = equipment_snapshot(equipment_name)
    return render_template("producao.html", equipment=snapshot)


@app.route("/api/equipamentos", methods=["GET"])
def list_equipments():
    names = sorted([p.name for p in BASE_STORAGE_DIR.iterdir() if p.is_dir()])
    return jsonify([equipment_snapshot(name) for name in names])


@app.route("/api/equipamentos", methods=["POST"])
def create_equipment():
    equipment_name = normalize_equipment_name(request.form.get("name", ""))
    if not equipment_name:
        return jsonify({"error": "Nome do equipamento e obrigatorio."}), 400

    root = BASE_STORAGE_DIR / equipment_name
    created_now = not root.exists()

    (root / "Torno").mkdir(parents=True, exist_ok=True)
    (root / "Fresa").mkdir(parents=True, exist_ok=True)

    delete_process_pdfs(equipment_name, "Torno", request.form.getlist("remove_torno_files"))
    delete_process_pdfs(equipment_name, "Fresa", request.form.getlist("remove_fresa_files"))

    save_uploaded_pdfs(equipment_name, "Torno", request.files.getlist("torno_pdfs"))
    save_uploaded_pdfs(equipment_name, "Fresa", request.files.getlist("fresa_pdfs"))
    ensure_runtime_state(equipment_name)

    snapshot = equipment_snapshot(equipment_name)
    snapshot["created"] = created_now
    status = 201 if created_now else 200
    return jsonify(snapshot), status


@app.route("/api/equipamentos/<equipment_name>", methods=["GET"])
def equipment_detail(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists():
        return jsonify({"error": "Equipamento nao encontrado."}), 404
    return jsonify(equipment_snapshot(equipment_name))


@app.route("/api/equipamentos/<equipment_name>", methods=["DELETE"])
def delete_equipment(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists() or not root.is_dir():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    shutil.rmtree(root)
    equipment_runtime.pop(equipment_name, None)
    return jsonify({"message": "Equipamento apagado com sucesso."})


@app.route("/api/equipamentos/<equipment_name>/iniciar", methods=["POST"])
def start_production(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    has_torno = len(list_process_pdfs(equipment_name, "Torno")) > 0
    has_fresa = len(list_process_pdfs(equipment_name, "Fresa")) > 0
    if not has_torno and not has_fresa:
        return jsonify({"error": "Nao ha PDFs para produzir."}), 400

    state = ensure_runtime_state(equipment_name)
    state["active"] = True
    state["process"] = "Torno" if has_torno else "Fresa"
    state["index"] = 0

    return jsonify(
        {
            "message": "Producao iniciada.",
            "redirect": f"/producao/{equipment_name}",
            "equipment": equipment_snapshot(equipment_name),
        }
    )


@app.route("/api/equipamentos/<equipment_name>/finalizar", methods=["POST"])
def finish_current_piece(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    has_next = advance_production(equipment_name)
    return jsonify(
        {
            "has_next": has_next,
            "equipment": equipment_snapshot(equipment_name),
            "redirect": f"/producao/{equipment_name}" if has_next else "/",
        }
    )


@app.route("/arquivos/<equipment_name>/<process_name>/<filename>")
def serve_piece_file(equipment_name, process_name, filename):
    if process_name not in {"Torno", "Fresa"}:
        abort(404)
    return send_from_directory(process_dir(equipment_name, process_name), filename)


if __name__ == "__main__":
    app.run(debug=True)
