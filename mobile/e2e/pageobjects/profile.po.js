class ProfilePage {
  get contactsBtn() {
    return $('~profile-contacts-btn');
  }

  get evidenceBtn() {
    return $('~profile-evidence-btn');
  }

  get logoutBtn() {
    return $('~profile-logout-btn');
  }
}

module.exports = new ProfilePage();
