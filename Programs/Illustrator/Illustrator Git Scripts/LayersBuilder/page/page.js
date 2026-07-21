(function () {
  "use strict";

  var pageApi = window.flowcellPage;
  var descriptor = pageApi && pageApi.descriptor && typeof pageApi.descriptor === "object"
    ? pageApi.descriptor
    : {};
  var config = descriptor.config && typeof descriptor.config === "object"
    ? descriptor.config
    : {};
  var configuredStrings = config.strings && typeof config.strings === "object"
    ? config.strings
    : {};

  function copy(key, fallback) {
    var value = configuredStrings[key];
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  var resourceLabel = typeof config.resourceLabel === "string" && config.resourceLabel.trim()
    ? config.resourceLabel.trim()
    : "Layer";
  var emptyMessage = typeof config.emptyMessage === "string" && config.emptyMessage.trim()
    ? config.emptyMessage.trim()
    : "No layers found. Open an Illustrator document and Refresh.";

  var elements = {
    root: document.querySelector(".layer-tree"),
    title: document.getElementById("layer-tree-title"),
    selectionSummary: document.getElementById("selection-summary"),
    rows: document.getElementById("tree-rows"),
    empty: document.getElementById("empty-state"),
    status: document.getElementById("status"),
    renameDialog: document.getElementById("rename-dialog"),
    renameForm: document.getElementById("rename-form"),
    renameTitle: document.getElementById("rename-title"),
    renameInput: document.getElementById("rename-input"),
    renameConfirm: document.getElementById("rename-confirm"),
    forceDialog: document.getElementById("force-delete-dialog"),
    forceTitle: document.getElementById("force-delete-title"),
    forceBody: document.getElementById("force-delete-body"),
    forceConfirm: document.getElementById("force-delete-confirm")
  };

  var state = {
    tree: [],
    activeKey: "",
    highlightedKeys: new Set(),
    expandedKeys: new Set(),
    anchorKey: null,
    busy: false,
    hasSnapshot: false,
    hasSavedExpandedState: false,
    stateWarning: "",
    stateWriteChain: Promise.resolve(),
    refreshTimers: []
  };

  function configureCopy() {
    var pageTitle = typeof descriptor.label === "string" && descriptor.label.trim()
      ? descriptor.label.trim()
      : "Layer Tree";
    document.title = pageTitle;
    elements.title.textContent = pageTitle;
    elements.empty.textContent = emptyMessage;
    elements.status.textContent = copy("ready", "Ready.");

    var labels = {
      "create-root": copy("createRoot", "+ " + resourceLabel),
      "create-child": copy("createChild", "+ Child"),
      rename: copy("rename", "Rename"),
      refresh: copy("refresh", "Refresh"),
      duplicate: copy("duplicate", "Duplicate"),
      delete: copy("delete", "Delete"),
      "force-delete": copy("forceDelete", "Force Delete")
    };
    Object.keys(labels).forEach(function (actionId) {
      var button = document.querySelector('[data-action="' + actionId + '"]');
      if (button) button.textContent = labels[actionId];
    });
    elements.renameTitle.textContent = copy("renameTitle", "Rename " + resourceLabel);
    elements.renameConfirm.textContent = copy("renameConfirm", "Rename");
    elements.forceTitle.textContent = copy("forceDeleteTitle", "Force delete selected layers?");
    elements.forceBody.textContent = copy(
      "forceDeleteBody",
      "This removes selected layers even when they or their ancestors are locked or hidden."
    );
    elements.forceConfirm.textContent = copy("forceDeleteConfirm", "Force Delete");
    document.querySelectorAll("[data-dialog-cancel]").forEach(function (button) {
      button.textContent = copy("cancel", "Cancel");
    });
  }

  function setStatus(message, kind) {
    elements.status.textContent = message || copy("ready", "Ready.");
    if (kind) {
      elements.status.dataset.kind = kind;
    } else {
      delete elements.status.dataset.kind;
    }
  }

  function errorMessage(error) {
    return error && typeof error.message === "string" && error.message.trim()
      ? error.message
      : String(error || "The Layer Tree action failed.");
  }

  function request(actionId, payload) {
    if (!pageApi || typeof pageApi.request !== "function") {
      return Promise.reject(new Error(copy(
        "bridgeUnavailable",
        "The installed page bridge is unavailable. Close and reopen this Button."
      )));
    }
    return pageApi.request(actionId, payload || {});
  }

  function parseResponseValue(value, subject) {
    var current = value;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      if (typeof current === "string") {
        try {
          current = JSON.parse(current);
        } catch (error) {
          throw new Error(subject + " returned unreadable data: " + errorMessage(error));
        }
        continue;
      }
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        break;
      }
      if (current.ok === false) {
        throw new Error(typeof current.error === "string" && current.error.trim()
          ? current.error
          : subject + " failed.");
      }
      if (!("tree" in current) && "result" in current) {
        current = current.result;
        continue;
      }
      break;
    }
    return current;
  }

  function normalizeNode(value, fallbackDepth) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.key !== "string" || typeof value.name !== "string") return null;
    var children = Array.isArray(value.children)
      ? value.children.map(function (child) {
          return normalizeNode(child, fallbackDepth + 1);
        }).filter(function (child) {
          return child !== null;
        })
      : [];
    return {
      key: value.key,
      name: value.name,
      locked: value.locked === true,
      hidden: value.hidden === true,
      depth: typeof value.depth === "number" && Number.isFinite(value.depth)
        ? value.depth
        : fallbackDepth,
      itemCount: typeof value.itemCount === "number" && Number.isFinite(value.itemCount)
        ? value.itemCount
        : 0,
      children: children
    };
  }

  function normalizeSnapshot(raw) {
    var value = parseResponseValue(raw, "Illustrator");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Illustrator returned no Layer Tree snapshot.");
    }
    return {
      active: typeof value.active === "string" ? value.active : "",
      tree: Array.isArray(value.tree)
        ? value.tree.map(function (node) {
            return normalizeNode(node, 0);
          }).filter(function (node) {
            return node !== null;
          })
        : []
    };
  }

  function collectKeys(nodes, allKeys, expandableKeys) {
    nodes.forEach(function (node) {
      allKeys.add(node.key);
      if (node.children.length > 0) expandableKeys.add(node.key);
      collectKeys(node.children, allKeys, expandableKeys);
    });
  }

  function treeFingerprint(nodes) {
    return JSON.stringify(nodes.map(function (node) {
      return [node.key, node.name, treeFingerprint(node.children)];
    }));
  }

  function stateDocument() {
    return {
      highlightedKeys: Array.from(state.highlightedKeys),
      expandedKeys: Array.from(state.expandedKeys)
    };
  }

  function persistOwnerState() {
    var snapshot = stateDocument();
    state.stateWriteChain = state.stateWriteChain
      .catch(function () {})
      .then(function () {
        return request("write-owner-state", { state: snapshot });
      })
      .catch(function (error) {
        setStatus(
          copy("selectionSaveFailed", "Layer selection could not be saved.") + " " + errorMessage(error),
          "error"
        );
        throw error;
      });
    return state.stateWriteChain;
  }

  function visibleRows() {
    var rows = [];
    function append(nodes) {
      nodes.forEach(function (node) {
        rows.push(node);
        if (node.children.length > 0 && state.expandedKeys.has(node.key)) {
          append(node.children);
        }
      });
    }
    append(state.tree);
    return rows;
  }

  function findNode(key, nodes) {
    var source = nodes || state.tree;
    for (var index = 0; index < source.length; index += 1) {
      if (source[index].key === key) return source[index];
      var nested = findNode(key, source[index].children);
      if (nested) return nested;
    }
    return null;
  }

  function selectionLabel() {
    var count = state.highlightedKeys.size;
    return count + " selected";
  }

  function setBusy(next) {
    state.busy = next;
    elements.root.setAttribute("aria-busy", next ? "true" : "false");
    document.querySelectorAll("button").forEach(function (button) {
      if (!button.hasAttribute("data-dialog-cancel")) {
        button.disabled = next;
      }
    });
  }

  function makeRowButton(className, label, text, handler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "layer-tree__row-button " + className;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = text;
    button.disabled = state.busy;
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function render() {
    var rows = visibleRows();
    elements.rows.replaceChildren();
    elements.selectionSummary.textContent = selectionLabel();
    elements.empty.hidden = rows.length !== 0;
    elements.rows.hidden = rows.length === 0;

    rows.forEach(function (node) {
      var hasChildren = node.children.length > 0;
      var expanded = hasChildren && state.expandedKeys.has(node.key);
      var row = document.createElement("div");
      row.className = [
        "layer-tree__row",
        state.highlightedKeys.has(node.key) ? "is-highlighted" : "",
        state.activeKey === node.key ? "is-active" : "",
        node.locked ? "is-locked" : "",
        node.hidden ? "is-hidden" : ""
      ].filter(Boolean).join(" ");
      row.dataset.key = node.key;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(node.depth + 1));
      row.setAttribute("aria-selected", state.highlightedKeys.has(node.key) ? "true" : "false");
      if (hasChildren) row.setAttribute("aria-expanded", expanded ? "true" : "false");
      row.style.paddingLeft = String(4 + node.depth * 16) + "px";

      row.appendChild(makeRowButton(
        "layer-tree__twisty",
        hasChildren ? (expanded ? "Collapse " : "Expand ") + node.name : "No child layers",
        hasChildren ? (expanded ? "\u25BE" : "\u25B8") : "",
        function () {
          if (!hasChildren) return;
          if (expanded) state.expandedKeys.delete(node.key);
          else state.expandedKeys.add(node.key);
          render();
          void persistOwnerState().catch(function () {});
        }
      ));
      row.appendChild(makeRowButton(
        "layer-tree__visibility",
        node.hidden ? "Show " + node.name : "Hide " + node.name,
        node.hidden ? "\u25CB" : "\u25C9",
        function () {
          void runAction(
            "set-visible",
            { keys: [node.key], visible: node.hidden },
            { successMessage: node.hidden ? "Layer shown." : "Layer hidden." }
          );
        }
      ));
      row.appendChild(makeRowButton(
        "layer-tree__lock",
        node.locked ? "Unlock " + node.name : "Lock " + node.name,
        node.locked ? "\u{1F512}" : "\u{1F513}",
        function () {
          void runAction(
            "set-lock",
            { keys: [node.key], locked: !node.locked },
            { successMessage: node.locked ? "Layer unlocked." : "Layer locked." }
          );
        }
      ));

      var name = document.createElement("span");
      name.className = "layer-tree__name";
      name.textContent = node.name;
      row.appendChild(name);

      var count = document.createElement("span");
      count.className = "layer-tree__count";
      count.textContent = node.itemCount > 0 ? String(node.itemCount) : "";
      count.setAttribute("aria-label", String(node.itemCount) + " items");
      row.appendChild(count);

      row.appendChild(makeRowButton(
        "layer-tree__target",
        "Select the contents of " + node.name,
        "",
        function () {
          void runAction(
            "select-contents",
            { key: node.key },
            { successMessage: "Layer contents selected." }
          );
        }
      ));

      row.addEventListener("click", function (event) {
        selectRow(node.key, event);
      });
      elements.rows.appendChild(row);
    });
  }

  function selectRow(key, event) {
    var keys = visibleRows().map(function (node) { return node.key; });
    var next = new Set(state.highlightedKeys);
    if (event.shiftKey && state.anchorKey && keys.indexOf(state.anchorKey) >= 0) {
      var anchorIndex = keys.indexOf(state.anchorKey);
      var keyIndex = keys.indexOf(key);
      var start = Math.min(anchorIndex, keyIndex);
      var end = Math.max(anchorIndex, keyIndex);
      next = new Set(keys.slice(start, end + 1));
    } else if (event.ctrlKey || event.metaKey) {
      if (next.has(key)) next.delete(key);
      else next.add(key);
      state.anchorKey = key;
    } else {
      next = new Set([key]);
      state.anchorKey = key;
    }
    state.highlightedKeys = next;
    render();
    void persistOwnerState().catch(function () {});
  }

  function applySnapshot(snapshot, selectionPolicy) {
    var structureChanged = state.hasSnapshot &&
      treeFingerprint(state.tree) !== treeFingerprint(snapshot.tree);
    var allKeys = new Set();
    var expandableKeys = new Set();
    collectKeys(snapshot.tree, allKeys, expandableKeys);

    state.tree = snapshot.tree;
    state.activeKey = snapshot.active;
    state.hasSnapshot = true;

    if (selectionPolicy === "clear" ||
      (selectionPolicy === "clear-if-structure-changed" && structureChanged)) {
      state.highlightedKeys = new Set();
      state.anchorKey = null;
    } else {
      state.highlightedKeys = new Set(Array.from(state.highlightedKeys).filter(function (key) {
        return allKeys.has(key);
      }));
      if (state.anchorKey && !allKeys.has(state.anchorKey)) state.anchorKey = null;
    }

    if (!state.hasSavedExpandedState) {
      state.expandedKeys = expandableKeys;
      state.hasSavedExpandedState = true;
    } else {
      state.expandedKeys = new Set(Array.from(state.expandedKeys).filter(function (key) {
        return expandableKeys.has(key);
      }));
    }
    render();
  }

  async function runAction(actionId, payload, options) {
    var settings = options || {};
    setBusy(true);
    setStatus(settings.busyMessage || "Working...", "busy");
    try {
      var raw = await request(actionId, payload);
      var snapshot = normalizeSnapshot(raw);
      applySnapshot(snapshot, settings.selectionPolicy || "preserve");
      if (settings.persistState !== false) {
        await persistOwnerState();
      }
      setStatus(settings.successMessage || copy("ready", "Ready."));
      return snapshot;
    } catch (error) {
      setStatus(errorMessage(error), "error");
      throw error;
    } finally {
      setBusy(false);
      render();
    }
  }

  function highlightedKeys() {
    return Array.from(state.highlightedKeys);
  }

  function requireOneSelection(messageKey, fallback) {
    var keys = highlightedKeys();
    if (keys.length !== 1) {
      setStatus(copy(messageKey, fallback), "error");
      return null;
    }
    return keys[0];
  }

  function requireSelection(messageKey, fallback) {
    var keys = highlightedKeys();
    if (keys.length === 0) {
      setStatus(copy(messageKey, fallback), "error");
      return null;
    }
    return keys;
  }

  function closeDialogs() {
    elements.renameDialog.hidden = true;
    elements.forceDialog.hidden = true;
  }

  function openRenameDialog() {
    var key = requireOneSelection(
      "selectOneForRename",
      "Highlight exactly one " + resourceLabel.toLowerCase() + " to rename it."
    );
    if (!key) return;
    var node = findNode(key);
    if (!node) return;
    elements.renameInput.value = node.name;
    elements.renameDialog.hidden = false;
    elements.renameInput.focus();
    elements.renameInput.select();
  }

  function openForceDeleteDialog() {
    var keys = requireSelection(
      "selectForDelete",
      "Highlight one or more " + resourceLabel.toLowerCase() + " items to delete."
    );
    if (!keys) return;
    elements.forceDialog.hidden = false;
    elements.forceConfirm.focus();
  }

  async function refresh(selectionPolicy, successMessage) {
    return runAction("scan", {}, {
      selectionPolicy: selectionPolicy || "clear-if-structure-changed",
      busyMessage: copy("scanning", "Scanning Layer Tree..."),
      successMessage: successMessage || copy("refreshed", "Layer Tree refreshed.")
    });
  }

  async function restoreOwnerState() {
    try {
      var response = await request("read-owner-state", {});
      var documentValue = response && typeof response === "object" && !Array.isArray(response) &&
        response.state && typeof response.state === "object" && !Array.isArray(response.state)
        ? response.state
        : response;
      if (!documentValue || typeof documentValue !== "object" || Array.isArray(documentValue)) return;
      if (Array.isArray(documentValue.highlightedKeys)) {
        state.highlightedKeys = new Set(documentValue.highlightedKeys.filter(function (key) {
          return typeof key === "string";
        }));
      }
      if (Array.isArray(documentValue.expandedKeys)) {
        state.expandedKeys = new Set(documentValue.expandedKeys.filter(function (key) {
          return typeof key === "string";
        }));
        state.hasSavedExpandedState = true;
      }
    } catch (error) {
      state.stateWarning = copy(
        "stateReadFailed",
        "Saved Layer Tree state could not be restored."
      ) + " " + errorMessage(error);
    }
  }

  function clearRefreshTimers() {
    state.refreshTimers.forEach(function (timer) {
      window.clearTimeout(timer);
    });
    state.refreshTimers = [];
  }

  function registerRefreshEvent() {
    var refreshEvent = typeof config.refreshEvent === "string" && config.refreshEvent.trim()
      ? config.refreshEvent.trim()
      : Array.isArray(descriptor.refreshEvents) && typeof descriptor.refreshEvents[0] === "string"
        ? descriptor.refreshEvents[0]
        : "";
    if (!refreshEvent) return;
    window.addEventListener("flowcell:page-refresh", function (event) {
      var detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
      if (detail.eventId !== refreshEvent) return;
      var payload = detail.payload && typeof detail.payload === "object" ? detail.payload : {};
      var eventProgram = typeof payload.programName === "string" ? payload.programName.trim() : "";
      var configuredProgram = typeof config.programName === "string" ? config.programName.trim() : "";
      if (eventProgram && configuredProgram && eventProgram.toLowerCase() !== configuredProgram.toLowerCase()) {
        return;
      }
      state.highlightedKeys = new Set();
      state.anchorKey = null;
      render();
      void persistOwnerState().catch(function () {});
      clearRefreshTimers();
      var delays = Array.isArray(config.refreshDelaysMs)
        ? config.refreshDelaysMs.filter(function (value) {
            return typeof value === "number" && Number.isFinite(value) && value >= 0;
          })
        : [350, 1100];
      delays.forEach(function (delay) {
        state.refreshTimers.push(window.setTimeout(function () {
          void refresh("clear-if-structure-changed").catch(function () {});
        }, delay));
      });
    });
  }

  function bindToolbar() {
    document.querySelector('[data-action="create-root"]').addEventListener("click", function () {
      void runAction("create", { name: resourceLabel }, {
        selectionPolicy: "clear",
        successMessage: resourceLabel + " created."
      }).catch(function () {});
    });
    document.querySelector('[data-action="create-child"]').addEventListener("click", function () {
      var parentKey = requireOneSelection(
        "selectOneForChild",
        "Highlight exactly one " + resourceLabel.toLowerCase() + " to add a child under it."
      );
      if (!parentKey) return;
      void runAction("create", { parentKey: parentKey, name: resourceLabel }, {
        selectionPolicy: "clear",
        successMessage: "Child " + resourceLabel.toLowerCase() + " created."
      }).catch(function () {});
    });
    document.querySelector('[data-action="rename"]').addEventListener("click", openRenameDialog);
    document.querySelector('[data-action="refresh"]').addEventListener("click", function () {
      void refresh("clear-if-structure-changed").catch(function () {});
    });
    document.querySelector('[data-action="duplicate"]').addEventListener("click", function () {
      var keys = requireSelection(
        "selectForDuplicate",
        "Highlight one or more " + resourceLabel.toLowerCase() + " items to duplicate."
      );
      if (!keys) return;
      void runAction("duplicate", { keys: keys }, {
        selectionPolicy: "clear",
        successMessage: keys.length === 1 ? "Layer duplicated." : "Layers duplicated."
      }).catch(function () {});
    });
    document.querySelector('[data-action="delete"]').addEventListener("click", function () {
      var keys = requireSelection(
        "selectForDelete",
        "Highlight one or more " + resourceLabel.toLowerCase() + " items to delete."
      );
      if (!keys) return;
      void runAction("delete", { keys: keys, force: false }, {
        selectionPolicy: "clear",
        successMessage: keys.length === 1 ? "Layer deleted." : "Layers deleted."
      }).catch(function () {});
    });
    document.querySelector('[data-action="force-delete"]').addEventListener("click", openForceDeleteDialog);
  }

  function bindDialogs() {
    document.querySelectorAll("[data-dialog-cancel]").forEach(function (button) {
      button.addEventListener("click", closeDialogs);
    });
    elements.renameForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var key = requireOneSelection(
        "selectOneForRename",
        "Highlight exactly one " + resourceLabel.toLowerCase() + " to rename it."
      );
      var name = elements.renameInput.value.trim();
      if (!key || !name) return;
      closeDialogs();
      void runAction("rename", { key: key, name: name }, {
        successMessage: "Layer renamed."
      }).catch(function () {});
    });
    elements.forceConfirm.addEventListener("click", function () {
      var keys = requireSelection(
        "selectForDelete",
        "Highlight one or more " + resourceLabel.toLowerCase() + " items to delete."
      );
      if (!keys) return;
      closeDialogs();
      void runAction("delete", { keys: keys, force: true }, {
        selectionPolicy: "clear",
        successMessage: keys.length === 1 ? "Layer force deleted." : "Layers force deleted."
      }).catch(function () {});
    });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && (!elements.renameDialog.hidden || !elements.forceDialog.hidden)) {
        event.preventDefault();
        closeDialogs();
      }
    });
  }

  async function start() {
    configureCopy();
    bindToolbar();
    bindDialogs();
    registerRefreshEvent();
    if (!pageApi || typeof pageApi.request !== "function") {
      setStatus(copy(
        "bridgeUnavailable",
        "The installed page bridge is unavailable. Close and reopen this Button."
      ), "error");
      setBusy(true);
      return;
    }
    await restoreOwnerState();
    try {
      await refresh("preserve", copy("ready", "Ready."));
      if (state.stateWarning) setStatus(state.stateWarning, "error");
    } catch (_) {
      // runAction already reports the contained failure.
    }
  }

  void start();
}());
