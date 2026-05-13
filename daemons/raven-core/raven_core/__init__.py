"""
RAVEN Core - Rather Intelligent Virtual Environment Nexus

A modular AI assistant backbone built on Gemini Live API.
"""

__version__ = "0.1.0"

from .orchestrator import Orchestrator
from .config import Config

__all__ = ["Orchestrator", "Config", "__version__"]
