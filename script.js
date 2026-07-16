const copyButton = document.querySelector("#copy-checksum");
const checksum = document.querySelector("#checksum");
const copyStatus = document.querySelector("#copy-status");

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
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

copyButton?.addEventListener("click", async () => {
  const value = checksum instanceof HTMLInputElement || checksum instanceof HTMLTextAreaElement
    ? checksum.value.trim()
    : checksum?.textContent?.trim();
  if (!value || !copyStatus) return;

  if (await copyText(value)) {
    copyButton.textContent = "Copied";
    copyStatus.textContent = "Checksum copied to clipboard.";
  } else {
    checksum?.select?.();
    copyStatus.textContent = "Checksum selected. Press Ctrl+C to copy.";
  }

  window.setTimeout(() => {
    copyButton.textContent = "Copy";
    copyStatus.textContent = "";
  }, 2400);
});
