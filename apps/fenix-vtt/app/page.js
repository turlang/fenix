import './scene-layout-overrides.css';
import { AuthCampaignGate } from '../components/auth-campaign-gate.jsx';

export default function HomePage() {
  return <AuthCampaignGate />;
}
