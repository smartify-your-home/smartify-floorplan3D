"""Ablage der Plan-Dateien unter /config/smartify_floorplan3d."""

from __future__ import annotations

import io
import json
import logging
import re
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    ASSET_DIR, ASSET_TYPES, LEGACY_DIR, MAX_PACKAGE_BYTES, MAX_PLAN_BYTES, PLAN_DIR, PLAN_FORMAT, PLAN_VERSION, SIGNAL_PLANS_UPDATED,
)

_LOGGER = logging.getLogger(__name__)
_FILE_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}\.json$")
_PART_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\- ]{0,127}$")


class PlanError(HomeAssistantError):
    """Plan-Datei ungültig oder nicht vorhanden."""


def safe_file_name(name: str) -> str:
    """Dateiname auf Kleinbuchstaben, Ziffern, _ und - reduzieren; .json anhängen."""
    base = Path(str(name)).name.lower()
    if base.endswith(".json"):
        base = base[:-5]
    base = re.sub(r"[^a-z0-9_\-]+", "_", base).strip("_-")[:64]
    if not base:
        raise PlanError("Kein gültiger Dateiname")
    file = base + ".json"
    if not _FILE_RE.match(file):
        raise PlanError(f"Ungültiger Dateiname: {name}")
    return file


def validate_plan(data: Any) -> dict[str, Any]:
    """Prüft, ob es eine Plan-Datei im Format smartify-floorplan3d ist."""
    if not isinstance(data, dict):
        raise PlanError("Plan-Datei muss ein JSON-Objekt sein")
    if data.get("format") != PLAN_FORMAT:
        raise PlanError(f"Unbekanntes Format, erwartet '{PLAN_FORMAT}'")
    version = data.get("version", 1)
    if not isinstance(version, int) or version < 1 or version > PLAN_VERSION:
        raise PlanError(f"Plan-Version {version} wird nicht unterstützt (höchstens {PLAN_VERSION})")
    size = data.get("size")
    if not (isinstance(size, list) and len(size) == 2 and all(isinstance(v, (int, float)) and v > 0 for v in size)):
        raise PlanError("Feld 'size' fehlt oder ist ungültig ([breite, tiefe] in Metern)")
    for key in ("walls", "foot", "floors", "openings", "decks", "attika", "rails", "items"):
        if key in data and not isinstance(data[key], list):
            raise PlanError(f"Feld '{key}' muss eine Liste sein")
    for key in ("lights", "rooms", "materials", "blocks"):
        if key in data and not isinstance(data[key], dict):
            raise PlanError(f"Feld '{key}' muss ein Objekt sein")
    # Neue Bauteilfelder sind optional: Bestandspläne im Format 2 bleiben gültig.
    opening_names: set[str] = set()
    for index, opening in enumerate(data.get("openings") or []):
        prefix = f"openings[{index}]"
        if not isinstance(opening, dict):
            raise PlanError(f"{prefix} muss ein Objekt sein")
        kind = opening.get("kind")
        if kind not in ("w", "b", "f", "e", "d", "gate", "sectional_door"):
            raise PlanError(f"{prefix}.kind ist unbekannt: {kind}")
        if not all(isinstance(opening.get(k), list) and len(opening[k]) == 2
                   and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in opening[k])
                   for k in ("p", "q")) or opening["p"] == opening["q"]:
            raise PlanError(f"{prefix}: p und q müssen unterschiedliche [x, y]-Punkte sein")
        for key in ("top", "t"):
            if not isinstance(opening.get(key), (int, float)) or isinstance(opening[key], bool) or opening[key] <= 0:
                raise PlanError(f"{prefix}.{key} muss eine positive Zahl sein")
        name = opening.get("name")
        if name is not None:
            if not isinstance(name, str) or not name.strip() or name in opening_names:
                raise PlanError(f"{prefix}.name fehlt oder ist doppelt")
            opening_names.add(name)
        shading = opening.get("shading")
        if shading is not None:
            if kind not in ("w", "b") or not isinstance(shading, dict) or shading.get("type") not in (
                    "none", "roller_shutter", "raffstore", "venetian_blind"):
                raise PlanError(f"{prefix}.shading ist für diesen Öffnungstyp ungültig")
            for key in ("slat_width", "slat_spacing"):
                if key in shading and (not isinstance(shading[key], (int, float)) or shading[key] <= 0):
                    raise PlanError(f"{prefix}.shading.{key} muss positiv sein")
        sectional = opening.get("sectional")
        if sectional is not None or kind == "sectional_door":
            if kind not in ("gate", "sectional_door") or (sectional is not None and not isinstance(sectional, dict)):
                raise PlanError(f"{prefix}.sectional ist ungültig")
            sectional = sectional or {}
            if sectional.get("track_type", "standard") not in ("standard", "high_lift", "vertical"):
                raise PlanError(f"{prefix}.sectional.track_type ist ungültig")
            if "panel_height" in sectional and (not isinstance(sectional["panel_height"], (int, float))
                                                or sectional["panel_height"] <= 0):
                raise PlanError(f"{prefix}.sectional.panel_height muss positiv sein")
    if not str(data.get("id", "")).strip():
        raise PlanError("Feld 'id' fehlt")
    return data


def safe_asset_path(name: str) -> str:
    """Relativer Pfad im Paket, z. B. models/sofa.glb; keine absoluten Pfade, kein .., nur bekannte Dateitypen."""
    p = PurePosixPath(str(name).replace("\\", "/"))
    if p.is_absolute() or not p.parts or any(not _PART_RE.match(x) or x in (".", "..") for x in p.parts):
        raise PlanError(f"Ungültiger Dateipfad im Paket: {name}")
    if p.suffix.lower() not in ASSET_TYPES:
        raise PlanError(f"Dateityp nicht erlaubt: {name}")
    return str(p)


def referenced_assets(data: dict[str, Any]) -> set[str]:
    """Texturen und Modelle, auf die der Plan verweist."""
    out = set()
    for m in (data.get("materials") or {}).values():
        if isinstance(m, dict) and m.get("texture"):
            out.add(str(m["texture"]))
    prims = [p for b in (data.get("blocks") or {}).values() if isinstance(b, list) for p in b]
    prims += [p for it in data.get("items") or [] if isinstance(it, dict) for p in it.get("prims") or []]
    for p in prims:
        if isinstance(p, list) and len(p) > 1 and p[0] == "glb" and isinstance(p[1], list) and p[1]:
            out.add(str(p[1][0]))
    return out


def summarize(file: str, data: dict[str, Any], stat: Any = None, assets: int = 0) -> dict[str, Any]:
    """Kurzinfo für Listen im Editor."""
    return {
        "file": file,
        "id": str(data.get("id")),
        "name": data.get("name") or str(data.get("id")),
        "size": data.get("size"),
        "level": data.get("level", 0),
        "rooms": data.get("rooms") or {},
        "lights": sorted((data.get("lights") or {}).keys()),
        "openings": sorted(o["name"] for o in data.get("openings") or [] if isinstance(o, dict) and o.get("name")),
        "version": data.get("version", 1),
        "assets": assets,
        "bytes": stat.st_size if stat else None,
        "updated": stat.st_mtime if stat else None,
    }


class PlanStore:
    """Liest und schreibt Plan-Dateien; Dateizugriffe laufen im Executor."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.path = Path(hass.config.path(PLAN_DIR))

    async def async_init(self) -> None:
        migrated = await self.hass.async_add_executor_job(self._init)
        if migrated:
            _LOGGER.info("Plan-Dateien aus /config/%s übernommen: %s", LEGACY_DIR, ", ".join(migrated))

    def _init(self) -> list[str]:
        self.path.mkdir(parents=True, exist_ok=True)
        legacy = Path(self.hass.config.path(LEGACY_DIR))
        if any(self.path.glob("*.json")) or not legacy.is_dir():
            return []
        done = []
        for src in sorted(legacy.glob("*.json")):
            try:
                validate_plan(json.loads(src.read_text(encoding="utf-8")))
                shutil.copy2(src, self.path / safe_file_name(src.name))
                done.append(src.name)
            except (PlanError, ValueError, OSError) as err:
                _LOGGER.warning("Plan %s nicht übernommen: %s", src.name, err)
        return done

    def _file(self, file: str) -> Path:
        name = safe_file_name(file)
        return self.path / name

    def _assets_of(self, file: str) -> Path:
        return self.path / ASSET_DIR / safe_file_name(file)[:-5]

    def _count_assets(self, file: str) -> int:
        d = self._assets_of(file)
        return sum(1 for f in d.rglob("*") if f.is_file()) if d.is_dir() else 0

    def _list(self) -> list[dict[str, Any]]:
        out = []
        for p in sorted(self.path.glob("*.json")):
            try:
                out.append(summarize(p.name, validate_plan(json.loads(p.read_text(encoding="utf-8"))), p.stat(), self._count_assets(p.name)))
            except (PlanError, ValueError, OSError) as err:
                out.append({"file": p.name, "error": str(err)})
        return out

    def _get(self, file: str) -> dict[str, Any]:
        p = self._file(file)
        if not p.is_file():
            raise PlanError(f"Plan {p.name} nicht gefunden")
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except ValueError as err:
            raise PlanError(f"Plan {p.name} ist kein gültiges JSON: {err}") from err

    def _save(self, file: str, data: dict[str, Any], overwrite: bool) -> dict[str, Any]:
        p = self._file(file)
        if p.exists() and not overwrite:
            raise PlanError(f"Plan {p.name} gibt es schon")
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(text.encode("utf-8")) > MAX_PLAN_BYTES:
            raise PlanError("Plan-Datei ist größer als 5 MB")
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(p)
        return summarize(p.name, data, p.stat(), self._count_assets(p.name))

    def _save_package(self, raw: bytes, file: str | None, overwrite: bool) -> dict[str, Any]:
        """Zip mit Plan-Datei (plan.json oder eine .json im Wurzelordner) und Modellen/Texturen."""
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as err:
            raise PlanError("Kein gültiges Zip-Archiv") from err
        infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
        if sum(i.file_size for i in infos) > MAX_PACKAGE_BYTES:
            raise PlanError("Paket ist entpackt größer als 80 MB")
        names = [i.filename.replace("\\", "/") for i in infos]
        # gemeinsamen Oberordner abschneiden (Zip eines Ordners)
        tops = {n.split("/", 1)[0] for n in names}
        strip = len(tops) == 1 and all("/" in n for n in names)
        rel = {i.filename: (n.split("/", 1)[1] if strip else n) for i, n in zip(infos, names)}
        jsons = [i for i in infos if rel[i.filename].lower().endswith(".json") and "/" not in rel[i.filename]]
        plan_info = next((i for i in jsons if rel[i.filename].lower() == "plan.json"), None) or (jsons[0] if len(jsons) == 1 else None)
        if plan_info is None:
            raise PlanError("Im Paket fehlt die Plan-Datei (plan.json oder genau eine .json im Hauptordner)")
        try:
            data = validate_plan(json.loads(zf.read(plan_info).decode("utf-8")))
        except ValueError as err:
            raise PlanError(f"Plan-Datei ist kein gültiges JSON: {err}") from err
        assets = {}
        for i in infos:
            if i is plan_info:
                continue
            path = safe_asset_path(rel[i.filename])
            assets[path] = zf.read(i)
        missing = sorted(a for a in referenced_assets(data) if a not in assets)
        if missing:
            raise PlanError("Im Paket fehlen: " + ", ".join(missing))
        name = safe_file_name(file if file and not str(file).lower().endswith(".zip") else (rel[plan_info.filename] if rel[plan_info.filename].lower() != "plan.json" else str(data["id"])))
        p = self.path / name
        if p.exists() and not overwrite:
            raise PlanError(f"Plan {name} gibt es schon")
        target = self._assets_of(name)
        tmp = target.with_name(target.name + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        for path, content in assets.items():
            f = tmp / path
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(content)
        shutil.rmtree(target, ignore_errors=True)
        if assets:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp.replace(target)
        return self._save(name, data, True)

    def _asset(self, file: str, path: str) -> Path:
        base = self._assets_of(file).resolve()
        f = (base / safe_asset_path(path)).resolve()
        if base not in f.parents or not f.is_file():
            raise PlanError(f"Datei {path} nicht gefunden")
        return f

    def _delete(self, file: str) -> None:
        p = self._file(file)
        if not p.is_file():
            raise PlanError(f"Plan {p.name} nicht gefunden")
        p.unlink()
        shutil.rmtree(self._assets_of(p.name), ignore_errors=True)

    async def async_list(self) -> list[dict[str, Any]]:
        return await self.hass.async_add_executor_job(self._list)

    async def async_get(self, file: str) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(self._get, file)

    async def async_import(self, data: Any, file: str | None = None, overwrite: bool = True) -> dict[str, Any]:
        """Plan prüfen und speichern; ohne Dateiname gilt <id>.json."""
        data = validate_plan(data)
        name = safe_file_name(file or str(data["id"]))
        entry = await self.hass.async_add_executor_job(self._save, name, data, overwrite)
        async_dispatcher_send(self.hass, SIGNAL_PLANS_UPDATED, {"action": "import", "file": entry["file"]})
        return entry

    async def async_import_package(self, raw: bytes, file: str | None = None, overwrite: bool = True) -> dict[str, Any]:
        entry = await self.hass.async_add_executor_job(self._save_package, raw, file, overwrite)
        async_dispatcher_send(self.hass, SIGNAL_PLANS_UPDATED, {"action": "import", "file": entry["file"]})
        return entry

    async def async_asset(self, file: str, path: str) -> Path:
        return await self.hass.async_add_executor_job(self._asset, file, path)

    async def async_delete(self, file: str) -> None:
        await self.hass.async_add_executor_job(self._delete, file)
        async_dispatcher_send(self.hass, SIGNAL_PLANS_UPDATED, {"action": "delete", "file": safe_file_name(file)})
