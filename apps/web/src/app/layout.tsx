import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { Footer } from '@/components/Footer';
import { Navbar } from '@/components/Navbar';
import { themeScript } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: { default: 'NexoraTools — Simple tools for your files', template: '%s · NexoraTools' },
  description: 'Merge, split, compress and convert PDFs and images. Files are deleted automatically.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="flex min-h-screen flex-col">
        <AuthProvider>
          <Navbar />
          <main id="main" className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
