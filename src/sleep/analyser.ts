/**
 * Sleep Analyser — engine for sleep pattern analysis and circadian optimization.
 *
 * SleepDebt:        track cumulative sleep debt over rolling windows
 * CircadianRhythm:  suggest optimal bedtimes from desired wake time
 * PatternDetection: find correlations between habits and sleep quality
 * SleepScore:       composite quality score (duration + consistency + debt)
 * Recommendations:  personalized tips derived from detected patterns
 *
 * Zero dependencies. Pure TypeScript.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SleepLog {
  date: string;            // YYYY-MM-DD
  bedtime: string;         // HH:mm
  wakeTime: string;        // HH:mm
  quality: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

export interface SleepPattern {
  name: string;
  confidence: number;      // 0–1
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface SleepInsight {
  date: string;
  score: number;
  debt: number;
  optimalBedtime: string;
  patterns: SleepPattern[];
  recommendations: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h * 60 + m) % 1440;
}

function sleepDurationMinutes(bedtime: string, wakeTime: string): number {
  let bed = parseMinutes(bedtime);
  let wake = parseMinutes(wakeTime);
  if (wake <= bed) wake += 1440; // crossed midnight
  return wake - bed;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function dayOfWeek(date: string): number {
  return new Date(date).getDay();
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

const OPTIMAL_SLEEP_MINUTES = 480; // 8 hours

// ─── SleepDebt ─────────────────────────────────────────────────────────────────

export class SleepDebt {
  /**
   * Calculate cumulative sleep debt over the last N nights.
   * Positive = sleep owed, negative = surplus.
   */
  static calculate(logs: SleepLog[], nights: number = 7): number {
    const recent = logs.slice(-nights);
    let debt = 0;
    for (const log of recent) {
      const duration = sleepDurationMinutes(log.bedtime, log.wakeTime);
      debt += OPTIMAL_SLEEP_MINUTES - duration;
    }
    return debt;
  }

  /** Debt categorised as a human-readable label */
  static label(debtMinutes: number): string {
    if (debtMinutes <= 0) return 'No sleep debt — you are well rested';
    if (debtMinutes <= 120) return 'Mild sleep debt — an early night would help';
    if (debtMinutes <= 360) return 'Moderate sleep debt — prioritise sleep this week';
    return 'Severe sleep debt — recovery sleep is critical';
  }

  /** Rolling 7-day debt trend: positive = worsening, negative = recovering */
  static trend(logs: SleepLog[]): number {
    if (logs.length < 14) return 0;
    const thisWeek = SleepDebt.calculate(logs, 7);
    const lastWeek = SleepDebt.calculate(logs.slice(0, -7), 7);
    return thisWeek - lastWeek;
  }
}

// ─── CircadianRhythm ───────────────────────────────────────────────────────────

export class CircadianRhythm {
  /**
   * Suggest optimal bedtime for a desired wake time, accounting for
   * 90-minute sleep cycles and the ~14-minute average sleep latency.
   */
  static suggestBedtime(wakeTime: string, cycles: number = 5): string {
    const wakeMinutes = parseMinutes(wakeTime);
    // 5 cycles × 90 min = 7.5h + 14 min latency
    const sleepLatency = 14;
    const bedtime = wakeMinutes - (cycles * 90) - sleepLatency;
    const adjusted = ((bedtime % 1440) + 1440) % 1440;
    const h = Math.floor(adjusted / 60);
    const m = adjusted % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Suggest multiple bedtimes (4, 5, 6 cycles) */
  static suggestAll(wakeTime: string): Array<{ cycles: number; bedtime: string; duration: string }> {
    return [4, 5, 6].map(cycles => ({
      cycles,
      bedtime: CircadianRhythm.suggestBedtime(wakeTime, cycles),
      duration: formatDuration(cycles * 90),
    }));
  }

  /** Detect chronotype from average bedtime patterns */
  static chronotype(logs: SleepLog[]): string {
    if (logs.length < 5) return 'Unknown — need more data';
    const recent = logs.slice(-14);
    const avgBedtime = recent.reduce((sum, l) => sum + parseMinutes(l.bedtime), 0) / recent.length;
    if (avgBedtime < 1320 && avgBedtime > 600) return 'Early bird (lark)';
    if (avgBedtime >= 1320 || avgBedtime < 60) return 'Night owl';
    return 'Intermediate';
  }

  /** Consistency of bedtime (standard deviation in minutes) */
  static bedtimeConsistency(logs: SleepLog[]): number {
    if (logs.length < 3) return 0;
    const recent = logs.slice(-14);
    const bedtimes = recent.map(l => parseMinutes(l.bedtime));
    const mean = bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length;
    const variance = bedtimes.reduce((sum, t) => sum + (t - mean) ** 2, 0) / bedtimes.length;
    return Math.round(Math.sqrt(variance));
  }
}

// ─── PatternDetection ──────────────────────────────────────────────────────────

export class PatternDetection {
  /** Detect patterns from sleep logs and associated notes */
  static detect(logs: SleepLog[]): SleepPattern[] {
    const patterns: SleepPattern[] = [];
    if (logs.length < 3) return patterns;

    // Late caffeine correlation
    patterns.push(...PatternDetection.detectCaffeinePattern(logs));
    // Weekend shift
    patterns.push(...PatternDetection.detectWeekendShift(logs));
    // Inconsistent bedtime
    patterns.push(...PatternDetection.detectInconsistency(logs));
    // Quality trend
    patterns.push(...PatternDetection.detectQualityTrend(logs));
    // Short sleep
    patterns.push(...PatternDetection.detectShortSleep(logs));

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  private static detectCaffeinePattern(logs: SleepLog[]): SleepPattern[] {
    const caffeineLogs = logs.filter(l =>
      l.notes?.toLowerCase().includes('caffeine') ||
      l.notes?.toLowerCase().includes('coffee') ||
      l.notes?.toLowerCase().includes('tea')
    );
    if (caffeineLogs.length < 2) return [];
    const avgQualityWith = caffeineLogs.reduce((s, l) => s + l.quality, 0) / caffeineLogs.length;
    const otherLogs = logs.filter(l => !caffeineLogs.includes(l));
    const avgQualityWithout = otherLogs.length > 0
      ? otherLogs.reduce((s, l) => s + l.quality, 0) / otherLogs.length
      : 3;
    const diff = avgQualityWithout - avgQualityWith;
    if (diff > 0.5) {
      return [{
        name: 'Late caffeine hurts sleep',
        confidence: Math.min(diff / 2, 1),
        description: `Sleep quality averages ${avgQualityWith.toFixed(1)}/5 on caffeine days vs ${avgQualityWithout.toFixed(1)}/5 without`,
        impact: 'negative',
      }];
    }
    return [];
  }

  private static detectWeekendShift(logs: SleepLog[]): SleepPattern[] {
    const weekday = logs.filter(l => { const d = dayOfWeek(l.date); return d > 0 && d < 6; });
    const weekend = logs.filter(l => { const d = dayOfWeek(l.date); return d === 0 || d === 6; });
    if (weekday.length < 3 || weekend.length < 2) return [];
    const avgWeekdayBed = weekday.reduce((s, l) => s + parseMinutes(l.bedtime), 0) / weekday.length;
    const avgWeekendBed = weekend.reduce((s, l) => s + parseMinutes(l.bedtime), 0) / weekend.length;
    let diff = Math.abs(avgWeekendBed - avgWeekdayBed);
    if (diff > 720) diff = 1440 - diff; // handle midnight wrap
    if (diff > 60) {
      return [{
        name: 'Weekend sleep shift (social jetlag)',
        confidence: Math.min(diff / 180, 1),
        description: `Bedtime shifts ${formatDuration(diff)} on weekends vs weekdays`,
        impact: diff > 120 ? 'negative' : 'neutral',
      }];
    }
    return [];
  }

  private static detectInconsistency(logs: SleepLog[]): SleepPattern[] {
    const sd = CircadianRhythm.bedtimeConsistency(logs);
    if (sd > 60) {
      return [{
        name: 'Irregular bedtime schedule',
        confidence: Math.min(sd / 120, 1),
        description: `Bedtime varies by ~${formatDuration(sd)} on average`,
        impact: sd > 90 ? 'negative' : 'neutral',
      }];
    }
    return [];
  }

  private static detectQualityTrend(logs: SleepLog[]): SleepPattern[] {
    if (logs.length < 7) return [];
    const first = logs.slice(-14, -7);
    const second = logs.slice(-7);
    const avgFirst = first.reduce((s, l) => s + l.quality, 0) / first.length;
    const avgSecond = second.reduce((s, l) => s + l.quality, 0) / second.length;
    const diff = avgSecond - avgFirst;
    if (Math.abs(diff) >= 0.5) {
      return [{
        name: diff > 0 ? 'Sleep quality improving' : 'Sleep quality declining',
        confidence: Math.min(Math.abs(diff) / 2, 1),
        description: `Quality shifted from ${avgFirst.toFixed(1)}/5 to ${avgSecond.toFixed(1)}/5 this week`,
        impact: diff > 0 ? 'positive' : 'negative',
      }];
    }
    return [];
  }

  private static detectShortSleep(logs: SleepLog[]): SleepPattern[] {
    const recent = logs.slice(-7);
    const shortNights = recent.filter(l => sleepDurationMinutes(l.bedtime, l.wakeTime) < 360);
    if (shortNights.length >= 3) {
      return [{
        name: 'Chronic short sleep',
        confidence: shortNights.length / 7,
        description: `${shortNights.length} of the last 7 nights under 6 hours`,
        impact: 'negative',
      }];
    }
    return [];
  }
}

// ─── SleepScore ────────────────────────────────────────────────────────────────

export class SleepScore {
  /**
   * Composite sleep quality score (0–100).
   *   Duration:    0–40 pts  (7–9h = full, scales down)
   *   Consistency: 0–30 pts  (low bedtime variance = full)
   *   Quality:     0–20 pts  (subjective rating)
   *   Debt:        0–10 pts  (low/zero debt = full)
   */
  static calculate(logs: SleepLog[]): number {
    if (logs.length === 0) return 0;
    const latest = logs[logs.length - 1];
    const duration = sleepDurationMinutes(latest.bedtime, latest.wakeTime);

    // Duration score (40 pts)
    let durationScore: number;
    if (duration >= 420 && duration <= 540) durationScore = 40;        // 7–9h
    else if (duration >= 360) durationScore = 30;                       // 6–7h
    else if (duration >= 300) durationScore = 20;                       // 5–6h
    else durationScore = Math.max(0, Math.round(duration / 30));        // <5h

    // Consistency score (30 pts)
    const sd = CircadianRhythm.bedtimeConsistency(logs);
    const consistencyScore = Math.max(0, Math.round(30 - (sd / 3)));

    // Quality score (20 pts)
    const qualityScore = latest.quality * 4;

    // Debt score (10 pts)
    const debt = SleepDebt.calculate(logs, 7);
    const debtScore = Math.max(0, Math.round(10 - (debt / 60)));

    return Math.min(100, durationScore + consistencyScore + qualityScore + debtScore);
  }

  /** Human label for a score */
  static label(score: number): string {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Poor';
    return 'Critical';
  }
}

// ─── Recommendations ───────────────────────────────────────────────────────────

export class Recommendations {
  /** Generate personalised tips based on detected patterns and current state */
  static generate(logs: SleepLog[]): string[] {
    const tips: string[] = [];
    if (logs.length === 0) return ['Start logging your sleep to receive personalised recommendations.'];

    const patterns = PatternDetection.detect(logs);
    const debt = SleepDebt.calculate(logs, 7);
    const score = SleepScore.calculate(logs);
    const latest = logs[logs.length - 1];
    const duration = sleepDurationMinutes(latest.bedtime, latest.wakeTime);

    // Pattern-based tips
    for (const p of patterns) {
      if (p.impact === 'negative') {
        switch (p.name) {
          case 'Late caffeine hurts sleep':
            tips.push('Try cutting off caffeine after 2pm — your data shows it correlates with lower quality sleep.');
            break;
          case 'Weekend sleep shift (social jetlag)':
            tips.push('Keep weekend bedtimes within 1 hour of weekdays to reduce social jetlag.');
            break;
          case 'Irregular bedtime schedule':
            tips.push('Set a consistent bedtime alarm. Your body thrives on rhythm.');
            break;
          case 'Chronic short sleep':
            tips.push('Aim for at least 7 hours. Short sleep compounds into serious debt.');
            break;
          case 'Sleep quality declining':
            tips.push('Quality is trending down this week. Review recent changes in routine, screen time, or stress.');
            break;
        }
      }
    }

    // Debt-based tips
    if (debt > 360) {
      tips.push('You are carrying heavy sleep debt. Consider a 20-minute power nap and an early night.');
    } else if (debt > 120) {
      tips.push('A mild sleep debt is building. An extra 30 minutes tonight will help.');
    }

    // Duration-based tips
    if (duration < 360) {
      tips.push(`Last night was only ${formatDuration(duration)}. Most adults need 7–9 hours.`);
    }

    // Circadian tips
    if (logs.length >= 3) {
      const chronotype = CircadianRhythm.chronotype(logs);
      if (chronotype === 'Night owl') {
        tips.push('As a night owl, morning light exposure within 30 min of waking can help anchor your rhythm.');
      }
      const suggestions = CircadianRhythm.suggestAll(latest.wakeTime);
      const optimal = suggestions.find(s => s.cycles === 5);
      if (optimal) {
        tips.push(`For your ${latest.wakeTime} wake time, aim for a ${optimal.bedtime} bedtime (${optimal.duration} of sleep).`);
      }
    }

    // General tips if few specific ones
    if (tips.length < 2) {
      tips.push('Avoid screens 30 minutes before bed — blue light suppresses melatonin.');
      tips.push('Keep your bedroom cool (18–20°C) for optimal sleep quality.');
    }

    return tips.slice(0, 5);
  }
}
