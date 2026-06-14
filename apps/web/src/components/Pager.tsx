'use client';

/** Simple skip/take pager driven by a server-provided total. */
export function Pager({
  skip,
  take,
  total,
  onChange,
}: {
  skip: number;
  take: number;
  total: number;
  onChange: (skip: number) => void;
}) {
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + take, total);
  const canPrev = skip > 0;
  const canNext = skip + take < total;

  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm text-slate-500">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(0, skip - take))}
          disabled={!canPrev}
          className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => onChange(skip + take)}
          disabled={!canNext}
          className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
