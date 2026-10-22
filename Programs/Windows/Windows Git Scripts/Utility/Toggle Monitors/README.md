# Toggle Monitors

1. Open the Windows program page and choose **Add**. Select **Toggle Monitors.vbs** in this package. Selecting **Toggle Monitors Picker.ps1** or **toggle_monitors.py** also imports the complete package and uses the same launcher.
2. Press the new Button. Select the monitors for **Group 1** and **Group 2**, then choose **Save**. A monitor can belong to both groups; the two groups must differ. The Button switches groups after saving.
3. To choose monitor placement, switch to each group and open **Windows Settings > System > Display**. Arrange the displays and choose their orientation/resolution there.
4. To choose program-window placement, move and resize the open windows on each group. Toggle away after arranging them. The outgoing group's current arrangement is saved automatically and restored when you return.

Each Button keeps its own monitor groups and regular-window arrangements. A different connected subset of the monitors gets its own saved arrangement. FlowCell Pops and Fans remember their visible positions and sizes for each display setup. Windows that have closed or whose process has restarted are left alone; arrange newly opened windows and toggle away to remember them. Minimized windows stay minimized, and restoration does not activate or raise windows.

To reopen the monitor checklist, run the owned **Toggle Monitors.vbs** launcher with `--configure`. The picker PowerShell file is a package helper; do not run it directly. Do not run the Python engine directly without its Button configuration.

Startup and wake recovery enable every available display, independently of the two Button groups.
