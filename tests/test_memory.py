"""Pruebas de la memoria persistente."""
from pathlib import Path

from privai.memory import MAX_HISTORY, Memory


def test_remember_and_forget(tmp_path: Path):
    mem = Memory(tmp_path)
    assert mem.facts() == ""
    mem.remember("el usuario se llama Fran")
    assert "Fran" in mem.facts()
    mem.forget()
    assert mem.facts() == ""


def test_history_keeps_only_recent_turns(tmp_path: Path):
    mem = Memory(tmp_path)
    msgs = [{"role": "system", "content": "sys"}]
    msgs += [{"role": "tool", "content": "x", "name": "read_file"}]
    msgs += [{"role": "user", "content": f"m{i}"} for i in range(MAX_HISTORY + 5)]
    mem.save_history(msgs)
    loaded = Memory(tmp_path).load_history()
    assert len(loaded) == MAX_HISTORY
    assert all(m["role"] == "user" for m in loaded)
    assert loaded[-1]["content"] == f"m{MAX_HISTORY + 4}"


def test_agent_guards_self_edits(tmp_path: Path):
    import subprocess

    from privai.agent import Agent
    from privai.config import Config

    for args in (["init"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
        subprocess.run(["git", *args], cwd=tmp_path, capture_output=True, check=True)
    (tmp_path / "privai").mkdir()
    cfg = Config.load(tmp_path / "no-existe.yaml")
    cfg.workspace = tmp_path

    agent = Agent(cfg)
    assert "SÍ puedes modificar tu propio código" in agent.messages[0]["content"]
    agent._write_file("privai/x.py", "print(1)")
    agent._write_file("privai/y.py", "print(2)")
    log = subprocess.run(["git", "log", "--format=%s"], cwd=tmp_path,
                         capture_output=True, text=True).stdout
    assert log.count("privai-snapshot") == 1  # una sola copia de seguridad por tarea

    cfg.allow_self_edit = False
    locked = Agent(cfg)
    assert "NO puedes modificar" in locked.messages[0]["content"]
    assert "bloqueado" in locked._write_file("privai/z.py", "x")
    assert not (tmp_path / "privai" / "z.py").exists()
