"""Carga de configuración de PrivAI."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

DEFAULTS = {
    "model": "llama3.1",
    "ollama_host": "http://localhost:11434",
    "workspace": ".",
    "allow_self_edit": True,
    "allow_shell": False,
    "max_steps": 12,
    "temperature": 0.3,
}


@dataclass
class Config:
    model: str
    ollama_host: str
    workspace: Path
    allow_self_edit: bool
    allow_shell: bool
    max_steps: int
    temperature: float

    @classmethod
    def load(cls, path: str | os.PathLike | None = None) -> "Config":
        data = dict(DEFAULTS)
        cfg_path = Path(path) if path else Path("config.yaml")
        if cfg_path.exists():
            loaded = yaml.safe_load(cfg_path.read_text()) or {}
            data.update({k: v for k, v in loaded.items() if v is not None})
        return cls(
            model=str(data["model"]),
            ollama_host=str(data["ollama_host"]).rstrip("/"),
            workspace=Path(data["workspace"]).resolve(),
            allow_self_edit=bool(data["allow_self_edit"]),
            allow_shell=bool(data["allow_shell"]),
            max_steps=int(data["max_steps"]),
            temperature=float(data["temperature"]),
        )
