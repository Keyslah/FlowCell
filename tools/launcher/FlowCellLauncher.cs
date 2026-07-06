using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

internal static class FlowCellLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string repoRoot = null;

        try
        {
            repoRoot = ResolveRepoRoot(baseDirectory);
            if (string.IsNullOrWhiteSpace(repoRoot))
            {
                LogLauncherError(baseDirectory, "Could not resolve FlowCell repo root from launcher location.");
                return 1;
            }

            var runCmdPath = Path.Combine(repoRoot, "run.cmd");
            var hiddenVbsPath = Path.Combine(repoRoot, "run_hidden.vbs");
            if (!File.Exists(runCmdPath))
            {
                LogLauncherError(repoRoot, "Missing launcher path: " + runCmdPath);
                return 1;
            }

            var startInfo = BuildStartInfo(runCmdPath, hiddenVbsPath, repoRoot, args);
            if (startInfo == null)
            {
                LogLauncherError(repoRoot, "Could not build launch start info.");
                return 1;
            }

            Process.Start(startInfo);
            LogLauncherError(repoRoot, "Launcher started: " + startInfo.FileName + " " + startInfo.Arguments);
            return 0;
        }
        catch (Exception ex)
        {
            LogLauncherError(string.IsNullOrWhiteSpace(repoRoot) ? baseDirectory : repoRoot, ex.ToString());
            return 1;
        }
    }

    private static string ResolveRepoRoot(string baseDirectory)
    {
        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            return null;
        }

        var current = new DirectoryInfo(Path.GetFullPath(baseDirectory));
        while (current != null)
        {
            var rootRunCmd = Path.Combine(current.FullName, "run.cmd");
            var flowCellRunCmd = Path.Combine(current.FullName, "flowcellbackend", "run.cmd");
            if (File.Exists(rootRunCmd) && File.Exists(flowCellRunCmd))
            {
                return current.FullName;
            }
            current = current.Parent;
        }

        return null;
    }

    private static ProcessStartInfo BuildStartInfo(string runCmdPath, string hiddenVbsPath, string repoRoot, string[] args)
    {
        var hasArgs = args != null && args.Length > 0;
        if (!hasArgs && File.Exists(hiddenVbsPath))
        {
            return new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe"),
                Arguments = "//nologo " + Quote(hiddenVbsPath),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = repoRoot
            };
        }

        var commandLine = Quote(runCmdPath);
        var forwardedArgs = BuildArgumentString(args);
        if (!string.IsNullOrWhiteSpace(forwardedArgs))
        {
            commandLine += " " + forwardedArgs;
        }

        return new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"),
            Arguments = "/c " + Quote(commandLine),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = repoRoot
        };
    }

    private static void LogLauncherError(string repoRootOrBaseDirectory, string message)
    {
        try
        {
            var logDir = ResolveLogDirectory(repoRootOrBaseDirectory);
            Directory.CreateDirectory(logDir);
            var logPath = Path.Combine(logDir, "flowcell_launcher.log");
            var lines = new[]
            {
                "-----",
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"),
                message ?? string.Empty
            };
            File.AppendAllLines(logPath, lines, Encoding.UTF8);
        }
        catch
        {
        }
    }

    private static string ResolveLogDirectory(string repoRootOrBaseDirectory)
    {
        var root = Path.GetFullPath(string.IsNullOrWhiteSpace(repoRootOrBaseDirectory)
            ? AppDomain.CurrentDomain.BaseDirectory
            : repoRootOrBaseDirectory);

        var flowCellLogs = Path.Combine(root, "flowcellbackend", "local", "logs");
        if (Directory.Exists(Path.Combine(root, "flowcellbackend")))
        {
            return flowCellLogs;
        }

        return Path.Combine(root, "local", "logs");
    }

    private static string BuildArgumentString(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return string.Empty;
        }

        return string.Join(" ", args.Select(arg => Quote(arg ?? string.Empty)));
    }

    private static string Quote(string value)
    {
        return "\"" + (value ?? string.Empty).Replace("\"", "\\\"") + "\"";
    }
}
