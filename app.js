/* global supabase */
'use strict';

const CONFIG = Object.freeze({
  supabaseUrl: 'https://maihhnwrstewzapsvrec.supabase.co',
  supabaseKey: 'sb_publishable_YtVKcZqgPalUaYOHpoSV1w_86he5PDV',
  mediaBucket: 'salty-media',
  avatarBucket: 'salty-avatars',
  chatBucket: 'salty-chat',
  maxUploadBytes: 50 * 1024 * 1024,
  maxAvatarBytes: 8 * 1024 * 1024,
  maxChatPhotoBytes: 10 * 1024 * 1024,
  maxClipSeconds: 90,
  emailOtpDigits: 8,
});
const CONSENT_VERSION = '1.0';
const GUIDE_PATH = './docs/SALTY_Quick_Start_Guide_V3_5.pdf';
const PENDING_AUTH_KEY = 'salty:pending-auth';
const INSTALL_DISMISSED_KEY = 'salty:install-dismissed';

// Upgrade runway: after moving Supabase to Pro, raise maxUploadBytes and replace
// uploadMedia() with a TUS resumable implementation. Callers do not need to change.
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const state = {
  session: null, profile: null, regions: [], spots: [], people: [], sessions: [], posts: [], events: [], perks: [],
  roomMessages: [], dmMessages: [], dmThreads: [], chatPhotoUrls: {}, activeDmMember: null,
  currentRegion: null, eventRegion: null, chatRegion: null, view: 'surfing', pendingInvite: '', authMode: 'new', realtime: null,
  preview: false, previewSessions: [], avatarUrls: {}, selectedMember: null,
  authEmail: '', pendingTokenHash: '', pendingTokenType: 'email',
  consentNext: 'new', sessionPeople: [], editingSessionId: null, editingEventId: null, editingPerkId: null, installPrompt: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const formatCount = number => new Intl.NumberFormat().format(number || 0);
const inviteFromUrl = () => new URLSearchParams(location.search).get('invite')?.trim() || '';
const ICON_THEMES = new Set(['ink', 'amber', 'foam', 'ocean']);
const THEME_COLORS = Object.freeze({
  ink: '#0A141C',
  amber: '#1B1208',
  foam: '#EAF2F5',
  ocean: '#071925',
});

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function readPendingAuth() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_AUTH_KEY) || 'null');
    if (!pending?.email || Date.now() - pending.sentAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(PENDING_AUTH_KEY);
      return null;
    }
    return pending;
  } catch (_error) {
    localStorage.removeItem(PENDING_AUTH_KEY);
    return null;
  }
}

function clearPendingAuth() {
  localStorage.removeItem(PENDING_AUTH_KEY);
  localStorage.removeItem('salty:auth-email');
}

function applyIconTheme(theme = 'ink', announce = false) {
  const chosen = ICON_THEMES.has(theme) ? theme : 'ink';
  localStorage.setItem('salty:theme', chosen);
  localStorage.removeItem('salty:icon-theme');
  const iconPath = `./icon-${chosen}.svg`;
  document.documentElement.dataset.theme = chosen;
  $('#appThemeColor').content = THEME_COLORS[chosen];
  $('#appFavicon').href = iconPath;
  $('#appTouchIcon').href = './icon-ink.svg';
  $('#appManifest').href = './manifest.webmanifest';
  $$('[data-app-icon]').forEach(icon => { icon.src = iconPath; });
  $$('[data-icon-theme]').forEach(button => {
    const active = button.dataset.iconTheme === chosen;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  if (announce) {
    const label = `${chosen[0].toUpperCase()}${chosen.slice(1)}`;
    document.documentElement.classList.remove('theme-previewing');
    void document.documentElement.offsetWidth;
    document.documentElement.classList.add('theme-previewing');
    clearTimeout(applyIconTheme.previewTimer);
    applyIconTheme.previewTimer = setTimeout(() => document.documentElement.classList.remove('theme-previewing'), 700);
    toast(`${label} theme applied across Salty.`, 3200);
  }
}

function showOnly(id) {
  ['boot', 'welcome', 'consentScreen', 'authScreen', 'verifyScreen', 'profileSetup', 'app'].forEach(name => $(`#${name}`).classList.toggle('hidden', name !== id));
}

function consentStorageKey() { return `salty:consent:${CONSENT_VERSION}`; }

function openConsent(next = 'new') {
  state.consentNext = next;
  const reviewing = next === 'settings';
  $('#consentAcceptButton').textContent = reviewing ? 'Back to Settings' : 'I understand — enter Salty';
  showOnly('consentScreen');
  scrollTo({ top: 0, behavior: 'instant' });
}

async function persistConsent() {
  const acceptance = JSON.parse(localStorage.getItem(consentStorageKey()) || 'null');
  if (!state.session || !acceptance) return;
  const current = state.session.user.user_metadata?.salty_consent_version;
  if (current === CONSENT_VERSION) { localStorage.removeItem(consentStorageKey()); return; }
  const result = await db.auth.updateUser({ data: {
    salty_consent_version: CONSENT_VERSION,
    salty_consented_at: acceptance.accepted_at,
  }});
  if (result.error) throw result.error;
  state.session.user = result.data.user;
  localStorage.removeItem(consentStorageKey());
}

async function acceptConsent() {
  if (state.consentNext === 'settings') { showOnly('app'); setView('settings'); return; }
  localStorage.setItem(consentStorageKey(), JSON.stringify({ version: CONSENT_VERSION, accepted_at: new Date().toISOString() }));
  if (state.consentNext === 'session') {
    try { await persistConsent(); await enterCommunity(); }
    catch (error) { toast(readableError(error), 6000); }
    return;
  }
  openAuth(state.consentNext);
}

function leaveConsent() {
  if (state.consentNext === 'settings') { showOnly('app'); setView('settings'); }
  else showWelcome();
}

function toast(message, timeout = 3200) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), timeout);
}

function readableError(error) {
  console.error(error);
  if (error?.status === 429 || /rate limit/i.test(error?.message || '')) {
    return 'Salty’s email service is cooling down after too many test emails. Wait about an hour, then request one fresh email.';
  }
  return error?.message || 'Something went sideways. Please try again.';
}

function startEmailCooldown(button, seconds = 60) {
  clearInterval(startEmailCooldown.timer);
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `Email sent · resend in ${remaining}s`;
  startEmailCooldown.timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) { button.textContent = `Email sent · resend in ${remaining}s`; return; }
    clearInterval(startEmailCooldown.timer);
    button.disabled = false;
    button.textContent = 'Email me a sign-in code';
  }, 1000);
}

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('preview') === '1') {
    runPreview();
    return;
  }
  if ('serviceWorker' in navigator && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      await registration.update();
    } catch (error) { console.warn('Service worker registration deferred:', error); }
  }
  state.pendingInvite = inviteFromUrl() || localStorage.getItem('salty:invite') || '';
  if (state.pendingInvite) localStorage.setItem('salty:invite', state.pendingInvite);
  state.pendingTokenHash = params.get('token_hash') || '';
  state.pendingTokenType = params.get('type') || 'email';

  // The email opens this neutral screen first. Verification only happens after
  // the person taps the button, so inbox link scanners cannot spend the token.
  if (state.pendingTokenHash) {
    showOnly('verifyScreen');
    return;
  }

  const { data, error } = await db.auth.getSession();
  if (error) toast(readableError(error));
  state.session = data?.session || null;

  db.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'SIGNED_OUT') setTimeout(showWelcome, 0);
  });

  if (state.session) {
    const accepted = state.session.user.user_metadata?.salty_consent_version === CONSENT_VERSION;
    if (accepted) await enterCommunity();
    else openConsent('session');
  }
  else if (!restorePendingAuth()) showWelcome();

}

function runPreview() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const regionId = '22222222-2222-4222-8222-222222222222';
  state.preview = true;
  state.session = { user: { id: userId } };
  state.profile = { id: userId, name: 'Cyrus V.', nickname: 'Cy', phone: '(949) 555-0142', home_region: regionId, sponsors: ['Sodium', 'Salty Viewfinder'], social_url:'https://instagram.com/', avatar_path:null, onboarding_complete:true, is_admin:true };
  state.regions = [{ id: regionId, name: 'California' }, { id: 'fr', name: 'France' }, { id: 'de', name: 'Germany' }, { id: 'ut', name: 'Utah' }];
  state.currentRegion = state.regions[0];
  state.eventRegion = state.currentRegion;
  state.chatRegion = state.currentRegion;
  state.people = [state.profile, { id: 'jonah', name: 'Jonah Reyes', nickname:'Jo', home_region:regionId, sponsors:['Snake Eyes'], onboarding_complete:true }, { id: 'mateo', name: 'Mateo Karras', nickname:null, home_region:regionId, sponsors:[], onboarding_complete:true }];
  state.spots = [{ id: 'malibu', name: 'Malibu', general_location:'Malibu', region_id: regionId }, { id: 'lowers', name: 'Lowers', general_location:'San Clemente', region_id: regionId }];
  state.previewSessions = [
    { id:'mine', author:userId, region_id:regionId, author_role:'film', participant_names:['Sam'], when_label:'Now', wants_filmer:false, note:'bringing the long lens', spot:{name:'Malibu',general_location:'Malibu'}, author_profile:{name:'Cyrus V.'}, session_rsvps:[{id:'r1',user_id:'jonah',role:'surf',profile:{name:'Jonah Reyes'}}]},
    { id:'crew', author:'jonah', region_id:regionId, author_role:'surf', participant_names:[], when_label:'Scheduled', surf_time:new Date(Date.now() + 3 * 86400000).toISOString(), wants_filmer:true, note:'sunrise window', spot:{name:'Lowers',general_location:'San Clemente'}, author_profile:{name:'Jonah Reyes'}, session_rsvps:[] },
  ];
  state.sessions = state.previewSessions;
  state.posts = [];
  state.perks = [
    { id:'sv', name:'Saltyviewfinder Store Discount', brand_name:'Saltyviewfinder', offer_text:'Salty member discount', description:'Sodium merch, prints, and more.', store_url:'https://saltyviewfinder.com', active:true },
    { id:'wata', name:'WATA Store Discount', brand_name:'WATA', offer_text:'Salty member discount', description:'Support WATA and save on store gear.', store_url:'https://cleanwata.org', active:true },
  ];
  state.roomMessages = [
    { id:'chat-1', region_id:regionId, author:'jonah', body:'Waist high at first point. Crowd is pretty mellow.', created_at:new Date(Date.now() - 22 * 60000).toISOString() },
    { id:'chat-2', region_id:regionId, author:userId, body:'I can film for an hour around 7.', created_at:new Date(Date.now() - 8 * 60000).toISOString() },
  ];
  state.dmMessages = [{ id:'dm-1', sender:'jonah', recipient:userId, body:'Want to hit Lowers Friday?', created_at:new Date(Date.now() - 35 * 60000).toISOString(), read_at:null }];
  state.dmThreads = [{ memberId:'jonah', message:state.dmMessages[0] }];
  renderChrome(); renderSessions(); renderPosts(); renderPerks(); renderPreviewProfile(); renderMembers(); renderRoomMessages(); renderDmInbox(); showOnly('app');
  $('#appPreviewBanner').classList.remove('hidden');
}

function renderPreviewProfile() {
  $('#profileView').innerHTML = profileMarkup(state.profile, { points:45, streak:3, clips:0, own:true });
  $('#streakBadge b').textContent = '3';
}

function showWelcome() {
  if (isStandalone()) {
    openAuth('existing');
    $('#authSubtitle').textContent = 'This saved app is not signed in yet. Verify once on this phone and it will open straight into Salty after that.';
    return;
  }
  showOnly('welcome');
  const hasInvite = Boolean(state.pendingInvite);
  $('#enterButton').classList.toggle('hidden', !hasInvite);
  $('#inviteInstruction').classList.toggle('hidden', hasInvite);
}

function openAuth(mode, keepPending = false) {
  state.authMode = mode;
  const isNew = mode === 'new';
  if (isNew && !state.pendingInvite) {
    toast('Open the invite link your friend sent you.');
    return;
  }
  $('#newMemberFields').classList.toggle('hidden', !isNew);
  $('#authTitle').textContent = isNew ? 'Join your crew' : 'Welcome back';
  $('#authSubtitle').textContent = isNew ? 'Continue with Google or use one email code. Then finish your profile and stay signed in.' : 'Continue with Google, or use the email connected to your Salty profile. You only need this on a new device or after signing out.';
  if (!keepPending) {
    $('#authMessage').classList.add('hidden');
    $('#authCodeBlock').classList.add('hidden');
    $('#authCode').value = '';
  }
  $('#authEmail').value = state.authEmail || localStorage.getItem('salty:auth-email') || '';
  $('#authScreen .round-back').classList.toggle('hidden', isStandalone());
  showOnly('authScreen');
}

function restorePendingAuth() {
  const pending = readPendingAuth();
  if (!pending) return false;
  state.authEmail = pending.email;
  state.authMode = pending.mode === 'new' ? 'new' : 'existing';
  if (pending.invite) {
    state.pendingInvite = pending.invite;
    localStorage.setItem('salty:invite', pending.invite);
  }
  openAuth(state.authMode, true);
  $('#authEmail').value = pending.email;
  const message = $('#authMessage');
  message.innerHTML = `<b>Use the newest code sent to ${esc(pending.email)}</b><br>Enter it below without leaving Salty. Every new email replaces the older code.`;
  message.classList.remove('hidden');
  $('#authCodeBlock').classList.remove('hidden');
  setTimeout(() => $('#authCode').focus({ preventScroll: true }), 50);
  return true;
}

async function sendMagicLink(event) {
  event.preventDefault();
  const email = $('#authEmail').value.trim().toLowerCase();
  state.authEmail = email;
  localStorage.setItem('salty:auth-email', email);
  const isNew = state.authMode === 'new';
  const submit = $('#authForm button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Sending…';

  if (isNew) {
    const { data: valid, error: inviteError } = await db.rpc('invite_is_valid', { invite_code: state.pendingInvite });
    if (inviteError || !valid) {
      submit.disabled = false; submit.textContent = 'Email me a sign-in code';
      toast(inviteError ? readableError(inviteError) : 'That invite is invalid or has expired.');
      return;
    }
  }

  const redirect = new URL('./', location.href);
  redirect.searchParams.set('auth', 'callback');
  if (isNew) redirect.searchParams.set('invite', state.pendingInvite);
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.href,
      shouldCreateUser: isNew,
    },
  });
  submit.disabled = false; submit.textContent = 'Email me a sign-in code';
  if (error) {
    const copy = readableError(error);
    const message = $('#authMessage');
    message.textContent = copy;
    message.classList.remove('hidden');
    toast(copy, 6000);
    return;
  }
  localStorage.setItem(PENDING_AUTH_KEY, JSON.stringify({
    email,
    mode: isNew ? 'new' : 'existing',
    invite: isNew ? state.pendingInvite : '',
    sentAt: Date.now(),
  }));
  startEmailCooldown(submit);
  const message = $('#authMessage');
  message.innerHTML = `<b>Check ${esc(email)}</b><br>Stay in Salty and enter the full ${CONFIG.emailOtpDigits}-digit code from the newest email. Every new email replaces the older code.`;
  message.classList.remove('hidden');
  $('#authCodeBlock').classList.remove('hidden');
  setTimeout(() => $('#authCode').focus({ preventScroll: true }), 50);
}

async function signInWithGoogle() {
  const isNew = state.authMode === 'new';
  const button = $('#googleAuthButton');
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Opening Google…';

  if (isNew) {
    const { data: valid, error: inviteError } = await db.rpc('invite_is_valid', { invite_code: state.pendingInvite });
    if (inviteError || !valid) {
      button.disabled = false;
      button.innerHTML = originalLabel;
      toast(inviteError ? readableError(inviteError) : 'That invite is invalid or has expired.');
      return;
    }
  }

  const redirect = new URL('./', location.href);
  redirect.search = '';
  redirect.hash = '';
  redirect.searchParams.set('auth', 'google');
  if (isNew) redirect.searchParams.set('invite', state.pendingInvite);
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirect.href },
  });
  if (error) {
    button.disabled = false;
    button.innerHTML = originalLabel;
    const message = $('#authMessage');
    message.textContent = readableError(error);
    message.classList.remove('hidden');
    toast(readableError(error), 6000);
  }
}

async function verifyEmailCode() {
  const email = (state.authEmail || localStorage.getItem('salty:auth-email') || $('#authEmail').value).trim().toLowerCase();
  const token = $('#authCode').value.replace(/\D/g, '');
  if (!email) { toast('Enter your email and request a new sign-in email first.'); return; }
  if (!new RegExp(`^\\d{${CONFIG.emailOtpDigits}}$`).test(token)) {
    toast(`Enter the full ${CONFIG.emailOtpDigits}-digit code from the email.`);
    return;
  }
  const button = $('[data-action="verify-code"]');
  button.disabled = true; button.textContent = 'Verifying…';
  const { data, error } = await db.auth.verifyOtp({ email, token, type: 'email' });
  button.disabled = false; button.textContent = 'Verify code';
  if (error) {
    const message = $('#authMessage');
    const reason = esc(error.message || 'The code was rejected.');
    message.innerHTML = `<b>Salty could not verify that code.</b><br>${reason}<br>Request one fresh email, stay on this screen, and use only its newest code.`;
    message.classList.remove('hidden');
    toast('That code was rejected. Request one fresh code and enter it without opening any email link.', 7000);
    return;
  }
  state.session = data.session;
  clearPendingAuth();
  await finishAuthentication();
}

async function verifyEmailLink() {
  const button = $('#verifyLinkButton');
  const message = $('#verifyMessage');
  if (!state.pendingTokenHash) {
    message.textContent = 'This sign-in link is incomplete. Go back to Salty and request a new email.';
    message.classList.remove('hidden');
    return;
  }
  button.disabled = true; button.textContent = 'Verifying…';
  const { data, error } = await db.auth.verifyOtp({
    token_hash: state.pendingTokenHash,
    type: state.pendingTokenType,
  });
  if (error) {
    button.disabled = false; button.textContent = 'Try again';
    message.innerHTML = `${esc(readableError(error))}<br>Return to Salty and request a fresh email, or use the full ${CONFIG.emailOtpDigits}-digit code from that email.`;
    message.classList.remove('hidden');
    return;
  }
  state.session = data.session;
  clearPendingAuth();
  await finishAuthentication();
}

async function finishAuthentication() {
  const accepted = state.session?.user?.user_metadata?.salty_consent_version === CONSENT_VERSION;
  if (accepted) await enterCommunity();
  else openConsent('session');
}

async function enterCommunity() {
  await persistConsent();
  const userId = state.session.user.id;
  let { data: profile, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) { toast(readableError(error)); showWelcome(); return; }

  if (!profile && state.pendingInvite) {
    const redeemed = await db.rpc('redeem_invite', {
      invite_code: state.pendingInvite,
      profile_name: null,
      profile_phone: null,
      profile_region: null,
    });
    if (redeemed.error) {
      toast(readableError(redeemed.error), 6000);
      await db.auth.signOut();
      showWelcome();
      return;
    }
    profile = redeemed.data;
    localStorage.removeItem('salty:invite');
  }

  if (!profile) {
    toast('This account is not in the community. Open a valid invite link first.', 6000);
    await db.auth.signOut();
    showWelcome();
    return;
  }

  state.profile = profile;
  if (!profile.onboarding_complete) {
    await showProfileSetup();
    return;
  }
  await loadApp();
  showOnly('app');
  clearPendingAuth();
  cleanAuthUrl();
  offerInstallAfterAuth();
}

async function loadApp() {
  const [regionsResult, spotsResult, peopleResult] = await Promise.all([
    db.from('regions').select('*').order('name'),
    db.from('spots').select('*').order('name'),
    db.from('profiles').select('id,name,nickname,home_region,sponsors,social_url,avatar_path,onboarding_complete').eq('onboarding_complete', true).order('name'),
  ]);
  const firstError = regionsResult.error || spotsResult.error || peopleResult.error;
  if (firstError) throw firstError;
  state.regions = regionsResult.data;
  state.spots = spotsResult.data;
  state.people = peopleResult.data;
  state.currentRegion = state.regions.find(region => region.id === state.profile.home_region) || state.regions.find(region => region.name === 'California') || state.regions[0];
  state.eventRegion = state.currentRegion;
  state.chatRegion = state.currentRegion;
  await loadAvatarUrls();
  renderChrome();
  await Promise.all([loadSessions(), loadPosts(), loadEvents(), loadPerks(), loadRoomMessages(), loadDmInbox(), renderProfile()]);
  renderMembers();
  subscribeRealtime();
}

function cleanAuthUrl() {
  if (!location.hash && !location.search) return;
  history.replaceState({}, '', location.pathname);
}

function offerInstallAfterAuth() {
  const installed = isStandalone();
  $('#installSettingsRow').classList.toggle('hidden', installed);
  $('#installNudge').classList.toggle('hidden', installed || Boolean(localStorage.getItem(INSTALL_DISMISSED_KEY)));
}

function showInstallInstructions() {
  if (isStandalone()) {
    toast('Salty is already installed on this phone.');
    return;
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const steps = ios
    ? ['Stay on this signed-in Salty screen.', 'Tap the Share button in your browser.', 'Choose “Add to Home Screen,” then tap “Add.”', 'Open Salty from the new Home Screen icon.']
    : ['Stay on this signed-in Salty screen.', 'Open your browser menu and choose “Install app” or “Add to Home Screen.”', 'Confirm the installation, then open Salty from its icon.'];
  $('#installSteps').innerHTML = steps.map(step => `<li>${esc(step)}</li>`).join('');
  $('#nativeInstallButton').classList.toggle('hidden', !state.installPrompt);
  openSheet('installSheet');
}

function dismissInstallNudge() {
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  $('#installNudge').classList.add('hidden');
}

async function runNativeInstall() {
  if (!state.installPrompt) {
    showInstallInstructions();
    return;
  }
  state.installPrompt.prompt();
  const choice = await state.installPrompt.userChoice;
  state.installPrompt = null;
  if (choice.outcome === 'accepted') {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    closeSheet();
    $('#installNudge').classList.add('hidden');
  }
}

async function showProfileSetup() {
  const regionsResult = await db.from('regions').select('*').order('name');
  if (regionsResult.error) throw regionsResult.error;
  state.regions = regionsResult.data || [];
  $('#setupRegion').innerHTML = state.regions.map(region => `<option value="${region.id}">${esc(region.name)}</option>`).join('');
  $('#setupName').value = state.profile.name || '';
  $('#setupNickname').value = state.profile.nickname || '';
  $('#setupPhone').value = state.profile.phone || '';
  $('#setupRegion').value = state.profile.home_region || state.regions[0]?.id || '';
  $('#setupSponsors').value = (state.profile.sponsors || []).join(', ');
  $('#setupSocial').value = state.profile.social_url || '';
  $('#profileAvatar').required = !state.profile.avatar_path;
  $('#profileSetupTitle').textContent = state.profile.onboarding_complete ? 'Edit your profile' : 'Build your profile';
  $('#profileSetupBack').classList.toggle('hidden', !state.profile.onboarding_complete);
  $('#profileSubmit').textContent = state.profile.onboarding_complete ? 'Save changes' : 'Save profile and enter Salty';
  $('#avatarPreview').textContent = state.profile.avatar_path ? 'CHANGE PHOTO' : 'ADD PHOTO';
  if (state.profile.avatar_path) {
    const signed = await db.storage.from(CONFIG.avatarBucket).createSignedUrl(state.profile.avatar_path, 3600);
    if (!signed.error) $('#avatarPreview').innerHTML = `<img src="${esc(signed.data.signedUrl)}" alt="Current profile photo">`;
  }
  showOnly('profileSetup');
}

async function completeProfile(event) {
  event.preventDefault();
  const submit = $('#profileForm button[type="submit"]');
  submit.disabled = true; submit.textContent = 'Saving…';
  let avatarPath = state.profile.avatar_path;
  try {
    const avatar = $('#profileAvatar').files[0];
    if (!avatarPath && !avatar) throw new Error('Add a profile photo.');
    if (avatar) {
      if (!['image/jpeg','image/png','image/webp'].includes(avatar.type)) throw new Error('Use a JPG, PNG, or WebP profile photo.');
      if (avatar.size > CONFIG.maxAvatarBytes) throw new Error('Profile photos must be 8 MB or smaller.');
      const extension = avatar.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
      avatarPath = `${state.profile.id}/avatar-${Date.now()}.${extension}`;
      const upload = await db.storage.from(CONFIG.avatarBucket).upload(avatarPath, avatar, { contentType: avatar.type, upsert: false });
      if (upload.error) throw upload.error;
    }
    const updates = {
      name: $('#setupName').value.trim(), nickname: $('#setupNickname').value.trim() || null,
      phone: $('#setupPhone').value.trim(), home_region: $('#setupRegion').value,
      sponsors: $('#setupSponsors').value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 12),
      social_url: normalizeSocialUrl($('#setupSocial').value), avatar_path: avatarPath, onboarding_complete: true,
    };
    const result = await db.from('profiles').update(updates).eq('id', state.profile.id).select().single();
    if (result.error) throw result.error;
    state.profile = result.data;
    $('#profileForm').reset();
    await loadApp(); showOnly('app'); cleanAuthUrl(); offerInstallAfterAuth(); toast('Profile saved. Welcome to Salty.');
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; submit.textContent = state.profile.onboarding_complete ? 'Save changes' : 'Save profile and enter Salty'; }
}

function normalizeSocialUrl(value) {
  const clean = value.trim();
  if (!clean) return null;
  if (/^@[a-z0-9._]+$/i.test(clean)) return `https://instagram.com/${clean.slice(1)}`;
  if (!/^https?:\/\//i.test(clean)) return `https://${clean}`;
  return clean;
}

async function loadAvatarUrls() {
  const profiles = [state.profile, ...state.people].filter((profile, index, list) => profile?.avatar_path && list.findIndex(item => item?.id === profile.id) === index);
  const entries = await Promise.all(profiles.map(async profile => {
    const result = await db.storage.from(CONFIG.avatarBucket).createSignedUrl(profile.avatar_path, 3600);
    return [profile.id, result.error ? null : result.data.signedUrl];
  }));
  state.avatarUrls = Object.fromEntries(entries);
}

function avatarMarkup(profile, className = 'avatar') {
  const url = state.avatarUrls[profile?.id];
  return url ? `<span class="${className}"><img src="${esc(url)}" alt="${esc(profile.name)}"></span>` : `<span class="${className}">${esc(initials(profile?.name))}</span>`;
}

const navItems = [
  ['surfing', 'i-surf', 'Surfing'], ['feed', 'i-wave', 'Stoke'], ['chat', 'i-chat', 'Chat'],
  ['events', 'i-calendar', 'Events'], ['you', 'i-user', 'Profile'],
];

function activeRegions() {
  const memberRegionIds = new Set(state.people.map(person => person.home_region).filter(Boolean));
  if (state.profile?.home_region) memberRegionIds.add(state.profile.home_region);
  return state.regions.filter(region => memberRegionIds.has(region.id));
}

function renderNav(target) {
  target.innerHTML = navItems.map(([view, icon, label]) => `<button data-view="${view}" class="${state.view === view ? 'active' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${icon}"/></svg>${label}</button>`).join('');
}

function renderChrome() {
  renderNav($('#mobileNav')); renderNav($('#desktopNav'));
  $('#locationName').textContent = state.currentRegion.name;
  $('#sessionRegionName').textContent = state.currentRegion.name;
  const visibleRegions = activeRegions();
  $('#regionMenu').innerHTML = visibleRegions.map(region => `<button data-region="${region.id}" class="${region.id === state.currentRegion.id ? 'active' : ''}">${esc(region.name)} <small>view sessions</small></button>`).join('');
  const regionSpots = state.spots.filter(spot => spot.region_id === state.currentRegion.id);
  $('#spotsList').innerHTML = regionSpots.map(spot => `<option value="${esc(spot.name)}"></option>`).join('');
  $('#locationsList').innerHTML = [...new Set(regionSpots.map(spot => spot.general_location).filter(Boolean))].sort().map(location => `<option value="${esc(location)}"></option>`).join('');
  $('#peopleList').innerHTML = state.people.map(person => `<option value="${esc(person.name)}"></option>`).join('');
  $('#drawerProfile').innerHTML = `${avatarMarkup(state.profile)}<div><h3>${esc(state.profile.name)}</h3><p>${esc(state.currentRegion.name)} · Salty Crew</p></div>`;
  renderEventRegions();
  renderChatRegions();
  renderDmPeople();
}

function setView(view) {
  state.view = view;
  $$('.app-view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  $$('.primary-nav button,.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const coreView = navItems.some(item => item[0] === view);
  $('#surfFab').classList.toggle('hidden', view !== 'surfing');
  $('#locationPill').classList.toggle('hidden', view !== 'surfing');
  if (!coreView) $$('.primary-nav button,.bottom-nav button').forEach(button => button.classList.remove('active'));
  closeDrawer();
  scrollTo({ top: 0, behavior: 'smooth' });
  if (!state.preview && view === 'chat') loadRoomMessages();
  if (!state.preview && view === 'dms') loadDmInbox();
}

async function loadSessions() {
  const result = await db.from('sessions')
    .select('*,spot:spots(*),author_profile:profiles!sessions_author_fkey(id,name),session_rsvps(id,user_id,role,profile:profiles!session_rsvps_user_id_fkey(id,name))')
    .eq('region_id', state.currentRegion.id).eq('status', 'active').order('created_at', { ascending: false });
  if (result.error) { toast(readableError(result.error)); return; }
  state.sessions = result.data || [];
  renderSessions();
}

function renderEventRegions() {
  const target = $('#eventRegions');
  if (!target || !state.eventRegion) return;
  target.innerHTML = activeRegions().map(region => `<button data-event-region="${region.id}" class="${region.id === state.eventRegion.id ? 'active' : ''}">${esc(region.name)}</button>`).join('');
  $('#eventRegionName').textContent = state.eventRegion.name;
}

function renderChatRegions() {
  const target = $('#chatRegions');
  if (!target || !state.chatRegion) return;
  target.innerHTML = activeRegions().map(region => `<button data-chat-region="${region.id}" class="${region.id === state.chatRegion.id ? 'active' : ''}">${esc(region.name)}</button>`).join('');
  $('#chatRoomTitle').textContent = state.chatRegion.name;
}

function messageTime(value) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour:'numeric', minute:'2-digit' } : { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
}

function speakerHue(id = '') {
  return [...String(id)].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
}

function memberById(id) {
  return id === state.profile?.id ? state.profile : state.people.find(person => person.id === id);
}

async function loadRoomMessages() {
  if (!state.chatRegion) return;
  const result = await db.from('room_messages').select('*').eq('region_id', state.chatRegion.id)
    .order('created_at', { ascending:false }).limit(150);
  if (result.error) { toast(readableError(result.error)); return; }
  state.roomMessages = (result.data || []).reverse();
  const photoMessages = state.roomMessages.filter(message => message.attachment_path);
  const signedEntries = await Promise.all(photoMessages.map(async message => {
    const signed = await db.storage.from(CONFIG.chatBucket).createSignedUrl(message.attachment_path, 3600);
    return [message.id, signed.error ? null : signed.data.signedUrl];
  }));
  state.chatPhotoUrls = Object.fromEntries(signedEntries);
  renderRoomMessages();
}

function renderRoomMessages() {
  const list = $('#roomMessages');
  if (!list || !state.chatRegion) return;
  const messages = state.roomMessages.filter(message => message.region_id === state.chatRegion.id);
  if (!messages.length) {
    list.innerHTML = `<div class="empty chat-empty"><span>${esc(state.chatRegion.name)}</span><h2>Start the conversation</h2><p>Ask how it looks, coordinate a surf, or share a photo from the beach.</p></div>`;
    return;
  }
  list.innerHTML = messages.map(message => {
    const profile = memberById(message.author) || { id:message.author, name:'Salty member' };
    const own = message.author === state.profile.id;
    const photo = state.chatPhotoUrls[message.id];
    return `<article class="message-row ${own ? 'own' : ''}" style="--speaker-hue:${speakerHue(message.author)}">${own ? '' : avatarMarkup(profile, 'message-avatar')}<div class="message-stack"><div class="message-meta"><b>${own ? 'You' : esc(profile.name)}</b><time>${esc(messageTime(message.created_at))}</time></div><div class="message-bubble">${photo ? `<img src="${esc(photo)}" alt="Photo shared by ${esc(profile.name)}">` : ''}${message.body ? `<p>${esc(message.body)}</p>` : ''}</div></div></article>`;
  }).join('');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function sendRoomMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = $('#roomMessageBody').value.trim();
  const file = $('#roomPhoto').files[0];
  if (!body && !file) { toast('Write a message or choose a photo.'); return; }
  if (file && !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { toast('Community chat accepts photos only—no video.'); return; }
  if (file && file.size > CONFIG.maxChatPhotoBytes) { toast('Chat photos must be 10 MB or smaller.'); return; }
  const submit = $('button[type="submit"]', form); submit.disabled = true;
  let attachmentPath = null;
  try {
    if (file) {
      const safeName = file.name.replace(/[^a-z0-9._-]+/gi, '-').slice(-100);
      attachmentPath = `${state.profile.id}/${crypto.randomUUID()}-${safeName}`;
      const upload = await db.storage.from(CONFIG.chatBucket).upload(attachmentPath, file, { contentType:file.type, upsert:false });
      if (upload.error) throw upload.error;
    }
    const result = await db.from('room_messages').insert({
      region_id:state.chatRegion.id, author:state.profile.id, body:body || null,
      attachment_path:attachmentPath, attachment_type:file?.type || null,
      attachment_name:file?.name || null, attachment_size:file?.size || null,
    });
    if (result.error) throw result.error;
    form.reset(); $('#roomPhotoName').textContent = ''; $('#roomPhotoName').classList.add('hidden');
    await loadRoomMessages();
  } catch (error) {
    if (attachmentPath) await db.storage.from(CONFIG.chatBucket).remove([attachmentPath]);
    toast(readableError(error), 5000);
  } finally { submit.disabled = false; }
}

function renderDmPeople() {
  const target = $('#dmPeople');
  if (!target) return;
  const existingThreads = new Set(state.dmThreads.map(thread => thread.memberId));
  const available = state.people.filter(person => person.id !== state.profile.id && !existingThreads.has(person.id));
  target.innerHTML = available.map(person => {
    const region = state.regions.find(item => item.id === person.home_region)?.name || 'Salty Crew';
    return `<button class="member-row" data-dm-member="${person.id}">${avatarMarkup(person)}<span><b>${esc(person.name)}</b><small>${esc(region)}</small></span><i>›</i></button>`;
  }).join('') || '<p class="dm-everyone">Everyone you have messaged is already in your inbox.</p>';
}

async function loadDmInbox() {
  const userId = state.profile.id;
  const result = await db.from('dm_messages').select('*')
    .or(`sender.eq.${userId},recipient.eq.${userId}`).order('created_at', { ascending:false }).limit(500);
  if (result.error) { toast(readableError(result.error)); return; }
  state.dmMessages = result.data || [];
  const threads = new Map();
  state.dmMessages.forEach(message => {
    const otherId = message.sender === userId ? message.recipient : message.sender;
    if (!threads.has(otherId)) threads.set(otherId, message);
  });
  state.dmThreads = [...threads.entries()].map(([memberId, message]) => ({ memberId, message }));
  renderDmInbox();
}

function updateUnreadBadge() {
  const count = state.dmMessages.filter(message => message.recipient === state.profile.id && !message.read_at).length;
  const badge = $('#dmUnreadBadge');
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
}

function renderDmInbox() {
  const target = $('#dmThreads');
  if (!target) return;
  updateUnreadBadge();
  if (!state.dmThreads.length) {
    target.innerHTML = `<div class="empty dm-empty"><span>PRIVATE MESSAGES</span><h2>No messages yet</h2><p>Choose a member below to start a text-only conversation.</p></div>`;
    renderDmPeople();
    return;
  }
  target.innerHTML = state.dmThreads.map(thread => {
    const person = memberById(thread.memberId) || { id:thread.memberId, name:'Salty member' };
    const unread = thread.message.recipient === state.profile.id && !thread.message.read_at;
    const prefix = thread.message.sender === state.profile.id ? 'You: ' : '';
    return `<button class="dm-thread ${unread ? 'unread' : ''}" data-dm-member="${thread.memberId}">${avatarMarkup(person)}<span><b>${esc(person.name)}</b><p>${esc(prefix + thread.message.body)}</p></span><time>${esc(messageTime(thread.message.created_at))}</time>${unread ? '<i></i>' : ''}</button>`;
  }).join('');
  renderDmPeople();
}

async function openDm(memberId) {
  const person = memberById(memberId);
  if (!person || person.id === state.profile.id) return;
  state.activeDmMember = person;
  $('#dmPerson').innerHTML = `${avatarMarkup(person, 'message-avatar')}<div><b>${esc(person.name)}</b><small>Private · text only</small></div>`;
  setView('dm');
  if (state.preview) { renderDmConversation(); return; }
  await loadDmConversation();
}

async function loadDmConversation() {
  if (!state.activeDmMember) return;
  const mine = state.profile.id;
  const theirs = state.activeDmMember.id;
  const result = await db.from('dm_messages').select('*')
    .or(`and(sender.eq.${mine},recipient.eq.${theirs}),and(sender.eq.${theirs},recipient.eq.${mine})`)
    .order('created_at', { ascending:true }).limit(250);
  if (result.error) { toast(readableError(result.error)); return; }
  state.dmMessages = result.data || [];
  const unread = state.dmMessages.filter(message => message.sender === theirs && message.recipient === mine && !message.read_at);
  if (unread.length) {
    const marked = await db.rpc('mark_dm_read', { other_user:theirs });
    if (!marked.error) state.dmMessages.forEach(message => { if (message.sender === theirs && message.recipient === mine) message.read_at ||= new Date().toISOString(); });
  }
  renderDmConversation();
  await loadDmInbox();
}

function renderDmConversation() {
  const list = $('#dmMessages');
  if (!list || !state.activeDmMember) return;
  const mine = state.profile.id;
  const theirs = state.activeDmMember.id;
  const messages = state.dmMessages.filter(message => (message.sender === mine && message.recipient === theirs) || (message.sender === theirs && message.recipient === mine));
  if (!messages.length) {
    list.innerHTML = `<div class="empty chat-empty"><span>PRIVATE</span><h2>Message ${esc(state.activeDmMember.name)}</h2><p>DMs are text only. Photos and clips stay out of private messages.</p></div>`;
    return;
  }
  list.innerHTML = messages.map(message => {
    const own = message.sender === mine;
    return `<article class="message-row ${own ? 'own' : ''}" style="--speaker-hue:${speakerHue(message.sender)}">${own ? '' : avatarMarkup(state.activeDmMember, 'message-avatar')}<div class="message-stack"><div class="message-meta"><b>${own ? 'You' : esc(state.activeDmMember.name)}</b><time>${esc(messageTime(message.created_at))}</time></div><div class="message-bubble"><p>${esc(message.body)}</p></div></div></article>`;
  }).join('');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

async function sendDmMessage(event) {
  event.preventDefault();
  if (!state.activeDmMember) return;
  const body = $('#dmMessageBody').value.trim();
  if (!body) return;
  const submit = $('button[type="submit"]', event.currentTarget); submit.disabled = true;
  try {
    const result = await db.from('dm_messages').insert({ sender:state.profile.id, recipient:state.activeDmMember.id, body });
    if (result.error) throw result.error;
    event.currentTarget.reset();
    await loadDmConversation();
  } catch (error) { toast(readableError(error), 5000); }
  finally { submit.disabled = false; }
}

async function loadEvents() {
  if (!state.eventRegion) return;
  const result = await db.from('events')
    .select('*,spot:spots(*),author_profile:profiles!events_author_fkey(id,name),event_rsvps(user_id,profile:profiles!event_rsvps_user_id_fkey(id,name))')
    .eq('region_id', state.eventRegion.id).order('start_time', { ascending: true });
  if (result.error) { toast(readableError(result.error)); return; }
  state.events = result.data || [];
  renderEvents();
}

async function loadPerks() {
  const result = await db.from('rewards').select('*').eq('type', 'discount').order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (result.error) { toast(readableError(result.error)); return; }
  state.perks = result.data || [];
  renderPerks();
}

function renderPerks() {
  const list = $('#perksList');
  if (!list) return;
  const admin = Boolean(state.profile?.is_admin);
  $('#addPerkButton')?.classList.toggle('hidden', !admin);
  const visible = state.perks.filter(perk => admin || perk.active);
  if (!visible.length) {
    list.innerHTML = `<div class="empty"><span>PERKS</span><h2>No live discounts yet</h2><p>New crew perks will show up here.</p></div>`;
    return;
  }
  list.innerHTML = visible.map(perk => {
    const url = safeExternalUrl(perk.store_url);
    const code = perk.discount_code ? `<button class="perk-code" data-copy-perk="${perk.id}"><span>CODE</span><b>${esc(perk.discount_code)}</b><small>tap to copy</small></button>` : '';
    const edit = admin ? `<button class="perk-edit" data-edit-perk="${perk.id}" aria-label="Edit ${esc(perk.name)}"><svg><use href="#i-edit"/></svg></button>` : '';
    const status = admin && !perk.active ? '<span class="perk-draft">HIDDEN</span>' : '';
    return `<article class="perk-card"><div class="perk-top"><span class="perk-mark">${esc(initials(perk.brand_name || perk.name))}</span><div><small>${esc(perk.brand_name || 'Salty partner')}</small><h3>${esc(perk.name)}</h3></div>${status}${edit}</div><strong class="perk-offer">${esc(perk.offer_text || 'Member perk')}</strong>${perk.description ? `<p>${esc(perk.description)}</p>` : ''}${code}${url ? `<a class="perk-link" href="${esc(url)}" target="_blank" rel="noopener">Open store <span>↗</span></a>` : ''}</article>`;
  }).join('');
}

function resetPerkComposer() {
  state.editingPerkId = null;
  $('#perkForm').reset();
  $('#perkActive').checked = true;
  $('#perkSheetTitle').textContent = 'Add a discount';
  $('#perkSubmit').textContent = 'Publish discount';
  $('#perkDelete').classList.add('hidden');
}

function openPerkComposer(perkId = null) {
  if (!state.profile?.is_admin) { toast('Only Salty admins can manage discounts.'); return; }
  resetPerkComposer();
  const perk = perkId ? state.perks.find(item => item.id === perkId) : null;
  if (perk) {
    state.editingPerkId = perk.id;
    $('#perkSheetTitle').textContent = 'Edit discount';
    $('#perkSubmit').textContent = 'Save changes';
    $('#perkDelete').classList.remove('hidden');
    $('#perkName').value = perk.name || '';
    $('#perkBrand').value = perk.brand_name || '';
    $('#perkOffer').value = perk.offer_text || '';
    $('#perkDescription').value = perk.description || '';
    $('#perkCode').value = perk.discount_code || '';
    $('#perkUrl').value = perk.store_url || '';
    $('#perkActive').checked = perk.active !== false;
  }
  openSheet('perkSheet');
}

async function deletePerk() {
  if (!state.profile?.is_admin || !state.editingPerkId) return;
  const perk = state.perks.find(item => item.id === state.editingPerkId);
  if (!perk || !confirm(`Delete “${perk.name}”? This cannot be undone.`)) return;
  const button = $('#perkDelete'); button.disabled = true;
  try {
    const result = await db.from('rewards').delete().eq('id', perk.id);
    if (result.error) throw result.error;
    resetPerkComposer(); closeSheet(); await loadPerks(); toast('Discount deleted.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { button.disabled = false; }
}

async function savePerk(event) {
  event.preventDefault();
  if (!state.profile?.is_admin) { toast('Only Salty admins can manage discounts.'); return; }
  const submit = $('#perkSubmit'); submit.disabled = true;
  try {
    const payload = {
      name: $('#perkName').value.trim(), brand_name: $('#perkBrand').value.trim(),
      offer_text: $('#perkOffer').value.trim(), description: $('#perkDescription').value.trim() || null,
      discount_code: $('#perkCode').value.trim() || null, store_url: $('#perkUrl').value.trim() || null,
      active: $('#perkActive').checked, points_cost: 0, type: 'discount', updated_at: new Date().toISOString(),
    };
    const result = state.editingPerkId
      ? await db.from('rewards').update(payload).eq('id', state.editingPerkId)
      : await db.from('rewards').insert(payload);
    if (result.error) throw result.error;
    const edited = Boolean(state.editingPerkId);
    resetPerkComposer(); closeSheet(); await loadPerks(); toast(edited ? 'Discount updated.' : 'Discount published.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { submit.disabled = false; }
}

function eventDate(value) {
  if (!value) return 'Time coming soon';
  return new Intl.DateTimeFormat([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value));
}

function eventMapUrl(item) {
  const query = [item.venue_name, item.location_text, item.spot?.name, item.spot?.general_location].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function localDateValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function readableDateValue(value) {
  if (!value) return 'Choose a date';
  return new Intl.DateTimeFormat([], { weekday:'short', month:'short', day:'numeric', year:'numeric' }).format(new Date(`${value}T12:00:00`));
}

function readableTimeValue(value) {
  if (!value) return 'Choose a time';
  const [hours, minutes] = value.split(':').map(Number);
  return new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(new Date(2000, 0, 1, hours, minutes));
}

function readableDateTimeValue(value) {
  if (!value) return 'Choose date and time';
  return new Intl.DateTimeFormat([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value));
}

function updateDateChoiceLabels() {
  $('#eventDateDisplay').textContent = readableDateValue($('#eventDate').value);
  $('#eventStartDisplay').textContent = readableTimeValue($('#eventStartClock').value);
  $('#eventEndDisplay').textContent = readableTimeValue($('#eventEndClock').value);
  $('#sessionTimeDisplay').textContent = readableDateTimeValue($('#sessionTime').value);
}

function ensureSessionTimeChoice() {
  if (!$('#sessionTime').value) {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    date.setHours(7, 0, 0, 0);
    $('#sessionTime').value = `${localDateValue(date)}T${localTimeValue(date)}`;
  }
  updateDateChoiceLabels();
}

function resetEventComposer() {
  state.editingEventId = null;
  $('#eventForm').reset();
  $('#eventSheetTitle').textContent = 'Add an event';
  $('#eventSubmit').textContent = 'Share event';
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  $('#eventDate').value = localDateValue(start);
  $('#eventStartClock').value = localTimeValue(start);
  $('#eventEndClock').value = localTimeValue(end);
  updateDateChoiceLabels();
}

function openEventComposer(eventId = null) {
  resetEventComposer();
  const item = eventId ? state.events.find(event => event.id === eventId && event.author === state.profile.id) : null;
  if (item) {
    state.editingEventId = item.id;
    const start = new Date(item.start_time);
    const end = item.end_time ? new Date(item.end_time) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    $('#eventSheetTitle').textContent = 'Edit event';
    $('#eventSubmit').textContent = 'Save changes';
    $('#eventTitle').value = item.title || '';
    $('#eventDate').value = localDateValue(start);
    $('#eventStartClock').value = localTimeValue(start);
    $('#eventEndClock').value = localTimeValue(end);
    $('#eventVenue').value = item.venue_name || item.spot?.name || '';
    $('#eventLocation').value = item.location_text || item.spot?.general_location || '';
    $('#eventDescription').value = item.description || '';
    updateDateChoiceLabels();
  }
  openSheet('eventSheet');
}

function renderEvents() {
  const feed = $('#eventsFeed');
  if (!feed || !state.eventRegion) return;
  if (!state.events.length) {
    feed.innerHTML = `<div class="empty"><span>EVENTS</span><h2>No events in ${esc(state.eventRegion.name)} yet</h2><p>Add a comp, movie night, or meetup and the crew can RSVP.</p></div>`;
    return;
  }
  feed.innerHTML = state.events.map(item => {
    const going = item.event_rsvps || [];
    const mine = going.some(rsvp => rsvp.user_id === state.profile.id);
    const crew = going.slice(0, 4).map(rsvp => avatarMarkup(rsvp.profile, 'event-avatar')).join('');
    const start = item.start_time ? new Date(item.start_time) : null;
    const month = start ? new Intl.DateTimeFormat([], { month:'short' }).format(start).toUpperCase() : 'DATE';
    const day = start ? start.getDate() : '—';
    const place = [item.venue_name || item.spot?.name, item.location_text || item.spot?.general_location].filter(Boolean).join(' · ');
    const mapUrl = eventMapUrl(item);
    const edit = item.author === state.profile.id ? `<button class="event-edit" data-edit-event="${item.id}" aria-label="Edit ${esc(item.title)}"><svg><use href="#i-edit"/></svg></button>` : '';
    return `<article class="event-card"><div class="event-date-tile"><span>${esc(month)}</span><b>${day}</b></div><div class="event-main"><div class="event-heading"><div><h2>${esc(item.title)}</h2><p>${esc(eventDate(item.start_time))}${item.end_time ? ` – ${esc(new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(new Date(item.end_time)))}` : ''}</p></div>${edit}</div>${place ? `<a class="event-place" href="${esc(mapUrl)}" target="_blank" rel="noopener"><svg><use href="#i-pin"/></svg><span>${esc(place)}</span><b>Map ↗</b></a>` : ''}${item.description ? `<p class="event-description">${esc(item.description)}</p>` : ''}<div class="event-going"><div class="event-stack">${crew}</div><b>${going.length} going</b></div><div class="card-actions"><button class="small-action surf ${mine ? 'on' : ''}" data-event-rsvp="${item.id}"><svg><use href="#i-check"/></svg>${mine ? 'Going ✓' : 'RSVP'}</button><button class="small-action" data-event-calendar="${item.id}"><svg><use href="#i-calendar"/></svg>Add to calendar</button></div></div></article>`;
  }).join('');
}

async function createEvent(event) {
  event.preventDefault();
  const submit = $('#eventForm button[type="submit"]');
  submit.disabled = true;
  try {
    const date = $('#eventDate').value;
    const start = new Date(`${date}T${$('#eventStartClock').value}`);
    let end = new Date(`${date}T${$('#eventEndClock').value}`);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || start <= new Date()) throw new Error('Pick a future date and time.');
    if (!Number.isFinite(end.getTime()) || end <= start) throw new Error('The event end time must be after its start time.');
    const payload = {
      author: state.profile.id,
      region_id: state.eventRegion.id,
      title: $('#eventTitle').value.trim(),
      spot_id: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      venue_name: $('#eventVenue').value.trim() || null,
      location_text: $('#eventLocation').value.trim(),
      description: $('#eventDescription').value.trim() || null,
    };
    const result = state.editingEventId
      ? await db.from('events').update(payload).eq('id', state.editingEventId).eq('author', state.profile.id)
      : await db.from('events').insert(payload);
    if (result.error) throw result.error;
    const edited = Boolean(state.editingEventId);
    resetEventComposer(); closeSheet(); await loadEvents(); toast(edited ? 'Event updated.' : 'Event shared with the crew.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { submit.disabled = false; }
}

async function toggleEventRsvp(eventId) {
  const item = state.events.find(event => event.id === eventId);
  const mine = item?.event_rsvps?.some(rsvp => rsvp.user_id === state.profile.id);
  const result = mine
    ? await db.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', state.profile.id)
    : await db.from('event_rsvps').insert({ event_id: eventId, user_id: state.profile.id });
  if (result.error) { toast(readableError(result.error)); return; }
  await loadEvents(); await renderProfile();
}

function addEventToCalendar(eventId) {
  const item = state.events.find(event => event.id === eventId);
  if (!item?.start_time) { toast('This event does not have a date yet.'); return; }
  const clean = value => String(value || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(item.start_time);
  const end = item.end_time ? new Date(item.end_time) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const place = [item.venue_name, item.location_text, item.spot?.name, item.spot?.general_location].filter(Boolean).join(', ');
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Salty//Events//EN','BEGIN:VEVENT',`UID:${item.id}@saltyviewfinder.com`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${clean(item.title)}`,`DESCRIPTION:${clean(item.description)}`,`LOCATION:${clean(place)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([body], { type:'text/calendar;charset=utf-8' }));
  link.download = `${item.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'salty-event'}.ics`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Calendar event ready.');
}

function sessionWhen(session) {
  if (session.when_label === 'Now' || !session.surf_time) return 'out now';
  return new Intl.DateTimeFormat([], { weekday:'short', hour:'numeric', minute:'2-digit' }).format(new Date(session.surf_time));
}

function spotMapUrl(spot) {
  if (!spot?.general_location) return '';
  const query = [spot.name, spot.general_location].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderSessions() {
  const liveNow = state.sessions.filter(session => session.when_label === 'Now').length;
  $('#liveCount').innerHTML = liveNow ? `<i></i>${liveNow} OUT NOW` : 'quiet right now';
  const feed = $('#sessionsFeed');
  if (!state.sessions.length) {
    feed.innerHTML = `<div class="empty"><span>QUIET</span><h2>No one's out in ${esc(state.currentRegion.name)} yet</h2><p>Be the first to post a session. One person starts it and the area comes alive.</p></div>`;
    return;
  }
  const orderedSessions = [...state.sessions].sort((first, second) => {
    const firstNow = first.when_label === 'Now';
    const secondNow = second.when_label === 'Now';
    if (firstNow !== secondNow) return firstNow ? -1 : 1;
    return new Date(first.surf_time || first.created_at || 0) - new Date(second.surf_time || second.created_at || 0);
  });
  feed.innerHTML = orderedSessions.map(session => {
    const mine = session.author === state.profile.id;
    const myRsvp = session.session_rsvps.find(rsvp => rsvp.user_id === state.profile.id);
    const surfers = [...(session.participant_names || []), session.featured_surfer_name, ...session.session_rsvps.filter(rsvp => rsvp.role === 'surf').map(rsvp => rsvp.profile?.name)]
      .filter(Boolean)
      .filter((name, index, names) => names.findIndex(item => item.toLowerCase() === name.toLowerCase()) === index);
    const filmers = session.session_rsvps.filter(rsvp => rsvp.role === 'film').map(rsvp => rsvp.profile?.name).filter((name, index, names) => name && names.indexOf(name) === index);
    const crewSummary = [surfers.length ? `<b>${esc(surfers.join(', '))}</b> surfing` : '', filmers.length ? `<b>${esc(filmers.join(', '))}</b> filming` : ''].filter(Boolean).join(' · ');
    const authorRole = session.author_role === 'film' ? 'filming' : 'surfing';
    const edit = mine ? `<button class="session-edit-icon" data-edit-session="${session.id}" aria-label="Edit surf"><svg><use href="#i-edit"/></svg></button>` : '';
    const actions = mine
      ? `<button class="small-action finish" data-end-session="${session.id}"><svg><use href="#i-check"/></svg>Surf finished</button>`
      : `<button class="small-action surf ${myRsvp?.role === 'surf' ? 'on' : ''}" data-rsvp="${session.id}" data-role="surf"><svg><use href="#i-check"/></svg>${myRsvp?.role === 'surf' ? "You're in" : "I'm down"}</button><button class="small-action film ${myRsvp?.role === 'film' ? 'on' : ''}" data-rsvp="${session.id}" data-role="film"><svg><use href="#i-camera"/></svg>${myRsvp?.role === 'film' ? 'Filming ✓' : "I'll film"}</button>`;
    const mapUrl = spotMapUrl(session.spot);
    const location = session.spot?.general_location ? `<a class="spot-location" href="${esc(mapUrl)}" target="_blank" rel="noopener"><svg><use href="#i-pin"/></svg>${esc(session.spot.general_location)}</a>` : '';
    return `<article class="session-card ${mine ? 'mine' : ''} ${session.wants_filmer ? 'wants' : ''}"><i class="stripe"></i>${edit}<div class="card-head">${avatarMarkup(session.author_profile)}<div class="card-person"><strong>${mine ? 'You' : esc(session.author_profile?.name)} ${mine ? '<b class="you-tag">YOU</b>' : ''}</strong><small>${mine ? 'you started this session' : esc(state.currentRegion.name)} · ${authorRole}</small></div>${session.wants_filmer ? '<b class="filmer-tag">Wants filmer</b>' : ''}</div><div class="spot-line"><strong>${esc(session.spot?.name || 'Spot TBD')}</strong><span>${esc(sessionWhen(session))}</span></div>${location}${session.note ? `<p class="session-note">${esc(session.note)}</p>` : ''}<p class="crew-line">${crewSummary || '<b>Open session</b> · bring the crew'}</p><div class="card-actions">${actions}</div></article>`;
  }).join('');
}

async function ensureSpot(name, generalLocation, regionId) {
  const cleanName = name.trim();
  const cleanLocation = generalLocation.trim();
  const nameMatch = state.spots.find(item => item.name.toLowerCase() === cleanName.toLowerCase() && item.region_id === regionId);
  if (nameMatch) {
    const locationChanged = cleanLocation && (nameMatch.general_location || '').toLowerCase() !== cleanLocation.toLowerCase();
    if (locationChanged && nameMatch.created_by === state.profile.id) {
      const updated = await db.from('spots').update({ general_location: cleanLocation }).eq('id', nameMatch.id).select().single();
      if (updated.error) throw updated.error;
      Object.assign(nameMatch, updated.data);
      renderChrome();
    }
    return nameMatch;
  }
  const result = await db.from('spots').insert({ name: cleanName, general_location: cleanLocation || null, region_id: regionId, created_by: state.profile.id }).select().single();
  if (result.error?.code === '23505') {
    const existing = await db.from('spots').select('*').eq('region_id', regionId).ilike('name', cleanName).limit(1).maybeSingle();
    if (!existing.error && existing.data) {
      state.spots.push(existing.data); renderChrome(); return existing.data;
    }
  }
  if (result.error) throw result.error;
  state.spots.push(result.data);
  renderChrome();
  return result.data;
}

function renderSessionPeopleChips() {
  $('#sessionPeopleChips').innerHTML = state.sessionPeople.map((name, index) => `<button type="button" data-remove-session-person="${index}">${esc(name)}<span>×</span></button>`).join('');
}

function addSessionPerson(rawName = $('#sessionPersonInput').value) {
  const names = rawName.split(',').map(name => name.trim()).filter(Boolean);
  names.forEach(name => {
    if (state.sessionPeople.length >= 20) return;
    if (!state.sessionPeople.some(existing => existing.toLowerCase() === name.toLowerCase()) && name.toLowerCase() !== state.profile.name.toLowerCase()) state.sessionPeople.push(name);
  });
  $('#sessionPersonInput').value = '';
  renderSessionPeopleChips();
}

function resetSessionComposer() {
  state.editingSessionId = null;
  state.sessionPeople = [];
  $('#sessionForm').reset();
  $('#sessionSheetTitle').textContent = 'Share a surf';
  $('#sessionSubmit').textContent = 'Share session';
  $('#sessionCancel').classList.add('hidden');
  $('#sessionCancelNote').classList.add('hidden');
  $$('[data-when]').forEach(button => button.classList.toggle('active', button.dataset.when === 'now'));
  $$('[data-session-role]').forEach(button => button.classList.toggle('active', button.dataset.sessionRole === 'surf'));
  $('#sessionDateChoice').classList.add('hidden');
  $('#sessionTime').value = '';
  updateDateChoiceLabels();
  $('#wantsFilmerRow').classList.remove('hidden');
  renderSessionPeopleChips();
}

function openSessionComposer(sessionId = null) {
  resetSessionComposer();
  const session = sessionId ? state.sessions.find(item => item.id === sessionId && item.author === state.profile.id) : null;
  if (session) {
    state.editingSessionId = session.id;
    state.sessionPeople = [...(session.participant_names || (session.featured_surfer_name ? [session.featured_surfer_name] : []))];
    $('#sessionSheetTitle').textContent = 'Edit surf';
    $('#sessionSubmit').textContent = 'Save changes';
    $('#sessionCancel').classList.remove('hidden');
    $('#sessionCancelNote').classList.remove('hidden');
    $('#sessionSpot').value = session.spot?.name || '';
    $('#sessionLocation').value = session.spot?.general_location || '';
    const later = session.when_label !== 'Now';
    $$('[data-when]').forEach(button => button.classList.toggle('active', button.dataset.when === (later ? 'later' : 'now')));
    $('#sessionDateChoice').classList.toggle('hidden', !later);
    if (session.surf_time) {
      const localDate = new Date(new Date(session.surf_time).getTime() - new Date(session.surf_time).getTimezoneOffset() * 60000);
      $('#sessionTime').value = localDate.toISOString().slice(0, 16);
    }
    if (later) ensureSessionTimeChoice();
    $$('[data-session-role]').forEach(button => button.classList.toggle('active', button.dataset.sessionRole === session.author_role));
    $('#wantsFilmerRow').classList.toggle('hidden', session.author_role === 'film');
    $('#wantsFilmer').checked = session.wants_filmer;
    $('#sessionNote').value = session.note || '';
    renderSessionPeopleChips();
  }
  openSheet('sessionSheet');
}

async function createSession(event) {
  event.preventDefault();
  const submit = $('#sessionForm button[type="submit"]'); submit.disabled = true;
  try {
    if ($('#sessionPersonInput').value.trim()) addSessionPerson();
    const spot = await ensureSpot($('#sessionSpot').value, $('#sessionLocation').value, state.currentRegion.id);
    const later = $('[data-when="later"]').classList.contains('active');
    const surfTime = later ? $('#sessionTime').value : null;
    if (later && !surfTime) throw new Error('Pick a date and time.');
    if (surfTime && new Date(surfTime) <= new Date()) throw new Error('Pick a future date and time.');
    const payload = {
      author: state.profile.id, spot_id: spot.id, region_id: state.currentRegion.id,
      when_label: later ? 'Scheduled' : 'Now', surf_time: surfTime ? new Date(surfTime).toISOString() : null,
      author_role: $('[data-session-role].active').dataset.sessionRole,
      featured_surfer_name: null, featured_surfer_user: null, participant_names: state.sessionPeople,
      wants_filmer: $('#wantsFilmer').checked, note: $('#sessionNote').value.trim() || null,
    };
    const result = state.editingSessionId
      ? await db.from('sessions').update(payload).eq('id', state.editingSessionId).eq('author', state.profile.id)
      : await db.from('sessions').insert(payload);
    if (result.error) throw result.error;
    const edited = Boolean(state.editingSessionId);
    resetSessionComposer(); closeSheet(); await loadSessions(); await renderProfile(); toast(edited ? 'Surf updated.' : 'Your session is live.');
  } catch (error) { toast(readableError(error)); }
  finally { submit.disabled = false; }
}

async function setRsvp(sessionId, role) {
  const existing = state.sessions.find(session => session.id === sessionId)?.session_rsvps.find(rsvp => rsvp.user_id === state.profile.id);
  const result = existing?.role === role
    ? await db.from('session_rsvps').delete().eq('id', existing.id)
    : await db.from('session_rsvps').upsert({ session_id: sessionId, user_id: state.profile.id, role }, { onConflict: 'session_id,user_id' });
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); await renderProfile();
}

async function endSession(sessionId) {
  if (!confirm('Mark this surf as finished? If it was cancelled, use the pencil and Cancel session instead.')) return;
  const result = await db.from('sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId).eq('author', state.profile.id);
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); toast('Surf marked finished.');
}

async function cancelSession() {
  const sessionId = state.editingSessionId;
  if (!sessionId || !confirm('Cancel this surf? It will disappear for everyone. This cannot be undone.')) return;
  const button = $('#sessionCancel'); button.disabled = true;
  try {
    const result = await db.from('sessions').delete().eq('id', sessionId).eq('author', state.profile.id);
    if (result.error) throw result.error;
    resetSessionComposer(); closeSheet(); await loadSessions(); await renderProfile(); toast('Surf cancelled.');
  } catch (error) { toast(readableError(error)); }
  finally { button.disabled = false; }
}

async function loadPosts() {
  const result = await db.from('posts')
    .select('*,spot:spots(*),author_profile:profiles!posts_author_fkey(id,name),post_likes(user_id),post_comments(id,body,created_at,author_profile:profiles!post_comments_author_fkey(id,name))')
    .order('created_at', { ascending: false }).limit(50);
  if (result.error) { toast(readableError(result.error)); return; }
  state.posts = result.data || [];
  renderPosts();
}

function renderPosts() {
  const feed = $('#postsFeed');
  if (!state.posts.length) {
    feed.innerHTML = '<div class="empty"><span>STOKE</span><h2>No photos or clips yet</h2><p>Share the first photo or clip. The filmer is always credited.</p></div>';
    return;
  }
  feed.innerHTML = state.posts.map(post => {
    const liked = post.post_likes.some(like => like.user_id === state.profile.id);
    const media = post.media_type === 'clip' ? `<video src="${esc(post.media_url)}" controls preload="metadata" playsinline></video>` : `<img src="${esc(post.media_url)}" alt="${esc(post.caption || 'Surf photo')}">`;
    const comments = post.post_comments.slice(-3).map(comment => `<p class="comment"><b>${esc(comment.author_profile?.name || 'Crew')}</b> ${esc(comment.body)}</p>`).join('');
    return `<article class="post-card"><div class="post-media">${media}<span class="post-author">${esc(post.spot?.name || post.author_profile?.name || 'Salty')}</span><div class="post-overlay"><div class="credits">${post.surfer_name ? `<span class="credit"><b>Surfer</b>${esc(post.surfer_name)}</span>` : ''}${post.board ? `<span class="credit"><b>Board</b>${esc(post.board)}</span>` : ''}<span class="credit filmer"><b>Filmer</b>${esc(post.filmer_name)}</span></div>${post.caption ? `<p class="post-caption">${esc(post.caption)}</p>` : ''}</div></div><div class="post-foot"><button data-like="${post.id}" class="${liked ? 'liked' : ''}"><svg><use href="#i-heart"/></svg>${post.post_likes.length}</button><button data-comment-toggle="${post.id}"><svg><use href="#i-chat"/></svg>${post.post_comments.length}</button><small>◎ Everyone sees this</small></div><div class="comments" data-comments="${post.id}">${comments}<form class="comment-form" data-comment-form="${post.id}"><input maxlength="1000" required placeholder="Add a comment…"><button>↑</button></form></div></article>`;
  }).join('');
}

async function videoDuration(file) {
  return await new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => { const duration = video.duration; URL.revokeObjectURL(url); resolve(duration); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this clip. Try MP4, MOV, or WebM.')); };
    video.src = url;
  });
}

async function validateMedia(file) {
  if (!file) throw new Error('Choose a photo or clip.');
  if (file.size > CONFIG.maxUploadBytes) throw new Error(`This file is ${(file.size / 1048576).toFixed(0)} MB. Free-tier clips must be 50 MB or smaller.`);
  if (file.type.startsWith('video/')) {
    const duration = await videoDuration(file);
    if (duration > CONFIG.maxClipSeconds + 0.5) throw new Error(`This clip is ${Math.ceil(duration)} seconds. Clips are capped at 90 seconds.`);
  }
}

async function uploadMedia(file, path) {
  // Free-tier adapter. TODO(video): replace only this function with tus-js-client
  // against the direct storage hostname when Supabase Pro is enabled.
  const result = await db.storage.from(CONFIG.mediaBucket).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (result.error) throw result.error;
  return db.storage.from(CONFIG.mediaBucket).getPublicUrl(path).data.publicUrl;
}

function matchingPerson(name) {
  return state.people.find(person => person.name.toLowerCase() === name.trim().toLowerCase());
}

async function createPost(event) {
  event.preventDefault();
  const submit = $('#postForm button[type="submit"]'); submit.disabled = true;
  const progress = $('#uploadProgress');
  try {
    const file = $('#mediaFile').files[0];
    await validateMedia(file);
    const mediaType = file.type.startsWith('video/') ? 'clip' : 'photo';
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || (mediaType === 'clip' ? 'mp4' : 'jpg');
    const path = `${state.profile.id}/${crypto.randomUUID()}.${extension}`;
    progress.value = 18; progress.classList.remove('hidden');
    const mediaUrl = await uploadMedia(file, path);
    progress.value = 82;
    const spotName = $('#postSpot').value.trim();
    const spot = spotName ? await ensureSpot(spotName, $('#postLocation').value, state.currentRegion.id) : null;
    const filmerName = $('#filmerName').value.trim();
    const surferName = $('#surferName').value.trim();
    const filmer = matchingPerson(filmerName);
    const surfer = surferName ? matchingPerson(surferName) : null;
    const created = await db.from('posts').insert({
      author: state.profile.id, media_url: mediaUrl, media_path: path, media_type: mediaType,
      filmer_name: filmerName, filmer_user: filmer?.id || null, surfer_name: surferName || null,
      board: $('#boardName').value.trim() || null, spot_id: spot?.id || null,
      caption: $('#postCaption').value.trim() || null,
    }).select('id').single();
    if (created.error) throw created.error;
    const tags = [];
    if (filmer && filmer.id !== state.profile.id) tags.push({ post_id: created.data.id, user_id: filmer.id, role: 'filmer' });
    if (surfer && surfer.id !== state.profile.id) tags.push({ post_id: created.data.id, user_id: surfer.id, role: 'surfer' });
    if (tags.length) {
      const tagsResult = await db.from('post_tags').insert(tags);
      if (tagsResult.error) throw tagsResult.error;
    }
    progress.value = 100; $('#postForm').reset(); $('#fileLabel').textContent = 'Add photo or clip'; closeSheet();
    await loadPosts(); await renderProfile(); toast('Shared with the whole community.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { submit.disabled = false; progress.classList.add('hidden'); progress.value = 0; }
}

async function toggleLike(postId) {
  const post = state.posts.find(item => item.id === postId);
  const liked = post.post_likes.some(like => like.user_id === state.profile.id);
  const result = liked
    ? await db.from('post_likes').delete().eq('post_id', postId).eq('user_id', state.profile.id)
    : await db.from('post_likes').insert({ post_id: postId, user_id: state.profile.id });
  if (result.error) { toast(readableError(result.error)); return; }
  await loadPosts();
}

async function addComment(event, postId) {
  event.preventDefault();
  const input = $('input', event.currentTarget);
  const result = await db.from('post_comments').insert({ post_id: postId, author: state.profile.id, body: input.value.trim() });
  if (result.error) { toast(readableError(result.error)); return; }
  input.value = ''; await loadPosts(); await renderProfile();
}

async function renderProfile() {
  const [points, streak, posts] = await Promise.all([
    db.from('points_events').select('points').eq('user_id', state.profile.id),
    db.from('streaks').select('*').eq('user_id', state.profile.id).maybeSingle(),
    db.from('posts').select('id', { count: 'exact', head: true }).eq('author', state.profile.id),
  ]);
  const total = (points.data || []).reduce((sum, event) => sum + event.points, 0);
  $('#profileView').innerHTML = profileMarkup(state.profile, { points:total, streak:streak.data?.current_streak || 0, clips:posts.count || 0, own:true });
  $('#streakBadge b').textContent = streak.data?.current_streak || 0;
}

function profileMarkup(profile, stats = {}) {
  const region = state.regions.find(item => item.id === profile.home_region)?.name || 'Salty Crew';
  const sponsors = profile.sponsors?.length ? profile.sponsors : [];
  const nickname = profile.nickname ? `<p class="nickname">“${esc(profile.nickname)}”</p>` : '';
  const socialUrl = safeExternalUrl(profile.social_url);
  const social = socialUrl ? `<a class="profile-link" href="${esc(socialUrl)}" target="_blank" rel="noopener">Social profile ↗</a>` : '';
  const controls = stats.own
    ? `<div class="profile-actions"><button class="primary" data-action="share-invite">Invite a friend to Salty</button><button class="secondary-button guide-invite-button" data-action="share-invite-guide">Invite a friend + guide</button><button class="secondary-button" data-view="members">View all members</button><button class="secondary-button" data-action="edit-profile">Edit profile</button></div>`
    : `<div class="profile-actions"><button class="primary" data-dm-member="${profile.id}">Message ${esc(profile.name)}</button></div>`;
  return `<div class="profile-head">${avatarMarkup(profile)}<div><h2>${esc(profile.name)}</h2>${nickname}<p>${esc(region)} · Salty Crew</p></div></div>${stats.own ? `<div class="stats"><article class="profile-card stat"><b>${formatCount(stats.points)}</b><span>points</span></article><article class="profile-card stat"><b>${stats.streak || 0}</b><span>active streak</span></article><article class="profile-card stat"><b>${stats.clips || 0}</b><span>clips</span></article></div>` : ''}<article class="profile-card"><h3>Sponsors</h3><div class="chips">${sponsors.length ? sponsors.map(name => `<span class="chip">${esc(name)}</span>`).join('') : '<span class="muted-copy">Independent</span>'}</div>${social}</article>${controls}<footer class="profile-footer"><b>SALTY</b>surf with your friends, not your feed</footer>`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_error) { return null; }
}

function renderMembers() {
  const list = $('#membersList');
  if (!list) return;
  list.innerHTML = state.people.map(profile => {
    const region = state.regions.find(item => item.id === profile.home_region)?.name || 'Salty Crew';
    const nickname = profile.nickname ? ` · “${esc(profile.nickname)}”` : '';
    return `<button class="member-row" data-member="${profile.id}">${avatarMarkup(profile)}<span><b>${esc(profile.name)}</b><small>${esc(region)}${nickname}</small></span><i>›</i></button>`;
  }).join('');
}

function openMember(profileId) {
  const profile = state.people.find(person => person.id === profileId);
  if (!profile) return;
  state.selectedMember = profile;
  $('#memberProfile').innerHTML = profileMarkup(profile, { own:profile.id === state.profile.id });
  setView(profile.id === state.profile.id ? 'you' : 'member');
}

function subscribeRealtime() {
  if (state.realtime) db.removeChannel(state.realtime);
  state.realtime = db.channel('salty-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, async () => await loadSessions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_rsvps' }, async () => await loadSessions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async () => await loadPosts())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, async () => await loadPosts())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments' }, async () => await loadPosts())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async () => await loadEvents())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_rsvps' }, async () => await loadEvents())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards' }, async () => await loadPerks())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_messages' }, async () => await loadRoomMessages())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, async () => {
      if (state.activeDmMember && state.view === 'dm') await loadDmConversation();
      else await loadDmInbox();
    })
    .subscribe();
}

function openDrawer() { $('#drawer').classList.add('open'); $('#drawerScrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerScrim').classList.remove('open'); }
function openSheet(id) { const sheet = $(`#${id}`); sheet.scrollTop = 0; sheet.classList.add('open'); $('#sheetScrim').classList.add('open'); }
function closeSheet() { $$('.sheet').forEach(sheet => sheet.classList.remove('open')); $('#sheetScrim').classList.remove('open'); }

function quickStartGuideUrl() {
  return new URL(GUIDE_PATH, location.href).href;
}

function openGuide() {
  const viewer = $('#guideViewer');
  const frame = $('#guideFrame');
  if (!frame.getAttribute('src')) frame.src = quickStartGuideUrl();
  viewer.classList.remove('hidden');
  document.body.classList.add('guide-open');
  viewer.querySelector('[data-action="close-guide"]')?.focus();
}

function closeGuide() {
  $('#guideViewer').classList.add('hidden');
  document.body.classList.remove('guide-open');
}

async function quickStartGuideFile() {
  const response = await fetch(quickStartGuideUrl());
  if (!response.ok) throw new Error('The Quick Start Guide could not be loaded.');
  return new File([await response.blob()], 'SALTY_Quick_Start_Guide_V3_5.pdf', { type:'application/pdf' });
}

async function shareSaltyContent({ title, text, url, file = null, copiedMessage }) {
  if (navigator.share) {
    if (file && navigator.canShare?.({ files:[file] })) {
      await navigator.share({ title, text, url, files:[file] });
    } else {
      await navigator.share({ title, text, url });
    }
    return;
  }
  const copy = `${text}\n${url}`;
  try {
    await navigator.clipboard.writeText(copy);
    toast(copiedMessage);
  } catch (_error) {
    prompt('Copy this message:', copy);
  }
}

async function shareGuide() {
  const url = quickStartGuideUrl();
  const title = 'Salty Quick Start Guide';
  const text = 'Here is the Salty Quick Start Guide.';
  let file = null;
  try { file = await quickStartGuideFile(); }
  catch (_error) { /* The public guide link remains available as a fallback. */ }
  try {
    await shareSaltyContent({ title, text, url, file, copiedMessage:'Quick Start Guide link copied.' });
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy the Quick Start Guide link:', url);
  }
}

async function shareInvite({ includeGuide = false } = {}) {
  const result = await db.rpc('create_invite', { invite_max_uses: 1 });
  if (result.error) { toast(readableError(result.error)); return; }
  const url = new URL('./', location.href); url.searchParams.set('invite', result.data);
  const guideUrl = quickStartGuideUrl();
  const title = "You're invited to Salty";
  const text = includeGuide
    ? `I'm inviting you to Salty, a private surf community. Hopefully it helps us surf more together.\n\nYour invite: ${url.href}\nQuick Start Guide: ${guideUrl}`
    : `I'm inviting you to Salty, a private surf community. Hopefully it helps us surf more together.`;
  let file = null;
  if (includeGuide) {
    try { file = await quickStartGuideFile(); }
    catch (_error) { /* Both links remain in the share message. */ }
  }
  try {
    await shareSaltyContent({
      title,
      text,
      url:url.href,
      file,
      copiedMessage:includeGuide ? 'Invite and guide links copied.' : 'Invite message and link copied.',
    });
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy this invite:', `${text}\n${url.href}`);
  }
}

document.addEventListener('click', async event => {
  const actionNode = event.target.closest('[data-action]');
  const viewNode = event.target.closest('[data-view]');
  const regionNode = event.target.closest('[data-region]');
  const rsvpNode = event.target.closest('[data-rsvp]');
  const endNode = event.target.closest('[data-end-session]');
  const editSessionNode = event.target.closest('[data-edit-session]');
  const removeSessionPersonNode = event.target.closest('[data-remove-session-person]');
  const likeNode = event.target.closest('[data-like]');
  const whenNode = event.target.closest('[data-when]');
  const sessionRoleNode = event.target.closest('[data-session-role]');
  const memberNode = event.target.closest('[data-member]');
  const iconThemeNode = event.target.closest('[data-icon-theme]');
  const eventRegionNode = event.target.closest('[data-event-region]');
  const eventRsvpNode = event.target.closest('[data-event-rsvp]');
  const eventCalendarNode = event.target.closest('[data-event-calendar]');
  const editEventNode = event.target.closest('[data-edit-event]');
  const editPerkNode = event.target.closest('[data-edit-perk]');
  const copyPerkNode = event.target.closest('[data-copy-perk]');
  const chatRegionNode = event.target.closest('[data-chat-region]');
  const dmMemberNode = event.target.closest('[data-dm-member]');
  if (iconThemeNode) applyIconTheme(iconThemeNode.dataset.iconTheme, true);
  if (viewNode) setView(viewNode.dataset.view);
  if (memberNode) openMember(memberNode.dataset.member);
  if (dmMemberNode) await openDm(dmMemberNode.dataset.dmMember);
  if (removeSessionPersonNode) {
    state.sessionPeople.splice(Number(removeSessionPersonNode.dataset.removeSessionPerson), 1);
    renderSessionPeopleChips();
  }
  if (regionNode) {
    state.currentRegion = state.regions.find(region => region.id === regionNode.dataset.region);
    $('#regionMenu').classList.remove('open'); renderChrome();
    if (state.preview) {
      state.sessions = state.previewSessions.filter(session => session.region_id === state.currentRegion.id);
      renderSessions();
    } else await loadSessions();
  }
  if (eventRegionNode) {
    state.eventRegion = state.regions.find(region => region.id === eventRegionNode.dataset.eventRegion);
    renderEventRegions();
    if (!state.preview) await loadEvents();
  }
  if (chatRegionNode) {
    state.chatRegion = state.regions.find(region => region.id === chatRegionNode.dataset.chatRegion);
    renderChatRegions();
    if (state.preview) renderRoomMessages();
    else await loadRoomMessages();
  }
  if (state.preview && (rsvpNode || endNode || likeNode || ['make-invite', 'share-invite', 'share-invite-guide', 'edit-profile', 'delete-perk', 'cancel-session', 'sign-out'].includes(actionNode?.dataset.action))) {
    toast('Preview only — nothing saves here.');
    return;
  }
  if (rsvpNode) await setRsvp(rsvpNode.dataset.rsvp, rsvpNode.dataset.role);
  if (editSessionNode) openSessionComposer(editSessionNode.dataset.editSession);
  if (endNode) await endSession(endNode.dataset.endSession);
  if (likeNode) await toggleLike(likeNode.dataset.like);
  if (eventRsvpNode) await toggleEventRsvp(eventRsvpNode.dataset.eventRsvp);
  if (eventCalendarNode) addEventToCalendar(eventCalendarNode.dataset.eventCalendar);
  if (editEventNode) openEventComposer(editEventNode.dataset.editEvent);
  if (editPerkNode) openPerkComposer(editPerkNode.dataset.editPerk);
  if (copyPerkNode) {
    const perk = state.perks.find(item => item.id === copyPerkNode.dataset.copyPerk);
    if (perk?.discount_code) {
      try { await navigator.clipboard.writeText(perk.discount_code); toast('Discount code copied.'); }
      catch (_error) { prompt('Copy this discount code:', perk.discount_code); }
    }
  }
  if (whenNode) {
    $$('[data-when]').forEach(button => button.classList.toggle('active', button === whenNode));
    const later = whenNode.dataset.when === 'later';
    $('#sessionDateChoice').classList.toggle('hidden', !later);
    if (later) ensureSessionTimeChoice();
  }
  if (sessionRoleNode) {
    $$('[data-session-role]').forEach(button => button.classList.toggle('active', button === sessionRoleNode));
    const isFilming = sessionRoleNode.dataset.sessionRole === 'film';
    $('#wantsFilmerRow').classList.toggle('hidden', isFilming);
    if (isFilming) $('#wantsFilmer').checked = false;
  }
  if (!actionNode) return;
  const actions = {
    'back-welcome': showWelcome,
    'accept-consent': acceptConsent,
    'consent-back': leaveConsent,
    'view-consent': () => openConsent('settings'),
    'google-auth': signInWithGoogle,
    'verify-code': verifyEmailCode,
    'verify-link': verifyEmailLink,
    'open-drawer': openDrawer,
    'close-drawer': closeDrawer,
    'toggle-regions': () => $('#regionMenu').classList.toggle('open'),
    'open-session': () => openSessionComposer(),
    'add-session-person': addSessionPerson,
    'cancel-session': cancelSession,
    'open-post': () => openSheet('postSheet'),
    'open-event': () => openEventComposer(),
    'open-perk': () => openPerkComposer(),
    'delete-perk': deletePerk,
    'show-install': showInstallInstructions,
    'dismiss-install': dismissInstallNudge,
    'native-install': runNativeInstall,
    'close-sheet': closeSheet,
    'open-guide': openGuide,
    'close-guide': closeGuide,
    'go-surfing': () => setView('surfing'),
    'open-dms': () => setView('dms'),
    'make-invite': () => shareInvite(),
    'share-invite': () => shareInvite(),
    'share-invite-guide': () => shareInvite({ includeGuide:true }),
    'share-guide': shareGuide,
    'edit-profile': showProfileSetup,
    'cancel-profile': () => showOnly('app'),
    'sign-out': async () => { clearPendingAuth(); await db.auth.signOut(); location.href = './'; },
  };
  if (actions[actionNode.dataset.action]) await actions[actionNode.dataset.action]();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#guideViewer').classList.contains('hidden')) closeGuide();
});

document.addEventListener('submit', async event => {
  if (state.preview) {
    event.preventDefault();
    toast('Preview only — nothing saves here.');
    return;
  }
  if (event.target.id === 'authForm') await sendMagicLink(event);
  else if (event.target.id === 'profileForm') await completeProfile(event);
  else if (event.target.id === 'sessionForm') await createSession(event);
  else if (event.target.id === 'postForm') await createPost(event);
  else if (event.target.id === 'eventForm') await createEvent(event);
  else if (event.target.id === 'perkForm') await savePerk(event);
  else if (event.target.id === 'roomMessageForm') await sendRoomMessage(event);
  else if (event.target.id === 'dmMessageForm') await sendDmMessage(event);
  else if (event.target.matches('[data-comment-form]')) await addComment(event, event.target.dataset.commentForm);
});

$('#enterButton').addEventListener('click', () => openConsent('new'));
$('#memberButton').addEventListener('click', () => openAuth('existing'));
$('#authCode').addEventListener('keydown', async event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await verifyEmailCode();
});
$('#profileAvatar').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const previewUrl = URL.createObjectURL(file);
  $('#avatarPreview').innerHTML = `<img src="${esc(previewUrl)}" alt="Selected profile photo">`;
});
$('#mediaFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  $('#fileLabel').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  try { await validateMedia(file); }
  catch (error) { toast(readableError(error), 5000); event.target.value = ''; $('#fileLabel').textContent = 'Add photo or clip'; }
});

$('#roomPhoto').addEventListener('change', event => {
  const file = event.target.files[0];
  const label = $('#roomPhotoName');
  if (!file) { label.textContent = ''; label.classList.add('hidden'); return; }
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
    event.target.value = ''; label.textContent = ''; label.classList.add('hidden');
    toast('Community chat accepts photos only—no video.'); return;
  }
  if (file.size > CONFIG.maxChatPhotoBytes) {
    event.target.value = ''; label.textContent = ''; label.classList.add('hidden');
    toast('Chat photos must be 10 MB or smaller.'); return;
  }
  label.textContent = file.name; label.classList.remove('hidden');
});

function fillKnownSpotLocation(spotInput, locationInput) {
  const name = spotInput.value.trim().toLowerCase();
  if (!name || locationInput.value.trim()) return;
  const matches = state.spots.filter(spot => spot.region_id === state.currentRegion?.id && spot.name.toLowerCase() === name);
  if (matches.length === 1 && matches[0].general_location) locationInput.value = matches[0].general_location;
}

$('#sessionSpot').addEventListener('change', () => fillKnownSpotLocation($('#sessionSpot'), $('#sessionLocation')));
$('#postSpot').addEventListener('change', () => fillKnownSpotLocation($('#postSpot'), $('#postLocation')));
['sessionTime', 'eventDate', 'eventStartClock', 'eventEndClock'].forEach(id => {
  $(`#${id}`).addEventListener('input', updateDateChoiceLabels);
  $(`#${id}`).addEventListener('change', updateDateChoiceLabels);
});
$('#sessionPersonInput').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ',') return;
  event.preventDefault();
  addSessionPerson();
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.session) offerInstallAfterAuth();
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  $('#installNudge').classList.add('hidden');
  $('#installSettingsRow').classList.add('hidden');
  closeSheet();
  toast('Salty was added to your Home Screen.');
});

applyIconTheme(localStorage.getItem('salty:theme') || localStorage.getItem('salty:icon-theme') || 'ink');
init().catch(error => { showWelcome(); toast(readableError(error), 6000); });
