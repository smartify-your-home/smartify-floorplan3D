"""Konstanten für smartify Floorplan 3D."""

DOMAIN = "smartify_floorplan3d"
VERSION = "1.4.6"

# Kartendatei, die die Integration ausliefert und automatisch im Frontend lädt
URL_BASE = "/smartify_floorplan3d_static"
CARD_FILE = "smartify-floorplan3d.js"

# Plan-Dateien liegen hier (unter /config), nicht öffentlich erreichbar
PLAN_DIR = "smartify_floorplan3d"
# alter Ablageort der Karte vor der Integration, wird beim ersten Start übernommen
LEGACY_DIR = "www/smartify-floorplan3d"

PLAN_FORMAT = "smartify-floorplan3d"
PLAN_VERSION = 2
MAX_PLAN_BYTES = 5 * 1024 * 1024
MAX_PACKAGE_BYTES = 80 * 1024 * 1024
# Dateien eines Plan-Pakets (Zip): Modelle und Texturen
ASSET_TYPES = {
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".ktx2": "image/ktx2",
}
ASSET_DIR = "assets"
API_BASE = "/api/smartify_floorplan3d"

SIGNAL_PLANS_UPDATED = f"{DOMAIN}_plans_updated"
