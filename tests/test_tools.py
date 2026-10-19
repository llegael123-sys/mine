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


def test_rollback_only_reverts_own_snapshots(tmp_path: Path):
    subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp_path, capture_output=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, capture_output=True)
    (tmp_path / "f.txt").write_text("v1")
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, capture_output=True)
    subprocess.run(["git", "commit", "-m", "trabajo del usuario"], cwd=tmp_path, capture_output=True)

    ed = SelfEditor(tmp_path)
    # no revierte commits que no son suyos
    assert "no se revierte" in ed.rollback()

    # crea un snapshot propio y sí lo revierte
    (tmp_path / "f.txt").write_text("v2")
    ed.snapshot("prueba")
    ed.rollback()
    assert (tmp_path / "f.txt").read_text() == "v1"
