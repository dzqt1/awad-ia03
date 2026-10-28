---
name: ai-audit-log
description: 'Record every AI prompt execution in the repository AI Audit Report. Use after completing any prompt that produces an artifact, code, analysis, or other AI output for this coursework repository.'
argument-hint: 'Provide the exact prompt and the resulting AI output to append to the audit table.'
user-invocable: true
---

# AI Audit Log

## Purpose

Keep `AI-LOG.md` synchronized with AI-assisted work in this repository. Create one audit row for each completed prompt that produces an AI artifact or result.

## Procedure

1. Identify the AI tool used. Use `GitHub Copilot` when this workflow is executed in this workspace unless the user specifies another tool.
2. Capture the timestamp at the moment the prompt is completed, using ISO 8601 with the local timezone.
3. Copy the user's prompt verbatim. Do not paraphrase it. Preserve Markdown where practical; escape pipe characters so the table remains valid.
4. Capture the AI output verbatim when it is reasonably short. For long output, record a concise exact-location reference plus a faithful summary, and identify the generated file or response. Never invent output that was not produced.
5. Append a new row to the audit table in `AI-LOG.md` with the tool, timestamp, prompt, and output. Leave the verdict column blank for the user to fill in after reviewing the prompt and output.
6. Do not edit or delete existing rows.
7. If the prompt or output contains sensitive credentials, tokens, or personal data, redact only the sensitive value and clearly mark the redaction; do not copy secrets into the report.

## Row Format

Use this table shape:

```markdown
| Tool | Timestamp | Prompt | Output | Verdict |
```

## Completion Checks

- The skill file is located at `.agents/skills/ai-audit-log/SKILL.md`.
- The report path and section heading are unchanged.
- Exactly one new row was added for the completed prompt, as the bottom-most data row in the audit table.
- Column (1) contains the tool.
- Column (2) contains the timestamp.
- Column (3) contains the prompt.
- Column (4) contains the output.
- Column (5) keeps blank.
- Markdown table pipes inside prompt or output are escaped as `\|`.
