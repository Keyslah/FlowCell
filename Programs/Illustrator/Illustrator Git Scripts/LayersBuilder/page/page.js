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
    renameConfirm: document.getElementById("rename-confirm")
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
    refreshTimers: [],
    dragMode: "",
    draggedKey: "",
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStarted: false,
    dragTargetKey: "",
    dragCopy: false,
    dragSourceRow: null,
    dragSourceElement: null,
    suppressNextClick: false,
    nameDialogAction: "rename",
    nameDialogKey: ""
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
    if (next && state.dragPointerId !== null) {
      var wasDragging = state.dragStarted;
      clearDragState();
      if (wasDragging) armPointerClickSuppression();
    }
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

  function canDropLayer(sourceKey, targetKey) {
    return Boolean(
      sourceKey &&
      targetKey &&
      sourceKey !== targetKey &&
      targetKey.indexOf(sourceKey + ".") !== 0
    );
  }

  function clearDragState() {
    var sourceElement = state.dragSourceElement;
    var pointerId = state.dragPointerId;
    state.dragMode = "";
    state.draggedKey = "";
    state.dragPointerId = null;
    state.dragStartX = 0;
    state.dragStartY = 0;
    state.dragStarted = false;
    state.dragTargetKey = "";
    state.dragCopy = false;
    state.dragSourceRow = null;
    state.dragSourceElement = null;
    if (
      sourceElement &&
      pointerId !== null &&
      typeof sourceElement.hasPointerCapture === "function" &&
      sourceElement.hasPointerCapture(pointerId)
    ) {
      try { sourceElement.releasePointerCapture(pointerId); } catch (error) {}
    }
    document.querySelectorAll(
      ".layer-tree__row.is-dragging, " +
      ".layer-tree__row.is-artwork-dragging, " +
      ".layer-tree__row.is-drop-target, " +
      ".layer-tree__row.is-copy-target"
    )
      .forEach(function (row) {
        row.classList.remove(
          "is-dragging",
          "is-artwork-dragging",
          "is-drop-target",
          "is-copy-target"
        );
      });
  }

  function armPointerClickSuppression() {
    state.suppressNextClick = true;
    window.setTimeout(function () {
      state.suppressNextClick = false;
    }, 0);
  }

  function pointerTargetRow(event) {
    var target = document.elementFromPoint(event.clientX, event.clientY);
    return target && typeof target.closest === "function"
      ? target.closest(".layer-tree__row")
      : null;
  }

  function updatePointerDrag(event) {
    if (state.dragPointerId === null || event.pointerId !== state.dragPointerId) return;
    if (!state.dragStarted) {
      var distance = Math.hypot(
        event.clientX - state.dragStartX,
        event.clientY - state.dragStartY
      );
      if (distance < 4) return;
      state.dragStarted = true;
      if (state.dragSourceRow) {
        state.dragSourceRow.classList.add(
          state.dragMode === "artwork" ? "is-artwork-dragging" : "is-dragging"
        );
      }
    }

    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll(
      ".layer-tree__row.is-drop-target, .layer-tree__row.is-copy-target"
    ).forEach(function (row) {
      row.classList.remove("is-drop-target", "is-copy-target");
    });

    var targetRow = pointerTargetRow(event);
    var targetKey = targetRow && typeof targetRow.dataset.key === "string"
      ? targetRow.dataset.key
      : "";
    var isArtworkDrag = state.dragMode === "artwork";
    var isCopyDrop = isArtworkDrag && event.altKey;
    state.dragTargetKey = "";
    state.dragCopy = isCopyDrop;
    if (!targetKey || (!isArtworkDrag && !canDropLayer(state.draggedKey, targetKey))) return;

    state.dragTargetKey = targetKey;
    targetRow.classList.add("is-drop-target");
    targetRow.classList.toggle("is-copy-target", isCopyDrop);
  }

  function finishPointerDrag(event, cancelled) {
    if (state.dragPointerId === null || event.pointerId !== state.dragPointerId) return;
    if (!cancelled) updatePointerDrag(event);

    var dragMode = state.dragMode;
    var sourceKey = state.draggedKey;
    var targetKey = state.dragTargetKey;
    var copyArtwork = dragMode === "artwork" && state.dragCopy;
    var wasDragging = state.dragStarted;
    var targetNode = targetKey ? findNode(targetKey) : null;
    clearDragState();
    if (wasDragging && !cancelled) {
      armPointerClickSuppression();
    }
    if (cancelled || !wasDragging || !targetKey || !targetNode) return;

    state.expandedKeys.add(targetKey);
    if (dragMode === "artwork") {
      void runAction(
        "place-selected-artwork",
        { targetKey: targetKey, copy: copyArtwork },
        {
          successMessage: copyArtwork
            ? "Selected artwork copied into " + targetNode.name + "."
            : "Selected artwork moved into " + targetNode.name + "."
        }
      ).catch(function () {});
      return;
    }
    if (!canDropLayer(sourceKey, targetKey)) return;
    void runAction("move", { key: sourceKey, targetKey: targetKey }, {
      selectionPolicy: "clear",
      successMessage: "Layer moved into " + targetNode.name + "."
    }).catch(function () {});
  }

  function beginPointerDrag(mode, node, row, sourceElement, event) {
    if (
      state.busy ||
      state.dragPointerId !== null ||
      event.button !== 0 ||
      event.isPrimary === false
    ) return;
    event.stopPropagation();
    state.dragMode = mode;
    state.draggedKey = node.key;
    state.dragPointerId = event.pointerId;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragStarted = false;
    state.dragTargetKey = "";
    state.dragCopy = false;
    state.dragSourceRow = row;
    state.dragSourceElement = sourceElement;
    if (typeof sourceElement.setPointerCapture === "function") {
      try { sourceElement.setPointerCapture(event.pointerId); } catch (error) {}
    }
  }

  function bindPointerDrag(sourceElement, mode, node, row) {
    sourceElement.addEventListener("pointerdown", function (event) {
      beginPointerDrag(mode, node, row, sourceElement, event);
    });
    sourceElement.addEventListener("pointermove", updatePointerDrag);
    sourceElement.addEventListener("pointerup", function (event) {
      finishPointerDrag(event, false);
    });
    sourceElement.addEventListener("pointercancel", function (event) {
      finishPointerDrag(event, true);
    });
    sourceElement.addEventListener("lostpointercapture", function (event) {
      finishPointerDrag(event, true);
    });
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
      row.title = "Drag " + node.name + " onto another layer to move it inside.";

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

      var artworkDragHandle = document.createElement("button");
      artworkDragHandle.type = "button";
      artworkDragHandle.className = "layer-tree__row-button layer-tree__selection-proxy";
      artworkDragHandle.disabled = state.busy;
      artworkDragHandle.setAttribute(
        "aria-label",
        "Select all Illustrator artwork in " + node.name +
          ", or drag the current Illustrator selection" +
          " to another layer; hold Alt while dropping to copy it."
      );
      artworkDragHandle.title =
        "Click to select this layer's artwork. Drag to move the selection; hold Alt to copy.";
      artworkDragHandle.addEventListener("click", function (event) {
        event.stopPropagation();
        if (state.suppressNextClick) {
          state.suppressNextClick = false;
          event.preventDefault();
          return;
        }
        void runAction(
          "select-contents",
          { key: node.key },
          { successMessage: "Layer contents selected." }
        );
      });
      bindPointerDrag(artworkDragHandle, "artwork", node, row);
      row.appendChild(artworkDragHandle);

      row.addEventListener("click", function (event) {
        if (state.suppressNextClick) {
          state.suppressNextClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        selectRow(node.key, event);
      });
      row.addEventListener("pointerdown", function (event) {
        var startedOnButton = event.target && typeof event.target.closest === "function" &&
          event.target.closest("button");
        if (startedOnButton) return;
        beginPointerDrag("layer", node, row, row, event);
      });
      row.addEventListener("pointermove", updatePointerDrag);
      row.addEventListener("pointerup", function (event) {
        finishPointerDrag(event, false);
      });
      row.addEventListener("pointercancel", function (event) {
        finishPointerDrag(event, true);
      });
      row.addEventListener("lostpointercapture", function (event) {
        finishPointerDrag(event, true);
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
    state.nameDialogAction = "rename";
    state.nameDialogKey = "";
  }

  function openRenameDialog() {
    var key = requireOneSelection(
      "selectOneForRename",
      "Highlight exactly one " + resourceLabel.toLowerCase() + " to rename it."
    );
    if (!key) return;
    var node = findNode(key);
    if (!node) return;
    state.nameDialogAction = "rename";
    state.nameDialogKey = key;
    elements.renameTitle.textContent = copy("renameTitle", "Rename " + resourceLabel);
    elements.renameConfirm.textContent = copy("renameConfirm", "Rename");
    elements.renameInput.value = node.name;
    elements.renameDialog.hidden = false;
    elements.renameInput.focus();
    elements.renameInput.select();
  }

  function openCreateChildDialog(parentKey) {
    state.nameDialogAction = "create-child";
    state.nameDialogKey = parentKey;
    elements.renameTitle.textContent = copy("createChildTitle", "Create New Sublayer");
    elements.renameConfirm.textContent = copy("createConfirm", "Create");
    elements.renameInput.value = copy("createChildDefaultName", "Sublayer");
    elements.renameDialog.hidden = false;
    elements.renameInput.focus();
    elements.renameInput.select();
  }

  function openCreateRootDialog() {
    state.nameDialogAction = "create-root";
    state.nameDialogKey = "";
    elements.renameTitle.textContent = copy("createRootTitle", "Create New Layer");
    elements.renameConfirm.textContent = copy("createConfirm", "Create");
    elements.renameInput.value = copy("createRootDefaultName", resourceLabel);
    elements.renameDialog.hidden = false;
    elements.renameInput.focus();
    elements.renameInput.select();
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

  function refreshSourceMatches(payload) {
    var eventProgram = typeof payload.programName === "string" ? payload.programName.trim() : "";
    var configuredProgram = typeof config.programName === "string" ? config.programName.trim() : "";
    if (!eventProgram || !configuredProgram || eventProgram.toLowerCase() !== configuredProgram.toLowerCase()) {
      return false;
    }
    var eventPanel = typeof payload.panelName === "string" ? payload.panelName.trim() : "";
    var configuredPanels = Array.isArray(config.refreshPanelNames)
      ? config.refreshPanelNames.filter(function (value) {
          return typeof value === "string" && value.trim();
        })
      : [];
    if (!eventPanel || configuredPanels.length === 0) return false;
    return configuredPanels.some(function (panelName) {
      return panelName.trim().toLowerCase() === eventPanel.toLowerCase();
    });
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
      if (!refreshSourceMatches(payload)) return;
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
    function deleteSelectedLayers(force) {
      void runAction("delete", { keys: highlightedKeys(), force: force }, {
        selectionPolicy: "clear",
        successMessage: "Layers deleted."
      }).catch(function () {});
    }

    document.querySelector('[data-action="create-root"]').addEventListener("click", function () {
      openCreateRootDialog();
    });
    document.querySelector('[data-action="create-child"]').addEventListener("click", function () {
      var parentKey = requireOneSelection(
        "selectOneForChild",
        "Highlight exactly one " + resourceLabel.toLowerCase() + " to add a child under it."
      );
      if (!parentKey) return;
      openCreateChildDialog(parentKey);
    });
    document.querySelector('[data-action="rename"]').addEventListener("click", openRenameDialog);
    document.querySelector('[data-action="refresh"]').addEventListener("click", function () {
      void refresh("clear-if-structure-changed").catch(function () {});
    });
    document.querySelector('[data-action="duplicate"]').addEventListener("click", function () {
      var keys = highlightedKeys();
      void runAction("duplicate", { keys: keys }, {
        selectionPolicy: "clear",
        successMessage: keys.length <= 1 ? "Layer duplicated." : "Layers duplicated."
      }).catch(function () {});
    });
    document.querySelector('[data-action="delete"]').addEventListener("click", function () {
      deleteSelectedLayers(false);
    });
    document.querySelector('[data-action="force-delete"]').addEventListener("click", function () {
      deleteSelectedLayers(true);
    });
  }

  function bindDialogs() {
    document.querySelectorAll("[data-dialog-cancel]").forEach(function (button) {
      button.addEventListener("click", closeDialogs);
    });
    elements.renameForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = elements.renameInput.value.trim();
      var action = state.nameDialogAction;
      var key = state.nameDialogKey;
      if (!name) return;
      if (action === "create-root") {
        closeDialogs();
        void runAction("create", { name: name }, {
          selectionPolicy: "clear",
          successMessage: resourceLabel + " created."
        }).catch(function () {});
        return;
      }
      if (!key) return;
      closeDialogs();
      if (action === "create-child") {
        state.expandedKeys.add(key);
        void runAction("create", { parentKey: key, name: name }, {
          selectionPolicy: "clear",
          successMessage: "Sublayer created."
        }).catch(function () {});
        return;
      }
      void runAction("rename", { key: key, name: name }, {
        successMessage: "Layer renamed."
      }).catch(function () {});
    });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !elements.renameDialog.hidden) {
        event.preventDefault();
        closeDialogs();
      }
    });
    window.addEventListener("blur", clearDragState);
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
