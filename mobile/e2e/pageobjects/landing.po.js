class LandingPage {
  get createAccountBtn() {
    return $('~landing-create-account-btn');
  }

  get signInBtn() {
    return $('~landing-sign-in-btn');
  }
}

module.exports = new LandingPage();
