/* global supabase */
'use strict';

if (location.hostname === 'app.saltyviewfinder.com') {
  location.replace(`https://community.saltyviewfinder.com${location.pathname}${location.search}${location.hash}`);
}

const CONFIG = Object.freeze({
  supabaseUrl: 'https://maihhnwrstewzapsvrec.supabase.co',
  supabaseKey: 'sb_publishable_YtVKcZqgPalUaYOHpoSV1w_86he5PDV',
  mediaBucket: 'salty-media',
  avatarBucket: 'salty-avatars',
  chatBucket: 'salty-chat',
  feedbackBucket: 'salty-feedback',
  marketplaceBucket: 'sodium-marketplace',
  maxUploadBytes: 50 * 1024 * 1024,
  maxStreamClipBytes: 1024 * 1024 * 1024,
  maxStreamClips: 5,
  maxAvatarBytes: 8 * 1024 * 1024,
  maxChatPhotoBytes: 10 * 1024 * 1024,
  maxFeedbackScreenshotBytes: 10 * 1024 * 1024,
  maxMarketplaceImageBytes: 8 * 1024 * 1024,
  maxClipSeconds: 90,
  emailOtpDigits: 8,
  vapidPublicKey: 'BA51gFp65k9tONl1nzm_DCnk9Xh6eAGHyeWi0RTvuSZQzRSnyAYJfUeW2WCi86IXnxIWcIFq7UOprumm3ssvMnI',
});
const APP_VERSION = '1.80';
const CONSENT_VERSION = '1.0';
const GUIDE_PATH = './docs/SODIUM_Quick_Start_Guide_V13.pdf';
const MASTER_GUIDE_PATH = './docs/SODIUM_Master_Instruction_Manual_V1.pdf';
const OVERVIEW_PATH = './docs/SODIUM_App_Overview_One_Pager_V9.png';
const SETUP_PATH = './docs/SODIUM_Setup_One_Pager_V2.png';
const PLAN_SURF_PATH = './docs/SODIUM_Plan_A_Surf_One_Pager_V1.png';
const GET_CLIPS_PATH = './docs/SODIUM_Get_Your_Clips_One_Pager_V1.png';
const GUIDE_PAGE_COUNT = 4;
const PENDING_AUTH_KEY = 'salty:pending-auth';
const INSTALL_DISMISSED_KEY = 'salty:install-dismissed';
const WHATS_NEW_SEEN_KEY = 'salty:whats-new-seen';
const NOTIFICATION_DEFAULTS = Object.freeze({
  master_enabled: true,
  new_sessions: true,
  new_stoke: true,
  direct_messages: true,
  events: true,
  session_updates: true,
  community_chat: false,
  clip_deliveries: true,
  new_members: true,
});

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const state = {
  session: null, profile: null, regions: [], spots: [], people: [], sessions: [], posts: [], events: [], perks: [], listings: [],
  regionMemberships: [],
  roomMessages: [], dmMessages: [], dmThreads: [], clipDeliveries: [], chatPhotoUrls: {}, activeDmMember: null,
  currentRegion: null, eventRegion: null, chatRegion: null, view: 'surfing', pendingInvite: '', authMode: 'new', realtime: null,
  pendingInviteRegion: '',
  preview: false, previewSessions: [], avatarUrls: {}, selectedMember: null,
  authEmail: '', pendingTokenHash: '', pendingTokenType: 'email',
  consentNext: 'new', sessionPeople: [], editingSessionId: null, editingPostId: null, editingEventId: null, editingPerkId: null, installPrompt: null,
  notificationPreferences: { ...NOTIFICATION_DEFAULTS }, notificationSubscription: null, pendingOpen: '', pendingSessionId: '', pendingSessionRegion: '', pendingEventId: '', pendingEventRegion: '', pendingDeliveryId: '',
  calendarMonth: null, calendarDate: '',
  previousView: 'surfing', issueOriginView: 'surfing', issueReports: [], issueScreenshotUrls: {}, issueFilter: 'open',
  marketplaceImageUrls: {}, editingListingId: null, selectedListingId: null, editingClipDeliveryId: null, inboxTab: 'messages', clipBox: 'sent', sharingSessionId: null,
  guestClipToken: '', guestClipDelivery: null, postPreviewUrl: '',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const messageBodyMarkup = (value = '') => esc(value)
  .replace(/https:\/\/community\.saltyviewfinder\.com\/[^\s<]+/g, url => `<a class="dm-shared-link" href="${url}" target="_self">Open shared surf</a>`)
  .replace(/\n/g, '<br>');
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const formatCount = number => new Intl.NumberFormat().format(number || 0);
const inviteFromUrl = () => new URLSearchParams(location.search).get('invite')?.trim() || '';
const inviteRegionFromUrl = () => new URLSearchParams(location.search).get('region')?.trim() || '';
const ICON_THEMES = new Set(['ink', 'amber', 'foam', 'ocean', 'pink']);
const THEME_COLORS = Object.freeze({
  ink: '#0A141C',
  amber: '#1B1208',
  foam: '#EAF2F5',
  ocean: '#071925',
  pink: '#F3A0C3',
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

function ensureThemeOptions() {
  const options = $('.icon-options');
  if (!options || $('[data-icon-theme="pink"]', options)) return;
  const button = document.createElement('button');
  button.dataset.iconTheme = 'pink';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-label', 'Use Pink theme');
  button.innerHTML = '<img src="./icon-pink.svg" alt=""><span>Pink</span>';
  options.append(button);
}

function applyIconTheme(theme = 'ink', announce = false) {
  ensureThemeOptions();
  const chosen = ICON_THEMES.has(theme) ? theme : 'ink';
  localStorage.setItem('salty:theme', chosen);
  localStorage.removeItem('salty:icon-theme');
  const iconPath = `./icon-${chosen}.svg`;
  document.documentElement.dataset.theme = chosen;
  $('#appThemeColor').content = THEME_COLORS[chosen];
  $('#appFavicon').href = iconPath;
  $('#appTouchIcon').href = './icon-180.png';
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
    toast(`${label} theme applied across Sodium.`, 3200);
  }
}

function showOnly(id) {
  ['boot', 'welcome', 'consentScreen', 'authScreen', 'verifyScreen', 'guestClipScreen', 'profileSetup', 'app'].forEach(name => $(`#${name}`).classList.toggle('hidden', name !== id));
}

function consentStorageKey() { return `salty:consent:${CONSENT_VERSION}`; }

function openConsent(next = 'new') {
  state.consentNext = next;
  const reviewing = next === 'settings';
  $('#consentAcceptButton').textContent = reviewing ? 'Back to Settings' : 'I understand — enter Sodium';
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
    return 'Sodium’s email service is cooling down after too many test emails. Wait about an hour, then request one fresh email.';
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
  state.guestClipToken = params.get('guest-clips')?.trim() || '';
  if (state.guestClipToken) {
    await loadGuestClipDelivery();
    return;
  }
  if ('serviceWorker' in navigator && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      await registration.update();
    } catch (error) { console.warn('Service worker registration deferred:', error); }
  }
  state.pendingInvite = inviteFromUrl() || localStorage.getItem('salty:invite') || '';
  state.pendingInviteRegion = inviteRegionFromUrl() || localStorage.getItem('salty:invite-region') || '';
  state.pendingOpen = params.get('open') || '';
  state.pendingSessionId = params.get('session')?.trim() || '';
  state.pendingSessionRegion = params.get('region')?.trim() || '';
  state.pendingEventId = params.get('event')?.trim() || '';
  state.pendingDeliveryId = params.get('delivery')?.trim() || '';
  state.pendingEventRegion = params.get('region')?.trim() || '';
  if (state.pendingInvite) localStorage.setItem('salty:invite', state.pendingInvite);
  if (state.pendingInviteRegion) localStorage.setItem('salty:invite-region', state.pendingInviteRegion);
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
  state.regionMemberships = [{ user_id:userId, region_id:regionId, is_home:true, notifications_enabled:true }];
  state.currentRegion = state.regions[0];
  state.eventRegion = state.currentRegion;
  state.chatRegion = state.currentRegion;
  state.people = [state.profile, { id: 'jonah', name: 'Jonah Reyes', nickname:'Jo', home_region:regionId, sponsors:['Snake Eyes'], onboarding_complete:true }, { id: 'mateo', name: 'Mateo Karras', nickname:null, home_region:regionId, sponsors:[], onboarding_complete:true }];
  state.spots = [{ id: 'malibu', name: 'Malibu', general_location:'Malibu', region_id: regionId }, { id: 'lowers', name: 'Lowers', general_location:'San Clemente', region_id: regionId }];
  state.previewSessions = [
    { id:'live-mine', author:userId, initiator_user:null, initiator_name:'Steve', region_id:regionId, author_role:'film', participant_names:['Steve'], when_label:'Now', surf_time:new Date().toISOString(), wants_filmer:false, note:'clean little window right now', spot:{name:'C Street',general_location:'Ventura'}, author_profile:{name:'Cyrus'}, initiator_profile:null, session_rsvps:[] },
    { id:'mine', author:userId, region_id:regionId, author_role:'surf', participant_names:['Sam'], when_label:'Scheduled', surf_time:new Date(Date.now() + 86400000).toISOString(), wants_filmer:false, note:'morning glass before the wind', spot:{name:"Old Man's",general_location:'San Onofre'}, author_profile:{name:'Cyrus'}, session_rsvps:[{id:'r1',user_id:'jonah',role:'surf',profile:{name:'Jonah'}}]},
    { id:'mateo-surf', author:'mateo', region_id:regionId, author_role:'film', participant_names:['Sam'], when_label:'Scheduled', surf_time:new Date(Date.now() + 2 * 86400000).toISOString(), wants_filmer:false, note:'filming the afternoon window', spot:{name:'First Point',general_location:'Malibu'}, author_profile:{name:'Mateo'}, session_rsvps:[] },
    { id:'crew', author:'jonah', region_id:regionId, author_role:'surf', participant_names:[], when_label:'Scheduled', surf_time:new Date(Date.now() + 3 * 86400000).toISOString(), wants_filmer:true, note:'sunrise window', spot:{name:'Lowers',general_location:'San Clemente'}, author_profile:{name:'Jonah'}, session_rsvps:[] },
    { id:'past-surf', author:'jonah', region_id:regionId, author_role:'surf', participant_names:['Mateo'], when_label:'Now', surf_time:new Date(Date.now() - 2 * 86400000).toISOString(), wants_filmer:false, note:'clean little afternoon window', status:'ended', ended_at:new Date(Date.now() - 46 * 3600000).toISOString(), spot:{name:'C Street',general_location:'Ventura'}, author_profile:{name:'Jonah'}, session_rsvps:[] },
  ];
  state.sessions = state.previewSessions;
  state.posts = [];
  const previewEventStart = new Date(Date.now() + 5 * 86400000);
  previewEventStart.setHours(18, 30, 0, 0);
  state.events = [
    { id:'preview-event', author:userId, region_id:regionId, title:'Friday Night Surf Film', start_time:previewEventStart.toISOString(), end_time:new Date(previewEventStart.getTime() + 2 * 3600000).toISOString(), venue_name:'Hobie Surf Shop', location_text:'Dana Point', description:'A surf film, tacos, and the crew.', event_rsvps:[{ user_id:userId, profile:state.profile }, { user_id:'jonah', profile:state.people[1] }] },
    { id:'past-event', author:userId, region_id:regionId, title:'Hobie Movie Night', start_time:new Date(Date.now() - 28 * 3600000).toISOString(), end_time:new Date(Date.now() - 26 * 3600000).toISOString(), venue_name:'Hobie Surf Shop', location_text:'Dana Point', description:'Good flick and a full house.', event_rsvps:[{ user_id:userId, profile:state.profile }] },
  ];
  state.perks = [
    { id:'sv', name:'Saltyviewfinder Store Discount', brand_name:'Saltyviewfinder', offer_text:'Sodium member discount', description:'Sodium merch, prints, and more.', store_url:'https://saltyviewfinder.com', active:true },
    { id:'wata', name:'WATA Store Discount', brand_name:'WATA', offer_text:'Sodium member discount', description:'Support WATA and save on store gear.', store_url:'https://cleanwata.org', active:true },
  ];
  state.listings = [
    { id:'market-saltyviewfinder', owner_id:userId, title:'Saltyviewfinder Store', brand_name:'Saltyviewfinder', description:'Photography, prints, and projects from the crew.', category:'Photography & Film', image_path:null, external_url:'https://saltyviewfinder.com', social_url:null, location:'California', has_member_perk:true, perk_description:'Sodium member discount.', discount_code:null, status:'approved', featured:true, owner_profile:state.profile },
    { id:'market-wata', owner_id:userId, title:'Water Access To All Store', brand_name:'WATA', description:'Support Water Access To All and its clean-water work.', category:'Clothing & Gear', image_path:null, external_url:'https://cleanwata.org', social_url:null, location:null, has_member_perk:true, perk_description:'Sodium member discount.', discount_code:null, status:'approved', featured:false, owner_profile:state.profile },
  ];
  state.roomMessages = [
    { id:'chat-1', region_id:regionId, author:'jonah', body:'Waist high at first point. Crowd is pretty mellow.', created_at:new Date(Date.now() - 22 * 60000).toISOString() },
    { id:'chat-2', region_id:regionId, author:userId, body:'I can film for an hour around 7.', created_at:new Date(Date.now() - 8 * 60000).toISOString() },
  ];
  state.dmMessages = [{ id:'dm-1', sender:'jonah', recipient:userId, body:'Want to hit Lowers Friday?', created_at:new Date(Date.now() - 35 * 60000).toISOString(), read_at:null }];
  state.dmThreads = [{ memberId:'jonah', message:state.dmMessages[0] }];
  state.clipDeliveries = [
    { id:'clips-guest', sender:userId, recipient:null, recipient_name:'Heston', subject_names:['Heston'], session_id:'live-mine', provider:'google_drive', folder_url:'https://drive.google.com/', expected_count:18, uploaded_count:4, tracking_mode:'manual', status:'uploading', note:'Today at C Street.', created_at:new Date(Date.now() - 20 * 60000).toISOString(), updated_at:new Date(Date.now() - 4 * 60000).toISOString(), sender_profile:state.profile, recipient_profile:null, session:state.previewSessions[0], clip_delivery_messages:[{id:'gm1',sender_user:null,guest_name:'Heston',body:'Did the last right make it in?',created_at:new Date().toISOString()}] },
    { id:'clips-heston', sender:userId, recipient:'jonah', subject_names:['Heston'], session_id:'past-surf', provider:'google_drive', folder_url:'https://drive.google.com/', expected_count:24, uploaded_count:7, tracking_mode:'manual', status:'uploading', note:'Raw clips from C Street.', created_at:new Date(Date.now() - 55 * 60000).toISOString(), updated_at:new Date(Date.now() - 12 * 60000).toISOString(), sender_profile:state.profile, recipient_profile:state.people[1], session:state.previewSessions[4] },
    { id:'clips-steve', sender:'mateo', recipient:userId, subject_names:['Cyrus'], session_id:'mateo-surf', provider:'dropbox', folder_url:'https://dropbox.com/', expected_count:11, uploaded_count:11, tracking_mode:'manual', status:'ready', note:null, ready_at:new Date(Date.now() - 20 * 60000).toISOString(), created_at:new Date(Date.now() - 2 * 3600000).toISOString(), updated_at:new Date(Date.now() - 20 * 60000).toISOString(), sender_profile:state.people[2], recipient_profile:state.profile, session:state.previewSessions[2] },
  ];
  state.issueReports = [
    { id:'issue-1', reporter:'jonah', reporter_profile:{ id:'jonah', name:'Jonah' }, category:'broken', description:'The Join surf button looked pressed, but my name did not appear until I reopened Sodium.', expected_behavior:'My name should show under Surfers immediately.', screen:'Sessions', app_version:APP_VERSION, user_agent:'iPhone · Mobile Safari', status:'new', admin_notes:'', created_at:new Date(Date.now() - 48 * 60000).toISOString() },
    { id:'issue-2', reporter:'mateo', reporter_profile:{ id:'mateo', name:'Mateo' }, category:'suggestion', description:'Could the event card make the address easier to tap?', expected_behavior:null, screen:'Events', app_version:APP_VERSION, user_agent:'iPhone · Home Screen app', status:'reviewing', admin_notes:'Check the map target size.', created_at:new Date(Date.now() - 26 * 3600000).toISOString() },
  ];
  renderChrome(); renderSessions(); renderPosts(); renderEvents(); renderPerks(); renderMarketplace(); renderPreviewProfile(); renderMembers(); renderRoomMessages(); renderDmInbox(); renderClipDeliveries(); renderIssueReports(); showOnly('app');
  $('#appPreviewBanner').classList.remove('hidden');
}

function renderPreviewProfile() {
  $('#profileView').innerHTML = profileMarkup(state.profile, { points:45, streak:3, stoke:4, surfed:12, filmed:7, organized:5, locations:2, own:true });
  $('#streakBadge b').textContent = '3';
}

function showWelcome() {
  if (isStandalone()) {
    openAuth('existing');
    $('#authSubtitle').textContent = 'This saved app is not signed in yet. Verify once on this phone and it will open straight into Sodium after that.';
    return;
  }
  showOnly('welcome');
  const hasInvite = Boolean(state.pendingInvite);
  $('#enterButton').classList.toggle('hidden', !hasInvite);
  $('#inviteInstruction').classList.toggle('hidden', hasInvite);
  const intent = state.pendingOpen;
  const copy = intent === 'plan-surf'
    ? ['Plan the surf', 'Your friend invited you to set the spot, time, and crew. Join Sodium and the session form opens next.']
    : intent === 'claim-session'
      ? ['Claim your surf', 'Join Sodium to attach this session—and its organizer credit—to your real profile.']
      : intent === 'claim-delivery'
        ? ['Your clips are waiting', 'Join Sodium to open the clip delivery your friend prepared for you.']
        : ['Invite-only, on purpose', 'Someone you surf with brought you in. No strangers, no algorithm—just surfers who actually ride together.'];
  $('.invite-note h2').textContent = copy[0];
  $('.invite-note p').textContent = copy[1];
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
  const intentCopy = state.pendingOpen === 'plan-surf' ? 'Join, then share the surf so the crew can join or film.'
    : state.pendingOpen === 'claim-session' ? 'Join to claim this surf and its organizer credit.'
      : state.pendingOpen === 'claim-delivery' ? 'Join to open the clips your friend sent you.' : '';
  $('#authSubtitle').textContent = isNew ? (intentCopy || 'Continue with Google or use one email code. Then finish your profile and stay signed in.') : 'Continue with Google, or use the email connected to your Sodium profile. You only need this on a new device or after signing out.';
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
  message.innerHTML = `<b>Use the newest code sent to ${esc(pending.email)}</b><br>Enter it below without leaving Sodium. Every new email replaces the older code.`;
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
  if (state.pendingSessionId) redirect.searchParams.set('session', state.pendingSessionId);
  if (state.pendingSessionRegion) redirect.searchParams.set('region', state.pendingSessionRegion);
  if (state.pendingEventId) redirect.searchParams.set('event', state.pendingEventId);
  if (state.pendingDeliveryId) redirect.searchParams.set('delivery', state.pendingDeliveryId);
  if (state.pendingEventRegion) redirect.searchParams.set('region', state.pendingEventRegion);
  if (state.pendingOpen) redirect.searchParams.set('open', state.pendingOpen);
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
  message.innerHTML = `<b>Check ${esc(email)}</b><br>Stay in Sodium and enter the full ${CONFIG.emailOtpDigits}-digit code from the newest email. Every new email replaces the older code.`;
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
  if (state.pendingSessionId) redirect.searchParams.set('session', state.pendingSessionId);
  if (state.pendingSessionRegion) redirect.searchParams.set('region', state.pendingSessionRegion);
  if (state.pendingEventId) redirect.searchParams.set('event', state.pendingEventId);
  if (state.pendingDeliveryId) redirect.searchParams.set('delivery', state.pendingDeliveryId);
  if (state.pendingEventRegion) redirect.searchParams.set('region', state.pendingEventRegion);
  if (state.pendingOpen) redirect.searchParams.set('open', state.pendingOpen);
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
    message.innerHTML = `<b>Sodium could not verify that code.</b><br>${reason}<br>Request one fresh email, stay on this screen, and use only its newest code.`;
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
    message.textContent = 'This sign-in link is incomplete. Go back to Sodium and request a new email.';
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
    message.innerHTML = `${esc(readableError(error))}<br>Return to Sodium and request a fresh email, or use the full ${CONFIG.emailOtpDigits}-digit code from that email.`;
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
  let { data: profile, error } = await db.rpc('get_my_profile');
  if (error) { toast(readableError(error)); showWelcome(); return; }

  if (state.pendingInvite) {
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
    profile = redeemed.data || profile;
    localStorage.removeItem('salty:invite');
  }

  if (!profile) {
    toast('This account is not in the community. Open a valid invite link first.', 6000);
    await db.auth.signOut();
    showWelcome();
    return;
  }

  // Existing members can open invitation-backed session links without leaving
  // a stale invite on this device after the shared surf has opened.
  state.pendingInvite = '';
  localStorage.removeItem('salty:invite');

  state.profile = profile;
  if (!profile.onboarding_complete) {
    await showProfileSetup();
    return;
  }
  if (state.pendingInviteRegion) {
    const joined = await db.rpc('join_location', { location_id:state.pendingInviteRegion });
    if (joined.error) console.warn('Invite location join deferred:', joined.error);
    else {
      state.pendingInviteRegion = '';
      localStorage.removeItem('salty:invite-region');
    }
  }
  await loadApp();
  showOnly('app');
  clearPendingAuth();
  cleanAuthUrl();
  offerInstallAfterAuth();
  revealSharedTarget();
  showWhatsNew();
}

async function loadApp() {
  const [regionsResult, spotsResult, peopleResult, membershipsResult] = await Promise.all([
    db.from('regions').select('*').order('name'),
    db.from('spots').select('*').order('name'),
    db.from('profiles').select('id,name,nickname,home_region,sponsors,social_url,avatar_path,onboarding_complete').eq('onboarding_complete', true).order('name'),
    db.from('region_memberships').select('*').eq('user_id', state.profile.id),
  ]);
  const membershipsUnavailable = membershipsResult.error && /region_memberships/i.test(membershipsResult.error.message || '');
  const firstError = regionsResult.error || spotsResult.error || peopleResult.error || (membershipsUnavailable ? null : membershipsResult.error);
  if (firstError) throw firstError;
  state.regions = (regionsResult.data || []).filter(region => region.is_active !== false);
  state.spots = spotsResult.data;
  state.people = peopleResult.data;
  state.regionMemberships = membershipsUnavailable
    ? [{ user_id:state.profile.id, region_id:state.profile.home_region, is_home:true, notifications_enabled:true }]
    : membershipsResult.data || [];
  const lastRegion = localStorage.getItem('salty:last-location');
  const sharedRegionId = state.pendingSessionId ? state.pendingSessionRegion : state.pendingEventRegion;
  const sharedRegion = (state.pendingSessionId || state.pendingEventId)
    ? state.regions.find(region => region.id === sharedRegionId)
    : null;
  state.currentRegion = sharedRegion
    || state.regions.find(region => region.id === lastRegion)
    || state.regions.find(region => region.id === state.profile.home_region)
    || state.regions.find(region => region.name === 'California') || state.regions[0];
  state.eventRegion = state.currentRegion;
  state.chatRegion = state.currentRegion;
  await loadAvatarUrls();
  renderChrome();
  await Promise.all([loadSessions(), loadPosts(), loadEvents(), loadPerks(), loadListings(), loadRoomMessages(), loadDmInbox(), loadClipDeliveries(), loadNotificationPreferences()]);
  await renderProfile();
  renderMembers();
  if (state.profile?.is_admin) await loadIssueReports({ silent:true });
  subscribeRealtime();
  if (['surfing', 'feed', 'chat', 'events', 'dms', 'clips', 'members'].includes(state.pendingOpen)) {
    if (state.pendingOpen === 'clips') {
      state.inboxTab = 'clips';
      setView('dms');
      renderInboxTabs();
      revealSharedDelivery();
    } else setView(state.pendingOpen);
    state.pendingOpen = '';
  }
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

function showWhatsNew() {
  if (localStorage.getItem(WHATS_NEW_SEEN_KEY) === APP_VERSION) return;
  window.setTimeout(() => $('#whatsNewCard')?.classList.remove('hidden'), 650);
}

function closeWhatsNew() {
  localStorage.setItem(WHATS_NEW_SEEN_KEY, APP_VERSION);
  $('#whatsNewCard')?.classList.add('hidden');
}

function openMasterGuide() {
  window.open(new URL(MASTER_GUIDE_PATH, location.href).href, '_blank', 'noopener');
}

function openNotificationSettings() {
  closeWhatsNew();
  setView('settings');
  window.setTimeout(() => $('#notificationSettings')?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function pushIsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function pushRegistration(create = false) {
  if (!pushIsSupported()) return null;
  let registration = await navigator.serviceWorker.getRegistration('./');
  if (!registration && create) registration = await navigator.serviceWorker.register('./sw.js');
  return registration;
}

async function loadNotificationPreferences() {
  if (!state.profile || state.preview) return;
  const result = await db.from('notification_preferences').select('*').eq('user_id', state.profile.id).maybeSingle();
  if (result.error) {
    console.warn('Notification preferences are not ready:', result.error.message);
    return;
  }
  state.notificationPreferences = { ...NOTIFICATION_DEFAULTS, ...(result.data || {}) };
  await renderNotificationSettings();
}

async function currentPushSubscription() {
  const registration = await pushRegistration();
  state.notificationSubscription = registration ? await registration.pushManager.getSubscription() : null;
  return state.notificationSubscription;
}

async function renderNotificationSettings() {
  const card = $('#notificationSettings');
  if (!card) return;
  if (!$('#notificationTestButton')) {
    const testButton = document.createElement('button');
    testButton.id = 'notificationTestButton';
    testButton.className = 'notification-test-button';
    testButton.dataset.action = 'test-notification';
    testButton.innerHTML = '<svg><use href="#i-send"/></svg>Send me a test notification';
    card.insertBefore(testButton, $('#notificationChoices'));
  }
  const preferences = { ...NOTIFICATION_DEFAULTS, ...(state.notificationPreferences || {}) };
  $$('[data-notification-pref]').forEach(input => { input.checked = Boolean(preferences[input.dataset.notificationPref]); });
  const supported = pushIsSupported();
  const subscription = supported ? await currentPushSubscription() : null;
  const button = $('#notificationDeviceButton');
  const status = $('#notificationStatus');
  const permission = supported ? Notification.permission : 'unsupported';
  if (!supported) {
    button.disabled = true;
    button.textContent = 'Not supported on this device';
    status.textContent = 'This browser cannot receive web push notifications.';
  } else if (isIOSDevice() && !isStandalone()) {
    button.disabled = false;
    button.textContent = 'Add Sodium to Home Screen first';
    status.textContent = 'On iPhone, notifications work from the installed Home Screen app.';
  } else if (permission === 'denied') {
    button.disabled = true;
    button.textContent = 'Notifications are blocked';
    status.textContent = 'Open iPhone Settings → Notifications → Sodium to allow them again.';
  } else if (subscription) {
    button.disabled = false;
    button.textContent = 'Turn off on this device';
    status.textContent = preferences.master_enabled ? 'Notifications are on for this device.' : 'All Sodium notifications are paused.';
  } else {
    button.disabled = false;
    button.textContent = 'Enable notifications on this device';
    status.textContent = 'Get useful crew updates without needing to keep Sodium open.';
  }
  $$('#notificationChoices input').forEach(input => { input.disabled = !supported; });
  $('#notificationMaster').disabled = !subscription;
  $('#notificationMaster').checked = Boolean(subscription && preferences.master_enabled);
  $('#notificationTestButton').disabled = !subscription || !preferences.master_enabled;
}

async function saveNotificationPreference(field, enabled) {
  if (!state.profile || !(field in NOTIFICATION_DEFAULTS)) return;
  const next = { ...NOTIFICATION_DEFAULTS, ...(state.notificationPreferences || {}), [field]:enabled };
  const result = await db.from('notification_preferences').upsert({
    user_id: state.profile.id,
    master_enabled: next.master_enabled,
    new_sessions: next.new_sessions,
    new_stoke: next.new_stoke,
    direct_messages: next.direct_messages,
    events: next.events,
    session_updates: next.session_updates,
    community_chat: next.community_chat,
    clip_deliveries: next.clip_deliveries,
    new_members: next.new_members,
    updated_at: new Date().toISOString(),
  }, { onConflict:'user_id' }).select().single();
  if (result.error) throw result.error;
  state.notificationPreferences = result.data;
}

async function enablePushNotifications() {
  if (!pushIsSupported()) throw new Error('This browser does not support notifications.');
  if (isIOSDevice() && !isStandalone()) {
    showInstallInstructions();
    throw new Error('Add Sodium to your Home Screen, open it there, then enable notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can change this later in device settings.');
  const registration = await pushRegistration(true);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(CONFIG.vapidPublicKey),
    });
  }
  const serialized = subscription.toJSON();
  const result = await db.from('push_subscriptions').upsert({
    user_id: state.profile.id,
    endpoint: subscription.endpoint,
    p256dh: serialized.keys?.p256dh,
    auth: serialized.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 500),
    updated_at: new Date().toISOString(),
  }, { onConflict:'endpoint' });
  if (result.error) {
    await subscription.unsubscribe();
    throw result.error;
  }
  state.notificationSubscription = subscription;
  await saveNotificationPreference('master_enabled', true);
  await renderNotificationSettings();
  toast('Notifications are on for this device.');
}

async function disablePushNotifications(announce = true) {
  const subscription = await currentPushSubscription();
  if (subscription && state.profile) {
    const result = await db.from('push_subscriptions').delete().eq('user_id', state.profile.id).eq('endpoint', subscription.endpoint);
    if (result.error) throw result.error;
    await subscription.unsubscribe();
  }
  state.notificationSubscription = null;
  await renderNotificationSettings();
  if (announce) toast('Notifications are off on this device.');
}

async function togglePushDevice() {
  const button = $('#notificationDeviceButton');
  button.disabled = true;
  try {
    const subscription = await currentPushSubscription();
    if (subscription) await disablePushNotifications();
    else await enablePushNotifications();
  } catch (error) {
    toast(readableError(error), 6000);
    await renderNotificationSettings();
  }
}

async function sendTestNotification() {
  const subscription = await currentPushSubscription();
  if (!subscription) {
    toast('Enable notifications on this device first.', 5000);
    return;
  }
  const button = $('#notificationTestButton');
  button.disabled = true;
  try {
    const result = await db.rpc('send_test_notification');
    if (result.error) throw result.error;
    toast('Test sent. Lock your phone or leave Sodium for the clearest test.', 6000);
  } catch (error) {
    toast(readableError(error), 6000);
  } finally {
    button.disabled = false;
  }
}

function showInstallInstructions() {
  if (isStandalone()) {
    toast('Sodium is already installed on this phone.');
    return;
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const steps = ios
    ? ['Stay on this signed-in Sodium screen.', 'Tap the Share button in your browser.', 'Choose “Add to Home Screen,” then tap “Add.”', 'Open Sodium from the new Home Screen icon.']
    : ['Stay on this signed-in Sodium screen.', 'Open your browser menu and choose “Install app” or “Add to Home Screen.”', 'Confirm the installation, then open Sodium from its icon.'];
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
  state.regions = (regionsResult.data || []).filter(region => region.is_active !== false);
  $('#setupRegion').innerHTML = state.regions.map(region => `<option value="${region.id}">${esc(region.name)}</option>`).join('');
  $('#setupName').value = state.profile.name || '';
  $('#setupNickname').value = state.profile.nickname || '';
  $('#setupPhone').value = state.profile.phone || '';
  const invitedRegion = state.regions.find(region => region.id === state.pendingInviteRegion)?.id;
  $('#setupRegion').value = invitedRegion || state.profile.home_region || state.regions[0]?.id || '';
  $('#setupSponsors').value = (state.profile.sponsors || []).join(', ');
  $('#setupSocial').value = state.profile.social_url || '';
  $('#profileAvatar').required = !state.profile.avatar_path;
  $('#profileSetupTitle').textContent = state.profile.onboarding_complete ? 'Edit your profile' : 'Build your profile';
  $('#profileSetupBack').classList.toggle('hidden', !state.profile.onboarding_complete);
  $('#profileSubmit').textContent = state.profile.onboarding_complete ? 'Save changes' : 'Save profile and enter Sodium';
  $('#avatarPreview').textContent = state.profile.avatar_path ? 'CHANGE PHOTO' : 'ADD PHOTO';
  if (state.profile.avatar_path) {
    const signed = await db.storage.from(CONFIG.avatarBucket).createSignedUrl(state.profile.avatar_path, 3600);
    if (!signed.error) $('#avatarPreview').innerHTML = `<img src="${esc(signed.data.signedUrl)}" alt="Current profile photo">`;
  }
  showOnly('profileSetup');
}

async function refreshLocationMemberships() {
  const result = await db.from('region_memberships').select('*').eq('user_id', state.profile.id);
  if (result.error) throw result.error;
  state.regionMemberships = result.data || [];
}

function joinedLocationIds() {
  return new Set(state.regionMemberships.map(membership => membership.region_id));
}

function isLocationJoined(regionId) {
  return joinedLocationIds().has(regionId) || state.profile?.home_region === regionId;
}

async function joinLocation(region, announce = true) {
  if (!region || isLocationJoined(region.id)) return;
  if (state.preview) {
    state.regionMemberships.push({ user_id:state.profile.id, region_id:region.id, is_home:false, notifications_enabled:true });
    return;
  }
  const result = await db.rpc('join_location', { location_id:region.id });
  if (result.error) throw result.error;
  await refreshLocationMemberships();
  if (announce) toast(`${region.name} joined. You’ll now see its sessions, chat, events, and notifications.`);
}

async function saveLocation(event) {
  event.preventDefault();
  const submit = $('button[type="submit"]', event.currentTarget);
  submit.disabled = true;
  try {
    const result = await db.rpc('create_or_join_location', {
      location_name:$('#newLocationName').value.trim(),
      location_scope:$('#locationScope').value,
    });
    if (result.error) throw result.error;
    const region = result.data;
    const existingIndex = state.regions.findIndex(item => item.id === region.id);
    if (existingIndex >= 0) state.regions[existingIndex] = region;
    else state.regions.push(region);
    state.regions.sort((a, b) => a.name.localeCompare(b.name));
    await refreshLocationMemberships();
    const setupRegion = $('#setupRegion');
    setupRegion.innerHTML = state.regions.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
    setupRegion.value = region.id;
    if (state.profile?.onboarding_complete) {
      state.currentRegion = region; state.eventRegion = region; state.chatRegion = region;
      localStorage.setItem('salty:last-location', region.id);
      renderChrome();
      await Promise.all([loadSessions(), loadEvents(), loadRoomMessages()]);
    }
    event.currentTarget.reset(); closeSheet();
    toast(`${region.name} is now part of Sodium.`);
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; }
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
    const result = await db.from('profiles').update(updates).eq('id', state.profile.id);
    if (result.error) throw result.error;
    const refreshed = await db.rpc('get_my_profile');
    if (refreshed.error || !refreshed.data) throw refreshed.error || new Error('Could not reload your profile.');
    state.profile = refreshed.data;
    if (state.pendingInviteRegion) {
      const joined = await db.rpc('join_location', { location_id:state.pendingInviteRegion });
      if (!joined.error) {
        state.pendingInviteRegion = '';
        localStorage.removeItem('salty:invite-region');
      }
    }
    $('#profileForm').reset();
    await loadApp(); showOnly('app'); cleanAuthUrl(); offerInstallAfterAuth(); revealSharedTarget(); toast('Profile saved. Welcome to Sodium.');
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; submit.textContent = state.profile.onboarding_complete ? 'Save changes' : 'Save profile and enter Sodium'; }
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
  ['surfing', 'i-surf', 'Sessions'], ['feed', 'i-wave', 'Stoke'], ['chat', 'i-chat', 'Chat'],
  ['events', 'i-calendar', 'Events'], ['you', 'i-user', 'Profile'],
];

function activeRegions() {
  return state.regions.filter(region => region.is_active !== false);
}

function renderNav(target) {
  target.innerHTML = navItems.map(([view, icon, label]) => `<button data-view="${view}" class="${state.view === view ? 'active' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${icon}"/></svg>${label}</button>`).join('');
}

function renderChrome() {
  renderNav($('#mobileNav')); renderNav($('#desktopNav'));
  $('#locationName').textContent = state.currentRegion.name;
  const visibleRegions = activeRegions();
  const joined = joinedLocationIds();
  $('#regionMenu').innerHTML = visibleRegions.map(region => {
    const status = region.id === state.profile.home_region ? 'HOME' : joined.has(region.id) ? 'JOINED' : 'EXPLORE';
    return `<button data-region="${region.id}" class="${region.id === state.currentRegion.id ? 'active' : ''}">${esc(region.name)} <small>${status}</small></button>`;
  }).join('') + '<button class="add-location" data-action="open-location">+ Add a new location</button>';
  const regionSpots = state.spots.filter(spot => spot.region_id === state.currentRegion.id);
  $('#spotsList').innerHTML = regionSpots.map(spot => `<option value="${esc(spot.name)}"></option>`).join('');
  $('#locationsList').innerHTML = [...new Set(regionSpots.map(spot => spot.general_location).filter(Boolean))].sort().map(location => `<option value="${esc(location)}"></option>`).join('');
  $('#peopleList').innerHTML = state.people.map(person => `<option value="${esc(person.name)}"></option>`).join('');
  $('#drawerProfile').innerHTML = `${avatarMarkup(state.profile)}<div><h3>${esc(state.profile.name)}</h3><p>${esc(state.currentRegion.name)} · Sodium Crew</p></div>`;
  $('#betaFeedbackMenu')?.classList.toggle('hidden', !state.profile?.is_admin);
  renderEventRegions();
  renderChatRegions();
  renderDmPeople();
}

function setView(view) {
  if (view === 'beta-feedback' && !state.profile?.is_admin) {
    toast('Only Sodium admins can view beta feedback.');
    return;
  }
  if (view !== state.view) state.previousView = state.view;
  state.view = view;
  $$('.app-view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  $$('.primary-nav button,.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const coreView = navItems.some(item => item[0] === view);
  const createOptions = {
    surfing: { action:'open-session', label:'New session' },
    feed: { action:'open-post', label:'Add photo or clip' },
    events: { action:'open-event', label:'Add event' },
  };
  const createOption = createOptions[view];
  const createFab = $('#createFab');
  createFab.classList.toggle('hidden', !createOption);
  if (createOption) {
    createFab.dataset.action = createOption.action;
    createFab.dataset.createView = view;
    createFab.setAttribute('aria-label', createOption.label);
    createFab.title = createOption.label;
    $('span', createFab).textContent = createOption.label;
  }
  $('#locationPill').classList.toggle('hidden', view !== 'surfing');
  if (!coreView) $$('.primary-nav button,.bottom-nav button').forEach(button => button.classList.remove('active'));
  closeDrawer();
  scrollTo({ top: 0, behavior: 'smooth' });
  if (!state.preview && view === 'chat') loadRoomMessages();
  if (!state.preview && view === 'dms') {
    loadDmInbox();
    loadClipDeliveries();
  }
  if (view === 'dms') renderInboxTabs();
  // Stoke stays a normal feed. Re-sign private media whenever it is opened so
  // a long-running home-screen session never depends on an expired raw URL.
  if (!state.preview && view === 'feed') loadPosts();
  if (!state.preview && view === 'marketplace') loadListings();
  if (view === 'settings') renderNotificationSettings();
  if (!state.preview && view === 'beta-feedback') loadIssueReports();
}

async function loadSessions() {
  const result = await db.from('sessions')
    .select('*,spot:spots(*),author_profile:profiles!sessions_author_fkey(id,name),initiator_profile:profiles!sessions_initiator_user_fkey(id,name,avatar_path),session_rsvps(id,user_id,role,profile:profiles!session_rsvps_user_id_fkey(id,name))')
    .eq('region_id', state.currentRegion.id).in('status', ['active', 'ended', 'archived']).order('created_at', { ascending: false }).limit(100);
  if (result.error) { toast(readableError(result.error)); return; }
  state.sessions = result.data || [];
  renderSessions();
  if (state.view === 'calendar') renderCalendar();
}

function revealSharedSession() {
  if (!state.pendingSessionId) return;
  const sharedId = state.pendingSessionId;
  state.pendingSessionId = '';
  state.pendingSessionRegion = '';
  state.pendingOpen = '';
  setView('surfing');
  const session = state.sessions.find(item => item.id === sharedId);
  const card = [...document.querySelectorAll('[data-session-id]')].find(item => item.dataset.sessionId === sharedId);
  if (!session || !card) {
    toast('That shared surf has ended or is no longer available.', 5000);
    return;
  }
  const archive = card.closest('details');
  if (archive) archive.open = true;
  card.classList.add('shared-target');
  requestAnimationFrame(() => card.scrollIntoView({ behavior:'smooth', block:'center' }));
  setTimeout(() => card.classList.remove('shared-target'), 3600);
  toast(`Shared surf opened: ${session.spot?.name || 'session'}.`);
}

function revealSharedEvent() {
  if (!state.pendingEventId) return;
  const sharedId = state.pendingEventId;
  state.pendingEventId = '';
  state.pendingEventRegion = '';
  state.pendingOpen = '';
  setView('events');
  const item = state.events.find(event => event.id === sharedId);
  const card = [...document.querySelectorAll('[data-event-id]')].find(event => event.dataset.eventId === sharedId);
  if (!item || !card) {
    toast('That shared event has ended or is no longer available.', 5000);
    return;
  }
  const archive = card.closest('details');
  if (archive) archive.open = true;
  card.classList.add('shared-target');
  requestAnimationFrame(() => card.scrollIntoView({ behavior:'smooth', block:'center' }));
  setTimeout(() => card.classList.remove('shared-target'), 3600);
  toast(`Shared event opened: ${item.title}.`);
}

function revealSharedTarget() {
  if (state.pendingOpen === 'plan-surf') {
    state.pendingOpen = '';
    setView('surfing');
    openSessionComposer();
    toast('Add the surf you’re planning. You’ll receive the organizer credit.');
  } else if (state.pendingDeliveryId) {
    state.inboxTab = 'clips';
    setView('dms');
    renderInboxTabs();
    revealSharedDelivery();
  } else if (state.pendingEventId) revealSharedEvent();
  else revealSharedSession();
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
    const profile = memberById(message.author) || { id:message.author, name:'Sodium member' };
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
    await joinLocation(state.chatRegion, false);
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
    const region = state.regions.find(item => item.id === person.home_region)?.name || 'Sodium Crew';
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
    const person = memberById(thread.memberId) || { id:thread.memberId, name:'Sodium member' };
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
  renderDmClipDeliveries();
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
    return `<article class="message-row ${own ? 'own' : ''}" style="--speaker-hue:${speakerHue(message.sender)}">${own ? '' : avatarMarkup(state.activeDmMember, 'message-avatar')}<div class="message-stack"><div class="message-meta"><b>${own ? 'You' : esc(state.activeDmMember.name)}</b><time>${esc(messageTime(message.created_at))}</time></div><div class="message-bubble"><p>${messageBodyMarkup(message.body)}</p></div></div></article>`;
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

function clipProviderFromUrl(value = '') {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === 'drive.google.com' || hostname.endsWith('.drive.google.com')) return 'google_drive';
    if (hostname === 'dropbox.com' || hostname.endsWith('.dropbox.com')) return 'dropbox';
    if (hostname === 'icloud.com' || hostname.endsWith('.icloud.com')) return 'icloud';
  } catch (_error) { /* The form's URL validation handles invalid input. */ }
  return 'other';
}

function clipProviderLabel(provider) {
  return ({ google_drive:'Google Drive', dropbox:'Dropbox', icloud:'iCloud', other:'Clip link' })[provider] || 'Clip link';
}

async function loadGuestClipDelivery() {
  showOnly('guestClipScreen');
  const result = await db.rpc('get_guest_clip_delivery', { access_token:state.guestClipToken });
  if (result.error || !result.data) {
    $('#guestClipContent').innerHTML = '<h1>This clip link is not available</h1><p>Ask the filmer for a fresh Sodium guest link.</p>';
    $('#guestClipAccountActions').classList.add('hidden');
    return;
  }
  state.guestClipDelivery = result.data;
  const delivery = result.data;
  const ready = delivery.status === 'ready' || Number(delivery.uploaded_count) >= Number(delivery.expected_count);
  const percent = delivery.expected_count ? Math.min(100, Math.round(Number(delivery.uploaded_count) / Number(delivery.expected_count) * 100)) : 0;
  $('#guestClipContent').innerHTML = `<div class="guest-clip-summary"><span>${esc(delivery.sender_name)} SENT YOU</span><h1>${esc((delivery.subject_names || []).join(', ') || 'Your clips')}</h1><small>${delivery.session_spot ? `${esc(delivery.session_spot)}${delivery.session_location ? ` · ${esc(delivery.session_location)}` : ''}` : 'Sodium clip delivery'}</small><div class="clip-progress-copy"><b>${formatCount(delivery.uploaded_count)} of ${formatCount(delivery.expected_count)}</b><span>${ready ? 'Clips ready' : `${percent}% uploaded`}</span></div><div class="clip-progress-track"><span style="width:${ready ? 100 : percent}%"></span></div>${delivery.note ? `<p>${esc(delivery.note)}</p>` : ''}<button class="guest-clip-join" data-action="guest-clip-join">Join Sodium + open clips</button><a class="guest-clip-open guest-clip-open-secondary" href="${esc(delivery.folder_url)}" target="_blank" rel="noopener">${ready ? 'View clips without an account' : 'View uploading folder without an account'}</a></div>`;
  $('#guestClipAccountActions').classList.remove('hidden');
}

async function joinFromGuestClip() {
  const buttons = $$('[data-action="guest-clip-join"]');
  buttons.forEach(button => { button.disabled = true; });
  const result = await db.rpc('get_or_create_guest_clip_invite', { access_token:state.guestClipToken });
  buttons.forEach(button => { button.disabled = false; });
  if (result.error || !result.data) {
    if (/already connected/i.test(result.error?.message || '') && state.guestClipDelivery?.id) {
      const appUrl = new URL('./', location.href);
      appUrl.search = '';
      appUrl.hash = '';
      appUrl.searchParams.set('open', 'clips');
      appUrl.searchParams.set('delivery', state.guestClipDelivery.id);
      location.href = appUrl.href;
      return;
    }
    toast(result.error ? readableError(result.error) : 'Ask the filmer for a fresh Sodium invite.', 6000);
    return;
  }
  const url = new URL('./', location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', result.data);
  url.searchParams.set('open', 'claim-delivery');
  url.searchParams.set('delivery', state.guestClipDelivery.id);
  location.href = url.href;
}

async function sendMemberClipMessage(event) {
  event.preventDefault();
  const deliveryId = event.target.dataset.clipMessageForm;
  const input = $('input', event.target);
  const body = input.value.trim();
  if (!body) return;
  const result = await db.from('clip_delivery_messages').insert({ delivery_id:deliveryId, sender_user:state.profile.id, body });
  if (result.error) { toast(readableError(result.error), 6000); return; }
  input.value = '';
  await loadClipDeliveries();
}

function clipSessionLabel(delivery) {
  const spot = delivery.session?.spot?.name;
  if (spot) return spot;
  return `${formatCount(delivery.expected_count)} clips`;
}

function clipSubjectNames(delivery) {
  const names = Array.isArray(delivery?.subject_names) ? delivery.subject_names.filter(Boolean) : [];
  return names.length ? names.join(', ') : (delivery?.recipient_profile?.name || 'the surfer');
}

function clipShareCopy(delivery, recipientName) {
  const fullName = String(recipientName || 'dude').trim();
  const greeting = fullName.split(/\s+/)[0] || 'dude';
  const subjects = Array.isArray(delivery?.subject_names) ? delivery.subject_names.filter(Boolean) : [];
  const normalize = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const recipientFirst = normalize(greeting).split(' ')[0];
  const samePerson = subjects.length === 1 && normalize(subjects[0]).split(' ')[0] === recipientFirst;
  const clips = samePerson
    ? `your ${formatCount(delivery.expected_count)} clips`
    : `${formatCount(delivery.expected_count)} clips of ${clipSubjectNames(delivery)}`;
  const session = delivery.session;
  const date = session?.surf_time ? scheduleParts(session.surf_time).date : '';
  const spot = session?.spot?.name || '';
  const location = session?.spot?.general_location || '';
  const place = [spot, location && normalize(location) !== normalize(spot) ? location : ''].filter(Boolean).join(' in ');
  const context = date && place
    ? ` from the ${date} session at ${place}`
    : date ? ` from the ${date} session`
      : place ? ` from the session at ${place}` : '';
  return { greeting, sentence:`Yo ${greeting} — here are ${clips}${context}.` };
}

function clipDeliveryPercent(delivery) {
  if (!delivery?.expected_count) return 0;
  return Math.max(0, Math.min(100, Math.round((delivery.uploaded_count / delivery.expected_count) * 100)));
}

function clipDeliveryMarkup(delivery) {
  const mine = delivery.sender === state.profile.id;
  const other = mine ? delivery.recipient_profile : delivery.sender_profile;
  const direction = mine ? `To ${other?.name || delivery.recipient_name || 'guest'}` : `From ${other?.name || 'Sodium member'}`;
  const ready = delivery.status === 'ready';
  const cancelled = delivery.status === 'cancelled';
  const percent = ready ? 100 : clipDeliveryPercent(delivery);
  const progress = `${formatCount(delivery.uploaded_count)} of ${formatCount(delivery.expected_count)}`;
  const date = messageTime(delivery.ready_at || delivery.updated_at || delivery.created_at);
  const edit = mine && !cancelled ? `<button class="clip-edit" data-edit-clip-delivery="${delivery.id}" aria-label="Edit clip delivery"><svg><use href="#i-edit"/></svg></button>` : '';
  const shareAction = mine
    ? (delivery.recipient
      ? `<button class="clip-open clip-share-again" data-share-clip-delivery="${delivery.id}"><svg><use href="#i-share"/></svg>Share delivery again</button>`
      : `<button class="clip-open" data-invite-clip-claim="${delivery.id}">Invite to Sodium + send clips</button><button class="clip-edit guest-instructions" data-share-guest-clips="${delivery.id}" title="Account optional">Private clip link · account optional</button>`)
    : '';
  const messages = (delivery.clip_delivery_messages || []).slice(-3).map(message => `<div class="guest-clip-message"><b>${esc(memberById(message.sender_user)?.name || message.guest_name || 'Guest')}</b><p>${esc(message.body)}</p></div>`).join('');
  const threadCount = (delivery.clip_delivery_messages || []).length;
  const thread = `<details class="clip-thread"><summary><svg><use href="#i-chat"/></svg><span>Messages${threadCount ? ` · ${threadCount}` : ''}</span><b>Open</b></summary>${messages || '<small>No Sodium messages yet.</small>'}<form data-clip-message-form="${delivery.id}"><input maxlength="1000" required placeholder="Ask about a missing wave…"><button>Send</button></form></details>`;
  return `<article class="clip-delivery-card ${ready ? 'ready' : ''} ${cancelled ? 'cancelled' : ''}" data-clip-delivery-id="${delivery.id}"><details class="clip-card-details"><summary><div class="clip-delivery-head"><div class="clip-delivery-person">${avatarMarkup(other || { name:delivery.recipient_name })}<div><b>${esc(direction)}</b><small>${mine ? 'Sent' : 'Received'} · ${esc(date)}</small></div></div><span class="clip-status">${cancelled ? 'Cancelled' : (ready ? 'Clips ready' : 'Uploading')}</span></div><div class="clip-summary-meta"><span>${esc(formatCount(delivery.expected_count))} clips · ${esc(clipSessionLabel(delivery))}</span><svg><use href="#i-back"/></svg></div></summary><div class="clip-delivery-expanded"><div class="clip-delivery-title"><div><span class="clip-subject-label">CLIPS OF</span><h3>${esc(clipSubjectNames(delivery))}</h3><small>${esc(clipSessionLabel(delivery))}</small></div><span class="clip-provider"><svg><use href="#i-folder"/></svg>${esc(clipProviderLabel(delivery.provider))}</span></div><div class="clip-progress-copy"><b>${esc(progress)}</b><span>${percent}% complete</span></div><div class="clip-progress-track"><span style="width:${percent}%"></span></div>${delivery.note ? `<p class="clip-delivery-note">${esc(delivery.note)}</p>` : ''}${thread}<div class="clip-delivery-actions"><a class="clip-open" href="${esc(delivery.folder_url)}" target="_blank" rel="noopener"><svg><use href="#i-folder"/></svg>${ready ? 'Open clips' : 'View folder'}</a>${shareAction}${edit}</div></div></details></article>`;
}

function renderInboxTabs() {
  $$('[data-inbox-tab]').forEach(button => {
    const active = button.dataset.inboxTab === state.inboxTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#dmInboxMessages')?.classList.toggle('active', state.inboxTab === 'messages');
  $('#dmInboxClips')?.classList.toggle('active', state.inboxTab === 'clips');
  $$('[data-clip-box]').forEach(button => {
    const active = button.dataset.clipBox === state.clipBox;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function renderClipDeliveries() {
  const target = $('#clipDeliveries');
  if (!target || !state.profile) return;
  const mine = state.profile.id;
  const allDeliveries = [...state.clipDeliveries].sort((a, b) => {
    const statusOrder = { uploading:0, ready:1, cancelled:2 };
    return (statusOrder[a.status] - statusOrder[b.status]) || new Date(b.updated_at) - new Date(a.updated_at);
  });
  const deliveries = allDeliveries.filter(item => state.clipBox === 'sent' ? item.sender === mine : item.recipient === mine);
  const sentCount = allDeliveries.filter(item => item.sender === mine).length;
  const receivedCount = allDeliveries.filter(item => item.recipient === mine).length;
  if ($('#clipSentCount')) $('#clipSentCount').textContent = String(sentCount);
  if ($('#clipReceivedCount')) $('#clipReceivedCount').textContent = String(receivedCount);
  target.innerHTML = deliveries.length
    ? deliveries.map(clipDeliveryMarkup).join('')
    : `<div class="empty clip-empty"><span>${state.clipBox === 'sent' ? 'OUTBOX' : 'RECEIVED'}</span><h2>${state.clipBox === 'sent' ? 'No clips sent yet' : 'No clips received yet'}</h2><p>${state.clipBox === 'sent' ? 'Every delivery you create will stay here so you can edit, reopen, or share it again.' : 'Clip deliveries sent to you will appear here.'}</p></div>`;
  const incomingUploading = allDeliveries.filter(item => item.recipient === state.profile.id && item.status === 'uploading').length;
  const badge = $('#clipReadyBadge');
  if (badge) {
    badge.textContent = incomingUploading > 99 ? '99+' : String(incomingUploading);
    badge.classList.toggle('hidden', incomingUploading === 0);
  }
  renderDmClipDeliveries();
  renderInboxTabs();
}

function renderDmClipDeliveries() {
  const target = $('#dmClipDeliveries');
  if (!target || !state.activeDmMember) return;
  const theirs = state.activeDmMember.id;
  const mine = state.profile.id;
  const deliveries = state.clipDeliveries
    .filter(item => (item.sender === mine && item.recipient === theirs) || (item.sender === theirs && item.recipient === mine))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 2);
  target.innerHTML = deliveries.map(clipDeliveryMarkup).join('');
}

async function loadClipDeliveries() {
  if (!state.profile || state.preview) return;
  let result = await db.from('clip_deliveries')
    .select('*,sender_profile:profiles!clip_deliveries_sender_fkey(id,name,nickname,avatar_path),recipient_profile:profiles!clip_deliveries_recipient_fkey(id,name,nickname,avatar_path),session:sessions!clip_deliveries_session_id_fkey(id,surf_time,when_label,status,spot:spots(name,general_location)),clip_delivery_messages(id,sender_user,guest_name,body,created_at)')
    .or(`sender.eq.${state.profile.id},recipient.eq.${state.profile.id}`)
    .order('updated_at', { ascending:false }).limit(250);
  if (result.error) {
    console.warn('Clip delivery messages did not load; showing delivery history without messages:', result.error.message);
    result = await db.from('clip_deliveries')
      .select('*,sender_profile:profiles!clip_deliveries_sender_fkey(id,name,nickname,avatar_path),recipient_profile:profiles!clip_deliveries_recipient_fkey(id,name,nickname,avatar_path),session:sessions!clip_deliveries_session_id_fkey(id,surf_time,when_label,status,spot:spots(name,general_location))')
      .or(`sender.eq.${state.profile.id},recipient.eq.${state.profile.id}`)
      .order('updated_at', { ascending:false }).limit(250);
    if (result.error) {
      console.warn('Clip deliveries are not ready:', result.error.message);
      const target = $('#clipDeliveries');
      if (target) target.innerHTML = '<div class="empty clip-empty"><span>OUTBOX</span><h2>Could not load sent clips</h2><p>Close and reopen Sodium. If this remains, report the error from Settings.</p></div>';
      return;
    }
    result.data = (result.data || []).map(delivery => ({ ...delivery, clip_delivery_messages:[] }));
  }
  state.clipDeliveries = result.data || [];
  renderClipDeliveries();
}

function updateClipProgressPreview() {
  const expected = Math.max(1, Math.min(2000, Number($('#clipExpectedCount').value) || 1));
  const uploaded = Math.max(0, Math.min(2000, Number($('#clipUploadedCount').value) || 0));
  const ready = uploaded >= expected;
  const percent = ready ? 100 : Math.round((uploaded / expected) * 100);
  const preview = $('#clipProgressPreview');
  preview.classList.toggle('ready', ready);
  $('b', preview).textContent = `${formatCount(uploaded)} of ${formatCount(expected)}`;
  $('div span', preview).textContent = ready ? 'Clips ready' : 'Uploading';
  $('i span', preview).style.width = `${percent}%`;
  $('small', preview).textContent = ready
    ? 'Complete. The recipient gets the ready notification automatically.'
    : `At ${formatCount(expected)} of ${formatCount(expected)}, this automatically becomes Clips ready.`;
}

function updateClipProviderHint() {
  const provider = clipProviderFromUrl($('#clipFolderUrl').value);
  const hint = $('#clipProviderHint');
  hint.textContent = provider === 'other'
    ? 'Any HTTPS folder link works. Automatic provider tracking can be connected later.'
    : `${clipProviderLabel(provider)} detected · this delivery is ready for provider tracking.`;
}

function clipSessionOptions(selected = '') {
  const options = [...state.sessions].sort((a, b) => new Date(b.ended_at || b.surf_time || b.created_at) - new Date(a.ended_at || a.surf_time || a.created_at));
  return '<option value="">No linked session</option>' + options.map(session => {
    const date = scheduleParts(session.surf_time || session.ended_at || session.created_at).date;
    return `<option value="${session.id}" ${session.id === selected ? 'selected' : ''}>${esc(session.spot?.name || 'Surf')} · ${esc(date)}</option>`;
  }).join('');
}

function openClipDeliveryComposer(deliveryId = null, sessionId = '', recipientId = '') {
  const delivery = deliveryId ? state.clipDeliveries.find(item => item.id === deliveryId && item.sender === state.profile.id) : null;
  state.editingClipDeliveryId = delivery?.id || null;
  $('#clipDeliveryForm').reset();
  $('#clipDeliveryTitle').textContent = delivery ? 'Edit clip delivery' : 'Send clips';
  $('#clipDeliverySubmit').textContent = delivery ? 'Save delivery' : 'Start delivery';
  $('#clipDeliveryDelete').classList.toggle('hidden', !delivery);
  $('#clipMarkReady').classList.toggle('hidden', !delivery || delivery.status === 'ready');
  const chosenRecipient = delivery?.recipient || recipientId || state.activeDmMember?.id || '';
  $('#clipRecipient').innerHTML = '<option value="">Choose a member</option>' + state.people.filter(person => person.id !== state.profile.id).map(person => `<option value="${person.id}" ${person.id === chosenRecipient ? 'selected' : ''}>${esc(person.name)}</option>`).join('') + `<option value="pending" ${delivery && !delivery.recipient ? 'selected' : ''}>Not on Sodium yet…</option>`;
  $('#clipRecipientName').value = delivery?.recipient_name || '';
  updateClipRecipientUi();
  $('#clipSession').innerHTML = clipSessionOptions(delivery?.session_id || sessionId);
  $('#clipSubjects').value = delivery ? clipSubjectNames(delivery) : '';
  $('#clipFolderUrl').value = delivery?.folder_url || '';
  $('#clipExpectedCount').value = delivery?.expected_count || 1;
  $('#clipUploadedCount').value = delivery?.uploaded_count || 0;
  $('#clipNote').value = delivery?.note || '';
  updateClipProviderHint();
  updateClipProgressPreview();
  openSheet('clipDeliverySheet');
}

function updateClipRecipientUi() {
  const pending = $('#clipRecipient').value === 'pending';
  $('#clipRecipientNameRow').classList.toggle('hidden', !pending);
  if (!state.editingClipDeliveryId) $('#clipDeliverySubmit').textContent = pending ? 'Create + share clips' : 'Start delivery';
}

async function saveClipDelivery(event) {
  event.preventDefault();
  const submit = $('#clipDeliverySubmit');
  submit.disabled = true;
  try {
    const url = new URL($('#clipFolderUrl').value.trim());
    if (url.protocol !== 'https:') throw new Error('Use a secure HTTPS link to the clip folder.');
    const expectedCount = Number($('#clipExpectedCount').value);
    const uploadedCount = Number($('#clipUploadedCount').value);
    if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 2000) throw new Error('Enter the total number of clips from 1 to 2,000.');
    if (!Number.isInteger(uploadedCount) || uploadedCount < 0 || uploadedCount > 2000) throw new Error('Uploaded clips must be from 0 to 2,000.');
    const provider = clipProviderFromUrl(url.href);
    const subjectNames = $('#clipSubjects').value.split(',').map(name => name.trim()).filter(Boolean);
    if (!subjectNames.length || subjectNames.length > 20) throw new Error('Add the first name of the surfer in the clips.');
    if (subjectNames.some(name => name.length > 80)) throw new Error('Keep each surfer name under 80 characters.');
    const pendingRecipient = $('#clipRecipient').value === 'pending';
    const payload = {
      sender:state.profile.id,
      recipient:pendingRecipient ? null : $('#clipRecipient').value,
      recipient_name:pendingRecipient ? $('#clipRecipientName').value.trim() : (memberById($('#clipRecipient').value)?.name || null),
      subject_names:subjectNames,
      session_id:$('#clipSession').value || null,
      provider,
      folder_url:url.href,
      expected_count:expectedCount,
      uploaded_count:uploadedCount,
      tracking_mode:'manual',
      note:$('#clipNote').value.trim() || null,
    };
    if ((!payload.recipient && !payload.recipient_name) || payload.recipient === state.profile.id) throw new Error('Choose a Sodium member or add the guest’s first name.');
    const edited = Boolean(state.editingClipDeliveryId);
    const result = edited
      ? await db.from('clip_deliveries').update(payload).eq('id', state.editingClipDeliveryId).eq('sender', state.profile.id)
      : await db.from('clip_deliveries').insert(payload).select('id').single();
    if (result.error) throw result.error;
    const createdDeliveryId = edited ? null : result.data?.id;
    closeSheet();
    state.editingClipDeliveryId = null;
    await loadClipDeliveries();
    state.inboxTab = 'clips';
    state.clipBox = 'sent';
    setView('dms');
    renderInboxTabs();
    if (pendingRecipient && createdDeliveryId) {
      toast('Delivery created. Opening the invite and clip instructions…');
      await shareClipClaimInvite(createdDeliveryId);
    } else {
      toast(uploadedCount >= expectedCount ? 'Clips ready.' : (edited ? 'Clip delivery updated.' : 'Clip delivery started.'));
    }
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; }
}

async function markClipDeliveryReady() {
  const delivery = state.clipDeliveries.find(item => item.id === state.editingClipDeliveryId && item.sender === state.profile.id);
  if (!delivery) {
    $('#clipUploadedCount').value = $('#clipExpectedCount').value;
    updateClipProgressPreview();
    return;
  }
  const expectedCount = Number($('#clipExpectedCount').value) || delivery.expected_count;
  const result = await db.from('clip_deliveries').update({ expected_count:expectedCount, uploaded_count:expectedCount }).eq('id', delivery.id).eq('sender', state.profile.id);
  if (result.error) { toast(readableError(result.error), 6000); return; }
  closeSheet();
  state.editingClipDeliveryId = null;
  await loadClipDeliveries();
  toast('Clips ready. The recipient was notified.');
}

async function deleteClipDelivery() {
  const delivery = state.clipDeliveries.find(item => item.id === state.editingClipDeliveryId && item.sender === state.profile.id);
  if (!delivery || !confirm('Delete this clip delivery? The Drive or Dropbox folder will not be deleted.')) return;
  const result = await db.from('clip_deliveries').delete().eq('id', delivery.id).eq('sender', state.profile.id);
  if (result.error) { toast(readableError(result.error), 6000); return; }
  closeSheet();
  state.editingClipDeliveryId = null;
  await loadClipDeliveries();
  toast('Delivery removed. The external folder was left untouched.');
}

function revealSharedDelivery() {
  if (!state.pendingDeliveryId) return;
  const deliveryId = state.pendingDeliveryId;
  state.pendingDeliveryId = '';
  const card = document.querySelector(`[data-clip-delivery-id="${CSS.escape(deliveryId)}"]`);
  if (!card) {
    toast('That clip delivery is no longer available.', 5000);
    return;
  }
  card.classList.add('shared-target');
  const details = card.querySelector('.clip-card-details');
  if (details) details.open = true;
  requestAnimationFrame(() => card.scrollIntoView({ behavior:'smooth', block:'center' }));
  setTimeout(() => card.classList.remove('shared-target'), 3600);
}

async function loadEvents() {
  if (!state.eventRegion) return;
  const result = await db.from('events')
    .select('*,spot:spots(*),author_profile:profiles!events_author_fkey(id,name),event_rsvps(user_id,profile:profiles!event_rsvps_user_id_fkey(id,name))')
    .eq('region_id', state.eventRegion.id).order('start_time', { ascending: true });
  if (result.error) { toast(readableError(result.error)); return; }
  state.events = result.data || [];
  renderEvents();
  if (state.view === 'calendar') renderCalendar();
}

async function loadListings() {
  const result = await db.from('marketplace_listings')
    .select('*,owner_profile:profiles!marketplace_listings_owner_id_fkey(id,name,nickname,avatar_path,home_region)')
    .order('featured', { ascending:false }).order('created_at', { ascending:false });
  if (result.error) { console.warn('Marketplace load deferred:', result.error.message); return; }
  state.listings = result.data || [];
  state.marketplaceImageUrls = {};
  await Promise.all(state.listings.filter(item => item.image_path).map(async item => {
    const signed = await db.storage.from(CONFIG.marketplaceBucket).createSignedUrl(item.image_path, 3600);
    if (!signed.error && signed.data?.signedUrl) state.marketplaceImageUrls[item.id] = signed.data.signedUrl;
  }));
  renderMarketplace();
}

function listingImageMarkup(listing, className = 'listing-card-image') {
  const url = state.marketplaceImageUrls[listing.id];
  return `<div class="${className}">${url ? `<img src="${esc(url)}" alt="">` : '<svg><use href="#i-store"/></svg>'}</div>`;
}

function listingOwner(listing) {
  return listing.owner_profile || state.people.find(person => person.id === listing.owner_id) || (listing.owner_id === state.profile?.id ? state.profile : { name:'Sodium member' });
}

function canEditListing(listing) {
  return Boolean(state.profile?.is_admin || listing.owner_id === state.profile?.id);
}

function renderMarketplace() {
  const list = $('#marketplaceList');
  if (!list) return;
  const visible = state.listings.filter(item => item.status === 'approved' || canEditListing(item));
  if (!visible.length) {
    list.innerHTML = '<div class="empty"><span>◌</span><h2>Nothing listed yet</h2><p>Be the first member to show the crew what you make or do.</p></div>';
    return;
  }
  list.innerHTML = visible.map(listing => {
    const owner = listingOwner(listing);
    const pending = listing.status !== 'approved' ? `<span class="listing-status">${esc(listing.status)}</span>` : '';
    const perk = listing.has_member_perk ? '<span class="listing-perk-badge">SODIUM PERK</span>' : '';
    const edit = canEditListing(listing) ? `<button class="listing-card-edit" data-edit-listing="${listing.id}" aria-label="Edit ${esc(listing.title)}"><svg><use href="#i-edit"/></svg></button>` : '';
    return `<article class="listing-card ${listing.featured ? 'featured' : ''}" data-listing="${listing.id}">${listingImageMarkup(listing)}<div class="listing-card-copy"><div class="listing-card-top"><div><h3>${esc(listing.title)}</h3><small>${esc(listing.brand_name || owner.name)}</small></div>${edit}</div><p>${esc(listing.description)}</p><div class="listing-card-foot"><span class="listing-category">${esc(listing.category)}</span>${perk}${pending}</div></div></article>`;
  }).join('');
}

function renderMarketplaceDetail(listing) {
  const node = $('#marketplaceDetail');
  if (!node || !listing) return;
  const owner = listingOwner(listing);
  const url = safeExternalUrl(listing.external_url);
  const social = safeExternalUrl(listing.social_url);
  const location = listing.location ? `<span class="listing-category">${esc(listing.location)}</span>` : '';
  const perk = listing.has_member_perk && listing.perk_description ? `<div class="listing-perk"><b>SODIUM MEMBER PERK</b><span>${esc(listing.perk_description)}</span>${listing.discount_code ? `<code>${esc(listing.discount_code)}</code>` : ''}</div>` : '';
  node.innerHTML = `<article class="listing-detail-hero">${listingImageMarkup(listing, 'listing-detail-image')}<div class="listing-detail-copy"><span>${esc(listing.category)}</span><h2>${esc(listing.title)}</h2><div class="listing-detail-owner">By ${esc(listing.brand_name || owner.name)}</div><p>${esc(listing.description)}</p><div class="listing-detail-meta">${location}${listing.status !== 'approved' ? `<span class="listing-status">${esc(listing.status)}</span>` : ''}</div>${perk}<div class="listing-detail-actions">${url ? `<a class="primary" href="${esc(url)}" target="_blank" rel="noopener">View →</a>` : ''}${social ? `<a class="secondary-button" href="${esc(social)}" target="_blank" rel="noopener">Social profile ↗</a>` : ''}${canEditListing(listing) ? `<button class="secondary-button" data-edit-listing="${listing.id}"><svg><use href="#i-edit"/></svg>Edit listing</button>` : ''}</div></div></article>`;
}

function openListingDetail(id) {
  const listing = state.listings.find(item => item.id === id);
  if (!listing) return;
  state.selectedListingId = id;
  renderMarketplaceDetail(listing);
  setView('marketplace-detail');
}

function resetListingComposer() {
  state.editingListingId = null;
  $('#listingForm').reset();
  $('#listingSheetTitle').textContent = 'Add a listing';
  $('#listingSubmit').textContent = state.profile?.is_admin ? 'Publish listing' : 'Submit listing';
  $('#listingDelete').classList.add('hidden');
  $('#listingPerkFields').classList.add('hidden');
  $('#listingAdminFields').classList.toggle('hidden', !state.profile?.is_admin);
  $('#listingImagePreview').innerHTML = '<svg><use href="#i-photo"/></svg><b>Add an image or logo</b><small>Optional · JPG, PNG or WebP · 8 MB max</small>';
}

function openListingComposer(id = '') {
  resetListingComposer();
  const listing = state.listings.find(item => item.id === id);
  if (listing && canEditListing(listing)) {
    state.editingListingId = listing.id;
    $('#listingSheetTitle').textContent = 'Edit listing';
    $('#listingTitle').value = listing.title || '';
    $('#listingBrand').value = listing.brand_name || '';
    $('#listingCategory').value = listing.category || 'Other';
    $('#listingDescription').value = listing.description || '';
    $('#listingUrl').value = listing.external_url || '';
    $('#listingSocial').value = listing.social_url || '';
    $('#listingLocation').value = listing.location || '';
    $('#listingHasPerk').checked = Boolean(listing.has_member_perk);
    $('#listingPerkDescription').value = listing.perk_description || '';
    $('#listingDiscountCode').value = listing.discount_code || '';
    $('#listingPerkFields').classList.toggle('hidden', !listing.has_member_perk);
    $('#listingStatus').value = listing.status || 'pending';
    $('#listingFeatured').checked = Boolean(listing.featured);
    $('#listingSubmit').textContent = 'Save changes';
    $('#listingDelete').classList.remove('hidden');
    const imageUrl = state.marketplaceImageUrls[listing.id];
    if (imageUrl) $('#listingImagePreview').innerHTML = `<img src="${esc(imageUrl)}" alt="Current listing image">`;
  }
  openSheet('listingSheet');
}

function validateListingImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG, or WebP image.');
  if (file.size > CONFIG.maxMarketplaceImageBytes) throw new Error('Listing images must be 8 MB or smaller.');
}

async function saveListing(event) {
  event.preventDefault();
  const submit = $('#listingSubmit'); submit.disabled = true;
  try {
    const existing = state.listings.find(item => item.id === state.editingListingId);
    const file = $('#listingImage').files[0];
    if (file) validateListingImage(file);
    const payload = {
      owner_id: existing?.owner_id || state.profile.id,
      title: $('#listingTitle').value.trim(), brand_name: $('#listingBrand').value.trim() || null,
      category: $('#listingCategory').value, description: $('#listingDescription').value.trim(),
      external_url: $('#listingUrl').value.trim(), social_url: $('#listingSocial').value.trim() || null,
      location: $('#listingLocation').value.trim() || null, has_member_perk: $('#listingHasPerk').checked,
      perk_description: $('#listingHasPerk').checked ? $('#listingPerkDescription').value.trim() || null : null,
      discount_code: $('#listingHasPerk').checked ? $('#listingDiscountCode').value.trim() || null : null,
      status: state.profile.is_admin ? $('#listingStatus').value : (existing?.status === 'approved' ? 'approved' : 'pending'),
      featured: state.profile.is_admin ? $('#listingFeatured').checked : false,
    };
    let result = existing
      ? await db.from('marketplace_listings').update(payload).eq('id', existing.id).select().single()
      : await db.from('marketplace_listings').insert(payload).select().single();
    if (result.error) throw result.error;
    if (file) {
      const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
      const path = `${state.profile.id}/${result.data.id}-${Date.now()}.${ext}`;
      const upload = await db.storage.from(CONFIG.marketplaceBucket).upload(path, file, { contentType:file.type, upsert:false });
      if (upload.error) throw upload.error;
      const saved = await db.from('marketplace_listings').update({ image_path:path }).eq('id', result.data.id);
      if (saved.error) throw saved.error;
      if (existing?.image_path) await db.storage.from(CONFIG.marketplaceBucket).remove([existing.image_path]);
    }
    resetListingComposer(); closeSheet(); await loadListings(); await renderProfile();
    toast(payload.status === 'approved' ? 'Listing published.' : 'Listing submitted for review.');
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; }
}

async function deleteListing() {
  const listing = state.listings.find(item => item.id === state.editingListingId);
  if (!listing || !canEditListing(listing) || !confirm(`Delete “${listing.title}”? This cannot be undone.`)) return;
  const button = $('#listingDelete'); button.disabled = true;
  try {
    const result = await db.from('marketplace_listings').delete().eq('id', listing.id);
    if (result.error) throw result.error;
    if (listing.image_path) await db.storage.from(CONFIG.marketplaceBucket).remove([listing.image_path]);
    resetListingComposer(); closeSheet(); setView('marketplace'); await loadListings(); await renderProfile(); toast('Listing deleted.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { button.disabled = false; }
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
    return `<article class="perk-card"><div class="perk-top"><span class="perk-mark">${esc(initials(perk.brand_name || perk.name))}</span><div><small>${esc(perk.brand_name || 'Sodium partner')}</small><h3>${esc(perk.name)}</h3></div>${status}${edit}</div><strong class="perk-offer">${esc(perk.offer_text || 'Member perk')}</strong>${perk.description ? `<p>${esc(perk.description)}</p>` : ''}${code}${url ? `<a class="perk-link" href="${esc(url)}" target="_blank" rel="noopener">Open store <span>↗</span></a>` : ''}</article>`;
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
  if (!state.profile?.is_admin) { toast('Only Sodium admins can manage discounts.'); return; }
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
  if (!state.profile?.is_admin) { toast('Only Sodium admins can manage discounts.'); return; }
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

function issueCategoryLabel(category) {
  return ({ broken:'Broken', confusing:'Confusing', suggestion:'Suggestion', other:'Other' })[category] || 'Other';
}

function issueStatusLabel(status) {
  return ({ new:'New', reviewing:'Reviewing', fixed:'Fixed', closed:'Closed' })[status] || 'New';
}

function issueScreenLabel(view) {
  return ({ surfing:'Sessions', feed:'Stoke', chat:'Community Chat', events:'Events', you:'Profile', dms:'Messages', dm:'Direct Message', calendar:'Crew Calendar', settings:'Settings' })[view] || String(view || 'Unknown').replace(/-/g, ' ');
}

function openIssueReport() {
  $('#issueReportForm').reset();
  $('#issueScreenshotLabel').textContent = 'Choose screenshot';
  state.issueOriginView = state.view === 'settings' ? state.previousView : state.view;
  openSheet('issueReportSheet');
  setTimeout(() => $('#issueDescription').focus({ preventScroll:true }), 120);
}

function feedbackScreenshotPath(file) {
  const extension = ({ 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' })[file.type] || 'jpg';
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${state.profile.id}/${token}.${extension}`;
}

function validateFeedbackScreenshot(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG, or WebP screenshot.');
  if (file.size > CONFIG.maxFeedbackScreenshotBytes) throw new Error('That screenshot is over 10 MB. Crop it or choose a smaller image.');
}

async function saveIssueReport(event) {
  event.preventDefault();
  const submit = $('#issueReportSubmit');
  const screenshot = $('#issueScreenshot').files[0] || null;
  submit.disabled = true;
  submit.textContent = 'Sending…';
  try {
    validateFeedbackScreenshot(screenshot);
    let screenshotPath = screenshot ? feedbackScreenshotPath(screenshot) : null;
    let screenshotFailed = false;
    if (screenshot) {
      const uploaded = await db.storage.from(CONFIG.feedbackBucket).upload(screenshotPath, screenshot, { contentType:screenshot.type, upsert:false });
      if (uploaded.error) {
        console.warn('Feedback screenshot upload failed:', uploaded.error);
        screenshotPath = null;
        screenshotFailed = true;
      }
    }
    const payload = {
      reporter: state.profile.id,
      category: $('#issueCategory').value,
      description: $('#issueDescription').value.trim(),
      expected_behavior: $('#issueExpected').value.trim() || null,
      screen: issueScreenLabel(state.issueOriginView),
      app_version: APP_VERSION,
      user_agent: navigator.userAgent.slice(0, 1000),
      screenshot_path: screenshotPath,
    };
    const inserted = await db.from('beta_issue_reports').insert(payload).select('id').single();
    if (inserted.error) {
      if (screenshotPath) await db.storage.from(CONFIG.feedbackBucket).remove([screenshotPath]);
      throw inserted.error;
    }
    $('#issueReportForm').reset();
    $('#issueScreenshotLabel').textContent = 'Choose screenshot';
    closeSheet();
    toast(screenshotFailed ? 'Report sent. The screenshot could not upload, but the details are saved.' : 'Report sent. Thank you for helping improve Sodium.', 5000);
    if (state.profile?.is_admin) await loadIssueReports({ silent:true });
  } catch (error) { toast(readableError(error), 6000); }
  finally { submit.disabled = false; submit.textContent = 'Send report'; }
}

async function loadIssueReports({ silent = false } = {}) {
  if (!state.profile?.is_admin) return;
  const result = await db.from('beta_issue_reports')
    .select('*,reporter_profile:profiles!beta_issue_reports_reporter_fkey(id,name)')
    .order('created_at', { ascending:false });
  if (result.error) {
    console.warn('Beta feedback unavailable:', result.error);
    if (!silent) {
      $('#feedbackList').innerHTML = '<div class="empty"><span>BETA FEEDBACK</span><h2>Reports could not load</h2><p>Check that the beta-feedback migration has been installed.</p></div>';
      toast(readableError(result.error), 5000);
    }
    return;
  }
  state.issueReports = result.data || [];
  const screenshotEntries = await Promise.all(state.issueReports.filter(report => report.screenshot_path).map(async report => {
    const signed = await db.storage.from(CONFIG.feedbackBucket).createSignedUrl(report.screenshot_path, 3600);
    return [report.id, signed.error ? null : signed.data.signedUrl];
  }));
  state.issueScreenshotUrls = Object.fromEntries(screenshotEntries);
  renderIssueReports();
}

function renderIssueReports() {
  if (!state.profile?.is_admin) return;
  const counts = state.issueReports.reduce((result, report) => {
    result[report.status] = (result[report.status] || 0) + 1;
    return result;
  }, { new:0, reviewing:0, fixed:0, closed:0 });
  const openCount = counts.new + counts.reviewing;
  $('#feedbackSummary').innerHTML = `<article><b>${openCount}</b><span>open</span></article><article><b>${counts.new}</b><span>new</span></article><article><b>${counts.fixed}</b><span>fixed</span></article>`;
  $('#betaFeedbackBadge').textContent = counts.new;
  $('#betaFeedbackBadge').classList.toggle('hidden', counts.new === 0);
  const filtered = state.issueReports.filter(report => {
    if (state.issueFilter === 'all') return true;
    if (state.issueFilter === 'open') return ['new', 'reviewing'].includes(report.status);
    return report.status === state.issueFilter;
  });
  $('#feedbackFilters').querySelectorAll('[data-feedback-filter]').forEach(button => button.classList.toggle('active', button.dataset.feedbackFilter === state.issueFilter));
  if (!filtered.length) {
    $('#feedbackList').innerHTML = `<div class="empty"><span>BETA FEEDBACK</span><h2>No ${esc(state.issueFilter)} reports</h2><p>Reports will appear here when members send them.</p></div>`;
    return;
  }
  $('#feedbackList').innerHTML = filtered.map(report => {
    const reporter = report.reporter_profile?.name || 'Unknown member';
    const created = new Intl.DateTimeFormat([], { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(report.created_at));
    const screenshotUrl = state.issueScreenshotUrls[report.id];
    const screenshot = screenshotUrl ? `<a class="feedback-screenshot" href="${esc(screenshotUrl)}" target="_blank" rel="noopener"><img src="${esc(screenshotUrl)}" alt="Screenshot attached by ${esc(reporter)}"><span>Open full screenshot ↗</span></a>` : '';
    const expected = report.expected_behavior ? `<div class="feedback-expected"><b>Expected</b><p>${esc(report.expected_behavior)}</p></div>` : '';
    return `<article class="feedback-card status-${esc(report.status)}"><header><div><span class="feedback-category category-${esc(report.category)}">${esc(issueCategoryLabel(report.category))}</span><h3>${esc(reporter)}</h3><small>${esc(created)} · ${esc(report.screen || 'Unknown screen')} · v${esc(report.app_version || '?')}</small></div><select data-issue-status="${report.id}" aria-label="Status for report from ${esc(reporter)}">${['new','reviewing','fixed','closed'].map(status => `<option value="${status}" ${status === report.status ? 'selected' : ''}>${issueStatusLabel(status)}</option>`).join('')}</select></header><div class="feedback-description"><b>What happened</b><p>${esc(report.description)}</p></div>${expected}${screenshot}<details class="feedback-device"><summary>Device details</summary><p>${esc(report.user_agent || 'Not available')}</p></details><label class="feedback-notes">Private admin notes<textarea data-issue-notes="${report.id}" maxlength="4000" placeholder="What needs fixing, commit, follow-up…">${esc(report.admin_notes || '')}</textarea></label><button class="secondary-button feedback-save" data-save-feedback="${report.id}">Save status &amp; notes</button></article>`;
  }).join('');
}

async function saveIssueAdminUpdate(reportId) {
  if (!state.profile?.is_admin) return;
  const status = $(`[data-issue-status="${reportId}"]`)?.value;
  const notes = $(`[data-issue-notes="${reportId}"]`)?.value.trim() || null;
  const button = $(`[data-save-feedback="${reportId}"]`);
  if (!status || !button) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await db.from('beta_issue_reports').update({ status, admin_notes:notes, updated_at:new Date().toISOString() }).eq('id', reportId);
    if (result.error) throw result.error;
    await loadIssueReports({ silent:true });
    toast('Feedback report updated.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { button.disabled = false; button.textContent = 'Save status & notes'; }
}

function scheduleParts(startValue, endValue = null) {
  const start = new Date(startValue);
  if (!Number.isFinite(start.getTime())) return { date:'Date coming soon', time:'Time coming soon' };
  const dateOptions = { weekday:'short', month:'short', day:'numeric' };
  if (start.getFullYear() !== new Date().getFullYear()) dateOptions.year = 'numeric';
  const date = new Intl.DateTimeFormat([], dateOptions).format(start);
  const startTime = new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(start);
  const end = endValue ? new Date(endValue) : null;
  const endTime = end && Number.isFinite(end.getTime())
    ? new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(end)
    : '';
  return { date, time:endTime ? `${startTime} – ${endTime}` : startTime };
}

function schedulePills(parts, className = '') {
  return `<div class="schedule-pills ${className}"><span class="schedule-date"><svg><use href="#i-calendar"/></svg>${esc(parts.date)}</span><span class="schedule-time"><svg><use href="#i-clock"/></svg>${esc(parts.time)}</span></div>`;
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

function isPastEvent(item, now = Date.now()) {
  const ending = new Date(item.end_time || item.start_time || 0).getTime();
  return Number.isFinite(ending) && ending > 0 && ending < now;
}

function renderEventCard(item, past = false) {
  const going = item.event_rsvps || [];
  const mine = going.some(rsvp => rsvp.user_id === state.profile.id);
  const crew = going.slice(0, 4).map(rsvp => avatarMarkup(rsvp.profile, 'event-avatar')).join('');
  const timing = scheduleParts(item.start_time, item.end_time);
  const place = [item.venue_name || item.spot?.name, item.location_text || item.spot?.general_location].filter(Boolean).join(' · ');
  const mapUrl = eventMapUrl(item);
  const edit = !past && item.author === state.profile.id ? `<button class="event-edit" data-edit-event="${item.id}" aria-label="Edit ${esc(item.title)}"><svg><use href="#i-edit"/></svg></button>` : '';
  const share = !past ? `<button class="event-share" data-share-event="${item.id}" aria-label="Share ${esc(item.title)}"><svg><use href="#i-share"/></svg></button>` : '';
  const tools = past ? '<span class="past-badge">Ended</span>' : `<div class="event-card-tools">${share}${edit}</div>`;
  const actions = past ? '' : `<div class="card-actions"><button class="small-action surf ${mine ? 'on' : ''}" data-event-rsvp="${item.id}"><svg><use href="#i-check"/></svg>${mine ? 'Going ✓' : 'RSVP'}</button><button class="small-action" data-event-calendar="${item.id}"><svg><use href="#i-calendar"/></svg>Add to calendar</button></div>`;
  return `<article class="event-card ${past ? 'past-card' : ''}" data-event-id="${item.id}"><div class="event-main"><div class="event-heading"><h2>${esc(item.title)}</h2>${tools}</div>${schedulePills(timing, 'event-schedule')}${place ? `<a class="event-place" href="${esc(mapUrl)}" target="_blank" rel="noopener"><svg><use href="#i-pin"/></svg><span>${esc(place)}</span><b>Map ↗</b></a>` : ''}${item.description ? `<p class="event-description">${esc(item.description)}</p>` : ''}<div class="event-going"><div class="event-stack">${crew}</div><b>${going.length} ${past ? 'went' : 'going'}</b></div>${actions}</div></article>`;
}

function renderEvents() {
  const feed = $('#eventsFeed');
  if (!feed || !state.eventRegion) return;
  const now = Date.now();
  const upcoming = state.events.filter(item => !isPastEvent(item, now));
  const past = state.events.filter(item => isPastEvent(item, now)).sort((a, b) => new Date(b.end_time || b.start_time) - new Date(a.end_time || a.start_time));
  const plannedLabel = $('#eventsPlanned');
  if (plannedLabel) plannedLabel.textContent = upcoming.length ? `${upcoming.length} PLANNED` : 'NO EVENTS PLANNED';
  if (!state.events.length) {
    feed.innerHTML = `<div class="empty"><span>EVENTS</span><h2>No events in ${esc(state.eventRegion.name)} yet</h2><p>Add a comp, movie night, or meetup and the crew can RSVP.</p></div>`;
    return;
  }
  const upcomingMarkup = upcoming.length
    ? upcoming.map(item => renderEventCard(item)).join('')
    : '<div class="empty compact-empty"><span>OPEN</span><h2>No upcoming events</h2><p>Past events are saved below.</p></div>';
  const pastMarkup = past.length ? `<details class="past-items"><summary><span><b>Past events</b><small>${past.length} ended</small></span><svg><use href="#i-chevron"/></svg></summary><div>${past.map(item => renderEventCard(item, true)).join('')}</div></details>` : '';
  feed.innerHTML = `${upcomingMarkup}${pastMarkup}`;
}

async function createEvent(event) {
  event.preventDefault();
  const submit = $('#eventForm button[type="submit"]');
  submit.disabled = true;
  try {
    await joinLocation(state.eventRegion, false);
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
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sodium//Events//EN','BEGIN:VEVENT',`UID:${item.id}@saltyviewfinder.com`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${clean(item.title)}`,`DESCRIPTION:${clean(item.description)}`,`LOCATION:${clean(place)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([body], { type:'text/calendar;charset=utf-8' }));
  link.download = `${item.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'sodium-event'}.ics`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Calendar event ready.');
}

function sessionWhen(session) {
  if (session.when_label === 'Now' || !session.surf_time) return 'out in the water';
  const date = new Date(session.surf_time);
  const options = { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat([], options).format(date);
}

function sessionSchedulePills(session) {
  if (session.when_label === 'Now' || !session.surf_time) {
    return `<div class="schedule-pills session-schedule"><span class="schedule-now session-live-pill"><i></i>Out in the water</span></div>`;
  }
  return schedulePills(scheduleParts(session.surf_time), 'session-schedule');
}

function isPastSession(session, now = Date.now()) {
  if (session.status && session.status !== 'active') return true;
  const anchor = new Date(session.surf_time || session.created_at || 0).getTime();
  return Number.isFinite(anchor) && anchor > 0 && anchor < now - 18 * 60 * 60 * 1000;
}

function calendarDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? localDateValue(date) : '';
}

function calendarItems() {
  const now = new Date();
  const surfs = state.sessions
    .filter(session => session.region_id === state.currentRegion.id && !isPastSession(session))
    .map(session => {
      const date = session.surf_time ? new Date(session.surf_time) : now;
      return { type:'surf', id:session.id, date, title:session.spot?.name || 'Surf', location:session.spot?.general_location || '', live:session.when_label === 'Now' };
    });
  const events = state.events
    .filter(event => event.region_id === state.currentRegion.id && event.start_time && !isPastEvent(event))
    .map(event => ({ type:'event', id:event.id, date:new Date(event.start_time), title:event.title, location:event.location_text || event.venue_name || event.spot?.general_location || '' }));
  return [...surfs, ...events].filter(item => Number.isFinite(item.date.getTime())).sort((a, b) => a.date - b.date);
}

function calendarAgendaTime(item) {
  if (item.live) return 'Out now';
  return new Intl.DateTimeFormat([], { hour:'numeric', minute:'2-digit' }).format(item.date);
}

function renderCalendar() {
  const grid = $('#calendarGrid');
  const agenda = $('#calendarAgenda');
  if (!grid || !agenda || !state.currentRegion) return;
  const today = new Date();
  const items = calendarItems();
  if (!state.calendarMonth) state.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const month = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
  state.calendarMonth = month;
  $('#calendarRegionName').textContent = `${state.currentRegion.name} · surfs and events`;
  $('#calendarMonthLabel').textContent = new Intl.DateTimeFormat([], { month:'long', year:'numeric' }).format(month);

  const monthItems = items.filter(item => item.date.getFullYear() === month.getFullYear() && item.date.getMonth() === month.getMonth());
  const todayKey = calendarDateKey(today);
  if (!state.calendarDate || !state.calendarDate.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`)) {
    state.calendarDate = monthItems[0] ? calendarDateKey(monthItems[0].date) : (today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth() ? todayKey : calendarDateKey(month));
  }

  const byDay = new Map();
  items.forEach(item => {
    const key = calendarDateKey(item.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  });
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  grid.innerHTML = Array.from({ length:42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = calendarDateKey(date);
    const dayItems = byDay.get(key) || [];
    const surfCount = dayItems.filter(item => item.type === 'surf').length;
    const eventCount = dayItems.filter(item => item.type === 'event').length;
    const outside = date.getMonth() !== month.getMonth();
    const label = new Intl.DateTimeFormat([], { weekday:'long', month:'long', day:'numeric' }).format(date);
    return `<button class="calendar-day ${outside ? 'outside' : ''} ${key === todayKey ? 'today' : ''} ${key === state.calendarDate ? 'selected' : ''}" data-calendar-date="${key}" role="gridcell" aria-label="${esc(label)}${dayItems.length ? `, ${dayItems.length} planned` : ''}"><b>${date.getDate()}</b><span>${surfCount ? `<i class="surf-dot"></i>` : ''}${eventCount ? `<i class="event-dot"></i>` : ''}</span></button>`;
  }).join('');

  const selected = new Date(`${state.calendarDate}T12:00:00`);
  const selectedItems = byDay.get(state.calendarDate) || [];
  const heading = new Intl.DateTimeFormat([], { weekday:'long', month:'long', day:'numeric' }).format(selected);
  agenda.innerHTML = `<div class="calendar-agenda-heading"><span>DAY PLAN</span><h3>${esc(heading)}</h3></div>${selectedItems.length ? selectedItems.map(item => `<article class="calendar-agenda-item ${item.type}"><i></i><div><b>${esc(item.title)}</b><span>${esc(calendarAgendaTime(item))}${item.location ? ` · ${esc(item.location)}` : ''}</span></div><button data-view="${item.type === 'surf' ? 'surfing' : 'events'}">View</button></article>`).join('') : `<div class="calendar-empty"><b>Nothing planned yet</b><span>Start a session or add an event for this day.</span></div>`}`;
}

async function openCrewCalendar() {
  state.eventRegion = state.currentRegion;
  renderEventRegions();
  if (!state.preview) await loadEvents();
  const upcoming = calendarItems().find(item => item.date >= new Date(new Date().setHours(0, 0, 0, 0)));
  const anchor = upcoming?.date || new Date();
  state.calendarMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  state.calendarDate = upcoming ? calendarDateKey(upcoming.date) : calendarDateKey(new Date());
  renderCalendar();
  setView('calendar');
}

async function openEventsCalendar() {
  if (state.eventRegion && state.eventRegion.id !== state.currentRegion.id) {
    state.currentRegion = state.eventRegion;
    renderChrome();
    if (state.preview) {
      state.sessions = state.previewSessions.filter(session => session.region_id === state.currentRegion.id);
      renderSessions();
    } else {
      await loadSessions();
    }
  }
  await openCrewCalendar();
}

function changeCalendarMonth(offset) {
  const current = state.calendarMonth || new Date();
  state.calendarMonth = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  state.calendarDate = '';
  renderCalendar();
}

function spotMapUrl(spot) {
  if (!spot?.general_location) return '';
  const query = [spot.name, spot.general_location].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderSessions() {
  const now = Date.now();
  const active = state.sessions.filter(session => !isPastSession(session, now));
  const past = state.sessions.filter(session => isPastSession(session, now)).sort((a, b) => new Date(b.ended_at || b.surf_time || b.created_at || 0) - new Date(a.ended_at || a.surf_time || a.created_at || 0));
  const liveNow = active.filter(session => session.when_label === 'Now').length;
  const planned = active.length - liveNow;
  $('#liveCount').innerHTML = liveNow
    ? `<i></i>${liveNow} IN THE WATER${planned ? ` · ${planned} PLANNED` : ''}`
    : (planned ? `${planned} PLANNED` : 'NO SURFS PLANNED');
  const feed = $('#sessionsFeed');
  if (!state.sessions.length) {
    feed.innerHTML = `<div class="empty"><span>OPEN</span><h2>No surfs planned in ${esc(state.currentRegion.name)} yet</h2><p>Share when you're heading out and give the crew something to join.</p></div>`;
    return;
  }
  const orderedSessions = [...active].sort((first, second) => {
    const firstNow = first.when_label === 'Now';
    const secondNow = second.when_label === 'Now';
    if (firstNow !== secondNow) return firstNow ? -1 : 1;
    return new Date(first.surf_time || first.created_at || 0) - new Date(second.surf_time || second.created_at || 0);
  });
  const renderSessionCard = (session, pastSession = false) => {
    const mine = session.author === state.profile.id;
    const rsvps = session.session_rsvps || [];
    const myRsvp = rsvps.find(rsvp => rsvp.user_id === state.profile.id);
    const surfers = [session.author_role === 'surf' ? session.author_profile?.name : null, ...(session.participant_names || []), session.featured_surfer_name, ...rsvps.filter(rsvp => rsvp.role === 'surf').map(rsvp => rsvp.profile?.name)]
      .filter(Boolean)
      .filter((name, index, names) => names.findIndex(item => item.toLowerCase() === name.toLowerCase()) === index);
    const filmers = [session.author_role === 'film' ? session.author_profile?.name : null, ...rsvps.filter(rsvp => rsvp.role === 'film').map(rsvp => rsvp.profile?.name)].filter((name, index, names) => name && names.indexOf(name) === index);
    const edit = mine ? `<button class="session-edit-icon" data-edit-session="${session.id}" aria-label="${pastSession ? 'Edit finished surf' : 'Edit surf'}"><svg><use href="#i-edit"/></svg></button>` : '';
    const share = !pastSession ? `<button class="session-share-icon" data-share-session="${session.id}" aria-label="Share this surf"><svg><use href="#i-share"/></svg></button>` : '';
    const sessionState = !pastSession && mine
      ? (session.when_label === 'Now'
        ? `<button class="session-state-icon stop" data-end-session="${session.id}" aria-label="Stop surf" title="Stop surf"><svg><use href="#i-stop"/></svg></button>`
        : `<button class="session-state-icon start" data-start-session="${session.id}" aria-label="Start surf" title="Start surf"><svg><use href="#i-play"/></svg></button>`)
      : '';
    const sendClips = pastSession && (mine || myRsvp?.role === 'film') ? `<button class="session-send-clips" data-session-clips="${session.id}" aria-label="Send clips from this session" title="Send clips"><svg><use href="#i-folder"/></svg></button>` : '';
    const tools = pastSession ? `<div class="session-card-tools"><span class="past-badge">Finished</span>${edit}</div>` : `<div class="session-card-tools">${sessionState}${share}${edit}</div>`;
    const surfAction = `<button class="small-action surf ${myRsvp?.role === 'surf' ? 'on' : ''}" data-rsvp="${session.id}" data-role="surf"><svg><use href="#i-surf"/></svg>${myRsvp?.role === 'surf' ? 'Surfing ✓' : 'Join surf'}</button>`;
    const filmAction = (session.wants_filmer || myRsvp?.role === 'film')
      ? `<button class="small-action film ${myRsvp?.role === 'film' ? 'on' : ''}" data-rsvp="${session.id}" data-role="film"><svg><use href="#i-camera"/></svg>${myRsvp?.role === 'film' ? 'Filming ✓' : (filmers.length ? 'Film too' : 'I can film')}</button>`
      : '';
    const actions = pastSession || mine ? '' : `${surfAction}${filmAction}`;
    const mapUrl = spotMapUrl(session.spot);
    const location = session.spot?.general_location ? `<a class="spot-location" href="${esc(mapUrl)}" target="_blank" rel="noopener"><svg><use href="#i-pin"/></svg>${esc(session.spot.general_location)}</a>` : '';
    const surferNames = surfers.length ? surfers.map(name => `<b>${esc(name)}</b>`).join('') : '<em>Open</em>';
    const filmerNames = filmers.length ? filmers.map(name => `<b>${esc(name)}</b>`).join('') : '<em>Open</em>';
    const filmerRow = (session.wants_filmer || filmers.length)
      ? `<div class="session-crew-row filmers"><span><svg><use href="#i-camera"/></svg>FILMERS</span><div>${filmerNames}</div></div>`
      : '';
    const initiator = session.initiator_profile || (session.initiator_user === session.author ? session.author_profile : null);
    const initiatorName = initiator?.name || session.initiator_name || session.author_profile?.name || 'Sodium member';
    const addedBy = session.author_profile?.name && session.author_profile.name !== initiatorName ? `<small>Added by ${esc(session.author_profile.name)}</small>` : '';
    const starter = `<div class="session-attribution">${avatarMarkup(initiator || { name:initiatorName }, 'session-starter-avatar')}<span><b>${esc(initiatorName)}</b> initiated this session${addedBy}</span></div>`;
    const claimInvite = !pastSession && mine && !session.initiator_user && session.initiator_name ? `<button class="claim-invite" data-invite-session-claim="${session.id}">Invite ${esc(session.initiator_name)} to claim this surf</button>` : '';
    const schedule = pastSession
      ? schedulePills(scheduleParts(session.surf_time || session.ended_at || session.created_at), 'session-schedule')
      : sessionSchedulePills(session);
    const timingClass = pastSession ? 'past-card' : (session.when_label === 'Now' ? 'live-session' : 'future-session');
    return `<article class="session-card ${mine ? 'mine' : ''} ${session.wants_filmer ? 'wants' : ''} ${session.author_role === 'film' ? 'filming' : ''} ${timingClass}" data-session-id="${session.id}"><i class="stripe"></i><div class="session-card-heading"><strong>${esc(session.spot?.name || 'Spot TBD')}</strong>${tools}</div>${schedule}${location}${starter}${session.note ? `<p class="session-note">${esc(session.note)}</p>` : ''}<div class="session-crew"><div class="session-crew-row surfers"><span><svg><use href="#i-surf"/></svg>SURFERS</span><div>${surferNames}</div></div>${filmerRow}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}${claimInvite}${sendClips}</article>`;
  };
  const activeMarkup = orderedSessions.length
    ? orderedSessions.map(session => renderSessionCard(session)).join('')
    : '<div class="empty compact-empty"><span>OPEN</span><h2>No active surfs</h2><p>Finished sessions are saved below.</p></div>';
  const pastMarkup = past.length ? `<details class="past-items"><summary><span><b>Past sessions</b><small>${past.length} finished</small></span><svg><use href="#i-chevron"/></svg></summary><div>${past.map(session => renderSessionCard(session, true)).join('')}</div></details>` : '';
  feed.innerHTML = `${activeMarkup}${pastMarkup}`;
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
  $('#sessionPeopleChips').innerHTML = state.sessionPeople.map((name, index) => {
    const member = state.people.find(person => person.name.toLowerCase() === name.toLowerCase());
    return `<button type="button" class="${member ? 'linked-member' : ''}" data-remove-session-person="${index}" title="${member ? 'Sodium member' : 'Added by name'}">${member ? `<svg><use href="#i-user"/></svg>` : ''}${esc(name)}<span>×</span></button>`;
  }).join('');
}

function renderSessionMemberSuggestions(rawQuery = $('#sessionPersonInput').value) {
  const target = $('#sessionMemberSuggestions');
  const query = rawQuery.trim().toLowerCase();
  if (!query) { target.innerHTML = ''; target.classList.remove('open'); return; }
  const selected = new Set(state.sessionPeople.map(name => name.toLowerCase()));
  const matches = state.people.filter(person => {
    if (person.id === state.profile.id || selected.has(person.name.toLowerCase())) return false;
    return person.name.toLowerCase().includes(query) || (person.nickname || '').toLowerCase().includes(query);
  }).slice(0, 6);
  target.innerHTML = matches.map(person => {
    const region = state.regions.find(item => item.id === person.home_region)?.name || 'Sodium member';
    const nickname = person.nickname ? ` · ${esc(person.nickname)}` : '';
    return `<button type="button" data-session-member="${person.id}">${avatarMarkup(person, 'member-suggestion-avatar')}<span><b>${esc(person.name)}</b><small>${esc(region)}${nickname}</small></span><em>Add</em></button>`;
  }).join('');
  target.classList.toggle('open', matches.length > 0);
}

function addSessionPerson(rawName = $('#sessionPersonInput').value) {
  const names = rawName.split(',').map(name => name.trim()).filter(Boolean);
  names.forEach(name => {
    if (state.sessionPeople.length >= 20) return;
    if (!state.sessionPeople.some(existing => existing.toLowerCase() === name.toLowerCase()) && name.toLowerCase() !== state.profile.name.toLowerCase()) state.sessionPeople.push(name);
  });
  $('#sessionPersonInput').value = '';
  renderSessionPeopleChips();
  renderSessionMemberSuggestions('');
}

function resetSessionComposer() {
  state.editingSessionId = null;
  state.sessionPeople = [];
  $('#sessionForm').reset();
  $('#sessionSheetTitle').textContent = 'Create a session';
  $('#sessionCancel').classList.add('hidden');
  $('#sessionCancelNote').classList.add('hidden');
  $$('[data-when]').forEach(button => button.classList.toggle('active', button.dataset.when === 'now'));
  updateSessionRoleUi('surf');
  $('#sessionTime').value = '';
  updateDateChoiceLabels();
  renderSessionPeopleChips();
  renderSessionMemberSuggestions('');
  const admin = Boolean(state.profile?.is_admin);
  $('#sessionInitiatorFields').classList.toggle('hidden', !admin);
  $('#sessionPlanInvite').classList.toggle('hidden', !admin);
  if (admin) {
    $('#sessionInitiator').disabled = false;
    $('#sessionInitiatorName').disabled = false;
    $('#sessionInitiatorTransferNote').classList.add('hidden');
    $('#sessionInitiator').innerHTML = `<option value="${state.profile.id}">Me · ${esc(state.profile.name)}</option>` + state.people.filter(person => person.id !== state.profile.id).map(person => `<option value="${person.id}">${esc(person.name)} · Sodium member</option>`).join('') + '<option value="pending">Not on Sodium yet…</option>';
    $('#sessionInitiator').value = state.profile.id;
    $('#sessionInitiatorName').value = '';
    $('#sessionInitiatorNameRow').classList.add('hidden');
  }
}

function updateSessionRoleUi(role) {
  const isFilming = role === 'film';
  $$('[data-session-role]').forEach(button => button.classList.toggle('active', button.dataset.sessionRole === role));
  $('#wantsFilmerRow').classList.toggle('hidden', isFilming);
  $('#sessionPeopleLabel').textContent = isFilming ? 'Surfers coming' : 'Surfing with';
  $('#sessionPersonInput').placeholder = isFilming ? "Surfer's name" : "Crew member's name";
  if (isFilming) $('#wantsFilmer').checked = false;
  if (!state.editingSessionId) $('#sessionSubmit').textContent = isFilming ? 'Share filming session' : 'Share surf';
}

function openSessionComposer(sessionId = null) {
  resetSessionComposer();
  const session = sessionId ? state.sessions.find(item => item.id === sessionId && item.author === state.profile.id) : null;
  if (session) {
    state.editingSessionId = session.id;
    state.sessionPeople = [...(session.participant_names || (session.featured_surfer_name ? [session.featured_surfer_name] : []))];
    $('#sessionSheetTitle').textContent = 'Edit session';
    $('#sessionSubmit').textContent = 'Save changes';
    $('#sessionCancel').classList.remove('hidden');
    $('#sessionCancelNote').classList.remove('hidden');
    $('#sessionSpot').value = session.spot?.name || '';
    $('#sessionLocation').value = session.spot?.general_location || '';
    const later = session.when_label !== 'Now';
    $$('[data-when]').forEach(button => button.classList.toggle('active', button.dataset.when === (later ? 'later' : 'now')));
    if (session.surf_time) {
      const localDate = new Date(new Date(session.surf_time).getTime() - new Date(session.surf_time).getTimezoneOffset() * 60000);
      $('#sessionTime').value = localDate.toISOString().slice(0, 16);
    }
    if (later) ensureSessionTimeChoice();
    updateSessionRoleUi(session.author_role);
    $('#wantsFilmer').checked = session.wants_filmer;
    $('#sessionNote').value = session.note || '';
    if (state.profile.is_admin) {
      $('#sessionInitiator').value = session.initiator_user || 'pending';
      $('#sessionInitiatorName').value = session.initiator_user ? '' : (session.initiator_name || '');
      $('#sessionInitiatorNameRow').classList.toggle('hidden', Boolean(session.initiator_user));
      $('#sessionInitiatorTransferNote').classList.toggle('hidden', !session.initiator_points_awarded_at);
    }
    renderSessionPeopleChips();
  }
  openSheet('sessionSheet');
}

async function createSession(event) {
  event.preventDefault();
  const submit = $('#sessionForm button[type="submit"]'); submit.disabled = true;
  try {
    await joinLocation(state.currentRegion, false);
    if ($('#sessionPersonInput').value.trim()) addSessionPerson();
    const spot = await ensureSpot($('#sessionSpot').value, $('#sessionLocation').value, state.currentRegion.id);
    const later = $('[data-when="later"]').classList.contains('active');
    const surfTime = later ? $('#sessionTime').value : null;
    const existingSession = state.editingSessionId ? state.sessions.find(session => session.id === state.editingSessionId) : null;
    const editingPastSession = Boolean(existingSession && isPastSession(existingSession));
    if (later && !surfTime) throw new Error('Pick a date and time.');
    if (surfTime && new Date(surfTime) <= new Date() && !editingPastSession) throw new Error('Pick a future date and time.');
    const savedSurfTime = surfTime
      ? new Date(surfTime).toISOString()
      : existingSession?.when_label === 'Now'
        ? existingSession.surf_time
        : existingSession ? new Date().toISOString() : null;
    const payload = {
      author: state.profile.id, spot_id: spot.id, region_id: state.currentRegion.id,
      when_label: later ? 'Scheduled' : 'Now', surf_time: savedSurfTime,
      author_role: $('[data-session-role].active').dataset.sessionRole,
      featured_surfer_name: null, featured_surfer_user: null, participant_names: state.sessionPeople,
      wants_filmer: $('#wantsFilmer').checked, note: $('#sessionNote').value.trim() || null,
    };
    if (state.profile.is_admin) {
      const selectedInitiator = $('#sessionInitiator').value;
      payload.initiator_user = selectedInitiator === 'pending' ? null : selectedInitiator;
      payload.initiator_name = selectedInitiator === 'pending' ? $('#sessionInitiatorName').value.trim() : (memberById(selectedInitiator)?.name || state.profile.name);
      if (selectedInitiator === 'pending' && !payload.initiator_name) throw new Error('Add the first name of the person who initiated this surf.');
    }
    const result = state.editingSessionId
      ? await db.from('sessions').update(payload).eq('id', state.editingSessionId).eq('author', state.profile.id)
      : await db.from('sessions').insert(payload);
    if (result.error) throw result.error;
    const edited = Boolean(state.editingSessionId);
    resetSessionComposer(); closeSheet(); await loadSessions(); await renderProfile(); toast(edited ? 'Session updated.' : 'Your session is live.');
  } catch (error) { toast(readableError(error)); }
  finally { submit.disabled = false; }
}

async function setRsvp(sessionId, role) {
  const existing = state.sessions.find(session => session.id === sessionId)?.session_rsvps.find(rsvp => rsvp.user_id === state.profile.id);
  const leaving = existing?.role === role;
  const result = existing?.role === role
    ? await db.from('session_rsvps').delete().eq('id', existing.id)
    : await db.from('session_rsvps').upsert({ session_id: sessionId, user_id: state.profile.id, role }, { onConflict: 'session_id,user_id' });
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); await renderProfile();
  toast(leaving ? (role === 'film' ? 'You are no longer filming this surf.' : 'You left this surf.') : (role === 'film' ? 'You are filming this surf.' : 'You joined this surf.'));
}

async function startSession(sessionId) {
  const result = await db.from('sessions').update({ when_label: 'Now', surf_time: new Date().toISOString() }).eq('id', sessionId).eq('author', state.profile.id).eq('status', 'active');
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); toast('Session started — the crew can see you are out now.');
}

async function endSession(sessionId) {
  if (!confirm('Stop this surf and move it to Past sessions? If it was cancelled, use the pencil and Cancel session instead.')) return;
  const result = await db.from('sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId).eq('author', state.profile.id);
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); toast('Surf stopped and moved to Past sessions.');
}

async function cancelSession() {
  const sessionId = state.editingSessionId;
  if (!sessionId || !confirm('Cancel this session? It will disappear for everyone. This cannot be undone.')) return;
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
    .select('*,spot:spots(*),author_profile:profiles!posts_author_fkey(id,name),stream_media:post_stream_media(*),post_likes(user_id),post_comments(id,body,created_at,author_profile:profiles!post_comments_author_fkey(id,name))')
    .order('created_at', { ascending: false }).limit(50);
  if (result.error) { toast(readableError(result.error)); return; }
  const posts = result.data || [];
  state.posts = await Promise.all(posts.map(async post => {
    if (post.media_type === 'clip' && post.stream_media?.length) {
      const streamMedia = await Promise.all(post.stream_media.sort((a, b) => a.position - b.position).map(resolveStreamMedia));
      return { ...post, stream_media:streamMedia, media_url:null, media_urls:[] };
    }
    const paths = post.media_type === 'photo' && Array.isArray(post.media_paths) && post.media_paths.length
      ? post.media_paths
      : (post.media_path ? [post.media_path] : []);
    if (!paths.length) {
      const externalUrl = safeExternalUrl(post.media_url);
      return { ...post, media_url:externalUrl, media_urls:externalUrl ? [externalUrl] : [] };
    }
    const signed = await Promise.all(paths.map(async path => {
      const result = await db.storage.from(CONFIG.mediaBucket).createSignedUrl(path, 3600);
      return result.error ? null : result.data.signedUrl;
    }));
    const mediaUrls = signed.filter(Boolean);
    return { ...post, media_url:mediaUrls[0] || null, media_urls:mediaUrls };
  }));
  renderPosts();
}

async function streamRequest(path, options = {}) {
  const session = state.session || (await db.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error('Sign in again before uploading clips.');
  const response = await fetch(`/api/stream${path}`, {
    ...options,
    headers: {
      Authorization:`Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(payload.error || 'Cloudflare Stream is unavailable.');
  return payload;
}

async function resolveStreamMedia(item) {
  if (item.status === 'ready' && item.preview_url) {
    return { ...item, iframe_url:item.preview_url.replace(/\/watch(?:\?.*)?$/, '/iframe') };
  }
  try {
    const status = await streamRequest(`/status/${encodeURIComponent(item.stream_uid)}`);
    const next = {
      ...item,
      status:status.ready ? 'ready' : (status.state === 'error' ? 'error' : 'processing'),
      duration_seconds:status.duration,
      input_width:status.width,
      input_height:status.height,
      preview_url:status.previewUrl || null,
      thumbnail_url:status.thumbnailUrl || null,
      error_message:status.error || null,
      iframe_url:status.iframeUrl || null,
      progress:status.progress || 0,
    };
    if (item.creator === state.profile?.id && (
      next.status !== item.status || next.preview_url !== item.preview_url || next.thumbnail_url !== item.thumbnail_url
    )) {
      const updated = await db.from('post_stream_media').update({
        status:next.status,
        duration_seconds:next.duration_seconds,
        input_width:next.input_width,
        input_height:next.input_height,
        preview_url:next.preview_url,
        thumbnail_url:next.thumbnail_url,
        error_message:next.error_message,
        updated_at:new Date().toISOString(),
      }).eq('id', item.id).eq('creator', state.profile.id);
      if (updated.error) console.warn('Stream status cache failed:', updated.error.message);
    }
    return next;
  } catch (error) {
    return { ...item, status:item.status || 'processing', stream_error:readableError(error) };
  }
}

function normalizedPostRatio(value) {
  return ['original', 'square', 'portrait', 'landscape'].includes(value) ? value : 'original';
}

function selectedPostRatio() {
  return normalizedPostRatio($('input[name="postRatio"]:checked')?.value);
}

function applyPostRatioPreview() {
  const preview = $('#postRatioPreview');
  if (!preview) return;
  preview.dataset.ratio = selectedPostRatio();
  const kind = selectedPostKind();
  $('#postRatioHelp').textContent = selectedPostRatio() === 'original'
    ? `Original keeps ${kind === 'photo' ? 'every photo' : 'the clip'} exactly as shot.`
    : `This shape crops the ${kind === 'photo' ? 'photos' : 'clip'} visually to fill the selected frame. The uploaded file is not altered.`;
}

function setPostRatio(value) {
  const ratio = normalizedPostRatio(value);
  const option = $(`input[name="postRatio"][value="${ratio}"]`);
  if (option) option.checked = true;
  applyPostRatioPreview();
}

function syncPostCarouselFrame(carousel, index) {
  const media = carousel.closest('.post-media');
  if (!media?.classList.contains('ratio-original')) return;
  const image = $$('.post-carousel-track img', carousel)[index];
  if (!image) return;
  const apply = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    media.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
  };
  if (image.complete) apply();
  else image.addEventListener('load', apply, { once:true });
}

function updatePostCarousel(carousel, requestedIndex) {
  const track = $('.post-carousel-track', carousel);
  const total = Number(carousel.dataset.carouselTotal || 1);
  const index = Math.max(0, Math.min(total - 1, requestedIndex));
  carousel.dataset.carouselIndex = String(index);
  $('.post-carousel-counter b', carousel).textContent = String(index + 1);
  syncPostCarouselFrame(carousel, index);
  track.scrollTo({ left:index * track.clientWidth, behavior:'smooth' });
}

function bindPostCarousels() {
  $$('[data-post-carousel]').forEach(carousel => {
    const track = $('.post-carousel-track', carousel);
    syncPostCarouselFrame(carousel, Number(carousel.dataset.carouselIndex || 0));
    let frame = null;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        carousel.dataset.carouselIndex = String(index);
        $('.post-carousel-counter b', carousel).textContent = String(index + 1);
        syncPostCarouselFrame(carousel, index);
      });
    }, { passive:true });
  });
}

function streamSlideMarkup(item, index) {
  if (item.status === 'ready' && item.iframe_url) {
    return `<div class="post-stream-slide"><iframe src="${esc(item.iframe_url)}" title="Sodium clip ${index + 1}" loading="${index ? 'lazy' : 'eager'}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (item.status === 'error') {
    return `<div class="post-stream-slide stream-state error"><svg><use href="#i-close"/></svg><b>Clip could not process</b><small>${esc(item.error_message || 'Try uploading this clip again.')}</small></div>`;
  }
  return `<div class="post-stream-slide stream-state"><span class="stream-spinner"></span><b>Clip processing</b><small>${item.progress ? `${Math.round(item.progress)}% encoded` : 'Cloudflare is preparing smooth playback.'}</small></div>`;
}

function streamCarouselMarkup(items) {
  const slides = items.map(streamSlideMarkup).join('');
  if (items.length === 1) return slides;
  return `<div class="post-carousel post-stream-carousel" data-post-carousel data-carousel-index="0" data-carousel-total="${items.length}"><div class="post-carousel-track">${slides}</div><button class="post-carousel-arrow previous" type="button" data-carousel-direction="-1" aria-label="Previous clip"><svg><use href="#i-back"/></svg></button><button class="post-carousel-arrow next" type="button" data-carousel-direction="1" aria-label="Next clip"><svg><use href="#i-chevron"/></svg></button><span class="post-carousel-counter"><b>1</b>/${items.length}</span></div>`;
}

function renderPosts() {
  const feed = $('#postsFeed');
  if (!state.posts.length) {
    feed.innerHTML = '<div class="empty"><span>STOKE</span><h2>No photos or clips yet</h2><p>Share the first photo or clip. Photographers and filmers are always credited.</p></div>';
    return;
  }
  feed.innerHTML = state.posts.map(post => {
    const liked = post.post_likes.some(like => like.user_id === state.profile.id);
    const photoUrls = post.media_urls?.length ? post.media_urls : (post.media_url ? [post.media_url] : []);
    const media = post.media_type === 'clip' && post.stream_media?.length
      ? streamCarouselMarkup(post.stream_media)
      : post.media_url
      ? (post.media_type === 'clip'
        ? `<video src="${esc(post.media_url)}" controls preload="metadata" playsinline></video>`
        : photoUrls.length > 1
          ? `<div class="post-carousel" data-post-carousel data-carousel-index="0" data-carousel-total="${photoUrls.length}"><div class="post-carousel-track">${photoUrls.map((url, index) => `<img src="${esc(url)}" alt="${esc(post.caption || `Surf photo ${index + 1}`)}" loading="${index ? 'lazy' : 'eager'}">`).join('')}</div><button class="post-carousel-arrow previous" type="button" data-carousel-direction="-1" aria-label="Previous photo"><svg><use href="#i-back"/></svg></button><button class="post-carousel-arrow next" type="button" data-carousel-direction="1" aria-label="Next photo"><svg><use href="#i-chevron"/></svg></button><span class="post-carousel-counter"><b>1</b>/${photoUrls.length}</span></div>`
          : `<img src="${esc(post.media_url)}" alt="${esc(post.caption || 'Surf photo')}">`)
      : '<div class="post-media-unavailable">Media unavailable</div>';
    const comments = post.post_comments.slice(-3).map(comment => `<p class="comment"><b>${esc(comment.author_profile?.name || 'Crew')}</b> ${esc(comment.body)}</p>`).join('');
    const edit = post.author === state.profile.id ? `<button class="post-edit-icon" type="button" data-edit-post="${post.id}" aria-label="Edit your Stoke post"><svg><use href="#i-edit"/></svg></button>` : '';
    const ratio = normalizedPostRatio(post.media_ratio);
    const firstStream = post.stream_media?.[0];
    const streamRatio = ratio === 'original' && firstStream
      ? (firstStream.input_width && firstStream.input_height ? `${firstStream.input_width}/${firstStream.input_height}` : '16/9')
      : '';
    const mediaStyle = streamRatio ? ` style="aspect-ratio:${esc(streamRatio)}"` : '';
    const creatorRole = post.media_type === 'photo' ? 'Photographer' : 'Filmer';
    const subjectRole = post.media_type === 'photo' ? 'People' : 'Surfer';
    const boardCredit = post.media_type === 'clip' && post.board ? `<span class="credit"><b>Board</b>${esc(post.board)}</span>` : '';
    return `<article class="post-card"><div class="post-media ratio-${ratio}"${mediaStyle}>${media}<span class="post-author">${esc(post.spot?.name || post.author_profile?.name || 'Sodium')}</span>${edit}<div class="post-overlay"><div class="credits">${post.surfer_name ? `<span class="credit"><b>${subjectRole}</b>${esc(post.surfer_name)}</span>` : ''}${boardCredit}<span class="credit filmer"><b>${creatorRole}</b>${esc(post.filmer_name)}</span></div>${post.caption ? `<p class="post-caption">${esc(post.caption)}</p>` : ''}</div></div><div class="post-foot"><button data-like="${post.id}" class="${liked ? 'liked' : ''}"><svg><use href="#i-heart"/></svg>${post.post_likes.length}</button><button data-comment-toggle="${post.id}"><svg><use href="#i-chat"/></svg>${post.post_comments.length}</button><small>◎ Everyone sees this</small></div><div class="comments" data-comments="${post.id}">${comments}<form class="comment-form" data-comment-form="${post.id}"><input maxlength="1000" required placeholder="Add a comment…"><button>↑</button></form></div></article>`;
  }).join('');
  bindPostCarousels();
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
  if (file.type.startsWith('video/')) {
    if (file.size > CONFIG.maxStreamClipBytes) throw new Error(`This clip is ${(file.size / 1073741824).toFixed(1)} GB. Each Cloudflare Stream clip must be 1 GB or smaller.`);
    const duration = await videoDuration(file);
    if (duration > CONFIG.maxClipSeconds + 0.5) throw new Error(`This clip is ${Math.ceil(duration)} seconds. Clips are capped at 90 seconds.`);
  } else if (file.size > CONFIG.maxUploadBytes) {
    throw new Error(`This photo is ${(file.size / 1048576).toFixed(0)} MB. Photos must be 50 MB or smaller.`);
  }
}

async function validatePostSelection(files) {
  if (!files.length) throw new Error('Choose photos or clips.');
  const kind = selectedPostKind();
  if (kind === 'photo' && files.some(file => !file.type.startsWith('image/'))) throw new Error('Photos is selected. Choose image files, or switch to Clip.');
  if (kind === 'clip' && files.some(file => !file.type.startsWith('video/'))) throw new Error('Clips is selected. Choose video files only.');
  if (kind === 'clip' && files.length > CONFIG.maxStreamClips) throw new Error(`A Stoke video carousel can have up to ${CONFIG.maxStreamClips} clips.`);
  if (kind === 'photo' && files.length > 10) throw new Error('A Stoke carousel can have up to 10 photos.');
  await Promise.all(files.map(validateMedia));
}

async function uploadMedia(file, path) {
  const result = await db.storage.from(CONFIG.mediaBucket).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (result.error) throw result.error;
  return path;
}

async function uploadStreamClip(file, progressCallback = () => {}) {
  const created = await streamRequest('/upload', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ filename:file.name, size:file.size }),
  });
  let offset = 0;
  const chunkSize = 8 * 1024 * 1024;
  try {
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      const response = await fetch(created.uploadUrl, {
        method:'PATCH',
        headers:{
          'Tus-Resumable':'1.0.0',
          'Upload-Offset':String(offset),
          'Content-Type':'application/offset+octet-stream',
        },
        body:chunk,
      });
      if (!response.ok) throw new Error(`Clip upload paused with status ${response.status}.`);
      offset = Number(response.headers.get('Upload-Offset')) || offset + chunk.size;
      progressCallback(offset / file.size);
    }
    return { uid:created.uid, duration:await videoDuration(file) };
  } catch (error) {
    try { await streamRequest(`/video/${encodeURIComponent(created.uid)}`, { method:'DELETE' }); }
    catch (_cleanupError) { /* Cloudflare will retain an incomplete upload until expiry. */ }
    throw error;
  }
}

function matchingPerson(name) {
  return state.people.find(person => person.name.toLowerCase() === name.trim().toLowerCase());
}

function selectedPostKind() {
  return $('input[name="postKind"]:checked')?.value === 'clip' ? 'clip' : 'photo';
}

function setPostKind(kind = 'photo', options = {}) {
  const postKind = kind === 'clip' ? 'clip' : 'photo';
  const editing = Boolean(options.editing);
  $$('input[name="postKind"]').forEach(input => {
    input.checked = input.value === postKind;
    input.disabled = editing;
  });
  const mediaInput = $('#mediaFile');
  $('#postRatioPreview').dataset.kind = postKind;
  mediaInput.accept = postKind === 'photo'
    ? 'image/jpeg,image/png,image/webp,image/gif'
    : 'video/mp4,video/quicktime,video/webm';
  mediaInput.multiple = true;
  $('#postMediaIcon use').setAttribute('href', postKind === 'photo' ? '#i-photo' : '#i-camera');
  $('#postCreatorLabel').textContent = postKind === 'photo' ? 'Photographer' : 'Filmer';
  $('#filmerName').placeholder = postKind === 'photo' ? "Photographer's name" : "Filmer's name";
  $('#postSubjectLabel').textContent = postKind === 'photo' ? 'People / subjects' : 'Surfer / shaper';
  $('#surferName').placeholder = postKind === 'photo' ? "Who's in these photos?" : "Who's in this clip?";
  $('#postBoardField').classList.toggle('hidden', postKind === 'photo');
  $('#postNotesLabel').textContent = postKind === 'photo' ? 'Photo notes' : 'Clip notes';
  $('#postCaption').placeholder = postKind === 'photo' ? 'Anything about these photos?' : 'Anything about this clip?';
  $('#postRatioPicker').classList.remove('hidden');
  $('#postRatioLegendLabel').textContent = postKind === 'photo' ? 'Photo shape' : 'Clip shape';
  if (!editing) {
    $('#postSheetTitle').textContent = postKind === 'photo' ? 'Share photos' : 'Share clips';
    $('#postSheetDescription').textContent = postKind === 'photo'
      ? 'Share up to 10 photos with the whole Sodium community.'
      : 'Share up to 5 clips with the whole Sodium community.';
    $('#fileLabel').textContent = postKind === 'photo' ? 'Choose up to 10 photos' : 'Choose up to 5 clips';
    $('#postMediaHelp').textContent = postKind === 'photo'
      ? 'Original shapes are preserved unless you choose a crop below.'
      : 'MP4, MOV, or WebM · 90 seconds and 1 GB max per clip.';
  }
  if (options.clearFile) {
    mediaInput.value = '';
    if (state.postPreviewUrl) URL.revokeObjectURL(state.postPreviewUrl);
    state.postPreviewUrl = '';
    $('#postRatioPreview').classList.add('hidden');
    $('#postRatioPreview img').removeAttribute('src');
    const video = $('#postRatioPreview video');
    video.pause(); video.removeAttribute('src'); video.load();
    setPostRatio('original');
  }
  applyPostRatioPreview();
}

function resetPostComposer() {
  state.editingPostId = null;
  if (state.postPreviewUrl) URL.revokeObjectURL(state.postPreviewUrl);
  state.postPreviewUrl = '';
  $('#postForm').reset();
  $('#postSheetTitle').textContent = 'Share a highlight';
  $('#postSheetDescription').textContent = 'Photo or clip—the whole community sees this, every area.';
  $('#postKindPicker').classList.remove('editing');
  $('#postMediaPicker').classList.remove('hidden');
  $('#mediaFile').required = true;
  $('#postRatioPreview').classList.add('hidden');
  $('#postRatioPreview').querySelector('img').removeAttribute('src');
  const previewVideo = $('#postRatioPreview video');
  previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.load();
  setPostRatio('original');
  setPostKind('photo');
  $('#postSubmit').textContent = 'Share to Stoke';
  $('#postDelete').classList.add('hidden');
  $('#postDeleteNote').classList.add('hidden');
}

function openPostComposer(postId = null) {
  resetPostComposer();
  const post = postId ? state.posts.find(item => item.id === postId && item.author === state.profile.id) : null;
  if (post) {
    state.editingPostId = post.id;
    $('#postSheetTitle').textContent = 'Edit Stoke post';
    $('#postSheetDescription').textContent = 'Update the details below. Your original photo or clip stays in place.';
    $('#postKindPicker').classList.add('editing');
    $('#postMediaPicker').classList.add('hidden');
    $('#mediaFile').required = false;
    setPostKind(post.media_type, { editing:true });
    $('#filmerName').value = post.filmer_name || '';
    $('#surferName').value = post.surfer_name || '';
    $('#boardName').value = post.board || '';
    $('#postSpot').value = post.spot?.general_location || post.spot?.name || '';
    $('#postLocation').value = '';
    $('#postCaption').value = post.caption || '';
    if (post.media_url) {
      $('#postRatioPicker').classList.remove('hidden');
      const previewImage = $('#postRatioPreview img');
      const previewVideo = $('#postRatioPreview video');
      if (post.media_type === 'photo') previewImage.src = post.media_url;
      else previewVideo.src = post.media_url;
      $('#postRatioPreview').classList.remove('hidden');
      setPostRatio(post.media_ratio);
    }
    $('#postSubmit').textContent = 'Save changes';
    $('#postDelete').classList.remove('hidden');
    $('#postDeleteNote').classList.remove('hidden');
  }
  openSheet('postSheet');
}

async function savePost(event) {
  event.preventDefault();
  const submit = $('#postSubmit'); submit.disabled = true;
  const progress = $('#uploadProgress');
  let streamUploads = [];
  let streamMediaLinked = false;
  let postId = state.editingPostId;
  try {
    const editing = state.editingPostId;
    const spotName = $('#postSpot').value.trim();
    const spot = spotName ? await ensureSpot(spotName, $('#postLocation').value, state.currentRegion.id) : null;
    const filmerName = $('#filmerName').value.trim();
    const surferName = $('#surferName').value.trim();
    const filmer = matchingPerson(filmerName);
    const surfer = surferName ? matchingPerson(surferName) : null;
    const details = {
      filmer_name: filmerName, filmer_user: filmer?.id || null, surfer_name: surferName || null,
      board: selectedPostKind() === 'clip' ? ($('#boardName').value.trim() || null) : null, spot_id: spot?.id || null,
      caption: $('#postCaption').value.trim() || null,
      media_ratio: selectedPostRatio(),
    };
    postId = editing;
    if (editing) {
      const updated = await db.from('posts').update(details).eq('id', editing).eq('author', state.profile.id).select('id').single();
      if (updated.error) throw updated.error;
      const removedTags = await db.from('post_tags').delete().eq('post_id', editing);
      if (removedTags.error) throw removedTags.error;
    } else {
      const files = [...$('#mediaFile').files];
      await validatePostSelection(files);
      const mediaType = selectedPostKind();
      const paths = [];
      progress.value = 8; progress.classList.remove('hidden');
      if (mediaType === 'clip') {
        for (let index = 0; index < files.length; index += 1) {
          const uploaded = await uploadStreamClip(files[index], fraction => {
            progress.value = 8 + Math.round(((index + fraction) / files.length) * 72);
          });
          streamUploads.push(uploaded);
        }
      } else {
        for (let index = 0; index < files.length; index += 1) {
          const selected = files[index];
          const extension = selected.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
          const path = `${state.profile.id}/${crypto.randomUUID()}.${extension}`;
          await uploadMedia(selected, path);
          paths.push(path);
          progress.value = 8 + Math.round(((index + 1) / files.length) * 72);
        }
      }
      const mediaUrl = mediaType === 'clip' ? `cloudflare-stream:${streamUploads[0].uid}` : paths[0];
      const mediaPath = mediaType === 'clip' ? `${state.profile.id}/stream/${streamUploads[0].uid}` : paths[0];
      progress.value = 82;
      const created = await db.from('posts').insert({ author: state.profile.id, media_url:mediaUrl, media_path:mediaPath, media_paths:paths, media_type:mediaType, ...details }).select('id').single();
      if (created.error) throw created.error;
      postId = created.data.id;
      if (mediaType === 'clip') {
        const rows = streamUploads.map((item, position) => ({
          post_id:postId,
          creator:state.profile.id,
          position,
          stream_uid:item.uid,
          status:'processing',
          duration_seconds:item.duration,
        }));
        const mediaResult = await db.from('post_stream_media').insert(rows);
        if (mediaResult.error) throw mediaResult.error;
        streamMediaLinked = true;
      }
    }
    const tags = [];
    if (filmer && filmer.id !== state.profile.id) tags.push({ post_id: postId, user_id: filmer.id, role: 'filmer' });
    if (surfer && surfer.id !== state.profile.id) tags.push({ post_id: postId, user_id: surfer.id, role: 'surfer' });
    if (tags.length) {
      const tagsResult = await db.from('post_tags').insert(tags);
      if (tagsResult.error) throw tagsResult.error;
    }
    progress.value = 100; resetPostComposer(); closeSheet();
    await loadPosts(); await renderProfile(); toast(editing ? 'Stoke post updated.' : 'Shared with the whole community.');
  } catch (error) {
    if (streamUploads.length && !streamMediaLinked) {
      await Promise.allSettled(streamUploads.map(item => streamRequest(`/video/${encodeURIComponent(item.uid)}`, { method:'DELETE' })));
      if (postId && !state.editingPostId) await db.from('posts').delete().eq('id', postId).eq('author', state.profile.id);
    }
    toast(readableError(error), 7000);
  }
  finally { submit.disabled = false; progress.classList.add('hidden'); progress.value = 0; }
}

async function deletePost() {
  const post = state.posts.find(item => item.id === state.editingPostId && item.author === state.profile.id);
  if (!post || !confirm('Delete this Stoke post? It will disappear for everyone and cannot be undone.')) return;
  const button = $('#postDelete'); button.disabled = true;
  try {
    const removed = await db.from('posts').delete().eq('id', post.id).eq('author', state.profile.id);
    if (removed.error) throw removed.error;
    if (post.stream_media?.length) {
      const cleanup = await Promise.allSettled(post.stream_media.map(item => streamRequest(`/video/${encodeURIComponent(item.stream_uid)}`, { method:'DELETE' })));
      cleanup.filter(result => result.status === 'rejected').forEach(result => console.warn('Stream cleanup failed:', result.reason));
    }
    if (!post.stream_media?.length) {
      const paths = Array.isArray(post.media_paths) && post.media_paths.length ? post.media_paths : [post.media_path];
      const media = await db.storage.from(CONFIG.mediaBucket).remove([...new Set(paths.filter(Boolean))]);
      if (media.error) console.warn('Stoke media cleanup failed:', media.error.message);
    }
    resetPostComposer(); closeSheet(); await loadPosts(); await renderProfile(); toast('Stoke post deleted.');
  } catch (error) { toast(readableError(error), 5000); }
  finally { button.disabled = false; }
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
  const [points, streak, posts, participation] = await Promise.all([
    db.from('points_events').select('points').eq('user_id', state.profile.id),
    db.from('streaks').select('*').eq('user_id', state.profile.id).maybeSingle(),
    db.from('posts').select('id', { count: 'exact', head: true }).eq('author', state.profile.id),
    db.rpc('get_profile_participation_stats', { target_user:state.profile.id }),
  ]);
  const total = (points.data || []).reduce((sum, event) => sum + event.points, 0);
  const participationStats = participation.error ? {} : participation.data || {};
  $('#profileView').innerHTML = profileMarkup(state.profile, {
    points:total, streak:streak.data?.current_streak || 0, stoke:participationStats.stoke ?? posts.count ?? 0,
    surfed:participationStats.surfed || 0, filmed:participationStats.filmed || 0,
    organized:participationStats.organized || 0, locations:participationStats.locations || 0, own:true,
  });
  $('#streakBadge b').textContent = streak.data?.current_streak || 0;
}

function profileMarkup(profile, stats = {}) {
  const region = state.regions.find(item => item.id === profile.home_region)?.name || 'Sodium Crew';
  const sponsors = profile.sponsors?.length ? profile.sponsors : [];
  const nickname = profile.nickname ? `<p class="nickname">“${esc(profile.nickname)}”</p>` : '';
  const socialUrl = safeExternalUrl(profile.social_url);
  const social = socialUrl ? `<a class="profile-link" href="${esc(socialUrl)}" target="_blank" rel="noopener">Social profile ↗</a>` : '';
  const listings = state.listings.filter(item => item.owner_id === profile.id && (item.status === 'approved' || canEditListing(item))).slice(0, 3);
  const listingSection = listings.length ? `<article class="profile-card profile-listings"><div class="profile-listings-header"><h3>Makes / does</h3><button data-view="marketplace">Marketplace →</button></div>${listings.map(item => `<button class="profile-listing" data-listing="${item.id}"><span><b>${esc(item.title)}</b><small>${esc(item.category)}${item.status !== 'approved' ? ` · ${esc(item.status)}` : ''}</small></span><i>›</i></button>`).join('')}</article>` : '';
  const controls = stats.own
    ? `<div class="profile-actions"><details class="profile-share-menu"><summary><svg><use href="#i-share"/></svg><span><b>Share with friends</b><small>Invites, surf plans, clips, and setup help</small></span><svg class="profile-share-chevron"><use href="#i-chevron"/></svg></summary><div><button data-action="open-share-invite"><svg><use href="#i-surf"/></svg><span><b>Share a surf or clips</b><small>Plan a surf, claim one, send clips, or send a simple invite.</small></span></button><button data-action="share-invite-overview"><svg><use href="#i-wave"/></svg><span><b>Invite + app overview</b><small>Send the invite with the quick visual explanation.</small></span></button><button data-action="share-invite-setup"><svg><use href="#i-settings"/></svg><span><b>Invite + phone setup</b><small>Send the invite with Home Screen setup instructions.</small></span></button></div></details><button class="secondary-button" data-view="members">View all members</button><button class="secondary-button" data-action="edit-profile">Edit profile</button></div>`
    : `<div class="profile-actions"><button class="primary" data-dm-member="${profile.id}">Message ${esc(profile.name)}</button></div>`;
  return `<div class="profile-head">${avatarMarkup(profile)}<div><h2>${esc(profile.name)}</h2>${nickname}<p>${esc(region)} · Sodium Crew</p></div></div>${stats.own ? `<section class="profile-stat-group"><div class="profile-stat-heading"><span>Community activity</span><small>Points, streak, and posts</small></div><div class="stats"><article class="profile-card stat"><b>${formatCount(stats.points)}</b><span>points</span></article><article class="profile-card stat"><b>${stats.streak || 0}</b><span>active streak</span></article><article class="profile-card stat"><b>${stats.stoke || 0}</b><span>Stoke shared</span></article></div></section><section class="profile-stat-group surf-stat-group"><div class="profile-stat-heading"><span>Surf stats</span><small>Completed sessions only</small></div><div class="participation-stats"><article class="profile-card stat"><b>${stats.surfed || 0}</b><span>surfed</span></article><article class="profile-card stat"><b>${stats.filmed || 0}</b><span>filmed</span></article><article class="profile-card stat"><b>${stats.organized || 0}</b><span>organized</span></article><article class="profile-card stat"><b>${stats.locations || 0}</b><span>locations</span></article></div></section>` : ''}<article class="profile-card"><h3>Sponsors</h3><div class="chips">${sponsors.length ? sponsors.map(name => `<span class="chip">${esc(name)}</span>`).join('') : '<span class="muted-copy">Independent</span>'}</div>${social}</article>${listingSection}${controls}<footer class="profile-footer"><b>SODIUM</b>surf with your friends, not your feed</footer>`;
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
    const region = state.regions.find(item => item.id === profile.home_region)?.name || 'Sodium Crew';
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_listings' }, async () => { await loadListings(); await renderProfile(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_messages' }, async () => await loadRoomMessages())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, async () => {
      if (state.activeDmMember && state.view === 'dm') await loadDmConversation();
      else await loadDmInbox();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clip_deliveries' }, async () => await loadClipDeliveries())
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
  const pages = $('#guidePages');
  if (!pages.childElementCount) {
    pages.innerHTML = Array.from({ length:GUIDE_PAGE_COUNT }, (_, index) => {
      const page = String(index + 1).padStart(2, '0');
      return `<img src="./docs/guide-v13/page-${page}.jpg" alt="Quick Start Guide page ${index + 1} of ${GUIDE_PAGE_COUNT}" loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async">`;
    }).join('');
  }
  viewer.classList.remove('hidden');
  pages.scrollTop = 0;
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
  return new File([await response.blob()], 'SODIUM_Quick_Start_Guide_V13.pdf', { type:'application/pdf' });
}

function overviewUrl() {
  return new URL(OVERVIEW_PATH, location.href).href;
}

async function overviewFile() {
  const response = await fetch(overviewUrl());
  if (!response.ok) throw new Error('The Sodium overview could not be loaded.');
  return new File([await response.blob()], 'SODIUM_App_Overview_One_Pager_V9.png', { type:'image/png' });
}

function setupGuideUrl() {
  return new URL(SETUP_PATH, location.href).href;
}

async function setupGuideFile() {
  const response = await fetch(setupGuideUrl());
  if (!response.ok) throw new Error('The Sodium phone setup guide could not be loaded.');
  return new File([await response.blob()], 'SODIUM_Setup_One_Pager_V2.png', { type:'image/png' });
}

async function taskGuideFile(path, filename) {
  const response = await fetch(new URL(path, location.href).href);
  if (!response.ok) throw new Error('The task guide could not be loaded.');
  return new File([await response.blob()], filename, { type:'image/png' });
}

async function shareSodiumContent({ title, text, url, file = null, copiedMessage }) {
  if (navigator.share) {
    try {
      if (file && navigator.canShare?.({ files:[file] })) {
        await navigator.share({ title, text, url, files:[file] });
      } else {
        await navigator.share({ title, text, url });
      }
      return;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // iOS can expire a share gesture while Sodium finishes creating an
      // invite. Fall through to copy/prompt so the link is never stranded.
    }
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
  const title = 'Sodium Quick Start Guide';
  const text = 'Here is the Sodium Quick Start Guide.';
  let file = null;
  try { file = await quickStartGuideFile(); }
  catch (_error) { /* The public guide link remains available as a fallback. */ }
  try {
    await shareSodiumContent({ title, text, url, file, copiedMessage:'Quick Start Guide link copied.' });
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy the Quick Start Guide link:', url);
  }
}

async function createContextInvite({ purpose, sessionId = null, deliveryId = null, name = '' }) {
  const region = state.currentRegion || state.regions.find(item => item.id === state.profile.home_region);
  const result = await db.rpc('create_context_invite', {
    invite_region:region?.id || null,
    invite_purpose:purpose,
    claim_session:sessionId,
    claim_delivery:deliveryId,
    invite_name:name || null,
  });
  if (result.error) throw result.error;
  return { code:result.data, region };
}

async function sharePlanSurfInvite(event) {
  event?.preventDefault();
  const name = $('#planInviteName').value.trim();
  if (!name) return;
  try {
    const invite = await createContextInvite({ purpose:'plan_session', name });
    const url = new URL('./', location.href); url.search = ''; url.hash = '';
    url.searchParams.set('invite', invite.code); url.searchParams.set('open', 'plan-surf');
    if (invite.region?.id) url.searchParams.set('region', invite.region.id);
    const text = `Yo ${name} — use this Sodium invite to post the surf you’re planning. Add the spot, time, surfers, and whether you want clips. You’ll get the organizer credit.`;
    closeSheet();
    let file = null;
    try { file = await taskGuideFile(PLAN_SURF_PATH, 'SODIUM_Plan_A_Surf_One_Pager_V1.png'); } catch (_error) { /* Link remains available. */ }
    await shareSodiumContent({ title:'Plan a surf on Sodium', text, url:url.href, file, copiedMessage:`Planning invite for ${name} copied.` });
  } catch (error) { if (error?.name !== 'AbortError') toast(readableError(error), 6000); }
}

async function shareSessionClaimInvite(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId && item.author === state.profile.id && !item.initiator_user);
  if (!session) { toast('That surf is already claimed.'); return; }
  try {
    const invite = await createContextInvite({ purpose:'claim_session', sessionId, name:session.initiator_name });
    const url = new URL('./', location.href); url.search = ''; url.hash = '';
    url.searchParams.set('invite', invite.code); url.searchParams.set('open', 'claim-session'); url.searchParams.set('session', session.id);
    if (invite.region?.id) url.searchParams.set('region', invite.region.id);
    const text = `Yo ${session.initiator_name} — I added the ${session.spot?.name || 'surf'} session you organized to Sodium. Join here to claim it and its organizer credit.`;
    let file = null;
    try { file = await taskGuideFile(PLAN_SURF_PATH, 'SODIUM_Plan_A_Surf_One_Pager_V1.png'); } catch (_error) { /* Link remains available. */ }
    await shareSodiumContent({ title:'Claim your surf on Sodium', text, url:url.href, file, copiedMessage:`Claim invite for ${session.initiator_name} copied.` });
  } catch (error) { if (error?.name !== 'AbortError') toast(readableError(error), 6000); }
}

async function shareClipClaimInvite(deliveryId) {
  const delivery = state.clipDeliveries.find(item => item.id === deliveryId && item.sender === state.profile.id);
  if (!delivery) { toast('That delivery is no longer available.'); return; }
  if (delivery.recipient) { await shareExistingClipDelivery(deliveryId); return; }
  const name = delivery.recipient_name || 'dude';
  const copy = clipShareCopy(delivery, name);
  try {
    const invite = await createContextInvite({ purpose:'claim_delivery', deliveryId, name });
    const url = new URL('./', location.href); url.search = ''; url.hash = '';
    url.searchParams.set('invite', invite.code); url.searchParams.set('open', 'claim-delivery'); url.searchParams.set('delivery', delivery.id);
    const text = `${copy.sentence} Join Sodium here and the delivery opens automatically. You can sign in with Google or use your email, then save Sodium to your phone or computer.`;
    let file = null;
    try { file = await taskGuideFile(GET_CLIPS_PATH, 'SODIUM_Get_Your_Clips_One_Pager_V1.png'); } catch (_error) { /* Link remains available. */ }
    await shareSodiumContent({ title:'Your clips on Sodium', text, url:url.href, file, copiedMessage:`Clip invite for ${copy.greeting} copied.` });
  } catch (error) { if (error?.name !== 'AbortError') toast(readableError(error), 6000); }
}

async function shareExistingClipDelivery(deliveryId) {
  const delivery = state.clipDeliveries.find(item => item.id === deliveryId && item.sender === state.profile.id && item.recipient);
  if (!delivery) { toast('That delivery is not available to share.'); return; }
  const name = delivery.recipient_profile?.name || delivery.recipient_name || 'dude';
  const copy = clipShareCopy(delivery, name);
  const url = new URL('./', location.href); url.search = ''; url.hash = '';
  url.searchParams.set('open', 'clips'); url.searchParams.set('delivery', delivery.id);
  const text = `${copy.sentence} Open it here to get the folder or message me about a missing wave.`;
  let file = null;
  try { file = await taskGuideFile(GET_CLIPS_PATH, 'SODIUM_Get_Your_Clips_One_Pager_V1.png'); } catch (_error) { /* Delivery link remains available. */ }
  try { await shareSodiumContent({ title:'Your Sodium clip delivery', text, url:url.href, file, copiedMessage:`${copy.greeting}’s clip delivery copied.` }); }
  catch (error) { if (error?.name !== 'AbortError') prompt('Copy this clip delivery:', `${text}\n${url.href}`); }
}

async function shareGuestClipLink(deliveryId) {
  const delivery = state.clipDeliveries.find(item => item.id === deliveryId && item.sender === state.profile.id);
  if (!delivery) return;
  const result = await db.rpc('create_guest_clip_link', { target_delivery:delivery.id });
  if (result.error) { toast(readableError(result.error), 6000); return; }
  const url = new URL('./', location.href); url.search = ''; url.hash = ''; url.searchParams.set('guest-clips', result.data);
  const name = delivery.recipient_name || delivery.recipient_profile?.name || 'dude';
  const copy = clipShareCopy(delivery, name);
  const text = `${copy.sentence} Open the clips without an account, or join Sodium from the same page.`;
  let file = null;
  try { file = await taskGuideFile(GET_CLIPS_PATH, 'SODIUM_Get_Your_Clips_One_Pager_V1.png'); } catch (_error) { /* Link remains available. */ }
  try { await shareSodiumContent({ title:'Your clips from Sodium', text, url:url.href, file, copiedMessage:'Private guest clip link copied.' }); }
  catch (error) { if (error?.name !== 'AbortError') prompt('Copy this guest clip link:', `${text}\n${url.href}`); }
}

function openShareInviteHub() {
  closeDrawer();
  $('#sessionClaimList').classList.add('hidden');
  openSheet('shareInviteSheet');
}

function showSessionClaimList() {
  const pending = state.sessions.filter(session => session.author === state.profile.id && !session.initiator_user && session.initiator_name && !isPastSession(session));
  const target = $('#sessionClaimList');
  target.innerHTML = pending.length ? pending.map(session => `<button data-invite-session-claim="${session.id}"><b>${esc(session.initiator_name)} · ${esc(session.spot?.name || 'Surf')}</b><small>${esc(sessionWhen(session))}</small></button>`).join('') : '<small>No unclaimed sessions. Add one for a nonmember first, then it appears here.</small>';
  target.classList.remove('hidden');
}

function sessionShareUrl(session, includeInvite = false, inviteCode = '') {
  const region = state.regions.find(item => item.id === session.region_id) || state.currentRegion;
  const url = new URL('./', location.href);
  url.search = '';
  url.hash = '';
  if (includeInvite && inviteCode) url.searchParams.set('invite', inviteCode);
  if (region?.id) url.searchParams.set('region', region.id);
  url.searchParams.set('open', 'surfing');
  url.searchParams.set('session', session.id);
  return url;
}

function openSessionShare(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId);
  if (!session) { toast('That surf is no longer available.'); return; }
  state.sharingSessionId = sessionId;
  $('#sessionShareTitle').textContent = session.spot?.name || 'Share this surf';
  const members = state.people.filter(person => person.id !== state.profile.id);
  $('#sessionShareMembers').innerHTML = members.length
    ? members.map(person => `<button data-share-session-member="${person.id}">${avatarMarkup(person)}<span><b>${esc(person.name)}</b><small>Send inside Sodium</small></span><svg><use href="#i-send"/></svg></button>`).join('')
    : '<small>No other members have joined yet. Use the external invite for now.</small>';
  openSheet('sessionShareSheet');
}

async function shareSessionToMember(memberId) {
  const session = state.sessions.find(item => item.id === state.sharingSessionId);
  const member = state.people.find(item => item.id === memberId);
  if (!session || !member) { toast('That surf or member is no longer available.'); return; }
  const spot = session.spot?.name || 'Surf';
  const area = session.spot?.general_location ? ` · ${session.spot.general_location}` : '';
  const url = sessionShareUrl(session);
  const body = `${state.profile.name} shared a surf with you.\n${spot}${area}\n${sessionWhen(session)}\n${url.href}`;
  const result = await db.from('dm_messages').insert({ sender:state.profile.id, recipient:member.id, body });
  if (result.error) { toast(readableError(result.error), 6000); return; }
  closeSheet();
  state.sharingSessionId = null;
  toast(`Surf sent to ${member.name} inside Sodium.`);
}

async function shareSessionExternal(sessionId = state.sharingSessionId) {
  const session = state.sessions.find(item => item.id === sessionId);
  if (!session) { toast('That surf is no longer available.'); return; }
  const region = state.regions.find(item => item.id === session.region_id) || state.currentRegion;
  let invite = await db.rpc('create_invite', { invite_max_uses:1, invite_region:region?.id || null });
  if (invite.error && /create_invite/i.test(invite.error.message || '')) {
    invite = await db.rpc('create_invite', { invite_max_uses:1 });
  }
  if (invite.error) { toast(readableError(invite.error)); return; }

  const url = sessionShareUrl(session, true, invite.data);

  const spot = session.spot?.name || 'a surf';
  const area = session.spot?.general_location ? ` · ${session.spot.general_location}` : '';
  const roles = session.wants_filmer ? 'Join to surf or volunteer to film.' : 'Open it in Sodium to join the surf.';
  const text = `${state.profile.name} shared a surf with you on Sodium.\n\n${spot}${area}\n${sessionWhen(session)}\n${roles}`;
  try {
    await shareSodiumContent({
      title:`${spot} surf on Sodium`,
      text,
      url:url.href,
      copiedMessage:'Surf details and link copied.',
    });
    closeSheet();
    state.sharingSessionId = null;
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy this surf:', `${text}\n${url.href}`);
  }
}

async function shareEvent(eventId) {
  const item = state.events.find(event => event.id === eventId);
  if (!item) { toast('That event is no longer available.'); return; }
  const region = state.regions.find(region => region.id === item.region_id) || state.eventRegion || state.currentRegion;
  let invite = await db.rpc('create_invite', { invite_max_uses:1, invite_region:region?.id || null });
  if (invite.error && /create_invite/i.test(invite.error.message || '')) {
    invite = await db.rpc('create_invite', { invite_max_uses:1 });
  }
  if (invite.error) { toast(readableError(invite.error)); return; }

  const url = new URL('./', location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', invite.data);
  if (region?.id) url.searchParams.set('region', region.id);
  url.searchParams.set('open', 'events');
  url.searchParams.set('event', item.id);

  const place = [item.venue_name || item.spot?.name, item.location_text || item.spot?.general_location].filter(Boolean).join(' · ');
  const timing = scheduleParts(item.start_time, item.end_time);
  const text = `${state.profile.name} shared an event with you on Sodium.\n\n${item.title}\n${timing.date} · ${timing.time}${place ? `\n${place}` : ''}\nOpen it in Sodium to RSVP.`;
  try {
    await shareSodiumContent({
      title:`${item.title} on Sodium`,
      text,
      url:url.href,
      copiedMessage:'Event details and link copied.',
    });
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy this event:', `${text}\n${url.href}`);
  }
}

async function shareInvite({ includeGuide = false, includeOverview = false, includeSetup = false } = {}) {
  const inviteRegion = state.currentRegion || state.regions.find(region => region.id === state.profile.home_region);
  let result = await db.rpc('create_invite', { invite_max_uses:1, invite_region:inviteRegion?.id || null });
  if (result.error && /create_invite/i.test(result.error.message || '')) {
    result = await db.rpc('create_invite', { invite_max_uses:1 });
  }
  if (result.error) { toast(readableError(result.error)); return; }
  const url = new URL('./', location.href); url.searchParams.set('invite', result.data);
  if (inviteRegion?.id) url.searchParams.set('region', inviteRegion.id);
  const guideUrl = quickStartGuideUrl();
  const onePageUrl = overviewUrl();
  const setupUrl = setupGuideUrl();
  const title = "You're invited to Sodium";
  const text = includeGuide
    ? `I'm inviting you to Sodium${inviteRegion ? ` in ${inviteRegion.name}` : ''}, a private surf community. Hopefully it helps us surf more together.\n\nYour invite: ${url.href}\nQuick Start Guide: ${guideUrl}`
    : includeOverview
      ? `I'm inviting you to Sodium${inviteRegion ? ` in ${inviteRegion.name}` : ''}, a private surf community. Hopefully it helps us surf more together.\n\nYour invite: ${url.href}\nOne-page overview: ${onePageUrl}`
    : includeSetup
      ? `I'm inviting you to Sodium${inviteRegion ? ` in ${inviteRegion.name}` : ''}, a private surf community. Use this one-page phone setup after opening the invite.\n\nYour invite: ${url.href}\nPhone setup: ${setupUrl}`
    : `I'm inviting you to Sodium${inviteRegion ? ` in ${inviteRegion.name}` : ''}, a private surf community. Hopefully it helps us surf more together.`;
  let file = null;
  if (includeGuide) {
    try { file = await quickStartGuideFile(); }
    catch (_error) { /* Both links remain in the share message. */ }
  } else if (includeOverview) {
    try { file = await overviewFile(); }
    catch (_error) { /* Both links remain in the share message. */ }
  } else if (includeSetup) {
    try { file = await setupGuideFile(); }
    catch (_error) { /* Both links remain in the share message. */ }
  }
  try {
    await shareSodiumContent({
      title,
      text,
      url:url.href,
      file,
      copiedMessage:includeGuide ? 'Invite and manual links copied.' : (includeOverview ? 'Invite and overview links copied.' : (includeSetup ? 'Invite and phone setup links copied.' : 'Invite message and link copied.')),
    });
  } catch (error) {
    if (error?.name !== 'AbortError') prompt('Copy this invite:', `${text}\n${url.href}`);
  }
}

document.addEventListener('click', async event => {
  const actionNode = event.target.closest('[data-action]');
  const carouselDirectionNode = event.target.closest('[data-carousel-direction]');
  const viewNode = event.target.closest('[data-view]');
  const regionNode = event.target.closest('[data-region]');
  const rsvpNode = event.target.closest('[data-rsvp]');
  const endNode = event.target.closest('[data-end-session]');
  const startNode = event.target.closest('[data-start-session]');
  const editSessionNode = event.target.closest('[data-edit-session]');
  const shareSessionNode = event.target.closest('[data-share-session]');
  const shareSessionMemberNode = event.target.closest('[data-share-session-member]');
  const shareEventNode = event.target.closest('[data-share-event]');
  const inviteSessionClaimNode = event.target.closest('[data-invite-session-claim]');
  const inviteClipClaimNode = event.target.closest('[data-invite-clip-claim]');
  const shareClipDeliveryNode = event.target.closest('[data-share-clip-delivery]');
  const shareGuestClipsNode = event.target.closest('[data-share-guest-clips]');
  const editPostNode = event.target.closest('[data-edit-post]');
  const removeSessionPersonNode = event.target.closest('[data-remove-session-person]');
  const sessionMemberNode = event.target.closest('[data-session-member]');
  const likeNode = event.target.closest('[data-like]');
  const whenNode = event.target.closest('[data-when]');
  const sessionRoleNode = event.target.closest('[data-session-role]');
  const memberNode = event.target.closest('[data-member]');
  const iconThemeNode = event.target.closest('[data-icon-theme]');
  if (inviteSessionClaimNode) { await shareSessionClaimInvite(inviteSessionClaimNode.dataset.inviteSessionClaim); return; }
  if (inviteClipClaimNode) { await shareClipClaimInvite(inviteClipClaimNode.dataset.inviteClipClaim); return; }
  if (shareClipDeliveryNode) { await shareExistingClipDelivery(shareClipDeliveryNode.dataset.shareClipDelivery); return; }
  if (shareGuestClipsNode) { await shareGuestClipLink(shareGuestClipsNode.dataset.shareGuestClips); return; }
  if (shareSessionMemberNode) { await shareSessionToMember(shareSessionMemberNode.dataset.shareSessionMember); return; }
  const eventRegionNode = event.target.closest('[data-event-region]');
  const eventRsvpNode = event.target.closest('[data-event-rsvp]');
  const eventCalendarNode = event.target.closest('[data-event-calendar]');
  const editEventNode = event.target.closest('[data-edit-event]');
  const editPerkNode = event.target.closest('[data-edit-perk]');
  const copyPerkNode = event.target.closest('[data-copy-perk]');
  const chatRegionNode = event.target.closest('[data-chat-region]');
  const dmMemberNode = event.target.closest('[data-dm-member]');
  const calendarDateNode = event.target.closest('[data-calendar-date]');
  const feedbackFilterNode = event.target.closest('[data-feedback-filter]');
  const saveFeedbackNode = event.target.closest('[data-save-feedback]');
  const listingNode = event.target.closest('[data-listing]');
  const editListingNode = event.target.closest('[data-edit-listing]');
  const inboxTabNode = event.target.closest('[data-inbox-tab]');
  const clipBoxNode = event.target.closest('[data-clip-box]');
  const editClipDeliveryNode = event.target.closest('[data-edit-clip-delivery]');
  const sessionClipsNode = event.target.closest('[data-session-clips]');
  if (carouselDirectionNode) {
    const carousel = carouselDirectionNode.closest('[data-post-carousel]');
    const direction = Number(carouselDirectionNode.dataset.carouselDirection || 0);
    const current = Number(carousel?.dataset.carouselIndex || 0);
    if (carousel) updatePostCarousel(carousel, current + direction);
    return;
  }
  if (inboxTabNode) {
    state.inboxTab = inboxTabNode.dataset.inboxTab;
    renderInboxTabs();
  }
  if (clipBoxNode) {
    state.clipBox = clipBoxNode.dataset.clipBox;
    renderClipDeliveries();
  }
  if (iconThemeNode) applyIconTheme(iconThemeNode.dataset.iconTheme, true);
  if (viewNode) setView(viewNode.dataset.view);
  if (memberNode) openMember(memberNode.dataset.member);
  if (dmMemberNode) await openDm(dmMemberNode.dataset.dmMember);
  if (calendarDateNode) {
    state.calendarDate = calendarDateNode.dataset.calendarDate;
    renderCalendar();
  }
  if (feedbackFilterNode) {
    state.issueFilter = feedbackFilterNode.dataset.feedbackFilter;
    renderIssueReports();
  }
  if (saveFeedbackNode) await saveIssueAdminUpdate(saveFeedbackNode.dataset.saveFeedback);
  if (editListingNode) {
    event.stopPropagation();
    openListingComposer(editListingNode.dataset.editListing);
  } else if (listingNode) openListingDetail(listingNode.dataset.listing);
  if (removeSessionPersonNode) {
    state.sessionPeople.splice(Number(removeSessionPersonNode.dataset.removeSessionPerson), 1);
    renderSessionPeopleChips();
  }
  if (sessionMemberNode) {
    const person = state.people.find(item => item.id === sessionMemberNode.dataset.sessionMember);
    if (person) addSessionPerson(person.name);
    $('#sessionPersonInput').focus();
  }
  if (regionNode) {
    const region = state.regions.find(item => item.id === regionNode.dataset.region);
    try { await joinLocation(region); }
    catch (error) { toast(readableError(error), 5000); return; }
    state.currentRegion = region; state.eventRegion = region; state.chatRegion = region;
    localStorage.setItem('salty:last-location', region.id);
    $('#regionMenu').classList.remove('open'); renderChrome();
    if (state.preview) {
      state.sessions = state.previewSessions.filter(session => session.region_id === state.currentRegion.id);
      renderSessions();
    } else await loadSessions();
  }
  if (eventRegionNode) {
    const region = state.regions.find(item => item.id === eventRegionNode.dataset.eventRegion);
    try { await joinLocation(region); }
    catch (error) { toast(readableError(error), 5000); return; }
    state.eventRegion = region;
    renderEventRegions();
    if (!state.preview) await loadEvents();
  }
  if (chatRegionNode) {
    const region = state.regions.find(item => item.id === chatRegionNode.dataset.chatRegion);
    try { await joinLocation(region); }
    catch (error) { toast(readableError(error), 5000); return; }
    state.chatRegion = region;
    renderChatRegions();
    if (state.preview) renderRoomMessages();
    else await loadRoomMessages();
  }
  if (state.preview && (rsvpNode || startNode || endNode || shareSessionNode || shareEventNode || likeNode || editClipDeliveryNode || sessionClipsNode || ['make-invite', 'share-invite', 'share-invite-overview', 'share-invite-setup', 'share-invite-guide', 'edit-profile', 'delete-perk', 'delete-post', 'delete-listing', 'cancel-session', 'open-clip-delivery', 'mark-clips-ready', 'delete-clip-delivery', 'toggle-push-device', 'sign-out'].includes(actionNode?.dataset.action))) {
    toast('Preview only — nothing saves here.');
    return;
  }
  if (editClipDeliveryNode) openClipDeliveryComposer(editClipDeliveryNode.dataset.editClipDelivery);
  if (sessionClipsNode) openClipDeliveryComposer(null, sessionClipsNode.dataset.sessionClips);
  if (rsvpNode) await setRsvp(rsvpNode.dataset.rsvp, rsvpNode.dataset.role);
  if (startNode) await startSession(startNode.dataset.startSession);
  if (editSessionNode) openSessionComposer(editSessionNode.dataset.editSession);
  if (shareSessionNode) openSessionShare(shareSessionNode.dataset.shareSession);
  if (shareEventNode) await shareEvent(shareEventNode.dataset.shareEvent);
  if (editPostNode) openPostComposer(editPostNode.dataset.editPost);
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
    if (!later) $('#sessionTime').value = '';
    updateDateChoiceLabels();
  }
  if (sessionRoleNode) {
    updateSessionRoleUi(sessionRoleNode.dataset.sessionRole);
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
    'guest-clip-join': joinFromGuestClip,
    'open-drawer': openDrawer,
    'close-drawer': closeDrawer,
    'toggle-regions': () => $('#regionMenu').classList.toggle('open'),
    'open-session': () => openSessionComposer(),
    'open-share-invite': openShareInviteHub,
    'share-session-external': () => shareSessionExternal(),
    'open-plan-invite': () => { closeSheet(); $('#planInviteForm').reset(); openSheet('planInviteSheet'); },
    'open-session-claim-list': showSessionClaimList,
    'open-pending-clip-delivery': () => { closeSheet(); openClipDeliveryComposer(); $('#clipRecipient').value = 'pending'; updateClipRecipientUi(); },
    'open-clip-outbox': () => { closeSheet(); state.inboxTab = 'clips'; state.clipBox = 'sent'; setView('dms'); renderClipDeliveries(); },
    'open-calendar': openCrewCalendar,
    'open-events-calendar': openEventsCalendar,
    'calendar-prev': () => changeCalendarMonth(-1),
    'calendar-next': () => changeCalendarMonth(1),
    'add-session-person': addSessionPerson,
    'cancel-session': cancelSession,
    'open-post': () => openPostComposer(),
    'open-event': () => openEventComposer(),
    'open-perk': () => openPerkComposer(),
    'open-listing': () => openListingComposer(),
    'open-location': () => { $('#locationForm').reset(); openSheet('locationSheet'); },
    'open-issue-report': openIssueReport,
    'delete-perk': deletePerk,
    'delete-listing': deleteListing,
    'delete-post': deletePost,
    'show-install': showInstallInstructions,
    'toggle-push-device': togglePushDevice,
    'test-notification': sendTestNotification,
    'close-whats-new': closeWhatsNew,
    'whats-new-notifications': openNotificationSettings,
    'dismiss-install': dismissInstallNudge,
    'native-install': runNativeInstall,
    'close-sheet': closeSheet,
    'open-guide': openGuide,
    'open-master-guide': openMasterGuide,
    'close-guide': closeGuide,
    'go-surfing': () => setView('surfing'),
    'open-dms': () => setView('dms'),
    'open-clip-delivery': () => openClipDeliveryComposer(),
    'mark-clips-ready': markClipDeliveryReady,
    'delete-clip-delivery': deleteClipDelivery,
    'make-invite': openShareInviteHub,
    'share-invite': () => shareInvite(),
    'share-invite-guide': () => shareInvite({ includeGuide:true }),
    'share-invite-overview': () => shareInvite({ includeOverview:true }),
    'share-invite-setup': () => shareInvite({ includeSetup:true }),
    'share-guide': shareGuide,
    'edit-profile': showProfileSetup,
    'cancel-profile': () => showOnly('app'),
    'sign-out': async () => {
      clearPendingAuth();
      try { await disablePushNotifications(false); } catch (error) { console.warn('Push cleanup deferred:', error); }
      await db.auth.signOut(); location.href = './';
    },
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
  else if (event.target.id === 'postForm') await savePost(event);
  else if (event.target.id === 'eventForm') await createEvent(event);
  else if (event.target.id === 'perkForm') await savePerk(event);
  else if (event.target.id === 'listingForm') await saveListing(event);
  else if (event.target.id === 'roomMessageForm') await sendRoomMessage(event);
  else if (event.target.id === 'dmMessageForm') await sendDmMessage(event);
  else if (event.target.id === 'clipDeliveryForm') await saveClipDelivery(event);
  else if (event.target.id === 'planInviteForm') await sharePlanSurfInvite(event);
  else if (event.target.matches('[data-clip-message-form]')) await sendMemberClipMessage(event);
  else if (event.target.id === 'locationForm') await saveLocation(event);
  else if (event.target.id === 'issueReportForm') await saveIssueReport(event);
  else if (event.target.matches('[data-comment-form]')) await addComment(event, event.target.dataset.commentForm);
});

document.addEventListener('change', async event => {
  if (event.target.id === 'clipRecipient' && !$('#clipSubjects').value.trim()) {
    const recipient = state.people.find(person => person.id === event.target.value);
    $('#clipSubjects').value = recipient?.name?.trim().split(/\s+/)[0] || '';
    updateClipRecipientUi();
    return;
  }
  if (event.target.id === 'clipRecipient') {
    updateClipRecipientUi();
    return;
  }
  if (event.target.id === 'sessionInitiator') {
    $('#sessionInitiatorNameRow').classList.toggle('hidden', event.target.value !== 'pending');
    return;
  }
  if (event.target.id === 'listingHasPerk') {
    $('#listingPerkFields').classList.toggle('hidden', !event.target.checked);
    return;
  }
  if (event.target.id === 'listingImage') {
    const file = event.target.files[0];
    if (!file) return;
    try {
      validateListingImage(file);
      $('#listingImagePreview').innerHTML = `<img src="${esc(URL.createObjectURL(file))}" alt="Selected listing image">`;
    } catch (error) {
      toast(readableError(error), 5000); event.target.value = '';
    }
    return;
  }
  const input = event.target.closest('[data-notification-pref]');
  if (!input || state.preview) return;
  input.disabled = true;
  try {
    await saveNotificationPreference(input.dataset.notificationPref, input.checked);
    await renderNotificationSettings();
    toast(input.dataset.notificationPref === 'master_enabled'
      ? (input.checked ? 'Sodium notifications resumed.' : 'All Sodium notifications paused.')
      : 'Notification preference saved.');
  } catch (error) {
    input.checked = !input.checked;
    toast(readableError(error), 5000);
  } finally { input.disabled = false; }
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
$$('input[name="postKind"]').forEach(input => input.addEventListener('change', event => {
  if (event.target.disabled) return;
  setPostKind(event.target.value, { clearFile:true });
}));
$('#mediaFile').addEventListener('change', async event => {
  const files = [...event.target.files];
  if (!files.length) return;
  if (state.postPreviewUrl) URL.revokeObjectURL(state.postPreviewUrl);
  state.postPreviewUrl = '';
  const totalMb = files.reduce((sum, file) => sum + file.size, 0) / 1048576;
  $('#fileLabel').textContent = files.length === 1
    ? `${files[0].name} · ${totalMb.toFixed(1)} MB`
    : `${files.length} ${selectedPostKind() === 'clip' ? 'clips' : 'photos'} selected · ${totalMb.toFixed(1)} MB total`;
  try {
    await validatePostSelection(files);
    const photos = files.every(file => file.type.startsWith('image/'));
    $('#postRatioPicker').classList.remove('hidden');
    const previewImage = $('#postRatioPreview img');
    const previewVideo = $('#postRatioPreview video');
    if (photos) {
      state.postPreviewUrl = URL.createObjectURL(files[0]);
      previewImage.src = state.postPreviewUrl;
    } else {
      state.postPreviewUrl = URL.createObjectURL(files[0]);
      previewVideo.src = state.postPreviewUrl;
    }
    $('#postRatioPreview').classList.remove('hidden');
    applyPostRatioPreview();
  }
  catch (error) {
    toast(readableError(error), 5000);
    event.target.value = '';
    $('#fileLabel').textContent = selectedPostKind() === 'photo' ? 'Choose up to 10 photos' : 'Choose up to 5 clips';
  }
});
$$('input[name="postRatio"]').forEach(input => input.addEventListener('change', applyPostRatioPreview));
$('#issueScreenshot').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) { $('#issueScreenshotLabel').textContent = 'Choose screenshot'; return; }
  try {
    validateFeedbackScreenshot(file);
    $('#issueScreenshotLabel').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  } catch (error) {
    toast(readableError(error), 5000);
    event.target.value = '';
    $('#issueScreenshotLabel').textContent = 'Choose screenshot';
  }
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

['clipExpectedCount', 'clipUploadedCount'].forEach(id => {
  $(`#${id}`).addEventListener('input', updateClipProgressPreview);
  $(`#${id}`).addEventListener('change', updateClipProgressPreview);
});
$('#clipFolderUrl').addEventListener('input', updateClipProviderHint);

function fillKnownSpotLocation(spotInput, locationInput) {
  const name = spotInput.value.trim().toLowerCase();
  if (!name || locationInput.value.trim()) return;
  const matches = state.spots.filter(spot => spot.region_id === state.currentRegion?.id && spot.name.toLowerCase() === name);
  if (matches.length === 1 && matches[0].general_location) locationInput.value = matches[0].general_location;
}

$('#sessionSpot').addEventListener('change', () => fillKnownSpotLocation($('#sessionSpot'), $('#sessionLocation')));
$('#postSpot').addEventListener('change', () => fillKnownSpotLocation($('#postSpot'), $('#postLocation')));
$('#sessionPersonInput').addEventListener('input', event => renderSessionMemberSuggestions(event.target.value));
$('#sessionPersonInput').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const firstMatch = $('#sessionMemberSuggestions [data-session-member]');
  if (firstMatch) firstMatch.click();
  else addSessionPerson();
});
['sessionTime', 'eventDate', 'eventStartClock', 'eventEndClock'].forEach(id => {
  const refreshChoice = () => {
    if (id === 'sessionTime' && $('#sessionTime').value) {
      $$('[data-when]').forEach(choice => choice.classList.toggle('active', choice.dataset.when === 'later'));
    }
    updateDateChoiceLabels();
  };
  $(`#${id}`).addEventListener('input', refreshChoice);
  $(`#${id}`).addEventListener('change', refreshChoice);
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
  toast('Sodium was added to your Home Screen.');
});

applyIconTheme(localStorage.getItem('salty:theme') || localStorage.getItem('salty:icon-theme') || 'ink');
init().catch(error => { showWelcome(); toast(readableError(error), 6000); });
