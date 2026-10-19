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
