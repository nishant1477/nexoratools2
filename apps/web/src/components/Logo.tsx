export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <path d="M3 5a2 2 0 0 1 2-2h13l7 7v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="var(--pine)" />
        <path d="M18 3l7 7h-5a2 2 0 0 1-2-2z" fill="var(--marigold)" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">NexoraTools</span>
    </span>
  );
}
