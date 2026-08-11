import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zero - AI Front Desk for Clinics',
  description: 'Zero connects to your clinic\'s WhatsApp and runs intake, booking, and the queue — instantly, for every patient, without anyone touching a phone.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="font-sans antialiased selection:bg-accent/20">
        {children}
      </body>
    </html>
  );
}
