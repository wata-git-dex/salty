/* global supabase */
'use strict';

const CONFIG = Object.freeze({
  supabaseUrl: 'https://maihhnwrstewzapsvrec.supabase.co',
  supabaseKey: 'sb_publishable_YtVKcZqgPalUaYOHpoSV1w_86he5PDV',
  mediaBucket: 'salty-media',
  maxUploadBytes: 50 * 1024 * 1024,
  maxClipSeconds: 90,
});

// Upgrade runway: after moving Supabase to Pro, raise maxUploadBytes and replace
// uploadMedia() with a TUS resumable implementation. Callers do not need to change.
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const state = {
  session: null, profile: null, regions: [], spots: [], people: [], sessions: [], posts: [],
  currentRegion: null, view: 'surfing', pendingInvite: '', authMode: 'new', realtime: null,
  preview: false, previewSessions: [],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const formatCount = number => new Intl.NumberFormat().format(number || 0);
const inviteFromUrl = () => new URLSearchParams(location.search).get('invite')?.trim() || '';

function showOnly(id) {
  ['boot', 'welcome', 'authScreen', 'app'].forEach(name => $(`#${name}`).classList.toggle('hidden', name !== id));
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
  return error?.message || 'Something went sideways. Please try again.';
}

async function init() {
  if (new URLSearchParams(location.search).get('preview') === '1') {
    runPreview();
    return;
  }
  state.pendingInvite = inviteFromUrl() || localStorage.getItem('salty:invite') || '';
  if (state.pendingInvite) localStorage.setItem('salty:invite', state.pendingInvite);

  const { data, error } = await db.auth.getSession();
  if (error) toast(readableError(error));
  state.session = data?.session || null;

  db.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user?.id === state.session?.user?.id) return;
    state.session = session;
    if (session) await enterCommunity();
  });

  if (state.session) await enterCommunity();
  else showWelcome();

  if ('serviceWorker' in navigator && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    try { await navigator.serviceWorker.register('./sw.js', { scope: '/salty/' }); }
    catch (error) { console.warn('Service worker registration deferred:', error); }
  }
}

function runPreview() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const regionId = '22222222-2222-4222-8222-222222222222';
  state.preview = true;
  state.session = { user: { id: userId } };
  state.profile = { id: userId, name: 'Cyrus V.', home_region: regionId, sponsors: ['Sodium', 'Salty Viewfinder'] };
  state.regions = [{ id: regionId, name: 'California' }, { id: 'fr', name: 'France' }, { id: 'de', name: 'Germany' }, { id: 'ut', name: 'Utah' }];
  state.currentRegion = state.regions[0];
  state.people = [{ id: userId, name: 'Cyrus V.' }, { id: 'jonah', name: 'Jonah Reyes' }, { id: 'mateo', name: 'Mateo Karras' }];
  state.spots = [{ id: 'malibu', name: 'Malibu', region_id: regionId }, { id: 'lowers', name: 'Lowers', region_id: regionId }];
  state.previewSessions = [
    { id:'mine', author:userId, region_id:regionId, when_label:'Now', wants_filmer:true, note:'bringing the longboard', spot:{name:'Malibu'}, author_profile:{name:'Cyrus V.'}, session_rsvps:[{id:'r1',user_id:'jonah',role:'surf',profile:{name:'Jonah Reyes'}},{id:'r2',user_id:'mateo',role:'film',profile:{name:'Mateo Karras'}}]},
    { id:'crew', author:'jonah', region_id:regionId, when_label:'Now', wants_filmer:true, note:null, spot:{name:'Lowers'}, author_profile:{name:'Jonah Reyes'}, session_rsvps:[] },
  ];
  state.sessions = state.previewSessions;
  state.posts = [];
  renderChrome(); renderSessions(); renderPosts(); renderPreviewProfile(); showOnly('app');
  $('#appPreviewBanner').classList.remove('hidden');
}

function renderPreviewProfile() {
  $('#profileView').innerHTML = `<div class="profile-head"><span class="avatar">CV</span><div><h2>Cyrus V.</h2><p>California · Salty Crew</p></div></div><div class="stats"><article class="profile-card stat"><b>45</b><span>points</span></article><article class="profile-card stat"><b>3</b><span>active streak</span></article><article class="profile-card stat"><b>0</b><span>clips</span></article></div><article class="profile-card"><h3>Sponsors</h3><div class="chips"><span class="chip">Sodium</span><span class="chip">Salty Viewfinder</span></div></article><footer class="profile-footer"><b>SALTY</b>surf with your friends, not your feed</footer>`;
  $('#streakBadge b').textContent = '3';
}

function showWelcome() {
  showOnly('welcome');
  const invited = $('.invited');
  const hasInvite = Boolean(state.pendingInvite);
  invited.textContent = hasInvite ? "You've been invited" : 'Private surf community';
  $('#enterButton').classList.toggle('hidden', !hasInvite);
  $('#inviteInstruction').classList.toggle('hidden', hasInvite);
}

function openAuth(mode) {
  state.authMode = mode;
  const isNew = mode === 'new';
  if (isNew && !state.pendingInvite) {
    toast('Open the invite link your friend sent you.');
    return;
  }
  $('#newMemberFields').classList.toggle('hidden', !isNew);
  $$('#newMemberFields input').forEach(input => { input.required = isNew && input.id === 'profileName'; });
  $('#authTitle').textContent = isNew ? 'Join your crew' : 'Welcome back';
  $('#authSubtitle').textContent = isNew ? 'Your magic link signs you in—no password or SMS.' : 'Enter the email connected to your Salty profile.';
  $('#authMessage').classList.add('hidden');
  showOnly('authScreen');
}

async function sendMagicLink(event) {
  event.preventDefault();
  const email = $('#authEmail').value.trim();
  const name = $('#profileName').value.trim();
  const phone = $('#profilePhone').value.trim();
  const homeRegion = $('#profileRegion').value;
  const isNew = state.authMode === 'new';
  const submit = $('#authForm button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Sending…';

  if (isNew) {
    const { data: valid, error: inviteError } = await db.rpc('invite_is_valid', { invite_code: state.pendingInvite });
    if (inviteError || !valid) {
      submit.disabled = false; submit.textContent = 'Email me a magic link';
      toast(inviteError ? readableError(inviteError) : 'That invite is invalid or has expired.');
      return;
    }
    localStorage.setItem('salty:onboarding', JSON.stringify({ name, phone, homeRegion }));
  }

  const redirect = new URL('./', location.href);
  redirect.searchParams.set('auth', 'callback');
  if (isNew) redirect.searchParams.set('invite', state.pendingInvite);
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.href,
      shouldCreateUser: isNew,
      data: isNew ? { name, phone, home_region: homeRegion } : undefined,
    },
  });
  submit.disabled = false; submit.textContent = 'Email me a magic link';
  if (error) { toast(readableError(error)); return; }
  const message = $('#authMessage');
  message.innerHTML = `<b>Check ${esc(email)}</b><br>Tap the magic link on this device to enter Salty.`;
  message.classList.remove('hidden');
}

async function enterCommunity() {
  const userId = state.session.user.id;
  let { data: profile, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) { toast(readableError(error)); showWelcome(); return; }

  if (!profile && state.pendingInvite) {
    const saved = JSON.parse(localStorage.getItem('salty:onboarding') || '{}');
    const redeemed = await db.rpc('redeem_invite', {
      invite_code: state.pendingInvite,
      profile_name: saved.name || null,
      profile_phone: saved.phone || null,
      profile_region: saved.homeRegion || null,
    });
    if (redeemed.error) {
      toast(readableError(redeemed.error), 6000);
      await db.auth.signOut();
      showWelcome();
      return;
    }
    profile = redeemed.data;
    localStorage.removeItem('salty:onboarding');
    localStorage.removeItem('salty:invite');
  }

  if (!profile) {
    toast('This account is not in the community. Open a valid invite link first.', 6000);
    await db.auth.signOut();
    showWelcome();
    return;
  }

  state.profile = profile;
  await loadApp();
  showOnly('app');
}

async function loadApp() {
  const [regionsResult, spotsResult, peopleResult] = await Promise.all([
    db.from('regions').select('*').order('name'),
    db.from('spots').select('*').order('name'),
    db.from('profiles').select('id,name,home_region,sponsors').order('name'),
  ]);
  const firstError = regionsResult.error || spotsResult.error || peopleResult.error;
  if (firstError) throw firstError;
  state.regions = regionsResult.data;
  state.spots = spotsResult.data;
  state.people = peopleResult.data;
  state.currentRegion = state.regions.find(region => region.id === state.profile.home_region) || state.regions.find(region => region.name === 'California') || state.regions[0];
  renderChrome();
  await Promise.all([loadSessions(), loadPosts(), renderProfile()]);
  subscribeRealtime();
}

const navItems = [
  ['surfing', 'i-surf', 'Surfing'], ['feed', 'i-feed', 'Feed'], ['chat', 'i-chat', 'Chat'],
  ['events', 'i-calendar', 'Events'], ['you', 'i-user', 'You'],
];

function renderNav(target) {
  target.innerHTML = navItems.map(([view, icon, label]) => `<button data-view="${view}" class="${state.view === view ? 'active' : ''}"><svg><use href="#${icon}"/></svg>${label}</button>`).join('');
}

function renderChrome() {
  renderNav($('#mobileNav')); renderNav($('#desktopNav'));
  $('#locationName').textContent = state.currentRegion.name;
  $('#sessionRegionName').textContent = state.currentRegion.name;
  $('#regionMenu').innerHTML = state.regions.map(region => `<button data-region="${region.id}" class="${region.id === state.currentRegion.id ? 'active' : ''}">${esc(region.name)} <small>view sessions</small></button>`).join('');
  $('#spotsList').innerHTML = state.spots.map(spot => `<option value="${esc(spot.name)}"></option>`).join('');
  $('#peopleList').innerHTML = state.people.map(person => `<option value="${esc(person.name)}"></option>`).join('');
  $('#drawerProfile').innerHTML = `<span class="avatar">${esc(initials(state.profile.name))}</span><div><h3>${esc(state.profile.name)}</h3><p>${esc(state.currentRegion.name)} · Salty Crew</p></div>`;
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
}

async function loadSessions() {
  const result = await db.from('sessions')
    .select('*,spot:spots(id,name),author_profile:profiles!sessions_author_fkey(id,name),session_rsvps(id,user_id,role,profile:profiles!session_rsvps_user_id_fkey(id,name))')
    .eq('region_id', state.currentRegion.id).eq('status', 'active').order('created_at', { ascending: false });
  if (result.error) { toast(readableError(result.error)); return; }
  state.sessions = result.data || [];
  renderSessions();
}

function sessionWhen(session) {
  if (session.when_label === 'Now' || !session.surf_time) return 'out now';
  return new Intl.DateTimeFormat([], { weekday:'short', hour:'numeric', minute:'2-digit' }).format(new Date(session.surf_time));
}

function renderSessions() {
  const liveNow = state.sessions.filter(session => session.when_label === 'Now').length;
  $('#liveCount').innerHTML = liveNow ? `<i></i>${liveNow} OUT NOW` : 'quiet right now';
  const feed = $('#sessionsFeed');
  if (!state.sessions.length) {
    feed.innerHTML = `<div class="empty"><span>QUIET</span><h2>No one's out in ${esc(state.currentRegion.name)} yet</h2><p>Be the first to post a session. One person starts it and the area comes alive.</p></div>`;
    return;
  }
  feed.innerHTML = state.sessions.map(session => {
    const mine = session.author === state.profile.id;
    const myRsvp = session.session_rsvps.find(rsvp => rsvp.user_id === state.profile.id);
    const crew = session.session_rsvps.map(rsvp => rsvp.profile?.name).filter(Boolean);
    const actions = mine
      ? `<button class="small-action end" data-end-session="${session.id}"><svg><use href="#i-close"/></svg>End session</button>`
      : `<button class="small-action surf ${myRsvp?.role === 'surf' ? 'on' : ''}" data-rsvp="${session.id}" data-role="surf"><svg><use href="#i-check"/></svg>${myRsvp?.role === 'surf' ? "You're in" : "I'm down"}</button><button class="small-action film ${myRsvp?.role === 'film' ? 'on' : ''}" data-rsvp="${session.id}" data-role="film"><svg><use href="#i-camera"/></svg>${myRsvp?.role === 'film' ? 'Filming ✓' : "I'll film"}</button>`;
    return `<article class="session-card ${mine ? 'mine' : ''} ${session.wants_filmer ? 'wants' : ''}"><i class="stripe"></i><div class="card-head"><span class="avatar">${esc(initials(session.author_profile?.name))}</span><div class="card-person"><strong>${mine ? 'You' : esc(session.author_profile?.name)} ${mine ? '<b class="you-tag">YOU</b>' : ''}</strong><small>${mine ? 'you started this session' : esc(state.currentRegion.name)}</small></div>${session.wants_filmer ? '<b class="filmer-tag">Wants filmer</b>' : ''}</div><div class="spot-line"><strong>${esc(session.spot?.name || 'Spot TBD')}</strong><span>${esc(sessionWhen(session))}</span></div>${session.note ? `<p class="session-note">${esc(session.note)}</p>` : ''}<p class="crew-line">${crew.length ? `<b>${esc(crew.join(', '))}</b> ${crew.length === 1 ? 'is' : 'are'} in` : '<b>First one in</b> · bring the crew'}</p><div class="card-actions">${actions}</div></article>`;
  }).join('');
}

async function ensureSpot(name, regionId) {
  const cleanName = name.trim();
  let spot = state.spots.find(item => item.name.toLowerCase() === cleanName.toLowerCase() && item.region_id === regionId);
  if (spot) return spot;
  const result = await db.from('spots').insert({ name: cleanName, region_id: regionId, created_by: state.profile.id }).select().single();
  if (result.error) throw result.error;
  state.spots.push(result.data);
  renderChrome();
  return result.data;
}

async function createSession(event) {
  event.preventDefault();
  const submit = $('#sessionForm button[type="submit"]'); submit.disabled = true;
  try {
    const spot = await ensureSpot($('#sessionSpot').value, state.currentRegion.id);
    const later = $('[data-when="later"]').classList.contains('active');
    const surfTime = later ? $('#sessionTime').value : null;
    if (later && !surfTime) throw new Error('Pick a date and time.');
    const result = await db.from('sessions').insert({
      author: state.profile.id, spot_id: spot.id, region_id: state.currentRegion.id,
      when_label: later ? 'Scheduled' : 'Now', surf_time: surfTime ? new Date(surfTime).toISOString() : null,
      wants_filmer: $('#wantsFilmer').checked, note: $('#sessionNote').value.trim() || null,
    });
    if (result.error) throw result.error;
    $('#sessionForm').reset(); closeSheet(); await loadSessions(); await renderProfile(); toast('Your session is live.');
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
  const result = await db.from('sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId).eq('author', state.profile.id);
  if (result.error) { toast(readableError(result.error)); return; }
  await loadSessions(); toast('Session ended.');
}

async function loadPosts() {
  const result = await db.from('posts')
    .select('*,spot:spots(id,name),author_profile:profiles!posts_author_fkey(id,name),post_likes(user_id),post_comments(id,body,created_at,author_profile:profiles!post_comments_author_fkey(id,name))')
    .order('created_at', { ascending: false }).limit(50);
  if (result.error) { toast(readableError(result.error)); return; }
  state.posts = result.data || [];
  renderPosts();
}

function renderPosts() {
  const feed = $('#postsFeed');
  if (!state.posts.length) {
    feed.innerHTML = '<div class="empty"><span>FEED</span><h2>No photos or clips yet</h2><p>Share the first photo or clip. The filmer is always credited.</p></div>';
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
    const spot = spotName ? await ensureSpot(spotName, state.currentRegion.id) : null;
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
    await loadPosts(); await renderProfile(); toast('Posted to the whole community.');
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
  const region = state.regions.find(item => item.id === state.profile.home_region)?.name || 'Salty Crew';
  const sponsors = state.profile.sponsors?.length ? state.profile.sponsors : ['Add sponsors in the next profile update'];
  $('#profileView').innerHTML = `<div class="profile-head"><span class="avatar">${esc(initials(state.profile.name))}</span><div><h2>${esc(state.profile.name)}</h2><p>${esc(region)} · Salty Crew</p></div></div><div class="stats"><article class="profile-card stat"><b>${formatCount(total)}</b><span>points</span></article><article class="profile-card stat"><b>${streak.data?.current_streak || 0}</b><span>active streak</span></article><article class="profile-card stat"><b>${posts.count || 0}</b><span>clips</span></article></div><article class="profile-card"><h3>Sponsors</h3><div class="chips">${sponsors.map(name => `<span class="chip">${esc(name)}</span>`).join('')}</div></article><article class="profile-card"><h3>Surf with most</h3><p style="color:var(--mut);font-size:13px;line-height:1.5">This list builds itself as your crew RSVPs, films and gets tagged. No follow button anywhere.</p></article><footer class="profile-footer"><b>SALTY</b>surf with your friends, not your feed</footer>`;
  $('#streakBadge b').textContent = streak.data?.current_streak || 0;
}

function subscribeRealtime() {
  if (state.realtime) db.removeChannel(state.realtime);
  state.realtime = db.channel('salty-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, async () => await loadSessions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_rsvps' }, async () => await loadSessions())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async () => await loadPosts())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes' }, async () => await loadPosts())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_comments' }, async () => await loadPosts())
    .subscribe();
}

function openDrawer() { $('#drawer').classList.add('open'); $('#drawerScrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerScrim').classList.remove('open'); }
function openSheet(id) { $(`#${id}`).classList.add('open'); $('#sheetScrim').classList.add('open'); }
function closeSheet() { $$('.sheet').forEach(sheet => sheet.classList.remove('open')); $('#sheetScrim').classList.remove('open'); }

async function makeInvite() {
  const result = await db.rpc('create_invite', { invite_max_uses: 1 });
  if (result.error) { toast(readableError(result.error)); return; }
  const url = new URL('./', location.href); url.searchParams.set('invite', result.data);
  try { await navigator.clipboard.writeText(url.href); toast('Invite link copied.'); }
  catch (_error) { prompt('Copy this invite link:', url.href); }
}

document.addEventListener('click', async event => {
  const actionNode = event.target.closest('[data-action]');
  const viewNode = event.target.closest('[data-view]');
  const regionNode = event.target.closest('[data-region]');
  const rsvpNode = event.target.closest('[data-rsvp]');
  const endNode = event.target.closest('[data-end-session]');
  const likeNode = event.target.closest('[data-like]');
  const whenNode = event.target.closest('[data-when]');
  if (viewNode) setView(viewNode.dataset.view);
  if (regionNode) {
    state.currentRegion = state.regions.find(region => region.id === regionNode.dataset.region);
    $('#regionMenu').classList.remove('open'); renderChrome();
    if (state.preview) {
      state.sessions = state.previewSessions.filter(session => session.region_id === state.currentRegion.id);
      renderSessions();
    } else await loadSessions();
  }
  if (state.preview && (rsvpNode || endNode || likeNode || ['make-invite', 'sign-out'].includes(actionNode?.dataset.action))) {
    toast('Preview only — nothing saves here.');
    return;
  }
  if (rsvpNode) await setRsvp(rsvpNode.dataset.rsvp, rsvpNode.dataset.role);
  if (endNode) await endSession(endNode.dataset.endSession);
  if (likeNode) await toggleLike(likeNode.dataset.like);
  if (whenNode) {
    $$('.segmented button').forEach(button => button.classList.toggle('active', button === whenNode));
    $('#sessionTime').classList.toggle('hidden', whenNode.dataset.when !== 'later');
  }
  if (!actionNode) return;
  const actions = {
    'back-welcome': showWelcome,
    'open-drawer': openDrawer,
    'close-drawer': closeDrawer,
    'toggle-regions': () => $('#regionMenu').classList.toggle('open'),
    'open-session': () => openSheet('sessionSheet'),
    'open-post': () => openSheet('postSheet'),
    'close-sheet': closeSheet,
    'go-surfing': () => setView('surfing'),
    'coming-chat': () => toast('DMs arrive in the next phase.'),
    'make-invite': makeInvite,
    'sign-out': async () => { await db.auth.signOut(); location.href = './'; },
  };
  if (actions[actionNode.dataset.action]) await actions[actionNode.dataset.action]();
});

document.addEventListener('submit', async event => {
  if (state.preview) {
    event.preventDefault();
    toast('Preview only — nothing saves here.');
    return;
  }
  if (event.target.id === 'authForm') await sendMagicLink(event);
  else if (event.target.id === 'sessionForm') await createSession(event);
  else if (event.target.id === 'postForm') await createPost(event);
  else if (event.target.matches('[data-comment-form]')) await addComment(event, event.target.dataset.commentForm);
});

$('#enterButton').addEventListener('click', () => openAuth('new'));
$('#memberButton').addEventListener('click', () => openAuth('existing'));
$('#mediaFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  $('#fileLabel').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  try { await validateMedia(file); }
  catch (error) { toast(readableError(error), 5000); event.target.value = ''; $('#fileLabel').textContent = 'Add photo or clip'; }
});

init().catch(error => { showWelcome(); toast(readableError(error), 6000); });
