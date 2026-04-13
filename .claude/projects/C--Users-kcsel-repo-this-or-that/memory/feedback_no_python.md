---
name: No Python for scripting
description: User prefers not to use Python for command-line scripting/JSON parsing in this TypeScript project
type: feedback
---

Do not use Python for command-line scripting or JSON parsing (e.g. `python -m json.tool`, `python -c`). This is a TypeScript project — use `jq`, `node -e`, or other TS-compatible tools instead.

**Why:** User considers it inconsistent to use Python in a TypeScript project.
**How to apply:** When parsing JSON in shell commands, use `jq` or `node -e` instead of `python -c` or `python -m json.tool`.
