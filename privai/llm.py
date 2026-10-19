"""Cliente del modelo local vía Ollama.

Toda la inferencia ocurre en tu máquina (localhost). No hay claves de API
ni coste por tokens, y ninguna petición sale a Internet.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

import requests


class LocalLLM:
    def __init__(self, host: str, model: str, temperature: float = 0.3):
        self.host = host.rstrip("/")
        self.model = model
        self.temperature = temperature

    def chat(self, messages: List[Dict[str, str]], tools: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
        """Una ronda de chat. Devuelve el mensaje del asistente (puede incluir tool_calls)."""
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": self.temperature},
        }
        if tools:
            payload["tools"] = tools
        try:
            resp = requests.post(f"{self.host}/api/chat", json=payload, timeout=600)
        except requests.exceptions.ConnectionError as exc:
            raise RuntimeError(
                f"No se pudo conectar a Ollama en {self.host}. "
                "¿Está Ollama corriendo? Prueba 'ollama serve'."
            ) from exc
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {})

    def is_available(self) -> bool:
        try:
            resp = requests.get(f"{self.host}/api/tags", timeout=5)
            return resp.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def has_model(self) -> bool:
        """Comprueba que el modelo configurado esté descargado en Ollama."""
        try:
            resp = requests.get(f"{self.host}/api/tags", timeout=5)
            names = [m.get("name", "") for m in resp.json().get("models", [])]
        except (requests.exceptions.RequestException, ValueError):
            return False
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        return wanted in names
