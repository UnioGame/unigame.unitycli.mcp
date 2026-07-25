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
        public void FindProjectRoot_ReturnsNearestGitOwner()
        {
            var root = Path.Combine(Path.GetTempPath(), "unigame-unitycli-root-test");
            var project = Path.Combine(root, "nested", "UnityProject");
            Directory.CreateDirectory(Path.Combine(root, ".git"));
            Directory.CreateDirectory(project);
            try
            {
                Assert.AreEqual(
                    Path.GetFullPath(root),
                    UnityCliSetupBridge.FindProjectRoot(project));
            }
            finally
            {
                Directory.Delete(root, true);
            }
        }

        [Test]
        public void ConfirmationMessage_DescribesProtectedOperation()
        {
            StringAssert.Contains(
                "backup",
                UnityCliSetupBridge.ConfirmationMessage("remove", false).ToLowerInvariant());
            StringAssert.Contains(
                "stop",
                UnityCliSetupBridge.ConfirmationMessage("serve", true).ToLowerInvariant());
        }

        [Test]
        public void Execute_ReturnsStructuredFailureForMissingRuntime()
        {
            var result = UnityCliSetupBridge.Execute(
                Path.Combine(Path.GetTempPath(), "missing-node"),
                Path.Combine(Path.GetTempPath(), "missing-setup"),
                "{}");
            StringAssert.Contains("\"ok\":false", result);
        }

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
        public void Layout_ContainsOneGuidedWorkflowAndAdvancedRecovery()
        {
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(
                UnityCliSetupWindow.WindowUxmlPath);
            var root = tree.Instantiate();

            Assert.NotNull(root.Q<Button>("review-configuration"));
            Assert.NotNull(root.Q<VisualElement>("preview-panel"));
            Assert.NotNull(root.Q<Button>("apply-configuration"));
            Assert.NotNull(root.Q<Foldout>("advanced-foldout"));
            Assert.NotNull(root.Q<Button>("remove-configuration"));
            Assert.IsNull(root.Q<VisualElement>("page-tabs"));
            Assert.AreEqual("Refresh", root.Q<Button>("refresh-status").text);
            Assert.AreEqual("Review", root.Q<Button>("review-configuration").text);
            Assert.AreEqual("Apply", root.Q<Button>("apply-configuration").text);
            Assert.AreEqual("Install", root.Q<Button>("install-cli").text);
            Assert.AreEqual("Install", root.Q<Button>("install-pipeline").text);
            Assert.AreEqual("Docs", root.Q<Button>("open-cli-docs").text);
            Assert.AreEqual("Docs", root.Q<Button>("open-node-docs").text);
            Assert.AreEqual("Copy Command", root.Q<Button>("copy-cli-command").text);
            Assert.AreEqual("Start", root.Q<Button>("http-action").text);
            Assert.AreEqual("Remove", root.Q<Button>("remove-configuration").text);
            Assert.AreEqual("Rollback", root.Q<Button>("rollback-configuration").text);
            Assert.AreEqual("Copy", root.Q<Button>("copy-diagnostics").text);
        }

        [Test]
        public void Presenter_FirstUseSelectsOnlyDetectedAgents()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[]
                {
                    new UnityCliAgentStatus { id = "codex", installed = true },
                    new UnityCliAgentStatus { id = "cursor", installed = false },
                    new UnityCliAgentStatus { id = "cline", installed = true },
                },
                false,
                null);

            CollectionAssert.AreEquivalent(
                new[] { "codex", "cline" },
                presenter.SelectedAgents);
        }

        [Test]
        public void Presenter_SavedSelectionWinsAfterDomainReload()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[]
                {
                    new UnityCliAgentStatus { id = "codex", installed = true },
                    new UnityCliAgentStatus { id = "cursor", installed = true },
                },
                true,
                new[] { "cursor" });

            CollectionAssert.AreEquivalent(new[] { "cursor" }, presenter.SelectedAgents);
        }

        [Test]
        public void Presenter_MissingUnconfiguredAgentCannotBeEnabled()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[]
                {
                    new UnityCliAgentStatus
                    {
                        id = "cursor",
                        installed = false,
                        configured = false,
                    },
                },
                true,
                new[] { "cursor" });
            presenter.UpdateAgentStatuses(new[]
            {
                new UnityCliAgentStatus
                {
                    id = "cursor",
                    installed = false,
                    configured = false,
                },
            });

            Assert.IsFalse(presenter.CanToggleAgent("cursor"));
            Assert.IsFalse(presenter.IsAgentSelected("cursor"));
            Assert.AreEqual("Missing", presenter.AgentDetection("cursor"));
            Assert.AreEqual("Off", presenter.AgentIntegration("cursor"));
        }

        [Test]
        public void Presenter_ConfiguredMissingAgentCanBeDisabled()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[]
                {
                    new UnityCliAgentStatus
                    {
                        id = "codex",
                        installed = false,
                        configured = true,
                    },
                },
                true,
                new[] { "codex" });

            Assert.IsTrue(presenter.CanToggleAgent("codex"));
            presenter.SetAgentSelected("codex", false);
            CollectionAssert.Contains(presenter.DisabledAgents, "codex");
            Assert.AreEqual("Pending Off", presenter.AgentIntegration("codex"));
            Assert.IsTrue(presenter.CanReview("node", "v20.11.0", "unity", "setup"));
        }

        [Test]
        public void Presenter_UsesCompactIntegrationStates()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[]
                {
                    new UnityCliAgentStatus { id = "codex", installed = true },
                    new UnityCliAgentStatus
                    {
                        id = "cursor",
                        installed = true,
                        configured = true,
                    },
                    new UnityCliAgentStatus
                    {
                        id = "cline",
                        installed = true,
                        conflict = true,
                    },
                },
                true,
                new[] { "codex", "cursor", "cline" });

            Assert.AreEqual("Pending On", presenter.AgentIntegration("codex"));
            Assert.AreEqual("On", presenter.AgentIntegration("cursor"));
            Assert.AreEqual("Conflict", presenter.AgentIntegration("cline"));
            presenter.SetAgentSelected("cursor", false);
            Assert.AreEqual("Pending Off", presenter.AgentIntegration("cursor"));
            Assert.AreEqual("Off", presenter.AgentToggleValue("cursor"));
        }

        [TestCase("", "v20.0.0", "unity", "setup")]
        [TestCase("node", "v18.20.0", "unity", "setup")]
        [TestCase("node", "v20.0.0", "", "setup")]
        public void Presenter_MissingPrerequisiteBlocksReview(
            string node,
            string nodeVersion,
            string cli,
            string setup)
        {
            var presenter = ReadyPresenter();
            Assert.IsFalse(presenter.CanReview(node, nodeVersion, cli, setup));
        }

        [Test]
        public void Presenter_PipelineDoesNotGateStandaloneReview()
        {
            var presenter = ReadyPresenter();
            Assert.IsTrue(presenter.CanReview("node", "v20.11.0", "unity", "setup"));
        }

        [Test]
        public void Presenter_PreviewEnablesApplyAndShowsForceOnlyForConflict()
        {
            var presenter = ReadyPresenter();
            presenter.AcceptResponse(new UnityCliSetupResponse
            {
                ok = true,
                operation = "plan",
                changes = new[]
                {
                    new UnityCliPlannedChange { kind = "update", conflict = true },
                },
            });

            Assert.IsTrue(presenter.PreviewReady);
            Assert.IsTrue(presenter.ForceVisible);
            Assert.IsTrue(presenter.CanApply("node", "v20.11.0", "unity", "setup"));
        }

        [Test]
        public void Presenter_BusyStateBlocksRepeatedOperations()
        {
            var presenter = ReadyPresenter();
            presenter.SetBusy(true);
            Assert.IsFalse(presenter.CanReview("node", "v20.11.0", "unity", "setup"));
        }

        [Test]
        public void TypedResponse_ParsesRestartAndHttpState()
        {
            const string json =
                "{\"ok\":true,\"operation\":\"probe\",\"changes\":[],\"warnings\":[]," +
                "\"errors\":[],\"restartRequired\":[\"Codex\"],\"data\":{\"serverInstalled\":true," +
                "\"http\":{\"pid\":42,\"port\":7788,\"alive\":true}}}";
            var response = UnityCliSetupResponse.Parse(json);

            Assert.IsTrue(response.ok);
            Assert.AreEqual("Codex", response.restartRequired.Single());
            Assert.IsTrue(response.data.serverInstalled);
            Assert.IsTrue(response.data.http.alive);
            Assert.AreEqual(7788, response.data.http.port);
        }

        [TestCase(RuntimePlatform.WindowsEditor, "Windows", ".ps1", "powershell.exe")]
        [TestCase(RuntimePlatform.OSXEditor, "macOS", ".sh", "/bin/bash")]
        [TestCase(RuntimePlatform.LinuxEditor, "Linux", ".sh", "/bin/bash")]
        public void Installer_SelectsPlatformCommand(
            RuntimePlatform platform,
            string expectedPlatform,
            string expectedExtension,
            string expectedExecutable)
        {
            var spec = UnityCliPlatformInstaller.ForPlatform(platform);
            Assert.AreEqual(expectedPlatform, spec.Platform);
            Assert.AreEqual(expectedExtension, spec.Extension);
            Assert.AreEqual(expectedExecutable, spec.Executable);
            StringAssert.Contains("UNITY_CLI_CHANNEL", spec.Command);
            StringAssert.StartsWith("https://public-cdn.cloud.unity3d.com/", spec.Url);
        }

        [Test]
        public void Installer_StartInfoUsesNoShellAndBetaChannel()
        {
            var spec = UnityCliPlatformInstaller.ForPlatform(RuntimePlatform.WindowsEditor);
            var info = UnityCliPlatformInstaller.CreateStartInfo(spec, "C:\\Temp\\install.ps1");

            Assert.IsFalse(info.UseShellExecute);
            Assert.AreEqual("beta", info.EnvironmentVariables["UNITY_CLI_CHANNEL"]);
            StringAssert.Contains("install.ps1", info.Arguments);
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
                        Error = string.Empty,
                    });
                });

            Assert.IsTrue(result.Ok);
            Assert.IsFalse(File.Exists(temporaryPath));
            StringAssert.DoesNotContain("local-test-token", result.Output);
            StringAssert.DoesNotContain("user@example.com", result.Output);
        }

        [Test]
        public async Task Installer_CancellationDoesNotRunOrLeaveTemporaryFile()
        {
            var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            var executed = false;
            var result = await UnityCliPlatformInstaller.Install(
                UnityCliPlatformInstaller.ForPlatform(RuntimePlatform.LinuxEditor),
                cancellation.Token,
                (_, token) =>
                {
                    token.ThrowIfCancellationRequested();
                    return Task.FromResult(Encoding.UTF8.GetBytes("echo ok"));
                },
                (_, __, ___) =>
                {
                    executed = true;
                    return Task.FromResult(new UnityCliInstallerResult { Ok = true });
                });

            Assert.IsFalse(result.Ok);
            Assert.IsFalse(executed);
            Assert.AreEqual("Install cancelled", result.Error);
        }

        [Test]
        public async Task Installer_PropagatesTimeoutAndCleansTemporaryFile()
        {
            string temporaryPath = null;
            var result = await UnityCliPlatformInstaller.Install(
                UnityCliPlatformInstaller.ForPlatform(RuntimePlatform.OSXEditor),
                CancellationToken.None,
                (_, __) => Task.FromResult(Encoding.UTF8.GetBytes("echo ok")),
                (_, path, __) =>
                {
                    temporaryPath = path;
                    return Task.FromResult(new UnityCliInstallerResult
                    {
                        Ok = false,
                        ExitCode = -1,
                        Error = "Install timed out",
                    });
                });

            Assert.IsFalse(result.Ok);
            Assert.AreEqual("Install timed out", result.Error);
            Assert.IsFalse(File.Exists(temporaryPath));
        }

        [Test]
        public void DiagnosticsSanitizeCredentialsAndEmail()
        {
            var sanitized = UnityCliSetupBridge.Sanitize(
                "Bearer abc.def user@example.com password=hunter2 https://name:pass@proxy.local");

            StringAssert.DoesNotContain("abc.def", sanitized);
            StringAssert.DoesNotContain("user@example.com", sanitized);
            StringAssert.DoesNotContain("hunter2", sanitized);
            StringAssert.DoesNotContain("name:pass", sanitized);
        }

        private static UnityCliSetupPresenter ReadyPresenter()
        {
            var presenter = new UnityCliSetupPresenter();
            presenter.InitializeAgents(
                new[] { new UnityCliAgentStatus { id = "codex", installed = true } },
                false,
                null);
            return presenter;
        }
    }
}
