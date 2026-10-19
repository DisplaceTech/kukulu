(() => {
  const COPY_FEEDBACK_MS = 2400;
  if (typeof navigator.clipboard?.writeText !== "function") return;
  for (const button of document.querySelectorAll("button[data-copy-for]")) {
    const id = button.dataset.copyFor;
    const label = button.querySelector(".copy-label");
    const status = document.getElementById(id + "-status");
    let timer;
    button.hidden = false;
    button.addEventListener("click", () => {
      clearTimeout(timer);
      const text = document.getElementById(id).textContent.replace(/\n$/, "");
      navigator.clipboard.writeText(text).then(
        () => {
          label.textContent = "Copied";
          status.textContent = "Copied to the clipboard.";
        },
        () => {
          status.textContent = "Copy failed. Select the text and copy it manually.";
        }
      ).finally(() => {
        timer = setTimeout(() => {
          label.textContent = "Copy";
          status.textContent = "";
        }, COPY_FEEDBACK_MS);
      });
    });
  }
})();
