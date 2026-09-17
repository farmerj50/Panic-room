class OnboardingPage {
  get welcomeCta() {
    return $('~onboarding-welcome-cta');
  }

  get cameraSkip() {
    return $('~onboarding-camera-skip');
  }

  get microphoneSkip() {
    return $('~onboarding-microphone-skip');
  }

  get locationSkip() {
    return $('~onboarding-location-skip');
  }

  get completeCta() {
    return $('~onboarding-complete-cta');
  }

  // Drives through the whole post-registration onboarding stack, declining
  // every permission via "Not now" — deterministic and dialog-free (skip
  // resolves as 'denied' without ever invoking the OS permission prompt or
  // our own in-app disclosure Alert), matching how the pre-onboarding e2e
  // flow never actually exercised the grant path either.
  async skipAll() {
    await this.welcomeCta.waitForDisplayed({ timeout: 15000 });
    await this.welcomeCta.click();

    await this.cameraSkip.waitForDisplayed({ timeout: 10000 });
    await this.cameraSkip.click();

    await this.microphoneSkip.waitForDisplayed({ timeout: 10000 });
    await this.microphoneSkip.click();

    await this.locationSkip.waitForDisplayed({ timeout: 10000 });
    await this.locationSkip.click();

    await this.completeCta.waitForDisplayed({ timeout: 10000 });
    await this.completeCta.click();
  }
}

module.exports = new OnboardingPage();
