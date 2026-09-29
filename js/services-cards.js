document.addEventListener("DOMContentLoaded", () => {
  const cards = Array.from(document.querySelectorAll(".services_card"));

  function fitOpenCard(card) {
    const overlay = card.querySelector(".services_card_overlay");
    if (!overlay) return;

    if (!card.classList.contains("is-open")) {
      card.style.minHeight = "";
      return;
    }

    const styles = getComputedStyle(overlay);
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const children = Array.from(overlay.children);
    const content = children.reduce(function (sum, child) {
      return sum + child.scrollHeight;
    }, 0);
    const gap = 20 * Math.max(children.length - 1, 0);
    card.style.minHeight = Math.ceil(padding + content + gap) + "px";
  }

  function setOpen(card, open) {
    cards.forEach((other) => {
      if (other === card) return;
      other.classList.remove("is-open");
      other.style.minHeight = "";
      const otherArrow = other.querySelector(".services_card-arrow-wrap");
      if (otherArrow) otherArrow.setAttribute("aria-expanded", "false");
    });

    card.classList.toggle("is-open", open);
    const arrow = card.querySelector(".services_card-arrow-wrap");
    if (arrow) arrow.setAttribute("aria-expanded", open ? "true" : "false");
    fitOpenCard(card);
  }

  function bindControl(control, action) {
    if (!control) return;
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      action();
    });
  }

  cards.forEach((card) => {
    const arrow = card.querySelector(".services_card-arrow-wrap");
    const closeBtn = card.querySelector(".services_card_arrow_two");
    const title = card.querySelector(".services_card_title");
    const label = title ? title.textContent.trim() : "service";

    if (arrow) {
      arrow.setAttribute("aria-expanded", "false");
      arrow.setAttribute("aria-label", "Open " + label + " details");
    }
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", "Close " + label + " details");
    }

    bindControl(arrow, () => setOpen(card, !card.classList.contains("is-open")));
    bindControl(closeBtn, () => setOpen(card, false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    cards.forEach((card) => setOpen(card, false));
  });

  window.addEventListener("resize", () => {
    cards.forEach((card) => {
      if (card.classList.contains("is-open")) fitOpenCard(card);
    });
  });
});
