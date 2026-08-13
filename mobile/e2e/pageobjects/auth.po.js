class AuthPage {
  get modeLoginBtn() {
    return $('~auth-mode-login-btn');
  }

  get modeRegisterBtn() {
    return $('~auth-mode-register-btn');
  }

  get emailInput() {
    return $('~auth-email-input');
  }

  get passwordInput() {
    return $('~auth-password-input');
  }

  get skipContactBtn() {
    return $('~auth-skip-contact-btn');
  }

  get allowPermissionsBtn() {
    return $('~auth-allow-permissions-btn');
  }

  get submitBtn() {
    return $('~auth-submit-btn');
  }

  // The register form card grows with each step (stepper + panel content),
  // pushing the submit button below the fold — scroll it into view before
  // each tap rather than relying on a single cached, possibly off-screen ref.
  async scrollDown() {
    await driver.execute('mobile: swipeGesture', {
      left: 100, top: 600, width: 800, height: 1600,
      direction: 'up', percent: 0.9,
    });
    await driver.pause(300);
  }

  async login(email, password) {
    await this.modeLoginBtn.waitForDisplayed({ timeout: 10000 });
    await this.modeLoginBtn.click();
    await this.emailInput.waitForDisplayed({ timeout: 10000 });
    await this.emailInput.setValue(email);
    await this.passwordInput.setValue(password);
    await this.submitBtn.click();
  }

  // Full multi-step register flow: account -> contact (skipped) -> permissions.
  async register(email, password) {
    await this.emailInput.waitForDisplayed({ timeout: 10000 });
    await this.emailInput.setValue(email);
    await this.passwordInput.setValue(password);

    await this.submitBtn.click(); // account -> contact
    await driver.pause(500);
    await this.scrollDown();
    await this.submitBtn.click(); // contact -> permissions (skipped, no contact filled)
    await driver.pause(500);
    await this.scrollDown();
    await this.submitBtn.click(); // permissions -> createAccount()
  }
}

module.exports = new AuthPage();
