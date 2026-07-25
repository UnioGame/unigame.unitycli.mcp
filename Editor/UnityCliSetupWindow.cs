using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;
using Debug = UnityEngine.Debug;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace UniGame.UnityCli.Editor
{
    /// <summary>
    /// Configures project-pinned Unity CLI MCP integrations without changing
    /// the system until the user previews and confirms an operation.
    /// </summary>
    public sealed class UnityCliSetupWindow : EditorWindow
    {
        private const string PackageName = "com.unigame.unitycli.mcp";
        private const string PipelinePackageName = "com.unity.pipeline";
        private const string ExpectedCliVersion = "1.0.0-beta.2";
        private static readonly string[] Pages =
        {
            "Overview",
            "Agents",
            "Server",
            "Skill",
            "Diagnostics",
        };

        private readonly Dictionary<string, bool> _agents = new Dictionary<string, bool>
        {
            { "codex", true },
            { "cursor", true },
            { "vscode", true },
            { "cline", true },
            { "claude-code", true },
            { "claude-desktop", true },
        };

        private Vector2 _scroll;
        private int _page;
        private bool _busy;
        private bool _force;
        private bool _installSkill = true;
        private bool _useHttp;
        private int _httpPort;
        private string _cliPath = string.Empty;
        private string _cliVersion = string.Empty;
        private string _nodePath = string.Empty;
        private string _nodeVersion = string.Empty;
        private string _pipelineVersion = string.Empty;
        private string _packagePath = string.Empty;
        private string _setupPath = string.Empty;
        private string _lastRequest = string.Empty;
        private string _lastResponse = string.Empty;
        private string _lastBackup = string.Empty;

        [MenuItem("UniGame/Unity CLI MCP")]
        private static void Open()
        {
            var window = GetWindow<UnityCliSetupWindow>();
            window.titleContent = new GUIContent("Unity CLI MCP");
            window.minSize = new Vector2(760f, 620f);
            window.Show();
        }

        private void OnEnable()
        {
            RefreshStatus();
            RunOperation("probe", false);
        }

        private void OnGUI()
        {
            DrawHeader();
            _page = GUILayout.Toolbar(_page, Pages, GUILayout.Height(26f));
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            EditorGUILayout.Space(8f);
            switch (_page)
            {
                case 0:
                    DrawOverview();
                    break;
                case 1:
                    DrawAgents();
                    break;
                case 2:
                    DrawServer();
                    break;
                case 3:
                    DrawSkill();
                    break;
                default:
                    DrawDiagnostics();
                    break;
            }

            EditorGUILayout.EndScrollView();
            DrawActions();
        }

        private void DrawHeader()
        {
            EditorGUILayout.Space(8f);
            EditorGUILayout.LabelField("UniGame Unity CLI MCP Control Center", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Project-pinned setup. Preview is read-only; Apply, Repair, Remove, Pipeline installation, and HTTP startup always require confirmation.",
                MessageType.Info);
        }

        private void DrawOverview()
        {
            DrawStatus("Unity CLI", _cliPath, _cliVersion);
            DrawStatus("Node.js", _nodePath, _nodeVersion);
            DrawStatus("Unity Pipeline", PipelinePackageName, _pipelineVersion);
            DrawStatus("Setup manager", _setupPath, File.Exists(_setupPath) ? "ready" : "missing");
            if (!string.IsNullOrEmpty(_cliVersion) &&
                !string.Equals(_cliVersion, ExpectedCliVersion, StringComparison.Ordinal))
            {
                EditorGUILayout.HelpBox(
                    $"Catalogs target Unity CLI {ExpectedCliVersion}; {_cliVersion} is installed. Runtime discovery remains enabled.",
                    MessageType.Warning);
            }

            if (string.IsNullOrEmpty(_pipelineVersion))
            {
                EditorGUILayout.HelpBox(
                    "Pipeline is required for running Editor and Development Player tools.",
                    MessageType.Warning);
                if (GUILayout.Button("Install Pipeline 0.4.0-exp.1…", GUILayout.Height(28f)))
                    InstallPipeline();
            }
        }

        private void DrawAgents()
        {
            EditorGUILayout.LabelField("First-line agent support", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Registrations are stored in private user configuration and use a stable project-specific name. Repository MCP files are not changed.",
                MessageType.None);
            DrawAgentToggle("codex", "Codex");
            DrawAgentToggle("cursor", "Cursor");
            DrawAgentToggle("vscode", "VS Code / GitHub Copilot");
            DrawAgentToggle("cline", "Cline");
            DrawAgentToggle("claude-code", "Claude Code");
            DrawAgentToggle("claude-desktop", "Claude Desktop DXT export");
        }

        private void DrawServer()
        {
            EditorGUILayout.LabelField("Transport", EditorStyles.boldLabel);
            _useHttp = EditorGUILayout.ToggleLeft(
                "Optional loopback Streamable HTTP (stdio is recommended)",
                _useHttp);
            using (new EditorGUI.DisabledScope(!_useHttp))
                _httpPort = EditorGUILayout.IntField("Port (0 = automatic)", _httpPort);

            EditorGUILayout.HelpBox(
                _useHttp
                    ? "HTTP binds to 127.0.0.1, uses a protected capability file, and stops when this Editor process exits."
                    : "Each agent starts its own project-pinned stdio process.",
                MessageType.None);
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!_useHttp || _busy))
                {
                    if (GUILayout.Button("Start HTTP…", GUILayout.Height(28f)))
                        RunOperation("serve", true);
                    if (GUILayout.Button("Stop HTTP", GUILayout.Height(28f)))
                        RunOperation("serve", true, true);
                }

                if (GUILayout.Button("Health", GUILayout.Height(28f)))
                    RunOperation("health", false);
            }
        }

        private void DrawSkill()
        {
            _installSkill = EditorGUILayout.ToggleLeft(
                "Manage project-local operate-unity-cli skill",
                _installSkill);
            EditorGUILayout.HelpBox(
                "Canonical: .agents/skills/operate-unity-cli\nMirrors: .cline/skills and .claude/skills\nManaged manifests prevent silent replacement of user-owned copies.",
                MessageType.None);
            if (GUILayout.Button("Reveal packaged skill", GUILayout.Height(28f)))
            {
                var path = Path.Combine(_packagePath, "skills", "operate-unity-cli");
                if (Directory.Exists(path))
                    EditorUtility.RevealInFinder(path);
            }
        }

        private void DrawDiagnostics()
        {
            _force = EditorGUILayout.ToggleLeft(
                "Allow replacing a conflicting same-name managed target",
                _force);
            if (_force)
            {
                EditorGUILayout.HelpBox(
                    "Force is applied only after confirmation. Review Preview and the existing user-owned entry first.",
                    MessageType.Warning);
            }

            EditorGUILayout.LabelField("Last setup-manager exchange", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("Request", EditorStyles.miniBoldLabel);
            EditorGUILayout.TextArea(_lastRequest, GUILayout.MinHeight(90f));
            EditorGUILayout.LabelField("Response", EditorStyles.miniBoldLabel);
            EditorGUILayout.TextArea(_lastResponse, GUILayout.MinHeight(240f));
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Refresh probe", GUILayout.Height(28f)))
                {
                    RefreshStatus();
                    RunOperation("probe", false);
                }

                if (GUILayout.Button("Copy diagnostics", GUILayout.Height(28f)))
                    EditorGUIUtility.systemCopyBuffer = UnityCliSetupBridge.Sanitize(_lastResponse);
            }
        }

        private void DrawActions()
        {
            EditorGUILayout.Space(4f);
            using (new EditorGUI.DisabledScope(_busy || !File.Exists(_setupPath)))
            using (new EditorGUILayout.HorizontalScope(EditorStyles.toolbar))
            {
                if (GUILayout.Button("Preview", EditorStyles.toolbarButton))
                    RunOperation("plan", false);
                if (GUILayout.Button("Apply…", EditorStyles.toolbarButton))
                    RunOperation("apply", true);
                if (GUILayout.Button("Repair…", EditorStyles.toolbarButton))
                    RunOperation("repair", true);
                if (GUILayout.Button("Remove…", EditorStyles.toolbarButton))
                    RunOperation("remove", true);
                using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(_lastBackup)))
                {
                    if (GUILayout.Button("Rollback…", EditorStyles.toolbarButton))
                        RunOperation("rollback", true);
                }
            }
        }

        private void DrawAgentToggle(string key, string label)
        {
            _agents[key] = EditorGUILayout.ToggleLeft(label, _agents[key]);
        }

        private async void RunOperation(string operation, bool confirmation, bool stop = false)
        {
            if (_busy)
                return;
            if (confirmation && !EditorUtility.DisplayDialog(
                    "Confirm Unity CLI MCP change",
                    UnityCliSetupBridge.ConfirmationMessage(operation, stop),
                    operation == "remove" ? "Remove managed data" : "Continue",
                    "Cancel"))
                return;

            var request = new SetupRequest
            {
                operation = operation,
                projectPath = UnityCliSetupBridge.ProjectPath(),
                packageRoot = _packagePath,
                agents = _agents.Where(pair => pair.Value).Select(pair => pair.Key).ToArray(),
                transport = _useHttp ? "http" : "stdio",
                confirm = confirmation,
                force = _force,
                installServer = true,
                installSkill = _installSkill,
                port = Math.Max(0, _httpPort),
                ownerPid = Process.GetCurrentProcess().Id,
                backupId = _lastBackup,
                stop = stop,
            };
            _lastRequest = JsonUtility.ToJson(request, true);
            _busy = true;
            Repaint();
            var result = await Task.Run(() =>
                UnityCliSetupBridge.Execute(_nodePath, _setupPath, _lastRequest));
            _lastResponse = result;
            var response = JsonUtility.FromJson<SetupResponse>(result);
            if (response != null && !string.IsNullOrEmpty(response.backup))
                _lastBackup = response.backup;
            _busy = false;
            Repaint();
            if (response == null || !response.ok)
                ShowNotification(new GUIContent("Operation failed — see Diagnostics"));
            else
                ShowNotification(new GUIContent($"{operation} completed"));
        }

        private void InstallPipeline()
        {
            if (!EditorUtility.DisplayDialog(
                    "Install Unity Pipeline",
                    "Add com.unity.pipeline@0.4.0-exp.1 to this Unity project? This changes the project package manifest and triggers compilation.",
                    "Install",
                    "Cancel"))
                return;
            Client.Add("com.unity.pipeline@0.4.0-exp.1");
            ShowNotification(new GUIContent("Pipeline installation requested"));
        }

        private void RefreshStatus()
        {
            _cliPath = UnityCliSetupBridge.ResolveExecutable(
                "UNITY_CLI_PATH",
                Application.platform == RuntimePlatform.WindowsEditor ? "unity.exe" : "unity",
                UnityCliSetupBridge.DefaultCliPaths());
            _cliVersion = UnityCliSetupBridge.RunVersion(_cliPath, "--version");
            _nodePath = UnityCliSetupBridge.ResolveExecutable(
                "NODE_PATH",
                Application.platform == RuntimePlatform.WindowsEditor ? "node.exe" : "node",
                Array.Empty<string>());
            _nodeVersion = UnityCliSetupBridge.RunVersion(_nodePath, "--version");
            var pipeline = UnityCliSetupBridge.FindPackage(PipelinePackageName);
            _pipelineVersion = pipeline?.version ?? string.Empty;
            var toolkit = UnityCliSetupBridge.FindPackage(PackageName);
            _packagePath = toolkit?.resolvedPath ?? string.Empty;
            _setupPath = UnityCliSetupBridge.ResolveSetupPath(_packagePath);
            Repaint();
        }

        private static void DrawStatus(string label, string location, string version)
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField(label, EditorStyles.boldLabel);
                EditorGUILayout.SelectableLabel(
                    string.IsNullOrEmpty(location) ? "not found" : location,
                    EditorStyles.textField,
                    GUILayout.Height(EditorGUIUtility.singleLineHeight));
                EditorGUILayout.LabelField(
                    "Status",
                    string.IsNullOrEmpty(version) ? "unavailable" : version);
            }
        }

        [Serializable]
        private sealed class SetupRequest
        {
            public string operation;
            public string projectPath;
            public string packageRoot;
            public string[] agents;
            public string transport;
            public bool confirm;
            public bool force;
            public bool installServer;
            public bool installSkill;
            public int port;
            public int ownerPid;
            public string backupId;
            public bool stop;
        }

        [Serializable]
        private sealed class SetupResponse
        {
            public bool ok = false;
            public string backup = string.Empty;
        }
    }

    /// <summary>
    /// Provides deterministic environment discovery and setup-manager process
    /// communication for the Unity CLI Control Center and its Editor tests.
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
            var package = UnityCliSetupBridge.FindPackage("com.unigame.unitycli.mcp");
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
