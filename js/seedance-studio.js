(function () {
  var form = document.getElementById("seedance-form");
  if (!form) return;

  var prompt = document.getElementById("seedance-prompt");
  var duration = document.getElementById("seedance-duration");
  var resolution = document.getElementById("seedance-resolution");
  var aspect = document.getElementById("seedance-aspect");
  var bitrate = document.getElementById("seedance-bitrate");
  var format = document.getElementById("seedance-format");
  var audio = document.getElementById("seedance-audio");
  var access = document.getElementById("seedance-access");
  var estimateEl = document.getElementById("seedance-estimate");
  var statusEl = document.getElementById("seedance-status");
  var submitButton = document.getElementById("seedance-submit");
  var cancelButton = document.getElementById("seedance-cancel");
  var stage = document.getElementById("seedance-stage");
  var player = document.getElementById("seedance-player");
  var download = document.getElementById("seedance-download");
  var empty = document.getElementById("seedance-empty");

  var ACCESS_STORAGE = "seedance-access-key";
  var activeRequest = null;
  var pollTimer = null;
  var pollDelay = 2000;
  var previewTimer = null;

  var STATUS_LABELS = {
    queued: "Queued",
    in_progress: "Generating",
    completed: "Ready",
    failed: "Generation failed",
    nsfw: "This prompt was blocked",
    canceled: "Canceled",
  };

  if (access && sessionStorage.getItem(ACCESS_STORAGE)) {
    access.value = sessionStorage.getItem(ACCESS_STORAGE);
  }

  function endpoint(search) {
    return new URL("/api/seedance" + (search || ""), window.location.origin).href;
  }

  function setStatus(message, kind) {
    statusEl.textContent = message || "";
    statusEl.dataset.kind = kind || "";
  }

  function money(usd) {
    return "$" + Number(usd).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function currentSettings() {
    return {
      duration: duration.value,
      resolution: resolution.value,
      aspect_ratio: aspect.value,
      bitrate_mode: bitrate.value,
      output_format: format.value,
      generate_audio: audio.checked ? "true" : "false",
    };
  }

  function updateFrame() {
    var parts = String(aspect.value || "16:9").split(":");
    var width = Number(parts[0]) || 16;
    var height = Number(parts[1]) || 9;
    stage.style.aspectRatio = width + " / " + height;
  }

  function renderEstimate(estimate) {
    if (!estimate) {
      estimateEl.textContent = "Estimate unavailable.";
      submitButton.textContent = "Generate video";
      return;
    }
    estimateEl.textContent =
      "About " +
      money(estimate.usd) +
      " · " +
      estimate.width +
      "×" +
      estimate.height +
      " · " +
      estimate.tokens.toLocaleString("en-US") +
      " video tokens";
    submitButton.textContent = "Generate · about " + money(estimate.usd);
  }

  function refreshEstimate() {
    updateFrame();
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(function () {
      var params = new URLSearchParams(currentSettings());
      params.set("preview", "1");
      fetch(endpoint("?" + params.toString()))
        .then(function (response) {
          return response.json().then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          renderEstimate(result.ok ? result.body.estimate : null);
        })
        .catch(function () {
          renderEstimate(null);
        });
    }, 120);
  }

  function stopPolling() {
    window.clearTimeout(pollTimer);
    pollTimer = null;
    pollDelay = 2000;
  }

  function showVideo(url, downloadName) {
    if (!url) return;
    player.src = url;
    player.hidden = false;
    empty.hidden = true;
    download.hidden = false;
    download.href = url;
    download.download = downloadName || "seedance.mp4";
  }

  function authHeaders() {
    var key = access.value.trim();
    sessionStorage.setItem(ACCESS_STORAGE, key);
    return {
      "Content-Type": "application/json",
      "x-seedance-key": key,
    };
  }

  function applyStatus(body) {
    var label = STATUS_LABELS[body.status] || body.status || "Working";
    if (body.status === "failed" || body.status === "nsfw") {
      setStatus(body.error ? label + ". " + body.error : label + ".", "error");
    } else if (body.status === "completed") {
      var url = (body.video && body.video.url) || (body.mov && body.mov.url) || "";
      showVideo(url, format.value === "mov" ? "seedance.mov" : "seedance.mp4");
      setStatus("Your video is ready.", "success");
    } else if (body.status === "canceled") {
      setStatus("Generation canceled.", "");
    } else {
      setStatus(label + "…", "pending");
    }
  }

  function terminal(status) {
    return status === "completed" || status === "failed" || status === "nsfw" || status === "canceled";
  }

  function poll() {
    if (!activeRequest) return;
    fetch(endpoint("?request_id=" + encodeURIComponent(activeRequest)), {
      headers: { "x-seedance-key": access.value.trim() },
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          setStatus(result.body.error || "Unable to check generation status.", "error");
          finish();
          return;
        }
        applyStatus(result.body);
        if (terminal(result.body.status)) {
          finish();
          return;
        }
        pollDelay = Math.min(pollDelay * 1.5, 10000);
        pollTimer = window.setTimeout(poll, pollDelay);
      })
      .catch(function () {
        setStatus("Unable to check generation status.", "error");
        finish();
      });
  }

  function finish() {
    stopPolling();
    activeRequest = null;
    submitButton.disabled = false;
    cancelButton.hidden = true;
    refreshEstimate();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitButton.disabled) return;
    if (prompt.value.trim().length < 1) {
      setStatus("Write a prompt.", "error");
      prompt.focus();
      return;
    }
    if (access.value.trim().length < 8) {
      setStatus("Enter the studio access key.", "error");
      access.focus();
      return;
    }

    stopPolling();
    submitButton.disabled = true;
    cancelButton.hidden = false;
    player.hidden = true;
    player.removeAttribute("src");
    download.hidden = true;
    empty.hidden = false;
    setStatus("Submitting…", "pending");

    var payload = currentSettings();
    payload.prompt = prompt.value.trim();
    payload.duration = Number(payload.duration);
    payload.generate_audio = audio.checked;

    fetch(endpoint(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          setStatus(result.body.error || "Unable to start generation.", "error");
          finish();
          return;
        }
        if (result.body.estimate) renderEstimate(result.body.estimate);
        activeRequest = result.body.request_id;
        applyStatus(result.body);
        if (!activeRequest || terminal(result.body.status)) {
          finish();
          return;
        }
        pollTimer = window.setTimeout(poll, pollDelay);
      })
      .catch(function () {
        setStatus("Unable to start generation.", "error");
        finish();
      });
  });

  cancelButton.addEventListener("click", function () {
    if (!activeRequest) return;
    cancelButton.disabled = true;
    fetch(endpoint(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action: "cancel", request_id: activeRequest }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      })
      .then(function (result) {
        cancelButton.disabled = false;
        if (result.status === 202 || (result.ok && result.body.status === "canceled")) {
          applyStatus({ status: "canceled" });
          finish();
          return;
        }
        setStatus(result.body.error || "Unable to cancel this generation.", "error");
      })
      .catch(function () {
        cancelButton.disabled = false;
        setStatus("Unable to cancel this generation.", "error");
      });
  });

  [duration, resolution, aspect, bitrate, format, audio].forEach(function (field) {
    field.addEventListener("input", refreshEstimate);
    field.addEventListener("change", refreshEstimate);
  });

  document.querySelectorAll(".nav_menu-button").forEach(function (button) {
    button.addEventListener("click", function () {
      var nav = button.closest(".navbar");
      var menu = nav && nav.querySelector(".w-nav-menu");
      var open = button.classList.toggle("w--open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (!menu) return;
      if (open) {
        menu.setAttribute("data-nav-menu-open", "");
        menu.style.display = "block";
      } else {
        menu.removeAttribute("data-nav-menu-open");
        menu.style.display = "";
      }
    });
  });

  refreshEstimate();
})();
