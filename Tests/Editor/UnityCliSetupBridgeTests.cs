using System.IO;
using NUnit.Framework;

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
    }
}
