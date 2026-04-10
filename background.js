// SmartWeb Form Assistant — Background Service Worker
// Manifest V3 service worker for message routing and lifecycle management.
// Direct popup ↔ content-script communication is used for scan/apply/highlight,
// so this worker is kept intentionally lean.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    console.log("[SmartWeb] Extension installed successfully.");
  } else if (reason === "update") {
    console.log("[SmartWeb] Extension updated.");
  }
});

// Keep-alive ping handler (for long-lived popup connections if needed)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ status: "alive" });
  }
  return true; // keep channel open for async responses
});
