"""
Provider trust levels and privacy mode validations.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Literal

PrivacyMode = Literal["strict_local", "no_train_only", "free_with_redaction"]


@dataclass(frozen=True)
class ProviderTrust:
    provider: str
    retention_days: int | None
    trains_on_prompts: bool  # False only if explicitly verified by terms


# Unknown providers are denied; 0G retention/training terms must be verified before
# allowing the more restrictive no_train_only privacy mode.
DEFAULT_TRUST_REGISTRY: Dict[str, ProviderTrust] = {
    "zg_compute": ProviderTrust("zg_compute", retention_days=None, trains_on_prompts=True),
}


class TrustRegistry:
    def __init__(self, registry: Dict[str, ProviderTrust] | None = None) -> None:
        self.registry = dict(registry or DEFAULT_TRUST_REGISTRY)

    def is_provider_allowed(self, provider: str, mode: PrivacyMode) -> bool:
        if provider != "zg_compute":
            return False
        trust = self.registry.get(provider)
        if trust is None:
            return False
        if mode == "strict_local":
            return False
        if mode == "no_train_only":
            return not trust.trains_on_prompts
        if mode == "free_with_redaction":
            return True
        return False
