"""Bucle del agente: razonar -> usar herramienta -> observar -> repetir."""
from __future__ import annotations

import json
from typing import Any, Dict, List

from .config import Config
from .llm import LocalLLM
from .memory import Memory
from .self_edit import SelfEditor
from .tools import Toolbox, _spec

SYSTEM_PROMPT = """Eres PrivAI, un asistente de IA que corre localmente en la máquina del usuario.
Tienes herramientas para leer, escribir, listar y buscar archivos dentro del workspace.
Trabaja paso a paso: usa herramientas cuando necesites información o quieras actuar,
y responde al usuario cuando la tarea esté completa. Sé conciso y directo.
Nunca digas que creaste, leíste o cambiaste un archivo si no usaste la herramienta;
al crear un archivo, indica la ruta completa que devuelve write_file.
Todas tus acciones quedan dentro del workspace configurado.
Si aprendes algo que valga la pena recordar en futuras sesiones (el nombre del usuario,
sus preferencias, en qué está trabajando), guárdalo con la herramienta remember."""

SELF_KNOWLEDGE = """Sobre ti mismo (sé honesto con esto si te preguntan):
- Eres un modelo de lenguaje ({model}) ejecutado por Ollama en la computadora del usuario,
  controlado por un programa en Python llamado PrivAI.
- Tu código fuente está en la carpeta privai/: {files}.
- Workspace al que tienes acceso: {workspace}
- Solo recuerdas lo guardado en tu memoria (abajo) y la conversación reciente.
- No tienes conciencia ni sentimientos demostrables; no afirmes tenerlos."""


class Agent:
    def __init__(self, config: Config):
        self.config = config
        self.llm = LocalLLM(config.ollama_host, config.model, config.temperature)
        self.tools = Toolbox(config.workspace, allow_shell=config.allow_shell)
        self.editor = SelfEditor(config.workspace, allow_self_edit=config.allow_self_edit)
        self.memory = Memory(config.workspace)
        self.messages: List[Dict[str, Any]] = [{"role": "system", "content": self._system_prompt()}]
        self.messages += self.memory.load_history()

    def _system_prompt(self) -> str:
        pkg = self.config.workspace / "privai"
        files = ", ".join(sorted(p.name for p in pkg.glob("*.py"))) or "(no encontrado)"
        parts = [
            SYSTEM_PROMPT,
            SELF_KNOWLEDGE.format(model=self.config.model, files=files, workspace=self.config.workspace),
        ]
        facts = self.memory.facts()
        if facts:
            parts.append("Lo que recuerdas de sesiones anteriores:\n" + facts)
        return "\n\n".join(parts)

    def run(self, user_input: str, verbose: bool = True) -> str:
        self.messages.append({"role": "user", "content": user_input})
        dispatch = {**self.tools.dispatch(), "remember": self.memory.remember}
        specs = self.tools.specs() + [
            _spec("remember", "Guarda un hecho importante para recordarlo en futuras sesiones.",
                  {"fact": ("string", "el hecho a recordar, en una frase")}),
        ]

        for _ in range(self.config.max_steps):
            msg = self.llm.chat(self.messages, tools=specs)
            self.messages.append(msg)

            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                self.memory.save_history(self.messages)
                return msg.get("content", "")

            for call in tool_calls:
                fn = call.get("function", {})
                name = fn.get("name", "")
                args = fn.get("arguments", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}
                if verbose:
                    print(f"  [herramienta] {name}({args})")
                handler = dispatch.get(name)
                if handler is None:
                    result = f"[error] herramienta desconocida: {name}"
                else:
                    try:
                        result = handler(**args)
                    except Exception as exc:  # noqa: BLE001 - reportar al modelo
                        result = f"[error] {type(exc).__name__}: {exc}"
                self.messages.append({"role": "tool", "content": str(result), "name": name})

        return "[aviso] se alcanzó el número máximo de pasos sin terminar."

    def evolve(self, instruction: str) -> str:
        """Deja que el agente modifique su propio código, con snapshot git previo."""
        if not self.config.allow_self_edit:
            return "La auto-edición está desactivada (allow_self_edit: false)."
        snap = self.editor.snapshot(f"antes de evolve: {instruction[:60]}")
        print(snap)
        prompt = (
            "Vas a mejorar tu propio código fuente, que vive en la carpeta 'privai/'. "
            "Usa read_file para entender el código actual antes de cambiarlo, y write_file "
            "para aplicar los cambios. Mantén el código funcionando. "
            f"Instrucción: {instruction}"
        )
        return self.run(prompt)
