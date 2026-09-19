from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "Windows Git Scripts"
    / "Utility"
    / "Toggle Monitors"
    / "toggle_monitors.py"
)
PACKAGE_ROOT = SCRIPT_PATH.parent
STARTUP_INSTALLER_PATH = PACKAGE_ROOT / "Install Startup Safety.ps1"
LAUNCHER_PATH = PACKAGE_ROOT / "Toggle Monitors.vbs"
PICKER_PATH = PACKAGE_ROOT / "Toggle Monitors Picker.ps1"
SPEC = importlib.util.spec_from_file_location("flowcell_toggle_monitors_tested", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
tm = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = tm
SPEC.loader.exec_module(tm)


def make_path(
    source_id: int,
    target_id: int,
    source_mode_index: int = tm.DISPLAYCONFIG_PATH_MODE_IDX_INVALID,
    *,
    active: bool = True,
    wireless: bool = False,
    target_available: bool = True,
):
    path = tm.DISPLAYCONFIG_PATH_INFO()
    path.sourceInfo.adapterId.HighPart = 1
    path.sourceInfo.adapterId.LowPart = 10
    path.sourceInfo.id = source_id
    path.sourceInfo.modeInfoIdx = source_mode_index
    path.targetInfo.adapterId.HighPart = 1
    path.targetInfo.adapterId.LowPart = 10
    path.targetInfo.id = target_id
    path.targetInfo.modeInfoIdx = tm.DISPLAYCONFIG_PATH_MODE_IDX_INVALID
    path.targetInfo.outputTechnology = tm.DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST if wireless else 5
    path.targetInfo.targetAvailable = target_available
    path.flags = tm.DISPLAYCONFIG_PATH_ACTIVE if active else 0
    return path


def make_source_mode(source_id: int, x: int, y: int, width: int, height: int):
    mode = tm.DISPLAYCONFIG_MODE_INFO()
    mode.infoType = tm.DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
    mode.adapterId.HighPart = 1
    mode.adapterId.LowPart = 10
    mode.id = source_id
    mode.sourceMode.position.x = x
    mode.sourceMode.position.y = y
    mode.sourceMode.width = width
    mode.sourceMode.height = height
    return mode


def make_snapshot(paths, modes):
    path_array = (tm.DISPLAYCONFIG_PATH_INFO * max(len(paths), 1))()
    mode_array = (tm.DISPLAYCONFIG_MODE_INFO * max(len(modes), 1))()
    for index, path in enumerate(paths):
        path_array[index] = path
    for index, mode in enumerate(modes):
        mode_array[index] = mode
    return tm.DisplayConfigSnapshot.from_arrays(path_array, mode_array, len(paths), len(modes)), path_array, mode_array


class ImmediateLock:
    def __init__(self, _name):
        pass

    def acquire(self):
        return True

    def release(self):
        pass


class ToggleMonitorEngineTests(unittest.TestCase):
    def setUp(self):
        self.target_names = {}

        def target_details(path):
            target_id = int(path.targetInfo.id)
            friendly = self.target_names.get(target_id, f"Monitor {target_id}")
            return friendly, f"MONITOR#DEVICE#{target_id}"

        self.details_patch = mock.patch.object(tm, "get_target_identity_details", side_effect=target_details)
        self.source_patch = mock.patch.object(
            tm,
            "get_source_name",
            side_effect=lambda path: rf"\\.\DISPLAY{int(path.sourceInfo.id)}",
        )
        self.details_patch.start()
        self.source_patch.start()

    def tearDown(self):
        self.source_patch.stop()
        self.details_patch.stop()

    def test_named_mutex_closes_a_nonowner_handle_after_collision(self):
        with (
            mock.patch.object(tm.kernel32, "CreateMutexW", return_value=123) as create,
            mock.patch.object(tm.ctypes, "get_last_error", return_value=tm.ERROR_ALREADY_EXISTS),
            mock.patch.object(tm.kernel32, "CloseHandle") as close,
            mock.patch.object(tm.kernel32, "ReleaseMutex") as release,
        ):
            instance = tm.SingleInstance("Local\\test")
            self.assertFalse(instance.acquire())
            instance.release()
        create.assert_called_once_with(None, True, "Local\\test")
        close.assert_called_once_with(123)
        release.assert_not_called()
        self.assertIsNone(instance.handle)

    def descriptor(self, target_id: int, friendly: str | None = None):
        return tm.TargetDescriptor(
            device_path=f"MONITOR#DEVICE#{target_id}",
            adapter_high=1,
            adapter_low=10,
            target_id=target_id,
            friendly=friendly or f"Monitor {target_id}",
            source=rf"\\.\DISPLAY{target_id}",
        )

    def choice(self, target_id: int, *, active: bool = False, main: bool = False):
        descriptor = self.descriptor(target_id)
        status = "main, active" if main else ("active" if active else "inactive")
        return tm.MonitorChoice(
            label=f"{descriptor.friendly} [{status}]",
            token=tm.encode_target_descriptor(descriptor),
            descriptor=descriptor,
            active=active,
            main=main,
        )

    def test_target_tokens_are_stable_base64url_and_round_trip(self):
        descriptor = self.descriptor(7, "Display / Seven")
        first = tm.encode_target_descriptor(descriptor)
        second = tm.encode_target_descriptor(descriptor)
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("tm1."))
        self.assertNotIn("=", first)
        self.assertNotIn("+", first)
        self.assertNotIn("/", first)
        self.assertEqual(tm.decode_target_descriptor(first), descriptor)

    def test_startup_installer_is_current_user_only_and_has_required_triggers(self):
        installer = STARTUP_INSTALLER_PATH.read_text(encoding="utf-8")
        self.assertIn("<LogonType>InteractiveToken</LogonType>", installer)
        self.assertIn("<RunLevel>LeastPrivilege</RunLevel>", installer)
        self.assertIn("<StateChange>SessionLock</StateChange>", installer)
        self.assertIn("<StateChange>SessionUnlock</StateChange>", installer)
        self.assertIn("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", installer)
        self.assertIn("--startup-safety-guardian", installer)
        self.assertNotIn("<BootTrigger>", installer)
        self.assertNotIn("<LogonType>ServiceAccount</LogonType>", installer)
        self.assertNotIn("<RunLevel>HighestAvailable</RunLevel>", installer)
        self.assertNotIn("MessageBox", installer)

    def test_successful_picker_save_refreshes_startup_safety_silently(self):
        launcher = LAUNCHER_PATH.read_text(encoding="utf-8")
        self.assertIn("RefreshStartupSafety pythonwPath", launcher)
        self.assertIn('" -ButtonConfigPath " & q & configPath & q', launcher)
        self.assertIn('" -PythonwPath " & q & pythonwPath & q', launcher)
        picker = PICKER_PATH.read_text(encoding="utf-8")
        self.assertIn("Group 1 is also the normal set restored at sign-in and wake", picker)

    def test_installer_preserves_disabled_recovery_during_button_refresh(self):
        installer = STARTUP_INSTALLER_PATH.read_text(encoding="utf-8")
        self.assertIn("$preserveDisabled = $null -ne $existingTask -and -not $existingTask.Settings.Enabled", installer)
        self.assertIn("$taskDefinition.Settings.Enabled = $false", installer)
        self.assertIn("if ($StartNow -and -not $preserveDisabled)", installer)
        self.assertIn("'InstalledDisabled'", installer)

    def test_toggle_engine_has_no_monitor_warning_message_box_path(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertNotIn("MessageBoxW", source)
        self.assertNotIn("show_monitor_warning", source)

    def test_durable_device_path_mismatch_does_not_fall_through_to_friendly_name(self):
        configured = tm.TargetDescriptor(
            device_path="MONITOR#ONE",
            adapter_high=1,
            adapter_low=10,
            target_id=1,
            friendly="Twin Model",
            source=r"\\.\DISPLAY1",
        )
        other_physical_monitor = tm.TargetDescriptor(
            device_path="MONITOR#TWO",
            adapter_high=1,
            adapter_low=10,
            target_id=2,
            friendly="Twin Model",
            source=r"\\.\DISPLAY1",
        )
        self.assertFalse(tm.descriptor_matches(configured, other_physical_monitor))

    def test_button_config_prefers_targets_and_supports_legacy_display(self):
        one = tm.encode_target_descriptor(self.descriptor(1))
        two = tm.encode_target_descriptor(self.descriptor(2))
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "toggle-monitors.txt"
            config.write_text(f"SCHEMA=2\nTARGETS={one}, {two}\nDISPLAY=ignored\n", encoding="utf-8")
            self.assertEqual(tm.selectors_from_button_config(config), [one, two])
            config.write_text("PYTHONW=x\nDISPLAY=Legacy Monitor\n", encoding="utf-8")
            self.assertEqual(tm.selectors_from_button_config(config), ["Legacy Monitor"])

    def test_snapshot_serializes_only_valid_count_and_rejects_bad_blob_length(self):
        path_array = (tm.DISPLAYCONFIG_PATH_INFO * 3)()
        mode_array = (tm.DISPLAYCONFIG_MODE_INFO * 4)()
        snapshot = tm.DisplayConfigSnapshot.from_arrays(path_array, mode_array, 1, 1)
        self.assertEqual(len(snapshot.path_blob), tm.ctypes.sizeof(tm.DISPLAYCONFIG_PATH_INFO))
        self.assertEqual(len(snapshot.mode_blob), tm.ctypes.sizeof(tm.DISPLAYCONFIG_MODE_INFO))
        payload = json.loads(snapshot.to_json())
        payload["path_count"] = 2
        with self.assertRaises(tm.DisplayConfigError):
            tm.DisplayConfigSnapshot.from_json(json.dumps(payload))

    def test_display_list_keeps_duplicate_models_and_orders_main_active_inactive(self):
        self.target_names = {1: "Twin", 2: "Twin", 3: "Spare", 4: "Phantom"}
        modes = [
            make_source_mode(1, 0, 0, 2560, 1440),
            make_source_mode(2, 2560, 0, 1920, 1080),
        ]
        paths = [
            make_path(1, 1, 0, active=True),
            make_path(1, 2, 1, active=True),
            make_path(3, 3, active=False),
            make_path(4, 4, active=False, target_available=False),
        ]
        snapshot, path_array, mode_array = make_snapshot(paths, modes)
        with mock.patch.object(tm, "query_display_config", return_value=(snapshot, path_array, mode_array)):
            displays = tm.list_available_displays()
        self.assertEqual(len(displays), 3)
        self.assertIn("[main, active]", displays[0][0])
        self.assertIn("[active]", displays[1][0])
        self.assertIn("[inactive]", displays[2][0])
        self.assertNotEqual(displays[0][0], displays[1][0])
        self.assertNotEqual(displays[0][1], displays[1][1])
        for _, token in displays:
            self.assertTrue(token.startswith("tm1."))

    def test_unavailable_phantom_target_cannot_be_resolved(self):
        unavailable = make_path(4, 4, active=False, target_available=False)
        _, path_array, _ = make_snapshot([unavailable], [])
        token = tm.encode_target_descriptor(self.descriptor(4))
        with self.assertRaisesRegex(tm.DisplayConfigError, "not currently available"):
            tm.resolve_target_descriptors([token], path_array, 1)

    def test_active_subset_filter_preserves_wireless_and_rebases_relative_positions(self):
        paths = [
            make_path(1, 1, 0),
            make_path(2, 2, 1),
            make_path(3, 3, 2),
            make_path(9, 9, 3, wireless=True),
        ]
        modes = [
            make_source_mode(1, 0, 0, 2560, 1440),
            make_source_mode(2, 2560, -100, 1920, 1080),
            make_source_mode(3, 4480, -100, 3840, 2160),
            make_source_mode(9, 8320, 0, 1920, 1080),
        ]
        snapshot, _, _ = make_snapshot(paths, modes)
        selected = [self.descriptor(2).identity_key(), self.descriptor(3).identity_key()]
        reduced = tm.build_selected_snapshot(snapshot, selected, preserve_wireless=True)
        reduced_paths = reduced.path_array()
        reduced_modes = reduced.mode_array()
        physical, wireless = tm.target_key_sets(reduced_paths, reduced.path_count)
        self.assertEqual(physical, set(selected))
        self.assertEqual(len(wireless), 1)
        positions = {}
        sizes = {}
        for path in reduced_paths[: reduced.path_count]:
            if path.targetInfo.outputTechnology == tm.DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
                continue
            mode = tm.source_mode_for_path(path, reduced_modes)
            positions[int(path.targetInfo.id)] = (int(mode.sourceMode.position.x), int(mode.sourceMode.position.y))
            sizes[int(path.targetInfo.id)] = (int(mode.sourceMode.width), int(mode.sourceMode.height))
        self.assertEqual(positions[2], (0, 0))
        self.assertEqual(positions[3], (1920, 0))
        self.assertEqual(sizes[2], (1920, 1080))
        self.assertEqual(sizes[3], (3840, 2160))

    def test_inactive_path_matching_chooses_distinct_sources(self):
        descriptors = [self.descriptor(1), self.descriptor(2)]
        paths = [
            make_path(1, 1, active=False),
            make_path(1, 2, active=False),
            make_path(2, 2, active=False),
        ]
        _, path_array, _ = make_snapshot(paths, [])
        chosen = tm.choose_distinct_target_paths(descriptors, path_array, len(paths))
        self.assertEqual(len(chosen), 2)
        self.assertEqual(len({tm.source_identity_key(path) for path in chosen}), 2)

    def test_inactive_topology_validation_failure_never_calls_apply(self):
        path = make_path(1, 1, active=False)
        set_display = mock.Mock(return_value=87)
        with mock.patch.object(tm, "user32", SimpleNamespace(SetDisplayConfig=set_display)):
            with self.assertRaisesRegex(tm.DisplayConfigError, "validate temporary topology"):
                tm.validate_and_apply_topology([path])
        self.assertEqual(set_display.call_count, 1)
        flags = set_display.call_args.args[-1]
        self.assertTrue(flags & tm.SDC_VALIDATE)
        self.assertFalse(flags & tm.SDC_APPLY)

    def test_inactive_topology_uses_only_temporary_best_mode_flags(self):
        path = make_path(1, 1, 3, active=False)
        set_display = mock.Mock(return_value=0)
        with mock.patch.object(tm, "user32", SimpleNamespace(SetDisplayConfig=set_display)):
            tm.validate_and_apply_topology([path])
        self.assertEqual(set_display.call_count, 2)
        for call, operation in zip(set_display.call_args_list, [tm.SDC_VALIDATE, tm.SDC_APPLY]):
            count, paths, mode_count, modes, flags = call.args
            self.assertEqual(flags, tm.awareness_set_flags(
                operation | tm.SDC_USE_SUPPLIED_DISPLAY_CONFIG | tm.SDC_ALLOW_CHANGES
            ))
            self.assertFalse(flags & (tm.SDC_TOPOLOGY_SUPPLIED | tm.SDC_SAVE_TO_DATABASE))
            self.assertEqual((count, mode_count, modes), (1, 0, None))
            self.assertTrue(paths[0].flags & tm.DISPLAYCONFIG_PATH_ACTIVE)
            self.assertEqual(paths[0].sourceInfo.modeInfoIdx, tm.DISPLAYCONFIG_PATH_MODE_IDX_INVALID)
            self.assertEqual(paths[0].targetInfo.modeInfoIdx, tm.DISPLAYCONFIG_PATH_MODE_IDX_INVALID)
        self.assertFalse(path.flags & tm.DISPLAYCONFIG_PATH_ACTIVE)
        self.assertEqual(path.sourceInfo.modeInfoIdx, 3)

    def test_inactive_topology_apply_failure_is_reported_without_persistent_retry(self):
        set_display = mock.Mock(side_effect=[0, 31])
        with mock.patch.object(tm, "user32", SimpleNamespace(SetDisplayConfig=set_display)):
            with self.assertRaisesRegex(tm.DisplayConfigError, "apply temporary topology"):
                tm.validate_and_apply_topology([make_path(1, 1, active=False)])
        self.assertEqual(set_display.call_count, 2)

    def test_virtual_topology_invalidation_clears_clone_group(self):
        path = make_path(1, 1, active=False)
        path.flags |= tm.DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE
        path.sourceInfo.cloneGroupId = 12
        path.sourceInfo.sourceModeInfoIdx = 3
        invalidated = tm.invalidate_topology_indexes(path)
        self.assertEqual(invalidated.sourceInfo.cloneGroupId, tm.DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID)
        self.assertEqual(invalidated.sourceInfo.sourceModeInfoIdx, 0xFFFF)

    def test_virtual_invalid_mode_indexes_are_never_dereferenced_or_remapped(self):
        path = make_path(1, 1, active=True)
        path.flags |= tm.DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE
        path.sourceInfo.cloneGroupId = tm.DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID
        path.sourceInfo.sourceModeInfoIdx = tm.DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID
        path.targetInfo.desktopModeInfoIdx = tm.DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID
        path.targetInfo.targetModeInfoIdx = tm.DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID
        _, path_array, mode_array = make_snapshot([path], [])
        self.assertIsNone(tm.source_mode_for_path(path_array[0], mode_array))
        self.assertIsNone(tm.target_mode_for_path(path_array[0], mode_array))
        self.assertIsNone(tm.desktop_mode_for_path(path_array[0], mode_array))
        filtered = tm.build_filtered_snapshot(path_array, mode_array, 1, lambda _path: True)
        self.assertEqual(filtered.mode_count, 0)
        kept = filtered.path_array()[0]
        self.assertEqual(kept.sourceInfo.sourceModeInfoIdx, tm.DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID)
        self.assertEqual(kept.targetInfo.desktopModeInfoIdx, tm.DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID)
        self.assertEqual(kept.targetInfo.targetModeInfoIdx, tm.DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID)

    def test_per_button_state_paths_and_owner_ids_are_isolated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = tm.button_state_paths(root / "button-a")
            second = tm.button_state_paths(root / "button-b")
            self.assertNotEqual(first["full"], second["full"])
            self.assertNotEqual(tm.owner_id_for_path(root / "button-a"), tm.owner_id_for_path(root / "button-b"))

    def test_schema_3_group_config_round_trip_allows_overlap(self):
        one = tm.encode_target_descriptor(self.descriptor(1))
        two = tm.encode_target_descriptor(self.descriptor(2))
        three = tm.encode_target_descriptor(self.descriptor(3))
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "toggle-monitors.txt"
            tm.write_button_group_config(config, r"C:\Python\pythonw.exe", [one, two, one], [two, three])
            group_1, group_2 = tm.selector_groups_from_button_config(config)
            values = tm.read_button_config(config)
        self.assertEqual(values["SCHEMA"], "3")
        self.assertEqual(values["PYTHONW"], r"C:\Python\pythonw.exe")
        self.assertEqual(group_1, [one, two])
        self.assertEqual(group_2, [two, three])
        self.assertIn(two, group_1)
        self.assertIn(two, group_2)

    def test_group_config_rejects_empty_or_equal_groups(self):
        one = tm.encode_target_descriptor(self.descriptor(1))
        two = tm.encode_target_descriptor(self.descriptor(2))
        with self.assertRaisesRegex(tm.DisplayConfigError, "both Group 1 and Group 2"):
            tm.validate_selector_groups([], [one])
        with self.assertRaisesRegex(tm.DisplayConfigError, "both Group 1 and Group 2"):
            tm.validate_selector_groups([one], [])
        with self.assertRaisesRegex(tm.DisplayConfigError, "must be different"):
            tm.validate_selector_groups([one, two], [two, one])

    def test_picker_defaults_migrate_schema_2_full_targets_and_reduced_without_display_calls(self):
        choices = [
            self.choice(1, active=True, main=True),
            self.choice(2, active=True),
            self.choice(3),
        ]
        keys = [choice.descriptor.identity_key() for choice in choices]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "toggle-monitors.txt"
            metadata_path = tm.button_state_paths(root)["metadata"]
            tm.write_json_object(
                metadata_path,
                {
                    "schema": 2,
                    "full_physical_keys": keys[:2],
                    "reduced_physical_keys": [keys[2]],
                    "selected_keys": [keys[2]],
                },
            )
            config.write_text(f"SCHEMA=2\nPYTHONW=x\nTARGETS={choices[1].token}\n", encoding="utf-8")
            with (
                mock.patch.object(tm, "query_display_config") as query,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
            ):
                targets_model = tm.build_picker_model(config, choices, mock.Mock())
                config.write_text("SCHEMA=2\nPYTHONW=x\n", encoding="utf-8")
                reduced_model = tm.build_picker_model(config, choices, mock.Mock())
            query.assert_not_called()
            apply_exact.assert_not_called()
            apply_topology.assert_not_called()

        self.assertEqual(
            [item["group1"] for item in targets_model["monitors"]],
            [True, True, False],
        )
        self.assertEqual(
            [item["group2"] for item in targets_model["monitors"]],
            [False, True, False],
        )
        self.assertEqual(
            [item["group2"] for item in reduced_model["monitors"]],
            [False, False, True],
        )
        self.assertEqual(
            [item["group1"] for item in reduced_model["monitors"]],
            [True, True, False],
        )

    def test_schema_3_picker_preserves_checked_disconnected_token_for_save_validation(self):
        one = self.choice(1, active=True, main=True)
        two = self.choice(2)
        three = self.choice(3)
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "toggle-monitors.txt"
            tm.write_button_group_config(config, "pythonw.exe", [one.token, two.token], [three.token])
            augmented = tm.picker_choices_with_saved_unavailable(config, [one, three])
            model = tm.build_picker_model(config, augmented, mock.Mock())

        preserved = next(choice for choice in augmented if choice.token == two.token)
        self.assertIn("not connected", preserved.label)
        self.assertFalse(preserved.active)
        self.assertFalse(preserved.main)
        row = next(item for item in model["monitors"] if item["token"] == two.token)
        self.assertTrue(row["group1"])
        self.assertFalse(row["group2"])

        allowed_tokens = {choice.token for choice in augmented}
        group_1, group_2 = tm.validate_selector_groups(
            [one.token, two.token],
            [three.token],
            allowed_tokens,
        )
        self.assertEqual(group_1, [one.token, two.token])
        self.assertEqual(group_2, [three.token])

    def test_owner_marker_requires_matching_topology_fingerprint_when_present(self):
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            physical = {self.descriptor(1).identity_key()}
            marker = {
                "active": True,
                "owner_id": toggle.owner_id,
                "physical_keys": list(physical),
                "topology_signature": "saved-signature",
            }
            self.assertTrue(toggle.marker_matches_current(marker, physical, "saved-signature"))
            self.assertFalse(toggle.marker_matches_current(marker, physical, "manually-changed-layout"))

    def test_toggle_direction_group_1_to_2_and_group_2_to_1(self):
        snapshots = {}
        for side, target_id in ((1, 1), (2, 2)):
            snapshots[side] = make_snapshot(
                [make_path(target_id, target_id, 0)],
                [make_source_mode(target_id, 0, 0, 1920, 1080)],
            )

        for source_side, target_side in ((1, 2), (2, 1)):
            with self.subTest(source_side=source_side), tempfile.TemporaryDirectory() as temporary:
                toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
                toggle.group_keys = {
                    1: [self.descriptor(1).identity_key()],
                    2: [self.descriptor(2).identity_key()],
                }
                snapshot, paths, modes = snapshots[source_side]
                with (
                    mock.patch.object(toggle, "resolve_groups"),
                    mock.patch.object(toggle, "query_active", return_value=(snapshot, paths, modes)),
                    mock.patch.object(toggle, "owner_marker", return_value={}),
                    mock.patch.object(toggle, "switch_to_side") as switch,
                    mock.patch.object(tm, "SingleInstance", ImmediateLock),
                ):
                    toggle.toggle_once()
                switch.assert_called_once_with(target_side, snapshot, paths, modes, source_side)

    def test_unmatched_current_layout_applies_group_1_without_capture(self):
        unmatched_snapshot, unmatched_paths, unmatched_modes = make_snapshot(
            [make_path(3, 3, 0)],
            [make_source_mode(3, 0, 0, 1920, 1080)],
        )
        group_1_snapshot, group_1_paths, group_1_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys = {
                1: [self.descriptor(1).identity_key()],
                2: [self.descriptor(2).identity_key()],
            }
            with (
                mock.patch.object(toggle, "capture_side_layout") as capture,
                mock.patch.object(
                    toggle,
                    "activate_side",
                    return_value=(
                        group_1_snapshot,
                        group_1_paths,
                        group_1_modes,
                        {self.descriptor(1).identity_key()},
                        set(),
                    ),
                ) as activate,
                mock.patch.object(toggle, "write_metadata") as write_metadata,
                mock.patch.object(toggle, "clear_group_2_owner") as clear_owner,
            ):
                toggle.switch_to_side(1, unmatched_snapshot, unmatched_paths, unmatched_modes, None)
            capture.assert_not_called()
            activate.assert_called_once_with(1, unmatched_snapshot, unmatched_paths)
            clear_owner.assert_called_once_with()
            self.assertEqual(write_metadata.call_args_list[0].kwargs["transition"], "unmatched_to_group_1")
            self.assertEqual(write_metadata.call_args_list[-1].kwargs["transition"], "group_1")

    def test_stale_saved_side_is_not_reused_when_physical_keys_differ(self):
        current_snapshot, current_paths, _ = make_snapshot(
            [make_path(1, 1, 0), make_path(2, 2, 1)],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(2, 1920, 0, 1920, 1080)],
        )
        target_snapshot, target_paths, target_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys[1] = [self.descriptor(1).identity_key()]
            toggle.group_descriptors[1] = [self.descriptor(1)]
            tm.save_snapshot(target_snapshot, toggle.paths["full"])
            tm.write_json_object(
                toggle.paths["metadata"],
                {"full_physical_keys": [self.descriptor(2).identity_key()]},
            )
            with (
                mock.patch.object(toggle, "apply_saved_side", wraps=toggle.apply_saved_side) as apply_saved,
                mock.patch.object(tm, "build_selected_snapshot", return_value=target_snapshot) as build_selected,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(toggle, "query_active", return_value=(target_snapshot, target_paths, target_modes)),
                mock.patch.object(toggle, "capture_side_layout") as capture,
            ):
                toggle.activate_side(1, current_snapshot, current_paths)
            apply_saved.assert_not_called()
            build_selected.assert_called_once_with(
                current_snapshot,
                toggle.group_keys[1],
                preserve_wireless=True,
            )
            apply_exact.assert_called_once_with(target_snapshot, save_to_database=False)
            capture.assert_called_once_with(1, target_snapshot, target_paths)

    def test_saved_snapshot_content_mismatch_is_not_applied_when_metadata_matches(self):
        current_snapshot, current_paths, _ = make_snapshot(
            [make_path(1, 1, 0), make_path(2, 2, 1)],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(2, 1920, 0, 1920, 1080)],
        )
        stale_snapshot, _, _ = make_snapshot(
            [make_path(2, 2, 0)],
            [make_source_mode(2, 0, 0, 1920, 1080)],
        )
        filtered_snapshot, filtered_paths, filtered_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys[1] = [self.descriptor(1).identity_key()]
            toggle.group_descriptors[1] = [self.descriptor(1)]
            tm.save_snapshot(stale_snapshot, toggle.paths["full"])
            tm.write_json_object(
                toggle.paths["metadata"],
                {"full_physical_keys": toggle.group_keys[1]},
            )

            self.assertFalse(toggle.saved_side_matches_configuration(1))
            with (
                mock.patch.object(toggle, "apply_saved_side", wraps=toggle.apply_saved_side) as apply_saved,
                mock.patch.object(tm, "build_selected_snapshot", return_value=filtered_snapshot),
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(
                    toggle,
                    "query_active",
                    return_value=(filtered_snapshot, filtered_paths, filtered_modes),
                ),
                mock.patch.object(toggle, "capture_side_layout"),
            ):
                toggle.activate_side(1, current_snapshot, current_paths)

            apply_saved.assert_not_called()
            apply_exact.assert_called_once_with(filtered_snapshot, save_to_database=False)

    def test_overlapping_subset_uses_filtered_snapshot(self):
        current_snapshot, current_paths, _ = make_snapshot(
            [make_path(1, 1, 0), make_path(2, 2, 1), make_path(3, 3, 2)],
            [
                make_source_mode(1, 0, 0, 1920, 1080),
                make_source_mode(2, 1920, 0, 1920, 1080),
                make_source_mode(3, 3840, 0, 1920, 1080),
            ],
        )
        target_snapshot, target_paths, target_modes = make_snapshot(
            [make_path(2, 2, 0), make_path(3, 3, 1)],
            [make_source_mode(2, 0, 0, 1920, 1080), make_source_mode(3, 1920, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys[2] = [self.descriptor(2).identity_key(), self.descriptor(3).identity_key()]
            toggle.group_descriptors[2] = [self.descriptor(2), self.descriptor(3)]
            with (
                mock.patch.object(tm, "build_selected_snapshot", return_value=target_snapshot) as build_selected,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                mock.patch.object(toggle, "query_active", return_value=(target_snapshot, target_paths, target_modes)),
                mock.patch.object(toggle, "capture_side_layout"),
            ):
                toggle.activate_side(2, current_snapshot, current_paths)
            build_selected.assert_called_once_with(
                current_snapshot,
                toggle.group_keys[2],
                preserve_wireless=True,
            )
            apply_exact.assert_called_once_with(target_snapshot, save_to_database=False)
            apply_topology.assert_not_called()

    def test_disjoint_and_superset_groups_use_persisted_topology_path(self):
        cases = {
            "disjoint": ([1], [2]),
            "superset": ([1], [1, 2]),
        }
        for label, (current_ids, target_ids) in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                current_snapshot, current_paths, _ = make_snapshot(
                    [make_path(target_id, target_id, index) for index, target_id in enumerate(current_ids)],
                    [make_source_mode(target_id, index * 1920, 0, 1920, 1080) for index, target_id in enumerate(current_ids)],
                )
                target_snapshot, target_paths, target_modes = make_snapshot(
                    [make_path(target_id, target_id, index) for index, target_id in enumerate(target_ids)],
                    [make_source_mode(target_id, index * 1920, 0, 1920, 1080) for index, target_id in enumerate(target_ids)],
                )
                toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
                toggle.group_keys[2] = [self.descriptor(target_id).identity_key() for target_id in target_ids]
                toggle.group_descriptors[2] = [self.descriptor(target_id) for target_id in target_ids]
                chosen = [make_path(target_id, target_id, active=False) for target_id in target_ids]
                with (
                    mock.patch.object(tm, "query_display_config", return_value=(target_snapshot, target_paths, target_modes)) as query_all,
                    mock.patch.object(tm, "choose_distinct_target_paths", return_value=chosen) as choose,
                    mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                    mock.patch.object(tm, "build_selected_snapshot") as build_selected,
                    mock.patch.object(toggle, "query_active", return_value=(target_snapshot, target_paths, target_modes)),
                    mock.patch.object(toggle, "capture_side_layout"),
                ):
                    toggle.activate_side(2, current_snapshot, current_paths)
                query_all.assert_called_once_with(tm.awareness_query_flags(tm.QDC_ALL_PATHS))
                choose.assert_called_once()
                apply_topology.assert_called_once_with(chosen)
                build_selected.assert_not_called()

    def test_post_apply_watcher_failure_rolls_back_group_1_and_clears_owner(self):
        group_1_snapshot, group_1_paths, group_1_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        group_2_snapshot, group_2_paths, group_2_modes = make_snapshot(
            [make_path(2, 2, 0), make_path(9, 9, 1, wireless=True)],
            [make_source_mode(2, 0, 0, 1920, 1080), make_source_mode(9, 1920, 0, 1920, 1080)],
        )
        group_1_keys = {self.descriptor(1).identity_key()}
        group_2_keys = {self.descriptor(2).identity_key()}
        wireless = {self.descriptor(9).identity_key()}
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys = {1: list(group_1_keys), 2: list(group_2_keys)}
            with (
                mock.patch.object(toggle, "capture_side_layout") as capture,
                mock.patch.object(
                    toggle,
                    "activate_side",
                    return_value=(group_2_snapshot, group_2_paths, group_2_modes, group_2_keys, wireless),
                ),
                mock.patch.object(toggle, "mark_group_2_owner") as mark_owner,
                mock.patch.object(toggle, "launch_wireless_drop_watcher", side_effect=OSError("watcher launch failed")),
                mock.patch.object(
                    toggle,
                    "query_active",
                    return_value=(group_2_snapshot, group_2_paths, group_2_modes),
                ) as query_after_failure,
                mock.patch.object(toggle, "clear_group_2_owner") as clear_owner,
                mock.patch.object(toggle, "write_metadata"),
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
            ):
                with self.assertRaisesRegex(OSError, "watcher launch failed"):
                    toggle.switch_to_side(2, group_1_snapshot, group_1_paths, group_1_modes, 1)
            capture.assert_called_once_with(1, group_1_snapshot, group_1_paths)
            mark_owner.assert_called_once()
            query_after_failure.assert_not_called()
            apply_exact.assert_called_once_with(group_1_snapshot, save_to_database=False)
            self.assertIs(apply_exact.call_args.args[0], group_1_snapshot)
            clear_owner.assert_called_once_with()

    def test_switch_failure_exact_restores_complete_snapshot_without_geometry_shortcut(self):
        before_snapshot, before_paths, before_modes = make_snapshot(
            [make_path(1, 1, 0), make_path(2, 2, 1)],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(2, 1920, 0, 1920, 1080)],
        )
        after_path_1 = make_path(1, 1, 0)
        after_path_2 = make_path(2, 2, 1)
        after_path_1.targetInfo.rotation = 2
        after_path_2.targetInfo.rotation = 2
        after_snapshot, after_paths, after_modes = make_snapshot(
            [after_path_1, after_path_2],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(2, 1920, 0, 1920, 1080)],
        )
        self.assertEqual(
            tm.topology_fingerprint(before_paths, before_modes, before_snapshot.path_count),
            tm.topology_fingerprint(after_paths, after_modes, after_snapshot.path_count),
        )
        serialized_before = before_snapshot.to_json()

        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys = {
                1: [self.descriptor(1).identity_key(), self.descriptor(2).identity_key()],
                2: [self.descriptor(3).identity_key()],
            }
            with (
                mock.patch.object(toggle, "capture_side_layout"),
                mock.patch.object(toggle, "activate_side", side_effect=OSError("switch failed")),
                mock.patch.object(
                    toggle,
                    "query_active",
                    return_value=(after_snapshot, after_paths, after_modes),
                ) as query_after_failure,
                mock.patch.object(toggle, "clear_group_2_owner"),
                mock.patch.object(toggle, "write_metadata"),
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
            ):
                with self.assertRaisesRegex(OSError, "switch failed"):
                    toggle.switch_to_side(2, before_snapshot, before_paths, before_modes, 1)

            query_after_failure.assert_not_called()
            apply_exact.assert_called_once_with(before_snapshot, save_to_database=False)
            self.assertIs(apply_exact.call_args.args[0], before_snapshot)
            self.assertEqual(before_snapshot.to_json(), serialized_before)

    def test_foreign_group_2_owner_blocks_before_any_apply(self):
        active_snapshot, active_paths, active_modes = make_snapshot(
            [make_path(2, 2, 0)],
            [make_source_mode(2, 0, 0, 1920, 1080)],
        )
        current = {self.descriptor(2).identity_key()}
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys = {
                1: [self.descriptor(1).identity_key()],
                2: list(current),
            }
            marker = {
                "active": True,
                "owner_id": "another-button-owner",
                "physical_keys": list(current),
                "topology_signature": "another-button-signature",
            }
            with (
                mock.patch.object(toggle, "resolve_groups"),
                mock.patch.object(toggle, "query_active", return_value=(active_snapshot, active_paths, active_modes)),
                mock.patch.object(toggle, "owner_marker", return_value=marker),
                mock.patch.object(toggle, "switch_to_side") as switch,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                with self.assertRaisesRegex(tm.DisplayConfigError, "Another Toggle Monitors Button"):
                    toggle.toggle_once()
            switch.assert_not_called()
            apply_exact.assert_not_called()
            apply_topology.assert_not_called()

    def test_saved_group_1_tries_exact_then_no_wireless_fallback(self):
        exact_snapshot, _, _ = make_snapshot(
            [make_path(1, 1, 0), make_path(9, 9, 1, wireless=True)],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(9, 1920, 0, 1920, 1080)],
        )
        fallback_snapshot, _, _ = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            toggle.group_keys[1] = [self.descriptor(1).identity_key()]
            tm.save_snapshot(exact_snapshot, toggle.paths["full"])
            tm.save_snapshot(fallback_snapshot, toggle.paths["full_no_wireless"])
            tm.write_json_object(
                toggle.paths["metadata"],
                {"full_physical_keys": toggle.group_keys[1]},
            )
            apply_exact = mock.Mock(side_effect=[tm.DisplayConfigError("wireless unavailable"), None])
            with mock.patch.object(tm, "apply_snapshot_exact", apply_exact):
                toggle.apply_saved_side(1)
            self.assertTrue(toggle.saved_side_matches_configuration(1))
            self.assertEqual(apply_exact.call_count, 2)
            self.assertEqual(apply_exact.call_args_list[0].args[0].to_json(), exact_snapshot.to_json())
            self.assertEqual(apply_exact.call_args_list[1].args[0].to_json(), fallback_snapshot.to_json())
            self.assertTrue(all(not call.kwargs["save_to_database"] for call in apply_exact.call_args_list))

    def test_group_2_owner_marker_and_watcher_are_guarded_by_configuration_fingerprint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            owner_path = root / "active-owner.json"
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], root)
            group_2 = {self.descriptor(2).identity_key()}
            toggle.group_keys = {
                1: [self.descriptor(1).identity_key()],
                2: list(group_2),
            }
            with mock.patch.object(tm, "active_owner_path", return_value=owner_path):
                toggle.mark_group_2_owner(group_2, "group-2-topology")
            marker = tm.read_json_object(owner_path)
            self.assertEqual(marker["configuration_fingerprint"], toggle.configuration_fingerprint())

            marker["configuration_fingerprint"] = "fingerprint-from-an-older-configuration"
            current = (group_2, set(), "group-2-topology")
            with (
                mock.patch.object(toggle, "read_metadata", return_value={"reduced_wireless_keys": ["path:wireless"]}),
                mock.patch.object(toggle, "current_topology_state", side_effect=[current, current]),
                mock.patch.object(toggle, "owner_marker", return_value=marker),
                mock.patch.object(toggle, "restore_full") as restore_group_1,
                mock.patch.object(tm.time, "sleep"),
            ):
                toggle.watch_wireless_drop_and_restore(poll_seconds=0, missing_grace_polls=1)
            restore_group_1.assert_not_called()

    def test_configure_cancel_has_distinct_main_exit_code_without_launching_picker(self):
        args = SimpleNamespace(
            startup_safety_guardian=False,
            restore_all_available=False,
            configure_button=True,
            button_config="toggle-monitors.txt",
            pythonw_path=r"C:\Python\pythonw.exe",
        )
        logger = mock.Mock()
        with (
            mock.patch.object(tm, "parse_args", return_value=args),
            mock.patch.object(tm, "setup_logging", return_value=logger),
            mock.patch.object(tm, "configure_button_groups", return_value=False) as configure,
        ):
            exit_code = tm.main()
        self.assertEqual(exit_code, tm.CONFIGURATION_CANCELLED_EXIT_CODE)
        configure.assert_called_once_with(
            Path(args.button_config).resolve(),
            args.pythonw_path,
            logger,
        )

    def test_configuration_write_precedes_marker_invalidation_and_restores_previous_config_on_failure(self):
        one = self.choice(1, active=True, main=True)
        two = self.choice(2)
        three = self.choice(3)
        logger = mock.Mock()
        events = []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "toggle-monitors.txt"
            fake_powershell = root / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            fake_powershell.parent.mkdir(parents=True)
            fake_powershell.touch()
            tm.write_button_group_config(config, "old-pythonw.exe", [one.token], [two.token])
            previous_config = config.read_text(encoding="utf-8")

            original_write_config = tm.write_button_group_config
            original_read_json = tm.read_json_object

            def write_config(path, pythonw_path, group_1, group_2):
                events.append("config-write")
                original_write_config(path, pythonw_path, group_1, group_2)

            def invalidate_marker(path, group_1, group_2):
                events.append("marker-invalidate")
                self.assertEqual(tm.selector_groups_from_button_config(path), (list(group_1), list(group_2)))
                raise OSError("marker write failed")

            def read_picker_result(path):
                if Path(path).name == "result.json":
                    return {
                        "schemaVersion": 1,
                        "cancelled": False,
                        "group1": [one.token, three.token],
                        "group2": [two.token],
                    }
                return original_read_json(path)

            with (
                mock.patch.object(tm, "list_available_monitor_choices", return_value=[one, two, three]),
                mock.patch.object(tm.subprocess, "run", return_value=SimpleNamespace(returncode=0)),
                mock.patch.object(tm, "read_json_object", side_effect=read_picker_result),
                mock.patch.object(tm, "write_button_group_config", side_effect=write_config),
                mock.patch.object(
                    tm,
                    "invalidate_active_owner_after_configuration",
                    side_effect=invalidate_marker,
                ) as invalidate,
                mock.patch.dict(tm.os.environ, {"SystemRoot": str(root)}),
            ):
                with self.assertRaisesRegex(tm.DisplayConfigError, "restored to a safe state"):
                    tm.configure_button_groups(config, "new-pythonw.exe", logger)

            self.assertEqual(events, ["config-write", "marker-invalidate"])
            self.assertEqual(config.read_text(encoding="utf-8"), previous_config)
            invalidate.assert_called_once_with(
                config,
                [one.token, three.token],
                [two.token],
            )

    def test_disconnected_group_member_is_silently_ignored_and_connected_subset_still_toggles(self):
        one = tm.encode_target_descriptor(self.descriptor(1))
        two = tm.encode_target_descriptor(self.descriptor(2))
        three = tm.encode_target_descriptor(self.descriptor(3))
        available_paths = [
            make_path(1, 1, active=True),
            make_path(2, 2, active=False, target_available=False),
            make_path(3, 3, active=False),
        ]
        available_snapshot, all_paths, all_modes = make_snapshot(available_paths, [])
        active_snapshot, active_paths, active_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), [one, two], [three], Path(temporary))
            with mock.patch.object(
                tm,
                "query_display_config",
                return_value=(available_snapshot, all_paths, all_modes),
            ):
                toggle.resolve_groups()

            self.assertEqual(toggle.group_keys[1], [self.descriptor(1).identity_key()])
            self.assertEqual(toggle.group_keys[2], [self.descriptor(3).identity_key()])
            self.assertEqual(toggle.group_unavailable_labels[1], ["Monitor 2"])

            with (
                mock.patch.object(toggle, "resolve_groups"),
                mock.patch.object(toggle, "query_active", return_value=(active_snapshot, active_paths, active_modes)),
                mock.patch.object(toggle, "owner_marker", return_value={}),
                mock.patch.object(toggle, "switch_to_side") as switch,
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                toggle.toggle_once()
            switch.assert_called_once_with(2, active_snapshot, active_paths, active_modes, 1)

    def test_disconnected_effective_groups_still_fail_when_empty_or_identical(self):
        one = tm.encode_target_descriptor(self.descriptor(1))
        two = tm.encode_target_descriptor(self.descriptor(2))
        three = tm.encode_target_descriptor(self.descriptor(3))
        cases = {
            "empty": ([two], [three], "has no connected monitors"),
            "identical": ([one, two], [one], "make Group 1 and Group 2 identical"),
        }
        paths = [
            make_path(1, 1, active=True),
            make_path(2, 2, active=False, target_available=False),
            make_path(3, 3, active=False),
        ]
        snapshot, path_array, mode_array = make_snapshot(paths, [])
        for label, (group_1, group_2, expected_error) in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                toggle = tm.ButtonMonitorToggle(mock.Mock(), group_1, group_2, Path(temporary))
                with mock.patch.object(
                    tm,
                    "query_display_config",
                    return_value=(snapshot, path_array, mode_array),
                ):
                    with self.assertRaisesRegex(tm.DisplayConfigError, expected_error):
                        toggle.resolve_groups()

    def test_unprovable_identity_is_silently_ignored_when_effective_groups_remain_valid(self):
        unprovable = tm.TargetDescriptor(
            device_path="",
            adapter_high=9,
            adapter_low=99,
            target_id=42,
            friendly="Missing identity",
            source="",
        )
        unprovable_token = tm.encode_target_descriptor(unprovable)
        connected_one = tm.encode_target_descriptor(self.descriptor(1))
        connected_three = tm.encode_target_descriptor(self.descriptor(3))
        snapshot, path_array, mode_array = make_snapshot(
            [make_path(1, 1, active=True), make_path(3, 3, active=False)],
            [],
        )

        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(
                mock.Mock(),
                [unprovable_token, connected_one],
                [connected_three],
                Path(temporary),
            )
            with mock.patch.object(
                tm,
                "query_display_config",
                return_value=(snapshot, path_array, mode_array),
            ):
                toggle.resolve_groups()

        self.assertEqual(toggle.group_keys[1], [self.descriptor(1).identity_key()])
        self.assertEqual(toggle.group_keys[2], [self.descriptor(3).identity_key()])
        self.assertEqual(toggle.group_unavailable_labels[1], ["Missing identity"])

    def test_startup_safety_restores_available_monitors_and_persists_only_verified_result(self):
        group_1 = [tm.encode_target_descriptor(self.descriptor(1)), tm.encode_target_descriptor(self.descriptor(2))]
        dummy_group_2 = [tm.encode_target_descriptor(self.descriptor(9))]
        before_snapshot, before_paths, before_modes = make_snapshot(
            [make_path(9, 9, 0)],
            [make_source_mode(9, 0, 0, 2560, 1440)],
        )
        all_snapshot, all_paths, all_modes = make_snapshot(
            [
                make_path(9, 9, active=True),
                make_path(1, 1, active=False),
                make_path(2, 2, active=False),
                make_path(3, 3, active=False, target_available=False),
            ],
            [],
        )
        verified_snapshot, verified_paths, verified_modes = make_snapshot(
            [make_path(1, 1, 0), make_path(2, 2, 1), make_path(9, 9, 2)],
            [make_source_mode(1, 0, 0, 1920, 1080), make_source_mode(2, 1920, 0, 1920, 1080), make_source_mode(9, 3840, 0, 2560, 1440)],
        )
        chosen = [make_path(1, 1, active=False), make_path(2, 2, active=False), make_path(9, 9)]

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "toggle-monitors.txt"
            owner_marker = root / "active-owner.json"
            tm.write_button_group_config(config, "pythonw.exe", group_1, dummy_group_2)
            with (
                mock.patch.object(
                    tm,
                    "query_display_config",
                    side_effect=[
                        (before_snapshot, before_paths, before_modes),
                        (all_snapshot, all_paths, all_modes),
                        (before_snapshot, before_paths, before_modes),
                        (verified_snapshot, verified_paths, verified_modes),
                        (verified_snapshot, verified_paths, verified_modes),
                    ],
                ),
                mock.patch.object(tm, "choose_distinct_target_paths", return_value=chosen) as choose,
                mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "active_owner_path", return_value=owner_marker),
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                restored, persisted = tm.restore_all_available_monitors_once(
                    config,
                    mock.Mock(),
                    persist_database=True,
                )

            self.assertEqual(
                restored,
                frozenset({self.descriptor(1).identity_key(), self.descriptor(2).identity_key(), self.descriptor(9).identity_key()}),
            )
            self.assertTrue(persisted)
            chosen_descriptors = choose.call_args.args[0]
            self.assertEqual([descriptor.target_id for descriptor in chosen_descriptors], [9, 1, 2])
            self.assertTrue(choose.call_args.kwargs["include_wireless"])
            apply_topology.assert_called_once_with(chosen)
            apply_exact.assert_called_once_with(verified_snapshot, save_to_database=True)
            marker = tm.read_json_object(owner_marker)
            self.assertFalse(marker["active"])
            self.assertEqual(marker["phase"], "restore_all_available")

    def test_startup_safety_verification_failure_rolls_back_temporarily_and_keeps_owner(self):
        group_1 = [tm.encode_target_descriptor(self.descriptor(1))]
        dummy_group_2 = [tm.encode_target_descriptor(self.descriptor(9))]
        before_snapshot, before_paths, before_modes = make_snapshot(
            [make_path(9, 9, 0)],
            [make_source_mode(9, 0, 0, 2560, 1440)],
        )
        all_snapshot, all_paths, all_modes = make_snapshot(
            [make_path(9, 9, active=True, target_available=False), make_path(1, 1, active=False)],
            [],
        )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "toggle-monitors.txt"
            owner_marker = root / "active-owner.json"
            original_marker = {"active": True, "owner_id": "dummy-owner", "phase": "group_2"}
            tm.write_button_group_config(config, "pythonw.exe", group_1, dummy_group_2)
            tm.write_json_object(owner_marker, original_marker)
            with (
                mock.patch.object(
                    tm,
                    "query_display_config",
                    side_effect=[
                        (before_snapshot, before_paths, before_modes),
                        (all_snapshot, all_paths, all_modes),
                        (before_snapshot, before_paths, before_modes),
                        (before_snapshot, before_paths, before_modes),
                    ],
                ),
                mock.patch.object(tm, "validate_and_apply_topology"),
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "active_owner_path", return_value=owner_marker),
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                with self.assertRaisesRegex(tm.DisplayConfigError, "did not activate exactly"):
                    tm.restore_all_available_monitors_once(
                        config,
                        mock.Mock(),
                        persist_database=True,
                    )

            apply_exact.assert_called_once_with(before_snapshot, save_to_database=False)
            self.assertEqual(tm.read_json_object(owner_marker), original_marker)

    def test_startup_safety_post_persist_failure_restores_database_and_session(self):
        group_1 = [tm.encode_target_descriptor(self.descriptor(1))]
        dummy_group_2 = [tm.encode_target_descriptor(self.descriptor(9))]
        before_snapshot, before_paths, before_modes = make_snapshot(
            [make_path(9, 9, 0)],
            [make_source_mode(9, 0, 0, 2560, 1440)],
        )
        all_snapshot, all_paths, all_modes = make_snapshot(
            [make_path(9, 9, active=True, target_available=False), make_path(1, 1, active=False)],
            [],
        )
        verified_snapshot, verified_paths, verified_modes = make_snapshot(
            [make_path(1, 1, 0)],
            [make_source_mode(1, 0, 0, 1920, 1080)],
        )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "toggle-monitors.txt"
            owner_marker = root / "active-owner.json"
            original_marker = {"active": True, "owner_id": "dummy-owner", "phase": "group_2"}
            tm.write_button_group_config(config, "pythonw.exe", group_1, dummy_group_2)
            tm.write_json_object(owner_marker, original_marker)
            with (
                mock.patch.object(
                    tm,
                    "query_display_config",
                    side_effect=[
                        (before_snapshot, before_paths, before_modes),
                        (all_snapshot, all_paths, all_modes),
                        (before_snapshot, before_paths, before_modes),
                        (verified_snapshot, verified_paths, verified_modes),
                        (before_snapshot, before_paths, before_modes),
                    ],
                ),
                mock.patch.object(tm, "validate_and_apply_topology"),
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "active_owner_path", return_value=owner_marker),
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                with self.assertRaisesRegex(tm.DisplayConfigError, "persisted startup-safe topology"):
                    tm.restore_all_available_monitors_once(
                        config,
                        mock.Mock(),
                        persist_database=True,
                    )

            self.assertEqual(
                apply_exact.call_args_list,
                [
                    mock.call(verified_snapshot, save_to_database=True),
                    mock.call(before_snapshot, save_to_database=True),
                    mock.call(before_snapshot, save_to_database=False),
                ],
            )
            self.assertEqual(tm.read_json_object(owner_marker), original_marker)

    def test_startup_safety_does_not_apply_when_no_target_is_available(self):
        group_1 = [tm.encode_target_descriptor(self.descriptor(1))]
        dummy_group_2 = [tm.encode_target_descriptor(self.descriptor(9))]
        before_snapshot, before_paths, before_modes = make_snapshot(
            [make_path(9, 9, 0)],
            [make_source_mode(9, 0, 0, 2560, 1440)],
        )
        all_snapshot, all_paths, all_modes = make_snapshot(
            [make_path(9, 9, active=True, target_available=False), make_path(1, 1, active=False, target_available=False)],
            [],
        )

        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "toggle-monitors.txt"
            tm.write_button_group_config(config, "pythonw.exe", group_1, dummy_group_2)
            with (
                mock.patch.object(
                    tm,
                    "query_display_config",
                    side_effect=[
                        (before_snapshot, before_paths, before_modes),
                        (all_snapshot, all_paths, all_modes),
                    ],
                ),
                mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                with self.assertRaisesRegex(tm.DisplayConfigError, "No monitor"):
                    tm.restore_all_available_monitors_once(
                        config,
                        mock.Mock(),
                        persist_database=True,
                    )

            apply_topology.assert_not_called()
            apply_exact.assert_not_called()

    def test_startup_safety_accepts_one_new_monitor_dummy_only_or_every_available_target(self):
        for target_ids in ([1], [9], [1, 2, 9], list(range(1, 17))):
            with self.subTest(target_ids=target_ids):
                paths = [make_path(i, i, index, wireless=i == 16) for index, i in enumerate(target_ids)]
                modes = [make_source_mode(i, index * 1920, 0, 1920, 1080) for index, i in enumerate(target_ids)]
                active = make_snapshot(paths, modes)
                available = make_snapshot(paths + [make_path(99, 99, active=False, target_available=False)], modes)
                with (
                    mock.patch.object(tm, "query_display_config", side_effect=[active, available, active, active, active]),
                    mock.patch.object(tm, "selector_groups_from_button_config", side_effect=AssertionError("Must not read groups")),
                    mock.patch.object(tm, "apply_snapshot_exact") as apply_exact,
                    mock.patch.object(tm, "validate_and_apply_topology") as apply_topology,
                    mock.patch.object(tm, "clear_active_owner_after_startup_safety"),
                    mock.patch.object(tm, "SingleInstance", ImmediateLock),
                ):
                    keys, persisted = tm.restore_all_available_monitors_once(
                        Path("nonexistent-button-config.txt"), mock.Mock(), persist_database=True
                    )
                self.assertEqual(keys, frozenset(self.descriptor(i).identity_key() for i in target_ids))
                self.assertTrue(persisted)
                apply_exact.assert_called_once_with(active[0], save_to_database=True)
                apply_topology.assert_not_called()

    def test_startup_discovery_includes_inactive_dummy_wireless_and_deduplicates_paths(self):
        _, paths, _ = make_snapshot([
            make_path(1, 1), make_path(2, 1, active=False),
            make_path(3, 9, active=False), make_path(4, 16, active=False, wireless=True),
            make_path(5, 99, active=False, target_available=False),
        ], [])
        descriptors = tm.startup_safety_target_descriptors(paths, 5)
        self.assertEqual([d.target_id for d in descriptors], [1, 9, 16])
        chosen = tm.choose_distinct_target_paths(descriptors, paths, 5, include_wireless=True)
        self.assertEqual([p.targetInfo.id for p in chosen], [1, 9, 16])

    def test_startup_safety_retries_until_available_group_is_stable(self):
        first = frozenset({"one"})
        second = frozenset({"one", "two"})
        with (
            mock.patch.object(
                tm,
                "restore_all_available_monitors_once",
                side_effect=[(first, False), (second, False), (second, True)],
            ) as restore_once,
            mock.patch.object(tm.time, "sleep") as sleep,
        ):
            restored = tm.restore_all_available_monitors(Path("config.txt"), mock.Mock(), attempts=6, retry_seconds=2)
        self.assertEqual(restored, second)
        self.assertEqual(restore_once.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertFalse(restore_once.call_args_list[0].kwargs["persist_database"])
        self.assertEqual(restore_once.call_args_list[1].kwargs["expected_keys"], first)
        self.assertEqual(restore_once.call_args_list[2].kwargs["expected_keys"], second)

    def test_startup_safety_exhaustion_never_accepts_an_unstable_set(self):
        first = frozenset({"one"})
        second = frozenset({"one", "two"})
        with (
            mock.patch.object(
                tm,
                "restore_all_available_monitors_once",
                side_effect=[(first, False), (second, False), (first, False)],
            ),
            mock.patch.object(tm.time, "sleep"),
        ):
            with self.assertRaisesRegex(tm.DisplayConfigError, "stable available topology"):
                tm.restore_all_available_monitors(Path("config.txt"), mock.Mock(), attempts=3, retry_seconds=0)

    def test_startup_safety_trigger_mapping_is_narrow(self):
        self.assertEqual(
            tm.startup_safety_trigger_reason(tm.WM_POWERBROADCAST, tm.PBT_APMRESUMEAUTOMATIC),
            "automatic-resume",
        )
        self.assertEqual(
            tm.startup_safety_trigger_reason(tm.WM_WTSSESSION_CHANGE, tm.WTS_SESSION_LOCK),
            "session-lock",
        )
        self.assertEqual(
            tm.startup_safety_trigger_reason(tm.WM_WTSSESSION_CHANGE, tm.WTS_SESSION_UNLOCK),
            "session-unlock",
        )
        self.assertIsNone(tm.startup_safety_trigger_reason(tm.WM_POWERBROADCAST, 0))

    def test_wireless_drop_watcher_restores_group_1(self):
        with tempfile.TemporaryDirectory() as temporary:
            toggle = tm.ButtonMonitorToggle(mock.Mock(), ["group-1"], ["group-2"], Path(temporary))
            group_2 = {self.descriptor(2).identity_key()}
            toggle.group_keys = {
                1: [self.descriptor(1).identity_key()],
                2: list(group_2),
            }
            marker = {
                "active": True,
                "owner_id": toggle.owner_id,
                "physical_keys": list(group_2),
                "topology_signature": "wireless-present-signature",
                "configuration_fingerprint": toggle.configuration_fingerprint(),
            }
            missing = (group_2, set(), "wireless-missing-signature")
            with (
                mock.patch.object(toggle, "resolve_groups"),
                mock.patch.object(toggle, "read_metadata", return_value={"reduced_wireless_keys": ["path:wireless"]}),
                mock.patch.object(toggle, "current_topology_state", side_effect=[missing, missing, missing]),
                mock.patch.object(toggle, "owner_marker", return_value=marker),
                mock.patch.object(toggle, "restore_full") as restore_group_1,
                mock.patch.object(tm.time, "sleep"),
                mock.patch.object(tm, "SingleInstance", ImmediateLock),
            ):
                toggle.watch_wireless_drop_and_restore(poll_seconds=0, missing_grace_polls=1)
            restore_group_1.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
