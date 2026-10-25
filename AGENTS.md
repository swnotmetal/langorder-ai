# Project model policy

## Project purpose

This is an open-source engineering portfolio project published on GitHub. Its acceptance criterion is a clear, credible demonstration of engineering ability with LangChain, LangGraph, LangSmith, human review, tool boundaries, persistence, recovery, testing, and ERP integration patterns. It does not need business value, commercial ROI, production throughput, customer adoption, or proof that it saves labor. Do not distort the project merely to invent a business case. Keep product behavior coherent enough to demonstrate the engineering concepts honestly, and label mock, real, and unverified evidence precisely.

Model access is one seam, `src/model.ts`, with three supported providers:

- **Google Gemini** (`gemini-2.5-flash-lite`, `GOOGLE_API_KEY`) — the default while no other provider is verified.
- **AWS Bedrock Nova** (region `eu-north-1`). Bare model ids are rejected with `on-demand throughput isn't supported`: Nova needs a cross-region inference profile such as `eu.amazon.nova-lite-v1:0`, `eu.amazon.nova-micro-v1:0` or `eu.amazon.nova-pro-v1:0`. Add it only after one account-verified invocation has actually succeeded; until then it is an unverified path and must be labelled as such.
- **A local Ollama server** (`/api/chat` with `format: <json schema>`, e.g. `qwen2.5:7b`) — for a fully self-hosted deployment where the mail must not leave the network.

Rules:

1. A task names its model explicitly. Nothing selects a model implicitly.
2. Do not ask a small local model for character-exact quotes or source indexes. It returns plain values and `src/evidence.ts` locates them in the source, so an ungrounded fact is still dropped. Measured 2026-10-26: `qwen2.5:7b` fails the strict span schema with `MODEL_QUOTE_NOT_FOUND` and passes the plain-value path; if instruction following is still weak, prefer an 8B-class model that fits the available 8 GB of VRAM rather than forcing a 14B model to offload.
3. The provider order is explicit and logged. A fallback is allowed only on transport or availability errors (timeout, 429, 5xx, connection refused). Never fall back on a validation failure: that would launder a bad extraction into a second model.
4. Every attempt is recorded in the ledger, including fallback attempts and failures, and cost is recorded per model rather than as one blended number.
5. Deterministic and mock tests make no live model calls.
6. Stop on quota, rate limit, or any API error outside the fallback list. Do not retry inside a provider.

Use fictional data only. The user revoked the two-request / $0.05 local cap on 2026-09-22. Preserve the existing ledger and record every attempted request, including failures, without a local request or spending cap. Stop on quota, rate-limit or other API errors; do not automatically retry or switch providers. Free-tier availability and billing are controlled by the Google project, not this ledger. Models cannot write ERP. Inventory tools are read-only. Clearly distinguish mock tests, real integration evidence, and unverified claims.

As an assisiting agent, you need to be fliexable as well, the rules are here but suggestions are welcome too.
