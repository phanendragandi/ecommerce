import { z } from 'zod';

/**
 * `from`/`to` accept either a plain date (`YYYY-MM-DD`) or a full ISO
 * timestamp. Both are parsed with `Date.parse`, which is UTC-safe for the
 * plain-date form.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;

const isoDate = z
  .string()
  .refine((s) => ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s)), {
    message: 'must be an ISO date (YYYY-MM-DD or a full ISO timestamp)',
  });

const MAX_RANGE_DAYS = 366;

function rangeDays(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  return (to - from) / (1000 * 60 * 60 * 24);
}

function checkRange(q: { from: string; to: string }, ctx: z.RefinementCtx): void {
  if (Date.parse(q.from) > Date.parse(q.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'from must be before or equal to to',
      path: ['from'],
    });
    return;
  }
  if (rangeDays(q.from, q.to) > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `date range cannot exceed ${MAX_RANGE_DAYS} days`,
      path: ['to'],
    });
  }
}

export const salesReportQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    interval: z.enum(['day', 'week', 'month']).default('day'),
  })
  .superRefine(checkRange);
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const topProductsQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    limit: z.coerce.number().int().positive().max(20).default(5),
  })
  .superRefine(checkRange);
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;
