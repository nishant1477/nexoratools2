'use client';
import { plural } from '@/lib/format';
import { useLimits } from '@/lib/hooks';
import { HeroDrop } from './HeroDrop';

export function Hero() {
  const limits = useLimits();
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div>
        <h1 className="text-5xl font-extrabold sm:text-6xl lg:text-7xl">Simple tools for your files.</h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Merge, split, compress and convert PDFs and images in your browser. No installs. Files are deleted automatically{limits ? ` after ${plural(limits.retentionMinutes, 'minute')}` : ''}.
        </p>
      </div>
      <HeroDrop />
    </section>
  );
}
