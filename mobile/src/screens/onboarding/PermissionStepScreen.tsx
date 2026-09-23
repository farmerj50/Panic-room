import { useState } from 'react';

import type { PermissionStepConfig } from './permissionSteps';
import type { PermStatus } from '../../services/corePermissions';
import OnboardingCard from './OnboardingCard';

type Props = {
  config: PermissionStepConfig;
  onDone: (status: PermStatus) => void;
};

// One reusable, config-driven screen for every onboarding permission step —
// avoids the near-duplicate camera/microphone/location screens that would
// otherwise exist. corePermissions.ts owns the whole ask funnel (explanation
// -viewed, disclosure, OS request, granted/denied analytics) so this screen
// just renders the copy and wires the CTA to config.request().
export default function PermissionStepScreen({ config, onDone }: Props) {
  const [requesting, setRequesting] = useState(false);

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
