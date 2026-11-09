"""Dienste: Plan aus einer Datei unter /config oder von einer URL importieren, Plan löschen."""

from __future__ import annotations

import json
from pathlib import Path

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service import async_register_admin_service

from .const import DOMAIN, MAX_PACKAGE_BYTES, MAX_PLAN_BYTES
from .store import PlanError

IMPORT_SCHEMA = vol.Schema(
    vol.All(
        {
            vol.Exclusive("path", "source"): cv.string,
            vol.Exclusive("url", "source"): cv.url,
            vol.Optional("file"): cv.string,
            vol.Optional("overwrite", default=True): cv.boolean,
        },
        cv.has_at_least_one_key("path", "url"),
    )
)
DELETE_SCHEMA = vol.Schema({vol.Required("file"): cv.string})


def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "import_plan"):
        return

    def store():
        s = hass.data.get(DOMAIN, {}).get("store")
        if not s:
            raise HomeAssistantError("smartify Floorplan 3D ist nicht eingerichtet")
        return s

    async def import_plan(call: ServiceCall):
        if "path" in call.data:
            p = Path(call.data["path"])
            if not p.is_absolute():
                p = Path(hass.config.path(str(p)))
            # erlaubt: alles unter /config sowie freigegebene Ordner (allowlist_external_dirs)
            inside = Path(hass.config.config_dir).resolve() in p.resolve().parents
            if not inside and not hass.config.is_allowed_path(str(p)):
                raise ServiceValidationError(f"Pfad {p} liegt nicht unter /config und ist nicht freigegeben (allowlist_external_dirs)")

            def read() -> bytes:
                if not p.is_file():
                    raise ServiceValidationError(f"Datei {p} nicht gefunden")
                if p.stat().st_size > MAX_PACKAGE_BYTES:
                    raise ServiceValidationError("Datei ist größer als 80 MB")
                return p.read_bytes()

            raw = await hass.async_add_executor_job(read)
            name = call.data.get("file") or p.name
        else:
            session = async_get_clientsession(hass)
            async with session.get(call.data["url"], timeout=30) as resp:
                if resp.status != 200:
                    raise HomeAssistantError(f"Download fehlgeschlagen: HTTP {resp.status}")
                raw = await resp.content.read(MAX_PACKAGE_BYTES + 1)
                if len(raw) > MAX_PACKAGE_BYTES:
                    raise ServiceValidationError("Datei ist größer als 80 MB")
            name = call.data.get("file") or call.data["url"].rsplit("/", 1)[-1].split("?")[0]
        try:
            if raw[:2] == b"PK":   # Zip-Paket mit Modellen und Texturen
                return {"plan": await store().async_import_package(raw, name, call.data["overwrite"])}
            if len(raw) > MAX_PLAN_BYTES:
                raise PlanError("Plan-Datei ist größer als 5 MB")
            entry = await store().async_import(json.loads(raw.decode("utf-8")), name, call.data["overwrite"])
        except (ValueError, UnicodeDecodeError) as err:
            raise ServiceValidationError(f"Kein gültiges JSON: {err}") from err
        except PlanError as err:
            raise ServiceValidationError(str(err)) from err
        return {"plan": entry}

    async def delete_plan(call: ServiceCall) -> None:
        try:
            await store().async_delete(call.data["file"])
        except PlanError as err:
            raise ServiceValidationError(str(err)) from err

    async_register_admin_service(hass, DOMAIN, "import_plan", import_plan, IMPORT_SCHEMA, SupportsResponse.OPTIONAL)
    async_register_admin_service(hass, DOMAIN, "delete_plan", delete_plan, DELETE_SCHEMA)
