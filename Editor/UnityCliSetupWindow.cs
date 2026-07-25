using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEditor.UIElements;
using UnityEngine;
using UnityEngine.UIElements;

namespace UniGame.UnityCli.Editor
{
    /// <summary>
    /// Provides a guided UI Toolkit workflow for project-pinned Unity CLI MCP setup.
    /// </summary>
    public sealed class UnityCliSetupWindow : EditorWindow
    {
        internal const string PackageName = "com.unigame.unitycli.mcp";
        internal const string WindowUxmlPath =
            "Packages/com.unigame.unitycli.mcp/Editor/UI/UnityCliSetupWindow.uxml";
        internal const string WindowUssPath =
            "Packages/com.unigame.unitycli.mcp/Editor/UI/UnityCliSetupWindow.uss";

        private const string PipelinePackageName = "com.unity.pipeline";
        private const string ExpectedCliVersion = "1.0.0-beta.2";
        private const string ExpectedPipelineVersion = "0.4.0-exp.1";

        private static readonly (string id, string label)[] AgentDefinitions =
        {
            ("codex", "Codex"),
            ("cursor", "Cursor"),
            ("vscode", "VS Code / GitHub Copilot"),
            ("cline", "Cline"),
            ("claude-code", "Claude Code"),
            ("claude-desktop", "Claude Desktop"),
        };

        private readonly UnityCliSetupPresenter _presenter = new UnityCliSetupPresenter();
        private readonly Dictionary<string, Toggle> _agentToggles =
            new Dictionary<string, Toggle>(StringComparer.Ordinal);
        private readonly Dictionary<string, Label> _agentDetections =
            new Dictionary<string, Label>(StringComparer.Ordinal);
        private readonly Dictionary<string, Label> _agentToggleValues =
            new Dictionary<string, Label>(StringComparer.Ordinal);
        private readonly Dictionary<string, Label> _agentIntegrations =
            new Dictionary<string, Label>(StringComparer.Ordinal);

        private string _cliPath = string.Empty;
        private string _cliVersion = string.Empty;
        private string _nodePath = string.Empty;
        private string _nodeVersion = string.Empty;
        private string _pipelineVersion = string.Empty;
        private string _packagePath = string.Empty;
        private string _setupPath = string.Empty;
        private string _lastRequest = string.Empty;
        private string _lastResponse = string.Empty;
        private string _installDiagnostics = string.Empty;
        private UnityCliSetupResponse _probe;
        private CancellationTokenSource _installerCancellation;
        private AddRequest _pipelineRequest;

        private Label _pageStatus;
        private Button _refreshButton;
        private VisualElement _agentsContainer;
        private Toggle _installSkillToggle;
        private Button _reviewButton;
        private VisualElement _previewPanel;
        private VisualElement _changesContainer;
        private VisualElement _warningsContainer;
        private Toggle _forceToggle;
        private Button _applyButton;
        private VisualElement _resultPanel;
        private Label _resultTitle;
        private Label _resultDetails;
        private VisualElement _restartContainer;
        private Foldout _advancedFoldout;
        private Toggle _httpToggle;
        private IntegerField _httpPortField;
        private Label _httpStatus;
        private Button _httpActionButton;
        private Button _removeButton;
        private Button _rollbackButton;
        private VisualElement _diagnosticsPanel;
        private TextField _diagnosticsField;
        private Button _installCliButton;
        private Button _copyCliCommandButton;
        private Button _installPipelineButton;

        [MenuItem("UniGame/Unity CLI MCP")]
        private static void Open()
        {
            var window = GetWindow<UnityCliSetupWindow>();
            window.titleContent = new GUIContent("Unity CLI MCP");
            window.minSize = new Vector2(720f, 620f);
            window.Show();
        }

        public void CreateGUI()
        {
            rootVisualElement.Clear();
            var layout = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(WindowUxmlPath);
            var style = AssetDatabase.LoadAssetAtPath<StyleSheet>(WindowUssPath);
            if (layout == null)
            {
                rootVisualElement.Add(new HelpBox(
                    $"Could not load UI Toolkit layout: {WindowUxmlPath}",
                    HelpBoxMessageType.Error));
                return;
            }

            layout.CloneTree(rootVisualElement);
            if (style != null)
                rootVisualElement.styleSheets.Add(style);

            CacheElements();
            BindEvents();
            BuildAgentChoices();
            LoadPreferences();
            RefreshLocalStatus();
            Render();
            rootVisualElement.schedule.Execute(RefreshAndProbe).ExecuteLater(1);
        }

        private void OnDisable()
        {
            _installerCancellation?.Cancel();
            _installerCancellation?.Dispose();
            _installerCancellation = null;
            EditorApplication.update -= PollPipelineInstall;
        }

        private void CacheElements()
        {
            _pageStatus = rootVisualElement.Q<Label>("page-status");
            _refreshButton = rootVisualElement.Q<Button>("refresh-status");
            _agentsContainer = rootVisualElement.Q<VisualElement>("agents-container");
            _installSkillToggle = rootVisualElement.Q<Toggle>("install-skill");
            _reviewButton = rootVisualElement.Q<Button>("review-configuration");
            _previewPanel = rootVisualElement.Q<VisualElement>("preview-panel");
            _changesContainer = rootVisualElement.Q<VisualElement>("changes-container");
            _warningsContainer = rootVisualElement.Q<VisualElement>("warnings-container");
            _forceToggle = rootVisualElement.Q<Toggle>("force-conflicts");
            _applyButton = rootVisualElement.Q<Button>("apply-configuration");
            _resultPanel = rootVisualElement.Q<VisualElement>("result-panel");
            _resultTitle = rootVisualElement.Q<Label>("result-title");
            _resultDetails = rootVisualElement.Q<Label>("result-details");
            _restartContainer = rootVisualElement.Q<VisualElement>("restart-container");
            _advancedFoldout = rootVisualElement.Q<Foldout>("advanced-foldout");
            _httpToggle = rootVisualElement.Q<Toggle>("http-transport");
            _httpPortField = rootVisualElement.Q<IntegerField>("http-port");
            _httpStatus = rootVisualElement.Q<Label>("http-status");
            _httpActionButton = rootVisualElement.Q<Button>("http-action");
            _removeButton = rootVisualElement.Q<Button>("remove-configuration");
            _rollbackButton = rootVisualElement.Q<Button>("rollback-configuration");
            _diagnosticsPanel = rootVisualElement.Q<VisualElement>("diagnostics-panel");
            _diagnosticsField = rootVisualElement.Q<TextField>("diagnostics");
            _installCliButton = rootVisualElement.Q<Button>("install-cli");
            _copyCliCommandButton = rootVisualElement.Q<Button>("copy-cli-command");
            _installPipelineButton = rootVisualElement.Q<Button>("install-pipeline");
        }

        private void BindEvents()
        {
            _refreshButton.clicked += RefreshAndProbe;
            _reviewButton.clicked += () => RunOperation("plan", false);
            _applyButton.clicked += () => RunOperation("apply", true);
            _removeButton.clicked += () => RunOperation("remove", true);
            _rollbackButton.clicked += () => RunOperation("rollback", true);
            _httpActionButton.clicked += ToggleHttp;
            _installCliButton.clicked += InstallUnityCli;
            _copyCliCommandButton.clicked += CopyUnityCliCommand;
            _installPipelineButton.clicked += InstallPipeline;
            rootVisualElement.Q<Button>("open-cli-docs").clicked +=
                () => Application.OpenURL("https://docs.unity.com/en-us/unity-cli/unity-cli");
            rootVisualElement.Q<Button>("open-node-docs").clicked +=
                () => Application.OpenURL("https://nodejs.org/en/download");
            rootVisualElement.Q<Button>("copy-diagnostics").clicked +=
                () => EditorGUIUtility.systemCopyBuffer =
                    UnityCliSetupBridge.Sanitize(BuildDiagnostics());

            _installSkillToggle.RegisterValueChangedCallback(evt =>
            {
                _presenter.InstallSkill = evt.newValue;
                SavePreferences();
                ConfigurationChanged();
            });
            _httpToggle.RegisterValueChangedCallback(evt =>
            {
                _presenter.UseHttp = evt.newValue;
                SavePreferences();
                ConfigurationChanged();
            });
            _httpPortField.RegisterValueChangedCallback(evt =>
            {
                _presenter.HttpPort = Math.Max(0, evt.newValue);
                SavePreferences();
                ConfigurationChanged();
            });
            _forceToggle.RegisterValueChangedCallback(evt =>
            {
                _presenter.Force = evt.newValue;
                Render();
            });
            _advancedFoldout.RegisterValueChangedCallback(evt =>
            {
                _diagnosticsPanel.style.display =
                    evt.newValue ? DisplayStyle.Flex : DisplayStyle.None;
            });
        }

        private void BuildAgentChoices()
        {
            _agentsContainer.Clear();
            _agentToggles.Clear();
            _agentDetections.Clear();
            _agentToggleValues.Clear();
            _agentIntegrations.Clear();
            foreach (var definition in AgentDefinitions)
            {
                var row = new VisualElement();
                row.AddToClassList("agent-row");
                var name = new Label(definition.label);
                name.AddToClassList("agent-name");
                var controls = new VisualElement();
                controls.AddToClassList("agent-controls");
                var detection = new Label("Missing");
                detection.AddToClassList("agent-detection");
                var toggle = new Toggle("MCP");
                toggle.AddToClassList("agent-toggle");
                toggle.RegisterValueChangedCallback(evt =>
                {
                    _presenter.SetAgentSelected(definition.id, evt.newValue);
                    SavePreferences();
                    ConfigurationChanged();
                });
                var value = new Label("Off");
                value.AddToClassList("agent-toggle-value");
                var integration = new Label("Off");
                integration.AddToClassList("agent-integration");
                controls.Add(detection);
                controls.Add(toggle);
                controls.Add(value);
                controls.Add(integration);
                row.Add(name);
                row.Add(controls);
                _agentsContainer.Add(row);
                _agentToggles[definition.id] = toggle;
                _agentDetections[definition.id] = detection;
                _agentToggleValues[definition.id] = value;
                _agentIntegrations[definition.id] = integration;
            }
        }

        private void LoadPreferences()
        {
            _presenter.InstallSkill = EditorPrefs.GetBool(PrefKey("skill"), true);
            _presenter.UseHttp = EditorPrefs.GetBool(PrefKey("http"), false);
            _presenter.HttpPort = EditorPrefs.GetInt(PrefKey("port"), 0);
            var selectionExists = EditorPrefs.HasKey(PrefKey("agents"));
            var saved = EditorPrefs.GetString(PrefKey("agents"), string.Empty)
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            _presenter.InitializeAgents(Array.Empty<UnityCliAgentStatus>(), selectionExists, saved);

            _installSkillToggle.SetValueWithoutNotify(_presenter.InstallSkill);
            _httpToggle.SetValueWithoutNotify(_presenter.UseHttp);
            _httpPortField.SetValueWithoutNotify(_presenter.HttpPort);
            SyncAgentToggles();
        }

        private void SavePreferences()
        {
            EditorPrefs.SetString(
                PrefKey("agents"),
                string.Join(",", _presenter.SelectedAgents.OrderBy(id => id)));
            EditorPrefs.SetBool(PrefKey("skill"), _presenter.InstallSkill);
            EditorPrefs.SetBool(PrefKey("http"), _presenter.UseHttp);
            EditorPrefs.SetInt(PrefKey("port"), _presenter.HttpPort);
        }

        private static string PrefKey(string suffix)
        {
            var project = UnityCliSetupBridge.ProjectPath().Replace('\\', '/').ToLowerInvariant();
            return $"{PackageName}.{Hash128.Compute(project)}.{suffix}";
        }

        private void ConfigurationChanged()
        {
            _presenter.InvalidatePreview();
            _previewPanel.style.display = DisplayStyle.None;
            _resultPanel.style.display = DisplayStyle.None;
            Render();
        }

        private void RefreshAndProbe()
        {
            if (_presenter.Busy)
                return;
            RefreshLocalStatus();
            if (!File.Exists(_nodePath) || !File.Exists(_setupPath))
            {
                _lastResponse =
                    "{\"ok\":false,\"operation\":\"probe\",\"errors\":[\"Node or setup manager is missing\"]}";
                _presenter.AcceptResponse(UnityCliSetupResponse.Parse(_lastResponse));
                ShowFailure("Environment probe could not start.");
                Render();
                return;
            }

            RunOperation("probe", false);
        }

        private async void RunOperation(string operation, bool confirmation, bool stop = false)
        {
            if (_presenter.Busy)
                return;
            if (confirmation && !EditorUtility.DisplayDialog(
                    "Confirm Unity CLI MCP change",
                    UnityCliSetupBridge.ConfirmationMessage(operation, stop),
                    operation == "remove" ? "Remove managed data" : "Continue",
                    "Cancel"))
                return;

            var request = new UnityCliSetupRequest
            {
                operation = operation,
                projectPath = UnityCliSetupBridge.ProjectPath(),
                packageRoot = _packagePath,
                agents = string.Equals(operation, "remove", StringComparison.Ordinal)
                    ? UnityCliSetupPresenter.SupportedAgentIds
                    : _presenter.SelectedAgents.OrderBy(id => id).ToArray(),
                disabledAgents = string.Equals(operation, "remove", StringComparison.Ordinal)
                    ? Array.Empty<string>()
                    : _presenter.DisabledAgents.OrderBy(id => id).ToArray(),
                transport = _presenter.UseHttp ? "http" : "stdio",
                confirm = confirmation,
                force = _presenter.ForceVisible && _presenter.Force,
                installServer = true,
                installSkill = _presenter.InstallSkill,
                port = Math.Max(0, _presenter.HttpPort),
                ownerPid = Process.GetCurrentProcess().Id,
                backupId = _presenter.LastBackup,
                stop = stop,
            };
            _lastRequest = JsonUtility.ToJson(request, true);
            SetBusy(true, OperationLabel(operation));
            var result = await Task.Run(() =>
                UnityCliSetupBridge.Execute(_nodePath, _setupPath, _lastRequest));
            _lastResponse = result;
            var response = UnityCliSetupResponse.Parse(result);
            _presenter.AcceptResponse(response);
            SetBusy(false, string.Empty);

            if (response == null || !response.ok)
            {
                ShowFailure(response == null
                    ? "The setup manager returned invalid JSON."
                    : string.Join("\n", response.errors ?? Array.Empty<string>()));
                return;
            }

            if (string.Equals(operation, "probe", StringComparison.Ordinal))
            {
                ApplyProbe(response);
                Render();
                return;
            }

            if (string.Equals(operation, "plan", StringComparison.Ordinal))
            {
                ShowPreview(response);
                return;
            }

            ShowSuccess(response, operation);
        }

        private void ApplyProbe(UnityCliSetupResponse response)
        {
            _probe = response;
            var selectionExists = EditorPrefs.HasKey(PrefKey("agents"));
            if (!selectionExists)
            {
                _presenter.InitializeAgents(
                    response.data?.agents,
                    false,
                    Array.Empty<string>());
                SavePreferences();
            }
            else
            {
                _presenter.UpdateAgentStatuses(response.data?.agents);
                SavePreferences();
            }

            SyncAgentToggles();
            RenderAgentStates();
            if (response.data?.http != null && response.data.http.port > 0)
                _presenter.HttpPort = response.data.http.port;
        }

        private void ShowPreview(UnityCliSetupResponse response)
        {
            _changesContainer.Clear();
            foreach (var change in response.changes ?? Array.Empty<UnityCliPlannedChange>())
            {
                var row = new VisualElement();
                row.AddToClassList("change-row");
                var kind = new Label((change.kind ?? "change").ToUpperInvariant());
                kind.AddToClassList("change-kind");
                kind.AddToClassList($"change-{change.kind ?? "none"}");
                var description = new Label($"{change.summary}\n{change.target}");
                description.AddToClassList("change-description");
                row.Add(kind);
                row.Add(description);
                _changesContainer.Add(row);
            }

            _warningsContainer.Clear();
            foreach (var warning in response.warnings ?? Array.Empty<string>())
                _warningsContainer.Add(CreateNotice(warning, "notice-warning"));
            _warningsContainer.style.display =
                response.warnings?.Length > 0 ? DisplayStyle.Flex : DisplayStyle.None;
            _forceToggle.style.display =
                _presenter.ForceVisible ? DisplayStyle.Flex : DisplayStyle.None;
            _forceToggle.SetValueWithoutNotify(_presenter.Force);
            _previewPanel.style.display = DisplayStyle.Flex;
            _resultPanel.style.display = DisplayStyle.None;
            Render();
        }

        private void ShowSuccess(UnityCliSetupResponse response, string operation)
        {
            _probe = response;
            _resultPanel.RemoveFromClassList("result-error");
            _resultPanel.AddToClassList("result-success");
            _resultTitle.text = operation == "apply"
                ? "Configuration is ready"
                : $"{OperationLabel(operation)} completed";
            _resultDetails.text = response.changes?.Length > 0
                ? $"{response.changes.Length} managed change(s) completed."
                : "The managed state is healthy.";
            _restartContainer.Clear();
            var restarts = response.restartRequired ?? Array.Empty<string>();
            if (restarts.Length == 0)
                _restartContainer.Add(new Label("No client restart reported."));
            else
            {
                _restartContainer.Add(new Label("Restart required:"));
                foreach (var client in restarts)
                    _restartContainer.Add(new Label($"• {client}"));
            }

            _previewPanel.style.display = DisplayStyle.None;
            _resultPanel.style.display = DisplayStyle.Flex;
            Render();
            rootVisualElement.schedule.Execute(RefreshAndProbe).ExecuteLater(250);
        }

        private void ShowFailure(string message)
        {
            _resultPanel.RemoveFromClassList("result-success");
            _resultPanel.AddToClassList("result-error");
            _resultTitle.text = "Configuration failed";
            _resultDetails.text = string.IsNullOrWhiteSpace(message)
                ? "See sanitized diagnostics below."
                : message;
            _restartContainer.Clear();
            _previewPanel.style.display = DisplayStyle.None;
            _resultPanel.style.display = DisplayStyle.Flex;
            _advancedFoldout.value = true;
            _diagnosticsPanel.style.display = DisplayStyle.Flex;
            _diagnosticsField.value = BuildDiagnostics();
            Render();
        }

        private void ToggleHttp()
        {
            var running = IsHttpRunning();
            RunOperation("serve", true, running);
        }

        private void InstallPipeline()
        {
            if (!EditorUtility.DisplayDialog(
                    "Install Unity Pipeline",
                    $"Add {PipelinePackageName}@{ExpectedPipelineVersion} to this Unity project? " +
                    "This changes the package manifest and triggers compilation.",
                    "Install",
                    "Cancel"))
                return;
            SetBusy(true, "Installing Pipeline");
            _pipelineRequest = Client.Add($"{PipelinePackageName}@{ExpectedPipelineVersion}");
            EditorApplication.update -= PollPipelineInstall;
            EditorApplication.update += PollPipelineInstall;
        }

        private void PollPipelineInstall()
        {
            if (_pipelineRequest == null || !_pipelineRequest.IsCompleted)
                return;
            EditorApplication.update -= PollPipelineInstall;
            var failed = _pipelineRequest.Status == StatusCode.Failure;
            _installDiagnostics = failed
                ? UnityCliSetupBridge.Sanitize(_pipelineRequest.Error?.message ?? "Install failed")
                : string.Empty;
            _pipelineRequest = null;
            SetBusy(false, string.Empty);
            if (failed)
                ShowInstallFailure();
            else
                RefreshAndProbe();
        }

        private async void InstallUnityCli()
        {
            if (_presenter.Busy)
                return;
            var spec = UnityCliPlatformInstaller.ForPlatform(Application.platform);
            if (!EditorUtility.DisplayDialog(
                    "Install Unity CLI",
                    $"Platform: {spec.Platform}\nChannel: beta\n\n{spec.Url}",
                    "Install",
                    "Cancel"))
                return;

            _installerCancellation?.Cancel();
            _installerCancellation?.Dispose();
            _installerCancellation = new CancellationTokenSource();
            SetBusy(true, "Installing CLI");
            var result = await UnityCliPlatformInstaller.Install(
                spec,
                _installerCancellation.Token);
            if (this == null)
                return;
            SetBusy(false, string.Empty);
            _installDiagnostics = string.Join(
                "\n",
                new[] { result.Output, result.Error }.Where(value => !string.IsNullOrWhiteSpace(value)));
            RefreshLocalStatus();
            if (!result.Ok || string.IsNullOrEmpty(_cliVersion))
            {
                ShowInstallFailure();
                return;
            }

            _installDiagnostics = string.Empty;
            RefreshAndProbe();
        }

        private void CopyUnityCliCommand()
        {
            EditorGUIUtility.systemCopyBuffer =
                UnityCliPlatformInstaller.ForPlatform(Application.platform).Command;
            ShowNotification(new GUIContent("Command copied"));
        }

        private void ShowInstallFailure()
        {
            _resultPanel.RemoveFromClassList("result-success");
            _resultPanel.AddToClassList("result-error");
            _resultTitle.text = "Install failed";
            _resultDetails.text = "See Advanced.";
            _restartContainer.Clear();
            _resultPanel.style.display = DisplayStyle.Flex;
            _advancedFoldout.value = true;
            _diagnosticsPanel.style.display = DisplayStyle.Flex;
            Render();
        }

        private void RefreshLocalStatus()
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
            _pipelineVersion =
                UnityCliSetupBridge.FindPackage(PipelinePackageName)?.version ?? string.Empty;
            _packagePath =
                UnityCliSetupBridge.FindPackage(PackageName)?.resolvedPath ?? string.Empty;
            _setupPath = UnityCliSetupBridge.ResolveSetupPath(_packagePath);
            Render();
        }

        private void Render()
        {
            if (_pageStatus == null)
                return;

            RenderEnvironment();
            SyncAgentToggles();
            var canReview = _presenter.CanReview(
                _nodePath, _nodeVersion, _cliPath, _setupPath);
            _reviewButton.SetEnabled(canReview);
            _reviewButton.text = "Review";
            _applyButton.SetEnabled(_presenter.CanApply(
                _nodePath, _nodeVersion, _cliPath, _setupPath));
            _refreshButton.SetEnabled(!_presenter.Busy);
            _installSkillToggle.SetEnabled(!_presenter.Busy);
            _httpToggle.SetEnabled(!_presenter.Busy);
            _httpPortField.SetEnabled(!_presenter.Busy && _presenter.UseHttp);
            _httpPortField.style.display =
                _presenter.UseHttp ? DisplayStyle.Flex : DisplayStyle.None;
            foreach (var pair in _agentToggles)
                pair.Value.SetEnabled(
                    !_presenter.Busy && _presenter.CanToggleAgent(pair.Key));

            _forceToggle.style.display =
                _presenter.ForceVisible ? DisplayStyle.Flex : DisplayStyle.None;
            _removeButton.SetEnabled(!_presenter.Busy && HasManagedState());
            _rollbackButton.style.display = string.IsNullOrEmpty(_presenter.LastBackup)
                ? DisplayStyle.None
                : DisplayStyle.Flex;
            _rollbackButton.SetEnabled(!_presenter.Busy);
            _httpActionButton.text = IsHttpRunning() ? "Stop" : "Start";
            _httpActionButton.SetEnabled(!_presenter.Busy && _presenter.UseHttp);
            _httpStatus.text = IsHttpRunning()
                ? $"Running on 127.0.0.1:{_probe.data.http.port}"
                : "Stopped — stdio remains available.";
            RenderAgentStates();
            _diagnosticsField.value = BuildDiagnostics();
        }

        private void RenderEnvironment()
        {
            var cliState = string.IsNullOrEmpty(_cliVersion)
                ? UnityCliEnvironmentState.Missing
                : string.Equals(_cliVersion, ExpectedCliVersion, StringComparison.Ordinal)
                    ? UnityCliEnvironmentState.Ready
                    : UnityCliEnvironmentState.Warning;
            SetEnvironmentCard(
                "cli",
                cliState,
                string.IsNullOrEmpty(_cliVersion) ? "Missing" : _cliVersion,
                string.IsNullOrEmpty(_cliPath)
                    ? UnityCliPlatformInstaller.ForPlatform(Application.platform).Platform
                    : $"{UnityCliPlatformInstaller.ForPlatform(Application.platform).Platform} · {_cliPath}");
            _installCliButton.style.display =
                string.IsNullOrEmpty(_cliVersion) ? DisplayStyle.Flex : DisplayStyle.None;
            _installCliButton.SetEnabled(!_presenter.Busy);
            _copyCliCommandButton.style.display =
                string.IsNullOrEmpty(_cliVersion) && !string.IsNullOrEmpty(_installDiagnostics)
                    ? DisplayStyle.Flex
                    : DisplayStyle.None;

            var nodeState = string.IsNullOrEmpty(_nodeVersion)
                ? UnityCliEnvironmentState.Missing
                : UnityCliSetupPresenter.IsSupportedNode(_nodeVersion)
                    ? UnityCliEnvironmentState.Ready
                    : UnityCliEnvironmentState.Error;
            SetEnvironmentCard(
                "node",
                nodeState,
                string.IsNullOrEmpty(_nodeVersion) ? "Not found" : _nodeVersion,
                nodeState == UnityCliEnvironmentState.Error
                    ? "Node 20 or newer is required."
                    : string.IsNullOrEmpty(_nodePath) ? "Install Node 20+." : _nodePath);

            SetEnvironmentCard(
                "pipeline",
                string.IsNullOrEmpty(_pipelineVersion)
                    ? UnityCliEnvironmentState.Warning
                    : UnityCliEnvironmentState.Ready,
                string.IsNullOrEmpty(_pipelineVersion) ? "Missing" : _pipelineVersion,
                string.IsNullOrEmpty(_pipelineVersion)
                    ? "Required only for Editor and Development Player tools."
                    : "Editor integration is available.");
            _installPipelineButton.style.display =
                string.IsNullOrEmpty(_pipelineVersion) ? DisplayStyle.Flex : DisplayStyle.None;
            _installPipelineButton.SetEnabled(!_presenter.Busy);

            var setupReady = File.Exists(_setupPath);
            var serverReady = _probe?.data?.serverInstalled == true ||
                              _probe?.data?.serverExists == true;
            SetEnvironmentCard(
                "server",
                !setupReady
                    ? UnityCliEnvironmentState.Error
                    : serverReady
                        ? UnityCliEnvironmentState.Ready
                        : UnityCliEnvironmentState.Warning,
                !setupReady ? "Bundle missing" : serverReady ? "Installed" : "Ready to install",
                !setupReady
                    ? "Reinstall or repair the UPM package."
                    : serverReady
                        ? "Self-contained project-pinned server."
                        : "Installed during Apply.");
        }

        private void SetEnvironmentCard(
            string id,
            UnityCliEnvironmentState state,
            string status,
            string detail)
        {
            var card = rootVisualElement.Q<VisualElement>($"{id}-card");
            card.RemoveFromClassList("state-ready");
            card.RemoveFromClassList("state-missing");
            card.RemoveFromClassList("state-warning");
            card.RemoveFromClassList("state-error");
            card.AddToClassList($"state-{state.ToString().ToLowerInvariant()}");
            rootVisualElement.Q<Label>($"{id}-status").text = state.ToString();
            rootVisualElement.Q<Label>($"{id}-version").text = status;
            rootVisualElement.Q<Label>($"{id}-detail").text = detail;
        }

        private void RenderAgentStates()
        {
            foreach (var definition in AgentDefinitions)
            {
                var detection = _agentDetections[definition.id];
                var integration = _agentIntegrations[definition.id];
                detection.text = _presenter.AgentDetection(definition.id);
                detection.EnableInClassList(
                    "agent-found",
                    string.Equals(detection.text, "Found", StringComparison.Ordinal));
                _agentToggleValues[definition.id].text =
                    _presenter.AgentToggleValue(definition.id);
                integration.text = _presenter.AgentIntegration(definition.id);
                integration.EnableInClassList(
                    "agent-on",
                    string.Equals(integration.text, "On", StringComparison.Ordinal));
                integration.EnableInClassList(
                    "agent-pending",
                    integration.text.StartsWith("Pending", StringComparison.Ordinal));
                integration.EnableInClassList(
                    "agent-conflict",
                    string.Equals(integration.text, "Conflict", StringComparison.Ordinal));
            }
        }

        private void SyncAgentToggles()
        {
            foreach (var pair in _agentToggles)
                pair.Value.SetValueWithoutNotify(_presenter.IsAgentSelected(pair.Key));
        }

        private void SetBusy(bool busy, string operation)
        {
            _presenter.SetBusy(busy);
            rootVisualElement.EnableInClassList("is-busy", busy);
            _pageStatus.text = busy ? $"{operation}…" : "Ready";
            Render();
        }

        private bool HasManagedState()
        {
            return _probe?.data?.serverInstalled == true ||
                   _probe?.data?.serverExists == true ||
                   _probe?.data?.skillInstalled == true ||
                   _probe?.data?.agents?.Any(item => item.configured) == true ||
                   _probe?.data?.registrations?.Any(item => item.configured) == true;
        }

        private bool IsHttpRunning()
        {
            return _probe?.data?.http?.alive == true;
        }

        private string BuildDiagnostics()
        {
            var request = string.IsNullOrWhiteSpace(_lastRequest) ? "No request yet." : _lastRequest;
            var response = string.IsNullOrWhiteSpace(_lastResponse) ? "No response yet." : _lastResponse;
            var install = string.IsNullOrWhiteSpace(_installDiagnostics)
                ? "No install output."
                : _installDiagnostics;
            return UnityCliSetupBridge.Sanitize(
                $"Request\n{request}\n\nResponse\n{response}\n\nInstall\n{install}");
        }

        private static Label CreateNotice(string text, string className)
        {
            var label = new Label(text);
            label.AddToClassList("notice");
            label.AddToClassList(className);
            return label;
        }

        private static string OperationLabel(string operation)
        {
            switch (operation)
            {
                case "plan":
                    return "Reviewing configuration";
                case "apply":
                    return "Applying configuration";
                case "remove":
                    return "Removing managed configuration";
                case "rollback":
                    return "Rolling back";
                case "serve":
                    return "Updating HTTP server";
                default:
                    return "Checking environment";
            }
        }
    }
}
