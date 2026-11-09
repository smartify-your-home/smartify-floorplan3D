"""Tests: Einrichtung, Plan-Verwaltung über WebSocket und Dienste, Auslieferung der Karte."""
import json
from pathlib import Path

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.smartify_floorplan3d.const import DOMAIN

PLANS = Path(__file__).parent.parent / "examples" / "plans"


def plan(name="eg"):
    return json.loads((PLANS / f"{name}.json").read_text(encoding="utf-8"))


async def setup(hass: HomeAssistant):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow(hass: HomeAssistant):
    await async_setup_component(hass, "http", {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] == "form"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] == "abort"


async def test_websocket_plans(hass: HomeAssistant, hass_ws_client):
    await setup(hass)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/plans/subscribe"})
    assert (await ws.receive_json())["success"]

    await ws.send_json({"id": 2, "type": f"{DOMAIN}/plans/import", "data": plan("eg"), "file": "Erdgeschoss Neu.JSON"})
    res = await ws.receive_json()
    # Ereignis und Ergebnis können in beliebiger Reihenfolge kommen
    msgs = [res, await ws.receive_json()]
    result = next(m for m in msgs if m.get("type") == "result")
    event = next(m for m in msgs if m.get("type") == "event")
    assert result["success"], result
    assert result["result"]["plan"]["file"] == "erdgeschoss_neu.json"
    assert result["result"]["plan"]["id"] == "eg"
    assert event["event"] == {"action": "import", "file": "erdgeschoss_neu.json"}

    await ws.send_json({"id": 3, "type": f"{DOMAIN}/plans/import", "data": plan("og")})
    msgs = [await ws.receive_json(), await ws.receive_json()]
    assert next(m for m in msgs if m.get("type") == "result")["result"]["plan"]["file"] == "og.json"

    await ws.send_json({"id": 4, "type": f"{DOMAIN}/plans/list"})
    res = await ws.receive_json()
    assert [p["file"] for p in res["result"]["plans"]] == ["erdgeschoss_neu.json", "og.json"]
    assert "wohnen" in res["result"]["plans"][0]["rooms"]

    await ws.send_json({"id": 5, "type": f"{DOMAIN}/plans/get", "file": "og.json"})
    res = await ws.receive_json()
    assert res["result"]["plan"]["id"] == "og"

    await ws.send_json({"id": 6, "type": f"{DOMAIN}/plans/import", "data": {"format": "etwas anderes"}})
    msgs = [await ws.receive_json()]
    assert not msgs[0]["success"] and msgs[0]["error"]["code"] == "invalid_plan"

    await ws.send_json({"id": 7, "type": f"{DOMAIN}/plans/import", "data": plan("og"), "overwrite": False})
    res = await ws.receive_json()
    assert not res["success"]

    await ws.send_json({"id": 8, "type": f"{DOMAIN}/plans/delete", "file": "og.json"})
    msgs = [await ws.receive_json(), await ws.receive_json()]
    assert next(m for m in msgs if m.get("type") == "result")["success"]
    assert not (Path(hass.config.path("smartify_floorplan3d")) / "og.json").exists()

    await ws.send_json({"id": 9, "type": f"{DOMAIN}/plans/get", "file": "../secrets.yaml"})
    res = await ws.receive_json()
    assert not res["success"]


async def test_import_requires_admin(hass: HomeAssistant, hass_ws_client, hass_read_only_access_token):
    await setup(hass)
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/plans/import", "data": plan("eg")})
    res = await ws.receive_json()
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    await ws.send_json({"id": 2, "type": f"{DOMAIN}/plans/list"})
    assert (await ws.receive_json())["success"]


async def test_service_import_from_path(hass: HomeAssistant):
    await setup(hass)
    src = Path(hass.config.path("smartify_import"))
    src.mkdir(exist_ok=True)
    (src / "garten.json").write_text(json.dumps(dict(plan("og"), id="garten")), encoding="utf-8")
    res = await hass.services.async_call(DOMAIN, "import_plan", {"path": "smartify_import/garten.json"}, blocking=True, return_response=True)
    assert res["plan"]["file"] == "garten.json"
    await hass.services.async_call(DOMAIN, "delete_plan", {"file": "garten.json"}, blocking=True)
    assert not (Path(hass.config.path("smartify_floorplan3d")) / "garten.json").exists()


async def test_legacy_migration(hass: HomeAssistant):
    legacy = Path(hass.config.path("www/smartify-floorplan3d"))
    legacy.mkdir(parents=True, exist_ok=True)
    for n in ("eg", "og"):
        (legacy / f"{n}.json").write_text(json.dumps(plan(n)), encoding="utf-8")
    (legacy / "kaputt.json").write_text("{", encoding="utf-8")
    await setup(hass)
    names = sorted(p.name for p in Path(hass.config.path("smartify_floorplan3d")).glob("*.json"))
    assert names == ["eg.json", "og.json"]


async def test_card_is_served(hass: HomeAssistant, hass_client):
    await setup(hass)
    client = await hass_client()
    resp = await client.get("/smartify_floorplan3d_static/smartify-floorplan3d.js")
    assert resp.status == 200
    assert "customElements.define('smartify-floorplan3d'" in await resp.text()
    from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
    assert any("smartify-floorplan3d.js" in u for u in hass.data[DATA_EXTRA_MODULE_URL].urls)
