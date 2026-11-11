import pytest
from autonex_bridge.swarm.api import get_models
from autonex_bridge.gateway.router import ModelRouter, ModelSpec


def test_model_catalog_contains_only_0g_models():
    models = get_models()

    assert models
    assert all(model["provider"] == "0g" for model in models)
    assert all(model["id"].startswith("0g/") for model in models)


def test_gateway_rejects_non_0g_model_specs():
    with pytest.raises(ValueError, match="only 0G models"):
        ModelRouter([ModelSpec("other/model", "other", 128_000)], {})
