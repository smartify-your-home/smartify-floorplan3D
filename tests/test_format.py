"""Schema regression tests for plan opening types; HA test dependencies required."""
from copy import deepcopy
import pytest
from custom_components.smartify_floorplan3d.store import PlanError, validate_plan

BASE = {"format": "smartify-floorplan3d", "version": 2, "id": "test", "size": [10, 8], "openings": []}


def test_new_opening_types():
    p = deepcopy(BASE)
    p["openings"] = [
        {"name": "buero", "kind": "w", "p": [1, 0], "q": [2, 0], "t": 0.4, "par": 0.9, "top": 2.2,
         "shading": {"type": "raffstore", "slat_width": 0.08, "slat_spacing": 0.075}},
        {"name": "garage", "kind": "sectional_door", "p": [3, 0], "q": [6, 0], "t": 0.3, "top": 2.5,
         "sectional": {"panel_height": 0.5, "track_type": "standard"}},
    ]
    assert validate_plan(p) is p


@pytest.mark.parametrize('change', [
    lambda d: d["openings"][0].update({"shading": {"type": "unknown"}}),
    lambda d: d["openings"][0].update({"q": [1, 0]}),
    lambda d: d["openings"][1].update({"name": "buero"}),
    lambda d: d["openings"][1].update({"sectional": {"track_type": "diagonal"}}),
])
def test_invalid_opening_rejected(change):
    p = deepcopy(BASE)
    p["openings"] = [
        {"name": "buero", "kind": "w", "p": [1, 0], "q": [2, 0], "t": 0.4, "top": 2.2},
        {"name": "garage", "kind": "sectional_door", "p": [3, 0], "q": [6, 0], "t": 0.3, "top": 2.5},
    ]
    change(p)
    with pytest.raises(PlanError):
        validate_plan(p)
