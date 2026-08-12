import { FenixSessionProvider } from '../components/session-provider.jsx';
import { VttShell } from '../components/vtt-shell.jsx';

export default function HomePage() {
  return (
    <FenixSessionProvider>
      <VttShell />
    </FenixSessionProvider>
  );
}
