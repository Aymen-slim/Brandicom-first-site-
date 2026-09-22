document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".services_card").forEach((card) => {
    const arrow = card.querySelector(".services_card-arrow-wrap");
    const closeBtn = card.querySelector(".services_card_arrow_two");

    if (arrow) {
      arrow.addEventListener("click", (event) => {
        event.stopPropagation();
        card.classList.toggle("is-open");
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        card.classList.remove("is-open");
      });
    }
  });
});
