using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;
using Debug = UnityEngine.Debug;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace UniGame.UnityCli.Editor
{
    /// <summary>
    /// Provides deterministic discovery and setup-manager process communication.
    /// </summary>
    public static class UnityCliSetupBridge
    {
        public static string ProjectPath()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
        }

        public static string FindProjectRoot(string projectPath)
        {
            var unityProject = Path.GetFullPath(projectPath);
            var current = new DirectoryInfo(unityProject);
            while (current != null)
            {
                if (Directory.Exists(Path.Combine(current.FullName, ".git")) ||
                    File.Exists(Path.Combine(current.FullName, ".git")))
                    return current.FullName;
                current = current.Parent;
            }

            return unityProject;
        }

        public static PackageInfo FindPackage(string packageName)
        {
            return PackageInfo
                .GetAllRegisteredPackages()
                .FirstOrDefault(package =>
                    string.Equals(package.name, packageName, StringComparison.Ordinal));
        }

        public static string ResolveSetupPath(string packagePath)
        {
            if (string.IsNullOrEmpty(packagePath))
                return string.Empty;
            var bundled = Path.GetFullPath(Path.Combine(packagePath, "Server~", "dist", "setup.js"));
            if (File.Exists(bundled))
                return bundled;
            return Path.GetFullPath(Path.Combine(packagePath, "Server~", "build", "setup.js"));
        }

        public static string[] DefaultCliPaths()
        {
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                return new[]
                {
                    Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Unity",
                        "bin",
                        "unity.exe"),
                };
            }

            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return new[]
            {
                Path.Combine(home, ".local", "bin", "unity"),
                "/usr/local/bin/unity",
                "/opt/unity/bin/unity",
            };
        }

        public static string ResolveExecutable(
            string environmentVariable,
            string executableName,
            string[] fallbacks)
        {
            var explicitPath = Environment.GetEnvironmentVariable(environmentVariable);
            if (!string.IsNullOrWhiteSpace(explicitPath) && File.Exists(explicitPath))
                return Path.GetFullPath(explicitPath);

            var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (var directory in path.Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(directory))
                    continue;
                var candidate = Path.Combine(directory.Trim(), executableName);
                if (File.Exists(candidate))
                    return Path.GetFullPath(candidate);
            }

            return fallbacks.FirstOrDefault(File.Exists) ?? string.Empty;
        }

        public static string RunVersion(string executable, string argument)
        {
            if (string.IsNullOrEmpty(executable))
                return string.Empty;
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = argument,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using var process = Process.Start(startInfo);
                if (process == null)
                    return string.Empty;
                if (!process.WaitForExit(5000))
                {
                    process.Kill();
                    return "timeout";
                }

                return process.ExitCode == 0 ? process.StandardOutput.ReadToEnd().Trim() : string.Empty;
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"Unity CLI setup probe failed: {exception.Message}");
                return string.Empty;
            }
        }

        public static string Execute(string nodePath, string setupPath, string request)
        {
            if (!File.Exists(nodePath) || !File.Exists(setupPath))
                return "{\"ok\":false,\"errors\":[\"Node or setup manager is missing\"]}";
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = $"\"{setupPath}\"",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                using var process = Process.Start(startInfo);
                if (process == null)
                    return "{\"ok\":false,\"errors\":[\"Could not start setup manager\"]}";
                process.StandardInput.Write(request);
                process.StandardInput.Close();
                if (!process.WaitForExit(30000))
                {
                    process.Kill();
                    return "{\"ok\":false,\"errors\":[\"Setup manager timed out\"]}";
                }

                var output = process.StandardOutput.ReadToEnd();
                var error = process.StandardError.ReadToEnd();
                return string.IsNullOrWhiteSpace(output)
                    ? $"{{\"ok\":false,\"errors\":[\"{Escape(error)}\"]}}"
                    : Sanitize(output);
            }
            catch (Exception exception)
            {
                return $"{{\"ok\":false,\"errors\":[\"{Escape(exception.Message)}\"]}}";
            }
        }

        public static string ConfirmationMessage(string operation, bool stop)
        {
            if (stop)
                return "Stop the HTTP MCP process owned by this project?";
            switch (operation)
            {
                case "serve":
                    return "Start a loopback-only HTTP MCP process owned by this Editor?";
                case "remove":
                    return "Remove only registrations and skills managed by com.unigame.unitycli.mcp? A backup will be created first.";
                case "rollback":
                    return "Restore the files captured by the last setup backup?";
                default:
                    return "Apply the previewed project-pinned registrations, server bundle, and selected skill copies? Existing files are backed up first.";
            }
        }

        public static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value))
                return string.Empty;
            return value
                .Replace(Environment.GetEnvironmentVariable("UNITY_ACCESS_TOKEN") ?? "\0", "[REDACTED]")
                .Replace(Environment.GetEnvironmentVariable("UNITY_SERIAL") ?? "\0", "[REDACTED]");
        }

        private static string Escape(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", string.Empty)
                .Replace("\n", "\\n");
        }
    }

    [InitializeOnLoad]
    internal static class UnityCliHttpLifetime
    {
        static UnityCliHttpLifetime()
        {
            EditorApplication.quitting += StopOwnedHttp;
        }

        private static void StopOwnedHttp()
        {
            var package = UnityCliSetupBridge.FindPackage(UnityCliSetupWindow.PackageName);
            var node = UnityCliSetupBridge.ResolveExecutable(
                "NODE_PATH",
                Application.platform == RuntimePlatform.WindowsEditor ? "node.exe" : "node",
                Array.Empty<string>());
            var setup = UnityCliSetupBridge.ResolveSetupPath(package?.resolvedPath);
            if (string.IsNullOrEmpty(node) || string.IsNullOrEmpty(setup))
                return;
            var request =
                "{\"operation\":\"serve\",\"projectPath\":\"" +
                Escape(UnityCliSetupBridge.ProjectPath()) +
                "\",\"packageRoot\":\"" +
                Escape(package.resolvedPath) +
                "\",\"confirm\":true,\"stop\":true}";
            UnityCliSetupBridge.Execute(node, setup, request);
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
