"""HTTP: Plan-Pakete hochladen (JSON oder Zip) und Modelle/Texturen angemeldet ausliefern."""

from __future__ import annotations

import json
import logging

from aiohttp import web

from homeassistant.components.http import KEY_HASS_USER, HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from .const import API_BASE, ASSET_TYPES, DOMAIN, MAX_PACKAGE_BYTES, MAX_PLAN_BYTES
from .store import PlanError, PlanStore

_LOGGER = logging.getLogger(__name__)


@callback
def async_register(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("http_registered"):
        return
    hass.data[DOMAIN]["http_registered"] = True
    hass.http.register_view(ImportView())
    hass.http.register_view(AssetView())


def _store(hass: HomeAssistant) -> PlanStore:
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store:
        raise web.HTTPServiceUnavailable(text="smartify Floorplan 3D ist nicht eingerichtet")
    return store


class ImportView(HomeAssistantView):
    """POST multipart: ein oder mehrere Felder 'file' (.json oder .zip), optional 'overwrite' = false."""

    url = f"{API_BASE}/import"
    name = "api:smartify_floorplan3d:import"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        if not request[KEY_HASS_USER].is_admin:
            raise Unauthorized()
        store = _store(hass)
        files: list[tuple[str, bytes]] = []
        overwrite = True
        reader = await request.multipart()
        while (field := await reader.next()) is not None:
            if field.name == "overwrite":
                overwrite = (await field.text()).strip().lower() not in ("0", "false", "no", "nein")
                continue
            if field.name != "file":
                continue
            buf = bytearray()
            while chunk := await field.read_chunk(256 * 1024):
                buf.extend(chunk)
                if len(buf) > MAX_PACKAGE_BYTES:
                    return self.json_message("Datei größer als 80 MB", 413)
            files.append((field.filename or "plan.json", bytes(buf)))
        if not files:
            return self.json_message("Keine Datei übergeben", 400)
        plans, errors = [], []
        for name, raw in files:
            try:
                if raw[:2] == b"PK" or name.lower().endswith(".zip"):
                    plans.append(await store.async_import_package(raw, name, overwrite))
                else:
                    if len(raw) > MAX_PLAN_BYTES:
                        raise PlanError("Plan-Datei ist größer als 5 MB")
                    try:
                        data = json.loads(raw.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError) as err:
                        raise PlanError(f"Kein gültiges JSON: {err}") from err
                    plans.append(await store.async_import(data, name, overwrite))
            except PlanError as err:
                errors.append({"file": name, "error": str(err)})
        return self.json({"plans": plans, "errors": errors}, 200 if plans or not errors else 400)


class AssetView(HomeAssistantView):
    """GET Modell oder Textur eines Plans, nur für angemeldete Benutzer."""

    url = API_BASE + "/assets/{stem}/{path:.+}"
    name = "api:smartify_floorplan3d:assets"
    requires_auth = True

    async def get(self, request: web.Request, stem: str, path: str) -> web.StreamResponse:
        store = _store(request.app[KEY_HASS])
        try:
            f = await store.async_asset(stem + ".json", path)
        except PlanError as err:
            raise web.HTTPNotFound(text=str(err)) from err
        return web.FileResponse(f, headers={
            "Content-Type": ASSET_TYPES.get(f.suffix.lower(), "application/octet-stream"),
            "Cache-Control": "private, max-age=3600",
        })
