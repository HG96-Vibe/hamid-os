// Adds a sign-out row to the bottom of the Home page (this device, or everywhere else incl. the Claude connector).
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
  // ends every other sign-in, including the Claude connector (Claude will ask you to sign in again)
  async function signOutOthers(btn) {
    if (!confirm('Sign out everywhere else? Other devices and the Claude connector will need to sign in again. You stay signed in here.')) return;
    btn.disabled = true;
    const { error } = await sb.auth.signOut({ scope: 'others' });
    btn.disabled = false;
    toast(error ? (error.message || 'Couldn\u2019t do that. Try again.') : 'Signed out everywhere else, including Claude.');
  }
  DS.views.home = async () => {
    const node = await base();
    const btn = el('button', { class: 'btn danger', onclick: () => signOut(btn) }, 'Sign out');
    const others = el('button', { class: 'btn', onclick: () => signOutOthers(others), title: 'Other devices and the Claude connector' }, 'Sign out everywhere else');
    node.append(el('footer', { class: 'hm-foot' },
      el('span', {}, state.user?.email ? `Signed in as ${state.user.email}` : 'Signed in'), others, btn));
    return node;
  };
  if (state.user && state.view === 'home' && document.getElementById('main')) DS.refresh();
})();
