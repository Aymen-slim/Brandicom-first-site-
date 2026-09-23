document.addEventListener("DOMContentLoaded", function () {
  var year = new Date().getFullYear();
  document.querySelectorAll("[data-footer-year]").forEach(function (el) {
    el.textContent = year;
  });
});
