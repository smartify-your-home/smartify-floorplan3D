"""Tests: Plan-Pakete (Zip) über HTTP und Dienst, Auslieferung von Modellen/Texturen."""
import io
import json
import zipfile
from pathlib import Path

from aiohttp import FormData
from homeassistant.core import HomeAssistant

from custom_components.smartify_floorplan3d.const import DOMAIN

from .test_init import plan, setup

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


def package(missing=False, evil=None, folder=""):
    data = dict(plan("eg"), id="eg")
    data["materials"] = dict(data["materials"], parquet={"color": "#ffffff", "texture": "textures/parkett.png", "repeat": [2, 2]})
    data["blocks"] = dict(data["blocks"], sofa_glb=[["glb", ["models/sofa.glb"], [0, 0, 0], 0, 0, "white"]])
    data["items"] = data["items"] + [{"block": "sofa_glb", "pos": [3, 9]}]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(folder + "plan.json", json.dumps(data))
        zf.writestr(folder + "textures/parkett.png", PNG)
        if not missing:
            zf.writestr(folder + "models/sofa.glb", b"glTF-fake")
        if evil:
            zf.writestr(evil, b"x")
    return buf.getvalue()


async def test_http_import_json_and_zip(hass: HomeAssistant, hass_client):
    await setup(hass)
    client = await hass_client()
    form = FormData()
    form.add_field("file", json.dumps(plan("og")).encode(), filename="og.json")
    form.add_field("file", package(folder="eg-paket/"), filename="eg-paket.zip")
    resp = await client.post(f"/api/{DOMAIN}/import", data=form)
    body = await resp.json()
    assert resp.status == 200, body
    assert sorted(p["file"] for p in body["plans"]) == ["eg.json", "og.json"]
    assert body["errors"] == []
    eg = next(p for p in body["plans"] if p["file"] == "eg.json")
    assert eg["assets"] == 2 and eg["version"] == 2

    resp = await client.get(f"/api/{DOMAIN}/assets/eg/textures/parkett.png")
    assert resp.status == 200 and resp.headers["Content-Type"] == "image/png"
    assert await resp.read() == PNG
    resp = await client.get(f"/api/{DOMAIN}/assets/eg/models/sofa.glb")
    assert resp.status == 200 and resp.headers["Content-Type"] == "model/gltf-binary"
    for bad in ("../eg.json", "textures/../../eg.json", "models/nicht.glb"):
        resp = await client.get(f"/api/{DOMAIN}/assets/eg/{bad}")
        assert resp.status == 404, bad

    # Löschen entfernt auch die Paketdateien
    store = hass.data[DOMAIN]["store"]
    await store.async_delete("eg.json")
    assert not (Path(hass.config.path("smartify_floorplan3d")) / "assets" / "eg").exists()


async def test_zip_errors(hass: HomeAssistant, hass_client):
    await setup(hass)
    client = await hass_client()
    for raw, msg in ((package(missing=True), "fehlen"), (package(evil="../../secrets.yaml"), "Ungültiger Dateipfad"),
                     (package(evil="tools/run.sh"), "nicht erlaubt"), (b"PK kaputt", "Zip")):
        form = FormData()
        form.add_field("file", raw, filename="x.zip")
        resp = await client.post(f"/api/{DOMAIN}/import", data=form)
        body = await resp.json()
        assert resp.status == 400 and msg in body["errors"][0]["error"], body
    assert not list(Path(hass.config.path("smartify_floorplan3d")).glob("*.json"))


async def test_http_import_requires_admin(hass: HomeAssistant, hass_client, hass_read_only_access_token):
    await setup(hass)
    client = await hass_client(hass_read_only_access_token)
    form = FormData()
    form.add_field("file", json.dumps(plan("og")).encode(), filename="og.json")
    resp = await client.post(f"/api/{DOMAIN}/import", data=form)
    assert resp.status == 401


async def test_assets_require_login(hass: HomeAssistant, hass_client_no_auth):
    await setup(hass)
    client = await hass_client_no_auth()
    resp = await client.get(f"/api/{DOMAIN}/assets/eg/textures/parkett.png")
    assert resp.status == 401


async def test_service_import_zip(hass: HomeAssistant):
    await setup(hass)
    Path(hass.config.path("eg.zip")).write_bytes(package())
    res = await hass.services.async_call(DOMAIN, "import_plan", {"path": "eg.zip"}, blocking=True, return_response=True)
    assert res["plan"]["file"] == "eg.json" and res["plan"]["assets"] == 2
