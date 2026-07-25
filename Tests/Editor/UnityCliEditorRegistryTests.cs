using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace UniGame.UnityCli.Editor.Tests
{
    public sealed class UnityCliEditorRegistryTests
    {
        [Test]
        public void WireJson_UsesOnlySnakeCaseMetadataKeys()
        {
            var metadata = new UnityCliEditorMetadata
            {
                project_id = "project",
                project_name = "Project",
                project_path = "/project",
                editor_instance_id = Guid.NewGuid().ToString("D"),
                editor_started_at_utc = DateTime.UtcNow.ToString("O"),
                editor_version = "6000.3.14f1",
                package_version = "0.1.0",
                pipeline_version = "0.4.0-exp.1",
                connection_state = "ready",
                heartbeat_at_utc = DateTime.UtcNow.ToString("O"),
                lease_expires_at_utc = DateTime.UtcNow.AddSeconds(10).ToString("O"),
                pipeline_descriptor_path = "/descriptor",
                capability_catalog_hash = "hash",
            };

            var json = JsonUtility.ToJson(metadata);

            StringAssert.Contains("\"schema_version\"", json);
            StringAssert.Contains("\"editor_instance_id\"", json);
            StringAssert.DoesNotContain("schemaVersion", json);
            StringAssert.DoesNotContain("editorInstanceId", json);
            StringAssert.DoesNotContain("projectPath", json);
        }

        [Test]
        public void ProjectId_IsStableForEquivalentAbsolutePaths()
        {
            var path = Path.Combine(Path.GetTempPath(), "unity-cli-project");
            Assert.AreEqual(
                UnityCliEditorRegistry.ProjectId(path),
                UnityCliEditorRegistry.ProjectId(Path.Combine(path, ".")));
            Assert.AreEqual(64, UnityCliEditorRegistry.ProjectId(path).Length);
        }

        [Test]
        public void EditorInstanceId_SurvivesDomainReloadState()
        {
            Assert.AreEqual(
                UnityCliEditorRegistry.EditorInstanceId(),
                UnityCliEditorRegistry.EditorInstanceId());
            Assert.IsTrue(Guid.TryParse(UnityCliEditorRegistry.EditorInstanceId(), out _));
        }

        [Test]
        public void MetadataRevision_RemainsMonotonicAcrossPublisherReloads()
        {
            var first = UnityCliEditorRegistry.NextMetadataRevision();
            var second = UnityCliEditorRegistry.NextMetadataRevision();
            Assert.Greater(second, first);
        }

        [Test]
        public void OwnLeaseCleanup_RejectsMalformedAndForeignFiles()
        {
            var directory = Path.Combine(
                Path.GetTempPath(),
                "unity-cli-registry-test-" + Guid.NewGuid().ToString("N"));
            var path = Path.Combine(directory, "lease.json");
            Directory.CreateDirectory(directory);
            try
            {
                File.WriteAllText(path, "{broken");
                Assert.IsFalse(UnityCliEditorRegistry.DeleteOwnLease(path, "owner"));
                Assert.IsTrue(File.Exists(path));
                File.WriteAllText(
                    path,
                    JsonUtility.ToJson(new UnityCliEditorMetadata
                    {
                        editor_instance_id = "foreign",
                    }));
                Assert.IsFalse(UnityCliEditorRegistry.DeleteOwnLease(path, "owner"));
                Assert.IsTrue(File.Exists(path));
                File.WriteAllText(
                    path,
                    JsonUtility.ToJson(new UnityCliEditorMetadata
                    {
                        editor_instance_id = "owner",
                    }));
                Assert.IsTrue(UnityCliEditorRegistry.DeleteOwnLease(path, "owner"));
                Assert.IsFalse(File.Exists(path));
            }
            finally
            {
                if (Directory.Exists(directory))
                    Directory.Delete(directory, true);
            }
        }

        [Test]
        public void SetupResponse_ParseRejectsMalformedJson()
        {
            Assert.IsNull(UnityCliSetupResponse.Parse("{broken"));
            Assert.IsNull(UnityCliSetupResponse.Parse(string.Empty));
        }

        [Test]
        public void BrokerLease_RenewsOnlyMatchingExistingOwner()
        {
            var directory = Path.Combine(
                Path.GetTempPath(),
                "unity-cli-broker-test-" + Guid.NewGuid().ToString("N"));
            var path = Path.Combine(directory, "owner.json");
            Directory.CreateDirectory(directory);
            try
            {
                var original = new UnityCliBrokerLease
                {
                    editor_instance_id = "owner",
                    owner_pid = 42,
                    owner_started_at_utc = "2026-07-25T00:00:00.000Z",
                    heartbeat_at_utc = "2026-07-25T00:00:01.000Z",
                    lease_expires_at_utc = "2026-07-25T00:00:11.000Z",
                };
                File.WriteAllText(path, JsonUtility.ToJson(original));
                Assert.IsFalse(UnityCliEditorRegistry.RenewOwnBrokerLease(
                    path,
                    "foreign",
                    42,
                    original.owner_started_at_utc,
                    DateTime.Parse("2026-07-25T00:00:05.000Z").ToUniversalTime()));
                Assert.IsTrue(UnityCliEditorRegistry.RenewOwnBrokerLease(
                    path,
                    "owner",
                    42,
                    original.owner_started_at_utc,
                    DateTime.Parse("2026-07-25T00:00:05.000Z").ToUniversalTime()));
                var renewed = JsonUtility.FromJson<UnityCliBrokerLease>(File.ReadAllText(path));
                StringAssert.StartsWith("2026-07-25T00:00:15", renewed.lease_expires_at_utc);
                Assert.IsTrue(UnityCliEditorRegistry.DeleteOwnBrokerLease(
                    path,
                    "owner",
                    42,
                    original.owner_started_at_utc));
            }
            finally
            {
                if (Directory.Exists(directory))
                    Directory.Delete(directory, true);
            }
        }
    }
}
