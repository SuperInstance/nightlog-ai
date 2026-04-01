/**
 * Dream Journal — dream logging, search, analysis, and journaling prompts.
 *
 * DreamEntry:       structured dream record with mood, tags, lucidity
 * DreamSearch:      full-text search across all dream entries
 * DreamAnalysis:    recurring themes, symbols, emotional patterns
 * DreamPrompts:     context-aware journaling prompts
 *
 * Zero dependencies. Pure TypeScript.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DreamMood = 'peaceful' | 'neutral' | 'anxious' | 'nightmare' | 'euphoric' | 'melancholic' | 'vivid';
export type LucidityLevel = 0 | 1 | 2 | 3 | 4 | 5; // 0 = none, 5 = fully lucid

export interface DreamEntry {
  id: string;
  date: string;           // YYYY-MM-DD
  content: string;
  tags: string[];
  mood: DreamMood;
  lucidity: LucidityLevel;
  createdAt: number;      // unix timestamp
}

export interface ThemeAnalysis {
  theme: string;
  count: number;
  recentDates: string[];
  moodCorrelation: Record<DreamMood, number>;
}

export interface SymbolAnalysis {
  symbol: string;
  count: number;
  contexts: string[];     // excerpts where the symbol appears
}

export interface EmotionalPattern {
  dominant: DreamMood;
  distribution: Record<DreamMood, number>;
  trend: 'stable' | 'improving' | 'declining';
}

export interface DreamPrompt {
  prompt: string;
  category: 'recall' | 'reflection' | 'lucidity' | 'theme';
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `dream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'it', 'i', 'my', 'me', 'that',
  'this', 'then', 'there', 'here', 'had', 'have', 'has', 'been', 'were',
  'are', 'be', 'so', 'as', 'not', 'but', 'if', 'all', 'just', 'very',
  'can', 'will', 'do', 'did', 'get', 'got', 'go', 'went', 'come', 'came',
  'see', 'saw', 'know', 'knew', 'think', 'thought', 'feel', 'felt', 'like',
  'some', 'what', 'how', 'who', 'when', 'where', 'which', 'no', 'yes',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function excerptAround(text: string, word: string, radius: number = 30): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(word.toLowerCase());
  if (idx === -1) return text.slice(0, 60);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + word.length + radius);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// ─── DreamSearch ───────────────────────────────────────────────────────────────

export class DreamSearch {
  /** Full-text search across dream entries, ranked by relevance */
  static search(dreams: DreamEntry[], query: string): Array<{ dream: DreamEntry; score: number; matches: string[] }> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const results: Array<{ dream: DreamEntry; score: number; matches: string[] }> = [];

    for (const dream of dreams) {
      let score = 0;
      const matches = new Set<string>();

      // Search content
      const contentTokens = tokenize(dream.content);
      for (const term of terms) {
        const count = contentTokens.filter(t => t.includes(term) || term.includes(t)).length;
        if (count > 0) {
          score += count * 2;
          matches.add(term);
        }
      }

      // Search tags (exact match, higher weight)
      for (const term of terms) {
        for (const tag of dream.tags) {
          if (tag.toLowerCase().includes(term) || term.includes(tag.toLowerCase())) {
            score += 5;
            matches.add(tag);
          }
        }
      }

      // Boost recent dreams slightly
      const ageDays = (Date.now() - dream.createdAt) / 86400000;
      score *= Math.max(0.5, 1 - ageDays / 90);

      if (score > 0) {
        results.push({ dream, score: Math.round(score), matches: [...matches] });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

// ─── DreamAnalysis ─────────────────────────────────────────────────────────────

export class DreamAnalysis {
  /** Find recurring themes across dreams */
  static recurringThemes(dreams: DreamEntry[], minOccurrences: number = 2): ThemeAnalysis[] {
    const themeMap = new Map<string, { count: number; dates: string[]; moods: DreamMood[] }>();

    for (const dream of dreams) {
      const tokens = tokenize(dream.content);
      const unique = [...new Set(tokens)];
      for (const token of unique) {
        const existing = themeMap.get(token) ?? { count: 0, dates: [], moods: [] };
        existing.count++;
        existing.dates.push(dream.date);
        existing.moods.push(dream.mood);
        themeMap.set(token, existing);
      }
      // Also index tags as themes
      for (const tag of dream.tags) {
        const t = tag.toLowerCase();
        const existing = themeMap.get(t) ?? { count: 0, dates: [], moods: [] };
        existing.count++;
        existing.dates.push(dream.date);
        existing.moods.push(dream.mood);
        themeMap.set(t, existing);
      }
    }

    const results: ThemeAnalysis[] = [];
    for (const [theme, data] of themeMap) {
      if (data.count >= minOccurrences) {
        const moodCorrelation: Record<DreamMood, number> = {
          peaceful: 0, neutral: 0, anxious: 0, nightmare: 0,
          euphoric: 0, melancholic: 0, vivid: 0,
        };
        for (const m of data.moods) moodCorrelation[m]++;
        results.push({
          theme,
          count: data.count,
          recentDates: data.dates.slice(-5),
          moodCorrelation,
        });
      }
    }

    return results.sort((a, b) => b.count - a.count).slice(0, 20);
  }

  /** Extract recurring symbols (significant nouns/words with context) */
  static recurringSymbols(dreams: DreamEntry[], minOccurrences: number = 2): SymbolAnalysis[] {
    const symbolMap = new Map<string, { count: number; contexts: Set<string> }>();

    for (const dream of dreams) {
      const tokens = tokenize(dream.content);
      const freq = new Map<string, number>();
      for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

      for (const [token, count] of freq) {
        if (count < 1) continue;
        const existing = symbolMap.get(token) ?? { count: 0, contexts: new Set<string>() };
        existing.count += count;
        existing.contexts.add(excerptAround(dream.content, token));
        symbolMap.set(token, existing);
      }
    }

    return [...symbolMap.entries()]
      .filter(([, d]) => d.count >= minOccurrences)
      .map(([symbol, data]) => ({
        symbol,
        count: data.count,
        contexts: [...data.contexts].slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  /** Analyze emotional patterns across dreams */
  static emotionalPatterns(dreams: DreamEntry[]): EmotionalPattern {
    const distribution: Record<DreamMood, number> = {
      peaceful: 0, neutral: 0, anxious: 0, nightmare: 0,
      euphoric: 0, melancholic: 0, vivid: 0,
    };

    for (const dream of dreams) {
      distribution[dream.mood]++;
    }

    const dominant = (Object.entries(distribution) as [DreamMood, number][])
      .sort((a, b) => b[1] - a[1])[0][0];

    let trend: EmotionalPattern['trend'] = 'stable';
    if (dreams.length >= 6) {
      const first = dreams.slice(0, Math.floor(dreams.length / 2));
      const second = dreams.slice(Math.floor(dreams.length / 2));
      const moodValues: Record<DreamMood, number> = {
        nightmare: 0, anxious: 1, melancholic: 2, neutral: 3, vivid: 3, peaceful: 4, euphoric: 5,
      };
      const avgFirst = first.reduce((s, d) => s + moodValues[d.mood], 0) / first.length;
      const avgSecond = second.reduce((s, d) => s + moodValues[d.mood], 0) / second.length;
      const diff = avgSecond - avgFirst;
      if (diff > 0.5) trend = 'improving';
      else if (diff < -0.5) trend = 'declining';
    }

    return { dominant, distribution, trend };
  }

  /** Lucidity practice insights */
  static lucidityInsights(dreams: DreamEntry[]): { avgLucidity: number; peakNights: string[]; techniques: string[] } {
    const lucidDreams = dreams.filter(d => d.lucidity >= 3);
    const avgLucidity = dreams.length > 0
      ? dreams.reduce((s, d) => s + d.lucidity, 0) / dreams.length
      : 0;
    return {
      avgLucidity: Math.round(avgLucidity * 10) / 10,
      peakNights: lucidDreams.map(d => d.date).slice(-5),
      techniques: lucidDreams.length > 0
        ? ['Reality checks', 'Wake-back-to-bed', 'MILD technique']
        : [],
    };
  }
}

// ─── DreamPrompts ──────────────────────────────────────────────────────────────

export class DreamPrompts {
  private static readonly RECALL_PROMPTS: DreamPrompt[] = [
    { prompt: 'What was the strongest emotion you felt in your dream?', category: 'recall' },
    { prompt: 'Describe the most vivid image or scene from your dream.', category: 'recall' },
    { prompt: 'Were there any recurring people from your waking life?', category: 'recall' },
    { prompt: 'What colours stood out in your dream?', category: 'recall' },
    { prompt: 'Did you have any sensation of flying, falling, or floating?', category: 'recall' },
  ];

  private static readonly REFLECTION_PROMPTS: DreamPrompt[] = [
    { prompt: 'How does this dream connect to something happening in your life right now?', category: 'reflection' },
    { prompt: 'If this dream had a message for you, what would it be?', category: 'reflection' },
    { prompt: 'What part of yourself does this dream reveal?', category: 'reflection' },
    { prompt: 'Did the dream resolve anything, or leave you with a question?', category: 'reflection' },
  ];

  private static readonly LUCIDITY_PROMPTS: DreamPrompt[] = [
    { prompt: 'Did you realise you were dreaming at any point? What triggered it?', category: 'lucidity' },
    { prompt: 'Practice reality checks: look at your hands in the dream. What did you see?', category: 'lucidity' },
    { prompt: 'If you became lucid, what did you choose to do?', category: 'lucidity' },
  ];

  /** Get prompts contextualised by recent dream themes */
  static suggest(dreams: DreamEntry[], count: number = 3): DreamPrompt[] {
    const all: DreamPrompt[] = [...DreamPrompts.RECALL_PROMPTS];

    // If recent dreams have themes, add theme-specific prompts
    if (dreams.length > 0) {
      const recent = dreams.slice(-5);
      const themes = DreamAnalysis.recurringThemes(recent, 1);
      if (themes.length > 0) {
        all.push({
          prompt: `You have been dreaming about "${themes[0].theme}" recently. What does this mean to you?`,
          category: 'theme',
        });
      }

      const patterns = DreamAnalysis.emotionalPatterns(recent);
      if (patterns.dominant === 'anxious' || patterns.dominant === 'nightmare') {
        all.push({ prompt: 'Your recent dreams have been intense. What in your waking life might be influencing this?', category: 'reflection' });
      }

      if (recent.some(d => d.lucidity >= 2)) {
        all.push(...DreamPrompts.LUCIDITY_PROMPTS);
      }
    }

    all.push(...DreamPrompts.REFLECTION_PROMPTS);

    // Shuffle and return
    return all.sort(() => Math.random() - 0.5).slice(0, count);
  }
}
