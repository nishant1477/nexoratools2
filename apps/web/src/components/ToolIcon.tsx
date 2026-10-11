import { Combine, File, FileImage, FileOutput, Image as ImageIcon, Images, Minimize2, RotateCw, Scaling, Scissors, Shrink, Trash2, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = { Combine, FileImage, FileOutput, Image: ImageIcon, Images, Minimize2, RotateCw, Scaling, Scissors, Shrink, Trash2 };

export function ToolIcon({ name, className = 'h-6 w-6' }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? File;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}
