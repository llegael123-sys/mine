"""Pruebas del sandbox de rutas y del editor con red de seguridad git."""
import subprocess
from pathlib import Path

import pytest

from privai.self_edit import SelfEditor
from privai.tools import Toolbox


def test_read_write_within_workspace(tmp_path: Path):
    tb = Toolbox(tmp_path)
    tb.write_file("sub/a.txt", "hola")
    assert tb.read_file("sub/a.txt") == "hola"
    assert "a.txt" in tb.list_dir("sub")


def test_sandbox_blocks_escape(tmp_path: Path):
    tb = Toolbox(tmp_path)
    with pytest.raises(PermissionError):
        tb.read_file("../../etc/passwd")
    with pytest.raises(PermissionError):
        tb.write_file("/etc/evil", "x")


def test_shell_blocked_by_default(tmp_path: Path):
    tb = Toolbox(tmp_path, allow_shell=False)
    assert "bloqueado" in tb.run_shell("echo hi")


def test_search(tmp_path: Path):
    tb = Toolbox(tmp_path)
    tb.write_file("note.txt", "buscar esto\notra linea")
    assert "buscar esto" in tb.search("buscar")


def test_self_editor_can_edit_only_package(tmp_path: Path):
    ed = SelfEditor(tmp_path)
    assert ed.can_edit(tmp_path / "privai" / "tools.py")
    assert not ed.can_edit(tmp_path / "otro" / "x.py")


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True)


def test_rollback_restores_only_own_code(tmp_path: Path):
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    pkg = tmp_path / "privai"
    pkg.mkdir()
    (pkg / "tools.py").write_text("v1")
    (tmp_path / "notas.txt").write_text("trabajo del usuario")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-m", "inicio")

    ed = SelfEditor(tmp_path)
    assert "No hay" in ed.rollback()

    ed.snapshot("prueba")
    (pkg / "tools.py").write_text("v2 roto")
    (pkg / "nuevo.py").write_text("x")
    (tmp_path / "notas.txt").write_text("cambio sin guardar del usuario")

    ed.rollback()
    assert (pkg / "tools.py").read_text() == "v1"
    assert not (pkg / "nuevo.py").exists()
    # lo que está fuera de privai/ no se toca
    assert (tmp_path / "notas.txt").read_text() == "cambio sin guardar del usuario"


def test_snapshot_works_without_git_identity(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    _git(tmp_path, "init")
    (tmp_path / "privai").mkdir()
    (tmp_path / "privai" / "a.py").write_text("x")
    SelfEditor(tmp_path).snapshot("sin identidad")
    log = subprocess.run(["git", "log", "--format=%an %s"], cwd=tmp_path,
                         capture_output=True, text=True).stdout
    assert "PrivAI privai-snapshot: sin identidad" in log
