/**
 * OMNIS-X x JGIT Institutional Login Landing Controller
 * Scoped strictly to #loginLandingPage; stops single slideshow timer on login.
 */

(function (global) {
  'use strict';

  const SLIDE_INTERVAL_MS = 3000;
  const SLIDE_TRANSITION_MS = 900;
  const TEXT_SWAP_MS = 260;

  // Demo credentials ONLY for the convenience "Use Demo Credentials" auto-fill button (never verified client-side)
  const DEMO_CREDENTIALS = {
    email: 'admin@omnisx.com',
    password: 'OmnisX@2026'
  };
  const DEMO_STUDENT_CREDENTIALS = {
    studentId: 'STU001',
    password: 'Student@2026'
  };
  const INTERNAL_STUDENT_DOMAIN = 'students.omnisx.com';

  const SLIDES = [
    {
      src: 'assets/images/login/campus-night.jpeg',
      alt: 'JGIT illuminated campus building at night',
      modeClass: 'mode-portrait',
      label: 'Campus & Infrastructure',
      heading: 'BUILDING THE FUTURE',
      description: 'A campus environment designed for innovation, academic excellence and technological advancement.'
    },
    {
      src: 'assets/images/login/student-learning.jpeg',
      alt: 'JGIT students collaborating on laptop and textbook',
      modeClass: 'mode-landscape-faces',
      label: 'Student Experience & Education',
      heading: 'LEARN. INNOVATE. ACHIEVE.',
      description: 'Empowering students through collaborative learning, technical knowledge and practical education.'
    },
    {
      src: 'assets/images/login/engineering-campus.jpeg',
      alt: 'JGIT Faculty of Engineering & Technology academic block',
      modeClass: 'mode-portrait',
      label: 'Academics & Technology',
      heading: 'ENGINEERING EXCELLENCE',
      description: 'Exploring opportunities in engineering, computing, emerging technologies and multidisciplinary education.'
    },
    {
      src: 'assets/images/login/placement-achievements.jpeg',
      alt: 'Jain Institute of Technology Davangere Training and Placement Cell poster',
      modeClass: 'mode-poster',
      label: 'Training & Placement',
      heading: 'FROM CAMPUS TO CAREER',
      description: 'Bridging academic learning and professional opportunities through training, industry engagement and career development.'
    }
  ];

  let activeIndex = 0;
  let trackIndex = 0;
  let isPaused = false;
  let isLoggedIn = false;
  let slideTimerId = null;
  let resetSnapTimerId = null;
  let textSwapTimerId = null;

  function getEls() {
    return {
      landing: document.getElementById('loginLandingPage'),
      appShell: document.getElementById('appShell'),
      track: document.getElementById('loginSlidesTrack'),
      copyStage: document.getElementById('slideCopyStage'),
      kicker: document.getElementById('slideKicker'),
      headline: document.getElementById('slideHeadline'),
      desc: document.getElementById('slideDesc'),
      counter: document.getElementById('slideCounter'),
      indicators: document.getElementById('slideIndicators'),
      btnPrev: document.getElementById('btnSlidePrev'),
      btnNext: document.getElementById('btnSlideNext'),
      btnPause: document.getElementById('btnSlidePause'),
      form: document.getElementById('loginForm'),
      username: document.getElementById('loginUsername'),
      password: document.getElementById('loginPassword'),
      btnTogglePw: document.getElementById('btnTogglePassword'),
      btnSubmit: document.getElementById('btnLoginSubmit'),
      spinner: document.getElementById('loginSpinner'),
      btnLabel: document.getElementById('loginBtnLabel'),
      errorBox: document.getElementById('loginErrorMsg'),
      btnDemoFill: document.getElementById('btnFillDemoCreds'),
      studentAccordionBtn: document.getElementById('btnToggleStudentLogin'),
      studentPanel: document.getElementById('studentLoginPanel'),
      studentForm: document.getElementById('studentLoginForm'),
      studentIdInput: document.getElementById('studentIdInput'),
      studentPasswordInput: document.getElementById('studentPasswordInput'),
      btnToggleStudentPw: document.getElementById('btnToggleStudentPassword'),
      btnStudentSubmit: document.getElementById('btnStudentLoginSubmit'),
      studentSpinner: document.getElementById('studentLoginSpinner'),
      studentBtnLabel: document.getElementById('studentLoginBtnLabel'),
      studentErrorBox: document.getElementById('studentLoginErrorMsg'),
      btnStudentDemoFill: document.getElementById('btnFillDemoStudentCreds'),
      studentDashboardShell: document.getElementById('studentDashboardShell'),
      sidebarUserRow: document.getElementById('sidebarAuthUserRow'),
      sidebarUserEmail: document.getElementById('sidebarAuthUserEmail'),
      btnSignOut: document.getElementById('btnSidebarSignOut')
    };
  }

  function preloadImages() {
    const uniqueSrcs = SLIDES.map((s) => s.src);
    return Promise.all(
      uniqueSrcs.map((src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
      }))
    );
  }

  function buildSlideDom() {
    const els = getEls();
    if (!els.track || !els.indicators) return;

    // Render all 4 slides + cloned slide 0 at index 4 for seamless infinite horizontal sliding
    const slidesWithClone = [...SLIDES, SLIDES[0]];
    els.track.innerHTML = slidesWithClone.map((s, idx) => `
      <div class="login-slide" data-slide-idx="${idx}">
        <img class="slide-bg-blur" src="${s.src}" alt="" aria-hidden="true">
        <img class="slide-fg-img ${s.modeClass}" src="${s.src}" alt="${s.alt}">
      </div>
    `).join('');

    els.indicators.innerHTML = SLIDES.map((_, idx) => `
      <button type="button" class="slide-dot-btn ${idx === 0 ? 'active' : ''}" data-dot-idx="${idx}" aria-label="Show slide ${idx + 1}">
        <span class="slide-dot-fill"></span>
      </button>
    `).join('');
  }

  function updateIndicators() {
    const els = getEls();
    if (!els.indicators || !els.counter) return;

    els.counter.textContent = `0${activeIndex + 1} / 0${SLIDES.length}`;
    const dots = els.indicators.querySelectorAll('.slide-dot-btn');
    dots.forEach((dot, idx) => {
      dot.classList.remove('active', 'paused');
      // Force reflow so active progress animation restarts cleanly per slide
      void dot.offsetWidth;
      if (idx === activeIndex) {
        dot.classList.add('active');
        if (isPaused) dot.classList.add('paused');
      }
    });

    if (els.btnPause) {
      els.btnPause.textContent = isPaused ? 'Resume' : 'Pause';
      els.btnPause.classList.toggle('is-paused', isPaused);
      els.btnPause.setAttribute('aria-pressed', String(isPaused));
    }
  }

  function updateSlideCopy(nextIdx) {
    const els = getEls();
    const slide = SLIDES[nextIdx];
    if (!els.copyStage || !slide) return;

    if (textSwapTimerId) clearTimeout(textSwapTimerId);

    const reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      els.kicker.textContent = slide.label;
      els.headline.textContent = slide.heading;
      els.desc.textContent = slide.description;
      return;
    }

    els.copyStage.classList.remove('is-entering');
    els.copyStage.classList.add('is-leaving');

    textSwapTimerId = setTimeout(() => {
      els.kicker.textContent = slide.label;
      els.headline.textContent = slide.heading;
      els.desc.textContent = slide.description;
      els.copyStage.classList.remove('is-leaving');
      els.copyStage.classList.add('is-entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          els.copyStage.classList.remove('is-entering');
        });
      });
    }, TEXT_SWAP_MS);
  }

  function goToSlide(targetIdx, opts = {}) {
    const els = getEls();
    if (!els.track || isLoggedIn) return;

    if (resetSnapTimerId) {
      clearTimeout(resetSnapTimerId);
      resetSnapTimerId = null;
    }

    const total = SLIDES.length;
    const isForwardWrap = Boolean(opts.wrapForward) && activeIndex === total - 1 && targetIdx === 0;
    activeIndex = ((targetIdx % total) + total) % total;

    els.track.classList.remove('no-transition');

    if (isForwardWrap) {
      trackIndex = total; // slide smoothly to cloned Slide 0
      els.track.style.transform = `translateX(-${trackIndex * 100}%)`;
      resetSnapTimerId = setTimeout(() => {
        if (!els.track) return;
        els.track.classList.add('no-transition');
        trackIndex = 0;
        els.track.style.transform = 'translateX(0%)';
        void els.track.offsetWidth;
      }, SLIDE_TRANSITION_MS + 20);
    } else {
      trackIndex = activeIndex;
      els.track.style.transform = `translateX(-${trackIndex * 100}%)`;
    }

    updateSlideCopy(activeIndex);
    updateIndicators();
  }

  function stopSlideshow() {
    if (slideTimerId) {
      clearInterval(slideTimerId);
      slideTimerId = null;
    }
    if (resetSnapTimerId) {
      clearTimeout(resetSnapTimerId);
      resetSnapTimerId = null;
    }
    if (textSwapTimerId) {
      clearTimeout(textSwapTimerId);
      textSwapTimerId = null;
    }
  }

  function startSlideshow() {
    stopSlideshow();
    if (isLoggedIn || isPaused) return;
    const reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const interval = reducedMotion ? 4000 : SLIDE_INTERVAL_MS;

    slideTimerId = setInterval(() => {
      if (isPaused || isLoggedIn) return;
      const nextIdx = (activeIndex + 1) % SLIDES.length;
      goToSlide(nextIdx, { wrapForward: nextIdx === 0 });
    }, interval);
  }

  function pauseByInteraction() {
    if (!isPaused) {
      isPaused = true;
      stopSlideshow();
      updateIndicators();
    }
  }

  function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
      stopSlideshow();
      updateIndicators();
    } else {
      updateIndicators();
      startSlideshow();
    }
  }

  let isAuthenticating = false;

  function setAuthLoading(loading) {
    const els = getEls();
    isAuthenticating = Boolean(loading);
    if (els.btnSubmit) els.btnSubmit.disabled = isAuthenticating;
    if (els.spinner) els.spinner.classList.toggle('hidden', !isAuthenticating);
    if (els.btnLabel) els.btnLabel.textContent = isAuthenticating ? 'Authenticating...' : 'Sign In';
    if (els.username) els.username.disabled = isAuthenticating;
    if (els.password) els.password.disabled = isAuthenticating;
    if (els.btnStudentSubmit) els.btnStudentSubmit.disabled = isAuthenticating;
    if (els.studentIdInput) els.studentIdInput.disabled = isAuthenticating;
    if (els.studentPasswordInput) els.studentPasswordInput.disabled = isAuthenticating;
  }

  function setStudentAuthLoading(loading) {
    const els = getEls();
    isAuthenticating = Boolean(loading);
    if (els.btnStudentSubmit) els.btnStudentSubmit.disabled = isAuthenticating;
    if (els.studentSpinner) els.studentSpinner.classList.toggle('hidden', !isAuthenticating);
    if (els.studentBtnLabel) els.studentBtnLabel.textContent = isAuthenticating ? 'Signing in...' : 'Sign in as Student';
    if (els.studentIdInput) els.studentIdInput.disabled = isAuthenticating;
    if (els.studentPasswordInput) els.studentPasswordInput.disabled = isAuthenticating;
    if (els.btnSubmit) els.btnSubmit.disabled = isAuthenticating;
  }

  function showLoginError(msg) {
    const els = getEls();
    if (!els.errorBox) return;
    els.errorBox.textContent = msg;
    els.errorBox.classList.remove('hidden');
  }

  function clearLoginError() {
    const els = getEls();
    if (!els.errorBox) return;
    els.errorBox.classList.add('hidden');
    els.errorBox.textContent = '';
  }

  function showStudentError(msg) {
    const els = getEls();
    if (!els.studentErrorBox) return;
    els.studentErrorBox.textContent = msg;
    els.studentErrorBox.classList.remove('hidden');
  }

  function clearStudentError() {
    const els = getEls();
    if (!els.studentErrorBox) return;
    els.studentErrorBox.classList.add('hidden');
    els.studentErrorBox.textContent = '';
  }

  function mapStudentIdToInternalEmail(studentIdRaw) {
    const clean = String(studentIdRaw || '').trim();
    if (!clean || /@/.test(clean) || !/^[a-zA-Z0-9_-]{3,32}$/.test(clean)) return '';
    return `${clean.toLowerCase()}@${INTERNAL_STUDENT_DOMAIN}`;
  }

  function mapSupabaseAuthError(rawMsg, isStudentPortal = false) {
    const s = String(rawMsg || '');
    const low = s.toLowerCase();
    if (low.includes('invalid login credentials') || low.includes('invalid_credentials')) {
      return isStudentPortal
        ? 'Incorrect Student ID or password. Please verify your credentials and try again.'
        : 'Incorrect email or password. Please verify your credentials and try again.';
    }
    if (low.includes('email not confirmed')) {
      return isStudentPortal
        ? 'Student account created, awaiting email confirmation in Supabase Dashboard -> Authentication -> Users.'
        : 'Account created, but email confirmation is enabled in Supabase. Confirm admin@omnisx.com in Supabase Dashboard -> Authentication -> Users.';
    }
    if (low.includes('too many requests') || low.includes('rate limit')) {
      return 'Too many login attempts. Please wait a moment and try again.';
    }
    if (low.includes('network') || low.includes('fetch')) {
      return 'Unable to reach Supabase authentication service. Check your internet connection.';
    }
    return isStudentPortal ? s.replace(/[a-z0-9._-]+@students\.omnisx\.com/gi, 'your student account') : (s || 'Authentication failed. Please try again.');
  }

  async function enterDashboard(userObj, roleInfo = null) {
    const els = getEls();
    let role = roleInfo && roleInfo.role ? roleInfo.role : null;
    if (!role && global.OMNIS_DB && typeof global.OMNIS_DB.resolveUserRole === 'function') {
      const resolved = await global.OMNIS_DB.resolveUserRole();
      role = resolved ? resolved.role : null;
    }

    if (role === 'student') {
      if (global.OMNIS_APP && typeof global.OMNIS_APP.deactivateDashboard === 'function') {
        global.OMNIS_APP.deactivateDashboard();
      }
      if (els.appShell) els.appShell.classList.add('hidden');
      const ok = global.OMNIS_STUDENT && typeof global.OMNIS_STUDENT.activateStudentDashboard === 'function'
        ? await global.OMNIS_STUDENT.activateStudentDashboard()
        : false;
      if (!ok) {
        if (global.OMNIS_DB && typeof global.OMNIS_DB.signOutUser === 'function') {
          await global.OMNIS_DB.signOutUser();
        }
        showStudentError('Student profile verification failed. Contact campus administration.');
        return;
      }
      isLoggedIn = true;
      stopSlideshow();
      clearLoginError();
      clearStudentError();
      if (els.landing) els.landing.classList.add('hidden');
      return;
    }

    if (role !== 'admin') {
      if (global.OMNIS_DB && typeof global.OMNIS_DB.signOutUser === 'function') {
        await global.OMNIS_DB.signOutUser();
      }
      showLoginError('Account lacks an authorized institutional role.');
      return;
    }

    if (global.OMNIS_STUDENT && typeof global.OMNIS_STUDENT.deactivateStudentDashboard === 'function') {
      global.OMNIS_STUDENT.deactivateStudentDashboard();
    }
    if (els.studentDashboardShell) els.studentDashboardShell.classList.add('hidden');

    isLoggedIn = true;
    stopSlideshow();
    clearLoginError();
    clearStudentError();

    const emailText = userObj && userObj.email ? userObj.email : '';
    if (els.sidebarUserRow && els.sidebarUserEmail) {
      els.sidebarUserEmail.textContent = emailText || 'Authenticated Admin';
      els.sidebarUserRow.classList.toggle('hidden', !emailText);
    }

    if (els.landing) els.landing.classList.add('hidden');
    if (els.appShell) els.appShell.classList.remove('hidden');

    if (global.OMNIS_APP && typeof global.OMNIS_APP.activateDashboard === 'function') {
      await global.OMNIS_APP.activateDashboard();
    }
  }

  async function signOutToLanding(skipDbSignOut = false) {
    const els = getEls();
    if (!skipDbSignOut && global.OMNIS_DB && typeof global.OMNIS_DB.signOutUser === 'function') {
      if (els.btnSignOut) {
        els.btnSignOut.disabled = true;
        els.btnSignOut.textContent = 'Logging out...';
      }
      await global.OMNIS_DB.signOutUser();
      if (els.btnSignOut) {
        els.btnSignOut.disabled = false;
        els.btnSignOut.textContent = 'Logout';
      }
    }

    isLoggedIn = false;
    isPaused = false;
    setAuthLoading(false);
    setStudentAuthLoading(false);
    clearLoginError();
    clearStudentError();

    if (global.OMNIS_APP && typeof global.OMNIS_APP.deactivateDashboard === 'function') {
      global.OMNIS_APP.deactivateDashboard();
    }
    if (global.OMNIS_STUDENT && typeof global.OMNIS_STUDENT.deactivateStudentDashboard === 'function') {
      global.OMNIS_STUDENT.deactivateStudentDashboard();
    }
    if (els.sidebarUserRow) els.sidebarUserRow.classList.add('hidden');
    if (els.password) {
      els.password.value = '';
      els.password.type = 'password';
    }
    if (els.studentPasswordInput) {
      els.studentPasswordInput.value = '';
      els.studentPasswordInput.type = 'password';
    }
    if (els.btnTogglePw) {
      els.btnTogglePw.textContent = 'Show';
      els.btnTogglePw.setAttribute('aria-pressed', 'false');
    }
    if (els.btnToggleStudentPw) {
      els.btnToggleStudentPw.textContent = 'Show';
      els.btnToggleStudentPw.setAttribute('aria-pressed', 'false');
    }

    if (els.appShell) els.appShell.classList.add('hidden');
    if (els.studentDashboardShell) els.studentDashboardShell.classList.add('hidden');
    if (els.landing) els.landing.classList.remove('hidden');
    goToSlide(0);
    startSlideshow();
  }

  function validateInputs(emailRaw, passwordRaw) {
    const email = String(emailRaw || '').trim();
    const password = String(passwordRaw || '');
    if (!email) {
      return { ok: false, error: 'Please enter your institutional email address.', focusField: 'email' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Please enter a valid email address (e.g. admin@omnisx.com).', focusField: 'email' };
    }
    if (!password) {
      return { ok: false, error: 'Please enter your password.', focusField: 'password' };
    }
    return { ok: true, email, password };
  }

  function validateStudentInputs(studentIdRaw, passwordRaw) {
    const sid = String(studentIdRaw || '').trim();
    const password = String(passwordRaw || '');
    if (!sid) {
      return { ok: false, error: 'Please enter your Student ID (e.g. STU001).', focusField: 'studentId' };
    }
    const mappedEmail = mapStudentIdToInternalEmail(sid);
    if (!mappedEmail) {
      return { ok: false, error: 'Enter a valid Student ID using letters and numbers only (e.g. STU001).', focusField: 'studentId' };
    }
    if (!password) {
      return { ok: false, error: 'Please enter your student password.', focusField: 'studentPassword' };
    }
    return { ok: true, studentId: sid.toUpperCase(), internalEmail: mappedEmail, password };
  }

  function bindLoginEvents() {
    const els = getEls();
    if (!els.landing || els.landing.dataset.loginBound === '1') return;
    els.landing.dataset.loginBound = '1';

    if (els.btnPrev) {
      els.btnPrev.addEventListener('click', () => {
        pauseByInteraction();
        goToSlide((activeIndex - 1 + SLIDES.length) % SLIDES.length);
      });
    }

    if (els.btnNext) {
      els.btnNext.addEventListener('click', () => {
        pauseByInteraction();
        const nextIdx = (activeIndex + 1) % SLIDES.length;
        goToSlide(nextIdx, { wrapForward: nextIdx === 0 });
      });
    }

    if (els.btnPause) {
      els.btnPause.addEventListener('click', togglePause);
    }

    if (els.indicators) {
      els.indicators.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-dot-idx]');
        if (!btn) return;
        pauseByInteraction();
        goToSlide(Number(btn.dataset.dotIdx));
      });
    }

    if (els.btnTogglePw && els.password) {
      els.btnTogglePw.addEventListener('click', () => {
        const showing = els.password.type === 'text';
        els.password.type = showing ? 'password' : 'text';
        els.btnTogglePw.textContent = showing ? 'Show' : 'Hide';
        els.btnTogglePw.setAttribute('aria-pressed', String(!showing));
        els.btnTogglePw.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    }

    if (els.btnDemoFill && els.username && els.password) {
      els.btnDemoFill.addEventListener('click', () => {
        if (isAuthenticating) return;
        els.username.value = DEMO_CREDENTIALS.email;
        els.password.value = DEMO_CREDENTIALS.password;
        clearLoginError();
        els.password.focus();
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isAuthenticating) return;
        clearLoginError();

        const check = validateInputs(els.username ? els.username.value : '', els.password ? els.password.value : '');
        if (!check.ok) {
          showLoginError(check.error);
          if (check.focusField === 'email' && els.username) els.username.focus();
          else if (els.password) els.password.focus();
          return;
        }

        if (!global.OMNIS_DB || typeof global.OMNIS_DB.signInWithPassword !== 'function') {
          showLoginError('Authentication service is unavailable.');
          return;
        }

        setAuthLoading(true);
        const res = await global.OMNIS_DB.signInWithPassword(check.email, check.password);
        setAuthLoading(false);

        if (!res || !res.ok) {
          showLoginError(mapSupabaseAuthError(res && res.error, false));
          if (els.password) els.password.focus();
          return;
        }

        if (res.role !== 'admin') {
          if (typeof global.OMNIS_DB.signOutUser === 'function') await global.OMNIS_DB.signOutUser();
          showLoginError('Student accounts must sign in using the Student Portal Login section below.');
          return;
        }

        await enterDashboard(res.user, { role: res.role });
      });
    }

    if (els.studentAccordionBtn && els.studentPanel) {
      els.studentAccordionBtn.addEventListener('click', () => {
        const expanded = els.studentAccordionBtn.getAttribute('aria-expanded') === 'true';
        const next = !expanded;
        els.studentAccordionBtn.setAttribute('aria-expanded', String(next));
        els.studentPanel.classList.toggle('hidden', !next);
        clearStudentError();
      });
    }

    if (els.btnToggleStudentPw && els.studentPasswordInput) {
      els.btnToggleStudentPw.addEventListener('click', () => {
        const showing = els.studentPasswordInput.type === 'text';
        els.studentPasswordInput.type = showing ? 'password' : 'text';
        els.btnToggleStudentPw.textContent = showing ? 'Show' : 'Hide';
        els.btnToggleStudentPw.setAttribute('aria-pressed', String(!showing));
        els.btnToggleStudentPw.setAttribute('aria-label', showing ? 'Show student password' : 'Hide student password');
      });
    }

    if (els.btnStudentDemoFill && els.studentIdInput && els.studentPasswordInput) {
      els.btnStudentDemoFill.addEventListener('click', () => {
        if (isAuthenticating) return;
        els.studentIdInput.value = DEMO_STUDENT_CREDENTIALS.studentId;
        els.studentPasswordInput.value = DEMO_STUDENT_CREDENTIALS.password;
        clearStudentError();
        els.studentPasswordInput.focus();
      });
    }

    if (els.studentForm) {
      els.studentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isAuthenticating) return;
        clearStudentError();

        const check = validateStudentInputs(
          els.studentIdInput ? els.studentIdInput.value : '',
          els.studentPasswordInput ? els.studentPasswordInput.value : ''
        );
        if (!check.ok) {
          showStudentError(check.error);
          if (check.focusField === 'studentId' && els.studentIdInput) els.studentIdInput.focus();
          else if (els.studentPasswordInput) els.studentPasswordInput.focus();
          return;
        }

        if (!global.OMNIS_DB || typeof global.OMNIS_DB.signInWithPassword !== 'function') {
          showStudentError('Authentication service is unavailable.');
          return;
        }

        setStudentAuthLoading(true);
        const res = await global.OMNIS_DB.signInWithPassword(check.internalEmail, check.password);
        setStudentAuthLoading(false);

        if (!res || !res.ok) {
          showStudentError(mapSupabaseAuthError(res && res.error, true));
          if (els.studentPasswordInput) els.studentPasswordInput.focus();
          return;
        }

        if (res.role !== 'student') {
          if (typeof global.OMNIS_DB.signOutUser === 'function') await global.OMNIS_DB.signOutUser();
          showStudentError('Administrator accounts must sign in using the Institutional Email form above.');
          return;
        }

        await enterDashboard(res.user, { role: 'student', studentId: res.studentId, profile: res.profile });
      });
    }

    if (els.btnSignOut) {
      els.btnSignOut.addEventListener('click', () => signOutToLanding(false));
    }

    global.addEventListener('omnis:auth-signed-out', () => {
      if (isLoggedIn) signOutToLanding(true);
    });
  }

  async function initLoginLanding() {
    const els = getEls();
    if (!els.landing || !els.appShell) return;

    // Enforce unauthenticated landing guard on initial render before checking Supabase session
    els.appShell.classList.add('hidden');
    if (els.studentDashboardShell) els.studentDashboardShell.classList.add('hidden');
    els.landing.classList.remove('hidden');

    buildSlideDom();
    bindLoginEvents();
    updateIndicators();

    preloadImages().then(() => {
      if (!isLoggedIn && !isPaused) {
        startSlideshow();
      }
    });

    // Verify real Supabase session & role on load
    if (global.OMNIS_DB && typeof global.OMNIS_DB.getAuthSession === 'function') {
      const auth = await global.OMNIS_DB.getAuthSession();
      if (auth && auth.authenticated && auth.user && auth.role && auth.role !== 'unauthorized') {
        await enterDashboard(auth.user, { role: auth.role, studentId: auth.studentId, profile: auth.profile });
      }
    }
  }

  global.OMNIS_LOGIN = {
    SLIDE_INTERVAL_MS,
    SLIDES,
    DEMO_CREDENTIALS,
    DEMO_STUDENT_CREDENTIALS,
    goToSlide,
    togglePause,
    enterDashboard,
    signOutToLanding,
    getState: () => ({ activeIndex, isPaused, isLoggedIn, isAuthenticating, hasTimer: Boolean(slideTimerId) })
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginLanding);
  } else {
    initLoginLanding();
  }
})(window);
