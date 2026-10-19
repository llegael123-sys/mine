# PrivAI — asistente de IA local, privado y auto-editable

PrivAI es un agente de IA que corre **100% en tu máquina**. No usa APIs de pago
ni envía tus datos a la nube, y puede modificar su propio código de forma segura.

## Qué significa cada requisito

| Lo que pediste | Cómo se implementa |
| --- | --- |
| **Sin tokens** | Usa un modelo **local** vía [Ollama](https://ollama.com). No hay claves de API ni coste por uso. |
| **Privada** | Todo corre en `localhost`. Ninguna petición sale a Internet. |
| **Que acceda a lo que pueda** | Herramientas de lectura/escritura/búsqueda limitadas al *workspace* que tú apuntes. |
| **Libertad de cambiar su código** | Puede editar sus propios archivos `.py`, pero **cada cambio se versiona con git** y es reversible. |

## Límites de seguridad (a propósito)

Esto es un agente, no un programa sin control. Para que siga siendo útil y seguro:

- **Sandbox de rutas**: solo accede a archivos dentro de la carpeta raíz configurada.
- **Red de seguridad git**: antes de auto-editarse hace un *snapshot* (commit). Puedes
  deshacer cualquier cambio con `privai rollback`.
- **Sin ejecución de comandos arbitrarios por defecto**: la herramienta de shell está
  desactivada salvo que la actives explícitamente en `config.yaml`.
- Todo cambio que la IA hace sobre sí misma queda registrado en el historial de git.

## Instalación

```bash
# 1. Instala Ollama (https://ollama.com) y descarga un modelo local
ollama pull llama3.1        # o qwen2.5, mistral, etc.

# 2. Instala PrivAI
pip install -e .
```

## Uso

```bash
# Chat interactivo con el agente
privai chat

# Una sola pregunta
privai ask "resume el archivo notes.txt"

# Deja que la IA se mejore a sí misma (con snapshot git automático)
privai evolve "añade logging a tools.py"

# Deshacer el último cambio que la IA se hizo a sí misma
privai rollback
```

## Configuración

Edita `config.yaml`:

```yaml
model: llama3.1              # modelo local de Ollama
ollama_host: http://localhost:11434
workspace: .                # raíz a la que el agente tiene acceso
allow_self_edit: true       # permitir que modifique su propio código
allow_shell: false          # ejecutar comandos de shell (apagado por seguridad)
max_steps: 12               # pasos máximos del bucle del agente
```

## Arquitectura

```
privai/
├── llm.py        Cliente de Ollama (modelo local, sin tokens)
├── tools.py      Herramientas: leer, escribir, listar, buscar archivos
├── self_edit.py  Auto-modificación con red de seguridad git
├── agent.py      Bucle del agente (razonar → usar herramienta → repetir)
└── cli.py        Interfaz de línea de comandos
```
