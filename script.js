const copyButton = document.querySelector("#copy-checksum");
const checksum = document.querySelector("#checksum");
const copyStatus = document.querySelector("#copy-status");

copyButton?.addEventListener("click", async () => {
  const value = checksum?.textContent?.trim();
  if (!value || !copyStatus) return;
  try {
    await navigator.clipboard.writeText(value);
    copyStatus.textContent = "Checksum copied.";
  } catch {
    copyStatus.textContent = "Copy failed. Select the checksum manually.";
  }
  window.setTimeout(() => { copyStatus.textContent = ""; }, 2400);
});
