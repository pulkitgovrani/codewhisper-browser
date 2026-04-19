document.getElementById("open-panel")?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" }, async () => {
    if (chrome.runtime.lastError) {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "PageWhisper",
        message:
          "Cannot open on this page. Try a normal https site, or reload the tab.",
      });
    }
    window.close();
  });
});

document.getElementById("open-options")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});
