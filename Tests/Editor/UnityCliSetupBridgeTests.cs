using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
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
                new[] { new UnityCliAgentStatus { id = "codex", installed = true } },
                true,
                new[] { "cursor" });

            CollectionAssert.AreEquivalent(new[] { "cursor" }, presenter.SelectedAgents);
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
