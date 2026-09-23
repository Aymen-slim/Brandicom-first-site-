(function () {
  var form = document.getElementById("email-form");
  if (!form || !form.classList.contains("contac_from")) return;

  var block = form.closest(".w-form");
  var done = block ? block.querySelector(".w-form-done") : null;
  var fail = block ? block.querySelector(".w-form-fail") : null;
  var button = form.querySelector('[type="submit"]');
  var idleLabel = button ? button.value : "Send Message";

  function show(el, visible) {
    if (el) el.style.display = visible ? "block" : "none";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    show(fail, false);

    var services = [];
    if (document.getElementById("checkbox") && document.getElementById("checkbox").checked) {
      services.push("Content Creation");
    }
    if (document.getElementById("checkbox-two") && document.getElementById("checkbox-two").checked) {
      services.push("Social Management");
    }
    if (document.getElementById("checkbox-three") && document.getElementById("checkbox-three").checked) {
      services.push("Paid Ads");
    }

    var payload = {
      name: (document.getElementById("name") || {}).value || "",
      email: (document.getElementById("mail") || {}).value || "",
      budget: (document.getElementById("social-budgeyt") || {}).value || "",
      message: (document.getElementById("field") || {}).value || "",
      services: services,
      company_website: (document.getElementById("company_website") || {}).value || "",
    };

    if (button) {
      button.disabled = true;
      button.value = button.getAttribute("data-wait") || "Please wait...";
    }

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          var message = (result.data && result.data.error) || "Oops! Something went wrong while submitting the form.";
          if (fail) {
            fail.textContent = message;
            show(fail, true);
          }
          return;
        }
        form.style.display = "none";
        show(done, true);
      })
      .catch(function () {
        if (fail) {
          fail.textContent = "Oops! Something went wrong while submitting the form.";
          show(fail, true);
        }
      })
      .then(function () {
        if (button && form.style.display !== "none") {
          button.disabled = false;
          button.value = idleLabel;
        }
      });
  }, true);
})();
