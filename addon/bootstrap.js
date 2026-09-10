var PaperReaderAPI;
var PaperReaderChromeHandle;
var PaperReaderScope;

// Zotero's bootstrap global does not provide the browser console object that
// Ajv and pdf.js expect. Route it into Zotero's native console service.
var console = {
  log: (...args) => Services.console.logStringMessage(args.map(String).join(" ")),
  info: (...args) => Services.console.logStringMessage(args.map(String).join(" ")),
  warn: (...args) => Services.console.logStringMessage(args.map(String).join(" ")),
  error: (...args) => Services.console.logStringMessage(args.map(String).join(" ")),
};

function install() {}

function trace(message) {
  Services.console.logStringMessage("[Paper Reading Assistant] " + message);
}

async function startup({ id, version, rootURI }, reason) {
  trace("bootstrap startup " + version);
  try {
    var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup,
    );
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    PaperReaderChromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "paper-reader", "content/"],
    ]);
    trace("chrome registered");

    // pdf.js expects a browser global (DOMException, URL, Blob, streams, etc.),
    // while the application also needs Zotero's privileged APIs. The hidden DOM
    // window supplies the browser side; the explicit properties bridge Zotero.
    PaperReaderScope = Services.appShell.hiddenDOMWindow;
    PaperReaderScope.Zotero = Zotero;
    PaperReaderScope.Services = Services;
    PaperReaderScope.PathUtils = PathUtils;
    PaperReaderScope.IOUtils = IOUtils;
    Services.scriptloader.loadSubScript(
      rootURI + "content/main.js?version=" + encodeURIComponent(version),
      PaperReaderScope,
    );
    trace("bundle loaded");
    PaperReaderAPI = PaperReaderScope.PaperReader;
    await PaperReaderAPI.startup({ id, version, rootURI }, reason);
    trace("application started");
  } catch (error) {
    trace("startup failed: " + String(error) + (error && error.stack ? "\n" + error.stack : ""));
    Zotero.logError(error);
    throw error;
  }
}

async function shutdown({ id, version, rootURI }, reason) {
  if (PaperReaderAPI) {
    await PaperReaderAPI.shutdown({ id, version, rootURI }, reason);
  }
  PaperReaderAPI = null;
  if (PaperReaderScope) {
    try { delete PaperReaderScope.PaperReader; } catch (_) {}
    PaperReaderScope = null;
  }
  if (PaperReaderChromeHandle) {
    PaperReaderChromeHandle.destruct();
    PaperReaderChromeHandle = null;
  }
}

async function onMainWindowLoad({ window }) {
  await PaperReaderAPI?.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }) {
  await PaperReaderAPI?.onMainWindowUnload(window);
}

function uninstall() {}
