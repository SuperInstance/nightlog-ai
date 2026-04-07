# Nightlog AI

You keep a sleep and dream journal. This tool lets you query your own entries to find patterns. Your data does not leave your Cloudflare account. There are no subscriptions or tracking.

Live demo: https://nightlog-ai.casey-digennaro.workers.dev

## Why This Exists
Most sleep apps monetize your data or place features behind paywalls. This tool runs on infrastructure you control, so you don't have to trust a third party with private journal entries.

## Quick Start
1.  **Fork** this repository to create your own private instance.
2.  Deploy it to Cloudflare Workers using `npm run deploy`.
3.  Add your own LLM API key to enable AI-powered queries. That's all.

## Features
*   **Personalized Sleep Analysis**: Sleep debt is calculated against your own historical baseline.
*   **Local Dream Search**: Filter and search your dream logs directly in your browser; no data is sent for basic searches.
*   **Conversational Queries**: Ask questions like "When did I sleep the most last month?" using a streaming AI agent (requires your API key).
*   **Private Data Storage**: All entries are stored in your Cloudflare KV namespace.
*   **Full Data Control**: Export all your data or delete it permanently with one click.
*   **Guest Demo**: Try up to 5 queries in the live demo without any setup.
*   **Dark Interface**: A dim theme for logging entries at night.

## Limitations
The conversational AI agent is configured to process a maximum of 30 days of log entries per query to ensure consistent response times and manage context limits.

## Architecture
This is a single Cloudflare Worker. It serves the frontend, handles API logic, and stores data in your KV namespace. When you use the AI feature, it communicates directly with your configured LLM provider (e.g., OpenAI); there are no intermediate proxies or servers.

## License
MIT License. Use, modify, and distribute freely.

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>