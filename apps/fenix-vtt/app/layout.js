import './globals.css';
import './live-bridge.css';

export const metadata = {
  title: 'Fênix VTT',
  description: 'VTT independente do Projeto Fênix / Mestre Orc'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
