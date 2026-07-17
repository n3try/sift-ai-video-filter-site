const copyButton = document.querySelector("#copy-checksum");
const checksum = document.querySelector("#checksum");
const copyStatus = document.querySelector("#copy-status");

document.querySelectorAll('.skip-link[href^="#"]').forEach((skipLink) => {
  skipLink.addEventListener("click", (event) => {
    const targetId = skipLink.getAttribute("href")?.slice(1);
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;

    event.preventDefault();
    window.requestAnimationFrame(() => {
      target.focus();
      target.scrollIntoView({ block: "start" });
    });
  });
});

document.querySelectorAll('.permissions-table-wrap[tabindex="0"]').forEach((region) => {
  region.addEventListener("keydown", (event) => {
    if (event.target !== region || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (region.scrollWidth <= region.clientWidth) return;
    event.preventDefault();
    region.scrollBy({ left: event.key === "ArrowRight" ? 80 : -80, behavior: "auto" });
  });
});

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue to the selection-based fallback below.
    }
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.className = "clipboard-fallback";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function selectChecksum() {
  if (checksum instanceof HTMLInputElement || checksum instanceof HTMLTextAreaElement) {
    checksum.select();
    return;
  }
  if (!(checksum instanceof HTMLElement)) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(checksum);
  selection.removeAllRanges();
  selection.addRange(range);
}

copyButton?.addEventListener("click", async () => {
  const value = checksum instanceof HTMLInputElement || checksum instanceof HTMLTextAreaElement
    ? checksum.value.trim()
    : checksum?.textContent?.trim();
  if (!value || !copyStatus) return;

  if (await copyText(value)) {
    copyStatus.textContent = "Checksum copied to clipboard.";
  } else {
    selectChecksum();
    copyStatus.textContent = "Checksum selected. Press Ctrl+C to copy.";
  }
});
