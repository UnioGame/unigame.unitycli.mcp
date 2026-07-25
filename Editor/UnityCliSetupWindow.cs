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
    /// Provides the UI Toolkit control center for global MCP setup and live Editor publication.
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
        private Button _repairButton;
        private VisualElement _previewPanel;
        private Label _previewTitle;
        private VisualElement _changesContainer;
        private VisualElement _warningsContainer;
        private Toggle _forceToggle;
        private Button _applyButton;
        private VisualElement _resultPanel;
        private Label _resultTitle;
        private Label _resultDetails;
        private VisualElement _restartContainer;
        private Foldout _advancedFoldout;
        private IntegerField _httpPortField;
        private Label _httpStatus;
        private Button _httpActionButton;
        private VisualElement _serverLamp;
        private Label _serverPrimaryTitle;
        private Label _serverTransportValue;
        private Button _removeButton;
        private Button _rollbackButton;
        private VisualElement _diagnosticsPanel;
        private TextField _diagnosticsField;
        private Button _installCliButton;
        private Button _copyCliCommandButton;
        private Button _installPipelineButton;
        private Label _thisEditorState;
        private Label _thisProjectName;
        private Label _thisConnectionState;
        private Label _thisPipeline;
        private VisualElement _thisEditorNotices;
        private Label _activeEditorsCount;
        private VisualElement _activeEditorsContainer;
        private VisualElement _activeEditorsEmpty;
        private VisualElement _activeEditorsNotices;
        private Label _globalServerName;
        private Label _brokerPort;
        private Label _brokerLeaseCount;
        private Label _brokerState;
        private bool _repairPreviewRequested;

        [MenuItem("UniGame/Unity CLI MCP")]
        private static void Open()
        {
            var window = GetWindow<UnityCliSetupWindow>();
            window.titleContent = new GUIContent("Unity CLI MCP");
            window.minSize = new Vector2(560f, 620f);
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
            _repairButton = rootVisualElement.Q<Button>("repair-configuration");
            _previewPanel = rootVisualElement.Q<VisualElement>("preview-panel");
            _previewTitle = rootVisualElement.Q<Label>("preview-title");
            _changesContainer = rootVisualElement.Q<VisualElement>("changes-container");
            _warningsContainer = rootVisualElement.Q<VisualElement>("warnings-container");
            _forceToggle = rootVisualElement.Q<Toggle>("force-conflicts");
            _applyButton = rootVisualElement.Q<Button>("apply-configuration");
            _resultPanel = rootVisualElement.Q<VisualElement>("result-panel");
            _resultTitle = rootVisualElement.Q<Label>("result-title");
            _resultDetails = rootVisualElement.Q<Label>("result-details");
            _restartContainer = rootVisualElement.Q<VisualElement>("restart-container");
            _advancedFoldout = rootVisualElement.Q<Foldout>("advanced-foldout");
            _httpPortField = rootVisualElement.Q<IntegerField>("http-port");
            _httpStatus = rootVisualElement.Q<Label>("http-status");
            _httpActionButton = rootVisualElement.Q<Button>("http-action");
            _serverLamp = rootVisualElement.Q<VisualElement>("server-lamp");
            _serverPrimaryTitle = rootVisualElement.Q<Label>("server-primary-title");
            _serverTransportValue = rootVisualElement.Q<Label>("server-transport-value");
            _removeButton = rootVisualElement.Q<Button>("remove-configuration");
            _rollbackButton = rootVisualElement.Q<Button>("rollback-configuration");
            _diagnosticsPanel = rootVisualElement.Q<VisualElement>("diagnostics-panel");
            _diagnosticsField = rootVisualElement.Q<TextField>("diagnostics");
            _installCliButton = rootVisualElement.Q<Button>("install-cli");
            _copyCliCommandButton = rootVisualElement.Q<Button>("copy-cli-command");
            _installPipelineButton = rootVisualElement.Q<Button>("install-pipeline");
            _thisEditorState = rootVisualElement.Q<Label>("this-editor-state");
            _thisProjectName = rootVisualElement.Q<Label>("this-project-name");
            _thisConnectionState = rootVisualElement.Q<Label>("this-connection-state");
            _thisPipeline = rootVisualElement.Q<Label>("this-pipeline");
            _thisEditorNotices = rootVisualElement.Q<VisualElement>("this-editor-notices");
            _activeEditorsCount = rootVisualElement.Q<Label>("active-editors-count");
            _activeEditorsContainer =
                rootVisualElement.Q<VisualElement>("active-editors-container");
            _activeEditorsEmpty = rootVisualElement.Q<VisualElement>("active-editors-empty");
            _activeEditorsNotices =
                rootVisualElement.Q<VisualElement>("active-editors-notices");
            _globalServerName = rootVisualElement.Q<Label>("global-server-name");
            _brokerPort = rootVisualElement.Q<Label>("broker-port");
            _brokerLeaseCount = rootVisualElement.Q<Label>("broker-lease-count");
            _brokerState = rootVisualElement.Q<Label>("broker-state");
        }

        private void BindEvents()
        {
            _refreshButton.clicked += RefreshAndProbe;
            _reviewButton.clicked += () =>
            {
                _repairPreviewRequested = false;
                RunOperation(PreviewOperation(false), false);
            };
            _repairButton.clicked += () =>
            {
                _repairPreviewRequested = true;
                RunOperation(PreviewOperation(true), false);
            };
            _applyButton.clicked += () =>
                RunOperation(ApplyOperation(_repairPreviewRequested), true);
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
            _repairPreviewRequested = false;
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
            AcceptResponse(response, operation, confirmation);
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

            if (IsPreviewOperation(operation, confirmation))
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
            }
            else
            {
                _presenter.UpdateAgentStatuses(response.data?.agents);
            }

            SyncAgentToggles();
            RenderAgentStates();
            if (response.data?.http != null && response.data.http.port > 0)
                _presenter.HttpPort = response.data.http.port;
            if (response.data?.http?.alive == true)
                _presenter.UseHttp = true;
        }

        private void AcceptResponse(
            UnityCliSetupResponse response,
            string requestedOperation,
            bool confirmation)
        {
            if (response == null || !IsPreviewOperation(requestedOperation, confirmation))
            {
                _presenter.AcceptResponse(response);
                return;
            }

            var responseOperation = response.operation;
            response.operation = "plan";
            _presenter.AcceptResponse(response);
            response.operation = responseOperation;
        }

        internal static string PreviewOperation(bool repairRequested)
        {
            return repairRequested ? "repair" : "plan";
        }

        internal static string ApplyOperation(bool repairRequested)
        {
            return repairRequested ? "repair" : "apply";
        }

        internal static bool IsPreviewOperation(string operation, bool confirmation)
        {
            return !confirmation &&
                   (string.Equals(operation, "plan", StringComparison.Ordinal) ||
                    string.Equals(operation, "repair", StringComparison.Ordinal));
        }

        private void ShowPreview(UnityCliSetupResponse response)
        {
            _previewTitle.text = _repairPreviewRequested
                ? "Repair preview"
                : "Configuration preview";
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
            if (string.Equals(operation, "serve", StringComparison.Ordinal))
            {
                _presenter.UseHttp = response.data?.http?.alive == true;
                _presenter.InvalidatePreview();
                SavePreferences();
            }
            _resultPanel.RemoveFromClassList("result-error");
            _resultPanel.AddToClassList("result-success");
            _resultTitle.text = string.Equals(operation, "repair", StringComparison.Ordinal)
                ? "Repair completed"
                : operation == "apply"
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
            RenderDynamicArchitecture();
            SyncAgentToggles();
            var canReview = _presenter.CanReview(
                _nodePath, _nodeVersion, _cliPath, _setupPath);
            _reviewButton.SetEnabled(canReview);
            _reviewButton.text = "Preview changes";
            _repairButton.SetEnabled(canReview);
            _applyButton.text = _repairPreviewRequested
                ? "Repair from preview"
                : "Apply preview";
            _applyButton.SetEnabled(_presenter.CanApply(
                _nodePath, _nodeVersion, _cliPath, _setupPath));
            _refreshButton.SetEnabled(!_presenter.Busy);
            _installSkillToggle.SetEnabled(!_presenter.Busy);
            _httpPortField.SetEnabled(!_presenter.Busy && !IsHttpRunning());
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
            RenderServerControl();
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

        private void RenderDynamicArchitecture()
        {
            var data = _probe?.data;
            var registry = data?.registry;
            var editors = registry?.active_editors ?? Array.Empty<UnityCliEditorMetadata>();
            var currentPid = Process.GetCurrentProcess().Id;
            var current = editors.FirstOrDefault(editor => editor.editor_pid == currentPid);
            var staleCurrent = registry?.stale_editors?.FirstOrDefault(
                editor => editor.editor_pid == currentPid);
            current = current ?? staleCurrent;
            var connected = staleCurrent == null &&
                            (current != null || data?.editor?.connected == true);
            var connectionState = current?.connection_state ?? data?.editor?.status;

            _thisProjectName.text = ValueOr(
                current?.project_name,
                new DirectoryInfo(UnityCliSetupBridge.ProjectPath()).Name);
            _thisConnectionState.text = ValueOr(
                connectionState,
                connected ? "Published" : "Not published");
            _thisPipeline.text = !string.IsNullOrWhiteSpace(current?.pipeline_version)
                ? $"{current.pipeline_version} · published by this Editor"
                : string.IsNullOrWhiteSpace(_pipelineVersion)
                    ? "Unavailable · install Pipeline to publish Editor tools"
                    : $"{_pipelineVersion} · publication support available";

            var currentState = staleCurrent != null
                ? "Stale"
                : string.IsNullOrWhiteSpace(connectionState)
                    ? connected ? "Connected" : "No Editor"
                    : connectionState;
            SetStatusPill(_thisEditorState, currentState, StateClass(currentState, connected));
            _thisEditorNotices.Clear();
            if (staleCurrent != null)
                _thisEditorNotices.Add(CreateNotice(
                    $"This Editor publication is stale ({staleCurrent.stale_reason}); tools are excluded until it republishes.",
                    "notice-warning"));

            RenderActiveEditors(editors, registry);

            var leases = Math.Max(
                data?.live_lease_count ?? 0,
                data?.lease_count ?? 0);
            if (leases == 0 && editors.Length > 0)
                leases = editors.Length;
            _brokerLeaseCount.text = $"{Math.Max(0, leases)} connected";
            _globalServerName.text = "unity_cli_mcp";
        }

        private void RenderActiveEditors(
            IReadOnlyList<UnityCliEditorMetadata> editors,
            UnityCliEditorRegistrySnapshot registry)
        {
            _activeEditorsContainer.Clear();
            _activeEditorsNotices.Clear();
            _activeEditorsCount.text = editors.Count == 1
                ? "1 Editor"
                : $"{editors.Count} Editors";
            _activeEditorsEmpty.style.display =
                editors.Count == 0 ? DisplayStyle.Flex : DisplayStyle.None;

            foreach (var editor in editors)
                _activeEditorsContainer.Add(CreateEditorCard(editor));

            if (editors.Count > 1)
                _activeEditorsNotices.Add(CreateNotice(
                    $"{editors.Count} Unity projects are available to agents.",
                    "notice-info"));

            var duplicateIds = editors
                .Select(editor => editor.project_id)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .GroupBy(value => value, StringComparer.OrdinalIgnoreCase)
                .Where(group => group.Count() > 1)
                .Select(group => group.Key)
                .ToArray();
            if (duplicateIds.Length > 0)
            {
                _activeEditorsNotices.Add(CreateNotice(
                    $"Duplicate project_id detected ({string.Join(", ", duplicateIds)}). Routing is ambiguous until an Editor instance is selected.",
                    "notice-error"));
            }

            var reportedStale = registry?.stale_editors?.Length ?? 0;
            if (reportedStale > 0)
                _activeEditorsNotices.Add(CreateNotice(
                    $"{reportedStale} stale Editor lease(s) are excluded from active routing.",
                    "notice-warning"));

            var corrupt = registry?.corrupt_entries?.Length ?? 0;
            if (corrupt > 0)
                _activeEditorsNotices.Add(CreateNotice(
                    $"{corrupt} malformed registry entr{(corrupt == 1 ? "y was" : "ies were")} ignored.",
                    "notice-error"));
        }

        private static VisualElement CreateEditorCard(UnityCliEditorMetadata editor)
        {
            var state = editor.connection_state;
            var live = IsLiveState(state);
            var card = new VisualElement();
            card.AddToClassList("editor-card");
            card.AddToClassList(live ? "state-ready" : "state-warning");

            var header = new VisualElement();
            header.AddToClassList("status-header");
            var name = new Label(ValueOr(
                editor.project_name,
                "Unnamed Unity project"));
            name.AddToClassList("editor-name");
            var stateLabel = new Label(ValueOr(state, live ? "Connected" : "Unavailable"));
            stateLabel.AddToClassList("status-pill");
            header.Add(name);
            header.Add(stateLabel);
            card.Add(header);

            var path = new Label(ValueOr(
                editor.project_path,
                "Project path unavailable"));
            path.AddToClassList("editor-path");
            card.Add(path);

            var meta = new VisualElement();
            meta.AddToClassList("editor-meta-grid");
            AddEditorMeta(
                meta,
                "Unity",
                editor.editor_version);
            AddEditorMeta(meta, "Tools", editor.tool_count.ToString());
            card.Add(meta);
            return card;
        }

        private void RenderServerControl()
        {
            var running = IsHttpRunning();
            var httpSelectedButStopped = _presenter.UseHttp && !running;
            var runtimeReady =
                File.Exists(_nodePath) &&
                UnityCliSetupPresenter.IsSupportedNode(_nodeVersion) &&
                File.Exists(_setupPath);
            var bundleInstalled =
                _probe?.data?.serverInstalled == true ||
                _probe?.data?.serverExists == true;
            var serverAvailable = running || (runtimeReady && bundleInstalled);
            var ready = running || (serverAvailable && !httpSelectedButStopped);

            _serverLamp.EnableInClassList("server-lamp-running", ready);
            _serverLamp.EnableInClassList("server-lamp-warning", httpSelectedButStopped);
            _serverLamp.EnableInClassList(
                "server-lamp-stopped",
                !ready && !httpSelectedButStopped);
            _brokerState.EnableInClassList("server-status-running", ready);
            _brokerState.EnableInClassList("server-status-warning", httpSelectedButStopped);
            _brokerState.EnableInClassList(
                "server-status-stopped",
                !ready && !httpSelectedButStopped);
            _httpActionButton.EnableInClassList("button-server-stop", running);
            _httpActionButton.EnableInClassList("button-server-start", !running);

            if (running)
            {
                _brokerState.text = "HTTP RUNNING";
                _serverPrimaryTitle.text = "HTTP server is running";
                _httpStatus.text =
                    $"Agents can connect through 127.0.0.1:{_probe.data.http.port}.";
                _serverTransportValue.text = "HTTP · loopback";
                _brokerPort.text = $"127.0.0.1:{_probe.data.http.port}";
                _httpActionButton.text = "Stop HTTP server";
            }
            else if (httpSelectedButStopped)
            {
                _brokerState.text = "HTTP STOPPED";
                _serverPrimaryTitle.text = "HTTP server needs to be started";
                _httpStatus.text =
                    "The HTTP transport is selected, but no server is accepting connections.";
                _serverTransportValue.text = "HTTP · selected";
                _brokerPort.text = "Not running";
                _httpActionButton.text = "Start HTTP server";
            }
            else if (serverAvailable)
            {
                _brokerState.text = "STDIO READY";
                _serverPrimaryTitle.text = "Ready for agent connections";
                _httpStatus.text =
                    "stdio starts automatically when an agent connects. Start HTTP only when a shared endpoint is needed.";
                _serverTransportValue.text = "stdio · automatic";
                _brokerPort.text = "Agent managed";
                _httpActionButton.text = "Start HTTP server";
            }
            else
            {
                _brokerState.text = "NOT READY";
                _serverPrimaryTitle.text = "Server prerequisites are missing";
                _httpStatus.text =
                    "Install Node and complete the managed configuration first.";
                _serverTransportValue.text = "Unavailable";
                _brokerPort.text = "Unavailable";
                _httpActionButton.text = "Start HTTP server";
            }

            _httpActionButton.SetEnabled(!_presenter.Busy && serverAvailable);
        }

        private static void AddEditorMeta(VisualElement parent, string label, string value)
        {
            var cell = new VisualElement();
            cell.AddToClassList("editor-meta");
            var key = new Label(label);
            key.AddToClassList("detail-label");
            var content = new Label(ValueOrUnavailable(value));
            content.AddToClassList("editor-meta-value");
            cell.Add(key);
            cell.Add(content);
            parent.Add(cell);
        }

        private static void SetStatusPill(Label label, string text, string stateClass)
        {
            label.text = text;
            label.RemoveFromClassList("status-ready");
            label.RemoveFromClassList("status-warning");
            label.RemoveFromClassList("status-error");
            label.RemoveFromClassList("state-neutral");
            label.AddToClassList(stateClass);
        }

        private static string StateClass(string state, bool live)
        {
            if (state?.IndexOf("malformed", StringComparison.OrdinalIgnoreCase) >= 0 ||
                state?.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 ||
                state?.IndexOf("duplicate", StringComparison.OrdinalIgnoreCase) >= 0)
                return "status-error";
            if (state?.IndexOf("stale", StringComparison.OrdinalIgnoreCase) >= 0 ||
                state?.IndexOf("warning", StringComparison.OrdinalIgnoreCase) >= 0)
                return "status-warning";
            return live ? "status-ready" : "state-neutral";
        }

        private static bool IsLiveState(string state)
        {
            return string.Equals(state, "connected", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "active", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "live", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "published", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "ready", StringComparison.OrdinalIgnoreCase);
        }

        private static string ValueOrUnavailable(string value)
        {
            return ValueOr(value, "Unavailable");
        }

        private static string ValueOr(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value;
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
                case "repair":
                    return "Repairing managed configuration";
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
