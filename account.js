// Adds a sign-out row to the bottom of the Home page.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS || !DS.views.home) return;
  const { sb, el, state, toast } = DS;
  const base = DS.views.home;
  async function signOut(btn) {
    if (!confirm('Sign out of Daily Sheet on this device? You\u2019ll need your password and authenticator code to get back in.')) return;
    btn.disabled = true;
    const { error } = await sb.auth.signOut();
    if (error) { btn.disabled = false; return toast(error.message || 'Couldn\u2019t sign out. Try again.'); }
    state.user = null; // stops Home refreshing itself behind the sign-in screen
  }
  DS.views.home = async () => {
    const node = await base();
    const btn = el('button', { class: 'btn danger', onclick: () => signOut(btn) }, 'Sign out');
    node.append(el('footer', { class: 'hm-foot' },
      el('span', {}, state.user?.email ? `Signed in as ${state.user.email}` : 'Signed in'), btn));
    return node;
  };
  if (state.user && state.view === 'home' && document.getElementById('main')) DS.refresh();
})();
