# Skill: Testing & Auth Flow

## Token Management System

### Role-Based Authentication
Nextest manages multiple authentication tokens for different user roles. The system supports testing the same API endpoint with different role tokens.

**Supported Roles** (defined in `server/routes/auth.js`):
| Role      | Cognito Client  | Purpose               |
|-----------|-----------------|------------------------|
| `loyalty` | Loyalty_Android | Loyalty program users  |
| `buyer`   | Buyer_Android   | Buyer-side operations  |
| `seller`  | Seller_Android  | Seller-side operations |

### Auth Flow (Cognito OTP)
```
1. POST /api/auth/send-otp { mobile: "9876543210", role: "buyer" }
   → Calls Cognito signInUser → Returns { success, testOtp }

2. POST /api/auth/verify-otp { mobile: "9876543210", role: "buyer", otp: "123456" }
   → Calls Cognito verifyUser → Returns { idToken, accessToken, refreshToken, expiresIn }
```

### Token Storage (Frontend)
- Tokens stored in `sessionStorage` (cleared on tab close)
- Token payload (decoded JWT claims) cached for expiry checks
- On page load, `loadPersistedState()` checks token expiry and clears if expired
- Global store tracks: `{ token, tokenStatus: 'none'|'valid'|'invalid', tokenPayload }`

## Story Editor — Test Case Lifecycle

### Creating a Story (Manual)
```javascript
const story = {
  name: "Create order with valid payload",
  method: "POST",
  endpoint: "/api/orders",
  expected_status: 200,
  request_body: { item: "widget", qty: 5 },
  request_headers: {},
  tags: ["orders", "happy-path"],
  token_roles: ["buyer", "seller"]  // Roles this story should be tested with
};
await api.createStory(story);
```

### Creating Stories via AI
```javascript
const aiResult = await api.generateAIContext({
  method: "POST",
  endpoint: "/api/orders",
  repo_path: "/path/to/backend/repo",
  test_cases: "1. Valid order\n2. Missing required field\n3. Invalid quantity",
  model: "gemini-2.5-flash",
  token_roles: ["buyer"]
});
// aiResult is an array of { name, expected_status, request_body, tags }
```

### Quick Test (Inline Execution)
The Story Editor supports "Quick Test" — running a single story immediately:
```javascript
const result = await api.proxyRequest({
  method: story.method,
  url: baseUrl + story.endpoint,
  headers: { ...story.request_headers },
  body: story.request_body,
  token: `Bearer ${selectedToken}`
});
// Compare result.proxyStatus with story.expected_status
```

### AI Failure Analysis
When a test fails, the user can trigger AI analysis:
```javascript
const analysis = await api.generateAIContext({
  // Actually calls POST /api/ai/analyze-failure via different frontend method
  method: story.method,
  endpoint: story.endpoint,
  repo_path: repoPath,
  request_body: JSON.stringify(story.request_body),
  response_status: actualStatus,
  response_body: JSON.stringify(responseBody),
  expected_status: story.expected_status,
  model: selectedModel,
  token_roles: story.token_roles
});
// Returns { rootCause, explanation, suggestedFix }
```

## Test Runner — Batch Execution

### Full Execution Flow
```
1. Create Run:      POST /api/runs → { id: "run-uuid" }
2. Execute Run:     POST /api/runs/:id/execute
   Body: {
     token: "Bearer ...",           // Legacy single token
     role_tokens: {                  // Role-based tokens
       buyer: "Bearer ...",
       seller: "Bearer ...",
       loyalty: "Bearer ..."
     },
     base_url: "https://staging.example.com"
   }
3. For each story in workspace:
   - Resolve token(s): story.token_roles → role_tokens, or fallback to single token
   - Execute HTTP request against staging API
   - Record result in test_results table
   - Auto-create bug_report on failure
4. Return: { run_id, total, passed, failed, duration_ms, results: [...] }
```

### Token Resolution Priority
```
1. Story has token_roles AND role_tokens provided → Test with each matching role token
2. Story has token_roles but no matching role_tokens → Fall back to single token
3. No token_roles on story → Use single token
4. No tokens at all → Record as 'error' status
```

## Endpoint Discovery (SAM Template Parsing)

### SAM Template Parsing
The endpoint mapper parses AWS SAM `template.yaml` files to discover API endpoints:

```yaml
Resources:
  CreateOrderFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: nodejs18.x
      CodeUri: src/handlers/orders/
      Events:
        CreateOrder:
          Type: Api
          Properties:
            Path: /api/orders
            Method: POST
```

### Parsing handles:
- CloudFormation intrinsic functions (`!Ref`, `!GetAtt`, `!Sub`) — stripped before parsing
- Duplicate mapping keys (common in SAM) — `json: true` option
- Recursive directory scanning for `template.yaml` files
- Upsert logic: updates existing endpoints, creates new ones (matched by method + path)

## CLI Runner (CI/CD Integration)

```bash
nextest run \
  --url http://nextest.company.com:3001 \
  --api-key nextest_dev_key \
  --token "Bearer eyJhbG..."
```

- Creates a run, executes all stories, prints summary
- Exits with code 1 on any failure (breaks CI pipeline)
- Exits with code 0 on all pass
