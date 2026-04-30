# Skill: AI Integration System

## Overview
Nextest integrates with 6 AI providers for test payload generation and failure analysis. All logic in `server/routes/ai.js`.

## Supported Models

| Provider    | Prefix         | Env Var                | SDK/Endpoint                          |
|-------------|----------------|------------------------|---------------------------------------|
| Google      | `gemini*`      | `GEMINI_API_KEY`       | `@google/genai` SDK                   |
| Anthropic   | `claude*`      | `ANTHROPIC_API_KEY`    | `api.anthropic.com/v1/messages`       |
| Deepseek    | `deepseek*`    | `DEEPSEEK_API_KEY`     | `api.deepseek.com/chat/completions`   |
| OpenAI      | `gpt-*`        | `OPENAI_API_KEY`       | `api.openai.com/v1/chat/completions`  |
| Groq        | `groq-*`       | `GROQ_API_KEY`         | `api.groq.com/openai/v1/...`         |
| OpenRouter  | `openrouter-*` | `OPENROUTER_API_KEY`   | `openrouter.ai/api/v1/...`           |

## Two Endpoints

### `POST /api/ai/generate`
Generates test payloads from source code + DB schema context.
- Input: `{ method, endpoint, repo_path, test_cases, model, token_roles }`
- Output: JSON object/array with `{ name, expected_status, request_body, tags }`

### `POST /api/ai/analyze-failure`
Analyzes why a test failed using code context + request/response.
- Input: `{ method, endpoint, repo_path, request_body, request_headers, response_status, response_body, expected_status, model, token_roles }`
- Output: `{ rootCause, explanation, suggestedFix }`

## Context Building: `readRepoFiles()`
- Total limit: 25,000 chars (~6k tokens)
- Per-file limit: 6,000 chars
- Prioritizes: `template.yaml`, files matching endpoint keywords, core files
- Excludes: `node_modules`, `.git`, tests, lock files, markdown
- Includes: `.js`, `.ts`, `.json`, `.yaml`, `.yml`

## AI Response Processing
```javascript
const text = resultText.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
const result = JSON.parse(text);
```

## Adding a New Provider
1. Add API key env var to `.env`
2. Add `else if` branch in BOTH `/generate` and `/analyze-failure` handlers
3. Strip provider prefix for model name if needed
4. Update frontend model selector in `StoryEditor.jsx`
