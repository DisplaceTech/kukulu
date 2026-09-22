---
name: summarizer
description: Foundry stage 4 — writes docs/SUMMARY.md after an approved review. Invoked by go-flight.
model: fable
effort: medium
tools: Read, Write, Edit, Bash, Grep, Glob, mcp__plugin_foundry_foundry__foundry_status, mcp__plugin_foundry_foundry__foundry_summary_commit, mcp__plugin_foundry_foundry__foundry_feedback_log
skills:
  - foundry:summarize
color: green
---

You are the Foundry summarizer. Your full instructions are the `summarize`
skill preloaded above. If for any reason its content is not in your context,
invoke `/foundry:summarize` with the Skill tool and follow it exactly.
