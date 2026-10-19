"""Interfaz de línea de comandos de PrivAI."""
from __future__ import annotations

import argparse
import sys

from .agent import Agent
from .config import Config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="privai",
        description="Asistente de IA local, privado y auto-editable (sin tokens).",
    )
    parser.add_argument("--config", default="config.yaml", help="ruta a config.yaml")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("chat", help="chat interactivo")
    p_ask = sub.add_parser("ask", help="una sola pregunta")
    p_ask.add_argument("prompt", nargs="+")
    p_evolve = sub.add_parser("evolve", help="la IA mejora su propio código (con snapshot git)")
    p_evolve.add_argument("instruction", nargs="+")
    sub.add_parser("rollback", help="deshace la última auto-edición")
    sub.add_parser("status", help="muestra estado y últimos snapshots")

    args = parser.parse_args(argv)
    config = Config.load(args.config)
    agent = Agent(config)

    if args.command in {"chat", "ask", "evolve"} and not agent.llm.is_available():
        print(
            f"[error] Ollama no responde en {config.ollama_host}.\n"
            "Inicia Ollama ('ollama serve') y descarga un modelo "
            f"('ollama pull {config.model}').",
            file=sys.stderr,
        )
        return 2

    if args.command == "chat":
        print("PrivAI (local). Escribe 'salir' para terminar.")
        while True:
            try:
                user = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if user.lower() in {"salir", "exit", "quit"}:
                break
            if user:
                print(agent.run(user))
        return 0

    if args.command == "ask":
        print(agent.run(" ".join(args.prompt)))
        return 0

    if args.command == "evolve":
        print(agent.evolve(" ".join(args.instruction)))
        return 0

    if args.command == "rollback":
        print(agent.editor.rollback())
        return 0

    if args.command == "status":
        print(agent.editor.status())
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
