"""Auto-modificación con red de seguridad git.

La "libertad de cambiar su propio código" se concede, pero envuelta en git:
antes de cualquier auto-edición se crea un snapshot (commit), y cualquier
cambio se puede deshacer con `rollback`. Nada es irreversible.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

SNAPSHOT_PREFIX = "privai-snapshot:"


class SelfEditor:
    def __init__(self, repo_root: Path, allow_self_edit: bool = True):
        self.repo_root = repo_root.resolve()
        self.allow_self_edit = allow_self_edit
        self.pkg_dir = self.repo_root / "privai"

    def _git(self, *args: str) -> str:
        out = subprocess.run(
            ["git", *args], cwd=self.repo_root,
            capture_output=True, text=True,
        )
        return (out.stdout + out.stderr).strip()

    def is_git_repo(self) -> bool:
        return (self.repo_root / ".git").exists()

    def snapshot(self, label: str) -> str:
        """Crea un commit de seguridad antes de auto-editarse."""
        if not self.is_git_repo():
            return "[aviso] no es un repo git; no se puede crear snapshot de seguridad."
        self._git("add", "-A", "--", "privai")
        msg = f"{SNAPSHOT_PREFIX} {label}"
        result = self._git(
            "-c", "user.name=PrivAI", "-c", "user.email=privai@localhost",
            "commit", "-m", msg, "--allow-empty",
        )
        return f"snapshot creado: {msg}\n{result}"

    def can_edit(self, path: Path) -> bool:
        """Solo se permite auto-editar archivos dentro del paquete privai/."""
        path = path.resolve()
        return self.pkg_dir == path or self.pkg_dir in path.parents

    def rollback(self) -> str:
        """Devuelve privai/ al estado del último snapshot. No toca nada fuera de privai/."""
        if not self.is_git_repo():
            return "[error] no es un repo git; no hay snapshots que restaurar."
        commit = self._git("log", "-1", "--format=%H", f"--grep=^{SNAPSHOT_PREFIX}")
        if not commit:
            return "No hay ningún snapshot de PrivAI que restaurar."
        self._git("checkout", commit, "--", "privai")
        self._git("clean", "-fdq", "--", "privai")
        return f"privai/ restaurado al snapshot {commit[:8]}."

    def status(self) -> str:
        if not self.is_git_repo():
            return "no es un repo git"
        return self._git("log", "--oneline", "-5")
