/* mock.js — the clock that drives a mock draft.

   Owns nothing about the draft itself: it decides *when* a bot pick should
   happen and asks the host to make it. That split keeps the timing testable
   and keeps the app free to render however it likes. */
(function (global) {
  'use strict';

  var MIN_SPEED = 0.5;   // seconds per pick
  var MAX_SPEED = 5.0;
  var DEFAULT_SPEED = 2.0;
  var TICK_MS = 100;     // how often the clock is consulted, not the pick rate

  function clampSpeed(sec) {
    var n = Number(sec);
    if (!isFinite(n)) return DEFAULT_SPEED;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
  }

  /* host:
       isComplete()  — the draft is over, stop for good
       isMyTurn()    — Ken is on the clock, hold the clock until he picks
       isBlocked()   — a press is in progress; a pick now would kill it
       pick()        — make one bot pick; returns truthy if it landed
       onChange(why) — the state the controls render from moved
     now: injectable clock, so a test does not have to wait in real time. */
  function create(host, now) {
    var clock = now || function () { return Date.now(); };

    var speed = DEFAULT_SPEED;
    var running = false;
    var userPaused = false;   // an explicit pause survives everything below
    var hiddenPaused = false; // the tab went away mid-run
    var lastPickAt = 0;
    var timer = null;

    function intervalMs() { return speed * 1000; }

    function notify(why) { if (host.onChange) host.onChange(why); }

    function ensureTimer() {
      if (timer == null) timer = global.setInterval(tick, TICK_MS);
    }

    function clearTimer() {
      if (timer != null) { global.clearInterval(timer); timer = null; }
    }

    // Driven by elapsed time rather than by a fixed setTimeout chain, so a
    // throttled or suspended tab cannot bank up picks and then dump them all
    // at once on return: at most one pick happens per tick, whatever the gap.
    function tick() {
      if (!running) return;

      if (host.isComplete()) {
        running = false;
        clearTimer();
        notify('complete');
        return;
      }

      if (host.isMyTurn()) {
        running = false;
        clearTimer();
        notify('yourturn');
        return;
      }

      // A press in flight owns the screen. Restart the countdown rather than
      // firing the instant the finger lifts, which would feel like a misfire.
      if (host.isBlocked && host.isBlocked()) {
        lastPickAt = clock();
        return;
      }

      if (clock() - lastPickAt < intervalMs()) return;

      lastPickAt = clock();
      host.pick();
      notify('pick');
    }

    function startClock() {
      lastPickAt = clock();
      running = true;
      ensureTimer();
    }

    var api = {
      MIN_SPEED: MIN_SPEED,
      MAX_SPEED: MAX_SPEED,
      DEFAULT_SPEED: DEFAULT_SPEED,

      isRunning: function () { return running; },
      isUserPaused: function () { return userPaused; },
      getSpeed: function () { return speed; },

      setSpeed: function (sec) {
        speed = clampSpeed(sec);
        notify('speed');
        return speed;
      },

      // Begin, or resume after Ken's pick / an explicit pause.
      resume: function () {
        if (running) return false;
        if (host.isComplete() || host.isMyTurn()) { notify('blocked'); return false; }
        userPaused = false;
        hiddenPaused = false;
        startClock();
        notify('resume');
        return true;
      },

      pause: function () {
        userPaused = true;
        if (!running) { notify('pause'); return false; }
        running = false;
        clearTimer();
        notify('pause');
        return true;
      },

      // One bot pick, immediately, whether or not the clock is running. Leaves
      // the run paused so stepping stays a deliberate, one-at-a-time act.
      step: function () {
        if (host.isComplete() || host.isMyTurn()) { notify('blocked'); return false; }
        running = false;
        clearTimer();
        userPaused = true;
        host.pick();
        lastPickAt = clock();
        notify('step');
        return true;
      },

      // Fast-forward to Ken's next turn with no waiting between picks. Bounded
      // by the pick count so a misbehaving host cannot spin forever.
      skipToMine: function () {
        var made = 0;
        var guard = global.Draft.LEAGUE.totalPicks + 1;
        while (guard-- > 0 && !host.isComplete() && !host.isMyTurn()) {
          if (!host.pick()) break;
          made++;
        }
        running = false;
        clearTimer();
        userPaused = true;
        lastPickAt = clock();
        notify('skip');
        return made;
      },

      // Ken has drafted, so the clock can pick itself back up — unless he
      // paused it on purpose, in which case it stays where he left it.
      nudge: function () {
        if (running || userPaused) return false;
        if (host.isComplete() || host.isMyTurn()) return false;
        startClock();
        notify('resume');
        return true;
      },

      // Leaving mock mode entirely.
      stop: function () {
        running = false;
        userPaused = false;
        hiddenPaused = false;
        clearTimer();
        notify('stop');
      },

      // Wired to visibilitychange. A locked phone must not keep drafting, and
      // coming back must not feel like the draft ran away without him.
      onVisibility: function (hidden) {
        if (hidden) {
          if (running) {
            hiddenPaused = true;
            running = false;
            clearTimer();
            notify('hidden');
          }
        } else if (hiddenPaused) {
          hiddenPaused = false;
          if (!userPaused && !host.isComplete() && !host.isMyTurn()) {
            startClock();
            notify('resume');
          } else {
            notify('visible');
          }
        }
      },

      // Test seam: run the clock by hand instead of waiting on setInterval.
      tick: tick
    };

    return api;
  }

  global.Mock = {
    MIN_SPEED: MIN_SPEED,
    MAX_SPEED: MAX_SPEED,
    DEFAULT_SPEED: DEFAULT_SPEED,
    TICK_MS: TICK_MS,
    clampSpeed: clampSpeed,
    create: create
  };
})(window);
