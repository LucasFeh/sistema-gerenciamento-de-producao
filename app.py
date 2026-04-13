import os
import re
import shutil
import json
import queue
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, render_template, request, send_from_directory, stream_with_context
from werkzeug.utils import secure_filename

app = Flask(__name__)

BASE_STORAGE_DIR = Path(os.getenv("EQUIPMENTS_ROOT", "D:/MICROCONTROLLER_DEV/Sistema_Mecanica/equipamentos"))
BASE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

equipment_runtime = {}
event_subscribers = []


def publish_production_event(event_name, payload):
    message = f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"
    dead_queues = []

    for subscriber_queue in event_subscribers:
        try:
            subscriber_queue.put_nowait(message)
        except Exception:
            dead_queues.append(subscriber_queue)

    for dead_queue in dead_queues:
        if dead_queue in event_subscribers:
            event_subscribers.remove(dead_queue)


def production_events_stream():
    subscriber_queue = queue.Queue()
    event_subscribers.append(subscriber_queue)

    try:
        yield "event: connected\ndata: {}\n\n"
        while True:
            try:
                message = subscriber_queue.get(timeout=25)
                yield message
            except queue.Empty:
                yield "event: ping\ndata: {}\n\n"
    finally:
        if subscriber_queue in event_subscribers:
            event_subscribers.remove(subscriber_queue)


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
            "pending_fresa": False,
            "process": "Torno",
            "index": 0,
        }
    return equipment_runtime[equipment_name]


def active_equipment_name():
    for name, state in equipment_runtime.items():
        if state.get("active") or state.get("pending_fresa"):
            return name
    return None


def current_production_file(equipment_name):
    state = ensure_runtime_state(equipment_name)
    if not state["active"] or state.get("pending_fresa"):
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
        return "not-active"

    state["index"] += 1
    process_files = list_process_pdfs(equipment_name, state["process"])

    if state["index"] < len(process_files):
        return "next"

    if state["process"] == "Torno":
        fresa_files = list_process_pdfs(equipment_name, "Fresa")
        if fresa_files:
            state["active"] = False
            state["pending_fresa"] = True
            state["process"] = "Fresa"
            state["index"] = 0
            return "awaiting-fresa"

    state["active"] = False
    state["pending_fresa"] = False
    state["process"] = "Torno"
    state["index"] = 0
    return "finished"


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
        "active": state["active"] or state.get("pending_fresa", False),
        "pending_fresa_confirmation": state.get("pending_fresa", False),
        "current": current_file,
    }


def finalize_production_state(equipment_name):
    state = ensure_runtime_state(equipment_name)
    state["active"] = False
    state["pending_fresa"] = False
    state["process"] = "Torno"
    state["index"] = 0


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/producao")
def production_page():
    return render_template("producao.html")


@app.route("/api/eventos/producao", methods=["GET"])
def production_events():
    return Response(
        stream_with_context(production_events_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/producao/atual", methods=["GET"])
def current_production_status():
    current_active = active_equipment_name()
    if not current_active:
        return jsonify({"active": False, "equipment": None})

    snapshot = equipment_snapshot(current_active)
    if not snapshot["active"]:
        return jsonify({"active": False, "equipment": None})

    return jsonify({"active": True, "equipment": snapshot})


@app.route("/api/producao/finalizar", methods=["POST"])
def finish_current_active_production():
    current_active = active_equipment_name()
    if not current_active:
        return jsonify({"error": "Nao existe producao em andamento."}), 400

    result = advance_production(current_active)
    publish_production_event(
        "production-updated",
        {
            "equipmentName": current_active,
            "result": result,
            "timestamp": int(time.time() * 1000),
        },
    )
    if result in {"finished", "not-active"}:
        return jsonify({"has_next": False, "active": False, "equipment": None, "result": result})

    snapshot = equipment_snapshot(current_active)
    return jsonify({"has_next": True, "active": snapshot["active"], "equipment": snapshot, "result": result})


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

    current_active = active_equipment_name()
    if current_active and current_active != equipment_name:
        return jsonify({"error": f"Ja existe producao em andamento para '{current_active}'. Finalize antes de iniciar outra."}), 409

    current_state = ensure_runtime_state(equipment_name)
    if current_state["active"]:
        return jsonify({"error": "Este equipamento ja esta em producao."}), 409

    state = current_state
    state["active"] = True
    state["pending_fresa"] = False
    state["process"] = "Torno" if has_torno else "Fresa"
    state["index"] = 0

    return jsonify(
        {
            "message": "Producao iniciada.",
            "redirect": "/producao",
            "equipment": equipment_snapshot(equipment_name),
        }
    )


@app.route("/api/equipamentos/<equipment_name>/finalizar", methods=["POST"])
def finish_current_piece(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    result = advance_production(equipment_name)
    publish_production_event(
        "production-updated",
        {
            "equipmentName": equipment_name,
            "result": result,
            "timestamp": int(time.time() * 1000),
        },
    )
    snapshot = equipment_snapshot(equipment_name)
    return jsonify(
        {
            "result": result,
            "has_next": result in {"next", "awaiting-fresa"},
            "equipment": snapshot,
            "redirect": "/producao" if result in {"next", "awaiting-fresa"} else "/",
        }
    )


@app.route("/api/equipamentos/<equipment_name>/decidir-fresa", methods=["POST"])
def decide_fresa(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    state = ensure_runtime_state(equipment_name)
    if not state.get("pending_fresa"):
        return jsonify({"error": "Nao ha decisao pendente para Fresa."}), 400

    proceed_raw = request.json.get("proceed") if request.is_json else request.form.get("proceed")
    proceed = str(proceed_raw).lower() in {"1", "true", "sim", "yes"}

    if proceed:
        state["pending_fresa"] = False
        state["active"] = True
        state["process"] = "Fresa"
        state["index"] = 0
        publish_production_event(
            "production-updated",
            {
                "equipmentName": equipment_name,
                "result": "fresa-started",
                "timestamp": int(time.time() * 1000),
            },
        )
        return jsonify({"message": "Producao da Fresa iniciada.", "equipment": equipment_snapshot(equipment_name)})

    finalize_production_state(equipment_name)
    publish_production_event(
        "production-updated",
        {
            "equipmentName": equipment_name,
            "result": "finished-without-fresa",
            "timestamp": int(time.time() * 1000),
        },
    )
    return jsonify({"message": "Producao finalizada sem Fresa.", "equipment": equipment_snapshot(equipment_name)})


@app.route("/arquivos/<equipment_name>/<process_name>/<filename>")
def serve_piece_file(equipment_name, process_name, filename):
    if process_name not in {"Torno", "Fresa"}:
        abort(404)
    return send_from_directory(process_dir(equipment_name, process_name), filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
