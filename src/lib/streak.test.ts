import { describe, it, expect } from 'vitest';
import { logStreak, streakHealth, STREAK_LOSS_MIN } from './streak';
import type { Block } from './types';

// IST-anchored instants (noon IST) so fmtDate() resolves the same calendar day
// regardless of the machine's timezone.
const ist = (d: string) => new Date(`${d}T12:00:00+05:30`);
const text = (content: string): Block => ({ id: content, type: 'text', content }) as Block;
const written = (log_date: string) => ({ log_date, blocks: [text('did things')] });
// A day opened but never written in: only the seeded heading persists.
const blank = (log_date: string) => ({
  log_date,
  blocks: [{ id: 'h', type: 'h3', content: 'Notes' } as Block, text('')],
});

// Week of 28 Sep 2026: Mon 28, Tue 29, Wed 30, Thu 1 Oct, Fri 2, Sat 3, Sun 4.
const MON = '2026-09-28';
const TUE = '2026-09-29';
const WED = '2026-09-30';
const THU = '2026-10-01';
const FRI = '2026-10-02';
const SAT = '2026-10-03';

describe('logStreak', () => {
  it('does not break on an as-yet-unwritten today', () => {
    expect(logStreak([written(MON), written(TUE), written(WED)], ist(THU))).toBe(3);
  });

  it('breaks on a past working day with no log', () => {
    expect(logStreak([written(MON), written(WED)], ist(THU))).toBe(1);
  });

  it('treats a heading-only log as not written', () => {
    expect(logStreak([written(MON), written(TUE), blank(WED)], ist(THU))).toBe(0);
  });

  it('skips the weekend without breaking', () => {
    expect(logStreak([written(THU), written(FRI)], ist('2026-10-05'))).toBe(2);
  });
});

describe('streakHealth', () => {
  it('is safe once today is written', () => {
    const h = streakHealth([written(WED), written(THU)], ist(THU));
    expect(h).toMatchObject({ streak: 2, state: 'safe' });
  });

  it('is at risk on an unwritten working day with a live streak', () => {
    const h = streakHealth([written(TUE), written(WED)], ist(THU));
    expect(h).toMatchObject({ streak: 2, state: 'at_risk' });
  });

  it('is never at risk on a weekend', () => {
    expect(streakHealth([written(THU), written(FRI)], ist(SAT)).state).toBe('safe');
  });

  it('is ended when a run of STREAK_LOSS_MIN+ broke recently', () => {
    const logs = [written(MON), written(TUE), written(WED)];
    const h = streakHealth(logs, ist(FRI));
    expect(h).toMatchObject({ streak: 0, state: 'ended', lost: 3, lostOn: WED });
  });

  it('is none when the run that broke was too short to name', () => {
    const logs = [written(TUE), written(WED)].slice(0, STREAK_LOSS_MIN - 1);
    expect(streakHealth(logs, ist(FRI)).state).toBe('none');
  });

  it('is none once the loss is older than the grace window', () => {
    const logs = [written(MON), written(TUE), written(WED)];
    expect(streakHealth(logs, ist('2026-10-12')).state).toBe('none');
  });

  it('is none for someone who has never written', () => {
    expect(streakHealth([], ist(THU))).toMatchObject({ streak: 0, state: 'none' });
  });
});
