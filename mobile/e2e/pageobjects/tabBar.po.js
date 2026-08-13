class TabBarPage {
  get homeBtn() {
    return $('~tab-home-btn');
  }

  get emergencyBtn() {
    return $('~tab-emergency-btn');
  }

  get profileBtn() {
    return $('~tab-profile-btn');
  }
}

module.exports = new TabBarPage();
