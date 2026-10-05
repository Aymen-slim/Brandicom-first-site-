(function () {
  "use strict";
  var watchers = [];
  var pausedByUser = new WeakSet();
  var widths = new WeakMap();
  var trackedVideos = new Set();
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var phone = window.matchMedia("(max-width: 767px)");

  function watchVisibility(element, callback) {
    var state = { element: element, visible: !("IntersectionObserver" in window), active: null, callback: callback };
    function update() {
      var active = state.visible && !document.hidden;
      if (active !== state.active) {
        state.active = active;
        callback(active);
      }
    }
    state.update = update;
    watchers.push(state);
    if ("IntersectionObserver" in window) {
      var threshold = element.classList && element.classList.contains("cucina-reels-stage") ? 0.15 : 0;
      state.observer = new IntersectionObserver(function (entries) {
        state.visible = entries[0].isIntersecting && (entries[0].intersectionRatio || 0) >= threshold;
        update();
      }, { threshold: threshold });
      state.observer.observe(element);
    }
    update();
    return function () {
      if (state.observer) state.observer.disconnect();
      watchers.splice(watchers.indexOf(state), 1);
    };
  }

  function width(element, divisor) {
    if (!widths.has(element)) {
      var measure = function () { widths.set(element, element.scrollWidth); };
      measure();
      if ("ResizeObserver" in window) new ResizeObserver(measure).observe(element);
      else window.addEventListener("resize", measure, { passive: true });
      element.addEventListener("load", measure, true);
    }
    return widths.get(element) / (divisor || 1);
  }

  function loadVideo(video) {
    var changed = false;
    var elements = [video].concat(Array.from(video.querySelectorAll("source[data-src]")));
    elements.forEach(function (element) {
      if (!element.dataset.src) return;
      element.src = phone.matches && element.dataset.mobileSrc ? element.dataset.mobileSrc : element.dataset.src;
      element.removeAttribute("data-src");
      changed = true;
    });
    if (changed) video.load();
    trackedVideos.add(video);
  }

  function play(video, manual) {
    if (!video || document.hidden) return Promise.resolve();
    if (manual) pausedByUser.delete(video);
    if (pausedByUser.has(video)) return Promise.resolve();
    var stage = video.closest(".cucina-reels-stage");
    if (stage && (!stage.__performanceVisible || !video.closest(".cucina-reel-card.is-active"))) return Promise.resolve();
    loadVideo(video);
    if (video.__performancePending || !video.paused) return Promise.resolve();
    video.__performancePending = true;
    var promise = video.play();
    return Promise.resolve(promise).catch(function () {}).then(function () { video.__performancePending = false; });
  }

  function loop(element, tick) {
    var frame = 0;
    var active = false;
    var lastTime = 0;
    function step(time) {
      frame = 0;
      if (!active) return;
      tick(time, lastTime ? Math.min(time - lastTime, 50) : 0);
      lastTime = time;
      frame = requestAnimationFrame(step);
    }
    return watchVisibility(element, function (visible) {
      active = visible;
      lastTime = 0;
      if (visible && !frame) frame = requestAnimationFrame(step);
      else if (!visible) { cancelAnimationFrame(frame); frame = 0; }
    });
  }

  function ticker(element, tick) {
    watchVisibility(element, function (visible) {
      if (visible) gsap.ticker.add(tick);
      else gsap.ticker.remove(tick);
    });
  }

  function animateChars(chars, options) {
    var states = chars.map(function () { return { progress: 0 }; });
    function clear() {
      chars.forEach(function (char) { char.style.removeProperty("transform"); char.style.removeProperty("opacity"); });
    }
    function draw() {
      chars.forEach(function (char, index) {
        var progress = states[index].progress;
        if (progress >= 1) { char.style.removeProperty("transform"); char.style.removeProperty("opacity"); return; }
        char.style.transform = "translate3d(" + (options.x * (1 - progress)).toFixed(3) + "px,0,0)";
        char.style.opacity = String(progress);
      });
    }
    draw();
    var tween = gsap.to(states, { progress: 1, duration: options.duration, ease: options.ease, stagger: options.stagger, onUpdate: draw, onComplete: clear });
    return { revert: function () { tween.kill(); clear(); } };
  }

  function smoothScroll(lenis) {
    var frame = 0;
    function tick(time) {
      frame = 0;
      if (document.hidden) return;
      lenis.raf(time);
      frame = requestAnimationFrame(tick);
    }
    function update() {
      cancelAnimationFrame(frame);
      frame = document.hidden ? 0 : requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    update();
  }

  function manageVideo(video) {
    if (video.closest(".cucina-reels-stage") || video.__performanceManaged) return;
    var wrapper = video.closest(".w-background-video");
    var autoplay = video.hasAttribute("autoplay") || video.dataset.performanceAutoplay === "true" || wrapper && wrapper.dataset.autoplay === "true";
    if (!autoplay) return;
    video.__performanceManaged = true;
    trackedVideos.add(video);
    video.muted = true;
    video.playsInline = true;
    var visible = false;
    function update() {
      if (visible && !document.hidden && !reducedMotion.matches) play(video);
      else video.pause();
    }
    video.__performanceUpdate = update;
    watchVisibility(video, function (active) { visible = active; update(); });
  }

  function syncVisibility() {
    watchers.slice().forEach(function (state) { state.update(); });
    if (document.hidden) trackedVideos.forEach(function (video) { video.pause(); });
  }

  document.addEventListener("visibilitychange", syncVisibility);
  window.addEventListener("pageshow", syncVisibility);
  window.addEventListener("pagehide", function () {
    watchers.forEach(function (state) { state.active = false; state.callback(false); });
    trackedVideos.forEach(function (video) { video.pause(); });
  });

  document.addEventListener("click", function (event) {
    var control = event.target.closest("[data-w-bg-video-control], .reel-mute-btn, .cucina-reel-card.is-active");
    if (!control) return;
    var video = control.hasAttribute("aria-controls") ? document.getElementById(control.getAttribute("aria-controls")) : (control.closest(".cucina-reel-card") || control).querySelector("video");
    if (!video) return;
    if (control.classList.contains("reel-mute-btn") || video.paused) { pausedByUser.delete(video); loadVideo(video); }
    else pausedByUser.add(video);
  }, true);

  function initMenu() {
    if (window.Webflow && typeof window.Webflow.require === "function" && window.Webflow.require("navbar")) return;
    var button = document.querySelector(".navbar .nav_menu-button");
    var menu = document.querySelector(".navbar .nav-manue");
    if (!button || !menu) return;
    menu.id = menu.id || "site-nav-menu";
    menu.classList.add("site-nav-fallback");
    button.setAttribute("aria-controls", menu.id);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Toggle navigation");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    function setOpen(open) {
      button.setAttribute("aria-expanded", String(open));
      button.classList.toggle("w--open", open);
      if (open) menu.setAttribute("data-nav-menu-open", "");
      else menu.removeAttribute("data-nav-menu-open");
    }
    function toggle() { setOpen(button.getAttribute("aria-expanded") !== "true"); }
    button.addEventListener("click", toggle);
    button.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") { setOpen(false); button.focus(); }
    });
    document.addEventListener("click", function (event) {
      if (!button.contains(event.target) && (!menu.contains(event.target) || event.target.closest("a"))) setOpen(false);
    });
    window.addEventListener("resize", function () { if (window.innerWidth > 991) setOpen(false); }, { passive: true });
  }

  function init() {
    initMenu();
    document.querySelectorAll("video").forEach(manageVideo);
    function retryVisibleVideos() {
      trackedVideos.forEach(function (video) { if (video.__performanceUpdate) video.__performanceUpdate(); });
    }
    window.addEventListener("touchstart", retryVisibleVideos, { once: true, passive: true });
    window.addEventListener("pointerdown", retryVisibleVideos, { once: true, passive: true });
    document.querySelectorAll(".marquee_reel_card").forEach(function (card) {
      var video = null;
      card.addEventListener("mouseenter", function () {
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        if (!video && card.dataset.reel) {
          video = document.createElement("video");
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.preload = "none";
          video.dataset.src = "/reels/reel-" + card.dataset.reel + ".mp4";
          video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;z-index:1";
          card.appendChild(video);
        }
        if (video) play(video);
      });
      card.addEventListener("mouseleave", function () { if (video) video.pause(); });
    });
    function motionChanged() {
      trackedVideos.forEach(function (video) { if (video.__performanceUpdate) video.__performanceUpdate(); });
    }
    if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", motionChanged);
    else reducedMotion.addListener(motionChanged);
    window.addEventListener("load", function () {
      if (document.documentElement.classList.contains("w-mod-ix3")) return;
      document.documentElement.classList.add("site-interactions-fallback");
    }, { once: true });
  }

  window.SitePerformance = { watchVisibility: watchVisibility, width: width, loadVideo: loadVideo, play: play, loop: loop, ticker: ticker, smoothScroll: smoothScroll, animateChars: animateChars };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
