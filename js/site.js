/* Argus landing page: mobile nav toggle and copy-to-clipboard. */
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      links.classList.toggle("open", !open);
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("open");
      }
    });
  }

  var live = document.getElementById("copy-live");
  document.querySelectorAll("button.copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pre = document.getElementById(btn.getAttribute("data-copy"));
      if (!pre || !navigator.clipboard) return;
      navigator.clipboard.writeText(pre.textContent).then(function () {
        btn.textContent = "Copied";
        btn.classList.add("done");
        if (live) live.textContent = "Copied to clipboard";
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("done");
          if (live) live.textContent = "";
        }, 1600);
      }, function () {
        if (live) live.textContent = "Copy failed";
      });
    });
  });
})();
