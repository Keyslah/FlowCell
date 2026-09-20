"""Document-local layer operations. No filesystem or current-document guessing."""
import json
import re
import uuid

ROOTS = ("Live", "Snapshots", "Trash", "Archive")
ANNOTATION = "flowcell.layers.v1"


def key(node):
    return node.uniqueId().toString()


def internal(node):
    # libkis returns an empty type for fake processing nodes, including
    # KisDecorationsWrapperLayer. Reference images also belong to the document.
    return node.type() in ("", "referenceimageslayer")


def walk(node):
    for child in node.childNodes():
        yield child
        yield from walk(child)


def family(name):
    name = re.sub(r"\s+\([^()]*\)\s*$", "", name).strip()
    previous = None
    while name != previous:
        previous = name
        name = re.sub(r"\.\d{3,}$", "", name)
        name = re.sub(r"\s+copy(?:\s+.*)?$", "", name, flags=re.I).strip()
    return " ".join(name.split()).casefold()


def unique(parent, name):
    names = {n.name().casefold() for n in parent.childNodes()}
    result, number = name, 1
    while result.casefold() in names:
        result = name + str(number)
        number += 1
    return result


class Layers:
    def __init__(self, document, selected=(), prompt=None, confirm=None):
        self.doc = document
        self.root = document.rootNode()
        self.selected = list(selected)
        self.prompt = prompt
        self.confirm = confirm
        raw = bytes(document.annotation(ANNOTATION))
        self.data = json.loads(raw.decode("utf-8")) if raw else {}
        self.records = self.data.setdefault("nodes", {})
        self.families = self.data.setdefault("families", {})

    def save(self):
        self.doc.setAnnotation(ANNOTATION, "FlowCell Layers version families and baselines",
                               json.dumps(self.data, ensure_ascii=False).encode("utf-8"))
        self.doc.setModified(True)
        self.doc.refreshProjection()

    def find(self, node_id):
        if node_id == key(self.root):
            return self.root
        return next((n for n in walk(self.root) if key(n) == node_id), None)

    def top(self, node):
        while node.parentNode() and key(node.parentNode()) != key(self.root):
            node = node.parentNode()
        return node

    def is_root(self, node):
        return node.name() in ROOTS and node.parentNode() and key(node.parentNode()) == key(self.root)

    def targets(self, roots_allowed=False):
        if not self.selected:
            raise ValueError("Highlight one or more layers in Krita's Layers docker.")
        ids = {key(n) for n in self.selected}
        result = []
        for node in self.selected:
            if internal(node) or any(internal(n) for n in walk(node)):
                raise ValueError("Krita's internal helpers and reference images are not artwork layers.")
            if not self.find(key(node)):
                raise ValueError("A highlighted layer is no longer in this document.")
            if self.is_root(node) and not roots_allowed:
                raise ValueError("Live, Snapshots, Trash and Archive roots are protected.")
            if node.type().endswith("mask"):
                raise ValueError("Highlight the mask's owning layer or group; its masks travel with it.")
            parent = node.parentNode()
            while parent and key(parent) not in ids:
                parent = parent.parentNode()
            if parent is None:
                result.append(node)
        return result

    def group(self, parent, name):
        node = self.doc.createGroupLayer(name)
        if not node or not parent.addChildNode(node, None):
            raise RuntimeError("Krita could not create group " + name)
        return node

    def roots(self):
        result = {}
        for name in ROOTS:
            matches = [n for n in self.root.childNodes() if n.name().casefold() == name.casefold()]
            if len(matches) > 1 or (matches and matches[0].type() != "grouplayer"):
                raise ValueError("The system name '%s' must identify one top-level group." % name)
            if matches:
                result[name] = matches[0]
        for name in ROOTS:
            if name not in result:
                result[name] = self.group(self.root, name)
                # The organizational Live container must not isolate existing blends.
                if name == "Live":
                    result[name].setPassThroughMode(True)
            result[name].setName(name)
        for name in reversed(ROOTS):
            self.move(result[name], self.root)
            result[name].setVisible(name == "Live")
        return result

    def move(self, node, parent, above="top", repair_internal=False):
        if not repair_internal and (internal(node) or any(internal(n) for n in walk(node))):
            raise ValueError("Krita's internal helpers must stay at the document root.")
        old = node.parentNode()
        old_children = old.childNodes() if old else []
        parent_children = parent.childNodes()
        children = [n for n in parent_children if key(n) != key(node)]
        if above == "top":
            index = len(children)
        elif above is None:
            index = 0
        else:
            index = next(i for i, n in enumerate(children) if key(n) == key(above)) + 1
        children.insert(index, node)
        descendants = {key(n) for n in walk(node)}
        locked = parent.locked()
        parent.setLocked(False)
        try:
            # remove() is a recursive DELETE command; never use it for reparenting.
            # setChildNodes detaches/re-attaches the existing node objects intact.
            self.doc.waitForDone()
            if old and key(old) != key(parent):
                old.setChildNodes([n for n in old_children if key(n) != key(node)])
            parent.setChildNodes(children)
            if not node.parentNode() or key(node.parentNode()) != key(parent):
                raise RuntimeError("Krita did not attach '%s' to its destination." % node.name())
            if descendants != {key(n) for n in walk(node)}:
                raise RuntimeError("Krita changed the moved subtree unexpectedly.")
        except Exception:
            parent.setChildNodes(parent_children)
            if old and key(old) != key(parent):
                old.setChildNodes(old_children)
            raise
        finally:
            parent.setLocked(locked)

    def repair_internal_nodes(self):
        """Return helpers misplaced by earlier versions; never delete their data."""
        repaired = 0
        for node in list(walk(self.root)):
            if not internal(node) or key(node.parentNode()) == key(self.root):
                continue
            if self.top(node).name() not in ROOTS:
                continue
            record = self.records.get(key(node), {})
            info = self.families.get(record.get("family"), {})
            known_wrapper = node.type() == "" and (
                node.name() == "decorations-wrapper-layer"
                or info.get("name") == "decorations-wrapper-layer")
            if not known_wrapper and node.type() != "referenceimageslayer":
                continue
            previous_parent = node.parentNode()
            self.move(node, self.root, repair_internal=True)
            if known_wrapper:
                node.setName("decorations-wrapper-layer")
            self.records.pop(key(node), None)
            if record and not any(r.get("family") == record.get("family") for r in self.records.values()):
                self.families.pop(record["family"], None)
            for baseline in ("baseline:visible", "baseline:locked"):
                self.data.get(baseline, {}).pop(key(node), None)
            if self.doc.activeNode() and key(self.doc.activeNode()) == key(node):
                self.doc.setActiveNode(previous_parent)
            repaired += 1
        return repaired

    def register(self, node, family_id=None, version="Live"):
        record = self.records.get(key(node))
        if record:
            return record
        family_id = family_id or str(uuid.uuid4())
        if family_id not in self.families:
            siblings = node.parentNode().childNodes()
            index = next(i for i, n in enumerate(siblings) if key(n) == key(node))
            self.families[family_id] = {
                "name": node.name(), "parent": key(node.parentNode()),
                "below": key(siblings[index - 1]) if index else None,
                "index": index,
            }
        record = {"family": family_id, "version": version}
        self.records[key(node)] = record
        return record

    def bucket(self, root, family_id):
        info = self.families[family_id]
        bucket_key = "bucket:" + root.name()
        saved = self.find(info.get(bucket_key))
        if saved and saved.parentNode() and key(saved.parentNode()) == key(root):
            return saved
        node = self.group(root, unique(root, info["name"]))
        info[bucket_key] = key(node)
        return node

    def next_version(self, family_id, prefix):
        numbers = [int(r["version"][1:]) for r in self.records.values()
                   if r["family"] == family_id and re.fullmatch(prefix + r"\d+", r["version"])]
        return prefix + str(max(numbers, default=0) + 1)

    def store(self, node, roots, destination, copy=False, family_id=None):
        record = self.register(node, family_id)
        family_id = record["family"]
        version = self.next_version(family_id, {"Snapshots": "s", "Trash": "T", "Archive": "A"}[destination])
        target = node.duplicate() if copy else node
        if not target:
            raise RuntimeError("Krita could not duplicate " + node.name())
        bucket = self.bucket(roots[destination], family_id)
        self.move(target, bucket)
        target.setName(version)
        target.setVisible(True)
        self.records[key(target)] = {"family": family_id, "version": version}
        return target

    def make_layers(self):
        # Capture candidates and visibility BEFORE revealing any organizational root.
        existing = {n.name(): n for n in self.root.childNodes() if n.name() in ROOTS}
        outside = [n for n in self.root.childNodes()
                   if n.name() not in ROOTS and not internal(n) and not n.type().endswith("mask")]
        current = existing.get("Live")
        candidates = [n for n in current.childNodes() if not internal(n)] if current else []
        candidates += outside
        visible = {key(n): n.visible() for n in candidates}
        roots = self.roots()
        families = {}
        # Two passes ensure hidden copies can occur before their visible originals.
        for node in candidates:
            if not visible[key(node)]:
                continue
            if node in outside:
                self.move(node, roots["Live"])
            record = self.register(node)
            families.setdefault(family(node.name()), []).append(record["family"])
        counts = {"Live": 0, "Snapshots": 0, "Trash": 0}
        for node in candidates:
            if visible[key(node)]:
                counts["Live"] += 1
                continue
            matches = list(dict.fromkeys(families.get(family(node.name()), [])))
            # Ambiguous names never silently associate with an arbitrary live item.
            destination = "Snapshots" if len(matches) == 1 else "Trash"
            self.store(node, roots, destination, family_id=matches[0] if len(matches) == 1 else None)
            counts[destination] += 1
        self.doc.setActiveNode(roots["Live"])
        return "Organized: %s." % ", ".join("%s %d" % (k, v) for k, v in counts.items())

    def creation_parent(self):
        targets = self.targets(roots_allowed=True)
        if len(targets) != 1:
            raise ValueError("Highlight exactly one group or a layer inside it.")
        node = targets[0]
        parent = node if node.type() == "grouplayer" else node.parentNode()
        if key(parent) == key(self.root):
            raise ValueError("Highlight a group, or run Make Layers first.")
        if self.top(parent).name() in ("Snapshots", "Trash", "Archive"):
            raise ValueError("Create working layers inside Live or another working group.")
        return parent

    def create(self, kind):
        parent = self.creation_parent()
        label = "Group" if kind == "grouplayer" else "Layer"
        name = self.prompt("Make " + label, "Name for the new " + label.lower() + ":", "")
        if name is None:
            return "Cancelled."
        name = name.strip()
        if not name:
            raise ValueError("Enter a name; nothing was created.")
        name = unique(parent, name)
        node = self.group(parent, name) if kind == "grouplayer" else self.doc.createNode(name, "paintlayer")
        if kind != "grouplayer":
            self.move(node, parent)
        node.setVisible(True)
        node.setLocked(False)
        parent.setCollapsed(False)
        self.doc.setActiveNode(node)
        return "Created " + name + " in " + parent.name() + "."

    def live_node(self, family_id):
        return next((n for n in walk(self.root) if self.records.get(key(n), {}).get("family") == family_id
                     and self.top(n).name() == "Live"), None)

    def live_slot(self, family_id, roots):
        info = self.families[family_id]
        parent = self.find(info["parent"])
        if not parent or (not self.is_root(parent) and self.top(parent).name() != "Live"):
            parent = roots["Live"]
        below = self.find(info.get("below"))
        if below and (not below.parentNode() or key(below.parentNode()) != key(parent)):
            below = None
        return parent, below

    def remember_slot(self, node, family_id):
        siblings = node.parentNode().childNodes()
        index = next(i for i, n in enumerate(siblings) if key(n) == key(node))
        self.families[family_id].update(parent=key(node.parentNode()), index=index,
                                       below=key(siblings[index - 1]) if index else None,
                                       name=node.name())

    def restore(self, sources, roots, consume=False):
        for source in sources:
            record = self.records.get(key(source))
            if not record or self.top(source).name() not in ("Snapshots", "Trash", "Archive"):
                raise ValueError("Highlight a saved version (sN, TN or AN), not its folder.")
        for source in sources:
            record = self.records[key(source)]
            family_id = record["family"]
            current = self.live_node(family_id)
            if current:
                self.remember_slot(current, family_id)
            parent, below = self.live_slot(family_id, roots)
            incoming = source if consume else source.duplicate()
            if not incoming:
                raise RuntimeError("Could not duplicate the saved version.")
            if current:
                self.store(current, roots, "Trash")
            self.move(incoming, parent, below)
            incoming.setName(self.families[family_id]["name"])
            incoming.setVisible(True)
            self.records[key(incoming)] = {"family": family_id, "version": "Live"}
            self.doc.setActiveNode(incoming)
        return "Restored %d version(s) to Live." % len(sources)

    def cycle(self, targets, roots, step):
        if len(targets) != 1:
            raise ValueError("Highlight exactly one Live item or one saved snapshot.")
        node = targets[0]
        if self.top(node).name() not in ("Live", "Snapshots"):
            raise ValueError("Highlight a Live item or a snapshot version.")
        if self.top(node).name() == "Snapshots" and key(node) not in self.records:
            raise ValueError("Highlight a snapshot version, not its folder.")
        record = self.register(node)
        family_id = record["family"]
        current = self.live_node(family_id)
        if not current:
            raise ValueError("This family has no Live item to cycle.")
        versions = [n for n in walk(self.root)
                    if self.records.get(key(n), {}).get("family") == family_id
                    and self.top(n).name() in ("Live", "Snapshots")]
        def order(n):
            version = self.records[key(n)]["version"]
            return 0 if version == "Live" else int(version[1:])
        versions.sort(key=order)
        if len(versions) < 2:
            return "No snapshots for " + current.name() + "."
        index = next(i for i, n in enumerate(versions) if key(n) == key(current))
        incoming = versions[(index + step) % len(versions)]
        self.remember_slot(current, family_id)
        parent, below = self.live_slot(family_id, roots)
        # Exchange real editable versions at the original compositing position.
        # No version is deleted, flattened or consumed; 'Live' is also a cycle slot.
        bucket = self.bucket(roots["Snapshots"], family_id)
        self.move(current, bucket)
        current.setName(self.records[key(current)]["version"])
        self.move(incoming, parent, below)
        incoming.setName(self.families[family_id]["name"])
        incoming.setVisible(True)
        self.doc.setActiveNode(incoming)
        return incoming.name() + " — " + self.records[key(incoming)]["version"]

    def baseline(self, attribute, restore=False):
        name = "baseline:" + attribute
        if not restore:
            self.data[name] = {key(n): getattr(n, attribute)() for n in walk(self.root) if not internal(n)}
            return "Saved " + attribute + " baseline."
        if name not in self.data:
            raise ValueError("Save the " + attribute + " baseline first.")
        setter = "setVisible" if attribute == "visible" else "setLocked"
        for node in walk(self.root):
            if not internal(node) and key(node) in self.data[name]:
                getattr(node, setter)(self.data[name][key(node)])
        return "Restored " + attribute + " baseline."

    def run(self, action):
        if self.repair_internal_nodes():
            self.save()
        if action == "make_layers":
            message = self.make_layers()
        elif action in ("make_group", "make_layer"):
            message = self.create("grouplayer" if action == "make_group" else "paintlayer")
        elif action in ("baseline_visibility", "restore_visibility", "baseline_locks", "restore_locks"):
            message = self.baseline("visible" if "visibility" in action else "locked", action.startswith("restore"))
        elif action == "empty_trash":
            roots = self.roots()
            if any(internal(n) for n in walk(roots["Trash"])):
                raise ValueError("Trash contains a protected Krita internal helper.")
            if self.confirm("Empty Trash", "Delete all contents of Trash from this document?"):
                for node in list(roots["Trash"].childNodes()):
                    if not node.remove():
                        raise RuntimeError("Krita could not remove " + node.name())
                message = "Trash emptied."
            else:
                message = "Cancelled."
        elif action == "empty_groups":
            count = 0
            for node in reversed(list(walk(self.root))):
                if node.type() == "grouplayer" and not node.childNodes() and not self.is_root(node):
                    if self.top(node).name() in ("Archive", "Trash", "Snapshots"):
                        continue
                    if node.remove():
                        count += 1
            message = "Removed %d empty working groups." % count
        else:
            targets = self.targets(roots_allowed=action in ("expand_groups", "collapse_groups"))
            if action == "delete_highlighted":
                if any(self.top(n).name() in ("Trash", "Archive") for n in targets):
                    raise ValueError("Delete Highlighted protects Trash and Archive; use Empty Trash for Trash.")
                for node in targets:
                    node.setLocked(False)
                    if not node.remove():
                        raise RuntimeError("Krita could not delete " + node.name())
                message = "Deleted %d highlighted layer(s)." % len(targets)
            elif action == "rename_selected":
                changes = []
                for node in targets:
                    name = self.prompt("Rename Selected", "New name for " + node.name() + ":", node.name())
                    if name is None:
                        return "Cancelled."
                    if not name.strip():
                        raise ValueError("Names cannot be empty.")
                    changes.append((node, name.strip()))
                for node, name in changes:
                    node.setName(name)
                    record = self.records.get(key(node))
                    if record and self.top(node).name() == "Live":
                        self.families[record["family"]]["name"] = name
                message = "Renamed %d layer(s)." % len(changes)
            elif action == "duplicate_selected":
                for node in targets:
                    copy = node.duplicate()
                    if not copy:
                        raise RuntimeError("Could not duplicate " + node.name())
                    copy.setName(unique(node.parentNode(), node.name()))
                    self.move(copy, node.parentNode(), node)
                    self.doc.setActiveNode(copy)
                message = "Duplicated %d layer(s)." % len(targets)
            elif action in ("expand_groups", "collapse_groups"):
                for node in targets:
                    for child in [node] + list(walk(node)):
                        if child.type() == "grouplayer":
                            child.setCollapsed(action == "collapse_groups")
                message = "Groups " + ("collapsed." if action == "collapse_groups" else "expanded.")
            elif action == "cycle_group":
                if len(targets) != 1:
                    raise ValueError("Highlight one child layer or group to cycle its siblings.")
                node = targets[0]
                parent = node.parentNode()
                if key(parent) == key(self.root) or self.top(node).name() in ("Snapshots", "Trash", "Archive"):
                    raise ValueError("Highlight an item inside a working group.")
                items = [n for n in parent.childNodes() if not internal(n) and not n.type().endswith("mask")]
                index = next(i for i, n in enumerate(items) if key(n) == key(node))
                incoming = items[(index + 1) % len(items)]
                for child in items:
                    child.setVisible(key(child) == key(incoming))
                self.doc.setActiveNode(incoming)
                message = incoming.name()
            else:
                roots = self.roots()
                if action in ("snapshot", "trash", "archive", "copy_archive"):
                    destination = {"snapshot": "Snapshots", "trash": "Trash", "archive": "Archive", "copy_archive": "Archive"}[action]
                    for node in targets:
                        if self.top(node).name() != "Live":
                            raise ValueError("Highlight working layers inside Live.")
                    for node in targets:
                        self.register(node)
                        self.remember_slot(node, self.records[key(node)]["family"])
                        self.store(node, roots, destination, copy=action in ("snapshot", "copy_archive"))
                    message = "%s: %d layer(s)." % (destination, len(targets))
                elif action == "restore":
                    message = self.restore(targets, roots)
                elif action == "back":
                    sources = []
                    for node in targets:
                        if self.top(node).name() != "Live":
                            raise ValueError("Highlight working layers inside Live.")
                        record = self.register(node)
                        versions = [n for n in walk(roots["Snapshots"])
                                    if self.records.get(key(n), {}).get("family") == record["family"]
                                    and re.fullmatch(r"s\d+", self.records[key(n)]["version"])]
                        if not versions:
                            raise ValueError("No snapshots for " + node.name())
                        sources.append(max(versions, key=lambda n: int(self.records[key(n)]["version"][1:])))
                    message = self.restore(sources, roots, consume=True)
                elif action in ("previous_snapshot", "next_snapshot"):
                    message = self.cycle(targets, roots, -1 if action == "previous_snapshot" else 1)
                elif action == "add_to_live":
                    for node in targets:
                        if self.top(node).name() not in ("Snapshots", "Trash", "Archive") or key(node) not in self.records:
                            raise ValueError("Highlight saved versions to copy into Live.")
                    for node in targets:
                        info = self.families[self.records[key(node)]["family"]]
                        copy = node.duplicate()
                        copy.setName(unique(roots["Live"], info["name"]))
                        self.move(copy, roots["Live"])
                        copy.setVisible(True)
                        self.register(copy)
                        self.doc.setActiveNode(copy)
                    message = "Copied %d item(s) into Live." % len(targets)
                elif action == "copy_live":
                    if any(self.top(n).name() != "Live" for n in targets):
                        raise ValueError("Highlight working layers inside Live.")
                    name = self.prompt("Copy Live", "Name for the new working group:", "")
                    if name is None:
                        return "Cancelled."
                    if not name.strip():
                        raise ValueError("Enter a group name.")
                    copies = [n.duplicate() for n in targets]
                    if not all(copies):
                        raise RuntimeError("Krita could not copy all selected layers.")
                    group = self.group(roots["Live"], unique(roots["Live"], name.strip()))
                    for node, copy in zip(targets, copies):
                        self.move(copy, group)
                        copy.setVisible(True)
                        node.setVisible(False)
                    self.doc.setActiveNode(group)
                    message = "Created " + group.name()
                else:
                    raise ValueError("Unknown Layers action: " + action)
        self.save()
        return message
