// Vercel Cron endpoint - daily maintenance sweeps. These also run on every
// authenticated page load, but that only fires when someone is online.
// Running them here guarantees the reminders still go out overnight and on
// weekends when nobody opens the app.
//
// Secured by CRON_SECRET (Vercel auto-injects `Authorization: Bearer
// ${CRON_SECRET}` — that env-var name is fixed by Vercel).
import { NextRequest, NextResponse } from 'next/server';
import {
  sweepMissedPunchOuts,
  sweepGoalDeadlines,
  sweepWorkAnniversaries,
  sweepBirthdays,
  sweepOldNotifications,
} from '@/lib/actions';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || !secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sweeps = await Promise.allSettled([
    sweepMissedPunchOuts(),
    sweepGoalDeadlines(),
    sweepWorkAnniversaries(),
    sweepBirthdays(),
    sweepOldNotifications(),
  ]);
  const failed = sweeps.some((s) => s.status === 'rejected');

  return NextResponse.json({ sweeps: failed ? 'failed' : 'ok' }, { status: failed ? 500 : 200 });
}
