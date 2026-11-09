"""smartify Floorplan 3D: liefert die Lovelace-Karte aus und verwaltet die Plan-Dateien."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import http_api, websocket_api
from .const import CARD_FILE, DOMAIN, URL_BASE, VERSION
from .services import async_setup_services
from .store import PlanStore

_LOGGER = logging.getLogger(__name__)
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
CARD_URL = f"{URL_BASE}/{CARD_FILE}?v={VERSION}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    websocket_api.async_register(hass)
    http_api.async_register(hass)
    async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    store = PlanStore(hass)
    await store.async_init()
    data["store"] = store
    # Kartendatei ausliefern und in jedem Dashboard laden; statische Pfade lassen sich nicht abmelden
    if not data.get("static"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(Path(__file__).parent / "frontend"), False)]
        )
        data["static"] = True
    add_extra_js_url(hass, CARD_URL)
    _LOGGER.debug("Karte unter %s, Pläne in %s", CARD_URL, store.path)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    remove_extra_js_url(hass, CARD_URL)
    hass.data.get(DOMAIN, {}).pop("store", None)
    return True
