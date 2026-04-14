import os
import re
import shutil
import json
import queue
import time
import io
from pathlib import Path

from flask import Flask, Response, abort, jsonify, render_template, request, send_from_directory, stream_with_context
from werkzeug.utils import secure_filename

app = Flask(__name__)

BASE_STORAGE_DIR = Path(os.getenv("EQUIPMENTS_ROOT", "D:/MICROCONTROLLER_DEV/Sistema_Mecanica/equipamentos"))
BASE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

SCREEN_SLOTS = 5
SCREEN_CONFIG_FILE = BASE_STORAGE_DIR / "telas_config.json"

equipment_runtime = {}
screen_runtime = {}
event_subscribers = []


def screen_key(slot_id):
    return f"tela_{slot_id}"


def default_screen_name(slot_id):
    return f"Torno{slot_id}"


def valid_screen_slot(slot_id):
    return 1 <= slot_id <= SCREEN_SLOTS


def read_screen_config():
    defaults = {screen_key(slot_id): default_screen_name(slot_id) for slot_id in range(1, SCREEN_SLOTS + 1)}

    if not SCREEN_CONFIG_FILE.exists() or not SCREEN_CONFIG_FILE.is_file():
        return defaults

    try:
        payload = json.loads(SCREEN_CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return defaults

    merged = defaults.copy()
    for slot_id in range(1, SCREEN_SLOTS + 1):
        key = screen_key(slot_id)
        candidate = normalize_equipment_name(str(payload.get(key, "")))
        if candidate:
            merged[key] = candidate

    return merged


def write_screen_config(config_payload):
    SCREEN_CONFIG_FILE.write_text(json.dumps(config_payload, ensure_ascii=True), encoding="utf-8")


def screen_dir(slot_id):
    directory = BASE_STORAGE_DIR / screen_key(slot_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def screen_metadata_file(slot_id):
    return screen_dir(slot_id) / "screen_metadata.json"


def normalize_piece_quantity(raw_value):
    try:
        value = int(raw_value)
    except Exception:
        return 1
    return max(1, value)


def read_screen_metadata(slot_id):
    default_payload = {
        "responsible": "",
        "operation_type": "",
        "piece_quantities": {},
    }

    metadata_path = screen_metadata_file(slot_id)
    if not metadata_path.exists() or not metadata_path.is_file():
        return default_payload

    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return default_payload

    piece_quantities = payload.get("piece_quantities", {})
    if not isinstance(piece_quantities, dict):
        piece_quantities = {}

    normalized_quantities = {
        str(filename): normalize_piece_quantity(quantity)
        for filename, quantity in piece_quantities.items()
        if str(filename).lower().endswith(".pdf")
    }

    return {
        "responsible": normalize_responsible(payload.get("responsible", "")),
        "operation_type": normalize_equipment_name(str(payload.get("operation_type", ""))),
        "piece_quantities": normalized_quantities,
    }


def write_screen_metadata(slot_id, responsible, operation_type, piece_quantities):
    payload = {
        "responsible": normalize_responsible(responsible),
        "operation_type": normalize_equipment_name(str(operation_type or "")),
        "piece_quantities": {
            str(filename): normalize_piece_quantity(quantity)
            for filename, quantity in (piece_quantities or {}).items()
            if str(filename).lower().endswith(".pdf")
        },
    }

    screen_metadata_file(slot_id).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def list_screen_pdfs(slot_id):
    directory = screen_dir(slot_id)
    files = [p.name for p in directory.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"]
    return sorted(files, key=str.lower)


def ensure_unique_filename(directory, filename):
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    candidate = filename
    index = 1

    while (directory / candidate).exists():
        candidate = f"{stem}_{index}{suffix}"
        index += 1

    return candidate


def save_screen_pdfs(slot_id, files, upload_quantities=None):
    directory = screen_dir(slot_id)
    saved_files = []
    saved_quantities = {}
    upload_quantities = upload_quantities or {}

    for file_storage in files:
        if not file_storage or not file_storage.filename:
            continue
        safe_name = secure_filename(file_storage.filename)
        if not safe_name.lower().endswith(".pdf"):
            continue
        target_name = ensure_unique_filename(directory, safe_name)
        file_storage.save(directory / target_name)
        saved_files.append(target_name)
        raw_quantity = upload_quantities.get(file_storage.filename)
        saved_quantities[target_name] = normalize_piece_quantity(raw_quantity)

    return saved_files, saved_quantities


def delete_screen_pdfs(slot_id, filenames):
    directory = screen_dir(slot_id)
    removed_files = []
    for filename in filenames:
        safe_name = Path(filename).name
        target = directory / safe_name
        if target.exists() and target.is_file() and target.suffix.lower() == ".pdf":
            target.unlink()
            removed_files.append(safe_name)

    return removed_files


def normalize_queue_entries(entries):
    normalized = []

    for entry in list(entries or []):
        candidate = entry

        if isinstance(candidate, (list, tuple)):
            if len(candidate) == 0:
                continue
            candidate = candidate[0]

        candidate = str(candidate or "").strip()
        if not candidate.lower().endswith(".pdf"):
            continue

        normalized.append(candidate)

    return normalized


def build_piece_statuses(state, files, piece_quantities):
    history = state.get("piece_history", [])
    production_started = state.get("production_started", False)
    queue = normalize_queue_entries(state.get("queue", [])) if production_started else normalize_queue_entries(files)
    if not queue and files:
        queue = normalize_queue_entries(files)

    state["queue"] = queue

    done_count = len(history)
    current_index = int(state.get("index", 0))
    active = bool(state.get("active", False))
    waiting_confirmation = bool(state.get("waiting_confirmation", False))

    statuses = []
    for index, filename in enumerate(queue):
        status = "pending"
        if index < done_count:
            status = "done"
        elif waiting_confirmation and index == 0:
            status = "waiting_confirmation"
        elif active and index == current_index:
            status = "current"

        statuses.append(
            {
                "piece_number": index + 1,
                "piece_label": f"Peca {index + 1}",
                "filename": filename,
                "quantity": normalize_piece_quantity(piece_quantities.get(filename, 1)),
                "status": status,
            }
        )

    return statuses


def can_download_screen_report(state, piece_statuses):
    if not state.get("production_started"):
        return False
    if state.get("active"):
        return False
    if not piece_statuses:
        return False
    return all(piece.get("status") == "done" for piece in piece_statuses)


def report_lines_for_screen(slot_id):
    snapshot = screen_snapshot(slot_id)
    history = snapshot.get("piece_history", [])

    lines = []
    lines.append("Relatorio de Producao")
    lines.append("")
    lines.append(f"Tela: {snapshot.get('name', f'Tela {slot_id}')}")
    lines.append(f"Responsavel: {snapshot.get('responsible', '') or 'Nao informado'}")
    lines.append(f"Tipo de operacao: {snapshot.get('operation_type', '') or 'Nao informado'}")
    lines.append(f"Total de pecas finalizadas: {len(history)}")
    lines.append("")
    lines.append("Historico por peca:")

    if not history:
        lines.append("- Nenhuma peca finalizada.")
        return lines

    for entry in history:
        started = time.strftime("%H:%M:%S", time.localtime((entry.get("started_at_ms") or 0) / 1000))
        ended = time.strftime("%H:%M:%S", time.localtime((entry.get("ended_at_ms") or 0) / 1000))
        duration_total = max(0, int((entry.get("duration_ms") or 0) / 1000))
        duration_min = duration_total // 60
        duration_sec = duration_total % 60
        duration_str = f"{duration_min:02}:{duration_sec:02}"
        lines.append(
            f"- {entry.get('piece_name', 'Peca')}: comecou {started} | terminou {ended} | tempo {duration_str}"
        )

    return lines


def reset_screen_tracking(slot_id):
    state = ensure_screen_runtime(slot_id)
    state["active"] = False
    state["production_started"] = False
    state["waiting_confirmation"] = False
    state["paused"] = False
    state["paused_at_ms"] = None
    state["paused_total_ms"] = 0
    state["index"] = 0
    state["piece_started_at_ms"] = None
    state["piece_history"] = []
    state["queue"] = []


def current_elapsed_ms(state, now_ms=None):
    started_at = state.get("piece_started_at_ms")
    if not started_at:
        return 0

    now_value = int(now_ms if now_ms is not None else time.time() * 1000)
    paused_total = int(state.get("paused_total_ms", 0))

    if state.get("paused"):
        paused_at = int(state.get("paused_at_ms") or now_value)
        return max(0, paused_at - int(started_at) - paused_total)

    return max(0, now_value - int(started_at) - paused_total)


def screen_snapshot(slot_id):
    config = read_screen_config()
    key = screen_key(slot_id)
    files = list_screen_pdfs(slot_id)

    state = ensure_screen_runtime(slot_id)
    current = current_screen_piece(slot_id)
    metadata = read_screen_metadata(slot_id)
    piece_statuses = build_piece_statuses(state, files, metadata.get("piece_quantities", {}))

    return {
        "id": slot_id,
        "key": key,
        "name": config.get(key, default_screen_name(slot_id)),
        "pdf_count": len(files),
        "pdf_files": files,
        "active": state.get("active", False),
        "paused": state.get("paused", False),
        "waiting_confirmation": state.get("waiting_confirmation", False),
        "production_started": state.get("production_started", False),
        "current": current,
        "piece_history": state.get("piece_history", []),
        "piece_statuses": piece_statuses,
        "report_available": can_download_screen_report(state, piece_statuses),
        "responsible": metadata.get("responsible", ""),
        "operation_type": metadata.get("operation_type", ""),
        "piece_quantities": metadata.get("piece_quantities", {}),
    }


def ensure_screen_runtime(slot_id):
    if slot_id not in screen_runtime:
        screen_runtime[slot_id] = {
            "active": False,
            "production_started": False,
            "waiting_confirmation": False,
            "paused": False,
            "paused_at_ms": None,
            "paused_total_ms": 0,
            "index": 0,
            "piece_started_at_ms": None,
            "piece_history": [],
            "queue": [],
        }
    return screen_runtime[slot_id]


def apply_screen_queue_updates(slot_id, added_files, removed_files):
    state = ensure_screen_runtime(slot_id)
    queue = normalize_queue_entries(state.get("queue", []))
    current_index = int(state.get("index", 0))

    added_files = normalize_queue_entries(added_files)
    removed_files = normalize_queue_entries(removed_files)

    if removed_files and queue:
        removed_set = set(removed_files)
        removed_before_current = 0
        filtered_queue = []

        for index, filename in enumerate(queue):
            if filename in removed_set:
                if index < current_index:
                    removed_before_current += 1
                continue
            filtered_queue.append(filename)

        queue = filtered_queue
        current_index = max(0, current_index - removed_before_current)

    if added_files:
        queue.extend(added_files)

    if state.get("production_started"):
        state["queue"] = queue
        state["index"] = current_index

        if state.get("active") and current_index >= len(queue):
            state["active"] = False
            state["piece_started_at_ms"] = None

        if state.get("active") and state.get("piece_started_at_ms") is None and current_index < len(queue):
            state["piece_started_at_ms"] = int(time.time() * 1000)

        # If production was finished and new pieces are added, continue automatically.
        if (not state.get("active")) and added_files and current_index < len(queue):
            state["active"] = True
            state["paused"] = False
            state["paused_at_ms"] = None
            state["paused_total_ms"] = 0
            state["piece_started_at_ms"] = int(time.time() * 1000)


def current_screen_piece(slot_id):
    state = ensure_screen_runtime(slot_id)
    if not state.get("active"):
        return None

    files = normalize_queue_entries(state.get("queue", []))
    if not files:
        files = normalize_queue_entries(list_screen_pdfs(slot_id))
    state["queue"] = files
    current_index = int(state.get("index", 0))

    if current_index >= len(files):
        return None

    metadata = read_screen_metadata(slot_id)
    current_filename = files[current_index]

    return {
        "process": "Tela",
        "filename": current_filename,
        "piece_name": Path(current_filename).stem,
        "index": current_index,
        "total": len(files),
        "quantity": normalize_piece_quantity(metadata.get("piece_quantities", {}).get(current_filename, 1)),
        "started_at_ms": state.get("piece_started_at_ms"),
        "elapsed_ms": current_elapsed_ms(state),
        "paused": bool(state.get("paused", False)),
    }


def start_screen_production(slot_id):
    files = normalize_queue_entries(list_screen_pdfs(slot_id))
    if len(files) == 0:
        return None, "empty"

    state = ensure_screen_runtime(slot_id)
    if state.get("active") or state.get("waiting_confirmation"):
        return state, "already-active"

    state["production_started"] = True
    state["waiting_confirmation"] = True
    state["paused"] = False
    state["paused_at_ms"] = None
    state["paused_total_ms"] = 0
    state["index"] = 0
    state["piece_started_at_ms"] = None
    state["piece_history"] = []
    state["queue"] = files
    return state, "waiting"


def confirm_screen_production(slot_id):
    state = ensure_screen_runtime(slot_id)
    if not state.get("waiting_confirmation"):
        return state, "not-waiting"
    if state.get("active"):
        return state, "already-active"

    state["active"] = True
    state["waiting_confirmation"] = False
    state["piece_started_at_ms"] = int(time.time() * 1000)
    return state, "confirmed"


def advance_screen_production(slot_id):
    state = ensure_screen_runtime(slot_id)
    if not state.get("active"):
        return "not-active"
    if state.get("paused"):
        return "paused"

    files = normalize_queue_entries(state.get("queue", []))
    state["queue"] = files
    now_ms = int(time.time() * 1000)
    current_index = int(state.get("index", 0))

    if current_index < len(files):
        current_filename = files[current_index]
        start_ms = state.get("piece_started_at_ms") or now_ms
        duration_ms = current_elapsed_ms(state, now_ms)
        state["piece_history"].append(
            {
                "process": "Tela",
                "piece_name": Path(current_filename).stem,
                "filename": current_filename,
                "started_at_ms": start_ms,
                "ended_at_ms": now_ms,
                "duration_ms": duration_ms,
            }
        )

    state["index"] = current_index + 1

    if state["index"] < len(files):
        state["paused"] = False
        state["paused_at_ms"] = None
        state["paused_total_ms"] = 0
        state["piece_started_at_ms"] = int(time.time() * 1000)
        return "next"

    state["active"] = False
    state["paused"] = False
    state["paused_at_ms"] = None
    state["paused_total_ms"] = 0
    state["piece_started_at_ms"] = None
    return "finished"


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


def metadata_file(equipment_name):
    return BASE_STORAGE_DIR / equipment_name / "metadata.json"


def normalize_responsible(raw_name):
    return " ".join((raw_name or "").strip().split())


def read_equipment_metadata(equipment_name):
    metadata_path = metadata_file(equipment_name)
    if not metadata_path.exists() or not metadata_path.is_file():
        return {"responsible": ""}

    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return {"responsible": ""}

    return {
        "responsible": normalize_responsible(payload.get("responsible", "")),
    }


def write_equipment_metadata(equipment_name, responsible_name):
    root = BASE_STORAGE_DIR / equipment_name
    root.mkdir(parents=True, exist_ok=True)
    payload = {
        "responsible": normalize_responsible(responsible_name),
    }
    metadata_file(equipment_name).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


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
            "piece_started_at_ms": None,
            "piece_history": [],
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
        "started_at_ms": state.get("piece_started_at_ms"),
    }


def advance_production(equipment_name):
    state = ensure_runtime_state(equipment_name)
    if not state["active"]:
        return "not-active"

    now_ms = int(time.time() * 1000)
    current_process = state["process"]
    current_index = state["index"]
    current_files = list_process_pdfs(equipment_name, current_process)

    if current_index < len(current_files):
        current_filename = current_files[current_index]
        start_ms = state.get("piece_started_at_ms") or now_ms
        duration_ms = max(0, now_ms - start_ms)
        state["piece_history"].append(
            {
                "process": current_process,
                "piece_name": Path(current_filename).stem,
                "filename": current_filename,
                "started_at_ms": start_ms,
                "ended_at_ms": now_ms,
                "duration_ms": duration_ms,
            }
        )

    state["index"] += 1
    process_files = list_process_pdfs(equipment_name, state["process"])

    if state["index"] < len(process_files):
        state["piece_started_at_ms"] = int(time.time() * 1000)
        return "next"

    if state["process"] == "Torno":
        fresa_files = list_process_pdfs(equipment_name, "Fresa")
        if fresa_files:
            state["active"] = False
            state["pending_fresa"] = True
            state["process"] = "Fresa"
            state["index"] = 0
            state["piece_started_at_ms"] = None
            return "awaiting-fresa"

    state["active"] = False
    state["pending_fresa"] = False
    state["process"] = "Torno"
    state["index"] = 0
    state["piece_started_at_ms"] = None
    return "finished"


def equipment_snapshot(equipment_name):
    torno_files = list_process_pdfs(equipment_name, "Torno")
    fresa_files = list_process_pdfs(equipment_name, "Fresa")
    state = ensure_runtime_state(equipment_name)
    current_file = current_production_file(equipment_name)
    metadata = read_equipment_metadata(equipment_name)

    return {
        "name": equipment_name,
        "torno_count": len(torno_files),
        "fresa_count": len(fresa_files),
        "torno_files": torno_files,
        "fresa_files": fresa_files,
        "active": state["active"] or state.get("pending_fresa", False),
        "pending_fresa_confirmation": state.get("pending_fresa", False),
        "current": current_file,
        "piece_history": state.get("piece_history", []),
        "responsible": metadata.get("responsible", ""),
    }


def pdf_escape(text):
    return str(text).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_simple_pdf(lines):
    content_lines = ["BT", "/F1 12 Tf", "14 TL", "40 800 Td"]

    for line in lines:
        content_lines.append(f"({pdf_escape(line)}) Tj")
        content_lines.append("T*")

    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("latin-1", errors="replace")

    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n"
    )
    objects.append(
        b"4 0 obj\n<< /Length " + str(len(content_stream)).encode("ascii") + b" >>\nstream\n" + content_stream + b"\nendstream\nendobj\n"
    )
    objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")

    offsets = [0]
    for obj in objects:
        offsets.append(pdf.tell())
        pdf.write(obj)

    xref_pos = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.write(b"0000000000 65535 f \n")

    for offset in offsets[1:]:
        pdf.write(f"{offset:010} 00000 n \n".encode("ascii"))

    pdf.write(
        (
            "trailer\n"
            f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_pos}\n"
            "%%EOF"
        ).encode("ascii")
    )

    return pdf.getvalue()


def report_lines_for_equipment(equipment_name):
    snapshot = equipment_snapshot(equipment_name)
    history = snapshot.get("piece_history", [])

    lines = []
    lines.append("Relatorio de Producao")
    lines.append("")
    lines.append(f"Equipamento: {equipment_name}")
    lines.append(f"Total de pecas finalizadas: {len(history)}")
    lines.append(f"Pecas Torno: {len([h for h in history if h.get('process') == 'Torno'])}")
    lines.append(f"Pecas Fresa: {len([h for h in history if h.get('process') == 'Fresa'])}")
    lines.append("")
    lines.append("Historico por peca:")

    if not history:
        lines.append("- Nenhuma peca finalizada.")
        return lines

    for entry in history:
        started = time.strftime("%H:%M:%S", time.localtime((entry.get("started_at_ms") or 0) / 1000))
        ended = time.strftime("%H:%M:%S", time.localtime((entry.get("ended_at_ms") or 0) / 1000))
        duration_total = max(0, int((entry.get("duration_ms") or 0) / 1000))
        duration_min = duration_total // 60
        duration_sec = duration_total % 60
        duration_str = f"{duration_min:02}:{duration_sec:02}"
        lines.append(
            f"- {entry.get('piece_name', 'Peca')}: comecou {started} | terminou {ended} | tempo {duration_str}"
        )

    return lines


def finalize_production_state(equipment_name):
    state = ensure_runtime_state(equipment_name)
    state["active"] = False
    state["pending_fresa"] = False
    state["process"] = "Torno"
    state["index"] = 0
    state["piece_started_at_ms"] = None


def reset_equipment_tracking(equipment_name):
    state = ensure_runtime_state(equipment_name)
    state["active"] = False
    state["pending_fresa"] = False
    state["process"] = "Torno"
    state["index"] = 0
    state["piece_started_at_ms"] = None
    state["piece_history"] = []


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/producao")
@app.route("/producao/<int:slot_id>")
def production_page(slot_id=1):
    if not valid_screen_slot(slot_id):
        abort(404)
    return render_template("producao.html", slot_id=slot_id)


@app.route("/api/telas", methods=["GET"])
def list_screens():
    return jsonify([screen_snapshot(slot_id) for slot_id in range(1, SCREEN_SLOTS + 1)])


@app.route("/api/telas/<int:slot_id>", methods=["GET"])
def get_screen_detail(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404
    return jsonify(screen_snapshot(slot_id))


@app.route("/api/telas/<int:slot_id>/nome", methods=["POST"])
def update_screen_name(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    if request.is_json:
        raw_name = request.json.get("name", "")
    else:
        raw_name = request.form.get("name", "")

    clean_name = normalize_equipment_name(str(raw_name))
    if not clean_name:
        return jsonify({"error": "Nome da tela e obrigatorio."}), 400

    config = read_screen_config()
    config[screen_key(slot_id)] = clean_name
    write_screen_config(config)
    return jsonify(screen_snapshot(slot_id))


@app.route("/api/telas/<int:slot_id>/pdfs", methods=["POST"])
def update_screen_pdfs(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    metadata = read_screen_metadata(slot_id)

    responsible_name = request.form.get("responsible", metadata.get("responsible", ""))
    operation_type = request.form.get("operation_type", metadata.get("operation_type", ""))

    incoming_quantities = {}
    incoming_quantities_raw = request.form.get("piece_quantities", "")
    if incoming_quantities_raw:
        try:
            payload = json.loads(incoming_quantities_raw)
            if isinstance(payload, dict):
                incoming_quantities = payload
        except Exception:
            incoming_quantities = {}

    upload_quantities = {}
    upload_quantities_raw = request.form.get("upload_piece_quantities", "")
    if upload_quantities_raw:
        try:
            payload = json.loads(upload_quantities_raw)
            if isinstance(payload, dict):
                upload_quantities = payload
        except Exception:
            upload_quantities = {}

    removed_files = delete_screen_pdfs(slot_id, request.form.getlist("remove_files"))
    added_files, added_quantities = save_screen_pdfs(slot_id, request.files.getlist("pdfs"), upload_quantities)
    apply_screen_queue_updates(slot_id, added_files, removed_files)

    piece_quantities = {}
    for filename, quantity in incoming_quantities.items():
        safe_name = str(filename or "").strip()
        if not safe_name.lower().endswith(".pdf"):
            continue
        piece_quantities[safe_name] = normalize_piece_quantity(quantity)

    for removed in removed_files:
        piece_quantities.pop(removed, None)

    for added in added_files:
        piece_quantities[added] = normalize_piece_quantity(added_quantities.get(added, 1))

    current_files = set(list_screen_pdfs(slot_id))
    piece_quantities = {
        filename: quantity
        for filename, quantity in piece_quantities.items()
        if filename in current_files
    }

    write_screen_metadata(slot_id, responsible_name, operation_type, piece_quantities)

    return jsonify(screen_snapshot(slot_id))


@app.route("/api/telas/<int:slot_id>/iniciar", methods=["POST"])
def start_screen(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    _, status = start_screen_production(slot_id)
    if status == "empty":
        return jsonify({"error": "Nao ha PDFs para produzir nesta tela."}), 400
    if status == "already-active":
        return jsonify({"error": "Esta tela ja esta em producao."}), 409

    publish_production_event(
        "production-updated",
        {
            "screenId": slot_id,
            "result": "waiting_confirmation",
            "timestamp": int(time.time() * 1000),
        },
    )

    return jsonify({"message": "Aguardando confirmacao.", "screen": screen_snapshot(slot_id)})


@app.route("/api/telas/<int:slot_id>/confirmar", methods=["POST"])
def confirm_screen(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    _, status = confirm_screen_production(slot_id)
    if status == "not-waiting":
        return jsonify({"error": "Producao nao esta aguardando confirmacao."}), 409
    if status == "already-active":
        return jsonify({"error": "Esta tela ja esta em producao."}), 409

    publish_production_event(
        "production-updated",
        {
            "screenId": slot_id,
            "result": "confirmed",
            "timestamp": int(time.time() * 1000),
        },
    )

    return jsonify({"message": "Producao iniciada.", "screen": screen_snapshot(slot_id)})


@app.route("/api/telas/<int:slot_id>/finalizar", methods=["POST"])
def finish_screen_piece(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    result = advance_screen_production(slot_id)
    publish_production_event(
        "production-updated",
        {
            "screenId": slot_id,
            "result": result,
            "timestamp": int(time.time() * 1000),
        },
    )

    return jsonify(
        {
            "result": result,
            "has_next": result == "next",
            "screen": screen_snapshot(slot_id),
        }
    )


@app.route("/api/telas/<int:slot_id>/pausa", methods=["POST"])
def toggle_screen_pause(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    state = ensure_screen_runtime(slot_id)
    if not state.get("active"):
        return jsonify({"error": "Nao ha producao ativa para pausar."}), 400

    now_ms = int(time.time() * 1000)
    if state.get("paused"):
        paused_at = int(state.get("paused_at_ms") or now_ms)
        state["paused_total_ms"] = int(state.get("paused_total_ms", 0)) + max(0, now_ms - paused_at)
        state["paused"] = False
        state["paused_at_ms"] = None
        result = "resumed"
    else:
        state["paused"] = True
        state["paused_at_ms"] = now_ms
        result = "paused"

    publish_production_event(
        "production-updated",
        {
            "screenId": slot_id,
            "result": result,
            "timestamp": now_ms,
        },
    )

    return jsonify({"result": result, "screen": screen_snapshot(slot_id)})


@app.route("/api/telas/<int:slot_id>/visualizacao", methods=["GET"])
def get_screen_visualization(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    snapshot = screen_snapshot(slot_id)
    current = snapshot.get("current")
    current_file = current.get("filename") if current else None
    return jsonify(
        {
            "screen": snapshot,
            "current_file": current_file,
        }
    )


@app.route("/api/telas/<int:slot_id>/relatorio", methods=["GET"])
def download_screen_report(slot_id):
    if not valid_screen_slot(slot_id):
        return jsonify({"error": "Tela nao encontrada."}), 404

    snapshot = screen_snapshot(slot_id)
    if not snapshot.get("report_available"):
        return jsonify({"error": "Relatorio disponivel somente quando todas as pecas estiverem finalizadas."}), 400

    lines = report_lines_for_screen(slot_id)
    pdf_content = build_simple_pdf(lines)

    reset_screen_tracking(slot_id)
    publish_production_event(
        "production-updated",
        {
            "screenId": slot_id,
            "result": "report-downloaded",
            "timestamp": int(time.time() * 1000),
        },
    )

    filename = f"relatorio_tela_{slot_id}.pdf"
    return Response(
        pdf_content,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={secure_filename(filename)}",
        },
    )


@app.route("/arquivos/telas/<int:slot_id>/<filename>")
def serve_screen_file(slot_id, filename):
    if not valid_screen_slot(slot_id):
        abort(404)
    return send_from_directory(screen_dir(slot_id), filename)


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
    snapshot = equipment_snapshot(current_active)
    should_offer_report = result == "finished" and len(snapshot.get("piece_history", [])) > 0
    publish_production_event(
        "production-updated",
        {
            "equipmentName": current_active,
            "result": result,
            "timestamp": int(time.time() * 1000),
        },
    )
    if result in {"finished", "not-active"}:
        return jsonify(
            {
                "has_next": False,
                "active": False,
                "equipment": None,
                "equipmentName": current_active,
                "result": result,
                "should_offer_report": should_offer_report,
            }
        )

    return jsonify(
        {
            "has_next": True,
            "active": snapshot["active"],
            "equipment": snapshot,
            "equipmentName": current_active,
            "result": result,
            "should_offer_report": should_offer_report,
        }
    )


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
    if "responsible" in request.form:
        write_equipment_metadata(equipment_name, request.form.get("responsible", ""))
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


@app.route("/api/equipamentos/<equipment_name>/responsavel", methods=["POST"])
def update_equipment_responsible(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists() or not root.is_dir():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    if request.is_json:
        responsible_name = request.json.get("responsible", "")
    else:
        responsible_name = request.form.get("responsible", "")

    write_equipment_metadata(equipment_name, responsible_name)
    snapshot = equipment_snapshot(equipment_name)
    return jsonify({"message": "Responsavel atualizado.", "equipment": snapshot})


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
    state["piece_started_at_ms"] = int(time.time() * 1000)
    state["piece_history"] = []

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
    should_offer_report = result == "finished" and len(snapshot.get("piece_history", [])) > 0
    return jsonify(
        {
            "result": result,
            "has_next": result in {"next", "awaiting-fresa"},
            "equipment": snapshot,
            "redirect": "/producao" if result in {"next", "awaiting-fresa"} else "/",
            "should_offer_report": should_offer_report,
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
        state["piece_started_at_ms"] = int(time.time() * 1000)
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
    snapshot = equipment_snapshot(equipment_name)
    publish_production_event(
        "production-updated",
        {
            "equipmentName": equipment_name,
            "result": "finished-without-fresa",
            "timestamp": int(time.time() * 1000),
        },
    )
    return jsonify(
        {
            "message": "Producao finalizada sem Fresa.",
            "equipment": snapshot,
            "should_offer_report": len(snapshot.get("piece_history", [])) > 0,
        }
    )


@app.route("/api/equipamentos/<equipment_name>/relatorio", methods=["GET"])
def download_equipment_report(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists() or not root.is_dir():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    lines = report_lines_for_equipment(equipment_name)
    pdf_content = build_simple_pdf(lines)

    return Response(
        pdf_content,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=relatorio_{secure_filename(equipment_name)}.pdf",
        },
    )


@app.route("/api/equipamentos/<equipment_name>/reset-producao", methods=["POST"])
def reset_equipment_production(equipment_name):
    root = BASE_STORAGE_DIR / equipment_name
    if not root.exists() or not root.is_dir():
        return jsonify({"error": "Equipamento nao encontrado."}), 404

    reset_equipment_tracking(equipment_name)
    publish_production_event(
        "production-updated",
        {
            "equipmentName": equipment_name,
            "result": "tracking-reset",
            "timestamp": int(time.time() * 1000),
        },
    )

    return jsonify({"message": "Sinalizacao e historico zerados.", "equipment": equipment_snapshot(equipment_name)})


@app.route("/arquivos/<equipment_name>/<process_name>/<filename>")
def serve_piece_file(equipment_name, process_name, filename):
    if process_name not in {"Torno", "Fresa"}:
        abort(404)
    return send_from_directory(process_dir(equipment_name, process_name), filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
