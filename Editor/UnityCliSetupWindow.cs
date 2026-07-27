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
    /// Provides the compact Unity CLI and official stdio MCP setup experience.
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
        private static readonly (string id, string name)[] DefaultSkills =
        {
            ("operate-unity-mcp", "Operate Unity MCP"),
            ("operate-unity-cli", "Operate Unity CLI"),
        };

        private readonly UnityCliOfficialMcpProbe _officialProbe =
            new UnityCliOfficialMcpProbe();
        private string _cliPath = string.Empty;
        private string _cliVersion = string.Empty;
        private string _pipelineVersion = string.Empty;
        private string _nodePath = string.Empty;
        private string _setupPath = string.Empty;
        private string _packagePath = string.Empty;
        private string _lastRequest = string.Empty;
        private string _lastResponse = string.Empty;
        private string _lastBackup = string.Empty;
        private string _installDiagnostics = string.Empty;
        private bool _busy;
        private bool _refreshing;
        private bool _showAllAgents;
        private UnityCliSetupResponse _status;
        private UnityCliOfficialMcpProbeResult _testResult;
        private CancellationTokenSource _lifetime;
        private AddRequest _pipelineRequest;

        private Label _pageStatus;
        private Button _refreshButton;
        private Button _installCliButton;
        private Button _installPipelineButton;
        private Button _startPipelineButton;
        private VisualElement _cliLamp;
        private VisualElement _pipelineLamp;
        private VisualElement _editorLamp;
        private Label _cliDetail;
        private Label _pipelineDetail;
        private Label _editorDetail;
        private Label _cliReason;
        private Label _pipelineReason;
        private Label _editorReason;
        private VisualElement _officialLamp;
        private Label _officialState;
        private Label _officialDetail;
        private Button _testMcpButton;
        private Label _testMcpReason;
        private VisualElement _agentsContainer;
        private Label _agentsEmpty;
        private Button _showAllButton;
        private VisualElement _skillsContainer;
        private VisualElement _resultPanel;
        private Label _resultTitle;
        private Label _resultDetails;
        private IntegerField _httpPort;
        private Label _brokerStatus;
        private Button _httpAction;
        private Label _httpDisabledReason;
        private Button _removeButton;
        private Button _rollbackButton;
        private TextField _diagnostics;

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
            if (layout == null)
            {
                rootVisualElement.Add(new HelpBox(
                    $"Could not load UI Toolkit layout: {WindowUxmlPath}",
                    HelpBoxMessageType.Error));
                return;
            }

            layout.CloneTree(rootVisualElement);
            var style = AssetDatabase.LoadAssetAtPath<StyleSheet>(WindowUssPath);
            if (style != null)
                rootVisualElement.styleSheets.Add(style);
            _lifetime = new CancellationTokenSource();
            CacheElements();
            BindEvents();
            RefreshLocalStatus();
            Render();
            rootVisualElement.schedule.Execute(RefreshStatus).ExecuteLater(1);
        }

        private void OnDisable()
        {
            _lifetime?.Cancel();
            _lifetime?.Dispose();
            _lifetime = null;
            EditorApplication.update -= PollPipelineInstall;
        }

        private void CacheElements()
        {
            _pageStatus = rootVisualElement.Q<Label>("page-status");
            _refreshButton = rootVisualElement.Q<Button>("refresh-status");
            _installCliButton = rootVisualElement.Q<Button>("install-cli");
            _installPipelineButton = rootVisualElement.Q<Button>("install-pipeline");
            _startPipelineButton = rootVisualElement.Q<Button>("start-pipeline");
            _cliLamp = rootVisualElement.Q<VisualElement>("cli-lamp");
            _pipelineLamp = rootVisualElement.Q<VisualElement>("pipeline-lamp");
            _editorLamp = rootVisualElement.Q<VisualElement>("editor-lamp");
            _cliDetail = rootVisualElement.Q<Label>("cli-detail");
            _pipelineDetail = rootVisualElement.Q<Label>("pipeline-detail");
            _editorDetail = rootVisualElement.Q<Label>("editor-detail");
            _cliReason = rootVisualElement.Q<Label>("cli-reason");
            _pipelineReason = rootVisualElement.Q<Label>("pipeline-reason");
            _editorReason = rootVisualElement.Q<Label>("editor-reason");
            _officialLamp = rootVisualElement.Q<VisualElement>("official-mcp-lamp");
            _officialState = rootVisualElement.Q<Label>("official-mcp-state");
            _officialDetail = rootVisualElement.Q<Label>("official-mcp-detail");
            _testMcpButton = rootVisualElement.Q<Button>("test-official-mcp");
            _testMcpReason = rootVisualElement.Q<Label>("test-official-mcp-reason");
            _agentsContainer = rootVisualElement.Q<VisualElement>("agents-container");
            _agentsEmpty = rootVisualElement.Q<Label>("agents-empty");
            _showAllButton = rootVisualElement.Q<Button>("show-all-agents");
            _skillsContainer = rootVisualElement.Q<VisualElement>("skills-container");
            _resultPanel = rootVisualElement.Q<VisualElement>("result-panel");
            _resultTitle = rootVisualElement.Q<Label>("result-title");
            _resultDetails = rootVisualElement.Q<Label>("result-details");
            _httpPort = rootVisualElement.Q<IntegerField>("http-port");
            _brokerStatus = rootVisualElement.Q<Label>("broker-status");
            _httpAction = rootVisualElement.Q<Button>("http-action");
            _httpDisabledReason = rootVisualElement.Q<Label>("http-disabled-reason");
            _removeButton = rootVisualElement.Q<Button>("remove-configuration");
            _rollbackButton = rootVisualElement.Q<Button>("rollback-configuration");
            _diagnostics = rootVisualElement.Q<TextField>("diagnostics");
        }

        private void BindEvents()
        {
            _refreshButton.clicked += RefreshStatus;
            _installCliButton.clicked += InstallUnityCli;
            _installPipelineButton.clicked += InstallPipeline;
            _startPipelineButton.clicked += StartPipeline;
            _testMcpButton.clicked += TestOfficialMcp;
            _showAllButton.clicked += () =>
            {
                _showAllAgents = !_showAllAgents;
                RenderAgents();
            };
            _httpAction.clicked += ToggleHttp;
            _removeButton.clicked += () => PreviewAndApply("all", string.Empty, false);
            _rollbackButton.clicked += Rollback;
            rootVisualElement.Q<Button>("copy-diagnostics").clicked += () =>
                EditorGUIUtility.systemCopyBuffer =
                    UnityCliSetupBridge.Sanitize(BuildDiagnostics());
        }

        private void RefreshLocalStatus()
        {
            var package = UnityCliSetupBridge.FindPackage(PackageName);
            _packagePath = package?.resolvedPath ?? string.Empty;
            _setupPath = UnityCliSetupBridge.ResolveSetupPath(_packagePath);
            _cliPath = UnityCliSetupBridge.ResolveExecutable(
                "UNITY_CLI_PATH",
                Application.platform == RuntimePlatform.WindowsEditor
                    ? "unity.exe"
                    : "unity",
                UnityCliSetupBridge.DefaultCliPaths());
            _cliVersion = UnityCliSetupBridge.RunVersion(_cliPath, "--version");
            _nodePath = UnityCliSetupBridge.ResolveExecutable(
                "NODE_PATH",
                Application.platform == RuntimePlatform.WindowsEditor ? "node.exe" : "node",
                Array.Empty<string>());
            _pipelineVersion =
                UnityCliSetupBridge.FindPackage(PipelinePackageName)?.version ?? string.Empty;
        }

        private async void RefreshStatus()
        {
            if (_busy || _refreshing)
                return;
            _refreshing = true;
            RefreshLocalStatus();
            _testResult = null;
            if (!File.Exists(_nodePath) || !File.Exists(_setupPath))
            {
                _refreshing = false;
                _lastResponse =
                    "{\"ok\":false,\"operation\":\"probe\",\"errors\":[\"Setup backend is unavailable\"]}";
                _status = null;
                ShowResult(
                    false,
                    "Managed setup is unavailable",
                    "Official MCP can still be tested directly. Node 20+ is " +
                    "required only to manage agent registrations, skills, and " +
                    "the optional UniGame broker from this window.");
                Render();
                return;
            }

            _pageStatus.text = "Checking…";
            _refreshButton.SetEnabled(false);
            var response = await ExecuteSetup(BuildRequest("probe", "all", string.Empty, true));
            if (response?.ok == true)
            {
                _status = response;
                if (!string.IsNullOrEmpty(response.backup))
                    _lastBackup = response.backup;
            }
            else
            {
                ShowResult(
                    false,
                    "Status check failed",
                    JoinErrors(response, "The setup backend returned invalid JSON."));
            }

            _refreshing = false;
            if (!_busy)
            {
                _pageStatus.text = "Ready";
                Render();
            }
        }

        private async void TestOfficialMcp()
        {
            if (_busy || !CanTestOfficialMcp(out _))
                return;
            SetBusy(true, "Testing MCP…");
            _testResult = new UnityCliOfficialMcpProbeResult { state = "testing" };
            Render();
            var cancellation = _lifetime?.Token ?? CancellationToken.None;
            var result = await _officialProbe.Test(
                Path.GetFullPath(_cliPath),
                UnityCliSetupBridge.ProjectPath(),
                TimeSpan.FromSeconds(15),
                cancellation);
            _testResult = result;
            SetBusy(false, result.state == "verified" ? "Verified" : "MCP test failed");
        }

        private async void PreviewAndApply(
            string targetKind,
            string targetId,
            bool enable,
            bool repair = false)
        {
            if (_busy)
                return;
            SetBusy(true, "Preparing preview…");
            var preview = await ExecuteSetup(
                BuildRequest(repair ? "repair" : "plan", targetKind, targetId, enable));
            SetBusy(false, "Ready");
            if (preview?.ok != true)
            {
                ShowResult(
                    false,
                    "Preview failed",
                    JoinErrors(preview, "The setup backend returned invalid JSON."));
                return;
            }

            var summary = PreviewSummary(preview, targetKind, targetId, enable);
            if (!EditorUtility.DisplayDialog(
                    enable ? "Confirm setup" : "Confirm removal",
                    summary,
                    enable ? "Apply" : "Remove",
                    "Cancel"))
                return;

            SetBusy(true, enable ? "Applying…" : "Removing…");
            var applyRequest = BuildRequest(
                repair ? "repair" : "apply",
                targetKind,
                targetId,
                enable,
                true);
            applyRequest.force = repair;
            var applied = await ExecuteSetup(applyRequest);
            if (applied?.ok == true)
            {
                if (!string.IsNullOrEmpty(applied.backup))
                    _lastBackup = applied.backup;
                var detail = RestartSummary(applied);
                if (enable &&
                    string.Equals(targetKind, "agent", StringComparison.Ordinal) &&
                    CanTestOfficialMcp(out _))
                {
                    _testResult = await _officialProbe.Test(
                        Path.GetFullPath(_cliPath),
                        UnityCliSetupBridge.ProjectPath(),
                        TimeSpan.FromSeconds(15),
                        _lifetime?.Token ?? CancellationToken.None);
                    detail += _testResult.state == "verified"
                        ? $"\nOfficial MCP verified with {_testResult.tool_count} tools."
                        : $"\nMCP verification failed: {ValueOr(_testResult.error, "Unknown error")}";
                }
                ShowResult(
                    true,
                    "Configuration updated",
                    detail);
            }
            else
            {
                ShowResult(
                    false,
                    "Configuration failed",
                    JoinErrors(applied, "The setup backend returned invalid JSON."));
            }

            SetBusy(false, "Ready");
            rootVisualElement.schedule.Execute(RefreshStatus).ExecuteLater(200);
        }

        private async void ToggleHttp()
        {
            var broker = _status?.data?.advanced_broker;
            var stop = broker?.running == true;
            var message = stop
                ? "Stop the custom loopback HTTP broker?"
                : "Start the optional loopback HTTP broker? Official stdio MCP is started by the agent and is unaffected.";
            if (!EditorUtility.DisplayDialog(
                    stop ? "Stop HTTP broker" : "Start HTTP broker",
                    message,
                    stop ? "Stop" : "Start",
                    "Cancel"))
                return;

            SetBusy(true, stop ? "Stopping HTTP…" : "Starting HTTP…");
            var request = BuildRequest("serve", "broker", "advanced_broker", true, true);
            request.stop = stop;
            request.install_server = !stop;
            request.port = Math.Max(0, _httpPort.value);
            var response = await ExecuteSetup(request);
            if (response?.ok == true)
                _status = response;
            else
                ShowResult(false, "HTTP action failed", JoinErrors(response, "No response."));
            SetBusy(false, "Ready");
            rootVisualElement.schedule.Execute(RefreshStatus).ExecuteLater(200);
        }

        private async void Rollback()
        {
            if (string.IsNullOrEmpty(_lastBackup) ||
                !EditorUtility.DisplayDialog(
                    "Rollback managed configuration",
                    "Restore the files captured by the latest setup backup?",
                    "Rollback",
                    "Cancel"))
                return;
            SetBusy(true, "Rolling back…");
            var request = BuildRequest("rollback", "all", string.Empty, false, true);
            request.backup_id = _lastBackup;
            var response = await ExecuteSetup(request);
            ShowResult(
                response?.ok == true,
                response?.ok == true ? "Rollback completed" : "Rollback failed",
                response?.ok == true
                    ? RestartSummary(response)
                    : JoinErrors(response, "No response."));
            SetBusy(false, "Ready");
            rootVisualElement.schedule.Execute(RefreshStatus).ExecuteLater(200);
        }

        private UnityCliSetupRequest BuildRequest(
            string operation,
            string targetKind,
            string targetId,
            bool enable,
            bool confirm = false)
        {
            var request = new UnityCliSetupRequest
            {
                operation = operation,
                project_path = UnityCliSetupBridge.ProjectPath(),
                package_root = _packagePath,
                target_kind = targetKind,
                target_id = targetId,
                transport = "stdio",
                confirm = confirm,
                install_server = false,
                owner_pid = Process.GetCurrentProcess().Id,
                editor_instance_id = UnityCliEditorRegistry.EditorInstanceId(),
                owner_started_at_utc = UnityCliEditorRegistry.EditorStartedAtUtc(),
            };
            if (string.Equals(targetKind, "agent", StringComparison.Ordinal))
            {
                if (enable)
                    request.agent_ids = new[] { targetId };
                else
                    request.disabled_agent_ids = new[] { targetId };
            }
            else if (string.Equals(targetKind, "skill", StringComparison.Ordinal))
            {
                if (enable)
                    request.skill_ids = new[] { targetId };
                else
                    request.disabled_skill_ids = new[] { targetId };
            }
            else if (string.Equals(targetKind, "all", StringComparison.Ordinal) && !enable)
            {
                request.disabled_agent_ids = _status?.data?.agents?
                    .Where(agent => agent?.managed == true)
                    .Select(agent => agent.agent_id)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .ToArray() ?? Array.Empty<string>();
                request.disabled_skill_ids = _status?.data?.skills?
                    .Where(skill => skill != null &&
                                    !string.Equals(
                                        skill.state,
                                        "not_installed",
                                        StringComparison.Ordinal))
                    .Select(skill => skill.skill_id)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .ToArray() ?? Array.Empty<string>();
            }

            return request;
        }

        private async Task<UnityCliSetupResponse> ExecuteSetup(UnityCliSetupRequest request)
        {
            _lastRequest = JsonUtility.ToJson(request, true);
            var json = await Task.Run(
                () => UnityCliSetupBridge.Execute(_nodePath, _setupPath, _lastRequest));
            _lastResponse = json;
            return UnityCliSetupResponse.Parse(json);
        }

        private void Render()
        {
            if (_pageStatus == null)
                return;
            var cliReady = !string.IsNullOrWhiteSpace(_cliVersion);
            var pipelineReady = !string.IsNullOrWhiteSpace(_pipelineVersion);
            var current = _status?.data?.current_editor;
            var descriptorPath = Path.Combine(
                UnityCliSetupBridge.ProjectPath(),
                "Library",
                "Pipeline",
                ".unity-pipeline-port");
            var editorReady = pipelineReady && File.Exists(descriptorPath);
            var editorCompiling = EditorApplication.isCompiling;

            SetReadiness(
                _cliLamp,
                _cliDetail,
                _cliReason,
                cliReady,
                cliReady ? VersionLabel(_cliVersion, ExpectedCliVersion) : "Not installed",
                cliReady ? string.Empty : "Install Unity CLI to use MCP.");
            SetReadiness(
                _pipelineLamp,
                _pipelineDetail,
                _pipelineReason,
                pipelineReady,
                pipelineReady
                    ? VersionLabel(_pipelineVersion, ExpectedPipelineVersion)
                    : "Not installed",
                pipelineReady ? string.Empty : "Pipeline is required for Editor tools.");
            SetReadiness(
                _editorLamp,
                _editorDetail,
                _editorReason,
                editorReady,
                editorReady
                    ? current?.tool_count > 0
                        ? $"{current.tool_count} tools ready"
                        : "Pipeline server running"
                    : editorCompiling
                        ? "Compiling scripts"
                        : "Pipeline server stopped",
                editorReady
                    ? string.Empty
                    : editorCompiling
                        ? "Wait until Unity finishes compiling."
                        : "Click Start Pipeline to make Editor tools available.");

            _installCliButton.style.display = cliReady ? DisplayStyle.None : DisplayStyle.Flex;
            _installPipelineButton.style.display =
                pipelineReady ? DisplayStyle.None : DisplayStyle.Flex;
            _startPipelineButton.style.display =
                pipelineReady && !editorReady ? DisplayStyle.Flex : DisplayStyle.None;
            _installCliButton.SetEnabled(!_busy);
            _installPipelineButton.SetEnabled(!_busy);
            _startPipelineButton.SetEnabled(!_busy && !editorCompiling);
            RenderOfficialMcp();
            RenderAgents();
            RenderSkills();
            RenderAdvanced();
            _refreshButton.SetEnabled(!_busy && !_refreshing);
            _diagnostics.value = BuildDiagnostics();
        }

        private void RenderOfficialMcp()
        {
            string state;
            int toolCount;
            string error;
            if (_testResult != null)
            {
                state = _testResult.state;
                toolCount = _testResult.tool_count;
                error = _testResult.error;
            }
            else
            {
                var status = _status?.data?.official_mcp;
                state = status?.state;
                toolCount = status?.tool_count ?? 0;
                error = status?.error;
            }

            if (string.IsNullOrWhiteSpace(state))
                state = CanTestOfficialMcp(out _) ? "ready" : "not_ready";
            var display = DisplayMcpState(state);
            _officialState.text = display;
            _officialState.EnableInClassList("status-ready", state == "ready");
            _officialState.EnableInClassList("status-testing", state == "testing");
            _officialState.EnableInClassList("status-verified", state == "verified");
            _officialState.EnableInClassList("status-error", state == "error");
            SetLampClass(
                _officialLamp,
                state == "ready" || state == "verified",
                state == "testing",
                state == "error");
            _officialDetail.text = state == "verified"
                ? $"Verified initialize and tools/list over stdio · {toolCount} tools."
                : state == "testing"
                    ? "Launching Unity CLI and testing JSON-RPC…"
                    : state == "error"
                        ? ValueOr(error, "The stdio MCP test failed.")
                        : state == "ready"
                            ? "Ready for a real initialize and tools/list test."
                            : "Complete readiness checks before testing.";
            var canTest = CanTestOfficialMcp(out var reason);
            _testMcpButton.SetEnabled(canTest && !_busy);
            _testMcpReason.text = !canTest ? reason : string.Empty;
        }

        private void RenderAgents()
        {
            _agentsContainer.Clear();
            var agents = (_status?.data?.agents ?? Array.Empty<UnityCliAgentStatus>())
                .Where(agent => agent != null)
                .OrderByDescending(agent => agent.detected)
                .ThenBy(agent => agent.display_name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var visible = _showAllAgents ? agents : agents.Where(agent => agent.detected).ToArray();
            foreach (var agent in visible)
                _agentsContainer.Add(CreateAgentCard(agent));
            _agentsEmpty.style.display =
                visible.Length == 0 ? DisplayStyle.Flex : DisplayStyle.None;
            _agentsEmpty.text = SetupBackendReady()
                ? "No supported agents detected."
                : "Install Node 20+ to discover and configure agent clients.";
            _showAllButton.text = _showAllAgents ? "Detected only" : "Show all";
            _showAllButton.style.display =
                agents.Any(agent => !agent.detected) ? DisplayStyle.Flex : DisplayStyle.None;
            _showAllButton.SetEnabled(!_busy);
        }

        private VisualElement CreateAgentCard(UnityCliAgentStatus agent)
        {
            var configured = IsConfigured(agent.registration_state);
            var conflict = string.Equals(
                agent.registration_state,
                "conflict",
                StringComparison.OrdinalIgnoreCase);
            var card = new VisualElement();
            card.AddToClassList("integration-card");
            var lamp = new VisualElement();
            lamp.AddToClassList("status-lamp");
            lamp.EnableInClassList("lamp-ready", configured);
            var copy = new VisualElement();
            copy.AddToClassList("integration-copy");
            copy.Add(new Label(ValueOr(agent.display_name, agent.agent_id))
            {
                name = $"agent-{agent.agent_id}-name",
            });
            var detail = new Label(
                $"{(agent.detected ? "Detected" : "Not detected")} · " +
                $"{DisplayRegistration(agent.registration_state)}" +
                (agent.restart_required ? " · restart required" : string.Empty));
            detail.AddToClassList("card-detail");
            copy.Add(detail);
            var reason = new Label();
            reason.AddToClassList("disabled-reason");
            var canChange = !_busy && (agent.detected || configured);
            if (!agent.detected && !configured)
                reason.text = "Install or launch this agent before configuring it.";
            reason.style.display = string.IsNullOrEmpty(reason.text)
                ? DisplayStyle.None
                : DisplayStyle.Flex;
            copy.Add(reason);
            var action = new Button(
                () => PreviewAndApply(
                    "agent",
                    agent.agent_id,
                    !configured,
                    conflict))
            {
                text = conflict ? "Repair" : configured ? "Disconnect" : "Connect",
            };
            action.AddToClassList(
                configured && !conflict ? "button-secondary" : "button-primary");
            action.SetEnabled(canChange);
            card.Add(lamp);
            card.Add(copy);
            card.Add(action);
            return card;
        }

        private void RenderSkills()
        {
            _skillsContainer.Clear();
            var records = (_status?.data?.skills ?? Array.Empty<UnityCliSkillStatus>())
                .Where(skill => skill != null)
                .ToDictionary(skill => skill.skill_id ?? string.Empty, StringComparer.Ordinal);
            foreach (var definition in DefaultSkills)
            {
                records.TryGetValue(definition.id, out var skill);
                skill = skill ?? new UnityCliSkillStatus
                {
                    skill_id = definition.id,
                    display_name = definition.name,
                    state = "not_installed",
                };
                _skillsContainer.Add(CreateSkillCard(skill));
            }
        }

        private VisualElement CreateSkillCard(UnityCliSkillStatus skill)
        {
            var skillState = ValueOr(skill.state, "not_installed");
            var installed = !string.Equals(
                skillState,
                "not_installed",
                StringComparison.OrdinalIgnoreCase);
            var modified = string.Equals(
                skillState,
                "modified",
                StringComparison.OrdinalIgnoreCase);
            var updateAvailable = string.Equals(
                skillState,
                "update_available",
                StringComparison.OrdinalIgnoreCase);
            var card = new VisualElement();
            card.AddToClassList("skill-card");
            var header = new VisualElement();
            header.AddToClassList("section-heading-row");
            var name = new Label(ValueOr(skill.display_name, skill.skill_id));
            name.AddToClassList("card-title");
            var state = new Label(DisplaySkillState(skillState));
            state.AddToClassList("status-pill");
            state.EnableInClassList("status-ready", installed);
            header.Add(name);
            header.Add(state);
            card.Add(header);
            var path = new Label(ValueOr(skill.install_path, "Project-local managed copy"));
            path.AddToClassList("card-detail");
            card.Add(path);
            var actions = new VisualElement();
            actions.AddToClassList("skill-actions");
            var backendReady = SetupBackendReady();
            if (!installed || updateAvailable || modified)
            {
                var apply = new Button(
                    () => PreviewAndApply(
                        "skill",
                        skill.skill_id,
                        true,
                        modified))
                {
                    text = modified ? "Repair" : updateAvailable ? "Update" : "Install",
                };
                apply.AddToClassList("button-primary");
                apply.SetEnabled(!_busy && backendReady);
                actions.Add(apply);
            }
            if (modified)
            {
                var diff = new Button(
                    () => PreviewOnly("skill", skill.skill_id, true))
                {
                    text = "Show diff",
                };
                diff.AddToClassList("button-secondary");
                diff.SetEnabled(!_busy && backendReady);
                actions.Add(diff);
            }
            if (installed)
            {
                var remove = new Button(
                    () => PreviewAndApply("skill", skill.skill_id, false))
                {
                    text = "Remove",
                };
                remove.AddToClassList("button-secondary");
                remove.SetEnabled(!_busy && backendReady);
                actions.Add(remove);
            }
            card.Add(actions);
            if (!backendReady)
            {
                var reason = new Label(
                    "Node 20+ is required to manage project-local skill copies.");
                reason.AddToClassList("disabled-reason");
                card.Add(reason);
            }
            return card;
        }

        private async void PreviewOnly(string targetKind, string targetId, bool enable)
        {
            if (_busy)
                return;
            SetBusy(true, "Preparing preview…");
            var preview = await ExecuteSetup(
                BuildRequest("plan", targetKind, targetId, enable));
            SetBusy(false, "Ready");
            if (preview?.ok != true)
            {
                ShowResult(
                    false,
                    "Preview failed",
                    JoinErrors(preview, "The setup backend returned invalid JSON."));
                return;
            }

            EditorUtility.DisplayDialog(
                "Managed diff preview",
                PreviewSummary(preview, targetKind, targetId, enable),
                "Close");
        }

        private void RenderAdvanced()
        {
            var broker = _status?.data?.advanced_broker;
            var running = broker?.running == true;
            _brokerStatus.text = running
                ? $"Running · {ValueOr(broker.endpoint, $"127.0.0.1:{broker.port}")}"
                : ValueOr(broker?.error, "Stopped");
            _brokerStatus.EnableInClassList("status-ready", running);
            _httpAction.text = running ? "Stop HTTP" : "Start HTTP";
            var canUse = !_busy && File.Exists(_nodePath) && File.Exists(_setupPath);
            _httpAction.SetEnabled(canUse);
            _httpDisabledReason.text = canUse
                ? string.Empty
                : "The custom broker backend is unavailable.";
            _httpPort.SetEnabled(!_busy && !running);
            var hasManagedState =
                _status?.data?.agents?.Any(agent => agent?.managed == true) == true ||
                _status?.data?.skills?.Any(skill =>
                    skill != null &&
                    !string.Equals(
                        skill.state,
                        "not_installed",
                        StringComparison.Ordinal)) == true;
            _removeButton.SetEnabled(!_busy && SetupBackendReady() && hasManagedState);
            _rollbackButton.SetEnabled(
                !_busy && SetupBackendReady() && !string.IsNullOrEmpty(_lastBackup));
        }

        private bool CanTestOfficialMcp(out string reason)
        {
            if (string.IsNullOrWhiteSpace(_cliPath) || !File.Exists(_cliPath))
            {
                reason = "Unity CLI is not installed.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(_pipelineVersion))
            {
                reason = "Install Pipeline to use Editor tools.";
                return false;
            }

            var descriptorPath = Path.Combine(
                UnityCliSetupBridge.ProjectPath(),
                "Library",
                "Pipeline",
                ".unity-pipeline-port");
            if (!File.Exists(descriptorPath))
            {
                reason = EditorApplication.isCompiling
                    ? "Wait until Unity finishes compiling."
                    : "Start Pipeline for this Editor.";
                return false;
            }

            reason = string.Empty;
            return true;
        }

        private void StartPipeline()
        {
            if (_busy || EditorApplication.isCompiling)
                return;
            SetBusy(true, "Starting Pipeline…");
            EditorApplication.ExecuteMenuItem("Pipeline/Stop Server");
            var started = EditorApplication.ExecuteMenuItem("Pipeline/Start Server");
            SetBusy(false, started ? "Ready" : "Pipeline start failed");
            if (!started)
            {
                ShowResult(
                    false,
                    "Pipeline start failed",
                    "Open Pipeline/Settings and verify that the server can start.");
                return;
            }
            rootVisualElement.schedule.Execute(RefreshStatus).ExecuteLater(500);
        }

        private bool SetupBackendReady()
        {
            return File.Exists(_nodePath) && File.Exists(_setupPath);
        }

        private async void InstallUnityCli()
        {
            if (_busy ||
                !EditorUtility.DisplayDialog(
                    "Install Unity CLI",
                    $"Run Unity's official beta installer for {Application.platform}?",
                    "Install",
                    "Cancel"))
                return;
            SetBusy(true, "Installing Unity CLI…");
            var result = await UnityCliPlatformInstaller.Install(
                UnityCliPlatformInstaller.ForPlatform(Application.platform),
                _lifetime?.Token ?? CancellationToken.None);
            _installDiagnostics = $"{result.Output}\n{result.Error}";
            ShowResult(
                result.Ok,
                result.Ok ? "Unity CLI installed" : "Unity CLI install failed",
                result.Ok ? "Refresh to verify the installed executable." : result.Error);
            SetBusy(false, "Ready");
            RefreshStatus();
        }

        private void InstallPipeline()
        {
            if (_busy ||
                !EditorUtility.DisplayDialog(
                    "Install Unity Pipeline",
                    $"Add {PipelinePackageName}@{ExpectedPipelineVersion} to this project?",
                    "Install",
                    "Cancel"))
                return;
            SetBusy(true, "Installing Pipeline…");
            _pipelineRequest =
                Client.Add($"{PipelinePackageName}@{ExpectedPipelineVersion}");
            EditorApplication.update += PollPipelineInstall;
        }

        private void PollPipelineInstall()
        {
            if (_pipelineRequest == null || !_pipelineRequest.IsCompleted)
                return;
            EditorApplication.update -= PollPipelineInstall;
            var success = _pipelineRequest.Status == StatusCode.Success;
            ShowResult(
                success,
                success ? "Pipeline installed" : "Pipeline install failed",
                success
                    ? "Unity will compile and publish Editor tools."
                    : _pipelineRequest.Error?.message);
            _pipelineRequest = null;
            SetBusy(false, "Ready");
            RefreshStatus();
        }

        private void SetBusy(bool busy, string status)
        {
            _busy = busy;
            _pageStatus.text = status;
            rootVisualElement.EnableInClassList("is-busy", busy);
            Render();
        }

        private void ShowResult(bool success, string title, string detail)
        {
            _resultPanel.style.display = DisplayStyle.Flex;
            _resultPanel.EnableInClassList("result-success", success);
            _resultPanel.EnableInClassList("result-error", !success);
            _resultTitle.text = title;
            _resultDetails.text = detail;
        }

        private static void SetReadiness(
            VisualElement lamp,
            Label detail,
            Label reason,
            bool ready,
            string value,
            string disabledReason)
        {
            SetLampClass(lamp, ready, !ready, false);
            detail.text = value;
            reason.text = disabledReason;
        }

        private static void SetLampClass(
            VisualElement lamp,
            bool ready,
            bool warning,
            bool error)
        {
            lamp.EnableInClassList("lamp-ready", ready);
            lamp.EnableInClassList("lamp-warning", warning);
            lamp.EnableInClassList("lamp-error", error);
        }

        private static string PreviewSummary(
            UnityCliSetupResponse preview,
            string targetKind,
            string targetId,
            bool enable)
        {
            var changes = preview.changes ?? Array.Empty<UnityCliPlannedChange>();
            var lines = changes
                .Take(6)
                .Select(change =>
                    $"• {ValueOr(change.summary, change.kind)}\n  {change.target}")
                .ToList();
            if (changes.Length > lines.Count)
                lines.Add($"• …and {changes.Length - lines.Count} more change(s)");
            if (lines.Count == 0)
                lines.Add("• No file changes; managed state is already healthy.");
            var warnings = preview.warnings ?? Array.Empty<string>();
            if (warnings.Length > 0)
                lines.Add($"\nWarnings:\n{string.Join("\n", warnings.Select(item => $"• {item}"))}");
            return $"{(enable ? "Enable" : "Disable")} {targetKind} " +
                   $"{ValueOr(targetId, "managed configuration")}?\n\n" +
                   string.Join("\n", lines) +
                   "\n\nA backup is created before changes are written.";
        }

        private static string RestartSummary(UnityCliSetupResponse response)
        {
            var restarts = response.restart_required ?? Array.Empty<string>();
            return restarts.Length == 0
                ? "No agent restart was reported."
                : $"Restart required: {string.Join(", ", restarts)}";
        }

        private static string JoinErrors(UnityCliSetupResponse response, string fallback)
        {
            var errors = response?.errors ?? Array.Empty<string>();
            return errors.Length == 0 ? fallback : string.Join("\n", errors);
        }

        private string BuildDiagnostics()
        {
            return UnityCliSetupBridge.Sanitize(
                $"Request\n{ValueOr(_lastRequest, "No request yet.")}\n\n" +
                $"Response\n{ValueOr(_lastResponse, "No response yet.")}\n\n" +
                $"Install\n{ValueOr(_installDiagnostics, "No install output.")}");
        }

        private static bool IsConfigured(string state)
        {
            return string.Equals(state, "installed", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "configured", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "registered", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "ready", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "on", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(state, "managed", StringComparison.OrdinalIgnoreCase);
        }

        private static string DisplayRegistration(string state)
        {
            return string.IsNullOrWhiteSpace(state)
                ? "Not configured"
                : state.Replace('_', ' ');
        }

        private static string DisplayMcpState(string state)
        {
            switch (state)
            {
                case "ready":
                    return "Ready";
                case "testing":
                    return "Testing";
                case "verified":
                    return "Verified";
                case "error":
                    return "Error";
                default:
                    return "Not ready";
            }
        }

        private static string DisplaySkillState(string state)
        {
            switch (state)
            {
                case "installed":
                    return "Installed";
                case "update_available":
                    return "Update available";
                case "modified":
                    return "Modified";
                default:
                    return "Not installed";
            }
        }

        private static string VersionLabel(string version, string expected)
        {
            return string.Equals(version, expected, StringComparison.Ordinal)
                ? $"{version} · Ready"
                : $"{version} · expected {expected}";
        }

        private static string ValueOr(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value;
        }
    }
}
