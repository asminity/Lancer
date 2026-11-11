"""
Bridge entry point for Vercel deployment.
Re-exports the FastAPI app from autonex_bridge.main.
"""
from autonex_bridge.main import app

__all__ = ["app"]
