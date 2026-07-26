using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace UniGame.UnityCli.Editor.Tests
{
    public sealed class UnityCliSetupBridgeTests
    {
        [Test]
        public void ToolkitAssets_LoadFromPackagePath()
        {
            Assert.NotNull(
                AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(
                    UnityCliSetupWindow.WindowUxmlPath));
            Assert.NotNull(
                AssetDatabase.LoadAssetAtPath<StyleSheet>(
                    UnityCliSetupWindow.WindowUssPath));
        }

        [Test]
        public void Layout_PrioritizesOfficialStdioAndKeepsBrokerAdvanced()
        {
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(
                UnityCliSetupWindow.WindowUxmlPath);
            var root = tree.Instantiate();

            Assert.NotNull(root.Q<VisualElement>("cli-card"));
            Assert.NotNull(root.Q<VisualElement>("pipeline-card"));
            Assert.NotNull(root.Q<VisualElement>("editor-card"));
            Assert.NotNull(root.Q<VisualElement>("official-mcp-card"));
            Assert.AreEqual("Test MCP", root.Q<Button>("test-official-mcp").text);
            Assert.NotNull(root.Q<Label>("test-official-mcp-reason"));
            Assert.NotNull(root.Q<VisualElement>("agents-container"));
            Assert.AreEqual("Show all", root.Q<Button>("show-all-agents").text);
            Assert.NotNull(root.Q<VisualElement>("skills-container"));
            Assert.IsNull(root.Q<VisualElement>("preview-panel"));
            Assert.IsNull(root.Q<Button>("review-configuration"));
            Assert.IsNull(root.Q<Button>("apply-configuration"));

            var advanced = root.Q<Foldout>("advanced-foldout");
            Assert.NotNull(advanced);
            Assert.AreEqual("Advanced", advanced.text);
            Assert.NotNull(advanced.Q<Button>("http-action"));
            Assert.NotNull(advanced.Q<IntegerField>("http-port"));
            Assert.NotNull(advanced.Q<Button>("remove-configuration"));
            Assert.NotNull(advanced.Q<TextField>("diagnostics"));
        }

        [Test]
        public void Layout_OfficialStdioHasNoStartServerAction()
        {
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(
                UnityCliSetupWindow.WindowUxmlPath);
            var root = tree.Instantiate();
            var official = root.Q<VisualElement>("official-mcp-card");

            Assert.IsNull(official.Q<Button>("http-action"));
            Assert.IsFalse(
                official.Query<Button>().ToList().Any(
                    button => button.text.IndexOf(
                        "Start server",
                        StringComparison.OrdinalIgnoreCase) >= 0));
            StringAssert.Contains(
                "agent starts",
                official.Q<Label>(className: "section-description").text.ToLowerInvariant());
        }

        [Test]
        public void SetupRequest_WireJsonUsesStrictSnakeCase()
        {
            var request = new UnityCliSetupRequest
            {
                operation = "plan",
                project_path = "/project",
                package_root = "/package",
                agent_ids = new[] { "codex" },
                disabled_agent_ids = new[] { "cursor" },
                skill_ids = new[] { "operate-unity-cli" },
                disabled_skill_ids = new[] { "legacy" },
                target_kind = "agent",
                target_id = "codex",
                install_server = true,
                owner_pid = 42,
                editor_instance_id = "editor",
                owner_started_at_utc = "2026-01-01T00:00:00Z",
                keep_alive = true,
                backup_id = "backup",
            };

            var json = JsonUtility.ToJson(request);

            StringAssert.Contains("\"project_path\"", json);
            StringAssert.Contains("\"agent_ids\"", json);
            StringAssert.Contains("\"disabled_agent_ids\"", json);
            StringAssert.Contains("\"skill_ids\"", json);
            StringAssert.Contains("\"target_kind\"", json);
            StringAssert.Contains("\"editor_instance_id\"", json);
            StringAssert.Contains("\"owner_started_at_utc\"", json);
            StringAssert.DoesNotContain("projectPath", json);
            StringAssert.DoesNotContain("restartRequired", json);
            StringAssert.DoesNotContain("editorInstanceId", json);
        }

        [Test]
        public void SetupResponse_ParsesCanonicalStatusShape()
        {
            const string json =
                "{\"ok\":true,\"operation\":\"probe\",\"restart_required\":[\"Codex\"]," +
                "\"data\":{\"unity_cli\":{\"ready\":true},\"current_editor\":{" +
                "\"project_path\":\"/project\",\"project_id\":\"project-id\"," +
                "\"editor_instance_id\":\"editor-id\",\"ready\":true,\"tool_count\":9}," +
                "\"official_mcp\":{\"state\":\"ready\",\"tool_count\":9}," +
                "\"agents\":[{\"agent_id\":\"codex\",\"display_name\":\"Codex\"," +
                "\"detected\":true,\"registration_state\":\"registered\"," +
                "\"managed\":true,\"restart_required\":false}]," +
                "\"skills\":[{\"skill_id\":\"operate-unity-cli\"," +
                "\"display_name\":\"Operate Unity CLI\",\"state\":\"installed\"," +
                "\"install_path\":\"/skill\"}],\"advanced_broker\":{\"running\":false}}}";

            var response = UnityCliSetupResponse.Parse(json);

            Assert.IsTrue(response.ok);
            Assert.AreEqual("Codex", response.restart_required.Single());
            Assert.IsTrue(response.data.unity_cli.ready);
            Assert.AreEqual("/project", response.data.current_editor.project_path);
            Assert.AreEqual("editor-id", response.data.current_editor.editor_instance_id);
            Assert.AreEqual("ready", response.data.official_mcp.state);
            Assert.AreEqual("codex", response.data.agents.Single().agent_id);
            Assert.AreEqual("operate-unity-cli", response.data.skills.Single().skill_id);
        }

        [Test]
        public async Task OfficialProbe_UsesCanonicalArgumentsAndJsonRpcSequence()
        {
            var executable = CreateFakeExecutable();
            var session = new FakeStdioSession(
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{" +
                "\"name\":\"unity_editor_status\"},{\"name\":\"unity_cli_test\"}]}}");
            try
            {
                var probe = new UnityCliOfficialMcpProbe(() => session);
                var result = await probe.Test(
                    executable,
                    Path.GetTempPath(),
                    TimeSpan.FromSeconds(1),
                    CancellationToken.None);

                Assert.AreEqual("verified", result.state);
                Assert.AreEqual(2, result.tool_count);
                Assert.AreEqual(Path.GetFullPath(executable), session.Executable);
                CollectionAssert.AreEqual(
                    new[] { "mcp", "--project-path", Path.GetFullPath(Path.GetTempPath()) },
                    session.Arguments);
                Assert.AreEqual(3, session.Writes.Count);
                StringAssert.Contains("\"method\":\"initialize\"", session.Writes[0]);
                StringAssert.Contains(
                    "\"method\":\"notifications/initialized\"",
                    session.Writes[1]);
                StringAssert.Contains("\"method\":\"tools/list\"", session.Writes[2]);
                Assert.IsTrue(session.Terminated);
            }
            finally
            {
                File.Delete(executable);
            }
        }

        [Test]
        public async Task OfficialProbe_ReportsJsonRpcErrorAndAlwaysTerminates()
        {
            var executable = CreateFakeExecutable();
            var session = new FakeStdioSession(
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{" +
                "\"code\":-32000,\"message\":\"Editor target is not ready\"}}");
            try
            {
                var result = await new UnityCliOfficialMcpProbe(() => session).Test(
                    executable,
                    Path.GetTempPath(),
                    TimeSpan.FromSeconds(1),
                    CancellationToken.None);

                Assert.AreEqual("error", result.state);
                StringAssert.Contains("not ready", result.error);
                Assert.IsTrue(session.Terminated);
            }
            finally
            {
                File.Delete(executable);
            }
        }

        [Test]
        public async Task OfficialProbe_RejectsAnEmptyPipelineCatalog()
        {
            var executable = CreateFakeExecutable();
            var session = new FakeStdioSession(
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
                "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}");
            try
            {
                var result = await new UnityCliOfficialMcpProbe(() => session).Test(
                    executable,
                    Path.GetTempPath(),
                    TimeSpan.FromSeconds(1),
                    CancellationToken.None);

                Assert.AreEqual("error", result.state);
                StringAssert.Contains("no Pipeline tools", result.error);
                Assert.IsTrue(session.Terminated);
            }
            finally
            {
                File.Delete(executable);
            }
        }

        [Test]
        public async Task OfficialProbe_TimesOutAndTerminatesDeterministically()
        {
            var executable = CreateFakeExecutable();
            var session = new FakeStdioSession();
            try
            {
                var result = await new UnityCliOfficialMcpProbe(() => session).Test(
                    executable,
                    Path.GetTempPath(),
                    TimeSpan.FromMilliseconds(20),
                    CancellationToken.None);

                Assert.AreEqual("error", result.state);
                StringAssert.Contains("timed out", result.error);
                Assert.IsTrue(session.Terminated);
            }
            finally
            {
                File.Delete(executable);
            }
        }

        [Test]
        public async Task Installer_UsesMocksCleansTemporaryFileAndSanitizesOutput()
        {
            var spec = UnityCliPlatformInstaller.ForPlatform(RuntimePlatform.WindowsEditor);
            string temporaryPath = null;
            var result = await UnityCliPlatformInstaller.Install(
                spec,
                CancellationToken.None,
                (_, __) => Task.FromResult(Encoding.UTF8.GetBytes("Write-Output ok")),
                (_, path, __) =>
                {
                    temporaryPath = path;
                    Assert.IsTrue(File.Exists(path));
                    return Task.FromResult(new UnityCliInstallerResult
                    {
                        Ok = true,
                        Output = "Bearer local-test-token user@example.com",
                    });
                });

            Assert.IsTrue(result.Ok);
            Assert.IsFalse(File.Exists(temporaryPath));
            StringAssert.DoesNotContain("local-test-token", result.Output);
            StringAssert.DoesNotContain("user@example.com", result.Output);
        }

        [Test]
        public void DiagnosticsSanitizeCredentialsAndEmail()
        {
            var sanitized = UnityCliSetupBridge.Sanitize(
                "Bearer abc.def user@example.com password=hunter2 " +
                "https://name:pass@proxy.local");

            StringAssert.DoesNotContain("abc.def", sanitized);
            StringAssert.DoesNotContain("user@example.com", sanitized);
            StringAssert.DoesNotContain("hunter2", sanitized);
            StringAssert.DoesNotContain("name:pass", sanitized);
        }

        private static string CreateFakeExecutable()
        {
            var path = Path.Combine(
                Path.GetTempPath(),
                "unity-cli-probe-" + Guid.NewGuid().ToString("N") + ".exe");
            File.WriteAllBytes(path, Array.Empty<byte>());
            return path;
        }

        private sealed class FakeStdioSession : IUnityCliStdioSession
        {
            private readonly Queue<string> _reads;

            public FakeStdioSession(params string[] reads)
            {
                _reads = new Queue<string>(reads);
            }

            public string Executable { get; private set; }
            public IReadOnlyList<string> Arguments { get; private set; }
            public List<string> Writes { get; } = new List<string>();
            public bool Terminated { get; private set; }

            public void Start(string executable, IReadOnlyList<string> arguments)
            {
                Executable = executable;
                Arguments = arguments.ToArray();
            }

            public Task WriteLineAsync(string line, CancellationToken cancellationToken)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Writes.Add(line);
                return Task.CompletedTask;
            }

            public async Task<string> ReadLineAsync(CancellationToken cancellationToken)
            {
                if (_reads.Count > 0)
                    return _reads.Dequeue();
                await Task.Delay(Timeout.Infinite, cancellationToken);
                return null;
            }

            public void Terminate()
            {
                Terminated = true;
            }

            public void Dispose()
            {
            }
        }
    }
}
