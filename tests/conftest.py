import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def own_config_dir(hass, tmp_path):
    """Jeder Test bekommt ein eigenes /config, damit Plan-Dateien sich nicht vermischen."""
    hass.config.config_dir = str(tmp_path)
    yield
