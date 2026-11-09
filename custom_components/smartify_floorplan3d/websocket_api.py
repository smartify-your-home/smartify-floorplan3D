"""WebSocket-Befehle für Karte und Editor."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_PLANS_UPDATED, VERSION
from .store import PlanError, PlanStore


def _store(hass: HomeAssistant) -> PlanStore | None:
    return hass.data.get(DOMAIN, {}).get("store")


@callback
def async_register(hass: HomeAssistant) -> None:
    """Befehle einmalig registrieren."""
    if hass.data.setdefault(DOMAIN, {}).get("ws_registered"):
        return
    hass.data[DOMAIN]["ws_registered"] = True
    for cmd in (ws_info, ws_list, ws_get, ws_import, ws_delete, ws_subscribe):
        websocket_api.async_register_command(hass, cmd)


def _not_loaded(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_error(msg["id"], "not_loaded", "smartify Floorplan 3D ist nicht eingerichtet")


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/info"})
@callback
def ws_info(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"version": VERSION, "loaded": _store(hass) is not None})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plans/list"})
@websocket_api.async_response
async def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not (store := _store(hass)):
        return _not_loaded(connection, msg)
    connection.send_result(msg["id"], {"plans": await store.async_list()})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plans/get", vol.Required("file"): str})
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not (store := _store(hass)):
        return _not_loaded(connection, msg)
    try:
        connection.send_result(msg["id"], {"plan": await store.async_get(msg["file"])})
    except PlanError as err:
        connection.send_error(msg["id"], "not_found", str(err))


@websocket_api.require_admin
@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/plans/import",
    vol.Required("data"): dict,
    vol.Optional("file"): str,
    vol.Optional("overwrite", default=True): bool,
})
@websocket_api.async_response
async def ws_import(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not (store := _store(hass)):
        return _not_loaded(connection, msg)
    try:
        entry = await store.async_import(msg["data"], msg.get("file"), msg["overwrite"])
    except PlanError as err:
        connection.send_error(msg["id"], "invalid_plan", str(err))
        return
    connection.send_result(msg["id"], {"plan": entry})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plans/delete", vol.Required("file"): str})
@websocket_api.async_response
async def ws_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not (store := _store(hass)):
        return _not_loaded(connection, msg)
    try:
        await store.async_delete(msg["file"])
    except PlanError as err:
        connection.send_error(msg["id"], "not_found", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plans/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Meldet geänderte Plan-Dateien, damit offene Karten neu laden."""

    @callback
    def forward(event: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], event))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_PLANS_UPDATED, forward)
    connection.send_result(msg["id"])
