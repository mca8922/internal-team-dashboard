'use client';

// Client export button for the personal analytics page (a Server Component).
// Takes the already-aggregated daily-hours rows and writes them to a CSV in the
// browser — no server round-trip, no new infra.
import { Button } from '@/components/ui';
import { downloadCsv } from '@/lib/csv';
import { fmtWeekday, isWeekend } from '@/lib/dates';

export function AnalyticsExport({
  rows,
  filename,
}: {
  rows: { date: string; hours: number }[];
  filename: string;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      icon="archive"
      disabled={rows.length === 0}
      onClick={() =>
        downloadCsv(filename, rows, [
          { header: 'Date', value: (r) => r.date },
          // Weekday name + a Weekend flag so Saturdays/Sundays are identifiable
          // in the exported file, mirroring the on-screen weekend shading.
          { header: 'Day', value: (r) => fmtWeekday(r.date) },
          { header: 'Weekend', value: (r) => (isWeekend(r.date) ? 'Yes' : '') },
          { header: 'Hours', value: (r) => r.hours },
        ])
      }
    >
      Export CSV
    </Button>
  );
}
