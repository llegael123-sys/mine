"""Herramientas del agente: acceso a archivos limitado al workspace.

Todas las rutas se resuelven contra la raíz del workspace y se rechaza
cualquier intento de salir de ella (sandbox). Así el agente "accede a todo
lo que puede" dentro de un límite claro y seguro.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List


class Toolbox:
    def __init__(self, workspace: Path, allow_shell: bool = False):
        self.workspace = workspace.resolve()
        self.allow_shell = allow_shell

    # --- sandbox ---------------------------------------------------------
    def _safe(self, rel_path: str) -> Path:
        target = (self.workspace / rel_path).resolve()
        if target != self.workspace and self.workspace not in target.parents:
            raise PermissionError(
                f"Acceso denegado: '{rel_path}' está fuera del workspace."
            )
        return target

    # --- herramientas ----------------------------------------------------
    def read_file(self, path: str) -> str:
        p = self._safe(path)
        if not p.is_file():
            return f"[error] no existe el archivo: {path}"
        return p.read_text(errors="replace")

    def write_file(self, path: str, content: str) -> str:
        p = self._safe(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return f"escrito {len(content)} caracteres en {p}"

    def list_dir(self, path: str = ".") -> str:
        p = self._safe(path)
        if not p.is_dir():
            return f"[error] no es un directorio: {path}"
        entries = sorted(
            f"{e.name}/" if e.is_dir() else e.name for e in p.iterdir()
        )
        return "\n".join(entries) or "(vacío)"

    def search(self, query: str, path: str = ".") -> str:
        root = self._safe(path)
        hits: List[str] = []
        for f in root.rglob("*"):
            if not f.is_file():
                continue
            try:
                for i, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
                    if query in line:
                        hits.append(f"{f.relative_to(self.workspace)}:{i}: {line.strip()}")
                        if len(hits) >= 100:
                            return "\n".join(hits) + "\n... (truncado)"
            except (OSError, UnicodeDecodeError):
                continue
        return "\n".join(hits) or f"sin resultados para '{query}'"

    def run_shell(self, command: str) -> str:
        if not self.allow_shell:
            return "[bloqueado] la ejecución de shell está desactivada (allow_shell: false)."
        try:
            out = subprocess.run(
                command, shell=True, cwd=self.workspace,
                capture_output=True, text=True, timeout=120,
            )
        except subprocess.TimeoutExpired:
            return "[error] el comando excedió el tiempo límite."
        return (out.stdout + out.stderr).strip() or "(sin salida)"

    # --- registro para el LLM -------------------------------------------
    def specs(self) -> List[Dict[str, Any]]:
        tools = [
            _spec("read_file", "Lee un archivo del workspace.",
                  {"path": ("string", "ruta relativa al archivo")}),
            _spec("write_file", "Escribe (o sobrescribe) un archivo del workspace.",
                  {"path": ("string", "ruta relativa"), "content": ("string", "contenido completo")}),
            _spec("list_dir", "Lista el contenido de un directorio.",
                  {"path": ("string", "ruta relativa (por defecto '.')")}),
            _spec("search", "Busca texto en los archivos del workspace.",
                  {"query": ("string", "texto a buscar"), "path": ("string", "subcarpeta, opcional")}),
        ]
        if self.allow_shell:
            tools.append(_spec("run_shell", "Ejecuta un comando de shell en el workspace.",
                               {"command": ("string", "comando a ejecutar")}))
        return tools

    def dispatch(self) -> Dict[str, Callable[..., str]]:
        return {
            "read_file": self.read_file,
            "write_file": self.write_file,
            "list_dir": self.list_dir,
            "search": self.search,
            "run_shell": self.run_shell,
        }


def _spec(name: str, desc: str, params: Dict[str, tuple]) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": {
                    k: {"type": t, "description": d} for k, (t, d) in params.items()
                },
                "required": [k for k in params],
            },
        },
    }
