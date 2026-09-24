(function () {
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function paragraphs(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map(function (part) { return part.trim(); })
      .filter(Boolean)
      .map(function (part) {
        return "<p>" + escapeHtml(part).replace(/\n/g, "<br>") + "</p>";
      })
      .join("");
  }

  function loadPosts() {
    return fetch("/api/posts", { headers: { Accept: "application/json" } })
      .then(function (res) { return res.json(); })
      .then(function (data) { return Array.isArray(data.posts) ? data.posts : []; })
      .catch(function () { return []; });
  }

  function card(post) {
    var href = "../post/index.html?slug=" + encodeURIComponent(post.slug);
    return (
      '<div role="listitem" class="blog_collection-item w-dyn-item" data-live-post="true">' +
        '<div class="blog_collection-link"><div class="blog_collection-wrap">' +
          '<a href="' + href + '" class="blog_collection-image-wrap w-inline-block">' +
            '<img src="' + escapeHtml(post.coverImage) + '" alt="' + escapeHtml(post.title) + '" class="blog_collection-image">' +
            '<div class="blog_collection_image_over"><div class="blog_collection_image_text">See Details</div></div>' +
          "</a>" +
          '<div class="blog_data-wrap">' +
            '<div class="text-small text-color-light-dark">' + escapeHtml(formatDate(post.publishedAt)) + "</div>" +
            '<a href="' + href + '" class="text-size-xmedium">' + escapeHtml(post.title) + "</a>" +
            '<p class="text-small text-color-light-dark">' + escapeHtml(post.excerpt) + "</p>" +
          "</div>" +
        "</div></div></div>"
    );
  }

  function renderList(posts) {
    var list = document.querySelector(".blog_collection-list");
    if (!list || !posts.length) return;
    var html = posts.map(card).join("");
    list.insertAdjacentHTML("afterbegin", html);
  }

  function renderArticle(post) {
    var title = document.getElementById("live-post-title");
    var excerpt = document.getElementById("live-post-excerpt");
    var meta = document.getElementById("live-post-meta");
    var cover = document.getElementById("live-post-cover");
    var body = document.getElementById("live-post-body");
    var secondWrap = document.getElementById("live-post-second-wrap");
    var second = document.getElementById("live-post-second");
    var status = document.getElementById("live-post-status");
    if (!title || !body) return;

    if (!post) {
      title.textContent = "Post not found";
      if (status) status.textContent = "This post could not be found.";
      return;
    }

    document.title = post.title;
    title.textContent = post.title;
    if (excerpt) excerpt.textContent = post.excerpt;
    if (meta) meta.textContent = post.readMinutes + " min Read  |  " + formatDate(post.publishedAt);
    if (cover && post.coverImage) {
      cover.src = post.coverImage;
      cover.alt = post.title;
      cover.hidden = false;
    }
    body.innerHTML = paragraphs(post.body);
    if (second && secondWrap && post.secondImage) {
      second.src = post.secondImage;
      second.alt = post.title;
      secondWrap.hidden = false;
    }
    if (status) status.hidden = true;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var article = document.getElementById("live-post");
    if (article) {
      var slug = new URLSearchParams(window.location.search).get("slug") || "";
      var url = slug ? "/api/posts?slug=" + encodeURIComponent(slug) : "/api/posts";
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var posts = Array.isArray(data.posts) ? data.posts : [];
          renderArticle(slug ? posts[0] : null);
          if (!slug) {
            var status = document.getElementById("live-post-status");
            if (status) status.textContent = posts.length ? "Choose a post from the blog." : "No posts yet.";
          }
        })
        .catch(function () {
          var status = document.getElementById("live-post-status");
          if (status) status.textContent = "Could not load this post.";
        });
      return;
    }

    if (document.querySelector(".blog_collection-list")) {
      loadPosts().then(renderList);
    }
  });
})();
