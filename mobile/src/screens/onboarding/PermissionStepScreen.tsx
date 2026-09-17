import { useEffect, useState } from 'react';

import { trackEvent } from '../../services/analyticsService';
import type { PermissionStepConfig } from './permissionSteps';
import type { PermStatus } from '../../services/corePermissions';
import OnboardingCard from './OnboardingCard';

type Props = {
  config: PermissionStepConfig;
  onDone: (status: PermStatus) => void;
};

// One reusable, config-driven screen for every onboarding permission step —
// avoids the near-duplicate camera/microphone/location screens that would
// otherwise exist. Fires its explanation-viewed event on mount, requests
// the permission on CTA press (corePermissions.ts owns the disclosure +
// analytics for granted/denied), and advances either way.
export default function PermissionStepScreen({ config, onDone }: Props) {
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    trackEvent(config.explanationViewedEvent);
  }, [config.explanationViewedEvent]);

  const handleAllow = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const status = await config.request();
      onDone(status);
    } finally {
      setRequesting(false);
    }
  };

  const handleNotNow = () => {
    onDone('denied');
  };

  return (
    <OnboardingCard
      icon={config.icon}
      iconColor={config.accentColor}
      title={config.title}
      body={config.body}
      primaryLabel={requesting ? 'Please wait...' : config.ctaLabel}
      onPrimaryPress={handleAllow}
      primaryTestID={`onboarding-${config.key}-cta`}
      primaryDisabled={requesting}
      secondaryLabel="Not now"
      onSecondaryPress={handleNotNow}
      secondaryTestID={`onboarding-${config.key}-skip`}
    />
  );
}
