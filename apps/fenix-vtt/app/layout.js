import './globals.css';
import './live-bridge.css';
import './realtime.css';
import './scene-manager.css';
import './wall-authoring.css';
import './grid-authoring-v2.css';
import './fog-of-war.css';
import './dynamic-lighting.css';
import './vtt-workspace-layout.css';
import './vtt-experience.css';
import './context-inspector.css';
import './scene-region-authoring.css';
import './contextual-tools.css';
import './actor-sheet-inspector.css';
import './actor-catalog.css';
import './first-person.css';
import './content-review-workspace.css';

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
