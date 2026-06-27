import { useNavigate } from 'react-router-dom';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { useAuth } from '../auth/AuthContext';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { refreshStatus } = useAuth();

  const handleComplete = async () => {
    // Refresh founder status so the auth context reflects ACTIVE
    await refreshStatus();
    navigate('/dashboard', { replace: true });
  };

  return <OnboardingScreen onComplete={handleComplete} />;
}
