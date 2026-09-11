class PaywallPage {
  get screen() {
    return $('~paywall-screen');
  }

  get subscribeBtn() {
    return $('~paywall-subscribe-btn');
  }

  get restoreBtn() {
    return $('~paywall-restore-btn');
  }
}

module.exports = new PaywallPage();
