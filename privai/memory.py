"""Memoria persistente: lo que PrivAI recuerda entre sesiones.

Se guarda en la carpeta .privai/ del workspace, en tu propia máquina:
- memoria.md     hechos que la IA decidió recordar (herramienta remember)
- historial.json últimos mensajes de la conversación
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, Dict, List

MAX_HISTORY = 20


class Memory:
    def __init__(self, workspace: Path):
        self.dir = workspace.resolve() / ".privai"
        self.facts_file = self.dir / "memoria.md"
        self.history_file = self.dir / "historial.json"

    def remember(self, fact: str) -> str:
        self.dir.mkdir(parents=True, exist_ok=True)
        with self.facts_file.open("a", encoding="utf-8") as f:
            f.write(f"- ({date.today().isoformat()}) {fact.strip()}\n")
        return f"recordado: {fact.strip()}"

    def facts(self) -> str:
        if not self.facts_file.exists():
            return ""
        return self.facts_file.read_text(encoding="utf-8").strip()

    def load_history(self) -> List[Dict[str, Any]]:
        if not self.history_file.exists():
            return []
        try:
            return json.loads(self.history_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []

    def save_history(self, messages: List[Dict[str, Any]]) -> None:
        # Solo los turnos de conversación; las llamadas a herramientas no hacen falta.
        turns = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m.get("role") in {"user", "assistant"} and m.get("content")
        ]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.history_file.write_text(
            json.dumps(turns[-MAX_HISTORY:], ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

    def forget(self) -> str:
        for f in (self.facts_file, self.history_file):
            if f.exists():
                f.unlink()
        return "memoria borrada"
