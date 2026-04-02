# nightlog.ai

A repo-native AI agent for sleep and dreams. Built on Cloudflare Workers with persistent KV storage, DeepSeek-powered chat, and a midnight-blue interface that feels like the sky outside your window at 3am.

## Why repo-native?

Most sleep trackers live in someone else's cloud, locked behind a subscription. Nightlog lives in *your* repo. Your sleep data, dream journal, and AI insights persist as files you control — versioned, portable, and yours across years. The repo IS the agent.

## Features

**Sleep Tracker**
- Log bedtime, wake time, quality (1-5), and notes
- Cumulative sleep debt tracking over rolling 7-day windows
- Circadian rhythm analysis with optimal bedtime suggestions
- Chronotype detection (early bird / night owl / intermediate)
- Bedtime consistency scoring

**Dream Journal**
- Record dreams with mood tags, lucidity levels, and custom tags
- Full-text search across all dream entries
- Recurring theme detection with mood correlation
- Symbol extraction with context excerpts
- Emotional pattern tracking (improving / declining / stable)
- Context-aware journaling prompts

**AI Sleep Insights**
- Composite sleep score (0-100) from duration + consistency + quality + debt
- Pattern detection: caffeine correlation, social jetlag, quality trends, chronic short sleep
- Personalized recommendations grounded in your actual data
- Dream analysis: recurring themes, symbols, emotional patterns, lucidity insights

**Chat Interface**
- Streaming SSE chat powered by DeepSeek
- Context-aware: AI references your actual sleep and dream data
- Demo mode: 5 free messages as guest, no sign-up required

**Design**
- Deep indigo/purple dark theme with animated star field
- Midnight blue surfaces, silver text, violet accents
- Sound notifications on actions
- Fully responsive

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/nightlog-ai.git
cd nightlog-ai

# Install Wrangler (Cloudflare Workers CLI)
npm install -g wrangler

# Set secrets
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put JWT_SECRET

# Deploy
wrangler deploy

# Or run locally
wrangler dev
```

Open `http://localhost:8787` — you'll see the landing page. Click through to the app.

## Project Structure

```
src/
  worker.ts          # Cloudflare Worker — routing, auth, SSE streaming
  sleep/
    analyser.ts      # SleepDebt, CircadianRhythm, PatternDetection, SleepScore, Recommendations
  dreams/
    journal.ts       # DreamEntry, DreamSearch, DreamAnalysis, DreamPrompts
public/
  app.html           # Full dark-theme UI (sleep tracker, dream journal, insights, chat)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Dark theme landing page |
| `POST` | `/api/auth/token` | Issue a JWT |
| `POST` | `/api/chat` | SSE streaming chat (DeepSeek) |
| `GET`  | `/api/sleep/{date}` | Sleep data for a date |
| `POST` | `/api/sleep/log` | Log a sleep session |
| `GET`  | `/api/dreams` | List dream entries |
| `POST` | `/api/dreams` | Save a dream entry |
| `GET`  | `/api/insights` | AI-generated sleep insights |

## Screenshots

*Landing page*: Deep indigo background with animated twinkling stars. The word "nightlog" in soft violet, with four feature cards below — Sleep Tracker, Dream Journal, AI Insights, Sleep Chat. A single "Open nightlog" button glows violet.

*Sleep Tracker*: Dark surface panel with a circular score ring (violet arc, score number in center). Form fields for date, bedtime, wake time, a quality slider, and notes. Below: a list of recent nights with colored quality dots and duration.

*Dream Journal*: Gold-accented form with a textarea for dream content, mood pills (peaceful, anxious, nightmare...), lucidity slider, and tag input. Journal prompts appear above the form. Dream cards below with mood, date, and content.

*Insights Dashboard*: Grid of insight cards — Sleep Score with big number, Sleep Debt with hours owed, Chronotype label, quality bar chart in violet/teal/gold/rose. Pattern cards with colored tags. Recommendation list with arrow bullets. Optimal bedtime table.

*Chat*: Monospace dark interface with user messages aligned right (violet tint) and assistant messages left (dark surface). Typing indicator with three bouncing dots. Input bar at bottom with violet send button.

## License

MIT

## License

MIT — Built with ❤️ by [Superinstance](https://github.com/superinstance) & [Lucineer](https://github.com/Lucineer) (DiGennaro et al.)
